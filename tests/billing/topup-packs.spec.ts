import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * Buying credit, with one pack and with several.
 *
 * The bug this pins: two separate queries resolved "the top-up pack" as the
 * lowest-sort active credit pack — the checkout price lookup and the webhook's
 * attribution. A second pack therefore got a real Stripe price and a real row
 * that nothing could buy, and any sale of it would have been credited to the
 * first pack in the admin revenue figures.
 *
 * The single-pack tests matter as much as the multi-pack ones: that is what is
 * live today, and it must not change.
 */

/**
 * A Pro teacher who has spent most of the month's credit.
 *
 * Both top-up entry points are deliberately withheld until credits run low —
 * the sidebar button at 20% remaining, the billing meter's at 80% used — so a
 * teacher with a full allowance has nothing to click. Spend is measured, not
 * stored: monthly_ai_spend() sums token_usage.cost_usd and converts at the
 * fx rate (0.79), so 1.60 USD is about 126p against Pro's 150p ceiling.
 */
async function makeProNearlySpent(teacher: TestTeacher) {
  await admin.from("profiles").update({ plan: "pro" }).eq("id", teacher.id);
  await admin.from("token_usage").insert({
    user_id: teacher.id,
    tool_slug: "lesson-planner",
    model: "gpt-4o",
    prompt_tokens: 1000,
    cached_tokens: 0,
    completion_tokens: 1000,
    cost_usd: 1.6,
  });
}

/** Open the top-up chooser from the sidebar, which is where a teacher running
 *  low actually meets it. */
async function openTopUp(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  const nav = page.locator("#app-sidenav-v2");
  const button = nav.getByRole("button", { name: /top up credits/i });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Top-up packs", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Robin");
    await makeProNearlySpent(teacher);
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("the live pack is listed with its real credits and price", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/profile?section=subscription");

    // Read what the database actually holds rather than asserting 1,000/£1.50:
    // this test should still pass after the pack is repriced.
    const { data: pack } = await admin
      .from("topup_packs")
      .select("unit, price_gbp")
      .eq("kind", "credit_gbp")
      .eq("active", true)
      .order("sort")
      .limit(1)
      .single();

    const credits = Math.round(Number(pack!.unit) / 0.15).toLocaleString("en-GB");
    const price = Number(pack!.price_gbp).toFixed(2);

    const dialog = await openTopUp(page);
    await expect(dialog.getByText(`${credits} credits`)).toBeVisible();
    await expect(dialog.getByText(`£${price}`)).toBeVisible();

    // One pack is selected by default, so Continue is immediately usable —
    // no "choose something first" step when there is nothing to choose.
    await expect(dialog.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  });

  test("a second pack is listed, and the cheaper one is selected by default", async ({ page }) => {
    // A pack with its own Stripe price. Not created through the admin route
    // because that would mint a real Stripe price for a throwaway fixture; the
    // price id only has to be non-null for the pack to count as buyable.
    const { data: extra } = await admin
      .from("topup_packs")
      .insert({
        kind: "credit_gbp",
        name: "E2E large pack",
        price_gbp: 5.0,
        unit: 500,
        available_to: ["free", "pro", "max"],
        active: true,
        sort: 50,
        stripe_price_id: "price_e2e_fixture_large",
      })
      .select()
      .single();

    try {
      await signIn(page, teacher);
      const dialog = await openTopUp(page);

      // Both packs offered, each sized from its own `unit`: 500p / 0.15 = 3,333.
      await expect(dialog.getByText("1,000 credits")).toBeVisible();
      await expect(dialog.getByText("3,333 credits")).toBeVisible();
      await expect(dialog.getByText("£5.00")).toBeVisible();

      // Lowest sort is the default, and selection is exclusive.
      const options = dialog.getByRole("radio");
      await expect(options).toHaveCount(2);
      await expect(options.first()).toHaveAttribute("aria-checked", "true");
      await expect(options.nth(1)).toHaveAttribute("aria-checked", "false");

      await options.nth(1).click();
      await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
      await expect(options.first()).toHaveAttribute("aria-checked", "false");
    } finally {
      if (extra?.id) await admin.from("topup_packs").delete().eq("id", extra.id);
    }
  });

  test("a pack the plan is not offered is hidden, and refused if asked for", async ({ page }) => {
    // Max-only, bought by a Pro teacher. `available_to` is NOT enforced by RLS,
    // so this is the check that the SERVER refuses it — hiding it in the list
    // is presentation, not protection.
    const { data: locked } = await admin
      .from("topup_packs")
      .insert({
        kind: "credit_gbp",
        name: "E2E max-only pack",
        price_gbp: 9.0,
        unit: 900,
        available_to: ["max"],
        active: true,
        sort: 60,
        stripe_price_id: "price_e2e_fixture_locked",
      })
      .select()
      .single();

    try {
      await signIn(page, teacher);
      const dialog = await openTopUp(page);
      await expect(dialog.getByText("6,000 credits")).toHaveCount(0);

      // Named directly, past the UI. Must be refused rather than sold.
      const status = await page.evaluate(async (packId) => {
        const res = await fetch("/api/stripe/topup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId }),
        });
        return res.status;
      }, locked!.id);

      expect(status).toBe(403);
    } finally {
      if (locked?.id) await admin.from("topup_packs").delete().eq("id", locked.id);
    }
  });

  test("a pack with no Stripe price is not sold at the fallback price", async ({ page }) => {
    // The trap: topUpPriceId() falls back to STRIPE_PRICE_CREDIT_TOP_UP when a
    // pack has no price of its own, so a half-configured £20 pack would once
    // have charged £1.50. It must be withheld instead.
    const { data: unpriced } = await admin
      .from("topup_packs")
      .insert({
        kind: "credit_gbp",
        name: "E2E unpriced pack",
        price_gbp: 20.0,
        unit: 2000,
        available_to: ["free", "pro", "max"],
        active: true,
        sort: 70,
        stripe_price_id: null,
      })
      .select()
      .single();

    try {
      await signIn(page, teacher);
      const dialog = await openTopUp(page);
      // 2000p / 0.15 = 13,333 credits. Must not be on offer.
      await expect(dialog.getByText("13,333 credits")).toHaveCount(0);

      const status = await page.evaluate(async (packId) => {
        const res = await fetch("/api/stripe/topup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId }),
        });
        return res.status;
      }, unpriced!.id);

      // 500 from topUpPriceId throwing, never 200 with a £1.50 session.
      expect(status).toBe(500);
    } finally {
      if (unpriced?.id) await admin.from("topup_packs").delete().eq("id", unpriced.id);
    }
  });
});
