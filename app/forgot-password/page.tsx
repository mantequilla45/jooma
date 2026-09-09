"use client";

// Forgot password.
//
// Before this, a teacher who forgot their password had one route back in: ask
// support, and wait for an admin to click reset in the Teachers drawer. This is
// the same reset, triggered by the person who actually needs it.
//
// The work happens in /api/auth/password-link, which is deliberately incapable
// of telling this page whether the address had an account — see the long note
// there. That shapes the copy below: the confirmation says what we did, never
// what we found.

import Link from "next/link";
import { useState } from "react";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { isEmail } from "@/app/lib/enquiry";
import AuthLayout from "@/app/components/v2/AuthLayout";
import auth from "@/app/components/v2/auth.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  // The honeypot. Never filled by a person: it is off-screen and untabbable.
  const [company, setCompany] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = isEmail(email) && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/auth/password-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), company }),
      });
    } catch {
      setError("Could not reach Jooma. Check your connection and try again.");
      setLoading(false);
      return;
    }

    setLoading(false);

    // 429 is the one status this endpoint uses to say something real, and it
    // has to be shown: someone told to wait needs to know that is why no email
    // arrived, or they will keep asking and keep extending the wait.
    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      setError(
        body?.error ??
          "Too many requests. Please wait an hour and try again.",
      );
      return;
    }

    if (!res.ok) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setSent(true);
  };

  // The confirmation replaces the form rather than sitting above it. Leaving a
  // filled form under a success message invites a second submit, which spends
  // one of three hourly attempts on a link already in their inbox.
  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        footer={
          <>
            Remembered it? <Link href="/login">Sign in</Link>
          </>
        }
      >
        <div className={`${auth.banner} ${auth.bannerGood}`} role="status">
          <p className={auth.bannerTitle}>Link sent</p>
          <p className={auth.bannerBody}>
            If there is a Jooma account for {email.trim()}, a link to choose a
            new password is on its way. It expires shortly and can only be used
            once.
          </p>
        </div>

        <p className={auth.hint}>
          Nothing after a few minutes? Check your spam folder, and check the
          address above for a typo. If you signed up with Google there is no
          password to reset, so use Continue with Google on the sign-in page.
        </p>

        <div className={auth.trust}>
          <span className={auth.trustIcon}>
            <LockKey weight="fill" />
          </span>
          <div>
            <p className={auth.trustTitle}>Secure and GDPR compliant</p>
            <p className={auth.trustBody}>
              Your data stays yours, and your pupils&apos; stays theirs.
            </p>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      lede="Enter your email and we'll send you a link to choose a new one."
      footer={
        <>
          Remembered it? <Link href="/login">Sign in</Link>
        </>
      }
    >
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
            autoFocus
            className={auth.input}
          />
        </div>

        {/* Honeypot. Named for something a bot wants to fill and a human never
            sees. Matches the field in app/components/enquiry/fields.tsx:
            off-screen rather than display:none, which some bots skip. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            width: 1,
            height: 1,
            overflow: "hidden",
          }}
        >
          <label htmlFor="forgot-company">Company</label>
          <input
            id="forgot-company"
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        {error && (
          <p className={auth.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={auth.submit}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <div className={auth.trust}>
        <span className={auth.trustIcon}>
          <LockKey weight="fill" />
        </span>
        <div>
          <p className={auth.trustTitle}>Secure and GDPR compliant</p>
          <p className={auth.trustBody}>
            Your data stays yours, and your pupils&apos; stays theirs.
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
