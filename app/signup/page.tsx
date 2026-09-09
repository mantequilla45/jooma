"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/app/lib/auth/client";
import { usePublicSettings } from "@/app/lib/usePublicSettings";
import AuthLayout from "@/app/components/v2/AuthLayout";
import auth from "@/app/components/v2/auth.module.css";

export default function SignupPage() {
  const router = useRouter();
  const settings = usePublicSettings();
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<
    | { state: "none" }
    | { state: "loading" }
    | { state: "valid"; email: string }
    | { state: "invalid"; message: string }
  >({ state: "none" });

  // An admin-sent invite arrives as /signup?invite=<token>. It is stashed in
  // sessionStorage rather than held in state because the page that needs it is
  // /complete-profile, two navigations later — it hands the token to
  // /api/invites/accept, which is the only place it is actually verified.
  // Nothing here grants anything.
  //
  // Read from window rather than useSearchParams(): that hook forces a
  // client-side bailout needing a Suspense boundary around the whole form, for
  // a value this page only needs after mount. Same reasoning as the fragment
  // read in app/login/page.tsx.
  //
  // An invited teacher must end up on the invited address — that is what
  // /api/invites/accept matches on — so the field is prefilled and locked
  // rather than left open for them to mistype a different one.
  // An ambassador code arrives as /signup?code=JAMIE20. Stashed the same way as
  // the invite token, and for the same reason: the screen that offers it is
  // /welcome, three navigations later. Nothing is verified or granted here —
  // /api/ambassadors/claim does that once there is an account to attach it to.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) sessionStorage.setItem("jooma:ambassador-code", code.trim().toUpperCase());
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;

    let cancelled = false;

    (async () => {
      sessionStorage.setItem("jooma:invite-token", token);
      setInvite({ state: "loading" });
      const res = await fetch(`/api/invites/check?token=${encodeURIComponent(token)}`);
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;

      if (json?.valid) {
        setInvite({ state: "valid", email: json.email });
        setEmail(json.email);
        return;
      }
      sessionStorage.removeItem("jooma:invite-token");
      setInvite({
        state: "invalid",
        message:
          json?.reason === "expired"
            ? "That invitation has expired. Ask your administrator to send a new one."
            : json?.reason === "accepted"
              ? "That invitation has already been used. Try signing in instead."
              : "That invitation link isn't valid. You can still sign up below.",
      });
    })();

    return () => {
      cancelled = true;
    };
    // Mount only: the invite token comes from the URL, which cannot change
    // under this page.
  }, []);

  const emailLocked = invite.state === "valid";

  // Closed signups do not apply to someone holding a valid invite. The profiles
  // INSERT policy makes the same exception, so blocking them here would refuse
  // a signup the database would have allowed.
  const signupsClosed =
    settings.loaded && !settings.signupsOpen && invite.state !== "valid";

  const canSubmit =
    email.trim().length > 0 && agreed && invite.state !== "loading" && !signupsClosed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    sessionStorage.setItem("jooma:auth-email", email.trim());
    router.push("/create-password");
  };

  const handleGoogle = async () => {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError("Could not start Google sign-in.");
  };

  return (
    <AuthLayout
      title={invite.state === "valid" ? "You have been invited" : "Create your account"}
      lede={
        invite.state === "valid"
          ? undefined
          : "Free to start. No card needed."
      }
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      {invite.state === "valid" && (
        <div className={`${auth.banner} ${auth.bannerGood}`}>
          <p className={auth.bannerTitle}>Invitation for {invite.email}</p>
          <p className={auth.bannerBody}>
            Continue with Google, or set a password below. Either way, use this
            address so we can match your invitation.
          </p>
        </div>
      )}

      {invite.state === "invalid" && (
        <div className={`${auth.banner} ${auth.bannerBad}`} role="alert">
          <p className={auth.bannerTitle}>Invitation problem</p>
          <p className={auth.bannerBody}>{invite.message}</p>
        </div>
      )}

      {signupsClosed && (
        <div className={`${auth.banner} ${auth.bannerWarn}`} role="alert">
          <p className={auth.bannerTitle}>Signups are closed right now</p>
          <p className={auth.bannerBody}>
            Jooma is not open to new accounts at the moment. If you were sent an
            invitation, open the link in that email instead. It will still work.
          </p>
        </div>
      )}

      {settings.googleSignin && !signupsClosed && (
        <>
          <button type="button" onClick={handleGoogle} className={auth.google}>
            <FcGoogle className={auth.googleIcon} />
            Continue with Google
          </button>

          <div className={auth.or}>
            <span className={auth.orLine} />
            <span className={auth.orText}>or</span>
            <span className={auth.orLine} />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <div className={auth.field}>
          <label htmlFor="email" className={auth.label}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.sch.uk"
            autoComplete="email"
            // An invite is matched on the address it was sent to, so a teacher
            // who edits this here would only fail later, at acceptance, with
            // nothing to show for it.
            readOnly={emailLocked}
            aria-readonly={emailLocked}
            className={`${auth.input} ${emailLocked ? auth.inputLocked : ""}`}
          />
        </div>

        <label className={auth.check}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className={auth.checkBox}
          />
          <span>
            By signing up, you agree to our <Link href="/terms">Terms of Service</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </span>
        </label>

        {error && (
          <p className={auth.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={auth.submit}>
          Continue
        </button>
      </form>

      <div className={auth.trust}>
        <span className={auth.trustIcon}>
          <LockKey weight="fill" />
        </span>
        <div>
          <p className={auth.trustTitle}>Secure and GDPR compliant</p>
          <p className={auth.trustBody}>Your data stays yours, and your pupils&apos; stays theirs.</p>
        </div>
      </div>
    </AuthLayout>
  );
}
