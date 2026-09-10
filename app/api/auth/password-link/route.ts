// Emails a password link, for someone who cannot use the admin route.
//
// Two features arrive here, and they are the same request:
//
//   1. /forgot-password — a teacher who cannot sign in.
//   2. /profile?section=password — a Google teacher adding a password so email
//      sign-in works too.
//
// Both mint a Supabase recovery link and mail it through SendGrid, exactly as
// app/api/admin/teachers/reset-password/route.ts does on an admin's behalf. The
// link lands on /create-password carrying a hashed token, which that page
// redeems for a session. See the note above generateLink() for why it cannot be
// Supabase's own action_link.
//
// (2) goes through an emailed link rather than a form on the profile page on
// purpose. A password is a second way into the account; letting a live session
// create one means an unlocked borrowed laptop can add a permanent credential
// with no second factor. The link proves the person holds the mailbox.
//
// This is the second endpoint reachable with no session, so it carries the same
// brakes as the first (see app/api/enquiries/route.ts): a honeypot, an IP
// throttle, and a per-address throttle that survives a change of network.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase-admin";
import { sendTemplate, siteUrl } from "@/app/lib/email";
import { EMAIL_RE } from "@/app/lib/enquiry";

/** Requests per IP per hour. Lower than the enquiry cap: a school office shares
 *  one NAT and may genuinely send several enquiries, but several people
 *  forgetting their password in the same hour from one building is rare. */
const IP_LIMIT = 5;

/** Requests per address per hour. The tighter of the two, and the one that
 *  matters: it survives someone hopping onto mobile data to get a fresh IP. */
const EMAIL_LIMIT = 3;

/**
 * The caller's IP, as far as it can be trusted.
 *
 * Copied deliberately from app/api/enquiries/route.ts rather than shared: the
 * two are the same four lines, and a shared helper would invite a future change
 * for one caller to silently alter the other's throttle.
 *
 * x-forwarded-for is client-supplied and spoofable in general, but on Vercel the
 * platform appends the real peer, so the LAST entry is the one to use rather
 * than the first. A spoofed header therefore widens nothing: an attacker can
 * only ever add hops in front of their own.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * How many requests of this kind in the last hour.
 *
 * Returns 0 when the count cannot be read at all — a missing auth_rate table
 * (the migration has not been pushed yet), a database blip. That direction is
 * chosen, not accidental: failing closed here would lock every teacher out of
 * password recovery because a table was absent, which is a far worse outcome
 * than an unthrottled hour. generation-guard.ts and publicSettings() fail open
 * for the same reason.
 */
async function recentCount(kind: "ip" | "email", identifier: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("auth_rate")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("identifier", identifier)
    .gt("created_at", since);
  if (error) {
    console.error("[password-link] throttle read failed, allowing", { kind }, error);
    return 0;
  }
  return count ?? 0;
}

/** 429, worded so it says nothing about whether the address has an account. */
function throttled() {
  // 429 + Retry-After, matching how generation-guard.ts and /api/enquiries
  // report a rate limit. No x-upgrade-required: there is nothing to upgrade to.
  return NextResponse.json(
    {
      error:
        "Too many requests. Please wait an hour and try again, or contact support if you need help sooner.",
    },
    { status: 429, headers: { "Retry-After": "3600" } },
  );
}

export async function POST(req: Request) {
  let payload: { email?: string; company?: string };
  try {
    payload = (await req.json()) as { email?: string; company?: string };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Honeypot. A 200 that looks like every other 200: a bot that sees a 400
  // learns the field is a trap and comes back without it, and one that sees a
  // success does not come back at all.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const email = (payload.email ?? "").trim().toLowerCase();

  // ── Everything below returns the SAME response ─────────────────────────────
  //
  // Whether the address has an account, whether it is even well formed, whether
  // generateLink worked, whether SendGrid accepted it: all { ok: true }, 200.
  //
  // This endpoint is otherwise a free account-enumeration oracle. Anyone could
  // POST a staff list and read off which teachers have Jooma accounts from the
  // status codes. app/login/page.tsx:84-88 explains why Supabase deliberately
  // returns the same invalid_credentials for a wrong password and a Google-only
  // account; a forgot-password form that says "no account with that email"
  // hands back exactly what that protects. Failures are logged server-side,
  // where the person asking cannot read them.
  //
  // The rate limit above is the one exception, and it has to be: a teacher who
  // is being told to wait needs to know that is why nothing arrived. It reveals
  // only how often THIS caller has asked, which they already know.
  const ok = () => NextResponse.json({ ok: true });

  if (!EMAIL_RE.test(email)) return ok();

  // ── Throttles ──────────────────────────────────────────────────────────────
  // Service role: auth_rate has RLS on and no grants, and this runs for a caller
  // with no session at all.
  const ip = clientIp(req);
  if (ip !== "unknown" && (await recentCount("ip", ip)) >= IP_LIMIT) {
    return throttled();
  }
  if ((await recentCount("email", email)) >= EMAIL_LIMIT) {
    return throttled();
  }

  // Record the attempt BEFORE doing the work, unlike /api/enquiries which
  // records only on success. The difference is what a failure means: a rejected
  // enquiry is a typo the sender should not be charged for, whereas an address
  // with no account is the exact probe the throttle exists to slow down. Count
  // it, or enumeration is free again.
  if (ip !== "unknown") {
    await supabaseAdmin.from("auth_rate").insert({ kind: "ip", identifier: ip });
  }
  await supabaseAdmin.from("auth_rate").insert({ kind: "email", identifier: email });
  // Opportunistic prune, as in /api/enquiries. Cheap, indexed, and keeps a table
  // nobody reads from growing without bound. Failure here is irrelevant.
  await supabaseAdmin
    .from("auth_rate")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // ── Mint and send ──────────────────────────────────────────────────────────
  // generateLink() mints the recovery token without sending anything, so the
  // email goes out through SendGrid with our template rather than Supabase's.
  // It fails for an address with no account, which is the "no such user" branch
  // — and is why nothing below changes the response.
  //
  // We send the hashed token, NOT Supabase's own action_link.
  //
  // Following action_link makes Supabase mint the session itself and hand it
  // back in the URL FRAGMENT (#access_token=...). That cannot work here:
  // @supabase/ssr hardcodes flowType "pkce" (see its createBrowserClient), and
  // a PKCE client only ever looks for a ?code= to exchange. It ignores an
  // implicit-flow fragment entirely, so no session is created, no cookie is
  // written, and /create-password reports "your session expired".
  //
  // generateLink cannot mint a PKCE link either: PKCE needs a verifier created
  // by the browser at request time, and this is a server-side admin call with
  // no browser in sight. So no redirect target fixes this, /auth/callback
  // included.
  //
  // What does work is the hashed token, which generateLink returns alongside
  // the link. Handed to the page as an ordinary query parameter, the browser
  // client redeems it with verifyOtp() and gets a real cookie-backed session.
  // Query string rather than fragment on purpose: a fragment never reaches the
  // server, and this one has to survive the proxy.
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${siteUrl()}/create-password` },
  });

  if (linkError || !link?.properties?.hashed_token) {
    console.warn("[password-link] no link generated", { email, error: linkError?.message });
    return ok();
  }
  const resetUrl =
    `${siteUrl()}/create-password` +
    `?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

  // Greet them by name where we have one. generateLink returns the auth user,
  // so the profile lookup is by id rather than a second lookup by address.
  const userId = link.user?.id;
  const { data: profile } = userId
    ? await supabaseAdmin.from("profiles").select("first_name").eq("id", userId).maybeSingle()
    : { data: null };

  const sent = await sendTemplate("password_reset", email, {
    resetUrl,
    firstName: profile?.first_name ?? "",
  });

  // Unlike the admin route, which reports `sent` so an admin knows whether to
  // tell the teacher to check their inbox, this one swallows it. The caller is
  // the person who typed the address, and "email is not configured" is not
  // something they can act on. It is logged by send() either way.
  if (!sent) {
    console.warn("[password-link] template did not send", { email });
  }

  return ok();
}
