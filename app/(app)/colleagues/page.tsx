"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleNotch,
  FileText,
  MagnifyingGlass,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { useAppShell } from "@/app/components/v2/AppShellContext";
import ShareModal from "@/app/components/v2/ShareModal";
import { ToolTile } from "@/app/components/v2/Squircle";
import {
  acceptColleagueRequest,
  colleagueMetrics,
  colleagueStats,
  deleteColleagueRequest,
  dismissShare,
  findColleagues,
  listColleagues,
  listIncomingRequests,
  listSharedWithMe,
  newThisWeek,
  removeColleague,
  requestColleague,
  saveSharedToLibrary,
  type Colleague,
  type ColleagueMetrics,
  type ColleagueProfile,
  type ColleagueRequest,
  type ColleagueSearchResult,
  type Share,
} from "@/app/lib/colleagues";
import { displayName, initialsOf, metaLine, shortAge } from "@/app/lib/colleagueDisplay";
import { levelForEarned } from "@/app/lib/badges";
import { v2ToolForSlug, toolSolid } from "@/app/lib/tools";
import { typeLabel } from "@/app/lib/toolRunDisplay";
import InviteModal from "./InviteModal";
import app from "@/app/components/v2/app.module.css";
import styles from "./colleagues.module.css";

/*
 * Colleagues.
 *
 * Connections, the four metrics for each one, and the feed of what has been
 * shared with this teacher. See app/lib/colleagues.ts and
 * supabase/migrations/20260904000000_colleagues.sql.
 *
 * TWO STATES THE PROTOTYPE DOES NOT DRAW, and they are here deliberately.
 *
 * The prototype shows a search box, an Invite button and six colleagues, with
 * nothing in between. But a connection needs the other person's agreement,
 * because on the far side of it sit their statistics and the ability to write
 * into their share feed. So there has to be somewhere to send a request and
 * somewhere to accept one, or the search box is decorative. Search results
 * replace the list while the box has something in it, and incoming requests
 * appear above the list when there are any.
 *
 * Search results show NO metrics. That is not an omission: you have not
 * connected, so you cannot see them, and the absence demonstrates the privacy
 * model better than a sentence explaining it would.
 */

/** Below this the search RPC returns nothing, so there is no point calling it.
 *  Kept in step with the floor inside find_colleagues. */
const MIN_QUERY = 3;

export default function ColleaguesPage() {
  // The page owns its own app.wrap, so the shell must not add a second one.
  useAppShell({ title: "Colleagues", contentClassName: "" });

  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [requests, setRequests] = useState<ColleagueRequest[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [stats, setStats] = useState<Map<string, ColleagueMetrics>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ColleagueSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareWith, setShareWith] = useState<ColleagueProfile | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  /* ── Loading ─────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    const [people, incoming, feed] = await Promise.all([
      listColleagues(),
      listIncomingRequests(),
      listSharedWithMe(),
    ]);
    setColleagues(people);
    setRequests(incoming);
    setShares(feed);

    // Stats are a second round trip on purpose: the list renders immediately
    // with names and level pills, and the numbers fill in. A colleague list
    // that waits on an aggregate over everyone's history feels broken.
    if (people.length > 0) {
      const now = new Date();
      const rows = await colleagueStats(people.map((p) => p.user_id));
      const derived = new Map<string, ColleagueMetrics>();
      for (const [id, row] of rows) derived.set(id, colleagueMetrics(row, now));
      setStats(derived);
    } else {
      setStats(new Map());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch(() => {
        if (!cancelled) setError("Your colleagues could not be loaded. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  /* ── Search ──────────────────────────────────────────────────────────── */

  // Debounced, because this is a definer RPC that joins auth.users and it
  // should not run once per keystroke. 250ms is the same feel as the Library's
  // filter, which is local and needs no delay, so this is the slowest input on
  // the screen by design rather than by accident.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void findColleagues(term)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch(() => {
          if (!cancelled) setError("That search could not be run. Try again.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  const say = (message: string) => {
    setNotice(message);
    setError(null);
  };

  const onRequest = async (person: ColleagueSearchResult) => {
    // Optimistic: the button flips to Pending straight away. A request that
    // fails is recoverable by pressing it again, and the round trip is long
    // enough that waiting reads as a dead button.
    setResults((prev) =>
      prev?.map((r) => (r.user_id === person.user_id ? { ...r, status: "pending_out" } : r)) ?? null,
    );
    try {
      await requestColleague(person.user_id);
      say(`Request sent to ${displayName(person)}.`);
    } catch {
      setResults((prev) =>
        prev?.map((r) => (r.user_id === person.user_id ? { ...r, status: "none" } : r)) ?? null,
      );
      setError("That request could not be sent. Try again.");
    }
  };

  const onAccept = async (request: ColleagueRequest) => {
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    try {
      await acceptColleagueRequest(request.id);
      await load();
      say(`${displayName(request.profile)} is now a colleague.`);
    } catch {
      setRequests((prev) => [request, ...prev]);
      setError("That could not be accepted. Try again.");
    }
  };

  const onDecline = async (request: ColleagueRequest) => {
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    try {
      await deleteColleagueRequest(request.id);
    } catch {
      setRequests((prev) => [request, ...prev]);
      setError("That could not be declined. Try again.");
    }
  };

  const onRemove = async (person: Colleague) => {
    const name = displayName(person);
    if (!window.confirm(`Remove ${name}? You will both stop seeing each other's progress.`)) return;

    setColleagues((prev) => prev.filter((c) => c.user_id !== person.user_id));
    try {
      await removeColleague(person.user_id);
      say(`${name} removed.`);
    } catch {
      setColleagues((prev) => [...prev, person]);
      setError("That could not be removed. Try again.");
    }
  };

  const onSave = async (share: Share) => {
    setSavingId(share.id);
    try {
      await saveSharedToLibrary(share);
      setShares((prev) => prev.filter((s) => s.id !== share.id));
      say("Saved to your library.");
    } catch {
      setError("That could not be saved. Try again.");
    } finally {
      setSavingId(null);
    }
  };

  const onDismiss = async (share: Share) => {
    setShares((prev) => prev.filter((s) => s.id !== share.id));
    try {
      await dismissShare(share.id);
    } catch {
      setShares((prev) => [share, ...prev]);
      setError("That could not be dismissed. Try again.");
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  const count = colleagues.length;
  const eyebrow =
    count === 0 ? "Your staffroom" : count === 1 ? "1 colleague" : `${count} colleagues`;

  const newCount = newThisWeek(shares, new Date());

  return (
    <>
      <div className={app.wrap}>
        <div className={app.hello}>
          <p className={app.helloWhen}>{eyebrow}</p>
          <h1>Colleagues</h1>
          <p className={app.helloSub}>
            Share resources, compare progress and keep each other going.
          </p>
        </div>

        <div className={styles.fbar}>
          <label className={`${app.search} ${styles.searchBig}`}>
            <MagnifyingGlass className={app.searchIcon} />
            <span className={styles.srOnly}>Find a colleague</span>
            <input
              className={app.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a colleague by username or email"
            />
          </label>
          <button
            type="button"
            className={`${app.btn} ${app.btnP}`}
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className={app.btnIcon} />
            Invite a colleague
          </button>
        </div>

        {error ? (
          <p className={styles.error} role="status">
            {error}
          </p>
        ) : null}

        {/* Announcements for a screen reader. Visually silent: every action on
            this page already shows its result by changing the list. */}
        <p className={styles.srOnly} role="status">
          {notice ?? ""}
        </p>

        {/* Search replaces the list while the box has something in it. The
            colleague list is still there underneath, one clear away. */}
        {results !== null ? (
          <SearchPanel
            results={results}
            searching={searching}
            onRequest={onRequest}
          />
        ) : (
          <>
            {requests.length > 0 ? (
              <RequestsPanel requests={requests} onAccept={onAccept} onDecline={onDecline} />
            ) : null}

            <div className={`${app.panel} ${styles.friendPanel}`}>
              {loading ? (
                <p className={styles.state} role="status">
                  <CircleNotch className={styles.spin} />
                  Loading
                </p>
              ) : count === 0 ? (
                <div className={app.empty}>
                  <span className={app.emptyIcon}>
                    <UsersThree weight="fill" />
                  </span>
                  <p className={app.emptyTitle}>No colleagues yet</p>
                  <p className={app.emptyBody}>
                    Find someone by username or email, or invite them. You will be able
                    to share resources straight into each other&rsquo;s libraries.
                  </p>
                </div>
              ) : (
                colleagues.map((person) => (
                  <ColleagueRow
                    key={person.user_id}
                    person={person}
                    metrics={stats.get(person.user_id)}
                    onShare={() => setShareWith(person)}
                    onRemove={() => onRemove(person)}
                  />
                ))
              )}
            </div>
          </>
        )}

        <div className={app.sh}>
          <div className={app.shTitle}>
            <h2>Shared with you</h2>
          </div>
          {newCount > 0 ? (
            <span className={app.shSub}>
              {newCount} new this week
            </span>
          ) : null}
        </div>

        <div className={app.panel}>
          {shares.length === 0 ? (
            <div className={app.empty}>
              <span className={app.emptyIcon}>
                <FileText weight="fill" />
              </span>
              <p className={app.emptyTitle}>Nothing shared with you yet</p>
              <p className={app.emptyBody}>
                When a colleague shares a resource, it waits here until you save it. You get
                your own copy to edit, and theirs stays untouched.
              </p>
            </div>
          ) : (
            <div className={app.rows}>
              {shares.map((share) => (
                <SharedRow
                  key={share.id}
                  share={share}
                  saving={savingId === share.id}
                  onSave={() => onSave(share)}
                  onDismiss={() => onDismiss(share)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ShareModal
        open={shareWith !== null}
        onClose={() => setShareWith(null)}
        recipient={shareWith ?? undefined}
        onShared={(n) => say(n === 1 ? "Shared." : `Shared ${n} resources.`)}
      />

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

function ColleagueRow({
  person,
  metrics,
  onShare,
  onRemove,
}: {
  person: Colleague;
  metrics: ColleagueMetrics | undefined;
  onShare: () => void;
  onRemove: () => void;
}) {
  // Level comes from the badge count by the same function the sidebar and the
  // profile use, so a colleague's pill agrees with what they see themselves.
  const level = metrics ? levelForEarned(metrics.badges) : null;

  return (
    <div className={styles.friend}>
      <Avatar profile={person} />
      <span className={styles.friendMain}>
        <h3 className={styles.friendName}>{displayName(person)}</h3>
        <span className={styles.friendMeta}>{metaLine(person)}</span>
      </span>

      {level !== null ? <span className={styles.lvlpill}>Level {level}</span> : null}

      <span className={styles.fstats}>
        <Stat label="Day streak" value={metrics?.streak} empty="Not yet" />
        <Stat label="Resources made" value={metrics?.resources} empty="None yet" />
        <Stat label="Badges earned" value={metrics?.badges} empty="None yet" />
        <Stat
          label="Time saved"
          value={metrics ? Math.round(metrics.minutesSaved / 60) : undefined}
          suffix="h"
          // Under an hour is real work, so it is not "none". Same wording as
          // ProfileHeader.
          empty={metrics && metrics.minutesSaved > 0 ? "< 1h" : "Not yet"}
        />
      </span>

      <span className={styles.actionPair}>
        <button type="button" className={app.btn} onClick={onShare}>
          Share
        </button>
        <button type="button" className={styles.dismiss} onClick={onRemove}>
          Remove
        </button>
      </span>
    </div>
  );
}

/** One metric. Never renders a bare zero as the headline: the no-zero rule from
 *  ProfileHeader and TodayView applies to a colleague's row too. */
function Stat({
  label,
  value,
  suffix = "",
  empty,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  empty: string;
}) {
  const show = value !== undefined && value > 0;
  return (
    <span className={styles.fstat}>
      <span className={show ? styles.fstatValue : styles.fstatEmpty}>
        {show ? `${value}${suffix}` : empty}
      </span>
      <span className={styles.fstatLabel}>{label}</span>
    </span>
  );
}

function SharedRow({
  share,
  saving,
  onSave,
  onDismiss,
}: {
  share: Share;
  saving: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const tool = v2ToolForSlug(share.tool_slug);
  const from = share.sender ? displayName(share.sender) : "a colleague";

  return (
    <div className={styles.sharedRow}>
      <ToolTile icon={tool?.icon ?? "file-text"} solid={toolSolid(tool)} size="sm" />
      <span className={app.rowMain}>
        <span className={app.rowTitle}>{share.title?.trim() || typeLabel(share.tool_slug)}</span>
        <span className={app.rowMeta}>Shared by {from}</span>
      </span>
      <button type="button" className={styles.act} onClick={onSave} disabled={saving}>
        {saving ? "Saving" : "Save to library"}
      </button>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        Dismiss
      </button>
      <span className={styles.when}>{shortAge(share.created_at)}</span>
    </div>
  );
}

/* ── Panels ────────────────────────────────────────────────────────────── */

function RequestsPanel({
  requests,
  onAccept,
  onDecline,
}: {
  requests: ColleagueRequest[];
  onAccept: (r: ColleagueRequest) => void;
  onDecline: (r: ColleagueRequest) => void;
}) {
  return (
    <>
      <div className={app.sh}>
        <div className={app.shTitle}>
          <h2>Wants to connect</h2>
          <span className={app.shSub}>
            {requests.length === 1 ? "1 request" : `${requests.length} requests`}
          </span>
        </div>
      </div>
      <div className={`${app.panel} ${styles.friendPanel}`}>
        {requests.map((request) => (
          <div key={request.id} className={styles.friend}>
            <Avatar profile={request.profile} />
            <span className={styles.friendMain}>
              <h3 className={styles.friendName}>{displayName(request.profile)}</h3>
              <span className={styles.friendMeta}>{metaLine(request.profile)}</span>
            </span>
            <span className={styles.actionPair}>
              <button
                type="button"
                className={`${app.btn} ${app.btnP}`}
                onClick={() => onAccept(request)}
              >
                Accept
              </button>
              <button type="button" className={app.btn} onClick={() => onDecline(request)}>
                Decline
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function SearchPanel({
  results,
  searching,
  onRequest,
}: {
  results: ColleagueSearchResult[];
  searching: boolean;
  onRequest: (r: ColleagueSearchResult) => void;
}) {
  return (
    <div className={`${app.panel} ${styles.friendPanel}`}>
      {searching && results.length === 0 ? (
        <p className={styles.state} role="status">
          <CircleNotch className={styles.spin} />
          Searching
        </p>
      ) : results.length === 0 ? (
        <div className={app.empty}>
          <span className={app.emptyIcon}>
            <MagnifyingGlass />
          </span>
          <p className={app.emptyTitle}>Nobody found</p>
          <p className={app.emptyBody}>
            Usernames and email addresses have to be exact, so check the spelling. If they
            are not on Jooma yet, invite them.
          </p>
        </div>
      ) : (
        results.map((person) => (
          <div key={person.user_id} className={styles.friend}>
            <Avatar profile={person} />
            <span className={styles.friendMain}>
              <h3 className={styles.friendName}>{displayName(person)}</h3>
              <span className={styles.friendMeta}>{metaLine(person)}</span>
            </span>
            <SearchAction person={person} onRequest={() => onRequest(person)} />
          </div>
        ))
      )}
    </div>
  );
}

function SearchAction({
  person,
  onRequest,
}: {
  person: ColleagueSearchResult;
  onRequest: () => void;
}) {
  if (person.status === "connected") {
    return <span className={styles.pending}>Colleague</span>;
  }
  if (person.status === "pending_out") {
    return <span className={styles.pending}>Request sent</span>;
  }
  if (person.status === "pending_in") {
    // They asked first. Say so rather than offering to send a second request
    // that would sit unanswered beside theirs.
    return <span className={styles.pending}>Waiting on you above</span>;
  }
  return (
    <button type="button" className={`${app.btn} ${app.btnP}`} onClick={onRequest}>
      <UserPlus className={app.btnIcon} />
      Add
    </button>
  );
}

function Avatar({ profile }: { profile: ColleagueProfile }) {
  if (profile.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.fav} src={profile.avatar_url} alt="" />;
  }
  return <span className={styles.fav}>{initialsOf(profile)}</span>;
}
