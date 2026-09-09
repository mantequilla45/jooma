"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/app/lib/auth/client";
import DialCodeSelect, {
  DEFAULT_DIAL_CODE as DEFAULT_CODE,
} from "@/app/components/DialCodeSelect";
import { CountrySelect } from "@/app/components/ui/FormFields";
import AuthLayout from "@/app/components/v2/AuthLayout";
import auth from "@/app/components/v2/auth.module.css";
import styles from "./complete-profile.module.css";

/*
 * The last step of signing up.
 *
 * The fields here are written against the V2 auth styles rather than the shared
 * FormFields kit: that kit is still on the cream palette and is shared with
 * /profile, which has not been rebuilt yet. DialCodeSelect and CountrySelect
 * are kept as they are — they are real comboboxes with click-outside and search
 * behaviour, and reimplementing them for a palette change would be a poor
 * trade.
 */

export default function CompleteProfilePage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [dialCountry, setDialCountry] = useState(DEFAULT_CODE);
  const [phone, setPhone] = useState("");
  // Seeded from the dial code so the teacher does not have to pick twice.
  const [country, setCountry] = useState<string | null>(DEFAULT_CODE);

  // Keep country in sync when the dial code changes. Still overridable.
  useEffect(() => {
    setCountry(dialCountry);
  }, [dialCountry]);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    firstName.trim() !== "" &&
    surname.trim() !== "" &&
    phone.trim() !== "" &&
    country !== null &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    let {
      data: { user },
    } = await supabase.auth.getUser();

    // If a cookie race means there is no session yet, try restoring from the
    // token stashed by create-password right after signUp.
    if (!user) {
      const accessToken = sessionStorage.getItem("jooma:auth-token");
      const refreshToken = sessionStorage.getItem("jooma:auth-refresh");
      if (accessToken) {
        const { data: restored } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken ?? "",
        });
        user = restored.user ?? null;
      }
    }

    if (!user) {
      setError("Your session expired. Please sign in again.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      first_name: firstName.trim(),
      surname: surname.trim(),
      dial_code: dialCountry,
      phone: phone.trim(),
      country,
    });
    if (error) {
      setError("Could not save your profile. Please try again.");
      setLoading(false);
      return;
    }

    // An admin-invited teacher had their plan chosen before this row existed.
    // Applying it is the server's job: /api/invites/accept re-verifies the
    // token and checks it was issued to THIS address before touching `plan`,
    // which teachers cannot self-update anyway (see
    // 20260811000400_lock_down_profile_self_update.sql). Sending the plan from
    // here instead would let anyone hand themselves Pro.
    //
    // Runs after the upsert because the invite grants a plan to a profile that
    // has to already exist. A self-signup has no token and skips it.
    const inviteToken = sessionStorage.getItem("jooma:invite-token");
    if (inviteToken) {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });
      if (!res.ok) {
        // The profile is saved either way — this only decides the plan — so
        // report it and let them continue on Free rather than stranding them
        // on a form they cannot get past. The admin can re-invite.
        const json = await res.json().catch(() => ({}));
        setError(
          `${json.error ?? "Your invitation couldn't be applied."} Your account is set up, continuing on the Free plan.`,
        );
        sessionStorage.removeItem("jooma:invite-token");
        setLoading(false);
        return;
      }
      sessionStorage.removeItem("jooma:invite-token");
    }

    sessionStorage.removeItem("jooma:auth-email");
    sessionStorage.removeItem("jooma:auth-token");
    sessionStorage.removeItem("jooma:auth-refresh");

    // An ambassador code stashed back at /signup?code= is forwarded in the URL
    // rather than left for the welcome screen to read out of sessionStorage.
    // That page is server rendered, and a value only the client can see is
    // discarded during hydration, so the code would silently never appear.
    const ambassadorCode = sessionStorage.getItem("jooma:ambassador-code");

    // Both signup paths (email and Google) end here, and signing in does not,
    // so this is the one place a brand new teacher passes through exactly once.
    router.push(
      ambassadorCode
        ? `/welcome?code=${encodeURIComponent(ambassadorCode)}`
        : "/welcome",
    );
    router.refresh();
  };

  return (
    <AuthLayout title="Tell us who you are" lede="Last step, then you are in.">
      <form onSubmit={handleSubmit}>
        <div className={styles.pair}>
          <div className={auth.field}>
            <label htmlFor="firstName" className={auth.label}>
              First name
            </label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              autoComplete="given-name"
              className={auth.input}
            />
          </div>

          <div className={auth.field}>
            <label htmlFor="surname" className={auth.label}>
              Surname
            </label>
            <input
              id="surname"
              type="text"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              placeholder="Surname"
              autoComplete="family-name"
              className={auth.input}
            />
          </div>
        </div>

        <div className={auth.field}>
          <label htmlFor="phone" className={auth.label}>
            Phone number
          </label>
          <div className={styles.phone}>
            <DialCodeSelect value={dialCountry} onChange={setDialCountry} />
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              autoComplete="tel"
              className={auth.input}
            />
          </div>
        </div>

        <div className={auth.field}>
          <label htmlFor="country" className={auth.label}>
            Country
          </label>
          <CountrySelect value={country} onChange={setCountry} />
        </div>

        {error && (
          <p className={auth.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={auth.submit}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
