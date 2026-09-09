import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, planForPriceId } from "@/app/lib/stripe";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { DEFAULT_PLAN, TOPUP_PENCE } from "@/app/lib/plans";

// Stripe → app sync. This is the ONLY place a user's plan is upgraded/downgraded
// from payment state. It runs with the service-role key (no user session) and
// must verify the signature on the raw body, so the request is never trusted
// blindly. This route is exempted from auth in proxy.ts.

// Statuses that should grant the paid plan. Anything else (canceled, unpaid,
// incomplete_expired, past_due…) falls back to Free.
const ACTIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
]);

function periodEnd(sub: Stripe.Subscription): string | null {
  // `current_period_end` lives on the subscription in older API versions and on
  // each item in newer ones — check both.
  const unix =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end ??
    null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

/**
 * Is this subscription scheduled to stop at the end of the paid period?
 *
 * Two representations, and BOTH must be checked. The long-standing
 * `cancel_at_period_end` boolean is not set under Stripe's flexible billing
 * mode, which instead records the scheduled stop as a concrete `cancel_at`
 * timestamp — a subscription cancelled through the portal can therefore report
 * `cancel_at_period_end: false` while genuinely ending. Reading only the
 * boolean left the billing page announcing "Renews on …" to someone who had
 * just cancelled.
 *
 * `canceled_at` is deliberately NOT used: it records when the cancellation was
 * requested, and is set even on a subscription that has already fully ended.
 */
function endsAtPeriodEnd(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true;
  // A cancel_at in the past belongs to a subscription that has already ended;
  // that is the "canceled" status's business, not this flag's.
  return typeof sub.cancel_at === "number" && sub.cancel_at * 1000 > Date.now();
}

/** Apply a subscription's current state to the owning profile. */
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Resolve the profile: prefer the userId we stamped at checkout, else fall
  // back to the customer id we stored on a previous event.
  let userId = sub.metadata?.userId ?? null;
  if (!userId) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    userId = data?.id ?? null;
  }
  if (!userId) {
    console.warn("[stripe/webhook] no profile for customer", customerId);
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  // Resolves superseded prices too, via plan_price_history — a subscriber who
  // signed up on an older price must not be read as "no subscription" and
  // dropped to Free just because the plan's price has since changed.
  const paidPlan = await planForPriceId(priceId);
  const isActive = ACTIVE_STATUSES.has(sub.status);
  const plan = isActive && paidPlan ? paidPlan : DEFAULT_PLAN;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      // Cancelling via the portal is scheduled, not immediate: the status stays
      // "active" and only this flag marks the subscription as ending. Without it
      // the billing page cannot tell "renewing" from "ending" — see the
      // migration that adds the column. Deliberately NOT part of the `plan`
      // decision above: a subscription set to cancel is still paid for, and the
      // teacher keeps Pro until the period actually ends.
      cancel_at_period_end: endsAtPeriodEnd(sub),
      current_period_end: periodEnd(sub),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) console.error("[stripe/webhook] profile update failed", error);
}

// ── AI credit top-ups ────────────────────────────────────────────────────────

/** End of the current month, UTC — when purchased credit expires. Matches the
 *  convention in admin_grant_allowance(): credit tops up the month it was
 *  bought in and never rolls over. */
function endOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * Grant a credit pack for a completed one-off Checkout session.
 *
 * The pack bought is named in session metadata (see api/stripe/topup), because
 * a checkout.session.completed payload does not carry line_items. What is
 * GRANTED is the pack's unit; what is RECORDED as money is the amount paid.
 * The two differ under a promotion code.
 *
 * IDEMPOTENCY: Stripe retries on any non-2xx, and this handler deliberately
 * returns 500 on failure to invite those retries — so this must not grant twice
 * for one payment. The `topup_purchases` insert is the gate: its
 * `stripe_payment_intent_id` column is UNIQUE, so a retry loses the race and
 * hits 23505, and we return before touching the grant.
 *
 * The write ORDER is therefore load-bearing: purchase row first, then the
 * grant, then the invoice mirror. Do not reorder these — `invoices` has no
 * unique key that would stop a duplicate on its own.
 */
async function grantTopUpCredit(session: Stripe.Checkout.Session) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  // Without a PaymentIntent there is no idempotency key, so granting could
  // double up on a retry. Skip rather than risk it.
  if (!paymentIntentId) {
    console.warn("[stripe/webhook] top-up session has no payment_intent", session.id);
    return;
  }

  const userId = session.metadata?.userId ?? session.client_reference_id;
  if (!userId) {
    console.warn("[stripe/webhook] top-up session has no userId", session.id);
    return;
  }

  const paidPence = session.amount_total ?? TOPUP_PENCE;

  // Which pack was bought.
  //
  // Stamped into metadata at session creation (see api/stripe/topup) because a
  // checkout.session.completed payload does NOT carry line_items — the
  // purchased price is not otherwise knowable here without another Stripe call.
  //
  // Falls back to the lowest-sort active pack when absent, which is both what
  // this did before packs could be chosen AND what settles a session that was
  // already in flight when this shipped.
  const metaPackId = session.metadata?.packId ?? null;

  let packQuery = supabaseAdmin
    .from("topup_packs")
    .select("id, kind, unit")
    .eq("kind", "credit_gbp");

  packQuery = metaPackId
    ? packQuery.eq("id", metaPackId)
    : packQuery.eq("active", true).order("sort").limit(1);

  const { data: creditPack, error: packErr } = await packQuery.maybeSingle();

  if (packErr) {
    console.error("[stripe/webhook] credit pack lookup failed", packErr);
  }

  // Grant what the PACK promises, not what was paid.
  //
  // These differ under a promotion code: a 50% code on a £5 pack charges £2.50,
  // and granting the amount paid would hand over half the credits the teacher
  // was shown on the button they pressed. A discount makes a pack cheaper, not
  // smaller.
  //
  // Falls back to the amount paid when the pack is unknown — an env-price
  // purchase, or a pack deleted between checkout and this webhook. For the
  // single £1.50 pack the two are identical, since a credit pack's `unit` is
  // required to equal its price in pence (see api/admin/topups/pack).
  const amountPence = creditPack?.unit != null ? Number(creditPack.unit) : paidPence;

  // 1. Idempotency gate.
  const { error: purchaseErr } = await supabaseAdmin.from("topup_purchases").insert({
    user_id: userId,
    pack_id: creditPack?.id ?? null,
    kind: creditPack?.kind ?? "credit_gbp",
    units: amountPence, // pence, matching allowance_grants.amount for this kind
    // What they actually PAID, which is the figure the invoice and the admin
    // revenue column must show — not the pack's face value.
    price_gbp: toMajor(paidPence),
    stripe_payment_intent_id: paymentIntentId,
  });
  if (purchaseErr) {
    if (purchaseErr.code === "23505") return; // already processed — not an error
    throw purchaseErr; // 500 → Stripe retries
  }

  // 2. The credit itself. `amount` is PENCE for kind='credit_gbp'.
  const { error: grantErr } = await supabaseAdmin.from("allowance_grants").insert({
    user_id: userId,
    kind: "credit_gbp",
    amount: amountPence,
    reason: "Purchased AI credit top-up",
    granted_by: null, // bought, not granted by an admin
    expires_at: endOfMonthIso(),
  });
  if (grantErr) throw grantErr;

  // 3. Local mirror so the charge shows in billing views without a Stripe trip.
  //
  // stripe_charge_id matters as much as the row itself: syncRefund() finds the
  // invoice to mark refunded by charge id, so a mirror without one can never be
  // marked refunded and the admin console goes on showing "paid" after the money
  // has gone back. A Checkout session carries the PaymentIntent, not the charge,
  // so resolve it here.
  const chargeId = await chargeIdForPaymentIntent(paymentIntentId);

  const { error: invoiceErr } = await supabaseAdmin.from("invoices").insert({
    reference: session.id,
    user_id: userId,
    type: "topup",
    // The money that actually moved, not the pack's face value: these differ
    // under a promotion code, and syncRefund() reconciles this row against a
    // real Stripe charge.
    amount_gbp: toMajor(paidPence),
    status: "paid",
    paid_at: new Date().toISOString(),
    method: "Card · AI credit top-up",
    stripe_charge_id: chargeId,
  });
  if (invoiceErr) {
    // The credit is already granted, which is what the customer paid for.
    // Don't throw: a retry would hit the purchase gate and skip the grant,
    // leaving this row missing anyway. Log it for manual reconciliation.
    console.error("[stripe/webhook] top-up invoice mirror failed", invoiceErr);
  }
}

// ── Ambassador referrals ─────────────────────────────────────────────────────

/**
 * Record the first month an ambassador referral actually paid.
 *
 * WHY THIS HANGS OFF invoice.paid AND NOT THE SUBSCRIPTION
 *
 * A payout should be owed when money arrives, not when a subscription goes
 * active. Those differ: a card can fail on the first charge, and a subscription
 * can be comped by an admin with no card at all. Hanging this off a paid invoice
 * is the same discipline teacher_mrr() applies to MRR — count what was actually
 * billed, never a plan column that an admin can set by hand.
 *
 * IDEMPOTENT BY CONSTRUCTION. The update is conditioned on `first_paid_at is
 * null`, so a Stripe retry, an out-of-order delivery, or next month's renewal
 * all find nothing to do. The first paid month stays the first one, and a payout
 * already settled is never reopened.
 */
async function markReferralPaid(inv: Stripe.Invoice) {
  const customerId = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  const userId = await userIdForCustomer(customerId);
  if (!userId) return;

  // A SUBSCRIPTION invoice only. A credit top-up is a one-off payment and must
  // never make an ambassador payable: the offer is for bringing in a subscriber.
  // `parent.type` is how a real invoice identifies itself — verified against the
  // live account, where both subscription invoices read 'subscription_details'.
  const parentType = (inv as unknown as { parent?: { type?: string } }).parent?.type;
  if (parentType !== "subscription_details") return;

  // WHICH PLAN WAS BOUGHT, read from the INVOICE rather than from the profile.
  //
  // The profile would be the obvious source, but it is only right if
  // syncSubscription has already run for this purchase. Stripe does not promise
  // an order between checkout.session.completed and invoice.paid, so on the
  // wrong ordering the profile still reads 'free' and this would skip the
  // referral permanently — the update is once-only, so there is no second
  // chance at it. The invoice carries the price it charged, which is true
  // whenever this arrives.
  //
  // planForPriceId resolves superseded prices via plan_price_history too, so a
  // subscriber on an older price is not mistaken for a non-subscriber.
  // `price` is an id string unexpanded and a Price object when expanded, so
  // accept either rather than depending on how the event happens to arrive.
  const price = inv.lines?.data?.[0]?.pricing?.price_details?.price;
  const priceId = typeof price === "string" ? price : (price?.id ?? null);
  const plan = priceId ? await planForPriceId(priceId) : null;

  // Pro and Max only. Free is tracked but never payable, and `school` is
  // invoiced per seat rather than referred.
  if (plan !== "pro" && plan !== "max") return;

  // Note there is deliberately NO check that the amount paid was nonzero. A 100%
  // ambassador code bills GBP 0.00 on the first month, and that subscriber is
  // exactly who the ambassador is owed for. On the live account one such invoice
  // already reads amount_paid 0 against a GBP 7.99 plan.

  const { error } = await supabaseAdmin
    .from("ambassador_referrals")
    .update({
      first_paid_at: new Date().toISOString(),
      first_paid_plan: plan,
      // 'na' becomes 'unpaid': this ambassador is now owed for this teacher.
      payout_status: "unpaid",
    })
    .eq("user_id", userId)
    .is("first_paid_at", null);

  if (error) console.error("[stripe/webhook] referral payout mark failed", error);
}

/**
 * A refunded first payment un-owes the payout.
 *
 * Only while it is still 'unpaid'. A payout already marked 'paid' is real money
 * that has left the building, and silently rewriting it to 'na' would make the
 * admin console disagree with the bank. Those are settled by hand.
 */
async function reverseReferralPayout(userId: string) {
  const { error } = await supabaseAdmin
    .from("ambassador_referrals")
    .update({ first_paid_at: null, first_paid_plan: null, payout_status: "na" })
    .eq("user_id", userId)
    .eq("payout_status", "unpaid");

  if (error) console.error("[stripe/webhook] referral payout reversal failed", error);
}

// ── Invoice mirroring ────────────────────────────────────────────────────────
// Stripe remains the system of record for card payments; these rows are a local
// mirror so the admin console can list card charges and school BACS invoices in
// one place, and so a failed payment is visible without opening the Stripe
// dashboard. Nothing here grants or revokes access — only syncSubscription does
// that.

/** Stripe works in minor units (pence). Everything we store is major (pounds). */
function toMajor(minor: number | null | undefined): number {
  return (minor ?? 0) / 100;
}

/**
 * The charge behind a PaymentIntent.
 *
 * Checkout sessions and PaymentIntents both reference the charge indirectly, but
 * refunds arrive as charge.refunded — so the charge id is what links a payment
 * to its refund. Best-effort: a missing charge id only costs refund tracking,
 * never the credit the customer paid for, so this never throws.
 */
async function chargeIdForPaymentIntent(paymentIntentId: string): Promise<string | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const latest = pi.latest_charge;
    return typeof latest === "string" ? latest : (latest?.id ?? null);
  } catch (err) {
    console.error("[stripe/webhook] could not resolve charge for", paymentIntentId, err);
    return null;
  }
}

/**
 * The charge behind an invoice, via its InvoicePayment records.
 *
 * This is where the payment reference lives now that `invoice.charge` and
 * `invoice.payment_intent` have both been removed from the Invoice object. An
 * invoice can have several payments (a retried card, part-payments), so prefer
 * the one Stripe marks `is_default`, then any that actually succeeded.
 *
 * Only `payment_intent` payments resolve to a charge — `payment_record` covers
 * out-of-band money (a bank transfer recorded by hand) which has no Stripe
 * charge to point at, and correctly yields null.
 *
 * Best-effort, like chargeIdForPaymentIntent: a missing charge id costs refund
 * tracking, never the customer's access, so this never throws.
 */
async function chargeIdForInvoice(invoiceId: string | null | undefined): Promise<string | null> {
  if (!invoiceId) return null;
  try {
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
    const paid = payments.data.filter((p) => p.status === "paid");
    const best = paid.find((p) => p.is_default) ?? paid[0];

    const payment = best?.payment;
    if (payment?.type !== "payment_intent") return null;

    const pi = payment.payment_intent;
    const piId = typeof pi === "string" ? pi : (pi?.id ?? null);
    return piId ? await chargeIdForPaymentIntent(piId) : null;
  } catch (err) {
    console.error("[stripe/webhook] could not resolve charge for invoice", invoiceId, err);
    return null;
  }
}

/** Resolve the local profile id for a Stripe customer. */
async function userIdForCustomer(customer: string | null): Promise<string | null> {
  if (!customer) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  return data?.id ?? null;
}

/** Human-readable payment method, e.g. "Visa ••4242 · Pro monthly". */
function describeInvoice(inv: Stripe.Invoice): string {
  const line = inv.lines?.data?.[0];
  const desc = line?.description ?? null;
  const brandLast4 = (
    inv as unknown as {
      payment_method_details?: { card?: { brand?: string; last4?: string } };
    }
  ).payment_method_details?.card;

  const parts: string[] = [];
  if (brandLast4?.brand && brandLast4?.last4) {
    parts.push(`${brandLast4.brand} ••${brandLast4.last4}`);
  }
  if (desc) parts.push(desc);
  return parts.join(" · ") || "Card · Stripe";
}

/**
 * Upsert one Stripe invoice into our table, keyed on stripe_invoice_id so
 * webhook retries and out-of-order delivery converge rather than duplicate.
 */
async function syncInvoice(inv: Stripe.Invoice, status: string) {
  const customerId = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  const userId = await userIdForCustomer(customerId);

  // A charge with no local profile is almost certainly test noise or a customer
  // created outside the app. Log rather than inventing an orphan row.
  if (!userId) {
    console.warn("[stripe/webhook] no profile for invoice customer", customerId);
    return;
  }

  // Resolving the charge behind an invoice has moved TWICE as the API evolved:
  // `invoice.charge` → `invoice.payment_intent` → the InvoicePayment sub-object.
  // Both of the older fields are now removed outright (they are absent from the
  // payload, not null), so reading only those yielded null on every invoice and
  // left syncRefund() unable to find the row to mark refunded.
  //
  // Try newest first, then the legacy fields, so this keeps working whichever
  // API version an event was created under.
  let chargeId = await chargeIdForInvoice(inv.id);

  if (!chargeId) {
    const invAny = inv as unknown as {
      charge?: string | { id: string };
      payment_intent?: string | { id: string };
    };
    chargeId =
      typeof invAny.charge === "string" ? invAny.charge : (invAny.charge?.id ?? null);
    if (!chargeId) {
      const pi =
        typeof invAny.payment_intent === "string"
          ? invAny.payment_intent
          : (invAny.payment_intent?.id ?? null);
      if (pi) chargeId = await chargeIdForPaymentIntent(pi);
    }
  }

  const { error } = await supabaseAdmin.from("invoices").upsert(
    {
      stripe_invoice_id: inv.id,
      reference: inv.number ?? inv.id ?? "—",
      user_id: userId,
      type: "card",
      amount_gbp: toMajor(inv.amount_due || inv.total),
      status,
      due_at: inv.due_date ? new Date(inv.due_date * 1000).toISOString().slice(0, 10) : null,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      method: describeInvoice(inv),
      stripe_charge_id: chargeId,
      attempt_count: inv.attempt_count ?? 0,
      failure_reason:
        status === "failed"
          ? ((inv as unknown as { last_finalization_error?: { message?: string } })
              .last_finalization_error?.message ?? "Payment failed")
          : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_invoice_id" },
  );

  if (error) console.error("[stripe/webhook] invoice upsert failed", error);
}

/**
 * Mark the originating invoice refunded, and claw back any AI credit the refund
 * paid for.
 *
 * Matching is by charge id first, then by the PaymentIntent via the
 * topup_purchases row. The fallback exists because rows written before the
 * charge id was recorded have a null stripe_charge_id, and without it those
 * invoices would show "paid" forever after the money went back.
 *
 * A PARTIAL refund deliberately does not flip the status: "refunded" on a row
 * whose amount_gbp still reads the full charge would overstate refunded revenue
 * in admin_billing_summary. Partials are left as-is until there is somewhere
 * honest to record the refunded portion.
 */
async function syncRefund(charge: Stripe.Charge) {
  const refunded = charge.amount_refunded ?? 0;
  if (!charge.refunded && refunded === 0) return;

  const isFull = refunded >= charge.amount;
  if (!isFull) {
    console.warn(
      "[stripe/webhook] partial refund not mirrored locally",
      charge.id,
      `${refunded}/${charge.amount}`,
    );
    return;
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  // Find the invoice by charge id, or by the session reference recorded against
  // the top-up purchase for the same PaymentIntent.
  let query = supabaseAdmin.from("invoices").select("id").eq("stripe_charge_id", charge.id);
  let { data: rows } = await query;

  if ((!rows || rows.length === 0) && paymentIntentId) {
    const { data: purchase } = await supabaseAdmin
      .from("topup_purchases")
      .select("user_id, created_at")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (purchase) {
      query = supabaseAdmin
        .from("invoices")
        .select("id")
        .eq("user_id", purchase.user_id)
        .eq("type", "topup")
        .eq("amount_gbp", charge.amount / 100)
        .is("stripe_charge_id", null);
      ({ data: rows } = await query);
    }
  }

  if (rows && rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("invoices")
      .update({
        status: "refunded",
        stripe_charge_id: charge.id, // backfill so a repeat event matches directly
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (error) console.error("[stripe/webhook] refund sync failed", error);
  } else {
    console.warn("[stripe/webhook] refund had no matching invoice", charge.id);
  }

  // Take back the credit the refund undid. Without this the customer keeps
  // £1.50 of AI spend they are no longer paying for, until it expires at month
  // end. Only unspent credit is removed — see below.
  if (paymentIntentId) {
    await reverseTopUpCredit(paymentIntentId, charge.amount);
  }

  // A refunded subscription payment un-owes any ambassador payout it created.
  // Only while still 'unpaid' — see reverseReferralPayout.
  const customerId = typeof charge.customer === "string" ? charge.customer : (charge.customer?.id ?? null);
  const refundedUserId = await userIdForCustomer(customerId);
  if (refundedUserId) {
    await reverseReferralPayout(refundedUserId);
  }
}

/**
 * Remove the allowance grant created by a refunded top-up.
 *
 * Deleting the grant is right even if some of the credit has already been
 * spent: the ceiling is measured against real provider cost, so a partly-used
 * credit that is then refunded should stop subsidising further spend. We do not
 * claw back spend that already happened — that is a cost of doing business, and
 * billing a refunded customer for it would be worse.
 */
async function reverseTopUpCredit(paymentIntentId: string, amountPence: number) {
  const { data: purchase } = await supabaseAdmin
    .from("topup_purchases")
    .select("user_id, created_at")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (!purchase) return;

  // Match the specific grant this purchase created: same user, same amount,
  // bought (granted_by is null) rather than granted by an admin, and created in
  // the same moment. Belt and braces so a refund can't delete a goodwill grant.
  const { data: grants } = await supabaseAdmin
    .from("allowance_grants")
    .select("id")
    .eq("user_id", purchase.user_id)
    .eq("kind", "credit_gbp")
    .eq("amount", amountPence)
    .is("granted_by", null)
    .gte("created_at", new Date(new Date(purchase.created_at).getTime() - 60_000).toISOString())
    .lte("created_at", new Date(new Date(purchase.created_at).getTime() + 60_000).toISOString())
    .limit(1);

  if (grants && grants.length > 0) {
    const { error } = await supabaseAdmin
      .from("allowance_grants")
      .delete()
      .eq("id", grants[0].id);
    if (error) console.error("[stripe/webhook] could not reverse top-up credit", error);
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id,
          );
          // Carry the userId from the session in case it wasn't on the sub.
          if (session.client_reference_id && !sub.metadata?.userId) {
            sub.metadata = { ...sub.metadata, userId: session.client_reference_id };
          }
          await syncSubscription(sub);
        } else if (session.mode === "payment" && session.metadata?.kind === "credit_topup") {
          // One-off £1.50 AI credit. No subscription is involved, so this grants
          // an allowance row rather than changing the plan.
          await grantTopUpCredit(session);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      // ── Invoice mirroring ──────────────────────────────────────────────
      // Access is never granted or revoked here — that stays with
      // syncSubscription above. These only keep the local invoice list and the
      // "failed payments" queue in step with Stripe.
      case "invoice.created":
      case "invoice.finalized": {
        await syncInvoice(event.data.object as Stripe.Invoice, "sent");
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        await syncInvoice(inv, "paid");
        // Money has actually arrived, which is the moment an ambassador becomes
        // owed for this teacher. Idempotent: only ever writes the FIRST payment.
        await markReferralPaid(inv);
        break;
      }
      case "invoice.payment_failed": {
        await syncInvoice(event.data.object as Stripe.Invoice, "failed");
        break;
      }
      case "invoice.voided": {
        await syncInvoice(event.data.object as Stripe.Invoice, "void");
        break;
      }
      case "charge.refunded": {
        await syncRefund(event.data.object as Stripe.Charge);
        break;
      }

      default:
        // Ignore the many event types we don't act on.
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries — the handler is idempotent (it just writes
    // current state), so a retry is safe.
    console.error("[stripe/webhook] handler error", err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
