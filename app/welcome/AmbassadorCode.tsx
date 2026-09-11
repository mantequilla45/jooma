"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PlanCard, { PlanCardGrid } from "@/app/components/plans/PlanCard";
import {
  planCardCta,
  planCardName,
  planCardPer,
  planCardPrice,
  planFeatures,
} from "@/app/lib/plan-copy";
import styles from "./ambassador.module.css";

/*
 * "Got a code?" on the first screen a new teacher sees.
 *
 * Two separate things happen here, and keeping them apart is the point:
 *
 *   CLAIMING records who referred this teacher. It happens once, immediately,
 *   and never expires. Whether they pick Free or a paid plan, the ambassador
 *   gets the credit.
 *
 *   The DISCOUNT is Stripe's, and is applied at checkout from the claim. So
 *   somebody can take a code today, choose Free, and subscribe next month with
 *   the discount still waiting for them. Nothing has to be retyped, and the code
 *   does not have to be remembered.
 *
 * This component therefore never grants anything. It calls two server routes
 * that do all the deciding, because a client that could name its own plan or
 * discount would be a self-service upgrade.
 */

type Checked =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "good"; code: string; offer: string | null }
  | { state: "bad"; message: string };

/** The plans offered here, cheapest first. Every figure and line of copy comes
 *  from lib/plan-copy, which derives them from PLANS and the spend ceiling —
 *  these were once hardcoded as "£7.99" and "£14.99" and could silently drift
 *  from what Stripe actually charges. */
const OFFERED = ["free", "pro", "max"] as const;

/** The plan most people should buy: the purple card with the badge. */
const FEATURED = "pro";

/** A code stashed earlier in the funnel by /signup?code=JAMIE20. Returns "" on
 *  the server, where there is no sessionStorage to read. */
function readStash(): string {
  if (typeof window === "undefined") return "";
  try {
    return (sessionStorage.getItem("jooma:ambassador-code") ?? "").toUpperCase();
  } catch {
    // Private browsing and blocked site data both throw on access.
    return "";
  }
}

export default function AmbassadorCode({ initialCode }: { initialCode?: string }) {
  const router = useRouter();

  /*
   * A code stashed three navigations ago, read in a lazy state initializer.
   *
   * This is the same shape as useLocalStorage in app/lib, and it is safe for
   * the same reason: teachers reach /welcome by client-side navigation from
   * /complete-profile, so this mounts fresh rather than hydrating server HTML.
   * readStash also returns "" on the server, which is what the collapsed
   * prompt renders from anyway.
   *
   * Two other approaches were tried and are worth not repeating. An effect that
   * copies the value into state is a cascading render the lint rule rejects.
   * useSyncExternalStore looks like the right tool for external state, but its
   * getSnapshot returns a fresh string on every call, so React either loops or,
   * with a stable server snapshot, never adopts the client value at all: the
   * stashed code silently never arrived, which is what the browser test caught.
   */
  const [arrived] = useState(() => initialCode?.toUpperCase() ?? readStash());

  const [typed, setTyped] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  // What is in the box: what they have typed wins over what arrived with them.
  const code = typed ?? arrived;
  const setCode = (next: string) => setTyped(next);

  // Expanded when a code arrived with them, or once they ask for it.
  const open = opened || arrived !== "";

  const [checked, setChecked] = useState<Checked>({ state: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setChecked({ state: "idle" });
      return;
    }
    setChecked({ state: "checking" });
    try {
      const res = await fetch(`/api/ambassadors/check?code=${encodeURIComponent(trimmed)}`);
      const json = await res.json();
      if (json?.valid) {
        setChecked({ state: "good", code: json.code, offer: json.offer ?? null });
        return;
      }
      setChecked({
        state: "bad",
        message:
          json?.reason === "already_claimed"
            ? "You have already used a code on this account."
            : json?.reason === "inactive"
              ? "That code is no longer being offered."
              : "That code is not recognised.",
      });
    } catch {
      setChecked({ state: "bad", message: "Could not check that code just now." });
    }
  };

  /**
   * Claim, then go where they asked.
   *
   * The claim is deliberately made for Free as well as for a paid plan: tracking
   * a referral who never pays is the whole reason the ambassador table has an
   * N/A state. It just does not earn a payout.
   */
  const choose = async (plan: "free" | "pro" | "max") => {
    setBusy(plan);
    setError(null);

    try {
      if (checked.state === "good") {
        const res = await fetch("/api/ambassadors/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: checked.code }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          // Not fatal. They still get an account and can still subscribe; only
          // the referral failed, so say so and carry on rather than trapping
          // them on this screen.
          setError(json.error ?? "That code could not be applied.");
          setBusy(null);
          return;
        }
        // Spent. Navigation happens immediately below, so nothing re-reads the
        // store; this only stops a stale code following them around if they
        // come back. Guarded like every other access: blocked site data throws.
        try {
          sessionStorage.removeItem("jooma:ambassador-code");
        } catch {
          /* nothing to clear */
        }
      }

      if (plan === "free") {
        router.push("/tools");
        return;
      }

      // Checkout resolves the discount from the claim above, server-side. No
      // code is sent from here: one named by the client would be an open
      // discount anybody could apply.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (json.url) {
        window.location.assign(json.url);
        return;
      }
      setError(json.error ?? "Could not start checkout.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(null);
  };

  if (!open) {
    return (
      <button type="button" className={styles.prompt} onClick={() => setOpened(true)}>
        Got a code from someone? Add it here
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="Promo code">
      <div className={styles.row}>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setChecked({ state: "idle" });
          }}
          onBlur={(e) => check(e.target.value)}
          placeholder="Enter your code"
          aria-label="Your code"
          className={styles.input}
        />
        <button
          type="button"
          className={styles.apply}
          onClick={() => check(code)}
          disabled={checked.state === "checking" || !code.trim()}
        >
          {checked.state === "checking" ? "Checking…" : "Apply"}
        </button>
      </div>

      {checked.state === "good" && (
        <p className={styles.good}>
          {checked.offer
            ? `${checked.code} applied. ${checked.offer} when you subscribe.`
            : `${checked.code} applied.`}
        </p>
      )}
      {checked.state === "bad" && <p className={styles.bad}>{checked.message}</p>}

      <PlanCardGrid columns={OFFERED.length} className={styles.plans}>
        {OFFERED.map((id) => (
          <PlanCard
            key={id}
            compact
            name={planCardName(id)}
            price={planCardPrice(id)}
            per={planCardPer(id)}
            features={planFeatures(id)}
            featured={id === FEATURED}
            badge={id === FEATURED ? "Most popular" : undefined}
            action={{
              kind: "button",
              label: busy === id ? "Just a moment…" : planCardCta(id),
              onClick: () => choose(id),
              disabled: busy !== null,
            }}
          />
        ))}
      </PlanCardGrid>

      <p className={styles.note}>
        You can start free and subscribe later. Your code stays on your account either way.
      </p>

      {error && (
        <p className={styles.bad} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
