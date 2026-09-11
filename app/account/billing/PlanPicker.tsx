"use client";

import { useState } from "react";
import Link from "next/link";
import PlanCard, { PlanCardGrid, type PlanCardAction } from "@/app/components/plans/PlanCard";
import {
  planCardCta,
  planCardName,
  planCardPrice,
  planCardPer,
  planFeatures,
} from "@/app/lib/plan-copy";
import { PLANS, type PlanId } from "@/app/lib/plans";
import DowngradeButton from "./DowngradeButton";
import SwitchToFreeButton from "./SwitchToFreeButton";
import UpgradeButton from "./UpgradeButton";
import CancelDowngradeButton from "./CancelDowngradeButton";

/*
 * Every plan a teacher can be on, and the way to get to each one.
 *
 * WHY ALL OF THEM, ALWAYS
 * This used to render only for people with NO subscription, and only the plans
 * above them — so a subscriber saw a single "Upgrade" button and a Max
 * subscriber saw nothing at all. Moving down was invisible: the only route off
 * Max was the red Cancel button, which reads as quitting rather than switching.
 * Showing the full ladder with the current rung marked makes every move
 * available in the same place, in both directions.
 *
 * The figures are derived — PLANS for the price, planCredits() via
 * planFeatures() for the allowance — so a card cannot advertise something the
 * ceiling will not honour. See the note above PENCE_PER_CREDIT in lib/plans.ts.
 *
 * The ACTIONS are all existing components. This decides which one belongs on
 * which card; each still owns its own confirmation and its own request.
 */

/** The plan most people should buy. Carries the badge, and the purple card. */
const FEATURED: PlanId = "pro";

export default function PlanPicker({
  /** Plans to show, cheapest first, Free included. */
  plans,
  /** The plan they are on. */
  current,
  /** Whether they have a Stripe subscription to change, as opposed to needing
   *  a fresh checkout. A free teacher who has only bought a top-up has a Stripe
   *  customer but no subscription, and must go through checkout. */
  hasSubscription = false,
  /** A scheduled downgrade, read back from Stripe by the server. */
  pendingPlan = null,
  /** When that scheduled change takes effect, already formatted. */
  pendingAt = null,
  /** The subscription is cancelling or has ended. Plan changes are hidden:
   *  renewing comes first, and swapping a plan that is about to stop would
   *  charge for something disappearing. */
  locked = false,
}: {
  plans: PlanId[];
  current: PlanId;
  hasSubscription?: boolean;
  pendingPlan?: PlanId | null;
  pendingAt?: string | null;
  locked?: boolean;
}) {
  const [pending, setPending] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The plan whose confirmation panel is open, below the grid. */
  const [changing, setChanging] = useState<PlanId | null>(null);

  async function subscribe(plan: PlanId) {
    setPending(plan);
    setError(null);
    try {
      // Checkout, not the upgrade route: this path is for teachers with no
      // subscription to swap. Someone who already subscribes gets the
      // Upgrade/Downgrade buttons instead, which change the subscription they
      // have rather than starting a second one.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        // assign(), not `location.href =`: a full navigation to Stripe's domain
        // either way, but the React compiler reads the property write as
        // mutating a value from outside the component.
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Could not start checkout.");
    } catch {
      setError("Network error. Please try again.");
    }
    // Only reached if checkout did not open, so the button can be retried.
    setPending(null);
  }

  /**
   * Which plan move a card offers, if any.
   *
   * Kept separate from rendering because a change is CONFIRMED below the grid
   * rather than inside the card: the confirmation panel carries a list of
   * consequences and a pair of buttons, and a card column is roughly 200px
   * wide, which wraps that to two or three words a line. The card starts the
   * move; the panel underneath explains it with room to be read.
   */
  function moveFor(id: PlanId): "buy" | "up" | "down" | "free" | null {
    if (id === current) return null;
    // A change is already scheduled. Offering a second one would stack
    // conflicting schedules, so every other card goes quiet until it is either
    // cancelled or lands.
    if (pendingPlan) return null;
    // Cancelling or ended: renewing comes first. Matches the gate the Overview
    // card applies to its own buttons.
    if (locked) return null;

    // Free is not a price to buy, it is where you land when a subscription
    // lapses. Only reachable from a paid plan, and only by cancelling.
    if (id === "free") return hasSubscription ? "free" : null;

    // No subscription to change — this is a purchase, not a swap.
    if (!hasSubscription) return "buy";

    return (PLANS[id].priceMonthly ?? 0) > (PLANS[current].priceMonthly ?? 0)
      ? "up"
      : "down";
  }

  function actionFor(id: PlanId): PlanCardAction {
    if (id === current) return { kind: "current" };

    const move = moveFor(id);
    if (!move) return { kind: "none" };

    if (move === "buy") {
      return {
        kind: "button",
        label: pending === id ? "Starting checkout…" : planCardCta(id),
        onClick: () => subscribe(id),
        disabled: pending !== null,
      };
    }

    // Opens the confirmation panel below the grid. Selecting the card a second
    // time closes it again, so the button is a toggle rather than a dead end.
    return {
      kind: "button",
      label:
        move === "free" ? "Switch to Free" : `Switch to ${planCardName(id)}`,
      onClick: () => setChanging(changing === id ? null : id),
      disabled: false,
    };
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold mb-3" style={{ color: "var(--j-ink)" }}>
        {/* "Choose" for someone with nothing yet; "Change" once there is a
            subscription to move, in either direction. */}
        {hasSubscription ? "Change your plan" : "Choose your plan"}
      </p>

      <PlanCardGrid columns={plans.length}>
        {plans.map((id) => {
          const isCurrent = id === current;
          const isPending = pendingPlan === id;

          // Only the two cards involved in a scheduled change say anything.
          const footer =
            isPending && pendingAt ? (
              <>
                Starts on {pendingAt}. <CancelDowngradeButton keeping={current} />
              </>
            ) : isCurrent && pendingPlan && pendingAt ? (
              <>Yours until {pendingAt}.</>
            ) : null;

          return (
            <PlanCard
              key={id}
              name={planCardName(id)}
              price={planCardPrice(id)}
              per={planCardPer(id)}
              features={planFeatures(id)}
              featured={id === FEATURED}
              badge={id === FEATURED ? "Most popular" : undefined}
              current={isCurrent}
              action={actionFor(id)}
              footer={footer}
            />
          );
        })}
      </PlanCardGrid>

      {/* The confirmation, full width beneath the cards rather than inside the
          one that was clicked. It carries a list of consequences and a pair of
          buttons, and a card column is far too narrow to read that in. */}
      {changing && (
        <div className="mt-4">
          {moveFor(changing) === "free" ? (
            <SwitchToFreeButton
              from={current}
              onClose={() => setChanging(null)}
            />
          ) : moveFor(changing) === "up" ? (
            <UpgradeButton to={changing} onClose={() => setChanging(null)} />
          ) : (
            <DowngradeButton
              from={current}
              to={changing}
              onClose={() => setChanging(null)}
            />
          )}
        </div>
      )}

      {error && (
        <p className="text-sm mt-3" role="alert" style={{ color: "#c2342b" }}>
          {error}
        </p>
      )}

      {/* Schools are sold hands-on, not self-serve: there is no seat model on
          profiles to bill against, so this is an enquiry, not a card. */}
      <p className="text-sm mt-4" style={{ color: "var(--j-faint)" }}>
        Running a whole school?{" "}
        {/* Already signed in, so this goes to the in-app form rather than the
            public page: the name and email prefill from their profile. */}
        <Link
          href="/help?tab=school"
          className="font-semibold underline transition-opacity hover:opacity-70"
          style={{ color: "var(--j-purple)" }}
        >
          Talk to us
        </Link>{" "}
        about school pricing.
      </p>
    </div>
  );
}
