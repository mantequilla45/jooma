import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * The sidebar credit meter.
 *
 * The bug this pins: useCreditMeter used `metered: false` for two different
 * things — "this plan has no credit ceiling" and "the lookup failed" — and the
 * sidebar renders the block only when `metered` is true. So one flaky request
 * out of the four getEntitlements() makes deleted a teacher's credits
 * mid-session, which reads as having lost them.
 */

test.describe("Credits", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Devon");
    // Free has no spend ceiling and legitimately hides the meter, so the meter
    // only exists to test on a metered plan.
    await admin.from("profiles").update({ plan: "pro" }).eq("id", teacher.id);
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("the meter holds its value across navigation inside the group", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const nav = page.locator("#app-sidenav-v2");
    const meter = nav.locator('[class*="meterVal"]').filter({ hasText: /left/ });

    // The meter loads async, so it must be waited for rather than counted:
    // count() on a not-yet-rendered node reads zero and would skip a real test.
    await expect(meter.first()).toBeVisible();
    const before = await meter.first().innerText();

    for (const name of [/^library/i, /^timetable$/i, /^colleagues/i, /^today$/i]) {
      await nav.getByRole("link", { name }).first().click();
      // Asserted with a short timeout: the value must still be there, not
      // arrive again after a refetch.
      await expect(meter.first()).toHaveText(before, { timeout: 2000 });
    }
  });

  // This was the gap the shared shell was built to close: /assistant used to
  // mount its own AppShellV2, so crossing into it tore the rail down and the
  // meter restarted at loading. It is now under app/(app) like everything else.
  test("the meter survives crossing into Ask Jo", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    const nav = page.locator("#app-sidenav-v2");
    const credits = nav.getByText("Credits", { exact: true });
    await expect(credits).toBeVisible();

    await nav.getByRole("link", { name: /^ask jo$/i }).first().click();
    await expect(page).toHaveURL(/\/assistant/);

    await expect(credits).toBeVisible({ timeout: 2000 });
  });
});
