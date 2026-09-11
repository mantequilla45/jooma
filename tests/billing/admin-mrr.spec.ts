import { test, expect } from "@playwright/test";
import {
  createAdmin,
  createTeacher,
  deleteTeacher,
  setPlan,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Does MRR report money that is actually arriving?
 *
 * It used to be count(plan <> 'free') x plan_config.price_monthly, which reads
 * no Stripe state at all. Three ways that overstated, all measured rather than
 * imagined:
 *
 *   1. Comps. An admin granting Pro writes plan='pro' and fakes
 *      subscription_status='active' with no card on file. On production, 1 of
 *      the 3 Pro profiles was one of these, counted at a full GBP 7.99.
 *   2. Cancellations. A teacher who has cancelled keeps the plan and the status
 *      until the period ends. On production BOTH live subscriptions were in
 *      this state.
 *   3. Discounts. The two live subscribers list at GBP 7.99 and are billed
 *      GBP 0.08 and GBP 0.80.
 *
 * 1 and 2 are answerable from our own columns and are what these tests cover.
 * 3 needs Stripe, and its arithmetic is unit tested in isolation because a live
 * total cannot be asserted against a fixture.
 *
 * `stripe_subscription_id IS NULL` is the discriminator for a comp. Not
 * subscription_status, which a comp sets to 'active' by hand.
 */

/** Read the one row admin_dashboard() returns, as the admin. */
async function dashboard(teacher: TestTeacher) {
  // Through a real session, not the service role: the RPC is security definer
  // and gated on is_admin(), so calling it as the service role would skip the
  // very check that matters.
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: signInError } = await sb.auth.signInWithPassword({
    email: teacher.email,
    password: teacher.password,
  });
  if (signInError) throw new Error(`Could not sign in: ${signInError.message}`);

  const { data, error } = await sb.rpc("admin_dashboard");
  if (error) throw new Error(`admin_dashboard failed: ${error.message}`);
  return (data as Record<string, number>[])[0];
}

test.describe("Admin MRR", () => {
  let adminUser: TestTeacher;
  const people: TestTeacher[] = [];

  test.beforeEach(async () => {
    adminUser = await createAdmin("Ash");
  });

  test.afterEach(async () => {
    for (const p of people.splice(0)) await deleteTeacher(p);
    await deleteTeacher(adminUser);
  });

  test("comps and cancellations are excluded, and reported separately", async () => {
    const before = await dashboard(adminUser);

    const paying = await createTeacher("Pia");
    const comped = await createTeacher("Cass");
    const ending = await createTeacher("Enid");
    people.push(paying, comped, ending);

    await setPlan(paying, "pro", "paying");
    await setPlan(comped, "pro", "comped");
    await setPlan(ending, "pro", "ending");

    const after = await dashboard(adminUser);

    // Deltas rather than absolutes: staging carries real accounts, and a test
    // that asserted a total would break the next time somebody subscribes.
    const d = (key: string) => Number(after[key] ?? 0) - Number(before[key] ?? 0);

    expect(d("b2c_mrr_gbp"), "only the genuinely paying teacher counts").toBeCloseTo(7.99, 2);
    expect(d("paying_teachers"), "comped and cancelling must not count as paying").toBe(1);

    expect(d("comped_mrr_gbp"), "the comp is not reported").toBeCloseTo(7.99, 2);
    expect(d("comped_teachers")).toBe(1);

    expect(d("ending_mrr_gbp"), "the cancellation is not reported").toBeCloseTo(7.99, 2);
    expect(d("ending_teachers")).toBe(1);
  });

  test("an admin on a paid plan is not counted as revenue", async () => {
    const before = await dashboard(adminUser);

    // The admin themselves, on Max with a real subscription. Nobody is paying
    // us for this; it is a staff account.
    await setPlan(adminUser, "max", "paying");

    const after = await dashboard(adminUser);
    expect(
      Number(after.b2c_mrr_gbp) - Number(before.b2c_mrr_gbp),
      "an admin account inflated MRR",
    ).toBeCloseTo(0, 2);
  });

  test("the dashboard and the usage page agree", async () => {
    const paying = await createTeacher("Pat");
    people.push(paying);
    await setPlan(paying, "pro", "paying");

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.auth.signInWithPassword({ email: adminUser.email, password: adminUser.password });

    const [{ data: dash }, { data: usage }] = await Promise.all([
      sb.rpc("admin_dashboard"),
      sb.rpc("admin_usage_summary"),
    ]);

    const dashMrr = Number((dash as Record<string, number>[])[0].mrr_gbp);
    const usageMrr = Number((usage as Record<string, number>[])[0].mrr_gbp);

    // These two carried copies of the same query and would otherwise drift the
    // moment one was fixed. They now share teacher_mrr().
    expect(usageMrr, "the two admin pages disagree about MRR").toBeCloseTo(dashMrr, 2);
  });

  /*
   * The check that was missing, and that let a wrong number ship.
   *
   * The SQL half and the Stripe half were each verified in isolation and both
   * were right about their own population — but they counted DIFFERENT
   * populations, so the dashboard showed GBP 46.95 beside "1 paying teacher".
   * Staging's Stripe account has five active subscriptions: two staff, one
   * cancelling, one orphaned, and one teacher holding two.
   *
   * teacher_mrr() now names the subscriptions the live total may include, so
   * this asserts the two halves cannot describe different people again.
   */
  test("the live total covers exactly the teachers counted as paying", async () => {
    const paying = await createTeacher("Prue");
    const comped = await createTeacher("Colm");
    const ending = await createTeacher("Elle");
    people.push(paying, comped, ending);

    await setPlan(paying, "pro", "paying");
    await setPlan(comped, "pro", "comped");
    await setPlan(ending, "pro", "ending");

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.auth.signInWithPassword({ email: adminUser.email, password: adminUser.password });

    const { data, error } = await sb.rpc("teacher_mrr");
    expect(error, error?.message).toBeNull();

    const row = (data as { paying_count: number; paying_sub_ids: string[] }[])[0];
    const ids = row.paying_sub_ids ?? [];

    // One id per paying teacher, and the comped and cancelling ones are not in
    // it. Without this the Stripe side has nothing to scope by and falls back
    // to summing the whole account.
    expect(ids.length, "the paying set does not match the paying count").toBe(
      Number(row.paying_count),
    );
    expect(ids).toContain(`sub_e2e_${paying.id.slice(0, 8)}`);
    expect(ids, "a cancelling teacher is in the live total").not.toContain(
      `sub_e2e_${ending.id.slice(0, 8)}`,
    );
    // A comp has no subscription at all, so there is nothing to exclude, but
    // assert the count rather than trusting that.
    expect(ids.every((id) => id.startsWith("sub_"))).toBe(true);
  });

  test("an admin's own subscription is not in the live total", async () => {
    await setPlan(adminUser, "max", "paying");

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.auth.signInWithPassword({ email: adminUser.email, password: adminUser.password });

    const { data } = await sb.rpc("teacher_mrr");
    const ids = (data as { paying_sub_ids: string[] }[])[0].paying_sub_ids ?? [];

    // Staff accounts are the largest single distortion on staging: two of the
    // five active subscriptions there are ours.
    expect(ids, "a staff subscription would be counted as revenue").not.toContain(
      `sub_e2e_${adminUser.id.slice(0, 8)}`,
    );
  });

  test("teacher_mrr is not readable by an ordinary teacher", async () => {
    const nosy = await createTeacher("Nosy");
    people.push(nosy);

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.auth.signInWithPassword({ email: nosy.email, password: nosy.password });

    // The dashboard page calls this RPC directly now, which put it within reach
    // of any signed-in account through PostgREST. It is security definer and
    // returns company revenue plus live Stripe subscription ids, so it has to
    // refuse.
    const { data, error } = await sb.rpc("teacher_mrr");
    expect(error, "a teacher could read company revenue").not.toBeNull();
    expect(data).toBeNull();
  });

  test("the dashboard shows comped and cancelling next to MRR", async ({ page }) => {
    const comped = await createTeacher("Coral");
    people.push(comped);
    await setPlan(comped, "pro", "comped");

    await signIn(page, adminUser);
    await page.goto("/admin");

    // The figures are surfaced, not silently dropped: an admin should be able
    // to see what is being given away.
    await expect(page.getByText(/^comped$/i)).toBeVisible();
    await expect(page.getByText(/^cancelling$/i)).toBeVisible();
    await expect(page.getByText(/at list price/i)).toBeVisible();
  });
});
