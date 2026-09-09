import { requireAdmin } from "@/app/lib/auth/admin";
import { stripe } from "@/app/lib/stripe";
import AmbassadorsView, { type AmbassadorRow, type CodeLive } from "./AmbassadorsView";

export const dynamic = "force-dynamic";

/*
 * Who brought each teacher in, and who is owed for it.
 *
 * Two sources, deliberately. The ATTRIBUTION is ours: which teacher redeemed
 * whose code, when they first paid, and whether that payout has been settled.
 * The OFFER is Stripe's, read live for the same reason /admin/promos does it —
 * Stripe validates the code at checkout, so a local copy of the discount would
 * be a second truth that can disagree with the one the customer meets.
 *
 * A Stripe outage costs the offer text and nothing else. The payout table, which
 * is the part with money attached, is answered entirely from our own database.
 */

export default async function AdminAmbassadorsPage() {
  const { supabase } = await requireAdmin();

  const { data: rows, error } = await supabase.rpc("admin_ambassadors");

  if (error) {
    console.error("[admin/ambassadors] could not load ambassadors", error);
  }

  const ambassadors = (rows ?? []) as AmbassadorRow[];

  // Live offer and redemption count per code, keyed by the code string. Only
  // fetched when there is something to look up.
  const live: Record<string, CodeLive> = {};
  let stripeError: string | null = null;

  const anyCodes = ambassadors.some((a) => (a.codes?.length ?? 0) > 0);

  if (anyCodes) {
    try {
      const codes = await stripe.promotionCodes.list({
        limit: 100,
        expand: ["data.promotion.coupon"],
      });

      for (const pc of codes.data) {
        // The coupon hangs off `promotion` on this API version, not off the
        // promotion code itself, and an unexpanded response leaves it as a bare
        // id string. Narrowed by hand, as app/admin/promos/page.tsx has to.
        const promotion = (pc as unknown as { promotion?: { coupon?: unknown } }).promotion;
        const coupon =
          promotion && typeof promotion.coupon === "object" && promotion.coupon !== null
            ? (promotion.coupon as {
                percent_off?: number | null;
                amount_off?: number | null;
                currency?: string | null;
              })
            : null;

        const offer =
          coupon?.percent_off != null
            ? `${coupon.percent_off}% off`
            : coupon?.amount_off != null
              ? `${(coupon.amount_off / 100).toLocaleString("en-GB", {
                  style: "currency",
                  currency: (coupon.currency ?? "gbp").toUpperCase(),
                })} off`
              : "Discount";

        const expired = pc.expires_at ? pc.expires_at * 1000 < Date.now() : false;
        const capped =
          pc.max_redemptions != null && (pc.times_redeemed ?? 0) >= pc.max_redemptions;

        live[pc.code.toUpperCase()] = {
          offer,
          redeemed: pc.times_redeemed ?? 0,
          // What checkout will actually do with it today, which is the only
          // thing that matters to someone about to hand the code out.
          usable: pc.active && !expired && !capped,
        };
      }
    } catch (err) {
      console.error("[admin/ambassadors] could not list Stripe promotion codes", err);
      stripeError = err instanceof Error ? err.message : "Could not reach Stripe.";
    }
  }

  return <AmbassadorsView rows={ambassadors} live={live} stripeError={stripeError} />;
}
