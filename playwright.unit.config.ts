import { defineConfig } from "@playwright/test";

/*
 * The pure functions, run on their own.
 *
 *   pnpm test:unit
 *
 * Everything in tests/unit is a function call and an assertion: no browser, no
 * dev server, no database. They run in about a second, which is the point. Run
 * these while you work and save the staging suite for when you are done.
 *
 * WHY A SEPARATE CONFIG RATHER THAN A PROJECT
 *
 * `webServer` in playwright.config.ts is top level, so a project inside that
 * config would still boot Next before running a test that has no use for it.
 * This file deliberately does not import the main config, so there is nothing
 * for that setting to leak through.
 *
 * Using E2E_BASE_URL to suppress the server would have been the other option
 * and is worse: that variable means "point at a deployment", and anybody who
 * has it exported would silently change every other script in the repo.
 */
export default defineConfig({
  testDir: "./tests/unit",

  // Safe here, unlike the staging suite: nothing is shared, so nothing can
  // collide. This is what makes the run a second rather than a minute.
  fullyParallel: true,

  retries: 0,
  forbidOnly: !!process.env.CI,

  // `list` only. The staging suite writes playwright-report/, and a unit run
  // finishing afterwards would otherwise overwrite it with four results.
  reporter: [["list"]],

  // No compile step to wait on, so a second is already generous. A pure
  // function that takes ten is a bug worth failing on.
  timeout: 10_000,
  expect: { timeout: 1_000 },
});
