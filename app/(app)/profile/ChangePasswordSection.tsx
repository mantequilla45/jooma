"use client";

// Change password, and add one to a Google account.
//
// Two ways to set a password, both always on screen:
//
//   1. The form. Verifies the current password, then updates.
//   2. "Email me a link", for someone who cannot fill in (1): a Google teacher
//      who never had a password, or anyone who has forgotten theirs.
//
// Both are shown because NOTHING TELLS US WHICH ONE SOMEONE NEEDS. The obvious
// gate, app_metadata.providers containing "email", answers a different question
// and the alternatives are no better; the effect below records what was tried
// and why each fails. An earlier version of this file branched on that check and
// hid the form from every Google account, including the ones that do have a
// password. Offering both costs a divider and serves everyone.
//
// (2) goes through email rather than setting a password from this session
// because a password is a second way into the account, and an unlocked borrowed
// laptop should not be able to create one. See requestLink().
//
// /create-password is the adjacent flow but a different one: it lands from a
// recovery link (an admin reset, /forgot-password, or the button below) and sets
// a password with no current one to check.

import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { createClient } from "@/app/lib/auth/client";
import { checkPassword } from "@/app/lib/password";
import { ChangePasswordSkeleton } from "./Skeletons";

export default function ChangePasswordSection() {
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  // Adds a line of explanation above the form, and nothing else. It never hides
  // or disables either option, because it cannot answer the question that would
  // justify doing so. See the note in the effect below.
  const [signedUpWithGoogle, setSignedUpWithGoogle] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [nextTouched, setNextTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The "add a password" branch, for a Google account. Separate state from the
  // form above because the two are never on screen together, and sharing it
  // would mean one branch's error could render inside the other.
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setEmail(user?.email ?? null);

      // Whether this account SIGNED UP with Google. Deliberately not "whether it
      // has a password", because nothing available to us answers that:
      //
      //   - app_metadata.providers records how the account was created and what
      //     has been linked since. updateUser({ password }) changes neither it
      //     nor the identity list, so it never gains "email".
      //   - auth.users.encrypted_password looked promising and is worse: older
      //     Supabase versions wrote a bcrypt hash for OAuth users and newer ones
      //     leave it NULL, so on staging three real Google accounts carry a hash
      //     and the newest carries NULL. It tracks signup date, not credentials.
      //   - Probing with signInWithPassword returns invalid_credentials either
      //     way, on purpose, so that route is closed too.
      //
      // So this does not gate anything. Both options are offered below and the
      // attempt decides: a wrong current password says so, and a teacher with no
      // password uses the link instead. Guessing wrong in either direction hid a
      // real option from someone who needed it.
      const providers = (user?.app_metadata?.providers ?? []) as string[];
      setSignedUpWithGoogle(providers.includes("google") && !providers.includes("email"));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rules = checkPassword(next);
  const meetsRules = rules.every((r) => r.met);
  const matches = next !== "" && next === confirm;
  const canSubmit =
    current !== "" && meetsRules && matches && !busy && email !== null;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 5000);
    return () => clearTimeout(t);
  }, [done]);

  /**
   * Adds a password to a Google account, by emailing a link rather than taking
   * one from this form.
   *
   * A password is a second way into the account, so setting one from a live
   * session would let a borrowed unlocked laptop create a permanent credential
   * with no second factor. The emailed link proves whoever is asking holds the
   * mailbox. It lands on /create-password, which now returns here afterwards.
   *
   * Posts the signed-in address rather than a typed one: there is no reason to
   * let this form send mail anywhere else.
   */
  const requestLink = async () => {
    if (!email || linkBusy || linkSent) return;
    setLinkBusy(true);
    setLinkError(null);

    let res: Response;
    try {
      res = await fetch("/api/auth/password-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      setLinkError("Could not reach Jooma. Check your connection and try again.");
      setLinkBusy(false);
      return;
    }

    setLinkBusy(false);
    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      setLinkError(body?.error ?? "Too many requests. Please wait an hour and try again.");
      return;
    }
    if (!res.ok) {
      setLinkError("Could not send the link. Please try again.");
      return;
    }
    setLinkSent(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Someone who hits submit without leaving a field has touched nothing, so
    // the reasons it is disabled would stay hidden.
    setNextTouched(true);
    setConfirmTouched(true);
    if (!canSubmit || !email) return;

    setBusy(true);
    setError(null);
    setDone(false);
    const supabase = createClient();

    // Verify the CURRENT password before changing it.
    //
    // Nothing else in the app does this — /create-password calls updateUser on
    // an already-authenticated session with no re-check, which is right for a
    // recovery link but wrong for a form that asks for the current password and
    // would otherwise ignore what was typed. Signing in as the account that is
    // already signed in refreshes the same session rather than opening a second
    // one, so this costs a round trip and nothing else.
    const { error: reauth } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (reauth) {
      setError("That current password isn't right.");
      setBusy(false);
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updateErr) {
      setError("Could not change your password. Please try again.");
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setNextTouched(false);
    setConfirmTouched(false);
    setDone(true);
  };

  if (!loaded) return <ChangePasswordSkeleton />;

  return (
    <div
      className="rounded-3xl p-6 sm:p-8 border"
      style={{ backgroundColor: "var(--j-card)", borderColor: "var(--j-line)" }}
    >
      <h2 className="text-lg font-bold mb-6" style={{ color: "var(--j-ink)" }}>
        Change password
      </h2>

      {/* Shown to a Google signup, where "change password" is the wrong frame:
          they may well not have one. Not a gate, just an explanation, because
          nothing can tell us whether they do. */}
      {signedUpWithGoogle && (
        <p className="text-sm max-w-lg mb-6" style={{ color: "var(--j-faint)" }}>
          You signed up with Google. If you&apos;ve never set a password, use
          Email me a link below to add one. Continue with Google keeps working
          either way.
        </p>
      )}

      <form onSubmit={handleSubmit} className="max-w-lg">
          <PasswordField
            id="current-password"
            label="Current password"
            placeholder="Enter current password"
            value={current}
            onChange={setCurrent}
            visible={showCurrent}
            onToggleVisible={() => setShowCurrent((v) => !v)}
            autoComplete="current-password"
          />

          <div className="mt-4">
            <PasswordField
              id="new-password"
              label="New password"
              placeholder="Enter new password"
              value={next}
              onChange={setNext}
              visible={showNext}
              onToggleVisible={() => setShowNext((v) => !v)}
              onBlur={() => setNextTouched(true)}
              invalid={nextTouched && !meetsRules}
              autoComplete="new-password"
            />
            <ul className="mt-2 space-y-1" aria-live="polite">
              {rules.map((rule) => {
                const failing = nextTouched && !rule.met;
                return (
                  <li
                    key={rule.key}
                    className={`flex items-center gap-1.5 text-xs font-light ${
                      rule.met
                        ? "text-emerald-600"
                        : failing
                        ? "text-red-500"
                        : "text-muted"
                    }`}
                  >
                    {rule.met ? (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    ) : failing ? (
                      <X className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      // Keeps the rows from shifting sideways as icons swap in.
                      <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                        <span className="w-1 h-1 rounded-full bg-current" />
                      </span>
                    )}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-4">
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              visible={showConfirm}
              onToggleVisible={() => setShowConfirm((v) => !v)}
              onBlur={() => setConfirmTouched(true)}
              invalid={confirmTouched && confirm !== "" && !matches}
              autoComplete="new-password"
            />
            {confirmTouched && confirm !== "" && !matches && (
              <p className="mt-2 text-xs text-red-500 font-light">
                Both passwords must match.
              </p>
            )}
          </div>

          {error && <p className="mt-4 text-sm text-red-600 font-light">{error}</p>}

          <div className="mt-7 flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-8 py-3 rounded-xl text-sm font-medium text-white transition-colors disabled:bg-(--j-tint) disabled:text-(--j-faint) disabled:cursor-default bg-(--j-purple) hover:bg-(--j-deep) cursor-pointer"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {done && (
              <span
                className="text-sm font-medium"
                role="status"
                style={{ color: "#1f6b3b" }}
              >
                Password changed
              </span>
            )}
          </div>
        </form>

      {/* The other way to set a password, always available.

          It is not an alternative branch to the form above but a companion to
          it, because we cannot tell who needs which. Someone with no password
          cannot fill in "current password" and would otherwise be stuck at a
          form that refuses them; someone who has simply forgotten theirs is in
          the same position while signed in. Both are served by the same link. */}
      <div
        className="max-w-lg mt-8 pt-6 border-t"
        style={{ borderColor: "var(--j-line)" }}
      >
        <p className="text-sm" style={{ color: "var(--j-ink)" }}>
          Don&apos;t know your current password?
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--j-faint)" }}>
          We&apos;ll email {email ?? "you"} a link to set a new one, without
          needing the old one.
        </p>

        {linkError && (
          <p className="mt-4 text-sm text-red-600 font-light">{linkError}</p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={requestLink}
            disabled={linkBusy || linkSent}
            className="px-6 py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-60 disabled:cursor-default cursor-pointer"
            style={{ borderColor: "var(--j-line)", color: "var(--j-ink)" }}
          >
            {linkBusy ? "Sending…" : linkSent ? "Link sent" : "Email me a link"}
          </button>
          {linkSent && (
            <span
              className="text-sm font-medium"
              role="status"
              style={{ color: "#1f6b3b" }}
            >
              Check your inbox
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A labelled password input with a show/hide toggle. Mirrors the field in
 *  app/create-password/page.tsx — same classes, same eye button — so the two
 *  password forms look like one feature. */
function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  visible,
  onToggleVisible,
  onBlur,
  invalid,
  autoComplete,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  onBlur?: () => void;
  invalid?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm mb-2 leading-tight tracking-tight font-medium"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className={`w-full pl-4 pr-12 py-3 border rounded-xl bg-white text-sm leading-tight tracking-tight font-medium placeholder-(--j-faint) placeholder:font-light focus:outline-none transition-colors ${
            invalid ? "border-red-400 focus:border-red-400" : "border-line focus:border-dark"
          }`}
        />
        <button
          type="button"
          onClick={onToggleVisible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-muted hover:text-dark cursor-pointer"
        >
          {visible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
