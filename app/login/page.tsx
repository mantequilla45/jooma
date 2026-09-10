"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { Eye, EyeSlash, LockKey } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/app/lib/auth/client";
import { usePublicSettings } from "@/app/lib/usePublicSettings";
import AuthLayout from "@/app/components/v2/AuthLayout";
import auth from "@/app/components/v2/auth.module.css";

const SUSPENDED_MESSAGE =
  "This account has been suspended. If you think that's a mistake, contact support and we'll take another look.";

export default function LoginPage() {
  const router = useRouter();
  const settings = usePublicSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  // Google sign-in leaves the page entirely, so a suspended account can only be
  // reported by whatever lands back here.
  //
  // Supabase rejects a banned user in the URL FRAGMENT, not the query string:
  //
  //   /login?error=auth#error=access_denied&error_code=user_banned&...
  //
  // A fragment is never sent to the server, so /auth/callback cannot see it and
  // falls through to its generic ?error=auth — which is why a banned Google user
  // used to get "Could not sign you in" with no explanation. The fragment is
  // readable only here, on the client, so this is the only place the real reason
  // can be recovered. Check it FIRST and let it win over the query string.
  //
  // Read from window rather than useSearchParams(): that hook sees only the
  // query string anyway, and forces a client-side bailout needing a Suspense
  // boundary around the whole form.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    // Four shapes reach this page, depending on whether Supabase redirected to
    // /auth/callback or fell back to the Site URL, and whether the reason
    // survived in the query string or only in the fragment:
    //   #error_code=user_banned      (fragment, the server never sees it)
    //   ?error_code=user_banned      (Site-URL fallback, forwarded by app/page.tsx)
    //   ?error=user_banned           (as above, normalised)
    //   ?error=suspended             (our own /auth/callback redirect)
    const reason =
      hash.get("error_code") ?? query.get("error_code") ?? query.get("error");

    if (reason === "user_banned" || reason === "suspended") {
      setError(SUSPENDED_MESSAGE);
    } else if (reason) {
      setError("Could not sign you in. Please try again.");
    }

    // Strip the error off the URL once it has been shown. Otherwise a refresh,
    // or a successful sign-in that re-renders this page, keeps re-displaying a
    // stale failure, and the fragment lingers in the address bar.
    if (hash.has("error_code") || query.has("error") || query.has("error_code")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      // A suspended account has to say so. Reporting "incorrect email or
      // password" — which is what every failure used to say — sends someone
      // whose credentials are perfectly correct into retrying them forever,
      // and then to support to ask why their password stopped working.
      // Google accounts have no password at all, and Supabase deliberately
      // returns the same generic invalid_credentials either way (telling them
      // apart would leak which addresses have accounts). So the hint is in the
      // copy: it is shown for every failure, reveals nothing, and is the only
      // thing that rescues a Google user poking at the password field.
      setError(
        error.code === "user_banned"
          ? SUSPENDED_MESSAGE
          : "Incorrect email or password. If you signed up with Google, use “Continue with Google” above.",
      );
      setLoading(false);
      return;
    }
    router.push("/tools");
    router.refresh();
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
      title="Welcome back"
      lede="Sign in to pick up where you left off."
      footer={
        <>
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </>
      }
    >
      {error === SUSPENDED_MESSAGE && (
        // A suspension is not a typo. It is an account state the teacher can do
        // nothing about by retrying, so it gets a banner rather than the same
        // one-line hint as a wrong password.
        <div className={`${auth.banner} ${auth.bannerBad}`} role="alert">
          <p className={auth.bannerTitle}>Account suspended</p>
          <p className={auth.bannerBody}>{error}</p>
        </div>
      )}

      {/* Only the Google button is gated here. Signing IN is never blocked by
          signups_open: closing signups stops new accounts, it does not lock out
          the teachers who already have one. */}
      {settings.googleSignin && (
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
            className={auth.input}
          />
        </div>

        <div className={auth.field}>
          <label htmlFor="password" className={auth.label}>
            Password
          </label>
          <div className={auth.inputWrap}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              className={auth.input}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className={auth.reveal}
            >
              {showPassword ? (
                <EyeSlash className={auth.revealIcon} />
              ) : (
                <Eye className={auth.revealIcon} />
              )}
            </button>
          </div>
        </div>

        {/* Under the password field, not beside the label: someone reaches for
            this after the password has failed them, and that is where they are
            already looking. */}
        <div className={auth.forgotRow}>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>

        {error && error !== SUSPENDED_MESSAGE && (
          <p className={auth.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={auth.submit}>
          {loading ? "Signing in…" : "Sign in"}
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
