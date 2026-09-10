import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/app/lib/auth/server";
import { getCopy } from "@/app/lib/copy";
import { PLANS, planCredits } from "@/app/lib/plans";

import { SquircleDefs } from "@/app/components/v2/Squircle";
import LandingNav from "@/app/components/landing/v2/LandingNav";
import Hero from "@/app/components/landing/v2/Hero";
import ProblemStats from "@/app/components/landing/v2/ProblemStats";
import Showcase from "@/app/components/landing/v2/Showcase";
import {
  JoChat,
  ReadingPreview,
  SlidePreview,
} from "@/app/components/landing/v2/ShowcaseVisuals";
import Staffroom from "@/app/components/landing/v2/Staffroom";
import ToolsGrid from "@/app/components/landing/v2/ToolsGrid";
import ValueBand from "@/app/components/landing/v2/ValueBand";
import Pricing, { type PlanCard } from "@/app/components/landing/v2/Pricing";
import Faq from "@/app/components/landing/v2/Faq";
import ClosingCta from "@/app/components/landing/v2/ClosingCta";
import SiteFooter from "@/app/components/landing/v2/SiteFooter";
import styles from "@/app/components/landing/v2/landing.module.css";

export const metadata: Metadata = {
  title: "Jooma. Teaching resources, made in about a minute.",
  description:
    "Type a topic and get the slides, the worksheet and the comprehension, built around the UK curriculum. Try it on this page.",
};

/**
 * Free is gated by generation count, not credits, so it is described by the
 * count. Pro and Max quote credits, derived from their spend ceilings rather
 * than typed here, so the page cannot advertise an allowance the guard does
 * not grant.
 *
 * Schools has no price: seats, pooled credits and central billing are not
 * built, so quoting a per teacher figure would be selling something that
 * cannot be bought. It is an enquiry card.
 */
function pricingPlans(): PlanCard[] {
  const proCredits = planCredits("pro")?.toLocaleString("en-GB") ?? "1,000";
  const maxCredits = planCredits("max")?.toLocaleString("en-GB") ?? "2,500";

  return [
    {
      id: "free",
      name: "Free",
      price: "£0",
      per: "Forever",
      features: [
        "5 resources a month, 1 a day",
        "Every tool, nothing locked",
        "Watermarked exports",
        "No card needed",
      ],
      cta: "Start free",
      href: "/signup",
    },
    {
      id: "pro",
      name: "Pro",
      price: `£${PLANS.pro.priceMonthly?.toFixed(2)}`,
      per: "a month",
      features: [
        `${proCredits} credits a month`,
        "Full curriculum alignment",
        "Clean exports, no watermark",
        "Refining is always free",
        "Top up any time",
      ],
      cta: "Go Pro",
      featured: true,
      checkout: "pro",
    },
    {
      id: "max",
      name: "Max",
      price: `£${PLANS.max.priceMonthly?.toFixed(2)}`,
      per: "a month",
      features: [
        `${maxCredits} credits a month`,
        "Priority building",
        "Everything in Pro",
      ],
      cta: "Choose Max",
      checkout: "max",
    },
    {
      id: "school",
      name: "Schools",
      price: "Talk to us",
      per: "Priced by size",
      features: [
        "Credits pooled across staff",
        "Admin dashboard and usage",
        "One invoice, one renewal",
      ],
      cta: "Talk to us",
      href: "/contact?type=school",
    },
  ];
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    next?: string;
    error?: string;
    error_code?: string;
  }>;
}) {
  // OAuth fallback: if Supabase falls back to the Site URL (e.g. the exact
  // `/auth/callback` redirect wasn't allowlisted, or a www/apex mismatch), the
  // `?code=` can land here on the root. Forward it to the real callback so the
  // PKCE code still gets exchanged for a session instead of being dropped.
  const { code, next, error, error_code } = await searchParams;
  if (code) {
    const params = new URLSearchParams({ code });
    if (next) params.set("next", next);
    redirect(`/auth/callback?${params.toString()}`);
  }

  // Same fallback, failure path. A rejected sign-in lands here as
  // `?error=access_denied&error_code=user_banned`, and without this the hero
  // page renders as if nothing happened: a suspended teacher is bounced to
  // the marketing page with no explanation at all.
  //
  // Forwarded to /login, which owns the messaging. Note Supabase repeats these
  // values in the URL fragment too; the fragment never reaches the server, so
  // the login page reads that itself for the cases that arrive fragment-only.
  if (error || error_code) {
    redirect(`/login?error=${encodeURIComponent(error_code ?? error ?? "auth")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const copy = await getCopy();

  let firstName: string | null = null;
  let fullName: string | null = null;
  let avatarUrl: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, surname, avatar_url, is_admin")
      .eq("id", user.id)
      .maybeSingle();
    firstName = profile?.first_name ?? null;
    // The avatar's initials want both names; the button label wants just the
    // first, which is why both are passed rather than derived in the component.
    fullName =
      [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || null;
    avatarUrl = profile?.avatar_url ?? null;
    isAdmin = profile?.is_admin ?? false;
  }

  // `jooma-v2` is the token scope: every --j-* custom property is declared
  // against that class in globals.css, so without it on the wrapper the whole
  // page renders with unresolved variables and no styling at all.
  return (
    <div className={`jooma-v2 ${styles.page}`}>
      {/* The logo Google shows beside a search result. Without this block there
          is no machine-readable statement of what our mark is, and a crawler is
          left inferring one from the favicon, which is how a long-replaced logo
          survives in the results for months.
          Square and on a solid ground on purpose: favicon.ico and apple-icon
          are circular with transparent corners, which renders badly on a white
          card, so this points at the round-light export instead. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Jooma",
            url: "https://jooma.ai",
            logo: "https://jooma.ai/logo/Jooma-logo-v2-round-light-1024.png",
          }),
        }}
      />

      {/* The superellipse every tool tile clips to. Must live on the page
          itself: `clip-path: url(#jsq)` resolves against this document. */}
      <SquircleDefs />

      <LandingNav
        email={user?.email ?? null}
        name={firstName}
        fullName={fullName}
        avatarUrl={avatarUrl}
        isAdmin={isAdmin}
      />

      <main>
        <Hero
          eyebrow={copy["home.hero.eyebrow"]}
          headline={copy["home.hero.h1"]}
          sub={copy["home.hero.sub"]}
          reassure={copy["home.hero.reassure"]}
        />

        <ProblemStats />

        <Showcase
          alt
          eyebrow="Jooma Slides"
          title="The deck is the lesson."
          lede="Most tools hand you a plan and leave you to build the slides. Jooma builds the thing you actually stand up and teach from, then lets you edit every word of it."
          points={[
            "Twelve to twenty four slides from one line",
            "Activities embedded in the deck, not bolted on",
            "Pictures, video and listening clips where they help",
            "Themes from clean and plain to full illustration",
            "Present from Jooma, or export to PowerPoint and Slides",
          ]}
          cta={{ href: "/signup", label: "Build a deck free" }}
        >
          <SlidePreview />
        </Showcase>

        <Showcase
          reverse
          eyebrow="Comprehension"
          title="One text. Every reading age in the room."
          lede="Write the text once and Jooma rewrites it for the children who need it simpler and the ones who need stretching, questions included. No hunting for a second worksheet at ten to nine."
          points={[
            "Original texts, not scraped from anywhere",
            "Any reading age from five to sixteen",
            "Retrieval, inference and vocabulary questions",
            "Answers and common misconceptions included",
            "Print ready, or send to Google Docs",
          ]}
          cta={{ href: "/signup", label: "Make a comprehension free" }}
        >
          <ReadingPreview />
        </Showcase>

        <Showcase
          alt
          bare
          eyebrow="Ask Jo"
          title="Say what you need. Jo opens the right tool."
          lede="Thirty five tools is a lot to remember. Jo is the assistant built into Jooma. Tell it what you are teaching in plain English and it fills in the year group, the subject and the topic for you."
          points={[
            "No prompt writing and nothing to learn",
            "It asks a question back when something is unclear",
            "Knows what you taught last week, so it pitches the starter right",
            "Every answer can be saved to your library or shared",
          ]}
          cta={{ href: "/signup", label: "Try Jo free" }}
        >
          <JoChat />
        </Showcase>

        <Staffroom />

        {/* TESTIMONIALS GO HERE.
            The single biggest conversion item still missing from this page, and
            deliberately not faked: it needs a named teacher, their school and
            their photo, with permission. Drops in between the staffroom and the
            tools grid without disturbing either. */}

        <ToolsGrid />

        <ValueBand />

        <Pricing plans={pricingPlans()} />

        <Faq />

        <ClosingCta />
      </main>

      <SiteFooter />
    </div>
  );
}
