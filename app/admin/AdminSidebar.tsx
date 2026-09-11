"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  School,
  UserPlus,
  PoundSterling,
  CreditCard,
  Zap,
  Tag,
  Handshake,
  BarChart3,
  Settings2,
  ShieldAlert,
  Inbox,
  PenSquare,
  Mail,
  MailQuestionMark,
  UserMinus,
  Megaphone,
  UsersRound,
  ScrollText,
  FlaskConical,
  Sliders,
  Presentation,
  Activity,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  /** Feature isn't shippable yet — rendered greyed out and unclickable so it
   *  can't be mistaken for part of the working product during a demo. */
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Mirrors the CEO's admin console spec 1:1 for structure. Items that already
// have a real page point at it; everything else is a blank stub route so the
// nav is fully clickable while pages are built out incrementally.
const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "People",
    items: [
      { href: "/admin/users", label: "Teachers", icon: Users },
      // The School plan isn't part of the product yet — there is no pricing for
      // it, no seat model on profiles, and nothing reads plan_config.school at
      // runtime. Disabled rather than hidden so it's visibly planned-but-unbuilt.
      { href: "/admin/schools", label: "Schools", icon: School, disabled: true },
      { href: "/admin/onboard", label: "Onboard a school", icon: UserPlus, disabled: true },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/plans", label: "Plans & pricing", icon: PoundSterling },
      { href: "/admin/revenue", label: "Payments & invoices", icon: CreditCard },
      { href: "/admin/topups", label: "Top-ups", icon: Zap },
      { href: "/admin/promos", label: "Promo codes", icon: Tag },
      // Sits under Promo codes because an ambassador's code IS a promo code —
      // the same Stripe object, with attribution and a payout attached.
      { href: "/admin/ambassadors", label: "Ambassadors", icon: Handshake },
    ],
  },
  {
    label: "Product",
    items: [
      { href: "/admin/usage", label: "Usage & margins", icon: BarChart3 },
      { href: "/admin/tools", label: "Tools", icon: Sliders },
      { href: "/admin/model-lab", label: "Model lab", icon: FlaskConical },
      { href: "/admin/flags", label: "Safeguarding flags", icon: ShieldAlert },
      { href: "/admin/presentations", label: "Presentations", icon: Presentation },
    ],
  },
  {
    label: "Support",
    items: [
      { href: "/admin/inbox", label: "Inbox", icon: Inbox },
      // Contact and school enquiries. Separate from the inbox because a ticket
      // comes from a teacher with an account and an enquiry usually does not.
      { href: "/admin/enquiries", label: "Enquiries", icon: MailQuestionMark },
      // Who is leaving and why. Under Support rather than Teachers because
      // "I asked to delete my account and changed my mind" arrives as a ticket.
      { href: "/admin/deletions", label: "Deletions", icon: UserMinus },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/copy", label: "Website & app copy", icon: PenSquare },
      { href: "/admin/emails", label: "Email templates", icon: Mail },
      { href: "/admin/announce", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/team", label: "Team & roles", icon: UsersRound },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
      { href: "/admin/activity", label: "Activity", icon: Activity },
      { href: "/admin/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

function isActive(pathname: string, href: string) {
  // Exact match for the overview root; prefix match for the rest so a
  // sub-route (e.g. /admin/usage/[slug]) still highlights its parent link.
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export default function AdminSidebar({
  badges,
}: {
  /** Live counts keyed by href, e.g. { "/admin/inbox": 3 }. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="shrink-0 w-72 h-screen sticky top-0 border-r flex flex-col"
      style={{ backgroundColor: "#FFFFFF", borderColor: "#EAE6F5" }}
    >
      <div className="px-5 py-5">
        <p className="text-lg font-bold tracking-tight" style={{ color: "#1D1730" }}>
          Jooma Admin
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
        {NAV.map((group) => (
          <div key={group.label}>
            <p
              className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "#6D6683" }}
            >
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map(({ href, label, icon: Icon, badge: staticBadge, disabled }) => {
                const active = isActive(pathname, href);
                // Live counts win over the static definition, which is only a
                // placeholder for items with no query behind them yet.
                const badge = badges?.[href] ?? staticBadge;

                // Rendered as a plain div, not a Link — nothing to click, and
                // no route to land on by tabbing into it.
                if (disabled) {
                  return (
                    <div
                      key={href}
                      aria-disabled="true"
                      title="Not built yet — the School plan has no pricing set"
                      className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium cursor-not-allowed select-none"
                      style={{ color: "#9A93AD" }}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{label}</span>
                      <span
                        className="ml-auto text-[10px] font-semibold rounded-full px-1.5 py-0.5"
                        style={{ backgroundColor: "#F1ECFC", color: "#6D6683" }}
                      >
                        Soon
                      </span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
                    style={active ? { backgroundColor: "#5B2ED6", color: "#fff" } : { color: "#3C3552" }}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{label}</span>
                    {badge ? (
                      <span
                        className="ml-auto text-[10px] font-bold rounded-full px-1.5 py-0.5"
                        style={
                          active
                            ? { backgroundColor: "#fff", color: "#5B2ED6" }
                            : { backgroundColor: "#B3261E", color: "#fff" }
                        }
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t" style={{ borderColor: "#F1ECFC" }}>
        <Link
          href="/tools"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-black/5"
          style={{ color: "#6D6683" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to app
        </Link>
      </div>
    </aside>
  );
}
