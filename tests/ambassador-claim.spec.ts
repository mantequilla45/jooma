import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "./support/users";

/*
 * Claiming a code, from the teacher's side.
 *
 * THE CASE THIS FEATURE LIVES OR DIES ON is the delayed subscriber: somebody
 * takes a code, chooses Free, and subscribes days or weeks later. Attribution
 * has to survive that gap, because the whole reason for tracking free
 * redemptions is that they convert later.
 *
 * It does survive, and by construction rather than by luck: the claim is written
 * to our own database the moment it is entered, and checkout resolves it from
 * there rather than from a session, a cookie or a URL. Nothing has to be
 * remembered or retyped. These tests hold that behaviour in place.
 *
 * What is NOT asserted here is the Stripe discount itself. Driving Stripe's
 * hosted checkout from a test would be testing Stripe; what matters on our side
 * is that the referral is found and handed over, which is checked directly.
 */

const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface Fixture {
  ambassadorId: string;
  codeId: string;
  code: string;
  name: string;
}

async function createAmbassador(): Promise<Fixture> {
  const t = tag();
  const name = `ZZ Claim ${t}`;
  const code = `ZZCLAIM${t}`.toUpperCase();

  const { data: ambassador, error } = await admin
    .from("ambassadors")
    .insert({ full_name: name, email: `zz-claim-${t}@example.com` })
    .select()
    .single();
  if (error) throw new Error(`Could not create the ambassador: ${error.message}`);

  const { data: codeRow, error: codeError } = await admin
    .from("ambassador_codes")
    .insert({ ambassador_id: ambassador.id, promotion_code_id: `promo_zzc${t}`, code })
    .select()
    .single();
  if (codeError) throw new Error(`Could not create the code: ${codeError.message}`);

  return { ambassadorId: ambassador.id, codeId: codeRow.id, code, name };
}

/** The referral row for a teacher, or null. */
async function referralFor(teacher: TestTeacher) {
  const { data } = await admin
    .from("ambassador_referrals")
    .select("ambassador_id, first_paid_at, payout_status")
    .eq("user_id", teacher.id)
    .maybeSingle();
  return data;
}

test.describe("Claiming an ambassador code", () => {
  let fixture: Fixture | null = null;
  let second: Fixture | null = null;
  const people: TestTeacher[] = [];

  test.afterEach(async () => {
    for (const f of [fixture, second]) {
      if (f) await admin.from("ambassadors").delete().eq("id", f.ambassadorId);
    }
    fixture = null;
    second = null;
    for (const p of people.splice(0)) await deleteTeacher(p);
  });

  test("a teacher applies a code on the welcome screen", async ({ page }) => {
    fixture = await createAmbassador();
    const teacher = await createTeacher("Juno");
    people.push(teacher);

    await signIn(page, teacher);
    await page.goto("/welcome");

    // Collapsed by default, so the screen still opens on the tools for the
    // majority who have no code.
    await page.getByRole("button", { name: /got a code/i }).click();

    const input = page.getByLabel("Your code");
    await input.fill(fixture.code);
    // Fill then assert, so a hydration landing mid-type cannot swallow it.
    await expect(input).toHaveValue(fixture.code);

    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(new RegExp(`${fixture.code} applied`, "i"))).toBeVisible();

    // Choosing Free still records the referral: tracked, just not payable.
    await page.getByRole("button", { name: /start free/i }).click();
    await page.waitForURL(/\/tools/);

    const referral = await referralFor(teacher);
    expect(referral?.ambassador_id).toBe(fixture.ambassadorId);
    expect(referral?.first_paid_at).toBeNull();
    expect(referral?.payout_status).toBe("na");
  });

  test("a code in the signup link survives to the welcome screen", async ({ page }) => {
    fixture = await createAmbassador();
    const teacher = await createTeacher("Kai");
    people.push(teacher);

    // STEP 1, signed OUT, as a genuinely new teacher arrives: /signup?code=
    // stashes the code for the rest of the funnel. Signing in first would prove
    // nothing here, because proxy.ts bounces a signed-in visitor off /signup
    // before the page can mount.
    await page.goto(`/signup?code=${fixture.code}`);
    // Wait for the form to be interactive, which is proof the client component
    // has mounted and therefore that its stash effect has run.
    await expect(page.getByLabel("Email")).toBeVisible();

    // Polled, not read once: the stash is written by an effect, so a single
    // evaluate can land in the gap between the form painting and React
    // hydrating. expect.poll retries until it appears.
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("jooma:ambassador-code")))
      .toBe(fixture.code);

    // STEP 2: /complete-profile forwards that stash into the welcome URL, and
    // the panel arrives open and prefilled. It has to travel in the URL rather
    // than be read from sessionStorage on arrival: /welcome is server rendered,
    // so a value only the client can see is discarded during hydration and the
    // box would open empty.
    await signIn(page, teacher);
    await page.goto(`/welcome?code=${fixture.code}`);
    await expect(page.getByLabel("Your code")).toHaveValue(fixture.code);
  });

  test("an unknown code is refused and nothing is attributed", async ({ page }) => {
    const teacher = await createTeacher("Lior");
    people.push(teacher);

    await signIn(page, teacher);
    await page.goto("/welcome");
    await page.getByRole("button", { name: /got a code/i }).click();

    await page.getByLabel("Your code").fill(`NOSUCH${tag()}`.toUpperCase());
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByText(/not recognised/i)).toBeVisible();
    expect(await referralFor(teacher)).toBeNull();
  });

  test("a second code never moves attribution", async ({ page }) => {
    fixture = await createAmbassador();
    second = await createAmbassador();
    const teacher = await createTeacher("Manon");
    people.push(teacher);

    await signIn(page, teacher);
    await page.goto("/welcome");
    await page.getByRole("button", { name: /got a code/i }).click();

    await page.getByLabel("Your code").fill(fixture.code);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(new RegExp(`${fixture.code} applied`, "i"))).toBeVisible();
    await page.getByRole("button", { name: /start free/i }).click();
    await page.waitForURL(/\/tools/);

    expect((await referralFor(teacher))?.ambassador_id).toBe(fixture.ambassadorId);

    // Now try the other ambassador's code from the pricing page.
    await page.goto("/pricing");
    await page.getByLabel("Promo code").fill(second.code);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/already used a code/i)).toBeVisible();

    // Still the first ambassador. Attribution is first-code-wins and permanent.
    expect((await referralFor(teacher))?.ambassador_id).toBe(fixture.ambassadorId);
  });

  test("THE DELAYED SUBSCRIBER: a claim taken on Free is still waiting at checkout", async ({
    page,
  }) => {
    fixture = await createAmbassador();
    const teacher = await createTeacher("Noor");
    people.push(teacher);

    // Day one: takes the code, picks Free.
    await signIn(page, teacher);
    await page.goto("/welcome");
    await page.getByRole("button", { name: /got a code/i }).click();
    await page.getByLabel("Your code").fill(fixture.code);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(new RegExp(`${fixture.code} applied`, "i"))).toBeVisible();
    await page.getByRole("button", { name: /start free/i }).click();
    await page.waitForURL(/\/tools/);

    // Some time later, in a completely fresh browser context: no sessionStorage,
    // no cookie carrying the code, nothing remembered. If attribution lived
    // anywhere but the database, it would be gone by now.
    await page.context().clearCookies();
    await page.goto("/");
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    await signIn(page, teacher);

    // The claim is still theirs, unspent, and still points at the ambassador.
    const referral = await referralFor(teacher);
    expect(referral?.ambassador_id).toBe(fixture.ambassadorId);
    expect(referral?.first_paid_at).toBeNull();

    // And the pricing page no longer offers an input, because they already hold
    // a code: checkout will resolve it server-side without anything retyped.
    await page.goto("/pricing");
    await page.getByLabel("Promo code").fill(fixture.code);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/already used a code/i)).toBeVisible();
  });
});
