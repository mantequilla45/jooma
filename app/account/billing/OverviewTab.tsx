import { createClient } from "@/app/lib/auth/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { pendingPlanChange } from "@/app/lib/stripe";
import {
  asPlanId,
  PLANS,
  PLAN_CREDITS,
  SELECTABLE_PLAN_IDS,
} from "@/app/lib/plans";
import ManageButton from "./ManageButton";
import ResumeButton from "./ResumeButton";
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

  // Every plan a teacher can be on, cheapest first — Free included, because
  // moving DOWN to it is a plan change like any other and needs somewhere to be
  // offered. Derived from SELECTABLE_PLAN_IDS so a plan arriving or leaving
  // needs no change here, and so this can never offer School, which is hidden
  // and has no self-serve billing.
  const ladder = SELECTABLE_PLAN_IDS.slice().sort(
    (a, b) => (PLANS[a].priceMonthly ?? 0) - (PLANS[b].priceMonthly ?? 0),
  );

  // A downgrade they have already scheduled, which lives on a Stripe
  // subscription schedule rather than on the profile — nothing has changed yet,
  // and every column here should keep saying so until it does. Null whenever
  // there is no schedule, or if Stripe is unreachable.
  const pending = await pendingPlanChange(profile?.stripe_subscription_id);

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

  // The scheduled change's date, formatted like every other date on this page.
  const pendingAt = pending
    ? new Date(pending.at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    // max-w-3xl, not the max-w-xl this used to be. That 576px was sized for a
    // single summary card stacked over a couple of buttons; the plan ladder
    // below is three cards side by side, which left each one about 170px wide
    // and wrapped every feature line in two. The summary card keeps its own
    // narrower width so it does not stretch to fill this.
    <div className="max-w-3xl">
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
            {/* Changing plan is no longer a button here — the cards below offer
                every move in both directions, with the current one marked. This
                row is left with what it was always for: managing the billing
                itself. */}
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
              {/* Cancelling now lives on the Free card below, as "Switch to
                  Free" — same portal flow, same outcome, but framed as the plan
                  change it actually is and carrying the losses panel. A second
                  red button here would be the same action twice.

                  Renew stays, because it is not a plan change: it undoes one.
                  Only ever shown while ENDING — once fully ended there is
                  nothing to renew, and the "resubscribe" note below covers it. */}
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

      {/* Every plan, for everybody — the current one marked, and each of the
          others carrying the action that gets there: checkout for a teacher
          with no subscription, a swap up or down for one who has. This used to
          render only for non-subscribers, which left a Max subscriber with no
          visible way to move at all. */}
      {ladder.length > 0 && (
        <PlanPicker
          plans={ladder}
          current={plan}
          hasSubscription={hasSubscription}
          pendingPlan={pending?.plan ?? null}
          pendingAt={pendingAt}
          // While a subscription is ending or ended, renewing comes first:
          // swapping a plan that is about to stop would charge for something
          // disappearing. Same gate the buttons above use.
          locked={ending || ended}
        />
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
