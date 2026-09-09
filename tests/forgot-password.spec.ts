import { test, expect, type APIResponse } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, type TestTeacher } from "./support/users";

/*
 * Forgot password, and the property that matters most about it.
 *
 * /api/auth/password-link must answer IDENTICALLY for an address that has an
 * account and one that does not. It is otherwise a free account-enumeration
 * oracle: POST a school's staff list, read the status codes, learn who has
 * Jooma. That is exactly what app/login/page.tsx refuses to leak through its
 * error copy, and it would be undone by one endpoint returning a helpful
 * "no account with that email".
 *
 * A typecheck cannot see this. Nor can a reviewer skimming a diff, because the
 * regression looks like a kindness: someone adds a 404 so the form can tell the
 * teacher they typed the wrong address. This test is the thing that objects.
 *
 * Requests go through request.post() rather than the form, because the assertion
 * is about the RESPONSE, and driving the UI would only be able to compare two
 * rendered banners that are deliberately the same either way.
 */

/** Unique per run so overlapping runs cannot collide, and so the per-address
 *  throttle (3 an hour) never fires across tests. */
function freshEmail(tag: string): string {
  const salt = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return `e2e-pw-${tag}-${salt}@jooma.test`;
}

/** Everything a caller can observe, which is the whole point: if any of these
 *  differ between a real and an unknown address, the endpoint leaks. */
async function shape(res: APIResponse) {
  return { status: res.status(), body: await res.text() };
}

test.describe("Forgot password", () => {
  /*
   * Clear the throttle before each test.
   *
   * Every request in this file arrives from one IP (::1 on localhost, or a
   * single CI egress address) and the limit is 5 an hour, so without this the
   * sixth request across the whole file 429s and whichever test is sixth fails
   * as if the endpoint were broken. Same trap as tests/enquiries.spec.ts, and
   * the same fix.
   *
   * Deleting by kind rather than truncating: the email rows are cleared too,
   * but only because each test uses a fresh address anyway.
   */
  test.beforeEach(async () => {
    await admin.from("auth_rate").delete().neq("kind", "");
  });

  test("answers identically for a real address and an unknown one", async ({ request }) => {
    const teacher: TestTeacher = await createTeacher("Reset");
    try {
      // A real account. This one genuinely sends an email.
      const real = await shape(
        await request.post("/api/auth/password-link", {
          data: { email: teacher.email },
        }),
      );

      // An address with no account anywhere in the project.
      const unknown = await shape(
        await request.post("/api/auth/password-link", {
          data: { email: freshEmail("nobody") },
        }),
      );

      // A malformed address, which never even reaches Supabase.
      const malformed = await shape(
        await request.post("/api/auth/password-link", {
          data: { email: "not-an-address" },
        }),
      );

      expect(real.status).toBe(200);
      expect(unknown).toEqual(real);
      expect(malformed).toEqual(real);

      // And the body says nothing either. Pinned literally rather than as
      // "contains no email": a future field like { found: false } would pass a
      // looser check while leaking the same fact.
      expect(JSON.parse(real.body)).toEqual({ ok: true });
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("a filled honeypot is accepted and sends nothing", async ({ request }) => {
    const teacher: TestTeacher = await createTeacher("Honeypot");
    try {
      const res = await request.post("/api/auth/password-link", {
        // A real address, so the only reason nothing is sent is the honeypot.
        data: { email: teacher.email, company: "Acme Ltd" },
      });

      // A 200 that looks like every other 200. A bot that sees a 400 learns the
      // field is a trap and comes back without it.
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Nothing was counted, which is the observable proof the request was
      // dropped before any work: a real send always records a row first.
      const { count } = await admin
        .from("auth_rate")
        .select("id", { count: "exact", head: true })
        .eq("identifier", teacher.email);
      expect(count ?? 0).toBe(0);
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("throttles a repeated address", async ({ request }) => {
    const email = freshEmail("throttle");

    // Three an hour per address, so the fourth is refused. Uses an address with
    // no account on purpose: the throttle must not depend on the account
    // existing, or it would be trivially bypassed by probing unknown addresses,
    // which is the exact traffic worth slowing down.
    for (let i = 0; i < 3; i++) {
      const res = await request.post("/api/auth/password-link", { data: { email } });
      expect(res.status(), `request ${i + 1} should be allowed`).toBe(200);
    }

    const refused = await request.post("/api/auth/password-link", { data: { email } });
    expect(refused.status()).toBe(429);
    // Retry-After, matching how generation-guard.ts and /api/enquiries report a
    // rate limit. Without it the client has nothing to tell the teacher.
    expect(refused.headers()["retry-after"]).toBe("3600");
  });

  test("the sign-in page offers a way through to it", async ({ page }) => {
    // The endpoint above is unreachable in practice if nothing links to it, and
    // the link is one line in a file every other spec depends on.
    await page.goto("/login");
    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    // Reachable with NO SESSION, which is the other way this regresses:
    // dropping /forgot-password out of PUBLIC_PATHS in proxy.ts bounces a
    // locked-out teacher to the login page they cannot use.
    await expect(page.getByRole("heading", { name: /forgot your password/i })).toBeVisible();
  });
});
