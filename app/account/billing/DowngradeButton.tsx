"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, planCredits, type PlanId } from "@/app/lib/plans";
import PlanLosses from "./PlanLosses";

/*
 * Moves an existing subscriber DOWN a plan, at the end of the period they have
 * already paid for.
 *
 * It confirms first, and the confirmation is deliberately two-sided: what they
 * give up, then what actually happens. Leading with the losses is not a dark
 * pattern — it is the information they need at exactly the moment it is useful,
 * and burying it would mean someone discovering their credits had halved on the
 * 1st with no memory of agreeing to it. Both halves are derived from PLANS, so
 * neither can drift from what is enforced.
 *
 * The prominent button is "Stay on <current plan>", not the confirm. The
 * reversible choice should be the easy one; the irreversible-for-a-month one
 * should take a deliberate click. This is the inverse of UpgradeButton, where
 * the purple button is the action.
 */

export default function DowngradeButton({
  from,
  to,
  onClose,
}: {
  /** The plan they are on now. */
  from: PlanId;
  /** The cheaper plan they would move to. */
  to: PlanId;
  /** Dismiss the panel. The card that opened it owns whether it is shown, so
   *  the panel can render full width below the grid rather than squeezed into
   *  a ~200px card column. */
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = PLANS[from];
  const target = PLANS[to];
  const targetCredits = planCredits(to);
  const currentPrice = current.priceMonthly?.toFixed(2) ?? null;
  const targetPrice = target.priceMonthly?.toFixed(2) ?? null;

  async function downgrade() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/downgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: to }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (data.ok) {
        // Nothing has changed on the profile yet, by design — the schedule
        // lands at renewal. Refresh so the card picks up the pending change
        // that OverviewTab reads back from Stripe.
        onClose();
        router.refresh();
        return;
      }
      setError(data.error ?? "Could not change your plan.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-xl p-4 border w-full"
      style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
    >
      <p className="text-sm font-semibold mb-3" style={{ color: "var(--j-ink)" }}>
        Switch to {target.name}?
      </p>

      {/* The honest half, first. */}
      <PlanLosses from={from} to={to} />

      {/* The reassuring half: nothing happens today, and nothing is lost from
          the month they have already paid for. */}
      <ul className="text-sm mb-4 space-y-1" style={{ color: "var(--j-body)" }}>
        <li>You keep {current.name} until your next renewal date.</li>
        {targetCredits !== null && (
          <li>
            From then you get {targetCredits.toLocaleString("en-GB")} credits a
            month.
          </li>
        )}
        {targetPrice && currentPrice && (
          <li>
            You&apos;ll pay £{targetPrice} a month instead of £{currentPrice}.
          </li>
        )}
        <li>You can change your mind any time before then.</li>
      </ul>

      <div className="flex flex-wrap gap-2">
        {/* The prominent one is staying put. */}
        <button
          type="button"
          onClick={() => {
            setError(null);
            onClose();
          }}
          disabled={loading}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
          style={{ backgroundColor: "var(--j-purple)", color: "#fff" }}
        >
          Stay on {current.name}
        </button>
        <button
          type="button"
          onClick={downgrade}
          disabled={loading}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          style={{
            backgroundColor: "transparent",
            color: "var(--j-body)",
            border: "1px solid var(--j-line-2)",
          }}
        >
          {loading ? "Switching…" : `Switch to ${target.name}`}
        </button>
      </div>

      {error && (
        <p className="text-sm mt-2" style={{ color: "#c2342b" }}>
          {error}
        </p>
      )}
    </div>
  );
}
