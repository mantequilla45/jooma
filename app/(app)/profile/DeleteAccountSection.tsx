"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/app/lib/auth/client";
import { useBadgeProgress } from "@/app/lib/useBadgeProgress";
import DeleteAccountModal, { type MissOutStats } from "./DeleteAccountModal";

// The Delete account section, with two resting states: idle, and scheduled.
//
// Nothing here is gated while a deletion is pending. The teacher keeps full
// access for the whole 30 days, because a grace period exists to be reversed
// and somebody who cannot use the product cannot rediscover that they want it.
// The only other change anywhere in the app is the banner in the shell.
//
// The counts behind "what you lose" are read straight from the browser under
// RLS rather than through a route: every one of them is the teacher's own data,
// already readable by this session, and an endpoint in front of them would add
// a hop without adding a check. Same reasoning as PersonalInfoSection's avatar
// upload.

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const REASON_LABELS: Record<string, string> = {
  too_expensive: "It costs too much",
  not_using: "Not using it enough",
  missing_feature: "Missing something I need",
  found_alternative: "Found something else",
  privacy: "Concerns about my data",
  other: "Something else",
};

interface PendingRequest {
  scheduledFor: string;
  reasonCode: string;
  reasonText: string | null;
  subscriptionPaused: boolean;
}

export default function DeleteAccountSection() {
  const badges = useBadgeProgress();

  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the counts that need their own query live in state. Resources, badges
  // and the streak are derived during render from the shared badge store below,
  // because copying them into state through an effect is a cascading render for
  // no gain: the store already re-renders every consumer when it loads.
  const [owned, setOwned] = useState<
    Pick<MissOutStats, "folders" | "colleagues" | "timetableLessons" | "paidUntil" | "plan">
  >({
    folders: null,
    colleagues: null,
    timetableLessons: null,
    paidUntil: null,
    plan: null,
  });

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, requestRes, folderRes, colleagueRes, lessonRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("is_admin, plan, current_period_end")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("account_deletion_requests")
        .select("scheduled_for, reason_code, reason_text, subscription_paused")
        .eq("status", "pending")
        .maybeSingle(),
      supabase.from("folders").select("id", { count: "exact", head: true }),
      supabase.from("colleague_edges").select("id", { count: "exact", head: true }),
      supabase.from("timetable_lessons").select("id", { count: "exact", head: true }),
    ]);

    setIsAdmin(Boolean(profileRes.data?.is_admin));

    if (requestRes.data) {
      setPending({
        scheduledFor: requestRes.data.scheduled_for,
        reasonCode: requestRes.data.reason_code,
        reasonText: requestRes.data.reason_text,
        subscriptionPaused: Boolean(requestRes.data.subscription_paused),
      });
    } else {
      setPending(null);
    }

    // A null count means the query failed, usually because the migration behind
    // that table is not applied yet. Null stays null and the line is omitted,
    // rather than rendering a confident zero.
    setOwned({
      folders: folderRes.count ?? null,
      colleagues: colleagueRes.count ?? null,
      timetableLessons: lessonRes.count ?? null,
      plan: profileRes.data?.plan ?? null,
      paidUntil: profileRes.data?.current_period_end ?? null,
    });
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Badges, streak and the run count come from the shared store rather than a
  // fourth query: three other surfaces already have them loaded. Derived here
  // rather than copied into state, so there is one source of truth and no
  // second render to get there.
  const stats: MissOutStats = {
    ...owned,
    resources: badges.loading ? null : badges.runs.length,
    badges: badges.available ? badges.earnedCount : null,
    streak: badges.available ? badges.currentStreak : null,
  };

  const handleScheduled = (scheduledFor: string) => {
    setModalOpen(false);
    void load();
    setPending((prev) => prev ?? { scheduledFor, reasonCode: "", reasonText: null, subscriptionPaused: false });
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    const supabase = createClient();

    // A definer RPC, so this needs no route: auth.uid() inside the function is
    // the whole authorisation and there are no parameters to get wrong.
    const { data, error: rpcError } = await supabase.rpc("cancel_my_account_deletion");

    if (rpcError) {
      setError("Could not cancel the deletion. Please try again.");
      setCancelling(false);
      return;
    }

    // Restart the subscription we paused on the way in. Only when we actually
    // paused one: a teacher who had already cancelled their own subscription
    // before deciding to leave must not find it quietly resumed.
    if (data === true && pending?.subscriptionPaused) {
      try {
        await fetch("/api/stripe/resume", { method: "POST" });
      } catch {
        // The deletion IS cancelled, which is what they clicked. Billing is
        // recoverable from the subscription page; say so rather than implying
        // the account is still going to be deleted.
        setError("Your account is safe, but we could not restart your plan. Check the Plan and usage page.");
      }
    }

    setPending(null);
    setCancelling(false);
    void load();
  };

  if (!loaded) {
    return (
      <div
        className="rounded-3xl p-6 sm:p-8 border animate-pulse"
        style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
      >
        <div className="h-5 w-40 rounded mb-6" style={{ backgroundColor: "var(--j-tint)" }} />
        <div className="h-4 w-full max-w-md rounded mb-3" style={{ backgroundColor: "var(--j-tint)" }} />
        <div className="h-11 w-44 rounded-xl mt-6" style={{ backgroundColor: "var(--j-tint)" }} />
      </div>
    );
  }

  return (
    <div
      className="rounded-3xl p-6 sm:p-8 border"
      style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
    >
      <h2 className="text-lg font-bold mb-6" style={{ color: "var(--j-ink)" }}>
        Delete account
      </h2>

      {isAdmin ? (
        <p className="text-sm max-w-lg" style={{ color: "var(--j-body)" }}>
          Admin accounts cannot be deleted from here. Ask another admin to close
          your account for you.
        </p>
      ) : pending ? (
        <>
          <div
            className="rounded-2xl p-4 mb-5"
            style={{ backgroundColor: "var(--j-tint)" }}
          >
            <p className="text-sm mb-1" style={{ color: "var(--j-ink)" }}>
              Your account is scheduled for deletion on{" "}
              <strong>{formatDate(pending.scheduledFor)}</strong>.
            </p>
            <p className="text-sm" style={{ color: "var(--j-body)" }}>
              Everything still works until then. Change your mind and one click
              puts it back exactly as it was.
            </p>
          </div>

          {pending.reasonCode && REASON_LABELS[pending.reasonCode] && (
            <p className="text-sm mb-1" style={{ color: "var(--j-body)" }}>
              <span style={{ color: "var(--j-faint)" }}>Reason given: </span>
              {REASON_LABELS[pending.reasonCode]}
            </p>
          )}
          {pending.reasonText && (
            <p className="text-sm mb-5 whitespace-pre-wrap" style={{ color: "var(--j-body)" }}>
              {pending.reasonText}
            </p>
          )}

          {error && <p className="mb-4 text-sm font-light" style={{ color: "#c2342b" }}>{error}</p>}

          {/* No confirmation dialog on the undo. Asking somebody to confirm that
              they want to KEEP their account is user-hostile. */}
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelling}
            className="mt-2 px-8 py-3 rounded-xl text-sm font-medium text-white transition-colors disabled:bg-(--j-tint) disabled:text-(--j-faint) disabled:cursor-default bg-(--j-purple) hover:bg-(--j-deep) cursor-pointer"
          >
            {cancelling ? "Cancelling..." : "Keep my account"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm max-w-lg mb-2" style={{ color: "var(--j-body)" }}>
            Deleting your account removes your resources, slideshows, timetable
            and badges for good.
          </p>
          <p className="text-sm max-w-lg" style={{ color: "var(--j-body)" }}>
            Nothing happens straight away. We hold your account for 30 days
            first, so there is time to change your mind.
          </p>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-6 px-8 py-3 rounded-xl text-sm font-medium border transition-colors cursor-pointer hover:bg-red-50"
            style={{ color: "#c2342b", borderColor: "#e8b4b0" }}
          >
            Delete my account
          </button>

          <DeleteAccountModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onScheduled={handleScheduled}
            stats={stats}
          />
        </>
      )}
    </div>
  );
}
