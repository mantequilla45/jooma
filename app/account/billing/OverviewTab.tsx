import { createClient } from "@/app/lib/auth/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import {
  asPlanId,
  nextPlanUp,
  PLANS,
  PLAN_CREDITS,
  PRICEABLE_PLAN_IDS,
} from "@/app/lib/plans";
import ManageButton from "./ManageButton";
import ResumeButton from "./ResumeButton";
import UpgradeButton from "./UpgradeButton";
import PlanPicker from "./PlanPicker";
import AllowanceMeter from "./AllowanceMeter";
import AmbassadorCodeField from "./AmbassadorCodeField";

// Overview: current plan, where they stand against this month's allowance, and
// the actions that change either. The proxy guarantees a session by the time
// this renders.
export default async function OverviewTab({
  checkout,
  topup,
}: {
  // Passed down from the page shell, which owns searchParams, rather than read
  // again here — one source, so the banner and the tab strip can't disagree.
  checkout?: string;
  topup?: string;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: usedMonth },
    { data: usedToday },
    { data: spend },
    { data: referral },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "plan, subscription_status, cancel_at_period_end, current_period_end, stripe_customer_id, stripe_subscription_id",
      )
      .eq("id", user?.id ?? "")
      .maybeSingle(),
    supabase.rpc("my_generation_count_this_month"),
    supabase.rpc("my_generation_count_today"),
    supabase.rpc("monthly_ai_spend", { uid: user?.id ?? "" }),
    // The ambassador code they have claimed, if any.
    //
    // SERVICE ROLE, not the caller's client. ambassador_referrals is admin-only
    // with no teacher read policy — deliberately, since a teacher-writable
    // referral would let anyone assign themselves an ambassador — so the user's
    // own client sees nothing here and the field would always offer an input.
    // Scoped by their own id, so it can only ever find their own row.
    supabaseAdmin
      .from("ambassador_referrals")
      .select("first_paid_at, ambassador_codes ( code )")
      .eq("user_id", user?.id ?? "")
      .maybeSingle(),
  ]);

  // monthly_ai_spend returns one row; supabase-js hands back an array.
  const spendRow = (Array.isArray(spend) ? spend[0] : spend) as
    | { spend_pence: number | string; credit_pence: number | string }
    | null
    | undefined;

  const plan = asPlanId(profile?.plan);
  const planName = PLANS[plan].name;

  // The code field has three states, and "spent" is the one worth being explicit
  // about: once first_paid_at is set the one-month discount has been used, so
  // there is nothing to offer and nothing to tell them to do. Showing an input
  // then would invite a second code that attribution would refuse anyway.
  const referralCode =
    (referral?.ambassador_codes as unknown as { code?: string } | null)?.code ?? null;
  const codeSpent = Boolean(referral?.first_paid_at);

  // Two different flags, deliberately not collapsed into one.
  //
  // A Stripe CUSTOMER can exist with no subscription: buying a credit top-up
  // attaches one (see app/api/stripe/topup/route.ts), so a free teacher who has
  // ever topped up has a card on file worth updating — but nothing to cancel.
  // Cancel additionally needs the subscription id because Stripe's
  // subscription_cancel flow takes it as a required parameter.
  const isSubscriber = Boolean(profile?.stripe_customer_id);
  const hasSubscription = Boolean(profile?.stripe_subscription_id);

  // The next plan up, if there is one. Derived from the priced plans in
  // ascending order rather than written as "pro means max", so adding a tier
  // above Max needs no change here.
  //
  // Requires an actual subscription to swap: a free teacher with a Stripe
  // customer (from a top-up) has nothing to upgrade and is sent to /pricing by
  // the branch below instead.
  const upgradeTo = hasSubscription ? nextPlanUp(plan) : null;

  // The plans on sale, cheapest first, for the picker below. Derived from
  // PRICEABLE_PLAN_IDS so a plan going on or off sale needs no change here —
  // and so this can never offer School, which has no self-serve billing.
  const sellablePlans = PRICEABLE_PLAN_IDS.slice().sort(
    (a, b) => (PLANS[a].priceMonthly ?? 0) - (PLANS[b].priceMonthly ?? 0),
  );

  const renews = profile?.current_period_end
    ? new Date(profile.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  // Two distinct states, and the difference is the whole point of this block.
  //
  // ENDING: cancelled through the portal, which schedules rather than cancels —
  // Stripe keeps status = "active" and only sets cancel_at_period_end, so the
  // teacher keeps Pro until the period runs out. Testing the status alone (as
  // this once did) never matched, so the page claimed the plan would "renew"
  // and kept offering a Cancel button Stripe would reject.
  //
  // ENDED: the period elapsed and Stripe closed the subscription for good.
  // Nothing left to renew — resubscribing means a new checkout.
  const ended = profile?.subscription_status === "canceled";
  const ending = Boolean(profile?.cancel_at_period_end) && !ended;

  return (
    <div className="max-w-xl">
      {/* The plan is granted by the Stripe webhook, which lands a moment after
          this redirect — so `plan` here is usually still the OLD one. Naming
          it would congratulate the user on the plan they just paid to leave.
          Report only what we know: the payment went through. */}
      {checkout === "success" && plan === "free" && (
        <div
          className="rounded-xl px-4 py-3 mb-5 text-sm font-medium"
          style={{ backgroundColor: "#FDF0D5", color: "#8a6d1f" }}
        >
          Payment received — activating your plan. This usually takes a few
          seconds; refresh the page to check.
        </div>
      )}

      {checkout === "success" && plan !== "free" && (
        <div
          className="rounded-xl px-4 py-3 mb-5 text-sm font-medium"
          style={{ backgroundColor: "#DDF0E2", color: "#1f6b3b" }}
        >
          Payment received — welcome to {planName}!
        </div>
      )}

      {topup === "success" && (
        <div
          className="rounded-xl px-4 py-3 mb-5 text-sm font-medium"
          style={{ backgroundColor: "#DDF0E2", color: "#1f6b3b" }}
        >
          Payment received — {PLAN_CREDITS.toLocaleString("en-GB")} credits have been added
          to this month.
        </div>
      )}

      <div
        className="rounded-2xl p-6 border"
        style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--j-faint)" }}>
              Current plan
            </p>
            <p className="text-xl font-bold" style={{ color: "var(--j-ink)" }}>
              {planName}
            </p>
          </div>
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{ backgroundColor: "var(--j-tint)", color: "var(--j-faint)" }}
          >
            {profile?.subscription_status ?? (plan === "free" ? "free" : "—")}
          </span>
        </div>

        {renews && (
          <p className="text-sm mb-5" style={{ color: "var(--j-body)" }}>
            {ending || ended
              ? `Access ends on ${renews}.`
              : `Renews on ${renews}.`}
          </p>
        )}

        {isSubscriber ? (
          <div className="flex flex-col gap-3">
            {/* Upgrade sits ABOVE the management row and on its own line: it is
                the only action here that charges a card, and its confirmation
                panel expands to full width in place. Shown only while there is
                somewhere to go and the subscription is not on its way out —
                upgrading a plan that is scheduled to end would charge more for
                something about to stop, so Renew comes first. */}
            {upgradeTo && !ending && !ended && <UpgradeButton to={upgradeTo} />}

            <div className="flex flex-wrap items-start gap-2">
              {/* No flow — lands on the portal homepage, which is also where
                  Stripe keeps the downloadable invoice history. The History tab
                  links here for exactly that reason. */}
              <ManageButton label="Manage billing" />
              <ManageButton
                flow="payment_method_update"
                label="Update card"
                variant="outline"
              />
              {/* Cancel and Renew are the same slot in two states, never both:
                  offering Cancel on an already-cancelling subscription invites a
                  second attempt that Stripe rejects, which is what this used to
                  do. Once it has fully ended there is nothing to renew either —
                  the "resubscribe" note below covers that case. */}
              {hasSubscription && !ending && !ended && (
                <ManageButton
                  flow="subscription_cancel"
                  label="Cancel subscription"
                  variant="danger"
                />
              )}
              {hasSubscription && ending && <ResumeButton />}
            </div>
          </div>
        ) : (
          /* No CTA here for a teacher with nothing to manage — the plan cards
             below the card do that job, showing every plan with its real price
             and allowance rather than sending them off to /pricing and back. */
          null
        )}

        {/* Two different messages, because the two states have different exits.
            While ENDING the subscription is still live and the Renew button
            above undoes it in place — telling them to visit /pricing would send
            them to buy a second subscription they don't need. Once ENDED, that
            really is the only route back. */}
        {ending && (
          <p className="text-sm mt-4" style={{ color: "var(--j-faint)" }}>
            Your plan is set to end. Renew to keep it — you won&apos;t be charged
            until {renews ?? "the next billing date"}.
          </p>
        )}

        {ended && (
          <p className="text-sm mt-4" style={{ color: "var(--j-faint)" }}>
            You can resubscribe any time from the pricing page.
          </p>
        )}
      </div>

      {/* Every plan they could move to, for anyone not currently subscribed —
          including a free teacher who has bought a top-up (they have a Stripe
          customer, so the card above shows billing actions, but they still have
          no plan). A subscriber gets UpgradeButton on the card instead, which
          swaps their existing subscription rather than starting a second one. */}
      {!hasSubscription && sellablePlans.length > 0 && (
        <PlanPicker plans={sellablePlans} current={plan} />
      )}

      {/* An ambassador code, beside the plans it discounts. Hidden once the
          discount has actually been used — see codeSpent above. */}
      {!codeSpent && <AmbassadorCodeField claimedCode={referralCode} />}

      {/* The top-up button lives inside the meter, shown only above 80% used —
          see the reasoning there and the `hide_counter` pricing rule. */}
      <AllowanceMeter
        plan={plan}
        usedToday={typeof usedToday === "number" ? usedToday : 0}
        usedMonth={typeof usedMonth === "number" ? usedMonth : 0}
        spendPence={Number(spendRow?.spend_pence ?? 0)}
        creditPence={Number(spendRow?.credit_pence ?? 0)}
        justToppedUp={topup === "success"}
      />
    </div>
  );
}
