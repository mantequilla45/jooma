import { test, expect } from "@playwright/test";
import { monthlyValue, totalMonthly, type ValuableSubscription } from "@/app/lib/subscriptionValue";

/*
 * What a subscription is really worth per month.
 *
 * This is the one part of honest MRR that cannot be asserted end to end: the
 * true amounts live in Stripe, and a live total changes whenever somebody
 * subscribes. So the arithmetic is pulled out into a pure function and tested
 * against fixtures here, with the live call kept thin around it.
 *
 * The fixtures are not invented. They are the shapes actually found on the
 * production account: a GBP 7.99 monthly price carrying a promotion code that
 * reduced the charge to GBP 0.08 and GBP 0.80, and a presentment currency of
 * PHP on a subscription denominated in GBP.
 */

const price = (
  unit: number,
  interval = "month",
  interval_count = 1,
  currency = "gbp",
) => ({ unit_amount: unit, currency, recurring: { interval, interval_count } });

const sub = (over: Partial<ValuableSubscription> = {}): ValuableSubscription => ({
  currency: "gbp",
  items: { data: [{ quantity: 1, price: price(799) }] },
  discounts: [],
  ...over,
});

test.describe("Monthly value of a subscription", () => {
  test("an undiscounted monthly price is itself", () => {
    expect(monthlyValue(sub()).pence).toBe(799);
  });

  test("an annual price is spread over twelve months", () => {
    // GBP 79 a year is GBP 6.58 a month, not GBP 79 and not GBP 7.99. The old
    // figure counted every annual subscriber at the monthly price.
    const annual = sub({ items: { data: [{ quantity: 1, price: price(7900, "year") }] } });
    expect(monthlyValue(annual).pence).toBe(658);
  });

  test("percentage discounts come off, as the live subscribers show", () => {
    // The two real production subscriptions: listed 799, billed 8 and 80.
    expect(monthlyValue(sub({ discounts: [{ coupon: { percent_off: 99 } }] })).pence).toBe(8);
    expect(monthlyValue(sub({ discounts: [{ coupon: { percent_off: 90 } }] })).pence).toBe(80);
  });

  test("the pair together is the 18x overstatement", () => {
    const { pence, counted } = totalMonthly([
      sub({ discounts: [{ coupon: { percent_off: 99 } }] }),
      sub({ discounts: [{ coupon: { percent_off: 90 } }] }),
    ]);
    expect(counted).toBe(2);
    // GBP 0.88 actually billed, against GBP 15.98 of list price.
    expect(pence).toBe(88);
  });

  test("a fixed discount is per period, so an annual one is spread too", () => {
    const monthly = sub({ discounts: [{ coupon: { amount_off: 500, currency: "gbp" } }] });
    expect(monthlyValue(monthly).pence).toBe(299);

    const annual = sub({
      items: { data: [{ quantity: 1, price: price(7900, "year") }] },
      discounts: [{ coupon: { amount_off: 1200, currency: "gbp" } }],
    });
    // 7900/12 - 1200/12 = 558
    expect(monthlyValue(annual).pence).toBe(558);
  });

  test("a discount bigger than the price bills nothing, never a refund", () => {
    const free = sub({ discounts: [{ coupon: { amount_off: 9999, currency: "gbp" } }] });
    expect(monthlyValue(free).pence).toBe(0);
  });

  test("quantity multiplies", () => {
    expect(monthlyValue(sub({ items: { data: [{ quantity: 3, price: price(799) }] } })).pence)
      .toBe(2397);
  });

  test("stacked percentages compound", () => {
    const two = sub({ discounts: [{ coupon: { percent_off: 50 } }, { coupon: { percent_off: 50 } }] });
    expect(monthlyValue(two).pence).toBe(200);
  });

  test("a subscription in another currency is skipped, not converted", () => {
    // Every column we store is named *_gbp. Adding pesos to a pounds total
    // silently is worse than reporting one fewer subscriber and saying so.
    const php = { currency: "php", items: { data: [{ quantity: 1, price: price(79900, "month", 1, "php") }] } };
    const value = monthlyValue(php);
    expect(value.pence).toBeNull();
    expect(value.skipped).toBe("foreign-currency");

    const { counted, skipped } = totalMonthly([sub(), php]);
    expect(counted).toBe(1);
    expect(skipped).toBe(1);
  });

  test("presentment currency does not make a GBP subscription foreign", () => {
    // Both live production subscriptions present in PHP while being
    // denominated and settled in GBP. Reading presentment_currency would have
    // dropped every one of them from the total.
    const presented = {
      ...sub(),
      presentment_details: { presentment_currency: "php" },
    } as ValuableSubscription;
    expect(monthlyValue(presented).pence).toBe(799);
  });

  test("a metered price with nothing to read is skipped", () => {
    const metered: ValuableSubscription = {
      currency: "gbp",
      items: { data: [{ quantity: 1, price: { currency: "gbp", recurring: { interval: "month", interval_count: 1 } } }] },
    };
    expect(monthlyValue(metered).pence).toBeNull();
    expect(monthlyValue(metered).skipped).toBe("unpriced");
  });
});
