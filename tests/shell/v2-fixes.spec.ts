import { test, expect, type Page } from "@playwright/test";
import { createTeacher, deleteTeacher, seedResource, signIn, type TestTeacher } from "../support/users";

/*
 * The V2 audit fixes, through the interface.
 *
 * Each test here pins a specific defect that was found by comparing staging
 * against the prototypes, so a regression names the thing it broke rather than
 * "the dashboard is wrong".
 *
 * The shared-shell tests are the ones worth the browser time: a remounting
 * sidebar is invisible to a unit test and to a screenshot, because the rail
 * still ends up correct a moment later. What distinguishes it is whether the
 * SAME DOM node survives the navigation, which is what these assert.
 */

/** Tags a node so it can be recognised again after a navigation. */
async function markSidebar(page: Page, token: string): Promise<void> {
  await page.locator("#app-sidenav-v2").evaluate((el, t) => el.setAttribute("data-e2e", t), token);
}

/** True when the sidebar still carries the mark, i.e. it was never remounted. */
async function sidebarSurvived(page: Page, token: string): Promise<boolean> {
  return (await page.locator("#app-sidenav-v2").getAttribute("data-e2e")) === token;
}

test.describe("V2 fixes", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Casey");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  /* ── The shared shell ─────────────────────────────────────────────────── */

  test("the sidebar survives navigation inside the (app) group", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");
    await expect(page.locator("#app-sidenav-v2")).toBeVisible();

    await markSidebar(page, "kept");

    // Every route reachable from the rail. All of these used to mount their own
    // AppShellV2 — five inside the page, /tools and /assistant in layouts of
    // their own — so the rail was destroyed and rebuilt on arrival. /tools and
    // /assistant are the important ones here: they were the last two out, and
    // crossing into them is what a teacher actually notices.
    for (const path of [
      "/folders",
      "/timetable",
      "/colleagues",
      "/tools",
      "/assistant",
      "/dashboard",
    ]) {
      // Scoped to the rail, and awaited as a navigation: a bare click can fire
      // before the destination page has hydrated, which lands on the previous
      // URL and reads as a routing failure rather than the timing one it is.
      const link = page.locator("#app-sidenav-v2").getByRole("link", { name: navNameFor(path) });
      await expect(link).toBeVisible();
      await link.click();
      // toHaveURL rather than waitForURL: these are client-side transitions and
      // fire no load event, which waitForURL waits for by default.
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      expect(
        await sidebarSurvived(page, "kept"),
        `the sidebar remounted on ${path}, so the shell is not shared`,
      ).toBe(true);
    }
  });

  test("the sidebar survives the trip to Profile", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");
    await expect(page.locator("#app-sidenav-v2")).toBeVisible();
    await markSidebar(page, "kept");

    // Reached from the account menu, not the rail, but it is in the same route
    // group and so must reuse the same shell.
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /^profile$/i }).click();
    await expect(page).toHaveURL(/\/profile/);

    expect(
      await sidebarSurvived(page, "kept"),
      "the sidebar remounted on /profile, so the shell is not shared",
    ).toBe(true);
  });

  test("the sidebar survives the foot links and a tool page", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");
    await expect(page.locator("#app-sidenav-v2")).toBeVisible();
    await markSidebar(page, "kept");

    // Updates and Help sit in the sidebar foot rather than the main nav, and
    // each used to mount its own shell.
    for (const [name, url] of [
      [/^updates/i, /\/notifications/],
      [/^help/i, /\/help/],
    ] as const) {
      await page.locator("#app-sidenav-v2").getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
      expect(await sidebarSurvived(page, "kept"), `the sidebar remounted on ${url}`).toBe(true);
    }

    // An individual tool page, which has its own layout for the back link and
    // the tool's name. That layout must set the title without remounting.
    await page.goto("/tools");
    await expect(page.locator("#app-sidenav-v2")).toBeVisible();
    await page.locator("#app-sidenav-v2").evaluate((el) => el.setAttribute("data-e2e", "kept"));
    // By href: a tool card is a styled div with an overlay <a>, so matching on
    // the visible name is ambiguous.
    await page.locator('a[href="/tools/lesson-planner"]').first().click();
    await expect(page).toHaveURL(/\/tools\/lesson-planner/);
    expect(
      await sidebarSurvived(page, "kept"),
      "the sidebar remounted on a tool page",
    ).toBe(true);
  });

  test("moving between the group's routes never blanks the rail", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const nav = page.locator("#app-sidenav-v2");
    await expect(nav.getByRole("link", { name: /^today$/i })).toBeVisible();

    await page.getByRole("link", { name: /^library/i }).first().click();
    await expect(page).toHaveURL(/\/folders/);

    // Asserted immediately, with no waiting: the nav items must already be on
    // screen rather than arriving after a refetch.
    await expect(nav.getByRole("link", { name: /^today$/i })).toBeVisible({ timeout: 1000 });
  });

  /* ── Today ───────────────────────────────────────────────────────────── */

  test("the metrics read in the handover's order", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const labels = page.locator('[class*="metricLabel"]');
    await expect(labels).toHaveCount(4);
    await expect(labels).toHaveText([
      "Day streak",
      "Resources made",
      "Badges earned",
      "Time saved",
    ]);
  });

  test("metric icons are centred in their tiles", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const tile = page.locator('[class*="metricIcon"]').first();
    await expect(tile).toBeVisible();

    // The bug: `.metric span` also matched the icon tile and its display:block
    // beat display:grid, which killed place-items:center and dropped every
    // glyph to the top left.
    await expect(tile).toHaveCSS("display", "grid");

    // The glyph must actually sit in the middle of the tile, not just inherit a
    // rule that says it should.
    const offset = await tile.evaluate((el) => {
      const svg = el.querySelector("svg");
      if (!svg) return null;
      const t = el.getBoundingClientRect();
      const g = svg.getBoundingClientRect();
      return {
        x: Math.abs((g.left + g.right) / 2 - (t.left + t.right) / 2),
        y: Math.abs((g.top + g.bottom) / 2 - (t.top + t.bottom) / 2),
      };
    });
    expect(offset, "the tile has no glyph").not.toBeNull();
    expect(offset!.x).toBeLessThan(1.5);
    expect(offset!.y).toBeLessThan(1.5);
  });

  test("no em dash is shown while the metrics load", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");
    await expect(page.locator('[class*="metricLabel"]').first()).toBeVisible();

    // The brand bans em and en dashes in anything a teacher can see, and these
    // were the loading placeholder.
    const metrics = page.locator('[class*="metrics"]').first();
    expect(await metrics.innerText()).not.toMatch(/[\u2014\u2013]/);
  });

  /* ── The sidebar ─────────────────────────────────────────────────────── */

  test("the level box sits under the nav, above the credits block", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    // Badge progress loads async, so wait for the box rather than counting it
    // immediately — count() on a not-yet-rendered node reads zero and would
    // skip a test that should run.
    const level = page.locator('[class*="levelBox"]');
    await expect(level).toBeVisible();

    const nav = page.locator("#app-sidenav-v2 nav");
    const navBottom = (await nav.boundingBox())!.y + (await nav.boundingBox())!.height;
    const levelTop = (await level.boundingBox())!.y;

    // Below the nav, and close to it rather than pushed to the bottom.
    expect(levelTop).toBeGreaterThanOrEqual(navBottom - 1);
    expect(levelTop - navBottom).toBeLessThan(80);
  });

  test("the library count is live", async ({ page }) => {
    await seedResource(teacher, "A seeded lesson");
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const library = page.locator("#app-sidenav-v2").getByRole("link", { name: /^library/i });
    await expect(library).toContainText("1");
  });

  /* ── Library ─────────────────────────────────────────────────────────── */

  test("a resource row offers Download in its menu", async ({ page }) => {
    await seedResource(teacher, "Downloadable lesson");
    await signIn(page, teacher);
    await page.goto("/folders");

    await expect(page.getByText("Downloadable lesson")).toBeVisible();
    // Named for the row, not /menu$/: the top bar has an "Account menu" button
    // that would otherwise match first.
    await page.getByRole("button", { name: "Downloadable lesson menu" }).click();

    // All five items the handover specifies, Download included.
    for (const item of ["Edit", "Share with colleagues", "Move to folder", "Download", "Delete"]) {
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    }
  });
});

/** The sidebar link that leads to a given route. */
function navNameFor(path: string): RegExp {
  switch (path) {
    case "/folders":
      return /^library/i;
    case "/timetable":
      return /^timetable$/i;
    case "/colleagues":
      return /^colleagues/i;
    case "/tools":
      return /^make/i;
    case "/assistant":
      return /^ask jo$/i;
    default:
      return /^today$/i;
  }
}
