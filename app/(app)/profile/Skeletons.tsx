// Loading shapes for the /profile sections.
//
// Local rather than imported from app/admin/ui.tsx, for the same reason
// app/account/billing/Skeletons.tsx restates them: that module is the admin
// console's design system, and a dependency from teacher UI onto admin UI is
// exactly the direction that should never exist. The house convention
// (animate-pulse over a tinted bone) is small enough to restate.
//
// Shapes must match the real content's dimensions — a skeleton that's the wrong
// height just moves the layout shift to a different moment.

import type { Section } from "./sections-shared";

function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{ backgroundColor: "var(--j-tint)", ...style }}
    />
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-3xl p-6 sm:p-8 border animate-pulse"
      style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
    >
      {children}
    </div>
  );
}

/** Avatar row + the two-up name grid + three stacked fields. */
export function PersonalInfoSkeleton() {
  return (
    <Panel>
      <Bone className="h-5 w-32 mb-6" />
      <div className="flex items-center gap-4 mb-8">
        <Bone className="rounded-full" style={{ width: 96, height: 96 }} />
        <div>
          <Bone className="h-9 w-32 rounded-xl mb-2" />
          <Bone className="h-3 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <Bone className="h-3 w-20 mb-2" />
          <Bone className="h-12 w-full rounded-xl" />
        </div>
        <div>
          <Bone className="h-3 w-20 mb-2" />
          <Bone className="h-12 w-full rounded-xl" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mb-4">
          <Bone className="h-3 w-24 mb-2" />
          <Bone className="h-12 w-full rounded-xl" />
        </div>
      ))}
      <Bone className="h-11 w-32 rounded-xl mt-2" />
    </Panel>
  );
}

/** Three stacked password fields plus the rules checklist. */
export function ChangePasswordSkeleton() {
  return (
    <Panel>
      <Bone className="h-5 w-40 mb-6" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mb-4">
          <Bone className="h-3 w-32 mb-2" />
          <Bone className="h-12 w-full rounded-xl" />
        </div>
      ))}
      <div className="space-y-2 mb-6 mt-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-3 w-44" />
        ))}
      </div>
      <Bone className="h-11 w-36 rounded-xl" />
    </Panel>
  );
}

/** Category + subject selects, then the message box. */
export function SubmitTicketSkeleton() {
  return (
    <Panel>
      <Bone className="h-5 w-32 mb-2" />
      <Bone className="h-3 w-64 mb-6" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="mb-4">
          <Bone className="h-3 w-28 mb-2" />
          <Bone className="h-12 w-full rounded-2xl" />
        </div>
      ))}
      <Bone className="h-3 w-24 mb-2" />
      <Bone className="h-40 w-full rounded-2xl mb-4" />
      <Bone className="h-11 w-32 rounded-2xl" />
    </Panel>
  );
}

/** The tab strip plus the Overview card, which is what Subscription opens on. */
export function SubscriptionSkeleton() {
  return (
    <div className="space-y-5">
      <Bone className="h-11 w-72 rounded-2xl" />
      <Panel>
        <div className="flex items-start justify-between mb-4">
          <div>
            <Bone className="h-3 w-20 mb-2" />
            <Bone className="h-6 w-28" />
          </div>
          <Bone className="h-6 w-16 rounded-full" />
        </div>
        <Bone className="h-4 w-48 mb-5" />
        <div className="flex flex-wrap gap-2">
          <Bone className="h-10 w-36 rounded-xl" />
          <Bone className="h-10 w-32 rounded-xl" />
        </div>
      </Panel>
    </div>
  );
}

/**
 * Dispatcher so the page's single Suspense boundary shows the shape of the
 * section actually being loaded, rather than one generic blob for all four.
 */
/** Two levels' worth of medallion grid, which is roughly a screenful. */
function BadgesSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <Bone className="h-6 w-40 mb-3" />
        <Bone className="h-4 w-full max-w-lg" />
      </Panel>
      {Array.from({ length: 2 }).map((_, level) => (
        <Panel key={level}>
          <Bone className="h-5 w-56 mb-5" />
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Bone className="w-16 h-17 rounded-full" />
                <Bone className="h-3 w-16" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

/** Heading, two lines of explanation, one button. Matches the idle state, which
 *  is what almost every visit to this section renders. */
export function DeleteAccountSkeleton() {
  return (
    <Panel>
      <Bone className="h-5 w-40 mb-6" />
      <Bone className="h-4 w-full max-w-md mb-3" />
      <Bone className="h-4 w-3/4 max-w-sm" />
      <Bone className="h-11 w-44 rounded-xl mt-6" />
    </Panel>
  );
}

export function SectionSkeleton({ section }: { section: Section }) {
  if (section === "subscription") return <SubscriptionSkeleton />;
  if (section === "badges") return <BadgesSkeleton />;
  if (section === "password") return <ChangePasswordSkeleton />;
  if (section === "ticket") return <SubmitTicketSkeleton />;
  if (section === "delete") return <DeleteAccountSkeleton />;
  return <PersonalInfoSkeleton />;
}
