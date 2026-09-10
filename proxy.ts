import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  isGenerationRequest,
  isCostBearingRequest,
  isAssistantRequest,
  checkAllGates,
  checkAssistantAccess,
  quotaBlockBody,
  quotaBlockHeaders,
  quotaBlockStatus,
  toolSlugFor,
} from "@/app/lib/generation-guard";
import { isToolEnabled } from "@/app/lib/tool-availability";
import { publicSettings } from "@/app/lib/settings";

// Reachable while maintenance mode is on. /maintenance itself, obviously, plus
// the auth routes — an admin has to be able to sign in to turn it back off,
// and they can't do that if the login page is behind the holding page.
const MAINTENANCE_ALLOWED = [
  "/maintenance",
  "/login",
  // An admin who has to sign in to turn maintenance off may also have to reset
  // their password to do it. Locking recovery behind the holding page is the
  // same trap as locking /login behind it.
  "/forgot-password",
  "/api/auth",
  "/auth",
  "/admin",
  "/api/admin",
  "/terms",
  "/privacy",
];

// Routes reachable without a session. Everything else redirects to /login.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  // The maintenance holding page is shown to signed-out visitors too, so it
  // must not bounce to /login — which is itself behind the holding page.
  "/maintenance",
  "/verify",
  "/create-password",
  "/complete-profile",
  // Someone who cannot sign in obviously cannot be asked for a session first.
  // The route behind it carries its own honeypot and two throttles rather than
  // relying on the session it does not have, exactly as /api/enquiries does.
  //
  // Note it is NOT in the signed-in bounce below, unlike /login and /signup: a
  // Google teacher adding a password reaches the same endpoint from /profile
  // while very much signed in.
  "/forgot-password",
  "/api/auth/password-link",
  "/auth",
  "/terms",
  "/privacy",
  "/pricing",
  // A school asking about licences has no account yet, and making them sign up
  // to ask about pricing loses the enquiry. The form posts to /api/enquiries,
  // which must be public for the same reason; it carries its own honeypot and
  // IP throttle rather than relying on the session it does not have.
  "/contact",
  "/api/enquiries",
  // An invited teacher has no account yet, so the invite lookup behind the
  // /signup banner has to work while signed out. It only ever reveals the
  // address a valid token was already emailed to, and grants nothing —
  // /api/invites/accept does the granting, and that one requires a session
  // and checks the address itself.
  "/api/invites/check",
  // Stripe calls this server-to-server with no session; it verifies its own
  // signature, so it must bypass the auth redirect.
  "/api/stripe/webhook",
];

function isPublic(pathname: string) {
  // The marketing landing page at "/" is public (exact match only — we don't
  // want "/" to prefix-match every other route).
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  // Start with a passthrough response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser() — it
  // refreshes the session and rewrites cookies the rest of the app relies on.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated request to a protected route.
  if (!user && !isPublic(pathname)) {
    // API routes must NOT be redirected to the HTML login page — the caller
    // does res.json() and would choke on "<!DOCTYPE html>". Return a clean
    // 401 JSON instead so the error is legible.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Already signed in but sitting on login/signup -> send into the app.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/tools";
    return NextResponse.redirect(url);
  }

  // Maintenance mode. Checked here rather than in a layout because a layout
  // would miss the API routes entirely. Most teacher screens now DO share one
  // layout (app/(app)), but /editor, /admin and every /api route sit outside
  // it, so the proxy remains the only place that covers all of them.
  //
  // Fails OPEN: publicSettings() never throws, and any failure reports
  // maintenance as off. A database blip must not be able to invent an outage.
  if (!MAINTENANCE_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const { maintenanceMode } = await publicSettings(supabase);
    if (maintenanceMode) {
      // Admins work through it — that is the whole point of being able to turn
      // it on. Read directly rather than via is_admin() because this is the one
      // place that runs before any admin gate.
      const { data: profile } = user
        ? await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle()
        : { data: null };

      if (!profile?.is_admin) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Jooma is down for maintenance.", code: "maintenance" },
            { status: 503 },
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = "/maintenance";
        return NextResponse.rewrite(url);
      }
    }
  }

  // Tool availability. An admin turning a tool off in /admin/tools has to
  // actually stop it — before this, tool_settings.enabled was written by the
  // console and read by nothing.
  //
  // Checked here rather than in 35 route handlers so it cannot be forgotten
  // when a tool is added, and so the page path and the API path (the one that
  // spends money) are covered by the same code.
  //
  // Checked BEFORE the plan gates: there is no point spending a gate
  // round-trip on a request that is about to be refused anyway.
  //
  // Fails OPEN, deliberately and for the same reason checkAllGates does — see
  // the note in generation-guard.ts. isToolEnabled never throws; on any error
  // it reports the tool as available.
  //
  // NOTE: 403, and without x-upgrade-required. An unavailable tool is not a
  // quota problem, and UpgradeGate keys off 402 + that header — sending them
  // here would offer an upgrade that fixes nothing.
  if (user) {
    const slug = toolSlugFor(request.method, pathname);
    if (slug && !(await isToolEnabled(supabase, slug))) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "This tool is currently unavailable.", code: "tool_disabled" },
          { status: 403 },
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/tools";
      return NextResponse.redirect(url);
    }
  }

  // The assistant is a paid-plan feature. Checked BEFORE the spend gates below
  // because it is an entitlement, not a quota: a Free user is not near a limit,
  // they simply do not have the feature, and no top-up would change that.
  //
  // This is also the only thing standing between a Free account and unlimited
  // assistant use — a chat turn is not a generation (so the count caps never see
  // it) and Free has no spend ceiling (so the cost gate never fires). See the
  // note on checkAssistantAccess.
  //
  // 402 + x-upgrade-required, so the existing UpgradeGate shows the upsell with
  // no new client code.
  if (user && isAssistantRequest(request.method, pathname)) {
    const gate = await checkAssistantAccess(supabase);
    if (gate) {
      return NextResponse.json(quotaBlockBody(gate), {
        status: quotaBlockStatus(gate),
        headers: quotaBlockHeaders(gate),
      });
    }
  }

  // Enforce the plan gates. Two things are checked here (see
  // generation-guard.ts): the Free daily/monthly generation caps, and the paid
  // plans' monthly AI-spend ceiling. The ceiling applies to sub-asset and
  // refinement routes too, which is why the condition is broader than
  // isGenerationRequest alone — otherwise a Pro user at their limit could keep
  // spending through /api/modify.
  //
  // NOTE: /api/generate-slideshow is excluded from this proxy's matcher (see
  // config below) and self-gates inside its route handler instead.
  if (user && isCostBearingRequest(request.method, pathname)) {
    const quota = await checkAllGates(supabase, {
      countsAsGeneration: isGenerationRequest(request.method, pathname),
    });
    if (quota) {
      // Status and headers depend on WHY: 402 + x-upgrade-required for a quota
      // that money fixes, 429 + Retry-After for a rate limit that time fixes.
      return NextResponse.json(quotaBlockBody(quota), {
        status: quotaBlockStatus(quota),
        headers: quotaBlockHeaders(quota),
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals, static assets, and image files.
    // `api/generate-slideshow` is also excluded: the proxy buffers its SSE
    // stream (slides arrive all at once instead of one-by-one), so it bypasses
    // the proxy and authenticates itself inside the route handler.
    "/((?!api/generate-slideshow|_next/static|_next/image|favicon.ico|svgs|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
