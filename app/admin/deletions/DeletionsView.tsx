"use client";

import { useMemo, useState } from "react";
import { C, PageHead, Card, CardBody, Stat, Tag, EmptyState, type Tone } from "@/app/admin/ui";

// The deletion queue and the reasons behind it.
//
// Read-only, deliberately. There is no "delete now" button and no "cancel this
// for them": the grace period is a promise made to the teacher, and an admin
// shortening it from a console would break that promise silently. A teacher who
// wants out sooner, or wants to stay, does it from their own profile, and
// support can move a date with a single SQL update when somebody genuinely asks.

export interface DeletionRow {
  id: string;
  user_id: string | null;
  email: string;
  reason_code: string;
  reason_text: string | null;
  requested_at: string;
  scheduled_for: string;
  cancelled_at: string | null;
  completed_at: string | null;
  status: string;
  failure_note: string | null;
  subscription_paused: boolean;
}

const REASON_LABELS: Record<string, string> = {
  too_expensive: "Too expensive",
  not_using: "Not using it",
  missing_feature: "Missing a feature",
  found_alternative: "Found an alternative",
  privacy: "Data concerns",
  other: "Something else",
};

const STATUS_TONE: Record<string, Tone> = {
  pending: "warn",
  cancelled: "ok",
  completed: "plain",
  failed: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  cancelled: "Cancelled",
  completed: "Deleted",
  failed: "Failed",
};

function shortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

const FILTERS = ["pending", "all", "cancelled", "completed", "failed"] as const;
type Filter = (typeof FILTERS)[number];

export default function DeletionsView({ rows }: { rows: DeletionRow[] }) {
  const [filter, setFilter] = useState<Filter>("pending");

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const finished = rows.filter((r) => r.status === "completed").length;
    const cancelled = rows.filter((r) => r.status === "cancelled").length;
    // Of the people who reached a decision, how many stayed. Pending requests
    // are excluded because they have not decided yet, and including them would
    // make the rate drift every day without anybody doing anything.
    const decided = finished + cancelled;
    const saveRate = decided > 0 ? Math.round((cancelled / decided) * 100) : null;
    return { pending, failed, finished, cancelled, saveRate };
  }, [rows]);

  // Why people leave, counted over everyone who actually went through with it
  // plus those still pending. A cancelled request is not churn.
  const reasons = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of rows) {
      if (row.status === "cancelled") continue;
      tally.set(row.reason_code, (tally.get(row.reason_code) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <>
      <PageHead
        title="Account deletions"
        sub="Who is leaving, why, and what is still in the queue."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="In the queue" value={String(counts.pending)} foot="Still inside their 30 days" />
        <Stat label="Changed their mind" value={String(counts.cancelled)} />
        <Stat
          label="Stayed"
          value={counts.saveRate === null ? "-" : `${counts.saveRate}%`}
          foot="Of those who decided"
        />
        <Stat
          label="Failed"
          value={String(counts.failed)}
          foot={counts.failed > 0 ? "Needs a look" : undefined}
        />
      </div>

      {reasons.length > 0 && (
        <Card>
          <CardBody>
            <p className="text-xs font-semibold mb-3" style={{ color: C.muted }}>
              WHY THEY LEFT
            </p>
            <div className="flex flex-wrap gap-2">
              {reasons.map(([code, count]) => (
                <Tag key={code} tone="plain">
                  {REASON_LABELS[code] ?? code} &middot; {count}
                </Tag>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 my-6">
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer"
              style={{
                backgroundColor: active ? C.brandBg : C.surface,
                borderColor: active ? C.brand : C.border,
                color: active ? C.brand : C.ink2,
              }}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}
            </button>
          );
        })}
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            title="Nothing here"
            body={
              filter === "pending"
                ? "No accounts are waiting to be deleted."
                : "No requests with that status."
            }
          />
        ) : (
          /* Its own scroll box so a long email column cannot blow the page out
             sideways on a laptop. */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Account", "Reason", "Asked", "Due", "Status"].map((h) => (
                    <th
                      key={h}
                      className="text-left font-semibold px-4 py-3 whitespace-nowrap"
                      style={{ color: C.muted }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const left = daysLeft(row.scheduled_for);
                  return (
                    <tr key={row.id} style={{ borderBottom: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3 align-top">
                        <p style={{ color: C.ink }}>{row.email}</p>
                        {/* Null once the deletion has run, which is the point of
                            keeping the email. Saying so beats an empty cell. */}
                        {!row.user_id && row.status === "completed" && (
                          <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                            Account removed
                          </p>
                        )}
                        {row.subscription_paused && (
                          <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                            Billing paused
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top" style={{ maxWidth: 360 }}>
                        <p style={{ color: C.ink2 }}>
                          {REASON_LABELS[row.reason_code] ?? row.reason_code}
                        </p>
                        {row.reason_text && (
                          <p
                            className="text-xs mt-1 whitespace-pre-wrap"
                            style={{ color: C.muted }}
                          >
                            {row.reason_text}
                          </p>
                        )}
                        {row.failure_note && (
                          <p className="text-xs mt-1" style={{ color: C.danger }}>
                            {row.failure_note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap" style={{ color: C.ink2 }}>
                        {shortDate(row.requested_at)}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap" style={{ color: C.ink2 }}>
                        {shortDate(row.scheduled_for)}
                        {row.status === "pending" && (
                          <span className="block text-xs" style={{ color: C.muted }}>
                            {left <= 0 ? "Due now" : left === 1 ? "1 day left" : `${left} days left`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Tag tone={STATUS_TONE[row.status] ?? "plain"} dot>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
