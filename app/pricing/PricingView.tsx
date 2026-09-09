"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PLANS, PRICEABLE_PLAN_IDS, planCredits, type PlanId } from "@/app/lib/plans";
import type { CopyMap } from "@/app/lib/copy";

// The plans on sale, cheapest first. Derived rather than listed: this page used
// to hardcode a Free and a Pro card and POST to checkout with no body, so it
// could not sell Max at all once Max went back on sale.
const SELLABLE: PlanId[] = PRICEABLE_PLAN_IDS.slice().sort(
  (a, b) => (PLANS[a].priceMonthly ?? 0) - (PLANS[b].priceMonthly ?? 0),
);

const FREE_FEATURES = [
  "1 generation a day, 5 a month",
  "Basic lesson format",
  "Limited curriculum alignment",
  // Export format is NOT a paid gate — every plan gets PDF and DOCX (see
  // exportFormats in plans.ts). What Free carries is the watermark, not a
  // narrower set of formats, so this line says exactly that and no more.
  "PDF & DOC export, watermarked",
];

// Per paid plan. The CREDIT line is not written here — it is derived from
// planCredits() below, so what is advertised cannot drift from the ceiling
// actually enforced.
//
// NB: "unlimited" would be a promise we don't keep — every paid plan carries a
// monthly allowance and blocks (with a top-up offer) when it runs out.
/** Button label per plan. The badge above already carries the full plan name,
 *  so "Choose Pro Teacher" says it twice. */
const PAID_CTA: Record<string, string> = {
  pro: "Go Pro",
  max: "Choose Max",
};

const PAID_FEATURES: Record<string, string[]> = {
  pro: [
    "Top up any time if you run out",
    "Full curriculum alignment",
    "Editable outputs",
    // Not "PDF & DOC export" — Free has that too, so listing it here read as a
    // paid-only benefit that isn't one. The real export difference is the
    // watermark coming off.
    "Export without the watermark",
    "Assistant built in",
    "Save library",
    "Priority support",
  ],
  max: ["Priority building", "Everything in Pro"],
};

// Prices come from PLANS; only the wording around them is editable in
// /admin/copy. The two strings arrive as props because this component needs
// useRouter/useState for checkout and so cannot read copy server-side itself —
// app/lib/copy.ts is server-only. The server wrapper is app/pricing/page.tsx.
export default function PricingView({
  copy,
}: {
  copy: Pick<CopyMap, "pricing.headline" | "pricing.sub">;
}) {
  const router = useRouter();
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade(plan: PlanId) {
    setUpgrading(plan);
    setError(null);
    try {
      // Billing is monthly-only, but the plan MUST be named: without a body the
      // route falls back to Pro, which is how this page silently sold Pro to
      // anyone who pressed the Max button.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        router.push("/login?next=/pricing");
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        // Hand off to Stripe Checkout. assign(), not `location.href =`, which
        // the React compiler reads as mutating a value from outside the
        // component.
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    // Only reached if checkout did not open, so the button can be retried.
    setUpgrading(null);
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-8 px-4" style={{ backgroundColor: "var(--j-tint)" }}>
      <div className="max-w-6xl mx-auto w-full">

        {/* Brand wordmark */}
        <p className="text-center text-xl font-semibold mb-4" style={{ color: "#a8a39a" }}>
          Jooma
        </p>

        {/* Heading */}
        <div className="text-center mb-5">
          {/* text-balance in place of the old hard <br /> — see app/lib/copy.ts */}
          <h1
            className="text-3xl md:text-4xl font-bold tracking-tight mb-3 text-balance max-w-2xl mx-auto"
            style={{ color: "var(--j-purple)" }}
          >
            {copy["pricing.headline"]}
          </h1>
          <p className="text-sm max-w-xl mx-auto" style={{ color: "var(--j-faint)" }}>
            {copy["pricing.sub"]}
          </p>
        </div>

        {/* Cards. One per sellable plan plus Free, so adding a tier needs no
            change here. */}
        <div
          className="grid grid-cols-1 gap-5 max-w-5xl mx-auto"
          style={{
            gridTemplateColumns: `repeat(auto-fit, minmax(15rem, 1fr))`,
          }}
        >

          {/* Free */}
          <PlanCard
            badge={PLANS.free.name}
            badgeBg="var(--j-tint)"
            badgeInk="var(--j-faint)"
            price="£0"
            priceSuffix="/month"
            cardBg="var(--j-card)"
            cardBorder="var(--j-line)"
            cta="Start for Free"
            ctaHref="/signup"
            ctaBg="var(--j-purple)"
            ctaInk="#fff"
            features={FREE_FEATURES}
            featureInk="#3a2f28"
            includesInk="var(--j-purple)"
            bulletInk="#3a2f28"
          />

          {SELLABLE.map((id) => {
            const plan = PLANS[id];
            const credits = planCredits(id);
            // The credit line leads: it is the difference between the paid
            // plans, and it is derived rather than written down.
            const features = [
              ...(credits !== null
                ? [`${credits.toLocaleString("en-GB")} credits a month`]
                : []),
              ...(PAID_FEATURES[id] ?? []),
            ];

            return (
              <PlanCard
                key={id}
                badge={plan.name}
                badgeBg="var(--j-tint)"
                badgeInk="var(--j-purple)"
                price={`£${plan.priceMonthly?.toFixed(2)}`}
                priceSuffix="/month"
                cardBg="var(--j-card)"
                cardBorder="var(--j-line)"
                cta={
                  upgrading === id
                    ? "Starting checkout…"
                    : (PAID_CTA[id] ?? `Choose ${plan.name}`)
                }
                onCtaClick={() => handleUpgrade(id)}
                ctaDisabled={upgrading !== null}
                ctaBg="var(--j-purple)"
                ctaInk="#fff"
                features={features}
                featureInk="#3a2f28"
                includesInk="var(--j-purple)"
                bulletInk="#3a2f28"
              />
            );
          })}

        </div>

        {/* An ambassador code, for a teacher who already has an account.
            Claiming is once-only and permanent, so this quietly disappears for
            anyone who has already used one. */}
        <AmbassadorCodeField />

        {/* Checkout error */}
        {error && (
          <p className="text-center text-sm mt-4" style={{ color: "#c2342b" }}>{error}</p>
        )}

        {/* Schools are sold hands-on, not self-serve. */}
        <p className="text-center text-sm mt-6" style={{ color: "var(--j-faint)" }}>
          Running a whole school?{" "}
          <Link
            href="/contact?type=school"
            className="font-semibold underline transition-opacity hover:opacity-70"
            style={{ color: "var(--j-purple)" }}
          >
            Talk to us
          </Link>{" "}
          about school pricing.
        </p>

        {/* Back */}
        <div className="flex justify-center mt-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold transition-colors hover:opacity-70"
            style={{ color: "var(--j-purple)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>

      </div>
    </div>
  );
}

/**
 * "Have a code?" for a teacher who already has an account.
 *
 * Claiming records who referred them; the discount itself is applied by Stripe
 * at checkout, from that claim. So this does not need to be filled in at the
 * same moment as pressing a plan button, and a code taken today still works on a
 * subscription started later.
 *
 * Renders nothing at all for a signed-out visitor or for someone who has already
 * used a code, since neither can do anything with it. The check route answers
 * both cases, so this never has to guess.
 */
function AmbassadorCodeField() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "good" | "bad">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const apply = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setState("checking");
    try {
      const res = await fetch("/api/ambassadors/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        // Nothing to attach a code to yet. Not an error worth shouting about.
        setHidden(true);
        return;
      }
      if (!res.ok) {
        setState("bad");
        setMessage(json.error ?? "That code could not be applied.");
        return;
      }
      setState("good");
      setMessage(
        json.offer
          ? `${json.code} applied. ${json.offer} on your first month.`
          : `${json.code} applied.`,
      );
    } catch {
      setState("bad");
      setMessage("Could not check that code just now.");
    }
  };

  if (hidden) return null;

  return (
    <div className="max-w-md mx-auto mt-8 text-center">
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setState("idle");
            setMessage(null);
          }}
          placeholder="Have a code?"
          aria-label="Promo code"
          className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm border font-mono tracking-wider"
          style={{
            backgroundColor: "var(--j-card)",
            borderColor: "var(--j-line)",
            color: "var(--j-ink)",
          }}
        />
        <button
          type="button"
          onClick={apply}
          disabled={state === "checking" || !code.trim() || state === "good"}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
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

function PlanCard({
  badge, badgeBg, badgeInk,
  price, priceSuffix,
  cardBg, cardBorder,
  cta, ctaHref, onCtaClick, ctaDisabled, ctaBg, ctaInk,
  features, featureInk, includesInk, bulletInk,
}: {
  badge: string; badgeBg: string; badgeInk: string;
  price: string; priceSuffix?: string;
  cardBg: string; cardBorder: string;
  cta: string; ctaHref?: string; onCtaClick?: () => void; ctaDisabled?: boolean;
  ctaBg: string; ctaInk: string;
  features: string[]; featureInk: string; includesInk: string; bulletInk: string;
}) {
  const isMailto = ctaHref?.startsWith("mailto:") ?? false;
  const ctaClass = "block w-full text-center py-2.5 rounded-xl text-sm font-semibold mb-5 transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed";
  const ctaStyle = { backgroundColor: ctaBg, color: ctaInk };

  return (
    <div
      className="rounded-2xl p-6 flex flex-col border"
      style={{ backgroundColor: cardBg, borderColor: cardBorder }}
    >
      {/* Badge */}
      <div className="flex justify-center mb-4">
        <span
          className="inline-block text-xs font-semibold px-3 py-1 rounded-full"
          style={{ backgroundColor: badgeBg, color: badgeInk }}
        >
          {badge}
        </span>
      </div>

      {/* Price */}
      <div className="text-center mb-4">
        <span className="text-3xl font-bold tracking-tight" style={{ color: "var(--j-purple)" }}>
          {price}
        </span>
        {priceSuffix && (
          <span className="text-base font-medium" style={{ color: "var(--j-purple)" }}>{priceSuffix}</span>
        )}
      </div>

      <div className="h-px mb-4" style={{ backgroundColor: cardBorder }} />

      {/* CTA */}
      {onCtaClick ? (
        <button type="button" onClick={onCtaClick} disabled={ctaDisabled} className={ctaClass} style={ctaStyle}>{cta}</button>
      ) : isMailto ? (
        <a href={ctaHref} className={ctaClass} style={ctaStyle}>{cta}</a>
      ) : (
        <Link href={ctaHref!} className={ctaClass} style={ctaStyle}>{cta}</Link>
      )}

      {/* Includes */}
      <div className="rounded-xl flex-1">
        <p className="text-sm font-semibold mb-3" style={{ color: includesInk }}>Includes:</p>
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm" style={{ color: featureInk }}>
              <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: bulletInk }} />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
