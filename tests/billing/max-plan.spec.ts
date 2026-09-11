import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * Max plan: the surfaces a teacher sees.
 *
 * Covers the three things that were broken or missing when Max went back on
 * sale:
 *   1. A free teacher could not see Max anywhere in the app — the subscription
 *      section offered a link to /pricing, which sold only Pro.
 *   2. A Pro subscriber had no way to reach Max at all.
 *   3. The sidebar offered "Top up credits" at any balance, and the modal it
 *      opened navigated to a page whose top-up button only appears above 80%
 *      used — so anyone below that hit a dead end.
 *
 * Deliberately stops at the point money would change hands: these assert what
 * is offered and where the buttons lead, not Stripe's own checkout, which is
 * not ours to drive.
 */

test.describe("Max plan", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Morgan");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a free teacher is offered both paid plans, with derived credits", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // .first() throughout: the section renders behind a Suspense boundary keyed
    // on the tab, so mid-transition a resolving and a resolved copy can both be
    // in the DOM. See the note in the Pro subscriber test.
    await expect(page.getByText("Pro Teacher", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Max Teacher", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("£7.99").first()).toBeVisible();
    await expect(page.getByText("£14.99").first()).toBeVisible();

    // The credit figures are derived from AI_SPEND_CEILING_PENCE, not typed.
    // These are the numbers the ceiling actually grants.
    await expect(page.getByText("1,000 credits a month").first()).toBeVisible();
    await expect(page.getByText("2,500 credits a month").first()).toBeVisible();

    // Both are buyable from here, rather than linking out to /pricing.
    await expect(page.getByRole("button", { name: "Go Pro" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Choose Max" })).toBeEnabled();
  });

  test("a Pro subscriber is offered Max, and told what the switch costs", async ({ page }) => {
    // A real subscription is what distinguishes "upgrade" from "checkout": the
    // page must offer the swap, not a second subscription.
    await admin
      .from("profiles")
      .update({
        plan: "pro",
        stripe_customer_id: `cus_e2e_${teacher.id.slice(0, 8)}`,
        stripe_subscription_id: `sub_e2e_${teacher.id.slice(0, 8)}`,
        subscription_status: "active",
      })
      .eq("id", teacher.id);

    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // .first(), because the section renders behind a Suspense boundary keyed on
    // the tab: mid-transition the resolving and resolved copies of the plan card
    // both exist in the DOM, one of them hidden. Asserting on a bare getByText
    // hits strict mode and fails intermittently on timing alone.
    await expect(page.getByText("Pro Teacher", { exact: true }).first()).toBeVisible();

    const upgrade = page
      .getByRole("button", { name: /upgrade to max teacher/i })
      .first();
    await expect(upgrade).toBeVisible();

    // Confirming first is the point: this is the only button on the page that
    // charges a card with no further prompt.
    await upgrade.click();
    await expect(page.getByText(/switch to max teacher/i).first()).toBeVisible();
    await expect(page.getByText(/2,500/).first()).toBeVisible();
    await expect(
      page.getByText(/only be charged the difference/i).first(),
    ).toBeVisible();

    // A subscriber is NOT shown the buy-from-scratch cards; that would let them
    // start a second subscription alongside the one they have.
    await expect(page.getByRole("button", { name: "Go Pro" })).toHaveCount(0);
  });

  test("the sidebar offers a top up only when credits are low", async ({ page }) => {
    await admin.from("profiles").update({ plan: "pro" }).eq("id", teacher.id);

    await signIn(page, teacher);
    await page.goto("/dashboard");

    const nav = page.locator("#app-sidenav-v2");
    const meter = nav.locator('[class*="meterVal"]').filter({ hasText: /left/ });

    // The meter is always shown on a metered plan.
    await expect(meter.first()).toBeVisible();

    // A brand new Pro teacher has spent nothing, so the button must be absent:
    // it used to render at every balance, which is a nag rather than an offer.
    await expect(nav.getByRole("button", { name: /top up credits/i })).toHaveCount(0);
  });
});
