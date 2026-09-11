"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PlanCard, {
  PlanCardGrid,
  type PlanCardAction,
} from "@/app/components/plans/PlanCard";
import Reveal from "./Reveal";
import shared from "./landing.module.css";
import styles from "./Pricing.module.css";

/** One row of the pricing table, as the server hands it over.
 *
 *  Named PlanCard historically, which now collides with the shared card
 *  component this renders. The component owns the name; this is the data. */
export interface PricingPlan {
  id: "free" | "pro" | "max" | "school";
  name: string;
  price: string;
  per: string;
  features: string[];
  cta: string;
  /** The purple, most-prominent card. */
  featured?: boolean;
  /** Starts a Stripe checkout for this plan instead of following a link. */
  checkout?: "pro" | "max";
  href?: string;
}


/**
 * The pricing table.
 *
 * The figures are passed in from the server, derived from PLANS, so they cannot
 * drift from what is actually charged and granted.
 *
 * Free is described by what it really is: five resources a month, one a day.
 * The V2 prototype offered "one hundred credits a month" here, which no signup
 * receives.
 *
 * The card itself is shared with /welcome and the profile's subscription
 * section, so all three look the same and only have to be styled once.
 */
export default function Pricing({ plans }: { plans: PricingPlan[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(plan: "pro" | "max") {
    setPending(plan);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      // Nobody can subscribe without an account, so send them to sign up and
      // bring them back here afterwards rather than failing silently.
      if (res.status === 401) {
        router.push(`/signup?plan=${plan}`);
        return;
      }

      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(null);
    }
  }

  function actionFor(plan: PricingPlan): PlanCardAction {
    if (plan.checkout) {
      const checkout = plan.checkout;
      return {
        kind: "button",
        label: pending === checkout ? "Starting..." : plan.cta,
        onClick: () => startCheckout(checkout),
        disabled: pending !== null,
      };
    }
    return { kind: "link", label: plan.cta, href: plan.href ?? "/signup" };
  }

  return (
    <section className={`${shared.sec} ${shared.secAlt}`} id="pricing">
      <div className={shared.shell}>
        <Reveal className={`${shared.secHead} ${shared.secHeadCentre}`}>
          <span className={shared.eyebrow}>Pricing</span>
          <h2>Start free. Upgrade when it has already saved you a Sunday.</h2>
        </Reveal>

        <Reveal>
          <PlanCardGrid columns={plans.length}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                // The Schools card is the anchor target for the Schools nav link.
                id={plan.id === "school" ? "schools" : undefined}
                name={plan.name}
                price={plan.price}
                per={plan.per}
                features={plan.features}
                featured={plan.featured}
                badge={plan.featured ? "Most popular" : undefined}
                action={actionFor(plan)}
              />
            ))}
          </PlanCardGrid>
        </Reveal>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <p className={styles.note}>
          Prices include VAT. Cancel any time, see our refund policy.
        </p>
      </div>
    </section>
  );
}
