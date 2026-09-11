// The section list, in a module with NO "use client" so both sides can import it.
//
// Same reason app/account/billing/tabs-shared.ts exists: values exported from a
// client module are not real values to a server component — React hands the
// server a client *reference* stub for each export, so SECTIONS.some(...) would
// throw "SECTIONS.some is not a function". Only the component itself crosses
// that boundary, never its sibling exports.

export const SECTIONS = [
  { id: "personal", label: "Personal info" },
  { id: "subscription", label: "Plan and usage" },
  { id: "badges", label: "Badges" },
  { id: "password", label: "Change password" },
  { id: "ticket", label: "Submit ticket" },
  // Last, and deliberately so: it is the one entry nobody should reach by
  // accident on their way to something else.
  { id: "delete", label: "Delete account" },
] as const;

export type Section = (typeof SECTIONS)[number]["id"];

/**
 * Unknown ?section= values fall back to Personal info rather than 404ing. The
 * section is a view preference, not a resource identity — a stale bookmark or a
 * hand-edited URL should show the page, not an error.
 */
export function asSection(v: string | undefined): Section {
  return SECTIONS.some((s) => s.id === v) ? (v as Section) : "personal";
}
