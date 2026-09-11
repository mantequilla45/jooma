import { test, expect } from "@playwright/test";
import { nextPlanDown, nextPlanUp, PLANS, planCredits } from "@/app/lib/plans";
import { planFeatures, planLosses } from "@/app/lib/plan-copy";

/*
 * The plan ladder, and what moving down it costs.
 *
 * Both functions are pure and derived from PLANS, so they are tested here
 * rather than through the browser. planLosses in particular is worth pinning:
 * its output is read by somebody deciding whether to leave, so a bug that
 * overstates the loss tells a teacher they will lose something they actually
 * keep — which they will discover, and resent — while one that understates it
 * costs a save that could have been made.
 */

test.describe("nextPlanDown", () => {
  test("Max steps down to Pro", () => {
    expect(nextPlanDown("max")).toBe("pro");
  });

  test("Pro has no PAID plan below it", () => {
    // Not an oversight. Free is not a price to swap to — getting there means
    // cancelling and letting the subscription lapse, which is a different
    // mechanism entirely. Returning "free" here would invite a caller to hand
    // it to /api/stripe/downgrade, where priceIdFor() would throw.
    expect(nextPlanDown("pro")).toBeNull();
  });

  test("Free has nowhere to go", () => {
    expect(nextPlanDown("free")).toBeNull();
  });

  test("is the inverse of nextPlanUp across the paid ladder", () => {
    const down = nextPlanDown("max");
    expect(down).not.toBeNull();
    expect(nextPlanUp(down!)).toBe("max");
  });

  test("never returns a plan that costs the same or more", () => {
    for (const id of ["free", "pro", "max"] as const) {
      const down = nextPlanDown(id);
      if (!down) continue;
      expect(PLANS[down].priceMonthly ?? 0).toBeLessThan(PLANS[id].priceMonthly ?? 0);
    }
  });
});

test.describe("planLosses", () => {
  test("Max to Pro leads with the credit drop", () => {
    const losses = planLosses("max", "pro");
    const maxCredits = planCredits("max")!;
    const proCredits = planCredits("pro")!;

    expect(losses.length).toBeGreaterThan(0);
    // The number they actually feel every month goes first.
    expect(losses[0]).toContain((maxCredits - proCredits).toLocaleString("en-GB"));
    expect(losses[0]).toContain(proCredits.toLocaleString("en-GB"));
  });

  test("Max to Pro names the slideshow allowance, and nothing they keep", () => {
    const losses = planLosses("max", "pro").join(" | ");

    // Pro really does get fewer of these, so it belongs on the list.
    expect(losses).toContain(String(PLANS.pro.limits.aiImageSlideshows));

    // These are IDENTICAL on Pro and Max. Claiming any of them as a loss would
    // be telling a teacher they lose something they keep.
    expect(losses).not.toContain("watermark");
    expect(losses).not.toContain("assistant");
    expect(losses).not.toContain("priority support");
    expect(losses).not.toContain("curriculum");
  });

  test("Pro to Free is a much longer list, and says the hard parts", () => {
    const losses = planLosses("pro", "free");
    const joined = losses.join(" | ");

    expect(losses.length).toBeGreaterThan(planLosses("max", "pro").length);
    // The three that actually change how the product feels day to day.
    expect(joined).toContain("watermark");
    expect(joined).toContain("assistant");
    expect(joined).toContain(String(PLANS.free.limits.monthlyGenerations));
  });

  test("moving UP costs nothing", () => {
    expect(planLosses("pro", "max")).toEqual([]);
    expect(planLosses("free", "pro")).toEqual([]);
  });

  test("a plan loses nothing against itself", () => {
    expect(planLosses("pro", "pro")).toEqual([]);
    expect(planLosses("max", "max")).toEqual([]);
  });
});

test.describe("planFeatures", () => {
  test("paid plans lead with their real credit allowance", () => {
    // Derived from the spend ceiling, so a card can never advertise an
    // allowance the guard will not grant.
    expect(planFeatures("pro")[0]).toContain(planCredits("pro")!.toLocaleString("en-GB"));
    expect(planFeatures("max")[0]).toContain(planCredits("max")!.toLocaleString("en-GB"));
  });

  test("Free quotes its generation caps, not a credit figure", () => {
    // planCredits("free") is null by design: Free is gated by COUNT, not spend.
    // "0 credits a month" would be both wrong and discouraging.
    const first = planFeatures("free")[0];
    expect(first).toContain(String(PLANS.free.limits.monthlyGenerations));
    expect(first).toContain(String(PLANS.free.limits.dailyGenerations));
    expect(first).not.toContain("credits");
  });
});
