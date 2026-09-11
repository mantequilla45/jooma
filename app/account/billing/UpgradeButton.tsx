"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, planCredits, type PlanId } from "@/app/lib/plans";

// Moves an existing subscriber up a plan. Unlike the checkout button on
// /pricing, this changes the subscription they already have rather than
// starting a new one, so it never leaves them holding two.
//
// It confirms first. Every other button on this page is either reversible or
// takes you to a Stripe screen that asks again; this one charges a card
// immediately, prorated, with no further prompt. Saying what will happen before
// it happens is the difference between an upgrade and a surprise.
//
// The figures come from PLANS and planCredits() rather than being written out,
// so the sentence a teacher reads cannot drift from the ceiling actually
// enforced. See the note above PENCE_PER_CREDIT in lib/plans.ts.

export default function UpgradeButton({
  to,
  onClose,
}: {
  to: PlanId;
  /** When given, the panel is always open and this dismisses it — the plan
   *  cards own that state so the panel can render full width below the grid
   *  rather than squeezed into a ~200px card column. Without it the component
   *  keeps its own collapsed button, as it always had. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Controlled by the parent when onClose is supplied, self-managed otherwise.
  const open = onClose ? true : confirming;
  const dismiss = onClose ?? (() => setConfirming(false));

  const plan = PLANS[to];
  const credits = planCredits(to);
  const price = plan.priceMonthly?.toFixed(2) ?? null;

  async function upgrade() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: to }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (data.ok) {
        // The plan is written by the webhook, which lands a moment after this
        // returns, so refresh rather than claiming the new plan outright. The
        // page's existing "activating your plan" banner covers the gap.
        dismiss();
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

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: "var(--j-purple)", color: "#fff" }}
        >
          Upgrade to {plan.name}
        </button>
        {error && (
          <p className="text-sm mt-2" style={{ color: "#c2342b" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4 border w-full"
      style={{ backgroundColor: "var(--j-tint)", borderColor: "var(--j-line)" }}
    >
      <p className="text-sm font-semibold mb-2" style={{ color: "var(--j-ink)" }}>
        Switch to {plan.name}?
      </p>
      <ul className="text-sm mb-4 space-y-1" style={{ color: "var(--j-body)" }}>
        {credits !== null && (
          <li>
            Your monthly credits go up to {credits.toLocaleString("en-GB")}.
          </li>
        )}
        {price && <li>You&apos;ll pay £{price} a month from your next renewal.</li>}
        <li>
          Today you&apos;ll only be charged the difference for the rest of this
          month. Your billing date stays the same.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={upgrade}
          disabled={loading}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          style={{ backgroundColor: "var(--j-purple)", color: "#fff" }}
        >
          {loading ? "Switching…" : `Confirm and switch`}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            dismiss();
          }}
          disabled={loading}
          className="inline-block py-2.5 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
          style={{
            backgroundColor: "transparent",
            color: "var(--j-ink)",
            border: "1px solid var(--j-line)",
          }}
        >
          Not now
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
