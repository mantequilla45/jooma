// Actually deleting an account, once its 30 day grace period has run out.
//
// Lives here rather than in the cron route so that a future admin "delete now"
// button, or a support script, shares one implementation. There must only ever
// be one place that knows this order.
//
// THE ORDER IS LOAD BEARING. Top to bottom:
//
//   1. Read the storage references BEFORE deleting any row. The row is the sole
//      index of its own files (see app/lib/storageRefs.ts) and once it is gone
//      nothing will ever look for them again. This is the same constraint
//      /api/resources/delete is built around, for the same reason.
//   2. Cancel Stripe, and STOP if that fails. Everything else here is
//      recoverable; billing a card for an account that no longer exists is not.
//   3. Delete presentations explicitly, sweep storage, then delete the auth
//      user and let ~25 tables cascade.
//   4. Close the request row out by ID, never by user_id -- it has just been
//      nulled by the cascade.
//
// WHAT IS DELIBERATELY LEFT BEHIND
//
// token_usage, asset_cost and slide_cost: they link to a run by a bare run_id
// with no foreign key, and that is on purpose (see the header of
// app/api/resources/delete/route.ts). The spend happened, and monitoring,
// margin and the cost ceiling all depend on the history staying complete.
//
// invoices, safeguarding_flags, support_threads, admin_audit_log, ambassadors:
// all `on delete set null`, so the row survives with its user_id nulled. Every
// one of those exists because a financial, safeguarding or attribution record
// has to outlive the person it describes. Do not "tidy" any of them.
//
// The Stripe customer is not deleted either -- it holds the other half of the
// record `invoices` is preserving.
import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { stripe } from "@/app/lib/stripe";
import { extractStorageRefs, type StorageRef } from "@/app/lib/storageRefs";
import { sendTemplate } from "@/app/lib/email";

/** Thrown when the deletion must not proceed. The message lands in failure_note. */
export class DeletionAbortedError extends Error {}

/**
 * Every Storage object this account owns, across all four buckets.
 *
 * Deliberately NOT using the storage_paths_in_use RPC that /api/resources/delete
 * relies on. That function answers "is anything OTHER than this one resource
 * still pointing at these files", by excluding a single id. Here every resource
 * the account owns is going, so the honest exclusion list is all of them, and
 * the RPC cannot express that -- called with a single id it would report this
 * user's own other rows as live references and keep the files forever.
 *
 * Sweeping unconditionally is safe because resources are user-isolated
 * (20260601000000_presentations_user_isolation.sql): an object referenced only
 * by this user's rows is referenced by nobody else's. The one thing that would
 * break that is a share which copies a URL rather than the file, so if shares
 * ever start doing that, this function is where it has to be handled.
 */
async function collectStorageRefs(userId: string): Promise<StorageRef[]> {
  const refs: StorageRef[] = [];

  // Decks. `slides` is deeply nested, so serialise the lot and scan it.
  const { data: decks } = await supabaseAdmin
    .from("presentations")
    .select("slides")
    .eq("user_id", userId);

  for (const deck of decks ?? []) {
    refs.push(...extractStorageRefs(JSON.stringify(deck.slides ?? null)));
  }

  // Tool runs. `output` is markdown or JSON depending on the tool; `input` can
  // carry uploaded images. Both are scanned as text.
  const { data: runs } = await supabaseAdmin
    .from("tool_runs")
    .select("output, input")
    .eq("user_id", userId);

  for (const run of runs ?? []) {
    refs.push(
      ...extractStorageRefs(
        typeof run.output === "string" ? run.output : null,
        JSON.stringify(run.input ?? null),
      ),
    );
  }

  // The avatar, which RESOURCE_BUCKETS deliberately excludes because it belongs
  // to the person rather than to any resource. Here the person is going too.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.avatar_url) {
    refs.push(...extractStorageRefs(profile.avatar_url));
  }

  // Dedupe: the same file can be referenced by a run and by the deck built from
  // it, and remove() on an already-removed path is wasted work.
  const seen = new Map<string, StorageRef>();
  for (const ref of refs) seen.set(`${ref.bucket}/${ref.path}`, ref);
  return [...seen.values()];
}

/**
 * Remove the objects, one call per bucket.
 *
 * Best effort throughout, and deliberately so: the account is going either way,
 * and a storage hiccup must not be the thing that blocks a deletion somebody
 * asked for 30 days ago. A leaked file costs pennies; a deletion that silently
 * never completes is a broken promise and an ICO complaint.
 */
async function sweepStorage(refs: StorageRef[]): Promise<number> {
  if (refs.length === 0) return 0;

  const byBucket = new Map<string, string[]>();
  for (const ref of refs) {
    const list = byBucket.get(ref.bucket) ?? [];
    list.push(ref.path);
    byBucket.set(ref.bucket, list);
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    // Chunked: a heavy account can reference thousands of objects and a single
    // remove() call with all of them is a request big enough to be refused.
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
      if (error) {
        console.error("[account-deletion] storage remove failed", bucket, batch.length, error);
        continue;
      }
      removed += batch.length;
    }
  }
  return removed;
}

/**
 * Cancel the subscription outright and mark the customer.
 *
 * cancel(), not cancel_at_period_end: period-end semantics only make sense while
 * there is an account left to serve for the rest of that period. By this point
 * the teacher requested deletion 30 days ago and /api/account/deletion already
 * set cancel_at_period_end at that time, so in the normal case this is closing
 * a subscription that has already stopped renewing.
 *
 * THROWS on failure, and that is the point. See the note in hardDeleteAccount.
 */
async function settleStripe(
  customerId: string | null,
  subscriptionId: string | null,
): Promise<void> {
  if (subscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (err) {
      // Already gone is success, not failure: the subscription ended on its own
      // during the grace period, which is exactly what we wanted.
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : 0;
      const alreadyGone = code === "resource_missing" || status === 404;

      if (!alreadyGone) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "unknown error";
        throw new DeletionAbortedError(`Stripe cancel failed: ${message}`);
      }
      console.warn("[account-deletion] subscription already gone", subscriptionId);
    }
  }

  // Note on the customer rather than delete it. A free teacher can have a
  // customer id from a top-up with no subscription at all, so this runs for them
  // too. Best effort: the metadata is a convenience for finance, and failing to
  // write it is not a reason to keep an account alive.
  if (customerId) {
    try {
      await stripe.customers.update(customerId, {
        metadata: { jooma_deleted_at: new Date().toISOString() },
      });
    } catch (err) {
      console.error("[account-deletion] customer metadata write failed", customerId, err);
    }
  }
}

export interface HardDeleteResult {
  filesFound: number;
  filesRemoved: number;
}

/**
 * Delete the account behind one deletion request.
 *
 * @param userId  the account to delete
 * @param requestId  the account_deletion_requests row to close out. Captured by
 *   the caller BEFORE this runs, because user_id on that row is nulled by the
 *   cascade the moment the auth user goes -- an update keyed on user_id here
 *   would match nothing and silently leave the request pending forever.
 * @param email  where to send the confirmation, read from the request row for
 *   the same reason: the account it would otherwise be looked up from is gone.
 *
 * Throws DeletionAbortedError if the account must not be deleted right now. The
 * caller marks the request `failed` and moves on to the next one.
 */
export async function hardDeleteAccount(
  userId: string,
  requestId: string,
  email: string,
): Promise<HardDeleteResult> {
  // 1. Files first, while the rows that point at them still exist.
  const refs = await collectStorageRefs(userId);

  // 2. Stripe, and this is the one step that aborts the whole deletion.
  //
  // Every other failure here is recoverable: a leaked file can be swept later, a
  // missed email can be resent. A subscription that keeps charging a card for an
  // account that no longer exists is not recoverable from anywhere in this app,
  // because the profile row holding the subscription id is about to be deleted
  // and nothing would ever find it again. Leaving the request pending for one
  // more day costs nothing by comparison.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  await settleStripe(
    profile?.stripe_customer_id ?? null,
    profile?.stripe_subscription_id ?? null,
  );

  // 3a. Decks, explicitly. The FK is `on delete cascade` as of
  //     20260913000000_account_deletion.sql, so this is belt and braces -- but
  //     it was NO ACTION until that migration, and an explicit delete means this
  //     code does not silently depend on a constraint somebody might change back.
  const { error: deckError } = await supabaseAdmin
    .from("presentations")
    .delete()
    .eq("user_id", userId);
  if (deckError) {
    throw new DeletionAbortedError(`Could not delete presentations: ${deckError.message}`);
  }

  // 3b. The files. Best effort, after the rows are gone.
  let filesRemoved = 0;
  try {
    filesRemoved = await sweepStorage(refs);
  } catch (err) {
    console.error("[account-deletion] storage sweep failed", userId, err);
  }

  // 3c. The account itself. ~25 tables cascade from here.
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) {
    throw new DeletionAbortedError(`Could not delete the auth user: ${authError.message}`);
  }

  // 4. Close the request out BY ID. Its user_id was nulled a moment ago by the
  //    cascade, so `.eq("user_id", userId)` here would match nothing.
  const { error: closeError } = await supabaseAdmin
    .from("account_deletion_requests")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", requestId);
  if (closeError) {
    // The account IS gone, so this is not a failure the caller can undo. Log
    // loudly: the row is now a pending request for a user that does not exist,
    // which the executor will try again tomorrow and fail on harmlessly.
    console.error("[account-deletion] could not close the request row", requestId, closeError);
  }

  // Sent to the address on the request row: the account it would otherwise be
  // read from no longer exists. Never throws.
  await sendTemplate("account_deleted", email, {});

  return { filesFound: refs.length, filesRemoved };
}
