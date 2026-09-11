"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/app/components/Modal";
import { INPUT_CLASS } from "@/app/components/ui/FormFields";

// The three step deletion flow.
//
// WHY THE ORDER IS WHAT IT IS
//
// 0. What you lose  1. Why are you leaving  2. Confirm
//
// The reason question sits in the MIDDLE deliberately. Asking first and then
// showing what they lose makes the second step read as a rebuttal to what they
// just typed, which is manipulative. Asking last, after the confirmation, means
// we never hear from anyone who abandons at the confirm step, which is exactly
// the group worth hearing from.
//
// WHY Modal AND NOT ConfirmModal
//
// ConfirmModal is fixed at min(400px, 95vw) with a fixed two-button footer and
// grey Tailwind defaults. This needs three panes, its own footer per step, and
// the profile card's palette.

export interface MissOutStats {
  resources: number | null;
  badges: number | null;
  streak: number | null;
  folders: number | null;
  colleagues: number | null;
  timetableLessons: number | null;
  /** ISO date the current paid period runs to, when there is one. */
  paidUntil: string | null;
  plan: string | null;
}

const REASONS = [
  { code: "too_expensive", label: "It costs too much" },
  { code: "not_using", label: "I'm not using it enough" },
  { code: "missing_feature", label: "It's missing something I need" },
  { code: "found_alternative", label: "I found something else" },
  { code: "privacy", label: "Concerns about my data" },
  { code: "other", label: "Something else" },
] as const;

type ReasonCode = (typeof REASONS)[number]["code"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** One line of the "what you lose" list. Rendered only when the count is real
 *  and non-zero: "You will lose 0 badges" is an argument for leaving. */
function LossLine({ count, one, many }: { count: number | null; one: string; many: string }) {
  if (count === null || count === 0) return null;
  return (
    <li className="flex items-baseline gap-2">
      <span className="font-bold tabular-nums" style={{ color: "var(--j-purple)" }}>
        {count}
      </span>
      <span style={{ color: "var(--j-body)" }}>{count === 1 ? one : many}</span>
    </li>
  );
}

export default function DeleteAccountModal({
  open,
  onClose,
  onScheduled,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: (scheduledFor: string) => void;
  stats: MissOutStats;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close so reopening starts at step 0 rather than wherever they left
  // off. A half-filled deletion form resuming itself would be unnerving.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setStep(0);
      setReasonCode(null);
      setReasonText("");
      setConfirmWord("");
      setError(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  // Computed in an effect rather than during render because Date.now() is
  // impure: called in the render body it would produce a different answer on
  // every re-render, and the date a teacher is about to agree to must not drift
  // while they are reading it. The server recomputes it anyway and its answer is
  // the one that binds; this is the preview.
  const [deletionDate, setDeletionDate] = useState("");
  useEffect(() => {
    if (!open) return;
    setDeletionDate(formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()));
  }, [open]);

  const nothingToLose =
    !stats.resources && !stats.badges && !stats.folders && !stats.colleagues && !stats.timetableLessons;

  const canSubmitReason =
    reasonCode !== null && (reasonCode !== "other" || reasonText.trim().length > 0);

  const submit = async () => {
    if (confirmWord !== "DELETE" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasonCode,
          reasonText: reasonText.trim() || null,
          confirm: "DELETE",
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // 409 means it is already scheduled, which is a success from the
        // teacher's point of view: the outcome they asked for is in place.
        if (res.status === 409 && data?.scheduledFor) {
          onScheduled(data.scheduledFor);
          return;
        }
        setError(data?.error ?? "Could not schedule the deletion.");
        setBusy(false);
        return;
      }

      onScheduled(data.scheduledFor);
    } catch {
      setError("Could not reach the server. Please try again.");
      setBusy(false);
    }
  };

  // Dismissing mid-request would leave the teacher unsure whether it went
  // through. Every other step closes freely.
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} width="min(560px, 95vw)">
      <div className="p-6 sm:p-8">
        {step === 0 && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--j-ink)" }}>
              Before you go
            </h2>
            <p className="text-sm mb-5" style={{ color: "var(--j-body)" }}>
              {nothingToLose
                ? "Deleting your account removes it for good. Here is what that means."
                : "Deleting your account means losing all of this:"}
            </p>

            {!nothingToLose && (
              <ul className="space-y-2 text-sm mb-5">
                <LossLine count={stats.resources} one="saved resource" many="saved resources" />
                <LossLine count={stats.folders} one="library folder" many="library folders" />
                <LossLine count={stats.badges} one="badge earned" many="badges earned" />
                <LossLine count={stats.streak} one="day streak" many="day streak" />
                <LossLine count={stats.timetableLessons} one="lesson on your timetable" many="lessons on your timetable" />
                <LossLine count={stats.colleagues} one="colleague connection" many="colleague connections" />
              </ul>
            )}

            <div
              className="rounded-2xl p-4 mb-6"
              style={{ backgroundColor: "var(--j-tint)" }}
            >
              <p className="text-sm" style={{ color: "var(--j-ink)" }}>
                None of this can be brought back after deletion, even if you sign
                up again with the same email address.
              </p>
            </div>

            {/* Keep is the primary action here, and Continue is the quiet one.
                That asymmetry is the entire point of this step: if Continue were
                the purple button, the step would just be a speed bump. */}
            <div className="flex flex-wrap gap-3 justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-colors bg-(--j-purple) hover:bg-(--j-deep) cursor-pointer"
              >
                Keep my account
              </button>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-6 py-3 rounded-xl text-sm font-medium border transition-colors hover:bg-(--j-tint) cursor-pointer"
                style={{ color: "var(--j-body)", borderColor: "var(--j-line-2)" }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--j-ink)" }}>
              Why are you leaving?
            </h2>
            <p className="text-sm mb-5" style={{ color: "var(--j-body)" }}>
              This helps us make Jooma better for other teachers.
            </p>

            <div role="radiogroup" aria-label="Reason for leaving" className="space-y-2 mb-4">
              {REASONS.map(({ code, label }) => {
                const selected = reasonCode === code;
                return (
                  <button
                    key={code}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setReasonCode(code)}
                    className="w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer"
                    style={{
                      borderColor: selected ? "var(--j-purple)" : "var(--j-line-2)",
                      backgroundColor: selected ? "var(--j-tint)" : "transparent",
                      color: "var(--j-ink)",
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* The off-ramp. Most of the retention value in this whole flow is
                here: a teacher who is leaving over price or a missing feature
                has a problem we can sometimes solve. */}
            {reasonCode === "too_expensive" && stats.plan && stats.plan !== "free" && (
              <p className="text-sm mb-4" style={{ color: "var(--j-body)" }}>
                Would switching to the free plan work instead?{" "}
                <Link href="/profile?section=subscription" className="font-semibold underline" style={{ color: "var(--j-purple)" }}>
                  Look at plans
                </Link>
              </p>
            )}
            {reasonCode === "missing_feature" && (
              <p className="text-sm mb-4" style={{ color: "var(--j-body)" }}>
                Tell us what is missing and we will look at it.{" "}
                <Link href="/profile?section=ticket" className="font-semibold underline" style={{ color: "var(--j-purple)" }}>
                  Send us a note
                </Link>
              </p>
            )}
            {reasonCode === "privacy" && (
              <p className="text-sm mb-4" style={{ color: "var(--j-body)" }}>
                Our{" "}
                <Link href="/privacy" className="font-semibold underline" style={{ color: "var(--j-purple)" }}>
                  privacy policy
                </Link>{" "}
                sets out exactly what we hold and why.
              </p>
            )}

            <label htmlFor="deletion-reason-text" className="block text-sm font-medium mb-1.5" style={{ color: "var(--j-ink)" }}>
              Anything else you want to tell us?
              {reasonCode === "other" && <span style={{ color: "#c2342b" }}> *</span>}
            </label>
            <textarea
              id="deletion-reason-text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value.slice(0, 2000))}
              rows={3}
              className={`${INPUT_CLASS} resize-y`}
              placeholder={reasonCode === "other" ? "Tell us what happened" : "Optional"}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--j-faint)" }}>
              {reasonText.length}/2000
            </p>

            <div className="flex flex-wrap gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="px-6 py-3 rounded-xl text-sm font-medium border transition-colors hover:bg-(--j-tint) cursor-pointer"
                style={{ color: "var(--j-body)", borderColor: "var(--j-line-2)" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!canSubmitReason}
                className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-colors disabled:bg-(--j-tint) disabled:text-(--j-faint) disabled:cursor-default bg-(--j-purple) hover:bg-(--j-deep) cursor-pointer"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--j-ink)" }}>
              Confirm deletion
            </h2>

            <div
              className="rounded-2xl p-4 mb-5"
              style={{ backgroundColor: "var(--j-tint)" }}
            >
              <p className="text-sm mb-1" style={{ color: "var(--j-ink)" }}>
                Your account will be deleted on{" "}
                <strong>{deletionDate}</strong>.
              </p>
              <p className="text-sm" style={{ color: "var(--j-body)" }}>
                Until then you can keep using Jooma exactly as normal, and you
                can cancel any time from this page.
              </p>
            </div>

            {stats.plan && stats.plan !== "free" && (
              <p className="text-sm mb-5" style={{ color: "var(--j-body)" }}>
                Your paid plan will not renew.
                {stats.paidUntil ? ` You keep it until ${formatDate(stats.paidUntil)}.` : ""}{" "}
                Cancelling the deletion will start it again.
              </p>
            )}

            <p className="text-sm mb-5" style={{ color: "var(--j-body)" }}>
              We keep a record of your invoices and payments, which the law
              requires us to hold even after an account closes.
            </p>

            <label htmlFor="deletion-confirm" className="block text-sm font-medium mb-1.5" style={{ color: "var(--j-ink)" }}>
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              id="deletion-confirm"
              type="text"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
              placeholder="DELETE"
            />

            {error && <p className="mt-4 text-sm font-light" style={{ color: "#c2342b" }}>{error}</p>}

            <div className="flex flex-wrap gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={busy}
                className="px-6 py-3 rounded-xl text-sm font-medium border transition-colors hover:bg-(--j-tint) cursor-pointer disabled:cursor-default"
                style={{ color: "var(--j-body)", borderColor: "var(--j-line-2)" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={confirmWord !== "DELETE" || busy}
                className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-colors disabled:bg-(--j-tint) disabled:text-(--j-faint) disabled:cursor-default bg-red-600 hover:bg-red-700 cursor-pointer"
              >
                {busy ? "Scheduling..." : "Delete my account"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
