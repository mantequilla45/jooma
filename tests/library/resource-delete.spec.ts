import { test, expect } from "@playwright/test";
import {
  admin,
  connect,
  createTeacher,
  deleteTeacher,
  seedResource,
  signIn,
  type TestTeacher,
} from "../support/users";

/*
 * Does deleting a resource actually reclaim its storage — and only its storage?
 *
 * Deleting used to be a bare row delete from the browser. The row is the ONLY
 * index of which Storage objects a resource owns (nothing records the paths as
 * columns), so every deleted deck left its images, audio and video in the
 * bucket forever. Measured on staging before this changed: 189 orphaned
 * objects, 138 MB, about 16% of everything stored.
 *
 * The hard part is not deleting them. It is NOT deleting the ones something
 * else still points at:
 *
 *   - generated_images is a cross-slideshow reuse library, and 261 of its 383
 *     images are also used in a deck. Two thirds. Deleting a deck's files
 *     without checking would empty the picker.
 *   - a share COPIES the sender's output, so a colleague's saved copy is meant
 *     to outlive the original.
 *
 * Those two cases do not arise on their own in a fresh fixture, so these tests
 * construct them deliberately. A test that hoped to find one would pass while
 * proving nothing.
 */

const BUCKET = "images";

/** A real object in the bucket, so the assertions are about storage rather
 *  than about strings that look like URLs. */
async function putFile(name: string): Promise<{ path: string; url: string }> {
  // A one pixel PNG. Small, real, and valid enough that Storage accepts it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const path = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}.png`;
  const { error } = await admin.storage.from(BUCKET).upload(path, png, {
    contentType: "image/png",
    upsert: false,
  });
  if (error) throw new Error(`Could not upload ${path}: ${error.message}`);

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

/** Is the object still in the bucket? */
async function exists(path: string): Promise<boolean> {
  // list() with a search rather than download(): a public bucket serves a
  // cached 200 for a moment after a delete, which would make this flap.
  const { data, error } = await admin.storage.from(BUCKET).list("", { search: path });
  if (error) throw new Error(`Could not list the bucket: ${error.message}`);
  return (data ?? []).some((o) => o.name === path);
}

async function removeIfPresent(path: string): Promise<void> {
  await admin.storage.from(BUCKET).remove([path]).catch(() => {});
}

/** A deck whose slides reference the given URLs. */
async function makeDeck(teacher: TestTeacher, title: string, urls: string[]): Promise<string> {
  const { data, error } = await admin
    .from("presentations")
    .insert({
      user_id: teacher.id,
      title,
      slides: [
        {
          shapes: [], texts: [],
          images: urls.map((src) => ({ src, x: 0, y: 0, w: 100, h: 100 })),
          audios: [], videos: [], callouts: [], badges: [], blockquotes: [], activities: [],
          background: "#ffffff",
        },
      ],
    })
    .select()
    .single();
  if (error) throw new Error(`Could not create a deck: ${error.message}`);
  return data.id as string;
}

async function deckExists(id: string): Promise<boolean> {
  const { data } = await admin.from("presentations").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

async function runExists(id: string): Promise<boolean> {
  const { data } = await admin.from("tool_runs").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

test.describe("Deleting a resource", () => {
  let teacher: TestTeacher;
  const cleanup: string[] = [];

  test.beforeEach(async () => {
    teacher = await createTeacher("Dara");
  });

  test.afterEach(async () => {
    for (const path of cleanup.splice(0)) await removeIfPresent(path);
    await deleteTeacher(teacher);
  });

  test("a deleted deck takes its files with it", async ({ page }) => {
    const file = await putFile("owned");
    cleanup.push(file.path);
    const deckId = await makeDeck(teacher, "Delete me", [file.url]);

    expect(await exists(file.path), "the fixture did not upload").toBe(true);

    await signIn(page, teacher);
    await page.goto("/tools/slideshow");

    const card = page.getByText("Delete me", { exact: true });
    await expect(card).toBeVisible();

    // Through the interface, as a teacher would.
    await page
      .locator("button", { has: page.locator("svg") })
      .filter({ hasText: "" })
      .first()
      .waitFor({ state: "attached" });
    await page.getByRole("button", { name: /delete/i }).first().click();
    await page.getByRole("button", { name: /^delete$/i }).last().click();

    await expect(card).toBeHidden();

    expect(await deckExists(deckId), "the deck row survived").toBe(false);
    await expect
      .poll(() => exists(file.path), { message: "the file was orphaned, not reclaimed" })
      .toBe(false);
  });

  test("a file a colleague still has is left alone", async ({ page }) => {
    const other = await createTeacher("Robin");
    try {
      const file = await putFile("shared");
      cleanup.push(file.path);

      // The sender's resource, and the snapshot the recipient was given. The
      // share carries its OWN copy of the output, which is the whole point.
      const runId = await seedResource(teacher, "Shared away", `See ![p](${file.url})`);
      await connect(teacher, other);
      const { error } = await admin.from("shares").insert({
        sender_id: teacher.id,
        recipient_id: other.id,
        source_run_id: runId,
        tool_slug: "lesson-planner",
        title: "Shared away",
        input: {},
        output: `See ![p](${file.url})`,
      });
      expect(error, error?.message).toBeNull();

      await signIn(page, teacher);
      await page.goto("/folders");
      await page.locator('[class*="filecard"]').first().getByRole("button", { name: /menu$/i }).click();
      await page.locator('[role="menu"] button', { hasText: /^delete$/i }).click();
      await page.getByRole("button", { name: /^delete$/i }).last().click();

      await expect
        .poll(() => runExists(runId), { message: "the sender's copy survived" })
        .toBe(false);

      // The recipient's copy still points at this file, so it must survive.
      expect(
        await exists(file.path),
        "deleting the sender's copy broke the colleague's",
      ).toBe(true);
    } finally {
      await deleteTeacher(other);
    }
  });

  test("an image the reuse library still holds is left alone", async ({ page }) => {
    const file = await putFile("reused");
    cleanup.push(file.path);

    // In the library AND in a deck: the majority case on real data.
    const { data: img, error } = await admin
      .from("generated_images")
      .insert({ prompt: "e2e reused image", data_url: file.url, user_id: teacher.id })
      .select()
      .single();
    expect(error, error?.message).toBeNull();

    const deckId = await makeDeck(teacher, "Uses a library image", [file.url]);

    await signIn(page, teacher);
    await page.goto("/tools/slideshow");
    await page.getByRole("button", { name: /delete/i }).first().click();
    await page.getByRole("button", { name: /^delete$/i }).last().click();

    await expect.poll(() => deckExists(deckId)).toBe(false);

    expect(await exists(file.path), "a reusable library image was deleted").toBe(true);

    const { data: still } = await admin
      .from("generated_images")
      .select("id")
      .eq("id", img!.id)
      .maybeSingle();
    expect(still, "the library row was deleted").not.toBeNull();

    await admin.from("generated_images").delete().eq("id", img!.id);
  });

  /*
   * The regression guard for the cost tables.
   *
   * token_usage, asset_cost and slide_cost link to a run through a bare run_id
   * with NO foreign key, deliberately: the spend happened, and monitoring,
   * margin and the cost ceiling all depend on that history staying complete
   * even after the resource is gone. An orphaned run_id looks like a bug, so
   * the temptation to "fix" it with ON DELETE CASCADE is real. This fails
   * loudly if anyone ever does.
   */
  test("deleting a resource does not touch the cost history", async ({ page }) => {
    const runId = await seedResource(teacher, "Cost me something");

    const { error: tokenErr } = await admin.from("token_usage").insert({
      user_id: teacher.id,
      run_id: runId,
      tool_slug: "lesson-planner",
      model: "e2e-model",
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.0123,
    });
    expect(tokenErr, tokenErr?.message).toBeNull();

    const countCosts = async () => {
      const { count } = await admin
        .from("token_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", teacher.id);
      return count ?? 0;
    };

    const before = await countCosts();
    expect(before, "the cost fixture did not insert").toBeGreaterThan(0);

    await signIn(page, teacher);
    await page.goto("/folders");
    await page.locator('[class*="filecard"]').first().getByRole("button", { name: /menu$/i }).click();
    await page.locator('[role="menu"] button', { hasText: /^delete$/i }).click();
    await page.getByRole("button", { name: /^delete$/i }).last().click();

    await expect.poll(() => runExists(runId)).toBe(false);

    expect(
      await countCosts(),
      "deleting a resource destroyed its cost history",
    ).toBe(before);
  });

  test("cancelling the confirmation keeps everything", async ({ page }) => {
    const file = await putFile("kept");
    cleanup.push(file.path);
    const runId = await seedResource(teacher, "Keep me", `![p](${file.url})`);

    await signIn(page, teacher);
    await page.goto("/folders");
    await page.locator('[class*="filecard"]').first().getByRole("button", { name: /menu$/i }).click();
    await page.locator('[role="menu"] button', { hasText: /^delete$/i }).click();

    await page.getByRole("button", { name: /^cancel$/i }).click();

    expect(await runExists(runId), "cancelling deleted the resource anyway").toBe(true);
    expect(await exists(file.path), "cancelling deleted the file anyway").toBe(true);
  });
});
