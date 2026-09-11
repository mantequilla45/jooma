"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/app/lib/plans";

/*
 * Undoes a scheduled downgrade, so the subscription simply carries on.
 *
 * Releasing the Stripe schedule leaves the subscription exactly as it was —
 * same price, same renewal date. Nothing is being restored, because nothing had
 * changed yet: the plan move was parked in the future, and this unparks it.
 *
 * Rendered inside the plan card's footer, so it is a plain inline link rather
 * than another button competing with the card's main action.
 */

export default function CancelDowngradeButton({ keeping }: { keeping: PlanId }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelChange() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/downgrade", { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (data.ok) {
        router.refresh();
        return;
      }
      setError(data.error ?? "Could not cancel the change.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={cancelChange}
        disabled={loading}
        className="font-semibold underline transition-opacity hover:opacity-70 disabled:opacity-60 cursor-pointer"
        style={{ color: "inherit", background: "none", border: 0, padding: 0, font: "inherit" }}
      >
        {loading ? "Cancelling…" : `Keep ${PLANS[keeping].name}`}
      </button>
      {error && (
        <span className="block mt-1" style={{ color: "#c2342b" }}>
          {error}
        </span>
      )}
    </>
  );
}
