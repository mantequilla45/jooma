import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/auth/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { stripe } from "@/app/lib/stripe";

// Records the signed-in teacher as referred by whoever owns this code.
//
// Modelled on /api/invites/accept, and for the same reason: a benefit the
// client must not be able to grant itself has to be decided by the server. The
// difference is that this grants NOTHING at all — it only writes attribution.
// The discount itself is applied by Stripe at checkout, from the referral row
// this creates (see app/api/stripe/checkout).
//
// WHY THE CLAIM IS STORED BEFORE ANY MONEY MOVES
//
// A teacher can take a code, choose Free, and subscribe weeks later. Recording
// the claim now means that gap costs nothing: checkout reads the referral out of
// our own database rather than out of a session or a URL, so attribution cannot
// expire. Only the Stripe-side discount can go stale, and checkout degrades to
// full price rather than blocking the sale when it has.

/** Why a code cannot be used, in words a teacher can act on. */
function refusal(reason: string): string {
  switch (reason) {
    case "unknown_code":
      return "That code isn't recognised. Check the spelling and try again.";
    case "inactive":
      return "That code is no longer being offered.";
    case "already_claimed":
      return "You have already used a code on this account.";
    default:
      return "That code can't be used.";
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) {
    return NextResponse.json({ error: "Enter a code." }, { status: 400 });
  }

  // Look the code up locally first. This is what decides attribution, and it is
  // the only part that must be right for the ambassador to be paid.
  //
  // Service role: `ambassador_codes` is admin-only by design, so the caller's
  // own client sees nothing and every valid code would look unrecognised. The
  // actual write below still goes through the USER's client, because
  // claim_ambassador_code() reads auth.uid() to decide whose referral it is.
  const { data: row, error } = await supabaseAdmin
    .from("ambassador_codes")
    .select("promotion_code_id, code, ambassadors(status)")
    .ilike("code", code)
    .maybeSingle();

  if (error) {
    console.error("[ambassadors/claim] code lookup failed", error);
    return NextResponse.json({ error: "Could not check that code." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: refusal("unknown_code") }, { status: 400 });
  }

  // Then confirm Stripe still honours it, so a teacher is never told a code is
  // applied when checkout would refuse it. A Stripe outage is deliberately NOT
  // fatal here: attribution is ours to record, and the worst case is that they
  // find out at checkout rather than now.
  let offer: string | null = null;
  try {
    const promo = await stripe.promotionCodes.retrieve(row.promotion_code_id, {
      expand: ["promotion.coupon"],
    });

    const expired = promo.expires_at ? promo.expires_at * 1000 < Date.now() : false;
    const capped =
      promo.max_redemptions != null && (promo.times_redeemed ?? 0) >= promo.max_redemptions;

    if (!promo.active || expired || capped) {
      return NextResponse.json({ error: refusal("inactive") }, { status: 400 });
    }

    offer = describeOffer(promo);
  } catch (err) {
    console.error("[ambassadors/claim] could not verify with Stripe", err);
  }

  // The write. Refuses to reassign an existing referral, so a second code can
  // never move a teacher between ambassadors.
  const { data: result, error: claimError } = await supabase.rpc("claim_ambassador_code", {
    p_code: code,
  });

  if (claimError) {
    console.error("[ambassadors/claim] claim failed", claimError);
    return NextResponse.json({ error: "Could not apply that code." }, { status: 500 });
  }

  const claimed = (result as { claimed?: boolean } | null)?.claimed === true;
  const reason = (result as { reason?: string } | null)?.reason ?? null;

  if (!claimed) {
    return NextResponse.json(
      { claimed: false, error: refusal(reason ?? "") },
      // An already-claimed code is a normal outcome rather than a fault, but the
      // UI still needs to know it did not take.
      { status: 400 },
    );
  }

  return NextResponse.json({ claimed: true, code: row.code, offer });
}

/** The offer in a teacher-facing sentence, e.g. "20% off your first month". */
function describeOffer(promo: unknown): string | null {
  // The coupon hangs off `promotion` on this API version rather than off the
  // promotion code itself, and an unexpanded response leaves it as a bare id.
  // Same shape the admin promos page has to narrow by hand.
  const promotion = (promo as { promotion?: { coupon?: unknown } }).promotion;
  const coupon =
    promotion && typeof promotion.coupon === "object" && promotion.coupon !== null
      ? (promotion.coupon as { percent_off?: number | null; amount_off?: number | null })
      : null;

  if (!coupon) return null;
  if (coupon.percent_off != null) return `${coupon.percent_off}% off your first month`;
  if (coupon.amount_off != null) {
    return `${(coupon.amount_off / 100).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
    })} off your first month`;
  }
  return null;
}
