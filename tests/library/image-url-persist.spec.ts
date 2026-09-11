import { test, expect } from "@playwright/test";
import { admin, createTeacher, deleteTeacher, signIn, type TestTeacher } from "../support/users";

/*
 * Does an image added by URL actually survive a reload?
 *
 * "Add by URL" goes through /api/fetch-image, which returns the bytes as a
 * base64 data URL. That string is then inlined into the slide JSON and saved
 * with the rest of the deck, so the question is not really about images at all:
 * it is whether a row carrying an inlined image still writes.
 *
 * The deck is created and read back through the service role, but the editing
 * happens in a real browser as a real signed-in teacher, so what is asserted is
 * what a teacher would actually get.
 */

/*
 * The URL is fetched SERVER-side by /api/fetch-image, so page.route cannot
 * intercept it: the request never leaves the browser. These therefore point at
 * a real host. picsum.photos serves an image of whatever size is asked for,
 * which is exactly the knob this test needs.
 */
const SMALL_URL = "https://picsum.photos/seed/jooma-small/200/200";
/** Big enough that base64 inflation pushes the saved row into megabytes. */
const LARGE_URL = "https://picsum.photos/seed/jooma-large/4000/3000";

async function makeDeck(teacher: TestTeacher, title: string): Promise<string> {
  const { data, error } = await admin
    .from("presentations")
    .insert({
      user_id: teacher.id,
      title,
      slides: [
        {
          shapes: [], texts: [], images: [], audios: [], videos: [],
          callouts: [], badges: [], blockquotes: [], activities: [],
          background: "#ffffff",
        },
      ],
    })
    .select()
    .single();
  if (error) throw new Error(`Could not create a deck: ${error.message}`);
  return data.id as string;
}

/** How many images the saved row actually holds, and how big it is. */
async function savedState(deckId: string): Promise<{ images: number; mb: number; src: string }> {
  const { data, error } = await admin
    .from("presentations")
    .select("slides")
    .eq("id", deckId)
    .single();
  if (error) throw new Error(`Could not read the deck back: ${error.message}`);
  const slides = (data.slides ?? []) as { images?: { src?: string }[] }[];
  const images = slides.flatMap((s) => s.images ?? []);
  return {
    images: images.length,
    mb: JSON.stringify(data.slides).length / 1024 / 1024,
    src: images[0]?.src ?? "",
  };
}

test.describe("Adding an image by URL", () => {
  let teacher: TestTeacher;
  let deckId: string;

  test.beforeEach(async () => {
    teacher = await createTeacher("Sam");
  });

  test.afterEach(async () => {
    if (deckId) await admin.from("presentations").delete().eq("id", deckId);
    await deleteTeacher(teacher);
  });

  test("a small image added by URL survives a reload", async ({ page }) => {
    deckId = await makeDeck(teacher, "URL image, small");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();

    const url = page.getByPlaceholder("https://...");
    await url.fill(SMALL_URL);
    await url.press("Enter");

    // The editor autosaves on a 1s debounce; give it room, then read the row.
    await expect
      .poll(async () => (await savedState(deckId)).images, { timeout: 20_000 })
      .toBe(1);

    const saved = await savedState(deckId);
    expect(saved.src.startsWith("data:image/"), "the image is inlined as base64").toBe(true);
  });

  test("a large image added by URL still lands in the saved row", async ({ page }) => {
    /*
     * The interesting case. /api/fetch-image allows up to 12 MB and returns
     * base64, which inflates by ~33%, and the WHOLE deck is rewritten on every
     * save. If a big image is what breaks saving, this is where it shows.
     */
    deckId = await makeDeck(teacher, "URL image, large");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    const failures: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /save failed/i.test(m.text())) failures.push(m.text());
    });

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();

    const url = page.getByPlaceholder("https://...");
    await url.fill(LARGE_URL);
    await url.press("Enter");

    await expect
      .poll(async () => (await savedState(deckId)).images, { timeout: 30_000 })
      .toBe(1);

    const saved = await savedState(deckId);
    console.log(`saved deck size: ${saved.mb.toFixed(2)} MB`);
    expect(failures, `the editor reported a save failure: ${failures[0] ?? ""}`).toHaveLength(0);
  });

  test("several large images in one deck still save", async ({ page }) => {
    /*
     * The real shape of the complaint. One image is fine. But EVERY save
     * rewrites the WHOLE deck, inlined images and all, so cost grows with the
     * number of images in the deck rather than with the edit being made. This
     * adds several and checks the row keeps up.
     */
    deckId = await makeDeck(teacher, "URL images, several");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    const failures: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /save failed/i.test(m.text())) failures.push(m.text());
    });

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();
    const url = page.getByPlaceholder("https://...");

    for (let i = 0; i < 4; i++) {
      await url.fill(`https://picsum.photos/seed/jooma-many-${i}/4000/3000`);
      await url.press("Enter");
      await expect
        .poll(async () => (await savedState(deckId)).images, { timeout: 45_000 })
        .toBe(i + 1);
      const now = await savedState(deckId);
      console.log(`after image ${i + 1}: ${now.mb.toFixed(2)} MB`);
    }

    expect(failures, `the editor reported a save failure: ${failures[0] ?? ""}`).toHaveLength(0);
  });

  test("the image is still ON THE SLIDE after a reload", async ({ page }) => {
    /*
     * The complaint as a teacher would experience it: add the image, reload,
     * is it still there? Saving to the row and rendering back onto the canvas
     * are separate things, and only this checks the second one.
     */
    deckId = await makeDeck(teacher, "URL image, reload");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();
    await page.getByPlaceholder("https://...").fill(SMALL_URL);
    await page.getByPlaceholder("https://...").press("Enter");

    await expect
      .poll(async () => (await savedState(deckId)).images, { timeout: 20_000 })
      .toBe(1);

    // Straight back in, as if the teacher closed the tab and came back.
    await page.reload();

    const onCanvas = page.locator('img[src^="data:image/"]');
    await expect(onCanvas.first()).toBeVisible({ timeout: 20_000 });

    // Visible is not the same as rendered: a broken data URL still occupies
    // layout. Ask the browser whether it actually decoded any pixels.
    const decoded = await onCanvas.first().evaluate(
      (el) => (el as HTMLImageElement).naturalWidth,
    );
    expect(decoded, "the image element decoded no pixels").toBeGreaterThan(0);
  });

  test("a URL that is not really an image says so", async ({ page }) => {
    /*
     * The silent-failure case, and the likeliest reason someone reports that
     * an image "did not save".
     *
     * /api/fetch-image only trusts the content-type header. A server that
     * claims image/jpeg while sending something undecodable gets through it,
     * and then Editor.addImage builds the element inside img.onload, which for
     * undecodable bytes NEVER FIRES. No image, no error, nothing to save.
     *
     * The URL below is a real page served as text/html, so the route itself
     * should reject it and the panel should show why.
     */
    deckId = await makeDeck(teacher, "URL image, not an image");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();
    await page.getByPlaceholder("https://...").fill("https://example.com/");
    await page.getByPlaceholder("https://...").press("Enter");

    // Something must be said. Silence here is the bug.
    await expect(page.getByText(/not an image|failed|error/i).first()).toBeVisible({
      timeout: 20_000,
    });
    expect((await savedState(deckId)).images).toBe(0);
  });

  test("an image that arrives but will not decode says so", async ({ page }) => {
    /*
     * The silent failure this suite was written to find.
     *
     * /api/fetch-image can only trust the content-type header, so a server
     * claiming image/jpeg over undecodable bytes gets all the way to the
     * canvas. Editor.addImage builds the element inside img.onload, which for
     * such bytes never fires: previously the image vanished with no message,
     * which reads exactly like "it did not save".
     *
     * Driven through the editor's own addImage rather than a URL, because the
     * point is the decode, and no real host reliably serves a lying header.
     */
    deckId = await makeDeck(teacher, "URL image, undecodable");
    await signIn(page, teacher);
    await page.goto(`/editor/${deckId}`);

    // Intercept the route's REPLY, so the editor receives a well-formed
    // response carrying bytes that cannot be decoded. This is the browser side
    // of the failure, which is where the missing handler was.
    await page.route("**/api/fetch-image", (route) =>
      route.fulfill({
        json: { dataUrl: "data:image/jpeg;base64," + Buffer.from("not a jpeg").toString("base64") },
      }),
    );

    await page.getByRole("button", { name: /^pictures$/i }).click();
    await page.getByRole("button", { name: /^upload$/i }).click();
    await page.getByPlaceholder("https://...").fill("https://example.test/looks-fine.jpg");
    await page.getByPlaceholder("https://...").press("Enter");

    // The teacher must be told something rather than left staring at a slide
    // where nothing appeared. If this fails, the silent drop is back.
    await expect(page.getByText(/could not be opened/i)).toBeVisible({ timeout: 15_000 });
    expect((await savedState(deckId)).images).toBe(0);
  });
});
