import { test, expect } from "@playwright/test";
import {
  admin,
  createAdmin,
  createTeacher,
  deleteTeacher,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Ambassadors: who brought a teacher in, and who is owed for it.
 *
 * THE RULE THESE TESTS EXIST TO PROTECT
 *
 * A referral is payable only once money has actually arrived. Two things look
 * like a paying subscriber and are not:
 *
 *   - a teacher who used a code and stayed on FREE. Tracked deliberately, since
 *     the point of recording free redemptions is that they convert later, but
 *     never payable.
 *   - a teacher an admin COMPED onto Pro. plan reads 'pro' and
 *     subscription_status reads 'active', but no payment was ever taken.
 *     `stripe_subscription_id IS NULL` is the discriminator, exactly as
 *     teacher_mrr() uses it.
 *
 * Both must show N/A and offer no way to pay out. That is the assertion that
 * stops this feature inventing debts.
 *
 * The security half of this (RLS, the RPC guards, forged referrals) is checked
 * one layer down in scripts/verify-ambassadors.mjs, which asserts through the
 * anon key rather than a browser.
 */

const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface Fixture {
  ambassadorId: string;
  codeId: string;
  code: string;
  name: string;
}

/** An ambassador with one code, written the way the admin route writes them. */
async function createAmbassador(): Promise<Fixture> {
  const t = tag();
  const name = `ZZ Amb ${t}`;
  const code = `ZZAMB${t}`.toUpperCase();

  const { data: ambassador, error } = await admin
    .from("ambassadors")
    .insert({ full_name: name, email: `zz-${t}@example.com` })
    .select()
    .single();
  if (error) throw new Error(`Could not create the ambassador: ${error.message}`);

  const { data: codeRow, error: codeError } = await admin
    .from("ambassador_codes")
    .insert({ ambassador_id: ambassador.id, promotion_code_id: `promo_zz${t}`, code })
    .select()
    .single();
  if (codeError) throw new Error(`Could not create the code: ${codeError.message}`);

  return { ambassadorId: ambassador.id, codeId: codeRow.id, code, name };
}

/**
 * Attribute a teacher to an ambassador.
 *
 * `paid` simulates what the Stripe webhook writes on invoice.paid. Left false,
 * the row is exactly what a free signup looks like.
 */
async function seedReferral(
  fixture: Fixture,
  teacher: TestTeacher,
  paid: "free" | "pro" | "max" = "free",
): Promise<string> {
  const { data, error } = await admin
    .from("ambassador_referrals")
    .insert({
      ambassador_id: fixture.ambassadorId,
      code_id: fixture.codeId,
      user_id: teacher.id,
      ...(paid === "free"
        ? {}
        : {
            first_paid_at: new Date().toISOString(),
            first_paid_plan: paid,
            payout_status: "unpaid",
          }),
    })
    .select()
    .single();
  if (error) throw new Error(`Could not seed the referral: ${error.message}`);
  return data.id as string;
}

async function deleteAmbassador(fixture: Fixture | null) {
  if (!fixture) return;
  // Codes and referrals cascade from the ambassador.
  await admin.from("ambassadors").delete().eq("id", fixture.ambassadorId);
}

test.describe("Ambassadors", () => {
  let adminUser: TestTeacher;
  let fixture: Fixture | null = null;
  const people: TestTeacher[] = [];

  test.beforeEach(async () => {
    adminUser = await createAdmin("Avery");
  });

  test.afterEach(async () => {
    await deleteAmbassador(fixture);
    fixture = null;
    for (const p of people.splice(0)) await deleteTeacher(p);
    await deleteTeacher(adminUser);
  });

  test("a teacher cannot reach the page at all", async ({ page }) => {
    const teacher = await createTeacher("Blake");
    people.push(teacher);

    await signIn(page, teacher);
    await page.goto("/admin/ambassadors");

    // requireAdmin() redirects rather than rendering an error, so the proof is
    // where they end up.
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("an ambassador and their referrals appear, with free tracked but unpayable", async ({
    page,
  }) => {
    fixture = await createAmbassador();

    const freeTeacher = await createTeacher("Casey");
    const payingTeacher = await createTeacher("Devon");
    people.push(freeTeacher, payingTeacher);

    await seedReferral(fixture, freeTeacher, "free");
    await seedReferral(fixture, payingTeacher, "pro");

    await signIn(page, adminUser);
    await page.goto("/admin/ambassadors");

    const row = page.getByText(fixture.name);
    await expect(row).toBeVisible();
    await expect(page.getByText(fixture.code).first()).toBeVisible();

    // Open the dropdown of teachers underneath.
    await row.click();

    await expect(page.getByText(freeTeacher.email)).toBeVisible();
    await expect(page.getByText(payingTeacher.email)).toBeVisible();

    // The columns the feature was asked for.
    await expect(page.getByRole("columnheader", { name: "First subscribed month" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Payout" })).toBeVisible();

    // THE RULE. The free teacher is present and explicitly not payable: no
    // button anywhere on their row, only N/A.
    //
    // Scoped with `.last()`, because the expanded subscriber table is nested
    // INSIDE the ambassador's own row: an unscoped getByRole("row") match on a
    // teacher's email also matches the outer row that contains it, and would
    // pick up the other teachers' buttons.
    const freeRow = page.getByRole("row").filter({ hasText: freeTeacher.email }).last();
    await expect(freeRow.getByText("N/A")).toBeVisible();
    await expect(freeRow.getByText("Not subscribed")).toBeVisible();
    await expect(freeRow.getByRole("button")).toHaveCount(0);

    // The paying one is owed, and can be settled.
    const payingRow = page.getByRole("row").filter({ hasText: payingTeacher.email }).last();
    await expect(payingRow.getByText("Unpaid")).toBeVisible();
    await expect(payingRow.getByRole("button", { name: "Mark paid" })).toBeVisible();
  });

  test("a comped teacher is never payable", async ({ page }) => {
    fixture = await createAmbassador();

    const comped = await createTeacher("Ellis");
    people.push(comped);

    // Referred, then comped onto Pro by an admin: plan and status both say a
    // paying subscriber, and no money ever moved. This is the case that would
    // quietly invent a debt if the payout rule read `plan` instead of payment.
    await seedReferral(fixture, comped, "free");
    await admin
      .from("profiles")
      .update({ plan: "pro", subscription_status: "active", stripe_subscription_id: null })
      .eq("id", comped.id);

    await signIn(page, adminUser);
    await page.goto("/admin/ambassadors");
    await page.getByText(fixture.name).click();

    const row = page.getByRole("row").filter({ hasText: comped.email }).last();
    // Shows Pro, because that is genuinely their plan...
    await expect(row.getByText("Pro")).toBeVisible();
    // ...but is not payable, because nothing was ever charged.
    await expect(row.getByText("N/A")).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("marking a payout paid sticks", async ({ page }) => {
    fixture = await createAmbassador();

    const subscriber = await createTeacher("Frankie");
    people.push(subscriber);
    const referralId = await seedReferral(fixture, subscriber, "max");

    await signIn(page, adminUser);
    await page.goto("/admin/ambassadors");
    await page.getByText(fixture.name).click();

    const row = page.getByRole("row").filter({ hasText: subscriber.email }).last();
    await row.getByRole("button", { name: "Mark paid" }).click();

    await expect(row.getByText(/^Paid/)).toBeVisible();

    // Recorded, not just repainted.
    const { data } = await admin
      .from("ambassador_referrals")
      .select("payout_status, payout_at")
      .eq("id", referralId)
      .single();
    expect(data?.payout_status).toBe("paid");
    expect(data?.payout_at).not.toBeNull();

    // And it survives a reload.
    await page.reload();
    await page.getByText(fixture.name).click();
    await expect(
      page.getByRole("row").filter({ hasText: subscriber.email }).last().getByText(/^Paid/),
    ).toBeVisible();
  });

  test("the header counts only pay for teachers who actually paid", async ({ page }) => {
    fixture = await createAmbassador();

    const free1 = await createTeacher("Gray");
    const free2 = await createTeacher("Harper");
    const paying = await createTeacher("Indigo");
    people.push(free1, free2, paying);

    await seedReferral(fixture, free1, "free");
    await seedReferral(fixture, free2, "free");
    await seedReferral(fixture, paying, "pro");

    await signIn(page, adminUser);
    await page.goto("/admin/ambassadors");

    // Three referred, one subscriber, one payout owed. Asserted on the cells in
    // order rather than by searching for loose digits, which would match any
    // column that happened to hold the same number.
    const cells = page.getByRole("row").filter({ hasText: fixture.name }).getByRole("cell");
    await expect(cells.nth(3)).toHaveText("3"); // Referred
    await expect(cells.nth(4)).toHaveText("1"); // Subscribed
    await expect(cells.nth(5)).toHaveText("1"); // Owed
    await expect(cells.nth(6)).toHaveText("0"); // Paid

    // If "Subscribed" ever starts counting free redemptions, that middle
    // assertion is what catches it.
  });
});
