import { test, expect } from "@playwright/test";
import {
  admin,
  connect,
  createTeacher,
  deleteTeacher,
  seedResource,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Colleagues, through the interface.
 *
 * scripts/verify-colleagues.mjs already proves the database layer: RLS, the
 * definer functions, the share semantics. None of that says the SCREEN works,
 * and two changes in particular are worth a real browser:
 *
 *   - listColleagues fetches names in a SECOND round trip, through
 *     colleague_profiles, because profiles is own-row-only and a PostgREST
 *     embed would come back null. If that join is wrong, every row silently
 *     reads "A colleague" and nothing errors.
 *
 *   - Today's recent rows were a <button> and are now a <div> with two buttons
 *     inside, because a Share control cannot nest inside a button. That is
 *     exactly the kind of restructure that breaks a click target.
 */

test.describe("Colleagues", () => {
  let alice: TestTeacher;
  let bob: TestTeacher;

  test.beforeEach(async () => {
    alice = await createTeacher("Alice");
    bob = await createTeacher("Bob");
  });

  test.afterEach(async () => {
    await deleteTeacher(alice);
    await deleteTeacher(bob);
  });

  test("the page loads with its empty state", async ({ page }) => {
    await signIn(page, alice);
    await page.goto("/colleagues");

    await expect(page.getByRole("heading", { name: "Colleagues", level: 1 })).toBeVisible();
    await expect(page.getByText("No colleagues yet")).toBeVisible();
    await expect(page.getByPlaceholder(/find a colleague/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /invite a colleague/i })).toBeVisible();

    // The feed's own empty state, distinct from the colleague list's.
    await expect(page.getByText(/nothing shared with you yet/i)).toBeVisible();
  });

  test("the sidebar link is live rather than a Soon pill", async ({ page }) => {
    await signIn(page, alice);
    await page.goto("/dashboard");

    const link = page.getByRole("link", { name: /colleagues/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/colleagues/);
  });

  test("a teacher can be found, and only by what search allows", async ({ page }) => {
    await signIn(page, alice);
    await page.goto("/colleagues");

    const search = page.getByPlaceholder(/find a colleague/i);

    // Exact username.
    await search.fill(bob.username);
    await expect(page.getByText("Bob Testcase")).toBeVisible();
    await expect(page.getByRole("button", { name: /^add$/i })).toBeVisible();

    // A stranger's stats must not be on screen before connecting. This is the
    // privacy model made visible.
    await expect(page.getByText("Day streak")).toHaveCount(0);

    // Two characters is below the floor inside find_colleagues.
    await search.fill("bo");
    await expect(page.getByText("Bob Testcase")).toHaveCount(0);

    // A surname finds nobody. Names stopped being searchable in
    // 20260912000000: a prefix match on a name is an enumeration of real
    // teachers, so discovery needs an identifier the searcher already holds.
    await search.fill("Testca");
    await expect(page.getByText("Bob Testcase")).toHaveCount(0);

    // An exact email still finds him, and the row still names him.
    await search.fill(bob.email);
    await expect(page.getByText("Bob Testcase")).toBeVisible();
  });

  test("a request can be sent, accepted, and the row then shows real numbers", async ({
    page,
    browser,
  }) => {
    // Something in Bob's library, so his metrics are not all zero and the
    // no-zero rule is exercised on real values.
    await seedResource(bob, "Bob's fractions plan");

    await signIn(page, alice);
    await page.goto("/colleagues");
    await page.getByPlaceholder(/find a colleague/i).fill(bob.username);
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText(/request sent/i)).toBeVisible();

    // Bob, in his own browser context, so the two sessions are genuinely
    // separate rather than sharing cookies.
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await signIn(bobPage, bob);
    await bobPage.goto("/colleagues");

    await expect(bobPage.getByText(/wants to connect/i)).toBeVisible();
    await expect(bobPage.getByText("Alice Testcase")).toBeVisible();
    await bobPage.getByRole("button", { name: /^accept$/i }).click();

    // The row Alice now sees. THIS is the check that matters: the name comes
    // from a separate colleague_profiles call, and a wrong join renders the
    // "A colleague" fallback instead.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Bob Testcase" })).toBeVisible();
    await expect(page.getByText(`@${bob.username}`)).toBeVisible();

    // The fallback name, scoped to the colleague row. Unscoped it also matches
    // the feed's empty state ("When a colleague shares a resource...").
    const row = page.locator("div").filter({ hasText: `@${bob.username}` }).last();
    await expect(row).not.toContainText("A colleague");

    // Stats appear now, and the seeded resource is counted.
    await expect(row).toContainText("Resources made");
    await expect(row).toContainText("Day streak");
    await expect(page.getByText(/^Level \d+$/).first()).toBeVisible();

    await bobContext.close();
  });

  test("a resource shared from the Library arrives, and saving copies it", async ({
    page,
    browser,
  }) => {
    await connect(alice, bob);
    await seedResource(alice, "Alice's rivers lesson", "RIVERS BODY");

    await signIn(page, alice);
    await page.goto("/folders");

    // Unfiled is the default view, which is where a seeded resource lands.
    await expect(page.getByText("Alice's rivers lesson")).toBeVisible();

    // The row menu item that was inert until this feature shipped. The trigger
    // is labelled "<title> menu" by the Menu component, so name it exactly
    // rather than matching /menu/i, which also hits the nav.
    await page.getByRole("button", { name: "Alice's rivers lesson menu" }).click();
    await page.getByRole("menuitem", { name: /share with colleagues/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/yours stays untouched/i)).toBeVisible();

    // Nothing selected yet.
    await expect(dialog.getByRole("button", { name: /select someone/i })).toBeDisabled();

    await dialog.getByRole("button", { name: /Bob Testcase/i }).click();
    const send = dialog.getByRole("button", { name: /share with 1/i });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(dialog).toBeHidden();

    // Bob's side.
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await signIn(bobPage, bob);
    await bobPage.goto("/colleagues");

    await expect(bobPage.getByText("Alice's rivers lesson")).toBeVisible();
    await expect(bobPage.getByText(/shared by alice/i)).toBeVisible();

    // Before saving, Bob's library must be empty: an offer is not a delivery.
    const { count: beforeCount } = await admin
      .from("tool_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", bob.id);
    expect(beforeCount).toBe(0);

    await bobPage.getByRole("button", { name: /add to library/i }).click();
    await expect(bobPage.getByText("Alice's rivers lesson")).toBeHidden();

    // The copy is real, is Bob's, and carries the snapshot.
    const { data: copies } = await admin
      .from("tool_runs")
      .select("title, output")
      .eq("user_id", bob.id);
    expect(copies).toHaveLength(1);
    expect(copies?.[0].title).toBe("Alice's rivers lesson");
    expect(copies?.[0].output).toBe("RIVERS BODY");

    // And Alice still has hers.
    const { count: aliceCount } = await admin
      .from("tool_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", alice.id);
    expect(aliceCount).toBe(1);

    await bobContext.close();
  });

  test("a shared resource can be read before it is added, and the outline navigates it", async ({
    page,
  }) => {
    /*
     * The feed used to offer Save and Dismiss and no way to look first, so the
     * only things to judge an offer on were its title and who sent it.
     *
     * The interesting half of this test is the outline. It renders through
     * OutlineRail, which drives the SAME hook as the sidebar card but against a
     * scroll container rather than the window. Getting that wrong is silent:
     * the links render and highlight, and clicking them simply does nothing, or
     * scrolls the page behind the scrim instead.
     */
    await connect(alice, bob);

    // Long enough that the last heading starts well below the fold, or a click
    // that does nothing at all would still leave it "visible".
    const filler = Array.from({ length: 40 }, (_, i) => `Line ${i} of the body.`).join("\n\n");
    const body = `# Rivers\n\n${filler}\n\n## Erosion\n\n${filler}\n\n## Deposition\n\n${filler}`;
    await seedResource(alice, "Alice's rivers lesson", body);

    const runId = (
      await admin.from("tool_runs").select("id").eq("user_id", alice.id).single()
    ).data!.id;
    await admin.from("shares").insert({
      sender_id: alice.id,
      recipient_id: bob.id,
      source_run_id: runId,
      tool_slug: "lesson-planner",
      title: "Alice's rivers lesson",
      input: {},
      output: body,
    });

    await signIn(page, bob);
    await page.goto("/colleagues");

    // The title is the open target. It is a button rather than the whole row,
    // because the row carries Add and Dismiss and a button cannot nest inside
    // one without swallowing their clicks.
    await page.getByRole("button", { name: /Alice's rivers lesson/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/shared by alice/i)).toBeVisible();
    // The resource body rendered as markdown, h1 and all. Level 1 explicitly:
    // the modal's own title is an h2 that also contains the word, and the
    // outline repeats every heading as a button.
    await expect(
      dialog.getByRole("heading", { name: "Rivers", level: 1, exact: true }),
    ).toBeAttached();
    // The body is there and is being rendered as markdown rather than dumped
    // as text. `first()` because the filler repeats under each heading.
    await expect(dialog.getByText(/Line 0 of the body\./).first()).toBeVisible();

    /*
     * The floating button must NOT have leaked in. It portals to document.body,
     * so if OutlineRail ever reused that presentation it would render OVER the
     * scrim it is supposed to live inside.
     */
    await expect(page.getByRole("button", { name: /jump to section/i })).toHaveCount(0);

    // Jump to the last heading, then prove the CONTAINER scrolled: the heading
    // sits near the top of the scrollport. A bare toBeVisible() would pass even
    // with the scrolling entirely broken.
    await dialog.getByRole("button", { name: "Deposition" }).click();

    await expect
      .poll(
        async () =>
          dialog.evaluate((node) => {
            const heading = node.querySelector<HTMLElement>("#deposition");
            // The scrollport is the element that actually overflows.
            const port = [...node.querySelectorAll<HTMLElement>("div")].find(
              (el) => el.scrollHeight > el.clientHeight + 20 && el.scrollTop > 0,
            );
            if (!heading || !port) return null;
            return Math.round(
              heading.getBoundingClientRect().top - port.getBoundingClientRect().top,
            );
          }),
        { timeout: 5000 },
      )
      .toBeLessThan(60);

    // Adding from inside the modal KEEPS it open: the teacher opened this to
    // read it, so closing it on save would take that away as a reward.
    await dialog.getByRole("button", { name: /add to library/i }).click();
    await expect(dialog.getByText(/in your library/i)).toBeVisible();
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The feed row has gone, because the offer has been dealt with.
    await expect(page.getByText("Alice's rivers lesson")).toBeHidden();

    /*
     * saved_run_id points at the copy. This is the assertion the whole
     * "Shared with me" view rests on: that pointer IS the membership test, so
     * if it is ever not stamped, the Library view silently holds nothing.
     */
    const { data: copies } = await admin
      .from("tool_runs")
      .select("id, output")
      .eq("user_id", bob.id);
    expect(copies).toHaveLength(1);
    expect(copies?.[0].output).toBe(body);

    const { data: share } = await admin
      .from("shares")
      .select("saved_at, saved_run_id")
      .eq("recipient_id", bob.id)
      .single();
    expect(share?.saved_run_id).toBe(copies?.[0].id);
    expect(share?.saved_at).not.toBeNull();
  });

  test("a recent row on Today still opens, and offers Share", async ({ page }) => {
    await connect(alice, bob);
    await seedResource(alice, "Alice's topic overview");

    await signIn(page, alice);
    await page.goto("/dashboard");

    // Both buttons in the row are named after the resource, which is the point
    // of this test: the open target and the Share control are siblings now
    // rather than one nested inside the other. Each is matched exactly.
    //
    // The greeting above also names the most recent resource ("Last up: ..."),
    // so a bare getByText would hit that too.
    const row = page.getByRole("button", { name: /^Alice's topic overview/ });
    await expect(row).toBeVisible();

    // The restructure risk: Share must be reachable, and must not have eaten
    // the row's own click target.
    const share = page.getByRole("button", {
      name: "Share Alice's topic overview with colleagues",
    });
    await expect(share).toBeAttached();
    await share.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // The title still navigates to the tool with this run loaded.
    await row.click();
    await expect(page).toHaveURL(/\/tools\/.*run=/);
  });

  test("the invite modal opens and does not promise credits", async ({ page }) => {
    await signIn(page, alice);
    await page.goto("/colleagues");
    await page.getByRole("button", { name: /invite a colleague/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/their email address/i)).toBeVisible();

    // The referral bonus is an open decision, so the interface must not offer
    // a number nothing pays out. See app/(app)/colleagues/InviteModal.tsx.
    await expect(dialog.getByText(/200|bonus credits/i)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a username can be set on the profile", async ({ page }) => {
    await signIn(page, alice);
    await page.goto("/profile");

    const field = page.locator("#username");
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(alice.username);

    // Capitals and spaces are corrected as they are typed, because the CHECK
    // constraint would otherwise reject what the teacher wrote.
    await field.fill("");
    await field.type("New Name");
    await expect(field).toHaveValue("newname");
  });
});
