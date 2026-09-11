// ── Plan copy — what a teacher READS about a plan ────────────────────────────
//
// plans.ts owns what a plan IS (prices, limits, ceilings). This owns how those
// facts are worded on a card. The split matters: the same plan is sold on the
// landing page, offered again on /welcome, and shown a third time in the
// profile's subscription section. Those three surfaces used to carry three
// separate copies of the same list, and they drifted — /welcome still had
// "£7.99" typed as a string, so a price change in Stripe would have left it
// advertising the old figure.
//
// Everything here is DERIVED from PLANS and planCredits() wherever a number is
// involved, so a card can never quote an allowance the guard will not honour.
// See the note above PENCE_PER_CREDIT in plans.ts.

import { PLANS, planCredits, type PlanId, type PlanLimits } from "./plans";

/** The short name on a card. PLANS holds "Pro Teacher" / "Free Plan", which is
 *  right for an admin console and too long for a pricing card. */
const CARD_NAME: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
  max: "Max",
  school: "Schools",
};

/** What sits under the price. Free is not billed, so it is not "a month". */
const CARD_PER: Record<PlanId, string> = {
  free: "Forever",
  pro: "a month",
  max: "a month",
  school: "Priced by size",
};

/** Button label. The card heading already names the plan, so "Choose Pro
 *  Teacher" says it twice. */
const CARD_CTA: Record<PlanId, string> = {
  free: "Start free",
  pro: "Go Pro",
  max: "Choose Max",
  school: "Talk to us",
};

/**
 * The selling points BEYOND the headline allowance, in card order.
 *
 * The allowance line itself is prepended by planFeatures() from planCredits(),
 * so it is never typed here. These are the qualitative claims, which have no
 * machine-readable source — `watermark: false` is a fact, "Clean exports, no
 * watermark" is a sentence, and only the second one belongs on a card.
 */
const HIGHLIGHTS: Record<PlanId, string[]> = {
  free: ["Every tool, nothing locked", "Watermarked exports", "No card needed"],
  pro: [
    "Full curriculum alignment",
    "Clean exports, no watermark",
    "Refining is always free",
    "Top up any time",
  ],
  max: ["Priority building", "Everything in Pro"],
  school: [
    "Credits pooled across staff",
    "Admin dashboard and usage",
    "One invoice, one renewal",
  ],
};

export function planCardName(plan: PlanId): string {
  return CARD_NAME[plan];
}

export function planCardPer(plan: PlanId): string {
  return CARD_PER[plan];
}

export function planCardCta(plan: PlanId): string {
  return CARD_CTA[plan];
}

/**
 * The price as displayed, including the currency.
 *
 * School has no `priceMonthly` (seats are not modelled), so it reads as an
 * enquiry rather than a number — quoting a per teacher figure would be selling
 * something that cannot yet be bought.
 */
export function planCardPrice(plan: PlanId): string {
  const price = PLANS[plan].priceMonthly;
  if (price === null) return "Talk to us";
  // Free is "£0", not "£0.00". Pence on a price of nothing reads like a
  // charge that happens to round down, which is the opposite of the point.
  if (price === 0) return "£0";
  return `£${price.toFixed(2)}`;
}

/**
 * The tick list for a plan's card: its allowance first, then its highlights.
 *
 * Free quotes its real generation caps rather than a credit figure, because it
 * genuinely has none — planCredits("free") is null by design, as Free is gated
 * by COUNT rather than by spend. Showing "0 credits" would be both wrong and
 * discouraging.
 */
export function planFeatures(plan: PlanId): string[] {
  const lines: string[] = [];

  if (plan === "free") {
    const { monthlyGenerations, dailyGenerations } = PLANS.free.limits;
    if (monthlyGenerations !== null && dailyGenerations !== null) {
      lines.push(`${monthlyGenerations} resources a month, ${dailyGenerations} a day`);
    }
  } else {
    const credits = planCredits(plan);
    if (credits !== null) {
      lines.push(`${credits.toLocaleString("en-GB")} credits a month`);
    }
  }

  return [...lines, ...HIGHLIGHTS[plan]];
}

// ── Losses: what moving DOWN actually costs them ─────────────────────────────

/** A limit worth naming when it gets worse, and how to say it. Order here is
 *  the order a teacher reads them in, so the biggest loss comes first. */
type LossRule = {
  /** Which limit to compare. */
  key: keyof PlanLimits;
  /** Build the sentence, given the two values. Return null for "not a real
   *  loss" — some transitions are technically a change but not a downgrade. */
  say: (from: PlanLimits, to: PlanLimits) => string | null;
};

/** Higher is better, so a drop is a loss. Handles `null` as unlimited. */
function fewer(
  from: number | null,
  to: number | null,
  say: (fromN: number, toN: number) => string,
  unlimitedLost: string,
): string | null {
  // Unlimited to capped is the biggest possible loss of this kind.
  if (from === null && to !== null) return unlimitedLost;
  if (from === null || to === null) return null;
  if (to >= from) return null;
  return say(from, to);
}

const LOSS_RULES: LossRule[] = [
  {
    key: "aiImageSlideshows",
    say: (from, to) =>
      fewer(
        from.aiImageSlideshows,
        to.aiImageSlideshows,
        (f, t) =>
          t === 0
            ? `Image slideshows are not included, you have ${f} a month now`
            : `${t} image slideshows a month instead of ${f}`,
        "Image slideshows become capped",
      ),
  },
  {
    key: "monthlyGenerations",
    say: (from, to) =>
      fewer(
        from.monthlyGenerations,
        to.monthlyGenerations,
        (f, t) => `${t} resources a month instead of ${f}`,
        // The headline loss of dropping to Free, and worth stating in full.
        `A limit of ${PLANS.free.limits.monthlyGenerations} resources a month`,
      ),
  },
  {
    key: "dailyGenerations",
    say: (from, to) =>
      fewer(
        from.dailyGenerations,
        to.dailyGenerations,
        (f, t) => `${t} resources a day instead of ${f}`,
        `A limit of ${PLANS.free.limits.dailyGenerations} a day`,
      ),
  },
  {
    key: "watermark",
    // Gaining a watermark is the loss here, so the comparison is inverted.
    say: (from, to) => (!from.watermark && to.watermark ? "Exports carry a watermark again" : null),
  },
  {
    key: "assistant",
    say: (from, to) => (from.assistant && !to.assistant ? "No assistant" : null),
  },
  {
    key: "saveLibrary",
    say: (from, to) => (from.saveLibrary && !to.saveLibrary ? "No saved library" : null),
  },
  {
    key: "editableOutputs",
    say: (from, to) =>
      from.editableOutputs && !to.editableOutputs ? "Outputs can no longer be edited" : null,
  },
  {
    key: "curriculumAlignment",
    say: (from, to) =>
      from.curriculumAlignment === "full" && to.curriculumAlignment === "limited"
        ? "Limited curriculum alignment"
        : null,
  },
  {
    key: "prioritySupport",
    say: (from, to) =>
      from.prioritySupport && !to.prioritySupport ? "No priority support" : null,
  },
];

/**
 * What a teacher gives up moving from one plan to another, worst first.
 *
 * DERIVED from PLANS[].limits rather than written out, and that is the whole
 * point: this text is shown at the moment someone is deciding whether to leave,
 * so a stale hand-maintained list would either understate the loss (costing us
 * a save we could have made) or overstate it (telling them they will lose
 * something they keep, which they will notice and resent).
 *
 * Returns [] when nothing gets worse, so a caller can render the panel only
 * when there is something in it.
 *
 * The credit drop is prepended separately because it comes from the spend
 * ceiling rather than from PlanLimits — see AI_SPEND_CEILING_PENCE.
 */
export function planLosses(from: PlanId, to: PlanId): string[] {
  if (from === to) return [];

  const lines: string[] = [];

  // Credits first: it is the number they actually feel, every month.
  const fromCredits = planCredits(from);
  const toCredits = planCredits(to);
  if (fromCredits !== null && toCredits !== null && toCredits < fromCredits) {
    lines.push(
      `${(fromCredits - toCredits).toLocaleString("en-GB")} fewer credits a month, ` +
        `${fromCredits.toLocaleString("en-GB")} down to ${toCredits.toLocaleString("en-GB")}`,
    );
  } else if (fromCredits !== null && toCredits === null && to === "free") {
    // Free has no credit allowance at all; it is capped by generation count,
    // which the monthlyGenerations rule below states in its own words.
    lines.push(`No monthly credits, you have ${fromCredits.toLocaleString("en-GB")} now`);
  }

  const fromLimits = PLANS[from].limits;
  const toLimits = PLANS[to].limits;

  for (const rule of LOSS_RULES) {
    const line = rule.say(fromLimits, toLimits);
    if (line) lines.push(line);
  }

  return lines;
}
