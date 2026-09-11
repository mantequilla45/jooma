import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { hardDeleteAccount, DeletionAbortedError } from "@/app/lib/account-deletion";
import { sendTemplate } from "@/app/lib/email";

// Carries out the deletions whose 30 days have run out, and sends the reminder
// three days before.
//
// WHY A CRON AND NOT THE OPPORTUNISTIC PRUNE THIS CODEBASE USES ELSEWHERE
//
// /api/auth/password-link deletes stale auth_rate rows on every call, and that
// pattern is right there because the rows are worthless: a late prune costs
// nothing but a slightly larger table. This is the opposite. The thing being
// actioned is a promise made to a person and an obligation under Article 17,
// and hanging it off "whenever somebody happens to hit an endpoint" fails in
// exactly the case that matters most: the account that goes quiet after asking
// to leave generates no requests of its own, so we would be relying on OTHER
// users' traffic to delete THIS user.
//
// It is also a multi-second job (storage sweep, Stripe, cascade) and bolting
// that onto a stranger's page load makes their request slow for reasons they
// cannot see.
//
// SETUP THIS DEPENDS ON, all of it easy to get wrong silently:
//   - vercel.json registers it. Crons only register from a PRODUCTION deploy.
//   - CRON_SECRET set in Vercel, production scope. Vercel then sends it as a
//     bearer token automatically.
//   - /api/cron is in PUBLIC_PATHS in proxy.ts. Without that the request 307s to
//     /login and the cron log records a 200-ish redirect that LOOKS like success.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bounded so a backlog drains over successive days rather than timing out
 *  half way through a sweep and leaving an account partly deleted. */
const BATCH = 20;

/** How many days before the deletion the reminder goes out. */
const REMIND_AT_DAYS = 3;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so check that first.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Loud rather than open: a deploy that forgot the secret must fail, not turn
  // this into an unauthenticated endpoint that deletes accounts.
  if (!process.env.CRON_SECRET) {
    console.error("[cron/deletions] CRON_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let deleted = 0;
  let failed = 0;
  let reminded = 0;

  // ── Due deletions ──────────────────────────────────────────────────────────
  const { data: due, error: dueError } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id, user_id, email")
    .eq("status", "pending")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);

  if (dueError) {
    console.error("[cron/deletions] could not read the queue", dueError);
    return NextResponse.json({ error: "Could not read the queue" }, { status: 500 });
  }

  for (const request of due ?? []) {
    // user_id null on a pending row means the auth user went away by some other
    // route. Nothing left to delete, so close it out rather than retrying daily.
    if (!request.user_id) {
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({
          status: "completed",
          completed_at: now.toISOString(),
          failure_note: "The account was already gone.",
        })
        .eq("id", request.id);
      continue;
    }

    try {
      // Each account in its own try/catch: one poisoned row must not stall the
      // queue behind it.
      await hardDeleteAccount(request.user_id, request.id, request.email);
      deleted += 1;
    } catch (err) {
      failed += 1;
      const note =
        err instanceof DeletionAbortedError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Unknown error";

      console.error("[cron/deletions] deletion failed", request.id, note);

      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ status: "failed", failure_note: note.slice(0, 500) })
        .eq("id", request.id);
    }
  }

  // ── Reminders ──────────────────────────────────────────────────────────────
  //
  // Done here because this job is already iterating pending rows. One reminder
  // only, near the end: somebody who has decided to leave should not be nagged
  // on their way out.
  //
  // The window is a whole day wide rather than an instant, because this runs
  // once a day: anything landing in the 24 hours after the T-3 mark is caught by
  // the next run.
  //
  // reminded_at is what actually stops a double send. The window alone would
  // not: a manual invocation, a retry, or a change to the schedule can easily
  // put two runs inside the same 24 hours, and the second one would mail
  // everybody again.
  const windowEnd = new Date(now.getTime() + REMIND_AT_DAYS * 24 * 60 * 60 * 1000);

  const { data: upcoming } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id, email, scheduled_for")
    .eq("status", "pending")
    .is("reminded_at", null)
    .gt("scheduled_for", now.toISOString())
    .lte("scheduled_for", windowEnd.toISOString())
    .limit(BATCH);

  for (const request of upcoming ?? []) {
    // Stamped BEFORE the send. sendTemplate never throws and returns false on
    // failure, but a crash between the two would otherwise leave the row
    // eligible again tomorrow; one missed reminder beats a duplicate.
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ reminded_at: now.toISOString() })
      .eq("id", request.id);

    const sent = await sendTemplate("account_deletion_reminder", request.email, {
      scheduledDate: new Date(request.scheduled_for).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });
    if (sent) reminded += 1;
  }

  return NextResponse.json({
    processed: (due ?? []).length,
    deleted,
    failed,
    reminded,
  });
}

// Vercel Cron issues GETs. Same work, same auth.
export async function GET(req: NextRequest) {
  return POST(req);
}
