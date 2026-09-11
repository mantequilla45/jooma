import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/auth/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { stripe } from "@/app/lib/stripe";
import { sendTemplate } from "@/app/lib/email";

// Requesting account deletion.
//
// WHY THIS IS A ROUTE AND NOT AN RLS INSERT
//
// The deciding field is scheduled_for. A client-side insert would let a teacher
// choose their own deadline: now(), which is an instant irreversible deletion
// dressed up as a 30 day grace period, or the year 3000, which turns the request
// into a permanent marker nothing will ever action. The date is ours to set, so
// the write is ours to make. account_deletion_requests has no insert policy at
// all as a result.
//
// Cancelling, by contrast, IS a direct call -- see cancel_my_account_deletion()
// in 20260913000000_account_deletion.sql. There is nothing to get wrong there:
// auth.uid() is the whole authorisation and there are no parameters.

/** How long they get to change their mind. */
const GRACE_DAYS = 30;

const REASON_CODES = [
  "too_expensive",
  "not_using",
  "missing_feature",
  "found_alternative",
  "privacy",
  "other",
] as const;

type ReasonCode = (typeof REASON_CODES)[number];

function asReasonCode(v: unknown): ReasonCode | null {
  return typeof v === "string" && (REASON_CODES as readonly string[]).includes(v)
    ? (v as ReasonCode)
    : null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  // Re-checked server-side. The client disables its button until this matches,
  // but that is UX -- this is the check. Exact case: "delete" is a typo of a
  // word somebody meant to type, not a confirmation.
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Type DELETE to confirm." },
      { status: 400 },
    );
  }

  // An unrecognised reason is a client bug, so say so rather than coercing it to
  // 'other' and quietly poisoning the one dataset this feature exists to build.
  // Same reasoning as the flow allowlist in /api/stripe/portal.
  const reasonCode = asReasonCode(body?.reasonCode);
  if (!reasonCode) {
    return NextResponse.json(
      { error: "Choose a reason for leaving." },
      { status: 400 },
    );
  }

  const rawText = typeof body?.reasonText === "string" ? body.reasonText.trim() : "";
  if (rawText.length > 2000) {
    return NextResponse.json(
      { error: "That message is too long." },
      { status: 400 },
    );
  }
  // "Other" with no text is a wasted row: it records that somebody left for a
  // reason we did not list, without recording the reason.
  if (reasonCode === "other" && !rawText) {
    return NextResponse.json(
      { error: "Tell us a little about why you're leaving." },
      { status: 400 },
    );
  }
  const reasonText = rawText || null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_admin, stripe_subscription_id, subscription_status, cancel_at_period_end")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "Could not find your account." }, { status: 404 });
  }

  // Same guard as the admin suspend route, for the same reason: an admin
  // deleting themselves could remove the last super admin, and that is not
  // recoverable from any screen in the app. Staff leave through another admin.
  if (profile.is_admin) {
    return NextResponse.json(
      { error: "Admin accounts can't be deleted from here. Please contact the team." },
      { status: 400 },
    );
  }

  // Idempotent rather than an error. A double-submitted form, or a second tab,
  // should land on the same scheduled date instead of a red message.
  const { data: existing } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("scheduled_for")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "Your account is already scheduled for deletion.", scheduledFor: existing.scheduled_for },
      { status: 409 },
    );
  }

  const scheduledFor = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // 1. The request row FIRST. It is the source of truth: the executor reads it,
  //    and the banner is only a mirror. If the profile write below fails, a
  //    request with no banner still gets honoured, which is far better than a
  //    banner with nothing behind it. Same ordering discipline as the suspend
  //    route, and the same reasoning.
  const { data: request, error: insertError } = await supabaseAdmin
    .from("account_deletion_requests")
    .insert({
      user_id: user.id,
      email: (user.email ?? "").toLowerCase(),
      reason_code: reasonCode,
      reason_text: reasonText,
      scheduled_for: scheduledFor,
    })
    .select("id")
    .single();

  if (insertError || !request) {
    console.error("[account/deletion] could not record the request", insertError);
    return NextResponse.json(
      { error: "Could not schedule the deletion. Nothing has changed." },
      { status: 500 },
    );
  }

  // 2. Stop the next charge. They asked to leave, so billing them again during
  //    the grace period would be indefensible even though we would refund it.
  //
  //    cancel_at_period_end rather than cancel(): they keep what they paid for
  //    until the period runs out, and cancelling the deletion resumes it through
  //    the existing /api/stripe/resume route.
  //
  //    NOT fatal. The hard delete cancels outright anyway, so the worst case
  //    here is one more charge that support can refund -- not a reason to refuse
  //    somebody's deletion request.
  let subscriptionPaused = false;
  if (profile.stripe_subscription_id && profile.subscription_status !== "canceled") {
    if (profile.cancel_at_period_end) {
      // Already ending on its own. Nothing to pause, and nothing to resume if
      // they change their mind -- so leave the flag false or cancelling the
      // deletion would "resume" a subscription the teacher had already stopped.
      console.info("[account/deletion] subscription already ending", user.id);
    } else {
      try {
        await stripe.subscriptions.update(profile.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
        subscriptionPaused = true;

        await supabaseAdmin
          .from("profiles")
          .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
          .eq("id", user.id);
      } catch (err) {
        console.error("[account/deletion] could not pause billing", user.id, err);
      }
    }
  }

  if (subscriptionPaused) {
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ subscription_paused: true })
      .eq("id", request.id);
  }

  // 3. The mirror the banner reads.
  const { error: mirrorError } = await supabaseAdmin
    .from("profiles")
    .update({ deletion_scheduled_for: scheduledFor, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (mirrorError) {
    // Logged, not surfaced. The request is recorded and WILL be honoured; the
    // teacher just will not see the banner until this is reconciled.
    console.error("[account/deletion] mirror write failed", user.id, mirrorError);
  }

  // 4. The email. This is the only channel that reaches somebody who makes the
  //    request and never opens the app again, and it carries the cancel link.
  //    sendTemplate never throws.
  if (user.email) {
    await sendTemplate("account_deletion_scheduled", user.email, {
      scheduledDate: new Date(scheduledFor).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });
  }

  return NextResponse.json({ scheduledFor, subscriptionPaused });
}
