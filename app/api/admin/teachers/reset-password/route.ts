import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/app/lib/auth/admin-route";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { sendTemplate, siteUrl } from "@/app/lib/email";

// Sends a teacher a password reset link on an admin's behalf.
//
// generateLink() mints the recovery token without sending anything — Supabase's
// own mailer is bypassed so the email goes out through SendGrid with our
// template. The emailed URL points at /create-password carrying the hashed
// token, which that page redeems with verifyOtp() to open a session. It then
// sends the teacher back to /profile, because they already have a profile row.
export async function POST(req: NextRequest) {
  const gate = await requireAdminRoute("reset_passwords");
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const { data: target, error: lookupError } =
    await supabaseAdmin.auth.admin.getUserById(userId);
  if (lookupError || !target.user?.email) {
    return NextResponse.json({ error: "Could not find that teacher." }, { status: 404 });
  }
  const email = target.user.email;

  // The emailed URL carries the hashed token as a query parameter rather than
  // being Supabase's own action_link. See the long note at the matching call in
  // app/api/auth/password-link/route.ts: a PKCE browser client cannot consume
  // the implicit-flow fragment that action_link produces.
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${siteUrl()}/create-password` },
  });
  if (linkError || !link.properties?.hashed_token) {
    return NextResponse.json(
      { error: "Could not generate a reset link. Please try again." },
      { status: 500 },
    );
  }
  const resetUrl =
    `${siteUrl()}/create-password` +
    `?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("first_name")
    .eq("id", userId)
    .maybeSingle();

  const sent = await sendTemplate("password_reset", email, {
    resetUrl,
    firstName: profile?.first_name ?? "",
  });

  await gate.supabase.rpc("admin_log_password_reset", { uid: userId, p_sent: sent });

  // Report what actually happened. The old stub claimed an email "would be
  // sent"; saying it was sent when SendGrid isn't configured would be the same
  // lie with extra steps.
  return NextResponse.json({
    sent,
    email,
    error: sent ? undefined : "Email isn't configured, so nothing was sent.",
  });
}
