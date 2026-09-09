import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/app/lib/auth/admin-route";
import { stripe } from "@/app/lib/stripe";

// Create ambassadors and move their payouts.
//
// CODE CREATION IS NOT REIMPLEMENTED HERE. The coupon and promotion code are
// minted through the same Stripe calls /api/admin/promos already makes, so an
// ambassador's code is an ordinary promotion code: it shows up on /admin/promos,
// it can be deactivated there, and the immutability rules are the same. What
// this route adds is the link between that code and a person.
//
// The payout column is deliberately manual. Jooma never moves money here; an
// admin records that they have paid someone out of band.

/** Ambassador codes discount ONE month, because a payout is one and done. */
const AMBASSADOR_DURATION = "once" as const;

export async function POST(req: NextRequest) {
  const gate = await requireAdminRoute("change_plan");
  if (gate.error) return gate.error;

  let body: {
    fullName?: string;
    email?: string;
    notes?: string;
    code?: string;
    percentOff?: number;
    amountOffGbp?: number;
    maxRedemptions?: number;
    expiresAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fullName = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!fullName) {
    return NextResponse.json({ error: "Enter the ambassador's full name." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // Stripe uppercases codes and matches them case-insensitively at checkout.
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return NextResponse.json(
      { error: "Use 3-40 characters: letters, numbers, hyphens or underscores." },
      { status: 400 },
    );
  }

  const percentOff = body.percentOff != null ? Number(body.percentOff) : null;
  const amountOffGbp = body.amountOffGbp != null ? Number(body.amountOffGbp) : null;

  if ((percentOff == null) === (amountOffGbp == null)) {
    return NextResponse.json(
      { error: "Give either a percentage off or an amount off, not both." },
      { status: 400 },
    );
  }
  if (percentOff != null && (!(percentOff > 0) || percentOff > 100)) {
    return NextResponse.json(
      { error: "A percentage discount must be between 1 and 100." },
      { status: 400 },
    );
  }
  if (amountOffGbp != null && (!(amountOffGbp > 0) || amountOffGbp > 500)) {
    return NextResponse.json(
      { error: "An amount off must be between £0.01 and £500." },
      { status: 400 },
    );
  }

  let expiresAt: number | undefined;
  if (body.expiresAt) {
    const parsed = Date.parse(body.expiresAt);
    if (Number.isNaN(parsed)) {
      return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
    }
    if (parsed <= Date.now()) {
      return NextResponse.json({ error: "That expiry date is in the past." }, { status: 400 });
    }
    expiresAt = Math.floor(parsed / 1000);
  }

  // The ambassador first: without a row to attach it to, a code created in
  // Stripe would be orphaned, and Stripe coupons cannot be deleted.
  const { data: ambassadorId, error: createError } = await gate.supabase.rpc(
    "admin_create_ambassador",
    { payload: { full_name: fullName, email, notes: body.notes ?? null } },
  );

  if (createError) {
    console.error("[admin/ambassadors] create failed", createError);
    return NextResponse.json(
      { error: createError.message || "Could not add the ambassador." },
      { status: 400 },
    );
  }

  try {
    const coupon = await stripe.coupons.create({
      name: code,
      // One month only. A repeating or forever discount would keep costing on
      // every renewal while the payout is settled once, which is not the deal.
      duration: AMBASSADOR_DURATION,
      ...(percentOff != null
        ? { percent_off: percentOff }
        : { amount_off: Math.round(Number(amountOffGbp) * 100), currency: "gbp" }),
    });

    const promotionCode = await stripe.promotionCodes.create({
      // The coupon nests under `promotion` on this API version rather than
      // sitting on the promotion code directly.
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      ...(body.maxRedemptions ? { max_redemptions: Number(body.maxRedemptions) } : {}),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      // Tagged so /admin/promos stays honest about where the code came from
      // without needing to know anything about ambassadors.
      metadata: { channel: `Ambassador: ${fullName}`.slice(0, 200) },
    });

    const { error: attachError } = await gate.supabase.rpc("admin_attach_ambassador_code", {
      p_ambassador_id: ambassadorId,
      p_promotion_code_id: promotionCode.id,
      p_code: code,
    });

    if (attachError) {
      // The code exists in Stripe but is not linked here. Say so plainly rather
      // than implying it worked: an unlinked code still discounts, it just
      // credits nobody, and an admin needs to know to deactivate it.
      console.error("[admin/ambassadors] attach failed", attachError);
      return NextResponse.json(
        {
          error:
            `${code} was created in Stripe but could not be linked to ${fullName}. ` +
            "Deactivate it on the promo codes page and try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: ambassadorId, code });
  } catch (err) {
    console.error("[admin/ambassadors] code creation failed", err);
    // Stripe's own message is the useful one ("code already exists", etc.).
    const message = err instanceof Error ? err.message : "Could not create the code.";
    return NextResponse.json(
      { error: `${fullName} was added, but the code failed: ${message}` },
      { status: 400 },
    );
  }
}

/** Move a payout, or pause/resume an ambassador. */
export async function PATCH(req: NextRequest) {
  const gate = await requireAdminRoute("change_plan");
  if (gate.error) return gate.error;

  let body: { referralId?: string; status?: string; note?: string; ambassadorId?: string; ambassadorStatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Payout move. The RPC is the only writer of payout_status and refuses to make
  // a referral payable before money has arrived, so the rule is enforced in the
  // database rather than here.
  if (body.referralId) {
    const { error } = await gate.supabase.rpc("admin_set_referral_payout", {
      p_referral_id: body.referralId,
      p_status: String(body.status ?? ""),
      p_note: body.note ?? null,
    });

    if (error) {
      console.error("[admin/ambassadors] payout update failed", error);
      return NextResponse.json(
        { error: error.message || "Could not update the payout." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Pause or resume. Stops new claims without touching existing referrals; the
  // code itself is deactivated separately in Stripe.
  if (body.ambassadorId) {
    const status = String(body.ambassadorStatus ?? "");
    if (status !== "active" && status !== "paused") {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }

    const { error } = await gate.supabase
      .from("ambassadors")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", body.ambassadorId);

    if (error) {
      console.error("[admin/ambassadors] status update failed", error);
      return NextResponse.json({ error: "Could not update the ambassador." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}
