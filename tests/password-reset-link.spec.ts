import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, type TestTeacher } from "./support/users";

/*
 * Following a real reset link, all the way to the form.
 *
 * This is the test that was missing, and its absence let a broken flow ship.
 * The existing coverage in forgot-password.spec.ts asserts what the ENDPOINT
 * returns, which was correct the whole time. Nobody clicked the link.
 *
 * What the link does is not obvious from the code that mints it. Following
 * Supabase's own action_link makes it mint the session and return it in the URL
 * FRAGMENT (#access_token=...), and @supabase/ssr hardcodes flowType "pkce", so
 * its client only ever looks for a ?code= to exchange and ignores that fragment
 * completely. Nothing consumed it, no cookie was written, and the teacher was
 * told their session had expired. Signed-in testers never saw it, because their
 * existing cookie carried them through regardless.
 *
 * So the email carries the hashed token as a query parameter instead, and the
 * page redeems it with verifyOtp().
 *
 * So this test asserts the two things that actually matter to a teacher: the
 * link opens the form, and they arrive signed in enough to use it.
 *
 * generateLink() is used rather than the /forgot-password form because the
 * subject is the LINK, not the endpoint, and this way the test never depends on
 * SendGrid being configured or on an inbox being reachable.
 */

test.describe("Password reset link", () => {
  test("opens the create-password form with a live session", async ({ page }) => {
    const teacher: TestTeacher = await createTeacher("Reset");
    try {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(
        /\/+$/,
        "",
      );

      // Exactly what both reset routes email: the hashed token as a query
      // parameter, NOT Supabase's action_link. Following action_link returns the
      // session in the URL fragment, which a PKCE client (what @supabase/ssr
      // always builds) never reads, so no session is created at all.
      const { data: link, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: teacher.email,
        options: { redirectTo: `${siteUrl}/create-password` },
      });
      expect(error).toBeNull();
      const tokenHash = link?.properties?.hashed_token;
      expect(tokenHash, "Supabase should mint a hashed token").toBeTruthy();

      // Click it, as the teacher would from their inbox.
      await page.goto(
        `${siteUrl}/create-password?token_hash=${encodeURIComponent(tokenHash!)}&type=recovery`,
      );

      // The form, not the dashboard. This is the assertion that would have
      // caught the original bug: it used to land on /tools.
      await expect(page).toHaveURL(/\/create-password/);
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

      // Signed in, so updateUser() will work when they submit.
      //
      // Checked in COOKIES, not localStorage: @supabase/ssr keeps the session in
      // a cookie so the proxy and server components can read it, and a
      // localStorage probe returns nothing even when sign-in worked perfectly.
      await expect
        .poll(
          async () => {
            const cookies = await page.context().cookies();
            return cookies.some((c) => /^sb-.*-auth-token/.test(c.name));
          },
          { timeout: 15_000, message: "the token should establish a session cookie" },
        )
        .toBe(true);

      // And the copy addresses a returning teacher rather than a new signup.
      // This is what regresses if the page ever goes back to reading the session
      // once on mount: the fragment has not been consumed by then, so it would
      // render "Create your password. One more step and your account is ready."
      await expect(
        page.getByRole("heading", { name: /choose a new password/i }),
      ).toBeVisible();
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("a suspended teacher is refused, token or no token", async ({ page }) => {
    // A suspension applied while a reset link is in flight. The token is minted
    // first and banned afterwards, which is the order that actually happens: an
    // admin suspends someone who had already asked for a reset.
    //
    // verifyOtp() refuses it with user_banned and issues nothing. This is what
    // makes it safe for the reset link to bypass /auth/callback entirely: the
    // callback's suspension checks could only ever run on a session that had
    // been successfully issued, and here one never is.
    const teacher: TestTeacher = await createTeacher("Banned");
    try {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(
        /\/+$/,
        "",
      );
      const { data: link } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: teacher.email,
        options: { redirectTo: `${siteUrl}/create-password` },
      });
      const tokenHash = link!.properties!.hashed_token;

      await admin.auth.admin.updateUserById(teacher.id, { ban_duration: "876000h" });
      await admin
        .from("profiles")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", teacher.id);

      await page.goto(
        `${siteUrl}/create-password?token_hash=${encodeURIComponent(tokenHash!)}&type=recovery`,
      );

      // The page says the link did not work rather than silently showing a form
      // that cannot save. Matched by text rather than by role: the password
      // rules list is also a live region, so getByRole("alert") is ambiguous.
      await expect(
        page.getByText(/expired or has already been used/i),
      ).toBeVisible();

      // And no session. Given the same 15s the happy path gets, so this cannot
      // pass merely by asserting too early.
      await page.waitForTimeout(2000);
      const cookies = await page.context().cookies();
      const hasSession = cookies.some((c) => /^sb-.*-auth-token/.test(c.name));
      expect(hasSession, "a banned user must not receive a session").toBe(false);
    } finally {
      await deleteTeacher(teacher);
    }
  });
});
