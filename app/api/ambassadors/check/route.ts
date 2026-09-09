import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/auth/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { stripe } from "@/app/lib/stripe";

// Is this code good, and what does it give you? Read-only: nothing is claimed
// here, which is what lets the welcome screen show "20% off your first month"
// before a teacher commits to anything.
//
// Mirrors /api/invites/check, including the shape of the answer: `valid` plus a
// `reason` the caller turns into a sentence. Attribution happens in
// /api/ambassadors/claim and nowhere else.
//
// Deliberately reveals nothing beyond whether a code works and what it is worth.
// The ambassador behind it is never named: that is internal, and a teacher
// typing a guessed code should not be able to enumerate who is running one.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in only. A code is worth nothing without an account to attach it to,
  // and this keeps the endpoint from being a public code-guessing oracle.
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) {
    return NextResponse.json({ valid: false, reason: "missing" }, { status: 400 });
  }

  // Service role for the lookup. `ambassador_codes` is admin-only by design —
  // a teacher has no read policy on it — so the caller's own client sees
  // nothing and every valid code would read as "not recognised".
  //
  // Safe: the only thing that leaves this route is whether the one code the
  // caller typed is usable and what it is worth. The ambassador behind it is
  // never named, and no other row is reachable.
  const { data: row, error } = await supabaseAdmin
    .from("ambassador_codes")
    .select("promotion_code_id, code, ambassadors(status)")
    .ilike("code", code)
    .maybeSingle();

  if (error) {
    console.error("[ambassadors/check] lookup failed", error);
    return NextResponse.json({ valid: false, reason: "error" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ valid: false, reason: "unknown" });
  }

  const ambassador = row.ambassadors as unknown as { status?: string } | null;
  if (ambassador?.status !== "active") {
    return NextResponse.json({ valid: false, reason: "inactive" });
  }

  // Has this teacher already used one? Answering here means the UI can show the
  // code they hold instead of an input they cannot use.
  // Service role again, and scoped to the caller's own id, so this can only
  // ever find their own referral.
  const { data: existing } = await supabaseAdmin
    .from("ambassador_referrals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ valid: false, reason: "already_claimed" });
  }

  try {
    const promo = await stripe.promotionCodes.retrieve(row.promotion_code_id, {
      expand: ["promotion.coupon"],
    });

    const expired = promo.expires_at ? promo.expires_at * 1000 < Date.now() : false;
    const capped =
      promo.max_redemptions != null && (promo.times_redeemed ?? 0) >= promo.max_redemptions;

    if (!promo.active || expired || capped) {
      return NextResponse.json({ valid: false, reason: "inactive" });
    }

    const promotion = (promo as unknown as { promotion?: { coupon?: unknown } }).promotion;
    const coupon =
      promotion && typeof promotion.coupon === "object" && promotion.coupon !== null
        ? (promotion.coupon as { percent_off?: number | null; amount_off?: number | null })
        : null;

    const offer =
      coupon?.percent_off != null
        ? `${coupon.percent_off}% off your first month`
        : coupon?.amount_off != null
          ? `${(coupon.amount_off / 100).toLocaleString("en-GB", {
              style: "currency",
              currency: "GBP",
            })} off your first month`
          : null;

    return NextResponse.json({ valid: true, code: row.code, offer });
  } catch (err) {
    // Stripe being unreachable must not make a good code look bad. Report it as
    // valid with no offer text: the claim route re-checks anyway, and checkout
    // is where it finally matters.
    console.error("[ambassadors/check] could not reach Stripe", err);
    return NextResponse.json({ valid: true, code: row.code, offer: null });
  }
}
