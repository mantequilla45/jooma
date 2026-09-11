import { test, expect } from "@playwright/test";
import { TOTAL_BADGES, levelForEarned } from "@/app/lib/badges";
import {
  admin,
  asTeacher,
  createTeacher,
  deleteTeacher,
  grantBadges,
  seedResource,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Badges: who can grant them, and what the profile then shows.
 *
 * THE SHAPE OF THIS FEATURE, and why the first block matters most
 *
 * user_badges carries a SELECT policy and nothing else. There is no insert,
 * update or delete policy at all, which means a teacher can read their own
 * badges and can never write one. Every grant goes through claim_badges(), a
 * SECURITY DEFINER function that re-checks the criteria server side before it
 * inserts anything.
 *
 * That arrangement is the whole feature. A badge a teacher can award themselves
 * is not an achievement, and the levels, the sidebar and the colleague stats all
 * read from this table. So the tests below run through the ANON key as the
 * teacher, exactly as a browser does. Asserting any of this through the service
 * role would prove nothing, because the service role bypasses RLS and would pass
 * no matter how wrong the policies were.
 *
 * The arithmetic that turns a count into a level is pure and lives in
 * tests/unit/badge-levels.spec.ts. Only what needs a database or a page is here.
 */

test.describe("Who can grant a badge", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Bea");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a teacher cannot write their own badges", async () => {
    const supabase = await asTeacher(teacher);

    // Insert: no policy, so this is refused rather than silently ignored.
    const insert = await supabase
      .from("user_badges")
      .insert({ user_id: teacher.id, badge_id: "legend" });
    expect(insert.error).not.toBeNull();

    // And nothing arrived.
    const { data } = await supabase.from("user_badges").select("badge_id");
    expect(data ?? []).toHaveLength(0);
  });

  test("a teacher cannot delete a badge to re-earn it, nor edit when it was earned", async () => {
    await grantBadges(teacher, ["first-resource"]);
    const supabase = await asTeacher(teacher);

    // They can SEE it. That policy exists.
    const { data: mine } = await supabase.from("user_badges").select("badge_id");
    expect(mine).toHaveLength(1);

    // Update and delete both have no policy, so both are no-ops that change
    // nothing. PostgREST reports success with zero rows affected rather than an
    // error, so the assertion that matters is that the row survived.
    await supabase.from("user_badges").update({ badge_id: "legend" }).eq("user_id", teacher.id);
    await supabase.from("user_badges").delete().eq("user_id", teacher.id);

    const { data: after } = await supabase.from("user_badges").select("badge_id");
    expect(after).toHaveLength(1);
    expect(after![0]!.badge_id).toBe("first-resource");
  });
});

test.describe("claim_badges, the only door in", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Bea");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("refuses a counted badge that has not been earned, and grants it once it has", async () => {
    const supabase = await asTeacher(teacher);

    /*
     * ten-resources, not first-resource, and the difference is the point.
     *
     * badge_gate_ok() only re-checks the badges that have a cheap SQL proxy:
     * run counts, distinct tools, distinct days. Everything else falls through
     * its `else true`, deliberately, because there is no way to verify "wrote a
     * report on a Sunday" from a single count. So first-resource is granted for
     * the asking and proves nothing about the gate.
     *
     * ten-resources is counted, so it is the honest test of whether the server
     * re-checks at all.
     */
    const before = await supabase.rpc("claim_badges", { candidate_ids: ["ten-resources"] });
    expect(before.error).toBeNull();
    expect(before.data ?? []).toHaveLength(0);

    for (let i = 0; i < 10; i++) await seedResource(teacher, `Resource ${i}`);

    const earned = await supabase.rpc("claim_badges", { candidate_ids: ["ten-resources"] });
    expect(earned.error).toBeNull();
    expect(earned.data).toEqual(["ten-resources"]);

    // THE PROPERTY: asking twice returns nothing the second time. It inserts on
    // conflict do nothing and returns only what it actually granted, which is
    // what stops the "you earned a badge" toast firing on every page load for
    // the rest of the teacher's life.
    const again = await supabase.rpc("claim_badges", { candidate_ids: ["ten-resources"] });
    expect(again.error).toBeNull();
    expect(again.data ?? []).toHaveLength(0);
  });

  test("ignores a badge id that does not exist", async () => {
    const supabase = await asTeacher(teacher);

    const { data, error } = await supabase.rpc("claim_badges", {
      candidate_ids: ["not-a-real-badge", "../../etc/passwd"],
    });

    // Filtered against the known ids whitelist rather than trusted, so an
    // invented id is dropped rather than stored and later rendered as a blank
    // medallion nobody can explain.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  test("refuses an oversized claim rather than working through it", async () => {
    const supabase = await asTeacher(teacher);

    const { error } = await supabase.rpc("claim_badges", {
      candidate_ids: Array.from({ length: 101 }, (_, i) => `badge-${i}`),
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("too many badges claimed at once");
  });
});

test.describe("What the profile shows", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Bea");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a teacher with none sees an invitation, not a zero", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/profile?section=badges");

    await expect(page.getByRole("heading", { name: "Badges" })).toBeVisible();

    // "Not yet" and "None yet" rather than "0 of 82". A zero score on a page
    // about your own progress reads as a mark out of ten.
    const stats = page.locator("dl").first();
    await expect(stats).toContainText("Not yet");
    await expect(page.getByText("0 of", { exact: false })).toHaveCount(0);
  });

  test("the count on the page agrees with the badges in the table", async ({ page }) => {
    await grantBadges(teacher, ["first-resource", "first-slides", "three-tools"]);

    await signIn(page, teacher);
    await page.goto("/profile?section=badges");

    /*
     * THE PAGE AWARDS BADGES AS IT LOADS, which is why the count is read back
     * from the database rather than assumed to be the three just seeded.
     *
     * useBadgeProgress evaluates the whole catalogue against the teacher's
     * history on mount and claims anything newly earned, so simply opening this
     * page can grant a badge that needs no history at all. Hardcoding "3 of" is
     * therefore a test that passes today and fails the moment somebody adds a
     * badge a brand new account already qualifies for.
     */
    // Wait for the page to have settled, so any claim it was going to make has
    // been made before the count is read.
    await expect(page.getByRole("heading", { name: "Badges" })).toBeVisible();
    await expect(page.getByText("Counting them up.")).toHaveCount(0);

    const { data: rows } = await admin
      .from("user_badges")
      .select("badge_id")
      .eq("user_id", teacher.id);
    const count = (rows ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);

    /*
     * TOTAL_BADGES, the whole catalogue, in BOTH places.
     *
     * Worth stating because the codebase holds a second, smaller total:
     * EARNABLE_TOTAL excludes the badges marked pending. That one drives the
     * LEVEL arithmetic, so a teacher is never scored against badges nobody can
     * get yet, but neither of these two surfaces uses it. They are describing
     * the collection rather than marking the teacher, so they count all of it.
     * Asserting both together is what would catch one drifting onto the other.
     */
    await expect(
      page.getByText(`${count} of ${TOTAL_BADGES} collected across 10 levels.`),
    ).toBeVisible({ timeout: 30_000 });

    const stats = page.locator("dl").first();
    await expect(stats).toContainText(`${count} of ${TOTAL_BADGES}`);
    // The level divides by EARNABLE_TOTAL rather than by the denominator shown
    // above, so it is derived here rather than written out.
    await expect(stats).toContainText(`Level ${levelForEarned(count)}`);
  });

  test("an earned badge says when, and an unearned one does not", async ({ page }) => {
    // A fixed date, so the rendered label cannot drift with the clock.
    await grantBadges(teacher, ["first-resource"], "2026-03-14T10:00:00Z");

    await signIn(page, teacher);
    await page.goto("/profile?section=badges");

    // en-GB, day then month, matching the format in BadgesSection. The date is
    // seeded rather than "now", so this label cannot drift with the clock.
    await expect(page.getByText("Earned 14 March")).toBeVisible({ timeout: 30_000 });

    /*
     * The catalogue always renders in full, so an unearned badge is on the page
     * carrying no date. Asserted on a specific locked badge rather than by
     * counting "Earned" across the page: opening this page can itself grant a
     * badge, so any exact count of earned labels is a race with the claim the
     * page just made.
     */
    const legend = page.locator("li").filter({ hasText: "Staffroom legend" }).first();
    await expect(legend).toBeVisible();
    await expect(legend).not.toContainText("Earned");
  });
});
