import { Suspense } from "react";
import AppShellSettings from "@/app/components/v2/AppShellSettings";
import SettingsNav from "./SettingsNav";
// asSection/SECTIONS come from a plain module, not from SettingsNav.tsx: a
// "use client" file's non-component exports arrive here as client-reference
// stubs rather than real values, so calling SECTIONS.some() on one throws at
// runtime. Same trap as app/account/billing/tabs-shared.ts.
import { asSection } from "./sections-shared";
import { SectionSkeleton } from "./Skeletons";
import ProfileHeader from "./ProfileHeader";
import PersonalInfoSection from "./PersonalInfoSection";
import SubscriptionSection from "./SubscriptionSection";
import BadgesSection from "./BadgesSection";
import ChangePasswordSection from "./ChangePasswordSection";
import SubmitTicketSection from "./SubmitTicketSection";
import DeleteAccountSection from "./DeleteAccountSection";

// Profile — everything about the account, in one place.
//
// Before this existed, a teacher could edit their name exactly once, on
// /complete-profile, and never again; there was no self-serve password change
// at all; and the only account surface was /account/billing, reachable solely
// from the avatar dropdown. Subscription is that same billing page folded in as
// a section rather than rebuilt — /account/billing now redirects here, and it
// keeps working because Stripe's return URLs point at it.
//
// This shell fetches NOTHING. Each section is its own component behind a
// Suspense boundary, so the heading, the settings menu and the chrome paint
// immediately and only the section you asked for does any work.
export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  // A Promise in this version of Next — see
  // node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
  searchParams: Promise<{
    section?: string;
    tab?: string;
    checkout?: string;
    topup?: string;
  }>;
}) {
  const { section: rawSection, tab, checkout, topup } = await searchParams;
  const section = asSection(rawSection);

  return (
    <>
      <AppShellSettings title="Profile" contentClassName="px-4 sm:px-6 lg:px-10 pb-16" />
      <ProfileHeader />

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] items-start">
        <SettingsNav active={section} />

        {/* min-w-0 so a wide table inside History scrolls in its own box rather
            than blowing the grid column out past the viewport. */}
        <div className="min-w-0">
          {/*
            key={section} is the single most important line on this page.

            All four sections render into the SAME position in the tree, so once
            one has resolved React will happily reuse that boundary for the next
            — leaving the PREVIOUS section on screen until the new one arrives.
            Changing the key forces a brand-new boundary, so the skeleton shows
            immediately on every section change.

            See docs/instant-navigation-guide.md §11.
          */}
          <Suspense key={section} fallback={<SectionSkeleton section={section} />}>
            {section === "personal" && <PersonalInfoSection />}
            {section === "subscription" && (
              <SubscriptionSection tab={tab} checkout={checkout} topup={topup} />
            )}
            {section === "badges" && <BadgesSection />}
            {section === "password" && <ChangePasswordSection />}
            {section === "ticket" && <SubmitTicketSection />}
            {section === "delete" && <DeleteAccountSection />}
          </Suspense>
        </div>
      </div>
    </>
  );
}
