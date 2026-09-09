import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/auth/server";

// /pricing was the logged-out marketing page. Nothing links here any more.
//
// The landing page carries its own pricing section (app/components/landing/v2/
// Pricing.tsx, anchored #pricing and linked from both the nav and the footer),
// and a signed-in teacher manages their plan in /profile. Every in-app upgrade
// prompt deliberately points there instead — see the note at the top of
// PlanPicker — so this page had no route into it and no audience.
//
// It stays alive as a REDIRECT rather than being deleted, for the same reason
// app/account/billing/page.tsx does: the URL is a Stripe return target
// (cancel_url in app/api/stripe/checkout/route.ts), so a teacher who backs out
// of checkout would otherwise land on a 404 at the worst possible moment. It may
// also be linked externally, where we cannot fix it.
//
// ALL search params are forwarded, not just recognised ones, so ?checkout=
// cancelled survives the hop.
//
// A server-component redirect() rather than a next.config.ts entry: config
// redirects are resolved before render and break the client-side transition for
// in-app links, which is what docs/instant-navigation-guide.md is about.
export default async function PricingRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out, there is no subscription section to show and /profile would only
  // bounce them to login. The landing page's own pricing section is the honest
  // destination, and the same one every other "Pricing" link on the site uses.
  if (!user) redirect("/#pricing");

  const forwarded = new URLSearchParams();
  forwarded.set("section", "subscription");

  for (const [key, value] of Object.entries(params)) {
    // `section` is ours to set; anything else the caller sent rides along.
    if (key === "section" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => forwarded.append(key, v));
    else forwarded.set(key, value);
  }

  redirect(`/profile?${forwarded.toString()}`);
}
