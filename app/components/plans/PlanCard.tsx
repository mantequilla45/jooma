import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./PlanCard.module.css";

/*
 * One plan, as a card. Shared by the landing page, /welcome and the profile's
 * subscription section.
 *
 * PRESENTATIONAL ONLY — it fetches nothing and knows nothing about Stripe. The
 * three callers have genuinely different jobs (checkout, checkout-after-claim,
 * and plan changes on an existing subscription), so each supplies its own
 * handler and its own label. What they share is the look, and that is all this
 * owns.
 *
 * Not a client component: it has no state and no effects. A caller that needs
 * interactivity is already a client component and can render this inside itself.
 */

export type PlanCardAction =
  | { kind: "button"; label: string; onClick: () => void; disabled?: boolean }
  | { kind: "link"; label: string; href: string }
  /** The plan they are on. Rendered as a flat label, not a call to action. */
  | { kind: "current"; label?: string }
  /**
   * Something else entirely, rendered in the action slot.
   *
   * For the plan-change buttons, which carry their own confirmation panel and
   * expand in place where the button was. They have to sit in the slot rather
   * than below the card, or the panel opens under the feature list and the
   * cards stop lining up.
   */
  | { kind: "custom"; node: ReactNode }
  /** No action at all — used for a card that is only there to be looked at. */
  | { kind: "none" };

export interface PlanCardProps {
  name: string;
  /** Already formatted, including the currency. See planCardPrice(). */
  price: string;
  /** The line under the price: "a month", "Forever". */
  per: string;
  features: string[];
  action: PlanCardAction;
  /** The purple, most-prominent card. One per grid. */
  featured?: boolean;
  /** The pill above the name, e.g. "Most popular". */
  badge?: string;
  /** Rings the card to mark it as the plan they are on. Independent of
   *  `featured`: Pro can be both the featured card and their current plan. */
  current?: boolean;
  /** Tighter padding and type, for narrow containers such as /welcome. */
  compact?: boolean;
  /** Anchor id, for the Schools nav link on the landing page. */
  id?: string;
  /** A note under the button: a scheduled change and its undo. */
  footer?: ReactNode;
}

export default function PlanCard({
  name,
  price,
  per,
  features,
  action,
  featured,
  badge,
  current,
  compact,
  id,
  footer,
}: PlanCardProps) {
  const className = [
    styles.card,
    featured ? styles.featured : "",
    current ? styles.current : "",
    compact ? styles.compact : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The featured card is purple, so its button has to be white to be visible.
  // Elsewhere the primary action is purple and a secondary one is outlined.
  const actionClass = [
    styles.action,
    featured ? styles.actionWhite : styles.actionGrey,
  ].join(" ");

  return (
    <div className={className} id={id}>
      {/* Rendered even when empty: the reserved height keeps the plan names
          aligned across a row where only one card carries a badge. */}
      <div className={styles.badgeRow}>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>

      <h3 className={styles.name}>{name}</h3>
      <p className={styles.price}>{price}</p>
      <p className={styles.per}>{per}</p>

      <ul className={styles.features}>
        {features.map((feature) => (
          <li key={feature}>
            <span className={styles.tick} aria-hidden="true">
              &#10003;
            </span>
            {feature}
          </li>
        ))}
      </ul>

      {action.kind === "button" && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={actionClass}
        >
          {action.label}
        </button>
      )}

      {action.kind === "link" && (
        <Link href={action.href} className={actionClass}>
          {action.label}
        </Link>
      )}

      {action.kind === "current" && (
        <button
          type="button"
          disabled
          className={`${styles.action} ${styles.actionCurrent}`}
        >
          {action.label ?? "Your plan"}
        </button>
      )}

      {/* Pinned to the bottom the same way a button would be, so a card with a
          custom action still lines up with its neighbours. */}
      {action.kind === "custom" && <div className={styles.custom}>{action.node}</div>}

      {footer && <div className={styles.foot}>{footer}</div>}
    </div>
  );
}

/** The grid the cards sit in. Columns default to three; the landing page passes
 *  four. Wraps to two and then one on narrow screens regardless. */
export function PlanCardGrid({
  columns = 3,
  className,
  children,
}: {
  columns?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `${styles.grid} ${className}` : styles.grid}
      style={{ "--plan-columns": columns } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
