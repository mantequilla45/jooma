// Server-only Stripe client + the mapping between our PlanId/interval and the
// Stripe Price IDs. This is the single place that knows how a plan becomes a
// price and how a paid price becomes a plan, so the checkout route and the
// webhook stay in agreement.
//
// WHERE PRICE IDs LIVE
// Prices are configured in the database (plan_config.stripe_price_monthly,
// topup_packs.stripe_price_id) and fall back to the environment variables when
// the column is null. The database is what the admin console writes, so a price
// change is a live action rather than a redeploy; the env var remains the
// recovery path if a bad write ever lands, and keeps local dev working with no
// DB setup.
//
// Price IDs are not secrets — they appear in any Checkout URL and identify a
// product the way a SKU does. STRIPE_SECRET_KEY is the secret and stays in the
// environment.
import "server-only";
import Stripe from "stripe";
import type { PlanId } from "./plans";
import { supabaseAdmin } from "./supabase-admin";

if (!process.env.STRIPE_SECRET_KEY) {
  // Fail loud at import time in any server context that needs Stripe, rather
  // than producing a confusing 500 deep inside a request.
  throw new Error("STRIPE_SECRET_KEY is not set");
}

// No apiVersion override — use the version pinned by this SDK release so the
// TypeScript types and the wire behaviour always match.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/** The plans that are self-serve via Stripe Checkout. `free` needs no payment;
 *  `school` is custom/contact-sales (per-seat, invoiced, not a self-serve
 *  Checkout price). */
export type PaidPlanId = Extract<PlanId, "pro" | "max">;

/** The plans checkout will sell. Anything else is rejected before Stripe. */
export const PAID_PLAN_IDS: PaidPlanId[] = ["pro", "max"];

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as string[]).includes(value);
}

/**
 * Resolve the configured Stripe Price ID for a paid plan. Billing is monthly
 * only — there is no annual price.
 *
 * Reads plan_config first, falls back to the env var. A DB error is treated the
 * same as "not configured" and falls through to the env var rather than failing
 * checkout: a database blip should not stop someone paying us.
 */
export async function priceIdFor(plan: PaidPlanId): Promise<string> {
  const envPriceId = {
    pro: process.env.STRIPE_PRICE_PRO_MONTHLY,
    max: process.env.STRIPE_PRICE_MAX_MONTHLY,
  }[plan];

  const { data, error } = await supabaseAdmin
    .from("plan_config")
    .select("stripe_price_monthly")
    .eq("plan_id", plan)
    .maybeSingle();

  if (error) {
    console.error("[stripe] plan_config price lookup failed, using env", error);
  }

  const priceId = data?.stripe_price_monthly || envPriceId;
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan=${plan}`);
  }
  return priceId;
}

/** A resolved top-up: the Stripe price to charge, and the pack it came from.
 *  `packId` is null only when falling back to the environment price, which has
 *  no pack row behind it. */
export interface ResolvedTopUp {
  priceId: string;
  packId: string | null;
  /** PENCE of credit the pack grants. Null on the env fallback, where the
   *  amount paid is the only thing we know. */
  unit: number | null;
}

/**
 * Resolve a one-off AI-credit top-up to charge. Must be a ONE-TIME price —
 * Checkout's `mode: "payment"` rejects recurring prices.
 *
 * With a packId, resolves THAT pack. Without one, falls back to the lowest-sort
 * active credit pack, which is what every caller did before packs could be
 * chosen — so an old client that sends no pack still buys the default.
 *
 * The env var remains the last resort so local development works with no pack
 * seeded. Note it is only reachable when no pack matched at all: a pack that
 * exists but has no stripe_price_id is REFUSED rather than silently charged at
 * the env price, which would bill £1.50 for a pack advertised at £5.
 */
export async function topUpPriceId(packId?: string | null): Promise<ResolvedTopUp> {
  let query = supabaseAdmin
    .from("topup_packs")
    .select("id, unit, stripe_price_id")
    .eq("kind", "credit_gbp")
    .eq("active", true);

  query = packId
    ? query.eq("id", packId)
    : query.order("sort").limit(1);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[stripe] topup pack lookup failed", error);
  }

  // A named pack that does not exist, is inactive, or is not a credit pack is
  // an error rather than a reason to sell the default one: the teacher chose a
  // specific thing and charging them for something else is worse than failing.
  if (packId && !data) {
    throw new Error(`No active credit pack with id=${packId}`);
  }
  if (packId && !data?.stripe_price_id) {
    throw new Error(`Pack id=${packId} has no Stripe price configured`);
  }

  if (data?.stripe_price_id) {
    return {
      priceId: data.stripe_price_id,
      packId: data.id as string,
      unit: Number(data.unit),
    };
  }

  const envPriceId = process.env.STRIPE_PRICE_CREDIT_TOP_UP;
  if (!envPriceId) {
    throw new Error("No Stripe price configured for the credit top-up");
  }
  return { priceId: envPriceId, packId: null, unit: null };
}

/**
 * Reverse lookup: which of our plans does a paid Stripe Price ID grant?
 *
 * THIS MUST RECOGNISE SUPERSEDED PRICES. Stripe Price objects are immutable, so
 * changing a price means creating a new one — but existing subscribers keep
 * billing against the price they signed up on, potentially for years. The
 * webhook treats a null return as "no subscription" and drops the user to Free,
 * so a lookup that only knew the *current* price would silently downgrade every
 * existing subscriber the first time a price changed.
 *
 * plan_price_history records every price ever pointed at a plan, archived ones
 * included. The env var and the current plan_config value are checked too, so
 * this still resolves correctly before any price change has been recorded.
 *
 * Returns null for prices we genuinely don't recognise.
 */
export async function planForPriceId(
  priceId: string | undefined | null,
): Promise<PlanId | null> {
  if (!priceId) return null;

  // Cheap path: the prices currently configured in the environment.
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId === process.env.STRIPE_PRICE_MAX_MONTHLY) return "max";

  const { data: historic, error: historyErr } = await supabaseAdmin
    .from("plan_price_history")
    .select("plan_id")
    .eq("stripe_price_id", priceId)
    .maybeSingle();

  if (historyErr) {
    console.error("[stripe] plan_price_history lookup failed", historyErr);
  }
  if (historic?.plan_id) return historic.plan_id as PlanId;

  // A price set in plan_config but not yet recorded in history — possible if a
  // price were ever changed by hand in the database rather than through the
  // admin route, which writes both.
  const { data: current, error: currentErr } = await supabaseAdmin
    .from("plan_config")
    .select("plan_id")
    .eq("stripe_price_monthly", priceId)
    .maybeSingle();

  if (currentErr) {
    console.error("[stripe] plan_config reverse lookup failed", currentErr);
  }
  if (current?.plan_id) return current.plan_id as PlanId;

  return null;
}

/** A plan change that Stripe is holding until the period ends. */
export interface PendingPlanChange {
  /** The plan that starts at `at`. */
  plan: PlanId;
  /** ISO timestamp the new plan takes effect — the current period's end. */
  at: string;
  /** The schedule to release if they change their mind. */
  scheduleId: string;
}

/**
 * The downgrade a subscriber has scheduled, if any.
 *
 * A downgrade is not applied immediately (see app/api/stripe/downgrade), it is
 * parked on a Stripe subscription SCHEDULE whose second phase starts at the
 * renewal date. That state lives only in Stripe: nothing on `profiles` records
 * it, deliberately, because the teacher is still fully on their current plan
 * until it lands and every existing column should keep saying so.
 *
 * So the billing page reads it back through here at render time. Returns null
 * when there is no schedule, when the schedule has only the current phase, or
 * when anything at all goes wrong — a Stripe hiccup must degrade to "no pending
 * change" rather than breaking a page whose main job is showing the plan they
 * already have.
 */
export async function pendingPlanChange(
  subscriptionId: string | null | undefined,
): Promise<PendingPlanChange | null> {
  if (!subscriptionId) return null;

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["schedule"],
    });

    const schedule = sub.schedule;
    // Not expanded into an object, or no schedule attached at all.
    if (!schedule || typeof schedule === "string") return null;
    // A released or cancelled schedule is no longer going to do anything.
    if (schedule.status !== "active" && schedule.status !== "not_started") return null;

    // Phase 0 is the period they are in now; the change is phase 1.
    const upcoming = schedule.phases?.[1];
    if (!upcoming) return null;

    const priceId =
      typeof upcoming.items?.[0]?.price === "string"
        ? upcoming.items[0].price
        : upcoming.items?.[0]?.price?.id;

    const plan = await planForPriceId(priceId);
    if (!plan) return null;

    return {
      plan,
      at: new Date(upcoming.start_date * 1000).toISOString(),
      scheduleId: schedule.id,
    };
  } catch (err) {
    console.error("[stripe] pendingPlanChange lookup failed", err);
    return null;
  }
}
