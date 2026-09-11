import { test, expect, type Page } from "@playwright/test";
import {
  admin,
  createTeacher,
  deleteTeacher,
  seedResource,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Can you actually click the Library's "..." menu?
 *
 * In grid view you could not. The menu rendered, but underneath the cards to
 * its right and below, so every item in it was unclickable. Two stacking
 * contexts caused it, and both had to go:
 *
 *   - `.filecard:hover` applies transform: translateY(-3px), and a non-none
 *     transform creates a stacking context that traps the panel inside the
 *     card. You are always hovering the card whose kebab you just clicked.
 *   - the menu's wrapper carried `position: absolute; z-index: 2`, which
 *     clamped the panel's own z-index: 30 to an effective 2.
 *
 * THE ASSERTION HAS TO BE A HIT TEST. Checking the panel's computed z-index
 * would have passed the whole time it was broken: the value was always 30, it
 * simply meant nothing inside those contexts. What matters is whether the
 * pixels a teacher aims at belong to the menu, so that is what is measured —
 * elementFromPoint at the centre of a menu item, plus a real click.
 */

/** Enough resources to fill more than one row of the grid, so there is always a
 *  card to the right of and below the one under test. */
const SEEDED = 10;

async function openLibrary(page: Page, view: "grid" | "list"): Promise<void> {
  await page.goto("/folders");
  // The cards arrive from the client after the session resolves.
  await expect(page.locator('[class*="filecard"], [class*="filerow"]').first()).toBeVisible();

  if (view === "list") {
    await page.getByRole("button", { name: /list/i }).click();
    await expect(page.locator('[class*="filerow"]').first()).toBeVisible();
  }
}

/** Open the kebab on the nth RESOURCE card or row, and return its panel.
 *
 *  Scoped to the card rather than indexing every kebab on the page: the folder
 *  cards above the grid have menus too, so a page-wide index opens whichever
 *  one happens to come first in the DOM. */
async function openMenu(page: Page, nth: number) {
  const card = page.locator('[class*="filecard"], [class*="filerow"]').nth(nth);
  await card.getByRole("button", { name: /menu$/i }).click();
  const panel = page.locator('[role="menu"]');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Is this element the thing that would actually receive a click at its centre?
 *
 * Returns the tag/class of whatever is really on top, so a failure says what
 * covered the menu rather than just "false".
 */
async function whatIsOnTop(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "MISSING";
    const r = el.getBoundingClientRect();
    // Off screen entirely: elementFromPoint answers null for a point outside
    // the viewport, which is a different problem from being covered and must
    // not be reported as one.
    if (r.bottom < 0 || r.top > window.innerHeight) return "OFFSCREEN";
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return "NOTHING";
    // The menu item contains an icon and a label, so a descendant is a pass.
    if (el.contains(hit) || hit.contains(el)) return "SELF";
    return `${hit.tagName}.${hit.className}`;
  }, selector);
}

test.describe("The Library resource menu", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Mena");
    for (let i = 0; i < SEEDED; i++) {
      await seedResource(teacher, `Menu test resource ${i + 1}`);
    }
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a grid card's menu is on top of the cards around it", async ({ page }) => {
    await signIn(page, teacher);
    await openLibrary(page, "grid");

    // The first card: it has neighbours to the right and below, which are the
    // ones that used to paint over its menu.
    await openMenu(page, 0);

    const items = page.locator('[role="menu"] button');
    const count = await items.count();
    expect(count, "the menu rendered no items").toBeGreaterThan(0);

    // The panel is taller than the gap to the fold on a short viewport, so
    // bring its foot into view before hit testing. Otherwise the lower items
    // report OFFSCREEN, which is a viewport artefact rather than the bug.
    await items.last().scrollIntoViewIfNeeded();

    // Every item, not just the first: the panel is tall and the cards below
    // covered its lower half even when the top was clear.
    for (let i = 0; i < count; i++) {
      const onTop = await whatIsOnTop(page, `[role="menu"] button:nth-of-type(${i + 1})`);
      expect(onTop, `menu item ${i + 1} is covered by ${onTop}`).toBe("SELF");
    }
  });

  test("the open card is not left transformed", async ({ page }) => {
    await signIn(page, teacher);
    await openLibrary(page, "grid");
    await openMenu(page, 0);

    // The hover transform is one of the two root causes: while the menu is
    // open the card must not be creating a stacking context of its own.
    const card = page.locator('[class*="filecard"]').first();
    await expect(card).toHaveCSS("transform", "none");
  });

  test("a menu item actually responds to a click", async ({ page }) => {
    await signIn(page, teacher);
    await openLibrary(page, "grid");
    await openMenu(page, 0);

    // Being painted on top is necessary but not sufficient. Move to folder
    // opens a modal and changes nothing, so it is the safe one to prove with.
    await page.locator('[role="menu"] button', { hasText: /move to folder/i }).click();
    await expect(page.getByText(/resources sit in one folder at a time/i)).toBeVisible();
  });

  test("the last column's menu stays inside the viewport", async ({ page }) => {
    await signIn(page, teacher);
    await openLibrary(page, "grid");

    // The panel is right-aligned, so the rightmost card is where it would spill
    // off screen if it escaped its card the wrong way.
    const cards = page.locator('[class*="filecard"]');
    const total = await cards.count();
    expect(total).toBeGreaterThan(1);

    // Find the card furthest right on the first row. Indexed against the CARDS
    // and then clicked through the card itself: the kebabs on the page include
    // the folder cards' too, so a shared index would open the wrong menu.
    const boxes = await cards.evaluateAll((els) =>
      els.map((el, i) => ({ i, ...el.getBoundingClientRect().toJSON() })),
    );
    const firstRowTop = Math.min(...boxes.map((b) => b.top));
    const rightmost = boxes
      .filter((b) => Math.abs(b.top - firstRowTop) < 4)
      .sort((a, b) => b.left - a.left)[0];

    await cards.nth(rightmost.i).getByRole("button", { name: /menu$/i }).click();
    await expect(page.locator('[role="menu"]')).toBeVisible();

    const panel = page.locator('[role="menu"]');
    const box = (await panel.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x, "the menu spills off the left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "the menu spills off the right").toBeLessThanOrEqual(width + 1);
  });

  test("a list row's menu is on top too", async ({ page }) => {
    await signIn(page, teacher);
    await openLibrary(page, "list");
    await openMenu(page, 0);

    const onTop = await whatIsOnTop(page, '[role="menu"] button:nth-of-type(1)');
    expect(onTop, `the list menu is covered by ${onTop}`).toBe("SELF");
  });

  test("a folder card's menu is on top of the folders around it", async ({ page }) => {
    // Two folders, so one has a neighbour to paint over it.
    const { error } = await admin.from("folders").insert([
      { user_id: teacher.id, name: "Menu test A", colour: "violet" },
      { user_id: teacher.id, name: "Menu test B", colour: "blue" },
    ]);
    expect(error, error?.message).toBeNull();

    await signIn(page, teacher);
    await page.goto("/folders");

    const kebab = page.getByRole("button", { name: /^Menu test A menu$/i });
    await expect(kebab).toBeVisible();
    await kebab.click();
    await expect(page.locator('[role="menu"]')).toBeVisible();

    const onTop = await whatIsOnTop(page, '[role="menu"] button:nth-of-type(1)');
    expect(onTop, `the folder menu is covered by ${onTop}`).toBe("SELF");
  });
});
