import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * The contact and school enquiry forms, and where they land.
 *
 * The property worth pinning is that /contact works with NO SESSION AT ALL. It
 * is the first unauthenticated write in the product, so the two ways it can
 * regress are both invisible to a typecheck: dropping /contact or
 * /api/enquiries out of PUBLIC_PATHS in proxy.ts bounces a school to /login, and
 * tightening the grants on `enquiries` past the point submit_enquiry() needs
 * makes the POST fail for anon only. Neither shows up signed in, which is how
 * they would reach production.
 *
 * Rows are read back through the SERVICE ROLE rather than the admin console:
 * these tests assert that the submission landed and what it contains, and doing
 * that through a second UI would make a failure ambiguous between the two.
 * app/admin/enquiries has its own coverage in the last test.
 */

/** Unique per run so overlapping runs cannot collide, and so the per-address
 *  throttle in submit_enquiry() (3 an hour) never fires across tests. */
function freshEmail(tag: string): string {
  const salt = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return `e2e-enq-${tag}-${salt}@jooma.test`;
}

async function cleanup(email: string): Promise<void> {
  await admin.from("enquiries").delete().eq("email", email);
}

test.describe("Enquiries", () => {
  /*
   * Clear the IP throttle before each test.
   *
   * /api/enquiries allows 5 submissions an hour per IP, and every request in
   * this suite arrives from the same one (::1 on localhost, or a single CI
   * egress address). Without this the sixth submission across the whole file is
   * refused with a 429 and the test that happens to be sixth fails, which reads
   * as a broken form rather than a working rate limit. It cost a confused run
   * once already.
   *
   * The per-ADDRESS throttle inside submit_enquiry() is not cleared, and must
   * not be: freshEmail() gives every test its own address, so that limit is
   * never approached and is left in place to be caught if it ever misfires.
   */
  test.beforeEach(async () => {
    await admin.from("enquiry_rate").delete().neq("ip", "");
  });

  test("a school can enquire with no account at all", async ({ page }) => {
    const email = freshEmail("school");

    // No signIn() anywhere in this test. That is the point of it.
    await page.goto("/contact?type=school");
    await expect(page).toHaveURL(/\/contact/); // not bounced to /login

    // Wait for hydration before typing: these are controlled inputs, and a fill
    // that lands before React attaches is wiped when it does. See the long note
    // in tests/support/users.ts. Asserting the value afterwards is what makes it
    // deterministic, because toHaveValue retries.
    const submit = page.getByRole("button", { name: /send enquiry/i });
    await submit.waitFor({ state: "visible" });

    await page.locator("#school-name").fill("Priya Shah");
    await expect(page.locator("#school-name")).toHaveValue("Priya Shah");
    await page.locator("#school-school").fill("Northgate Primary School");
    await page.locator("#school-email").fill(email);
    await page.locator("#school-phone").fill("020 7946 0958");
    await page.locator("#school-licences").fill("25");
    await page.locator("#school-heard").selectOption("linkedin");
    await page.locator("#school-message").fill("Year 3 to 6, hoping to start in January.");

    await expect(submit).toBeEnabled();
    await submit.click();

    // The confirmation names the address, so a teacher can see where the reply
    // is going rather than guessing.
    await expect(page.getByText(/that is with us/i)).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText(/Reference EN-/)).toBeVisible();

    // The row is what actually matters.
    const { data } = await admin
      .from("enquiries")
      .select("kind, name, school, phone, licences, heard_about, status, user_id, reference")
      .eq("email", email)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data!.kind).toBe("school");
    expect(data!.school).toBe("Northgate Primary School");
    expect(data!.licences).toBe(25);
    expect(data!.heard_about).toBe("linkedin");
    expect(data!.status).toBe("new");
    // Nobody was signed in, so this must be null rather than some other user.
    expect(data!.user_id).toBeNull();
    expect(data!.reference).toMatch(/^EN-\d{4}$/);

    await cleanup(email);
  });

  test("a school enquiry will not send without the fields it needs", async ({ page }) => {
    await page.goto("/contact?type=school");

    const submit = page.getByRole("button", { name: /send enquiry/i });
    await submit.waitFor({ state: "visible" });

    // School and phone are required here and optional on the contact form, which
    // is the whole reason they are two components rather than one with a flag.
    await page.locator("#school-name").fill("Priya Shah");
    await page.locator("#school-email").fill(freshEmail("invalid"));
    await expect(page.locator("#school-name")).toHaveValue("Priya Shah");
    await expect(submit).toBeDisabled();

    await page.locator("#school-school").fill("Northgate Primary School");
    await expect(submit).toBeDisabled(); // still no phone

    await page.locator("#school-phone").fill("020 7946 0958");
    await expect(submit).toBeEnabled();
  });

  test("the honeypot is invisible, and a filled one is dropped", async ({ page }) => {
    const email = freshEmail("bot");

    await page.goto("/contact");
    const submit = page.getByRole("button", { name: /send message/i });
    await submit.waitFor({ state: "visible" });

    // Off-screen rather than display:none, so a bot walking the DOM fills it and
    // a person never reaches it.
    await expect(page.locator("#enquiry-company")).not.toBeInViewport();

    await page.locator("#contact-name").fill("Definitely A Person");
    await expect(page.locator("#contact-name")).toHaveValue("Definitely A Person");
    await page.locator("#contact-email").fill(email);
    await page.locator("#contact-message").fill("Buy my product.");

    // What a form-filling bot does, and what a person cannot.
    await page.locator("#enquiry-company").fill("Acme Corp");

    await expect(submit).toBeEnabled();
    await submit.click();

    // A 200 and a confirmation, so the bot learns nothing and does not retry...
    await expect(page.getByText(/that is with us/i)).toBeVisible();

    // ...but no row, which is the actual assertion.
    const { data } = await admin.from("enquiries").select("id").eq("email", email);
    expect(data ?? []).toHaveLength(0);
  });

  test("the IP throttle refuses a sixth submission in an hour", async ({ page, request }) => {
    /*
     * Driven through the API rather than the form: this is about the route's
     * brake, and filling six forms in a browser to prove it would be six times
     * slower and no more convincing.
     *
     * This is the handover's "rate limit hard by IP", which nothing in the
     * product had before /contact. It is the only thing standing between a
     * public write endpoint and someone with a loop, so it is worth a test that
     * fails loudly rather than a comment saying it exists.
     */
    const body = (n: number) => ({
      kind: "contact",
      name: `Flooder ${n}`,
      // A different address each time, so this can only be the IP limit failing
      // and never the per-address one.
      email: freshEmail(`flood${n}`),
      message: "again",
    });

    for (let i = 0; i < 5; i++) {
      const res = await request.post("/api/enquiries", { data: body(i) });
      expect(res.status(), `submission ${i + 1} of 5 should be accepted`).toBe(200);
    }

    const blocked = await request.post("/api/enquiries", { data: body(5) });
    expect(blocked.status()).toBe(429);
    // Told when to come back, rather than just refused.
    expect(blocked.headers()["retry-after"]).toBe("3600");

    await admin.from("enquiries").delete().like("email", "e2e-enq-flood%");
    await page.close();
  });

  test("a signed-in teacher gets the same forms, prefilled, from /help", async ({ page }) => {
    const teacher = await createTeacher("Rowan");
    try {
      await signIn(page, teacher);
      await page.goto("/help?tab=contact");

      // Name and email come from the profile and are not retyped.
      const name = page.locator("#contact-name");
      await expect(name).toHaveValue(`${teacher.firstName} ${teacher.surname}`);
      await expect(page.locator("#contact-email")).toHaveValue(teacher.email);
      await expect(name).toHaveAttribute("readonly", "");

      await page.locator("#contact-message").fill("Checking the in-app route.");
      const submit = page.getByRole("button", { name: /send message/i });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByText(/that is with us/i)).toBeVisible();

      // Signed in, so the row is stamped with who sent it. That is the whole
      // difference from the public path.
      const { data } = await admin
        .from("enquiries")
        .select("kind, user_id")
        .eq("email", teacher.email)
        .maybeSingle();
      expect(data?.kind).toBe("contact");
      expect(data?.user_id).toBe(teacher.id);

      await cleanup(teacher.email);
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("the three tabs on /help are links, and Help still opens a ticket", async ({ page }) => {
    const teacher = await createTeacher("Sasha");
    try {
      await signIn(page, teacher);
      await page.goto("/help");

      const tabs = page.getByRole("navigation", { name: /how to reach us/i });
      await expect(tabs.getByRole("link")).toHaveCount(3);

      // Real links, so the URL drives the tab and the back button works.
      await tabs.getByRole("link", { name: "School enquiry" }).click();
      await expect(page).toHaveURL(/tab=school/);
      await expect(page.locator("#school-school")).toBeVisible();

      await page.goBack();
      await expect(page.locator("#school-school")).toHaveCount(0);

      // Help is the default and stays out of the URL rather than being written
      // into it.
      await expect(page).not.toHaveURL(/tab=/);
      // The ticket composer, not an enquiry form: these are different systems.
      await expect(page.locator("#ticket-category")).toBeVisible();
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("the floating support bubble is shelved", async ({ page }) => {
    // Shelved, not deleted: SupportLauncher.tsx is still imported and one line
    // in AppShellV2 brings it back. A regression here is someone flipping that
    // default without meaning to.
    const teacher = await createTeacher("Ash");
    try {
      await signIn(page, teacher);
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: /get help/i })).toHaveCount(0);
    } finally {
      await deleteTeacher(teacher);
    }
  });

  test("an admin sees the enquiry and can filter it by kind", async ({ page }) => {
    const email = freshEmail("adminview");
    const teacher = await createTeacher("Morgan");
    try {
      await admin.from("profiles").update({ is_admin: true }).eq("id", teacher.id);

      // Seeded through the same public function the form uses, so this test is
      // about the console rather than about submission.
      await page.goto("/contact?type=school");
      const submit = page.getByRole("button", { name: /send enquiry/i });
      await submit.waitFor({ state: "visible" });
      await page.locator("#school-name").fill("Head Teacher");
      await expect(page.locator("#school-name")).toHaveValue("Head Teacher");
      await page.locator("#school-school").fill("Admin View Academy");
      await page.locator("#school-email").fill(email);
      await page.locator("#school-phone").fill("020 7946 1234");
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByText(/that is with us/i)).toBeVisible();

      await signIn(page, teacher);
      await page.goto("/admin/enquiries");

      await expect(page.getByRole("button", { name: /Head Teacher/ })).toBeVisible();
      await expect(page.getByText("Admin View Academy").first()).toBeVisible();

      // The two "sub-branches" are this filter rather than tabs.
      await page.getByLabel("Filter by type").selectOption("contact");
      await expect(page.getByRole("button", { name: /Head Teacher/ })).toHaveCount(0);

      await page.getByLabel("Filter by type").selectOption("school");
      await expect(page.getByRole("button", { name: /Head Teacher/ })).toBeVisible();

      // Stated permanently, so nobody waits in the console for a reply that
      // arrived in a mailbox.
      await expect(page.getByText(/Replies arrive there and are not shown here/i)).toBeVisible();

      await cleanup(email);
    } finally {
      await deleteTeacher(teacher);
    }
  });
});
