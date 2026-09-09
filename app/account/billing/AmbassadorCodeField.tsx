"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Have a code?" for a teacher who already has an account.
//
// Claiming records WHO REFERRED THEM. The discount itself is applied by Stripe
// at checkout, resolved server-side from that claim, so this does not have to be
// filled in at the same moment as choosing a plan: a code entered today still
// works on a subscription started weeks later.
//
// It lives here rather than on /pricing, where it started. Nothing links to that
// page — see the note in PlanPicker — so a teacher handed a code had no way to
// reach the input. This is the page they already come to for their plan.
//
// Whether they have already claimed is a PROP, answered by OverviewTab's server
// read, rather than something this discovers from a 400 on submit. Attribution
// is first-code-wins and permanent, so an input they cannot use is worse than
// telling them plainly which code they hold.
export default function AmbassadorCodeField({
  claimedCode,
}: {
  /** The code they have already claimed, if any. */
  claimedCode?: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "good" | "bad">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const apply = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setState("checking");
    setMessage(null);
    try {
      const res = await fetch("/api/ambassadors/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState("bad");
        setMessage(json.error ?? "That code could not be applied.");
        return;
      }

      setState("good");
      setMessage(
        json.offer
          ? `${json.code} applied. ${json.offer} when you subscribe.`
          : `${json.code} applied.`,
      );
      // Re-render the server component so this collapses to the claimed state
      // rather than leaving an input that would now be refused.
      router.refresh();
    } catch {
      setState("bad");
      setMessage("Could not check that code just now.");
    }
  };

  // Already referred. Say which code, and that the discount is waiting: they
  // claimed it before subscribing, which is the normal path.
  if (claimedCode) {
    return (
      <div
        className="rounded-2xl border p-5 mt-4"
        style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
      >
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--j-ink)" }}>
          Code applied
        </p>
        <p className="text-sm" style={{ color: "var(--j-body)" }}>
          <span className="font-mono font-semibold tracking-wider">{claimedCode}</span> is on
          your account. The discount comes off your first month when you subscribe.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5 mt-4"
      style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
    >
      <p className="text-sm font-semibold mb-1" style={{ color: "var(--j-ink)" }}>
        Have a code?
      </p>
      <p className="text-sm mb-3" style={{ color: "var(--j-faint)" }}>
        If someone shared a code with you, add it here and the discount comes off your first
        month.
      </p>

      <div className="flex gap-2 max-w-md">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setState("idle");
            setMessage(null);
          }}
          placeholder="Enter your code"
          aria-label="Promo code"
          className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm border font-mono tracking-wider"
          style={{
            backgroundColor: "var(--j-bg)",
            borderColor: "var(--j-line)",
            color: "var(--j-ink)",
          }}
        />
        <button
          type="button"
          onClick={apply}
          disabled={state === "checking" || !code.trim() || state === "good"}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          style={{ backgroundColor: "var(--j-purple)", color: "#fff" }}
        >
          {state === "checking" ? "Checking…" : state === "good" ? "Applied" : "Apply"}
        </button>
      </div>

      {message && (
        <p
          className="text-sm mt-2"
          style={{ color: state === "good" ? "var(--j-purple)" : "#c2342b" }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
