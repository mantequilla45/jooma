import { planLosses } from "@/app/lib/plan-copy";
import { PLANS, type PlanId } from "@/app/lib/plans";

/*
 * "What you'd miss out on" — the honest half of a downgrade confirmation.
 *
 * Shown before any plan move DOWN, whether that is Max to Pro or a paid plan to
 * Free. One component for both, so there is a single retention surface rather
 * than two that drift.
 *
 * The lines are DERIVED from PLANS[].limits by planLosses(), never written out
 * here. That matters more than usual at this particular moment: this text is
 * read by someone deciding whether to leave, so a stale hand-kept list would
 * either undersell the loss (costing a save we could have made) or oversell it
 * (claiming they lose something they keep — which they will notice, and which
 * is the kind of thing that turns a downgrade into a cancellation).
 *
 * Visually the inverse of the plan card's tick list: same rows, muted crosses
 * instead of purple ticks.
 */

export default function PlanLosses({
  from,
  to,
}: {
  from: PlanId;
  to: PlanId;
}) {
  const losses = planLosses(from, to);

  // Nothing actually gets worse. Rendering an empty warning box would be odd,
  // and would undermine the ones that do have something in them.
  if (losses.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4 mb-4 border"
      style={{
        backgroundColor: "#FDF6EC",
        borderColor: "#F0DFC5",
      }}
    >
      <p className="text-sm font-semibold mb-2" style={{ color: "#8a6d1f" }}>
        What you&apos;d miss out on
      </p>
      <ul className="text-sm space-y-1.5" style={{ color: "#7a6234" }}>
        {losses.map((loss) => (
          <li key={loss} className="flex gap-2.5">
            <span aria-hidden="true" className="font-bold flex-none" style={{ color: "#b08b3f" }}>
              &times;
            </span>
            {loss}
          </li>
        ))}
      </ul>
      <p className="text-xs mt-3" style={{ color: "#9a7f4a" }}>
        You are on {PLANS[from].name} today.
      </p>
    </div>
  );
}
