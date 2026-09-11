import { test, expect, type Page } from "@playwright/test";
import { createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * The CEO's slideshow changes, through the interface.
 *
 * Three behaviours are pinned here, each one a thing that would otherwise break
 * silently:
 *
 *   1. The generator asks for a pasted YouTube link and no longer searches. A
 *      regression that restored the search would still LOOK fine, because a
 *      video does appear on the deck. What distinguishes it is whether the URL
 *      field exists and whether /api/find-youtube is called, so these assert
 *      both directly.
 *   2. A link that will not embed is refused BEFORE generating. The whole point
 *      of the lookup is that the teacher finds out now rather than after a deck
 *      is built around a dead video, so the test drives a rejected link and
 *      checks the video never gets attached.
 *   3. Web search is the default image source, and choosing generated images
 *      warns about credits. Someone "tidying" the default back to auto costs
 *      real money per deck and nothing else would catch it.
 *
 * /api/lookup-youtube is stubbed throughout. These tests are about what the
 * interface does with an answer, not about YouTube being up, and a test that
 * depended on a real video would fail the day someone deleted it. Nothing here
 * generates a deck, so no credits are spent.
 */

/** A playable video, as /api/lookup-youtube would report one. */
const GOOD_VIDEO = {
  videoId: "aircAruvnKk",
  title: "But what is a neural network?",
  channel: "3Blue1Brown",
  thumbnail: "https://i.ytimg.com/vi/aircAruvnKk/mqdefault.jpg",
  duration: "18:40",
};

const WATCH_URL = `https://www.youtube.com/watch?v=${GOOD_VIDEO.videoId}`;

/** Answer the lookup with a playable video, and count the calls. */
async function stubLookup(page: Page, calls: string[]): Promise<void> {
  await page.route("**/api/lookup-youtube**", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ json: GOOD_VIDEO });
  });
}

/** Answer the lookup the way it refuses a video that will not embed. */
async function stubLookupRefusal(page: Page, error: string): Promise<void> {
  await page.route("**/api/lookup-youtube**", (route) =>
    route.fulfill({ status: 422, json: { error } }),
  );
}

/** Open the generate modal and get to step 2, where video and images live. */
async function openStepTwo(page: Page, topic = "The water cycle"): Promise<void> {
  await page.goto("/tools/slideshow");

  const open = page.getByRole("button", { name: /generate slideshow/i });
  await expect(open).toBeVisible();
  await open.click();

  // By name, not by position: the list page behind the modal has a search box
  // of its own, and `.first()` finds that instead. Filling then asserting the
  // value is the hydration wait, since Continue is gated on React's state.
  const topicField = page.locator('input[name="lesson-topic"]');
  await topicField.fill(topic);
  await expect(topicField).toHaveValue(topic);

  const cont = page.getByRole("button", { name: /^continue$/i });
  await expect(cont).toBeEnabled();
  await cont.click();

  await expect(page.getByText(/^Resources$/)).toBeVisible();
}

/** Tick the YouTube card open. */
async function enableYouTube(page: Page): Promise<void> {
  await page.getByRole("button", { name: /youtube video/i }).click();
  await expect(page.getByLabel(/video url/i)).toBeVisible();
}

test.describe("Slideshow: pasted video and image source", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Robin");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  /* ── The pasted video ─────────────────────────────────────────────────── */

  test("a pasted link is confirmed, and nothing searches YouTube", async ({ page }) => {
    const lookups: string[] = [];
    await stubLookup(page, lookups);

    // If a regression brings the search back, this is what catches it: the
    // route is never meant to be reached from the generator any more.
    let searched = false;
    await page.route("**/api/find-youtube", (route) => {
      searched = true;
      return route.fulfill({ status: 500, json: {} });
    });

    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    await page.getByLabel(/video url/i).fill(WATCH_URL);

    // The real title coming back is the proof the id was parsed and looked up.
    await expect(page.getByText(GOOD_VIDEO.title)).toBeVisible();
    await expect(page.getByText(GOOD_VIDEO.channel)).toBeVisible();

    expect(lookups.length, "the pasted link should be looked up exactly once").toBe(1);
    expect(lookups[0]).toContain(`id=${GOOD_VIDEO.videoId}`);
    expect(searched, "the generator must not search YouTube any more").toBe(false);

    // The note only makes sense once there is a video to place.
    await expect(page.getByLabel(/where does this fit/i)).toBeVisible();
  });

  test("the video length filter is gone with the search", async ({ page }) => {
    const lookups: string[] = [];
    await stubLookup(page, lookups);
    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    // Length only ever steered a search, so it is meaningless for a link the
    // teacher chose. Shelved behind the same flag as the search itself.
    await expect(page.getByText(/video length/i)).toHaveCount(0);
  });

  test("a short youtu.be link is accepted too", async ({ page }) => {
    const lookups: string[] = [];
    await stubLookup(page, lookups);
    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    await page.getByLabel(/video url/i).fill(`https://youtu.be/${GOOD_VIDEO.videoId}`);
    await expect(page.getByText(GOOD_VIDEO.title)).toBeVisible();
    expect(lookups[0]).toContain(`id=${GOOD_VIDEO.videoId}`);
  });

  test("nonsense is rejected without troubling the server", async ({ page }) => {
    const lookups: string[] = [];
    await stubLookup(page, lookups);
    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    await page.getByLabel(/video url/i).fill("https://example.com/not-a-video");

    await expect(page.getByText(/does not look like a youtube link/i)).toBeVisible();
    // Parsed client-side, so a bad paste costs no quota.
    expect(lookups.length, "an unparseable link should not be looked up").toBe(0);
    await expect(page.getByLabel(/where does this fit/i)).toHaveCount(0);
  });

  test("a video that will not embed is refused before generating", async ({ page }) => {
    await stubLookupRefusal(page, "The owner does not allow this video to play outside YouTube.");
    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    await page.getByLabel(/video url/i).fill(WATCH_URL);

    // The teacher's own words back, not a generic failure, and no video
    // attached: this is the whole reason the lookup happens up front.
    await expect(page.getByText(/does not allow this video to play outside youtube/i)).toBeVisible();
    await expect(page.getByText(GOOD_VIDEO.title)).toHaveCount(0);
    await expect(page.getByLabel(/where does this fit/i)).toHaveCount(0);
  });

  test("clearing the link drops the video", async ({ page }) => {
    const lookups: string[] = [];
    await stubLookup(page, lookups);
    await signIn(page, teacher);
    await openStepTwo(page);
    await enableYouTube(page);

    await page.getByLabel(/video url/i).fill(WATCH_URL);
    await expect(page.getByText(GOOD_VIDEO.title)).toBeVisible();

    await page.getByRole("button", { name: /remove this video/i }).click();

    await expect(page.getByText(GOOD_VIDEO.title)).toHaveCount(0);
    await expect(page.getByLabel(/video url/i)).toHaveValue("");
  });

  /* ── The image source ─────────────────────────────────────────────────── */

  test("web search is the default, and says so", async ({ page }) => {
    await signIn(page, teacher);
    await openStepTwo(page);

    // Collapsed, the card states the current source. Generated images cost
    // money per image, so a default that quietly drifts back to a mix is a
    // real bill rather than a cosmetic regression.
    await expect(page.getByText(/web search images/i)).toBeVisible();
    await expect(page.getByText(/^Default$/)).toBeVisible();
  });

  test("choosing generated images warns about credits", async ({ page }) => {
    await signIn(page, teacher);
    await openStepTwo(page);

    await page.getByRole("button", { name: /image source/i }).click();

    const notice = page.getByText(/generated images use more credits/i);
    await expect(notice, "web search is free, so no warning belongs here").toHaveCount(0);

    await page.getByRole("button", { name: /^AI-generated$/ }).click();
    await expect(notice).toBeVisible();

    // The mix includes generated images unless the slider is all the way over,
    // so the warning has to follow it there too.
    await page.getByRole("button", { name: /^Auto \(mix\)$/ }).click();
    await expect(notice).toBeVisible();

    // Back to free, back to silent.
    await page.getByRole("button", { name: /^Web search$/ }).click();
    await expect(notice).toHaveCount(0);
  });
});
