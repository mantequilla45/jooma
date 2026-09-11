import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/auth/server";
import { stripe, priceIdFor, isPaidPlanId } from "@/app/lib/stripe";
import { PLANS, asPlanId } from "@/app/lib/plans";

// Moves an existing subscriber DOWN to a cheaper plan (today: Max to Pro), at
// the END of the period they have already paid for.
//
// WHY NOT AN IMMEDIATE SWAP LIKE ../upgrade
// Because the allowance is not prorated and cannot be. A plan's AI ceiling is a
// flat monthly figure (AI_SPEND_CEILING_PENCE), and monthly_ai_spend measures
// what has been spent since the 1st. Flipping Max to Pro mid-month drops the
// ceiling 375p to 150p while the spend already on the clock stays put, so a
// teacher who had used, say, 200p of their Max allowance would be instantly
// over a Pro ceiling and hard-blocked until the 1st — having just asked to pay
// us LESS, not to stop working. They would also be owed a refund for the part
// of Max they had paid for and no longer had.
//
// Scheduling the change for the renewal date avoids both. They keep everything
// they paid for until the day it runs out, then the cheaper plan begins. No
// proration, no refund, no cliff.
//
// WHAT THIS ROUTE CANNOT DO
// Same posture as ../upgrade: the target is checked against the paid-plan
// allowlist, the price is resolved SERVER-SIDE by priceIdFor(), and the
// subscription id comes from the caller's own profile row. No price, item or
// amount is ever read from the request body. It additionally refuses any target
// that is not strictly cheaper than the current plan, so it can never be used
// as an un-prorated upgrade.
//
// It does not write profiles.plan either — nothing has changed yet. The plan
// changes when the schedule advances and Stripe fires
// customer.subscription.updated, which syncSubscription handles already.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const requested = (body as { plan?: unknown } | null)?.plan;

  // Allowlist, not a cast. Note this also rejects "free": dropping to Free is a
  // cancellation, not a price swap, and goes through the portal's
  // subscription_cancel flow instead. priceIdFor() would throw on it anyway.
  if (!isPaidPlanId(requested)) {
    return NextResponse.json(
      { error: "That isn't a plan you can switch to." },
      { status: 400 },
    );
  }
  const target = requested;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "plan, stripe_subscription_id, subscription_status, cancel_at_period_end",
    )
    .eq("id", user.id)
    .maybeSingle();

  const current = asPlanId(profile?.plan);

  if (current === target) {
    return NextResponse.json(
      { error: `You're already on ${PLANS[target].name}.` },
      { status: 400 },
    );
  }

  // The direction check. Without it this route would be an upgrade that skips
  // the proration the upgrade route deliberately charges — a way to get Max at
  // Pro's price for the rest of the month.
  const currentPrice = PLANS[current].priceMonthly ?? 0;
  const targetPrice = PLANS[target].priceMonthly ?? 0;
  if (targetPrice >= currentPrice) {
    return NextResponse.json(
      { error: `${PLANS[target].name} isn't a step down from your current plan.` },
      { status: 400 },
    );
  }

  // Ownership check: the subscription id comes from THIS user's profile row,
  // never from the request body.
  const subscriptionId = profile?.stripe_subscription_id;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "You don't have a subscription to change." },
      { status: 400 },
    );
  }

  if (profile?.subscription_status === "canceled") {
    return NextResponse.json(
      { error: "This subscription has ended. Please subscribe again." },
      { status: 400 },
    );
  }

  // Already on its way out. Scheduling a plan change for a subscription that
  // will not renew would schedule nothing, and quietly: the phase would never
  // start because the subscription ends first. Renewing is one click away on
  // the same page.
  if (profile?.cancel_at_period_end) {
    return NextResponse.json(
      {
        error:
          "Your plan is already set to end. Renew it first if you'd like to move to a cheaper plan instead.",
      },
      { status: 400 },
    );
  }

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);

    const item = sub.items.data[0];
    if (!item?.price?.id) {
      console.error("[stripe/downgrade] subscription has no items", subscriptionId);
      return NextResponse.json(
        { error: "Could not change your plan. Please contact support." },
        { status: 500 },
      );
    }

    const priceId = await priceIdFor(target);

    // Already billing at the target price even though our row disagrees. Let
    // the webhook reconcile rather than scheduling a phase that changes nothing.
    if (item.price.id === priceId) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // One schedule at a time. If they already scheduled a downgrade, replace it
    // rather than stacking a second — Stripe allows only one schedule per
    // subscription, so creating another would fail anyway, and releasing first
    // makes changing their mind from Max-to-Pro to something else just work.
    const existing = sub.schedule;
    const existingId = typeof existing === "string" ? existing : existing?.id;
    if (existingId) {
      await stripe.subscriptionSchedules.release(existingId);
    }

    // from_subscription adopts the live subscription rather than creating a
    // second one. The schedule starts out with a single phase mirroring the
    // current period, which is exactly what we want to keep as phase one.
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });

    const currentPhase = schedule.phases[0];
    if (!currentPhase) {
      console.error("[stripe/downgrade] schedule has no phases", schedule.id);
      return NextResponse.json(
        { error: "Could not change your plan. Please contact support." },
        { status: 500 },
      );
    }

    await stripe.subscriptionSchedules.update(schedule.id, {
      // end_behavior "release" hands control back to the plain subscription once
      // the last phase starts, so the subscription carries on renewing at the
      // new price instead of stopping. The default is "release" but it is worth
      // being explicit: "cancel" here would silently end their subscription at
      // the next renewal, which is emphatically not what they asked for.
      end_behavior: "release",
      phases: [
        {
          // Phase one: what they already paid for, untouched.
          items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
          start_date: currentPhase.start_date,
          end_date: currentPhase.end_date,
        },
        {
          // Phase two: the cheaper plan, starting the moment phase one ends.
          items: [{ price: priceId, quantity: item.quantity ?? 1 }],
          // No proration: nothing is being changed mid-period, so there is
          // nothing to prorate. Stated rather than left to the default because
          // a stray proration on a downgrade would issue a credit note for a
          // period the teacher fully used.
          proration_behavior: "none",
        },
      ],
      metadata: { userId: user.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;

    console.error("[stripe/downgrade]", target, err);
    return NextResponse.json(
      { error: message ?? "Could not change your plan." },
      { status: 500 },
    );
  }
}

/**
 * Cancel a scheduled downgrade, so the subscription simply carries on.
 *
 * Releasing the schedule leaves the subscription exactly as it was — same
 * price, same renewal date — rather than cancelling anything. That is the whole
 * undo: the plan they are on was never changed in the first place.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", user.id)
    .maybeSingle();

  const subscriptionId = profile?.stripe_subscription_id;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "There's no subscription to change." },
      { status: 400 },
    );
  }

  try {
    // Re-read the subscription to find its schedule rather than taking an id
    // from the caller: releasing a schedule id supplied by the client would let
    // anyone release somebody else's.
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const schedule = sub.schedule;
    const scheduleId = typeof schedule === "string" ? schedule : schedule?.id;

    // Nothing scheduled. Report success: the end state they asked for — no
    // pending change — is the state they are already in.
    if (!scheduleId) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    await stripe.subscriptionSchedules.release(scheduleId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;

    console.error("[stripe/downgrade] release", err);
    return NextResponse.json(
      { error: message ?? "Could not cancel the plan change." },
      { status: 500 },
    );
  }
}
