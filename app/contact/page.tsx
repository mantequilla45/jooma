import type { Metadata } from "next";
import { createClient } from "@/app/lib/auth/server";
import { asEnquiryKind } from "@/app/lib/enquiry";
import ContactView from "./ContactView";

// Public: a school asking about licences has no account yet, and requiring one
// to ask about pricing loses the lead. /contact and /api/enquiries are both in
// PUBLIC_PATHS in proxy.ts, without which a signed-out visitor bounces to
// /login.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact Jooma",
  description:
    "Get in touch about Jooma, or ask about pricing for your whole school.",
  // Same apex/www duplicate as the landing page. Every public page needs its
  // own, because a canonical is per-URL and is not inherited from the layout.
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({
  searchParams,
}: {
  // ?type=school opens the school form directly, so the pricing and footer
  // links can point at the right one rather than landing everyone on Contact.
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  // Signed in is the uncommon case here but worth handling: we already know who
  // they are, so the name and email fields prefill and lock rather than asking
  // a teacher to retype what is on their profile.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let knownName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, surname")
      .eq("id", user.id)
      .maybeSingle();
    const full = `${profile?.first_name ?? ""} ${profile?.surname ?? ""}`.trim();
    knownName = full || null;
  }

  return (
    <ContactView
      initialKind={asEnquiryKind(type)}
      knownName={knownName}
      knownEmail={user?.email ?? null}
    />
  );
}
