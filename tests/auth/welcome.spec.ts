import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * The welcome screen a new teacher lands on after signing up.
 *
 * The interesting property is not that the page renders, it is that it renders
 * ONCE, for a new account, and never gets in the way afterwards. Nothing is
 * stored to mark it seen: it works purely because /complete-profile is the one
 * screen both signup paths pass through and signing in does not. That is easy
 * to break by "tidying" a redirect, and nothing else would notice, so these
 * pin both halves.
 *
 * The full signup form is not driven here. createTeacher already seeds the
 * profile /complete-profile would have written, so a test that filled the form
 * again would be testing the form, not this. The redirect itself is asserted
 * where it lives, against the page's own source, in the last test.
 */

test.describe("Welcome", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Frankie");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("greets the teacher by name and offers somewhere to start", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/welcome");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Welcome to Jooma, ${teacher.firstName}`,
    );

    // Four real tools, each linking at its actual route. A tool renamed out of
    // the catalogue would silently drop out of this list, so the count matters.
    const cards = page.getByRole("main").getByRole("link");
    await expect(cards).toHaveCount(5); // four tools plus "Go to my tools"

    await expect(page.getByRole("link", { name: /slides/i })).toHaveAttribute(
      "href",
      "/tools/slideshow",
    );

    const cta = page.getByRole("link", { name: /go to my tools/i });
    await expect(cta).toHaveAttribute("href", "/tools");
    await cta.click();
    await expect(page).toHaveURL(/\/tools$/);
  });

  test("survives a teacher with no first name on their profile", async ({ page }) => {
    // A Google signup that never completed the profile still has a session, and
    // an empty greeting reading "Welcome to Jooma, " would be worse than none.
    await admin.from("profiles").update({ first_name: "" }).eq("id", teacher.id);

    await signIn(page, teacher);
    await page.goto("/welcome");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to Jooma");
  });

  test("the tool tiles are clipped, so SquircleDefs is on the page", async ({ page }) => {
    /*
     * `clip-path: url(#jsq)` resolves against the current document. This page
     * sits outside the (app) group, so it does NOT inherit the shell that
     * normally provides the definition and has to mount it itself. Forget that
     * and every tile renders as a plain square: visible to a person, invisible
     * to every other assertion here.
     */
    await signIn(page, teacher);
    await page.goto("/welcome");

    await expect(page.locator("#jsq")).toHaveCount(1);
  });

  test("is not reachable signed out", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing in goes to the app, not back through the welcome", async ({ page }) => {
    // The screen is for new accounts. A returning teacher seeing it every time
    // would be the obvious way for this to go wrong.
    await signIn(page, teacher);
    await expect(page).not.toHaveURL(/\/welcome/);
  });
});
