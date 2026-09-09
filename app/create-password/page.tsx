"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Eye, EyeSlash, X } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/app/lib/auth/client";
import { checkPassword } from "@/app/lib/password";
import AuthLayout from "@/app/components/v2/AuthLayout";
import auth from "@/app/components/v2/auth.module.css";
import styles from "./create-password.module.css";

export default function CreatePasswordPage() {
  const router = useRouter();
  // Whether this is someone finishing a sign-up or an existing teacher setting
  // a new password. Only affects the wording: "one more step and your account
  // is ready" reads oddly to someone who has been teaching with Jooma for a
  // year. Starts null so nothing flickers before we know.
  const [returning, setReturning] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Rules only turn red once the field has been left (or submit attempted).
  // Without this the form greets you with four red crosses before you have
  // typed a character, which reads as failure rather than guidance.
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A live session plus a profile row means an existing teacher arrived through
  // a recovery link. Read once on mount purely for the copy; handleSubmit does
  // its own lookup rather than trusting this, because where it sends them
  // afterwards matters more than a heading does.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setReturning(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setReturning(Boolean(profile));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rules = checkPassword(password);
  const meetsRules = rules.every((r) => r.met);
  const matches = password.length > 0 && password === confirm;
  const showMismatch = confirmTouched && confirm.length > 0 && password !== confirm;
  const canSubmit = meetsRules && matches && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Someone who hits submit without ever leaving a field has touched nothing,
    // so the reasons it is disabled would stay hidden.
    setPasswordTouched(true);
    setConfirmTouched(true);
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Already signed in: a recovery link landed here through
      // /auth/callback?next=/create-password with a live session. Three things
      // send someone down this branch — an admin reset from the Teachers
      // drawer, a teacher who used /forgot-password, and a Google teacher
      // adding a password from /profile.
      //
      // (Google SIGN-UPS still never reach this page; the callback sends those
      // straight to /complete-profile. A Google teacher adding a password later
      // is a different person at a different point in their life.)
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError("Could not set your password. Please try again.");
        setLoading(false);
        return;
      }

      // Where they go next depends on whether they have a profile.
      //
      // This used to fall through to the unconditional push to
      // /complete-profile below, which was right when a fresh sign-up was the
      // only way to arrive with a session. It is wrong for everyone else: a
      // teacher of two years who just reset their password would be dropped
      // back into onboarding and asked for their name and school again.
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        // Back where they started, which for the Google case is the section
        // that sent them. It now shows the ordinary change-password form,
        // because the account has an email identity from this point on.
        router.push("/profile?section=password");
        return;
      }
    } else {
      // Email sign-up: create the account now. Requires "Confirm email" to be
      // OFF in Supabase so the session is active immediately (no email yet).
      const email = sessionStorage.getItem("jooma:auth-email");
      if (!email) {
        setError("Your session expired. Please sign up again.");
        setLoading(false);
        return;
      }
      const { data: signUpData, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.error("signUp error:", error.message, error.status);
        const msg = error.message.toLowerCase();
        setError(
          msg.includes("already") || msg.includes("registered")
            ? "An account with this email already exists. Try signing in."
            : msg.includes("rate") || msg.includes("limit")
              ? "Too many attempts. Please wait a moment and try again."
              : msg.includes("email") && msg.includes("confirm")
                ? "Email confirmation is required. Please disable it in your Supabase Auth settings."
                : error.message,
        );
        setLoading(false);
        return;
      }
      // Stash the session tokens so complete-profile can recover them if the
      // cookie has not propagated by the time the page mounts.
      if (signUpData.session) {
        sessionStorage.setItem("jooma:auth-token", signUpData.session.access_token);
        sessionStorage.setItem("jooma:auth-refresh", signUpData.session.refresh_token ?? "");
      }
    }
    router.push("/complete-profile");
  };

  return (
    <AuthLayout
      title={returning ? "Choose a new password" : "Create your password"}
      lede={
        returning
          ? "Pick something you'll remember. You can sign in with it straight away."
          : "One more step and your account is ready."
      }
    >
      <form onSubmit={handleSubmit}>
        <div className={auth.field}>
          <label htmlFor="password" className={auth.label}>
            Password
          </label>
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
            onBlur={() => setPasswordTouched(true)}
            invalid={passwordTouched && !meetsRules}
          />
          <ul className={styles.rules} aria-live="polite">
            {rules.map((rule) => {
              const failing = passwordTouched && !rule.met;
              return (
                <li
                  key={rule.key}
                  className={`${styles.rule} ${
                    rule.met ? styles.ruleMet : failing ? styles.ruleFailing : ""
                  }`}
                >
                  {rule.met ? (
                    <Check weight="bold" className={styles.ruleIcon} />
                  ) : failing ? (
                    <X weight="bold" className={styles.ruleIcon} />
                  ) : (
                    // A dot of the same footprint, so the rows do not shift
                    // sideways as icons swap in.
                    <span className={styles.ruleIcon}>
                      <span className={styles.ruleDot} />
                    </span>
                  )}
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div className={auth.field}>
          <label htmlFor="confirm" className={auth.label}>
            Confirm password
          </label>
          <PasswordField
            id="confirm"
            value={confirm}
            onChange={setConfirm}
            visible={showConfirm}
            onToggleVisible={() => setShowConfirm((v) => !v)}
            onBlur={() => setConfirmTouched(true)}
            invalid={showMismatch}
          />
          {showMismatch && (
            <p className={`${styles.rule} ${styles.ruleFailing} ${styles.mismatch}`} role="alert">
              <X weight="bold" className={styles.ruleIcon} />
              Passwords do not match
            </p>
          )}
        </div>

        {error && (
          <p className={auth.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={auth.submit}>
          {loading ? "Saving…" : "Continue"}
        </button>
      </form>
    </AuthLayout>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  visible,
  onToggleVisible,
  onBlur,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  // When hidden, render `*` × length as a text field and diff changes back into
  // the real value. A default type="password" masks with the browser's bullet
  // glyph, which renders small at this size; explicit asterisks are legible.
  const displayValue = visible ? value : "*".repeat(value.length);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (visible) {
      onChange(next);
      return;
    }
    if (next.length > value.length) {
      onChange(value + next.slice(value.length));
    } else if (next.length < value.length) {
      onChange(value.slice(0, next.length));
    }
  };

  return (
    <div className={auth.inputWrap}>
      <input
        id={id}
        type="text"
        value={displayValue}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder="Enter your password"
        autoComplete="new-password"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        className={`${auth.input} ${invalid ? styles.inputInvalid : ""}`}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        aria-label={visible ? "Hide password" : "Show password"}
        className={auth.reveal}
      >
        {visible ? (
          <EyeSlash className={auth.revealIcon} />
        ) : (
          <Eye className={auth.revealIcon} />
        )}
      </button>
    </div>
  );
}
