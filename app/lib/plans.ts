// ── Plan gates — single source of truth ──────────────────────────────────────
// Every feature limit and entitlement is defined here. The pricing page, the
// usage counters, and the runtime gates all read from this config so a plan
// change in one place propagates everywhere.

export type PlanId = "free" | "pro" | "max" | "school";

// "gdocs" is offered in the export menu but rendered disabled ("coming soon") —
// a real Google Docs export needs OAuth, a Drive client and consent-screen
// verification. It lives in the union so the menu and the plan arrays can name
// it without a cast the day it ships.
export type ExportFormat = "pdf" | "docx" | "pptx" | "gdocs";

export interface PlanLimits {
  /**
   * Max AI generations per calendar day (UTC). `null` = no daily cap.
   * GLOBAL across all tools, not per tool — one generation a day means the
   * whole product is used up for the day, whichever tool spent it.
   */
  dailyGenerations: number | null;
  /** Max AI generations per calendar month. `null` = unlimited. Also global.
   *  A hard ceiling: reaching it blocks until the 1st even on a fresh day. */
  monthlyGenerations: number | null;
  /**
   * AI-image slideshows included per month. Each costs ~33x a text resource,
   * so this is the single number that decides whether a plan makes money.
   * `0` = not available on this plan.
   */
  aiImageSlideshows: number;
  /** Exported files carry a "Made with Jooma" watermark. */
  watermark: boolean;
  /**
   * Export formats this plan may use.
   *
   * EVERY PLAN GETS EVERY FORMAT, deliberately. Export is not a paid gate:
   * once a teacher has spent a generation on a resource, how they get it out of
   * Jooma is their business, and metering the file type would be a petty
   * restriction on work they have already paid for (in credits or in the free
   * allowance). What a plan limits is how MUCH you can generate, not what you
   * can do with the result.
   *
   * Kept as a field rather than deleted so the pricing page can still enumerate
   * formats, and so the shape is here if the policy is ever revisited. The
   * arrays are identical across plans on purpose — if you find yourself
   * narrowing one, read canExport() below first.
   */
  exportFormats: ExportFormat[];
  /** Curriculum alignment depth. */
  curriculumAlignment: "limited" | "full";
  /** Outputs can be edited in the editor before export. */
  editableOutputs: boolean;
  /** Save & organise a personal resource library. */
  saveLibrary: boolean;
  /** Priority support queue. */
  prioritySupport: boolean;
  /**
   * The conversational AI assistant (/assistant, and the dashboard card).
   *
   * Paid plans only, and this is a margin guard rather than a feature tier.
   * Free is capped by generation COUNT, not by spend — AI_SPEND_CEILING_PENCE.free
   * is null and the daily/monthly caps only apply to GENERATION_PATHS. A chat
   * turn is deliberately not a generation (three follow-up questions are not
   * three resources), so on Free it would hit no cap at all and be unlimited.
   *
   * Free users still SEE the assistant — locked, with an upgrade prompt — so the
   * page can do the selling. proxy.ts is what actually enforces this.
   */
  assistant: boolean;
  // ── School-only capabilities ──
  multiUser: boolean;
  sharedLibrary: boolean;
  adminDashboard: boolean;
  usageAnalytics: boolean;
  schoolBranding: boolean;
  centralBilling: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in GBP. `null` = custom/contact sales. */
  priceMonthly: number | null;
  /** Yearly price per month in GBP (the discounted rate). */
  priceYearlyPerMonth: number | null;
  /** Full yearly price in GBP, as billed. `null` = custom/contact sales. */
  priceYearly: number | null;
  /** Who buys this plan — drives which column it appears in on the admin page. */
  audience: "teacher" | "school";
  /** One-line description shown on the pricing page. */
  description: string;
  /** For per-seat plans, the unit the price is quoted in. */
  interval: "month" | "seat/month";
  /** Withdrawn from sale. Kept here so existing accounts still resolve limits
   *  and so admin revenue figures reconcile, but never offered for purchase. */
  retired?: boolean;
  /** Not yet shippable — hidden from the public pricing page and flagged as
   *  work-in-progress in the admin console. */
  hidden?: boolean;
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free Plan",
    priceMonthly: 0,
    priceYearlyPerMonth: 0,
    priceYearly: 0,
    audience: "teacher",
    description: "1 a day, 5 a month, watermarked",
    interval: "month",
    limits: {
      dailyGenerations: 1,
      monthlyGenerations: 5,
      aiImageSlideshows: 0,
      watermark: true,
      // Same formats as every paid plan — see the note on exportFormats above.
      exportFormats: ["pdf", "docx", "pptx", "gdocs"],
      curriculumAlignment: "limited",
      editableOutputs: false,
      saveLibrary: false,
      prioritySupport: false,
      assistant: false,
      multiUser: false,
      sharedLibrary: false,
      adminDashboard: false,
      usageAnalytics: false,
      schoolBranding: false,
      centralBilling: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro Teacher",
    // £7.99/mo, £79.00/yr — matches the Stripe prices configured for
    // STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_YEARLY.
    priceMonthly: 7.99,
    priceYearlyPerMonth: 6.58,
    priceYearly: 79.0,
    audience: "teacher",
    description: "Everything, fair use. For one teacher.",
    interval: "month",
    limits: {
      dailyGenerations: null,
      monthlyGenerations: null,
      aiImageSlideshows: 12,
      watermark: false,
      exportFormats: ["pdf", "docx", "pptx", "gdocs"],
      curriculumAlignment: "full",
      editableOutputs: true,
      saveLibrary: true,
      prioritySupport: true,
      assistant: true,
      multiUser: false,
      sharedLibrary: false,
      adminDashboard: false,
      usageAnalytics: false,
      schoolBranding: false,
      centralBilling: false,
    },
  },
  max: {
    id: "max",
    name: "Max Teacher",
    // ON SALE. Max was once withdrawn (retired: true, plan_config
    // status='retired') and is now the step up from Pro: 2,500 credits against
    // Pro's 1,000, for £14.99.
    //
    // The Stripe price is configured in plan_config.stripe_price_monthly, with
    // STRIPE_PRICE_MAX_MONTHLY as the fallback. Both are set in staging and
    // production. If neither exists, priceIdFor('max') throws rather than
    // silently charging the wrong thing.
    priceMonthly: 14.99,
    priceYearlyPerMonth: 12.42,
    priceYearly: 149.0,
    audience: "teacher",
    description: "Adds leadership, inspection and CPD tools",
    interval: "month",
    limits: {
      dailyGenerations: null,
      monthlyGenerations: null,
      aiImageSlideshows: 25,
      watermark: false,
      exportFormats: ["pdf", "docx", "pptx", "gdocs"],
      curriculumAlignment: "full",
      editableOutputs: true,
      saveLibrary: true,
      prioritySupport: true,
      assistant: true,
      multiUser: false,
      sharedLibrary: false,
      adminDashboard: false,
      usageAnalytics: false,
      schoolBranding: false,
      centralBilling: false,
    },
  },
  school: {
    id: "school",
    name: "School Plan",
    // Stripe has a real per-seat price (£4.25/mo, £51.00/yr — see
    // STRIPE_PRICE_SCHOOL_MONTHLY/_YEARLY), but this field is a single flat
    // price and there's no seat-count model on profiles yet to multiply it
    // by. Leaving it null keeps it "custom pricing" rather than silently
    // treating every school teacher as £4.25/mo revenue regardless of their
    // school's actual seat count.
    priceMonthly: null,
    priceYearlyPerMonth: null,
    priceYearly: null,
    audience: "school",
    description: "Per seat, banded, invoiced annually",
    interval: "seat/month",
    // WORK IN PROGRESS — seats, pooled allowances and central billing are not
    // implemented, so this is hidden from /pricing and flagged in the admin
    // console rather than being sold.
    hidden: true,
    limits: {
      // Per seat. Both pools are shared across the school — a 30-seat school
      // has 9,000 resources and 90 AI slideshows a month to distribute as it
      // likes. `monthlyGenerations` stays null because the cap is enforced at
      // the school pool level, not per teacher.
      dailyGenerations: null,
      monthlyGenerations: null,
      aiImageSlideshows: 3,
      watermark: false,
      exportFormats: ["pdf", "docx", "pptx", "gdocs"],
      curriculumAlignment: "full",
      editableOutputs: true,
      saveLibrary: true,
      prioritySupport: true,
      assistant: true,
      multiUser: true,
      sharedLibrary: true,
      adminDashboard: true,
      usageAnalytics: true,
      schoolBranding: true,
      centralBilling: true,
    },
  },
};

export const DEFAULT_PLAN: PlanId = "free";

/**
 * The plans an admin may actually put someone on, in display order.
 *
 * Currently free, pro and max. Excludes `school` (not built: no seats, no
 * pooled allowances, no central billing). Offering it in a dropdown would let
 * an admin move a teacher onto a plan that does not function.
 *
 * `school` stays fully defined in PLANS: an account already holding it still
 * resolves real limits and still renders the right badge. This is a
 * presentation filter, not a removal.
 */
export const SELECTABLE_PLANS: Plan[] = Object.values(PLANS).filter(
  (p) => !p.retired && !p.hidden,
);

/** The ids of SELECTABLE_PLANS, for the several places that need the bare
 *  strings — DB `text[]` columns such as topup_packs.available_to, and filter
 *  lists. Derived, so a plan returning to or leaving sale updates them all. */
export const SELECTABLE_PLAN_IDS: PlanId[] = SELECTABLE_PLANS.map((p) => p.id);

/**
 * Plans sold through Stripe Checkout, and therefore the only ones that can have
 * a real Stripe price set from the admin console.
 *
 * Derived rather than listed, so reinstating or withdrawing a plan is a single
 * edit to PLANS. Free has nothing to charge (priceMonthly 0) and School is
 * `hidden` and invoiced per seat rather than sold self-serve, so both fall out
 * naturally.
 *
 * ONE constant, deliberately. This was previously written out twice — as a
 * literal Set in the pricing route and again in the Plans admin screen — and
 * the two drifted: both still said Pro only, long after Max went back on sale.
 * The client uses it to decide whether to offer a price field; the route uses
 * it as the server-side allowlist. They must agree.
 */
export const PRICEABLE_PLAN_IDS: PlanId[] = SELECTABLE_PLANS.filter(
  (p) => (p.priceMonthly ?? 0) > 0,
).map((p) => p.id);

/**
 * The next plan up from this one, or null at the top of the ladder.
 *
 * Ordered by price so the ladder follows PLANS rather than a hardcoded
 * "pro means max": adding a tier above Max makes the upgrade button offer it
 * with no further change. Only priced, self-serve plans are candidates —
 * `school` is contact-sales and is never somewhere a teacher upgrades to on
 * their own.
 *
 * Returns null for Free: a teacher with no subscription has nothing to swap,
 * so they go through Checkout, not the upgrade route.
 */
export function nextPlanUp(plan: PlanId): PlanId | null {
  const ladder = PRICEABLE_PLAN_IDS.slice().sort(
    (a, b) => (PLANS[a].priceMonthly ?? 0) - (PLANS[b].priceMonthly ?? 0),
  );
  const price = PLANS[plan].priceMonthly;
  if (price === null) return null;
  return ladder.find((id) => (PLANS[id].priceMonthly ?? 0) > price) ?? null;
}

/**
 * The next PAID plan down from this one, or null when there isn't one.
 *
 * The mirror of nextPlanUp, and derived the same way so the ladder follows
 * PLANS rather than a hardcoded "max means pro".
 *
 * Returns null for Pro, and that is not an oversight. Free has no price to swap
 * to — dropping to Free means CANCELLING the subscription and letting it lapse
 * at period end, which is a different mechanism entirely (the portal's
 * subscription_cancel flow, then the webhook writing DEFAULT_PLAN when Stripe
 * finally closes it). Returning "free" here would invite a caller to hand it to
 * /api/stripe/downgrade, where priceIdFor() would throw. The paid ladder and
 * the exit are deliberately separate.
 */
export function nextPlanDown(plan: PlanId): PlanId | null {
  const ladder = PRICEABLE_PLAN_IDS.slice().sort(
    // Descending, so the first match below the current price is the NEAREST one
    // rather than the cheapest.
    (a, b) => (PLANS[b].priceMonthly ?? 0) - (PLANS[a].priceMonthly ?? 0),
  );
  const price = PLANS[plan].priceMonthly;
  if (price === null) return null;
  return ladder.find((id) => (PLANS[id].priceMonthly ?? 0) < price) ?? null;
}

// ── AI spend ceiling ─────────────────────────────────────────────────────────
/**
 * Monthly ceiling on MEASURED provider AI spend, in pence. `null` = no ceiling.
 *
 * This is a margin guard, not a unit allowance. Because it is denominated in
 * real cost (token_usage + asset_cost, summed by the monthly_ai_spend RPC),
 * every route that records cost counts against it automatically — including
 * /api/modify refinements and slideshow sub-assets, which are deliberately not
 * counted as "generations". There is no path list to keep in sync.
 *
 * Free is `null` because it is gated by generation COUNT instead; a free user
 * can never spend enough to matter. Pro is £1.50 against £7.99 of revenue.
 */
export const AI_SPEND_CEILING_PENCE: Record<PlanId, number | null> = {
  free: null,
  pro: 150,
  // £3.75 against £14.99 of revenue. This is what makes Max's 2,500 credits
  // real: while Max was withdrawn it sat at Pro's 150p, so a Max subscriber
  // paying nearly twice as much got exactly Pro's allowance.
  max: 375,
  // Pooled at the school level; not modelled yet.
  school: null,
};

/** One top-up purchase, in pence. Repeatable; expires at month end. */
export const TOPUP_PENCE = 150;

// ── Credits: the teacher-facing unit ────────────────────────────────────────
//
// Internally the AI allowance is measured in pence of model spend, because that
// is what we are actually protecting against. Teachers must never see that
// figure: "you've used £1.50 of AI" sitting next to a £7.99 charge invites the
// reading that they only got £1.50 of value for their money, which is both
// wrong (the price covers the product, not a metered resale of tokens) and
// impossible to argue against once seen.
//
// So the same allowance is presented as CREDITS. The rate below is the only
// place the two units meet.

/** Pence of AI spend per teacher-facing credit. */
const PENCE_PER_CREDIT = 0.15;

/**
 * A month's Pro allowance in credits, and one top-up, both derived from the
 * pence figures so they can never drift apart:
 *   £1.50 ceiling  → 1,000 credits
 *   £1.50 top-up   → 1,000 credits
 */
export const PLAN_CREDITS = 1000;

/**
 * A plan's monthly allowance in credits, derived from its pence ceiling so the
 * two can never drift: Pro 150p → 1,000, Max 375p → 2,500.
 *
 * `null` for plans with no ceiling (Free, which is gated by generation count
 * instead, and School, which is not modelled). Callers decide how to present
 * that — the landing page shows Free's real "5 resources a month" rather than
 * a credit figure it does not have.
 */
export function planCredits(plan: PlanId): number | null {
  const pence = AI_SPEND_CEILING_PENCE[plan];
  return pence === null ? null : toCredits(pence);
}

/** Convert internal pence of AI spend into teacher-facing credits. */
export function toCredits(pence: number): number {
  return Math.round(pence / PENCE_PER_CREDIT);
}

/**
 * Credits remaining, floored at zero so an overspend never renders as a
 * negative balance. Overspend is possible: the gate is checked before a
 * generation, not during it, so the last one can tip past the ceiling.
 */
export function creditsRemaining(spendPence: number, allowancePence: number): number {
  return Math.max(0, toCredits(allowancePence - spendPence));
}

/**
 * The monthly resource allowance to display for a plan. Distinct from
 * `monthlyGenerations`, which is the *enforced* cap — unlimited plans have no
 * cap to enforce but the admin console still needs a denominator for the
 * resource meter. `null` means genuinely uncapped with nothing to meter against.
 *
 * Free is 5/month (alongside 1/day). The earlier "10 resources" figure from the
 * admin console spec is gone: launch pricing settled on 1 a day, 5 a month, and
 * plan_config now stores the same.
 */
export function displayResourceAllowance(plan: PlanId): number | null {
  return PLANS[plan].limits.monthlyGenerations;
}

/** Coerce an arbitrary string (e.g. a DB value) into a valid PlanId. */
export function asPlanId(value: string | null | undefined): PlanId {
  return value === "pro" || value === "max" || value === "school" ? value : DEFAULT_PLAN;
}

/** Read the limits object for a plan. */
export function limitsFor(plan: PlanId): PlanLimits {
  return PLANS[plan].limits;
}

// ── Gate helpers ──────────────────────────────────────────────────────────────
// Boolean entitlements (everything in PlanLimits except the numeric/array ones).
type BooleanGate = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

/** True if the plan has the given boolean entitlement. */
export function can(plan: PlanId, gate: BooleanGate): boolean {
  return PLANS[plan].limits[gate];
}

/**
 * True if the plan may export to the given format.
 *
 * Currently returns true for every plan/format pair, because every plan carries
 * the same exportFormats array — export is deliberately not a paid gate (see
 * the note on exportFormats above). Nothing calls this, and the export menus
 * offer every format to everyone.
 *
 * Kept because it is the right place for the check to live IF the policy ever
 * changes. Wiring it up today would be a no-op; wiring it up after narrowing a
 * plan's array would silently withdraw a format teachers already use, so change
 * the arrays and the UI together, and say so to the people affected.
 */
export function canExport(plan: PlanId, format: ExportFormat): boolean {
  return PLANS[plan].limits.exportFormats.includes(format);
}

/** Which cap stopped a generation. `null` when it was allowed. */
export type GenerationBlockReason = "free_daily" | "free_monthly" | null;

export interface GenerationGate {
  /** Whether the user may run another generation right now. */
  allowed: boolean;
  /** Which cap blocked it, if any. */
  reason: GenerationBlockReason;
  /** Generations used today (UTC). */
  usedToday: number;
  /** Generations used this month. */
  used: number;
  /** The plan's daily cap, or null for none. */
  dailyLimit: number | null;
  /** The plan's monthly cap, or null for unlimited. */
  limit: number | null;
  /** Generations remaining this month, or null for unlimited. */
  remaining: number | null;
}

/**
 * Evaluate the generation caps for a plan given current usage. Both caps are
 * global across all tools.
 *
 * The MONTHLY cap outranks the daily one: a free user who has used all 5 this
 * month is blocked even on a fresh day. Checking it first means the reason we
 * report is the one that actually needs solving (wait for the 1st, not until
 * midnight).
 */
export function generationGate(
  plan: PlanId,
  usedThisMonth: number,
  usedToday = 0,
): GenerationGate {
  const { dailyGenerations: dailyLimit, monthlyGenerations: limit } = PLANS[plan].limits;
  const remaining = limit === null ? null : Math.max(0, limit - usedThisMonth);

  const base = { usedToday, used: usedThisMonth, dailyLimit, limit, remaining };

  if (limit !== null && usedThisMonth >= limit) {
    return { ...base, allowed: false, reason: "free_monthly" };
  }
  if (dailyLimit !== null && usedToday >= dailyLimit) {
    return { ...base, allowed: false, reason: "free_daily" };
  }
  return { ...base, allowed: true, reason: null };
}
