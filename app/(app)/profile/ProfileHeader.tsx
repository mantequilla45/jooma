"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/app/components/ui/Avatar";
import { createClient } from "@/app/lib/auth/client";
import { useProfileIdentity } from "@/app/lib/useProfileIdentity";
import { useBadgeProgress } from "@/app/lib/useBadgeProgress";
import { minutesSavedFor } from "@/app/lib/tools";
import { asPlanId, PLANS } from "@/app/lib/plans";
import styles from "./ProfileHeader.module.css";

/*
 * The banner above the settings menu: who you are, and what you have made.
 *
 * The name and photo come from the shared identity store rather than a fetch of
 * their own, so this and the top bar can never disagree about which photo is
 * current — the profile form publishes to that store when it saves.
 *
 * All four stats are real now. The run history and the badges come from the
 * shared badge store, which Today and the sidebar also read, so opening this
 * page does not re-fetch what the app already has.
 *
 * The no-zero rule still holds: a teacher who has earned nothing reads "None
 * yet" rather than "0 of 100", because a zero as the first thing you see reads
 * as a judgement on the teacher rather than a description of a new account.
 */
export default function ProfileHeader() {
  const identity = useProfileIdentity();
  const progress = useBadgeProgress();
  const [plan, setPlan] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;

      setPlan(PLANS[asPlanId(profile?.plan)].name);
      // created_at is on the auth user, not the profile row.
      if (user.created_at) setJoined(user.created_at);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived from the runs the badge store already holds, rather than a second
  // fetch of the same thousand rows.
  const stats = progress.loading
    ? null
    : {
        resources: progress.runs.length,
        hours: Math.round(
          progress.runs.reduce((sum, r) => sum + minutesSavedFor(r.tool_slug), 0) / 60,
        ),
      };

  const name = identity?.name?.trim();

  return (
    <header className={styles.head}>
      {/* The photo is changed in Personal info, which is one click away, so this
          links there rather than carrying a second uploader. */}
      <Link
        href="/profile?section=personal"
        className={styles.avatar}
        aria-label="Change your photo in Personal info"
      >
        <Avatar url={identity?.avatarUrl ?? null} name={name ?? ""} size={84} />
      </Link>

      <div className={styles.who}>
        <h1 className={styles.name}>{name || "Your profile"}</h1>
        <p className={styles.meta}>
          {[
            plan,
            joined
              ? `Joined ${new Date(joined).toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Resources</dt>
          <dd>{stats ? stats.resources : "—"}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Time saved</dt>
          {/* Never a zero headline: before the first resource there is no figure
              worth showing, and under an hour rounds to 0h. */}
          <dd>
            {!stats
              ? "—"
              : stats.resources === 0
                ? "Not yet"
                : stats.hours === 0
                  ? "< 1h"
                  : `${stats.hours}h`}
          </dd>
        </div>
        {/* Both fall back to the old "not yet" while the badges table is not
            there, which is the honest reading of a feature that has not been
            switched on rather than of a teacher who has not done anything. */}
        <div
          className={`${styles.stat} ${styles.statWord} ${!progress.available ? styles.statSoon : ""}`}
        >
          <dt>Level</dt>
          <dd>
            {progress.loading
              ? "—"
              : !progress.available
                ? "Not yet"
                : `Level ${progress.level}`}
          </dd>
        </div>
        <div
          className={`${styles.stat} ${styles.statWord} ${!progress.available ? styles.statSoon : ""}`}
        >
          <dt>Badges</dt>
          <dd>
            {progress.loading
              ? "—"
              : !progress.available
                ? "Not yet"
                : progress.earnedCount === 0
                  ? "None yet"
                  : `${progress.earnedCount} of ${progress.total}`}
          </dd>
        </div>
      </dl>
    </header>
  );
}
