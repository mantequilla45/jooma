import { redirect } from "next/navigation";
import { requireAdmin } from "@/app/lib/auth/admin";
import DeletionsView, { type DeletionRow } from "./DeletionsView";

// Why teachers are leaving, and what is in the queue.
//
// Same shape as every other admin section: a server component does the fetch, a
// client component does the rendering, and the row type is exported from the
// view.
//
// requireAdmin() only checks is_admin, so the granular permission is checked
// here on top of it. Finance deliberately cannot see this: the billing
// consequences are already on the invoice, and the free-text reason is a
// teacher's own words about leaving, which is not finance's to read.
export const dynamic = "force-dynamic";

export default async function AdminDeletionsPage() {
  const { supabase } = await requireAdmin();

  const { data: allowed } = await supabase.rpc("admin_can", {
    p_permission: "see_deletions",
  });
  if (!allowed) redirect("/admin");

  // Read directly rather than through an admin_* RPC: the "admins read deletion
  // requests" policy already scopes this to is_admin(), so a function would add
  // a layer without adding a check. Newest first, which is the order the recent
  // index serves.
  const { data: rows } = await supabase
    .from("account_deletion_requests")
    .select(
      "id, user_id, email, reason_code, reason_text, requested_at, scheduled_for, cancelled_at, completed_at, status, failure_note, subscription_paused",
    )
    .order("requested_at", { ascending: false })
    .limit(200);

  return <DeletionsView rows={(rows ?? []) as DeletionRow[]} />;
}
