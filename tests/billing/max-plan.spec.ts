import { test, expect } from "@playwright/test";
import {
  admin,
  createTeacher,
  deleteTeacher,
  setPlan,
  signIn,
  type TestTeacher,
} from "../support/users";

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
    //
    // The cards carry the SHORT name ("Pro"), not PLANS[].name ("Pro Teacher").
    // The long form is right for an admin console and reads as a mouthful on a
    // pricing card, which is what planCardName exists to separate.
    await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Max", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("£7.99").first()).toBeVisible();
    await expect(page.getByText("£14.99").first()).toBeVisible();

    // Free is offered too, and marked as the plan they are on — moving down is
    // a plan change like any other and needs somewhere to live.
    await expect(page.getByText("£0", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /your plan/i }).first()).toBeVisible();

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

    // Every plan move is now offered from its own card, in one consistent
    // shape: the card says where you would go, the panel below says what it
    // means. So this is "Switch to Max", not "Upgrade to Max Teacher".
    const upgrade = page.getByRole("button", { name: /^switch to max$/i }).first();
    await expect(upgrade).toBeVisible();

    // Confirming first is the point: this is the only button on the page that
    // charges a card with no further prompt.
    await upgrade.click();
    await expect(page.getByText(/switch to max teacher/i).first()).toBeVisible();
    await expect(page.getByText(/2,500/).first()).toBeVisible();
    await expect(
      page.getByText(/only be charged the difference/i).first(),
    ).toBeVisible();

    // A subscriber sees every plan card, but NOT the buy-from-scratch buttons:
    // those run Checkout, which would start a second subscription alongside the
    // one they have. The swap buttons take their place.
    await expect(page.getByRole("button", { name: "Go Pro" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose Max" })).toHaveCount(0);
  });

  test("a Max subscriber is offered Pro, and shown what they would lose", async ({ page }) => {
    await setPlan(teacher, "max", "paying");

    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // The card carries the short name; the confirmation panel below uses the
    // full one, which is why this is anchored rather than a loose match.
    const downgrade = page.getByRole("button", { name: /^switch to pro$/i }).first();
    await expect(downgrade).toBeVisible();

    await downgrade.click();

    // The retention beat: what they give up, derived from PLANS[].limits rather
    // than written out, so it cannot claim a loss that is not real.
    await expect(page.getByText(/what you.d miss out on/i).first()).toBeVisible();
    // 2,500 down to 1,000 is 1,500 fewer.
    await expect(page.getByText(/1,500 fewer credits/i).first()).toBeVisible();

    // And the reassuring half: nothing is lost from the month already paid for.
    await expect(
      page.getByText(/keep max teacher until your next renewal/i).first(),
    ).toBeVisible();

    // The prominent button is the reversible one.
    await expect(
      page.getByRole("button", { name: /stay on max teacher/i }).first(),
    ).toBeVisible();
  });

  test("backing out of a downgrade changes nothing", async ({ page }) => {
    await setPlan(teacher, "max", "paying");

    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    await page.getByRole("button", { name: /^switch to pro$/i }).first().click();
    await expect(page.getByText(/what you.d miss out on/i).first()).toBeVisible();

    // "Stay on Max" must close the panel without calling the API — a retention
    // path that still downgraded would be worse than having none.
    let called = false;
    await page.route("**/api/stripe/downgrade", (route) => {
      called = true;
      return route.abort();
    });

    await page.getByRole("button", { name: /stay on max teacher/i }).first().click();

    await expect(page.getByText(/what you.d miss out on/i)).toHaveCount(0);
    expect(called).toBe(false);
  });

  test("a Pro subscriber can drop to Free, but has no paid plan below", async ({ page }) => {
    await setPlan(teacher, "pro", "paying");

    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // Pro's only step down is Free, so there is no "switch to <paid plan>"
    // offer — nextPlanDown("pro") is null and the Free card carries the exit.
    const toFree = page.getByRole("button", { name: /^switch to free$/i }).first();
    await expect(toFree).toBeVisible();

    await toFree.click();

    // Dropping to Free costs far more than dropping a tier, and the panel says
    // so before they reach Stripe's own confirmation screen.
    await expect(page.getByText(/what you.d miss out on/i).first()).toBeVisible();
    await expect(page.getByText(/watermark/i).first()).toBeVisible();
  });

  test("a subscription that is ending offers renewal, not a plan change", async ({ page }) => {
    await setPlan(teacher, "max", "ending");

    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // Renew comes first: swapping a plan that is scheduled to stop would charge
    // for something about to disappear.
    await expect(page.getByText(/set to end/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^switch to pro$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^switch to free$/i })).toHaveCount(0);
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
