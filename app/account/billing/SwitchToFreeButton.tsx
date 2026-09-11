"use client";

import { useState } from "react";
import { type PlanId, PLANS } from "@/app/lib/plans";
import PlanLosses from "./PlanLosses";

/*
 * "Switch to Free" — the same thing as cancelling, framed as what it actually
 * is: a move to the Free plan.
 *
 * WHY THIS ISN'T A NEW ROUTE
 * It hands off to the SAME Stripe portal cancel flow the red "Cancel
 * subscription" button has always used. Stripe schedules rather than cancels, so
 * the teacher keeps their paid plan to the end of the period and the webhook
 * writes Free when the subscription finally closes. ResumeButton already undoes
 * it. Every piece of that works; the only thing missing was somewhere to press
 * it that did not read as quitting.
 *
 * What this adds on top is the losses panel — dropping to Free costs a great
 * deal more than dropping a tier, and that is worth showing before they arrive
 * at Stripe's own confirmation screen rather than after.
 */

export default function SwitchToFreeButton({
  from,
  onClose,
}: {
  from: PlanId;
  /** Dismiss the panel; the card that opened it owns whether it is shown. */
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = PLANS[from];

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "subscription_cancel" }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not open the billing portal.");
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
        Switch to Free?
      </p>

      <PlanLosses from={from} to="free" />

      <ul className="text-sm mb-4 space-y-1" style={{ color: "var(--j-body)" }}>
        <li>You keep {current.name} until your next renewal date.</li>
        <li>You won&apos;t be charged again.</li>
        <li>
          Everything you have already made stays where it is, and you can
          resubscribe any time.
        </li>
      </ul>

      <div className="flex flex-wrap gap-2">
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
          onClick={openPortal}
          disabled={loading}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          style={{
            backgroundColor: "transparent",
            color: "var(--j-body)",
            border: "1px solid var(--j-line-2)",
          }}
        >
          {loading ? "Opening…" : "Continue to Free"}
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
