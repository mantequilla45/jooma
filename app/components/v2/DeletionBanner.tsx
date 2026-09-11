"use client";

// The standing reminder that this account is on its way out.
//
// A teacher keeps full access for the whole 30 days, which is the right call --
// a grace period exists to be reversed, and somebody locked out cannot
// rediscover that they want the product. But "nothing changes" must not mean
// "nothing shows": without this, the only trace of a pending deletion is a
// section they would have to go looking for.
//
// Not dismissible, unlike AnnouncementBanner. An announcement is news; this is
// the state of your account, and it stops mattering only when the deletion is
// cancelled.
//
// Reads profiles.deletion_scheduled_for rather than account_deletion_requests:
// that mirror exists precisely so the banner costs one cheap column on a row
// most surfaces already read. Returns null when there is nothing pending, which
// is the overwhelmingly usual case, so mounting it costs nothing.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/app/lib/auth/client";

export default function DeletionBanner() {
  const pathname = usePathname();
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("deletion_scheduled_for")
        .eq("id", user.id)
        .maybeSingle();

      // A failure here means no banner rather than an error state. If the
      // migration is not applied yet the column does not exist, and every page
      // in the app would otherwise carry the fallout.
      if (cancelled || error) return;
      setScheduledFor(data?.deletion_scheduled_for ?? null);
    })();
    return () => {
      cancelled = true;
    };
    // Re-checked on navigation so cancelling on /profile clears it everywhere
    // else without a reload.
  }, [pathname]);

  if (!scheduledFor) return null;

  const date = new Date(scheduledFor).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-6 lg:px-10 py-3 border-b"
      style={{
        backgroundColor: "var(--j-tint)",
        borderColor: "var(--j-line-2)",
      }}
    >
      <p className="text-sm" style={{ color: "var(--j-ink)" }}>
        Your account is scheduled for deletion on <strong>{date}</strong>.
      </p>
      <Link
        href="/profile?section=delete"
        className="text-sm font-semibold underline"
        style={{ color: "var(--j-purple)" }}
      >
        Keep my account
      </Link>
    </div>
  );
}
