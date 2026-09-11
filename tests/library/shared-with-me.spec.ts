import { test, expect, type Page } from "@playwright/test";
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
 * "Shared with me", the Library's third view that is not a folder.
 *
 * IT IS A FILTER, NOT A FOLDER, and that is what these tests are really about.
 * Membership is provenance: the run ids that appear as shares.saved_run_id. So
 * a resource can be in this view AND in a real folder at the same time, and
 * filing one must not remove it from here.
 *
 * The obvious way to build this would have been a column on tool_runs, or to
 * reuse folder_id. Both would make the two mutually exclusive, and filing a
 * shared resource would quietly erase the fact it came from a colleague. The
 * "still there after filing" test below is the one that would catch a later
 * refactor back to that.
 */

/** Share a resource from one teacher to another and accept it, exactly as
 *  saveSharedToLibrary does: insert the recipient's copy, then stamp the share
 *  with the id of that copy. The stamp is what puts it in the view. */
async function shareAndAccept(
  from: TestTeacher,
  to: TestTeacher,
  title: string,
  output = "Test resource body.",
): Promise<string> {
  const sourceId = await seedResource(from, title, output);

  const { data: copy, error: copyError } = await admin
    .from("tool_runs")
    .insert({ user_id: to.id, tool_slug: "lesson-planner", title, input: {}, output })
    .select()
    .single();
  if (copyError) throw new Error(`Could not seed the copy: ${copyError.message}`);

  const { error } = await admin.from("shares").insert({
    sender_id: from.id,
    recipient_id: to.id,
    source_run_id: sourceId,
    tool_slug: "lesson-planner",
    title,
    input: {},
    output,
    saved_at: new Date().toISOString(),
    saved_run_id: copy.id,
  });
  if (error) throw new Error(`Could not seed the share: ${error.message}`);

  return copy.id as string;
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/folders");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
}

test.describe("Shared with me", () => {
  let alice: TestTeacher;
  let bob: TestTeacher;

  test.beforeEach(async () => {
    alice = await createTeacher("Alice");
    bob = await createTeacher("Bob");
  });

  test.afterEach(async () => {
    await deleteTeacher(alice);
    await deleteTeacher(bob);
  });

  test("the card appears once something has been added, and holds it", async ({ page }) => {
    await connect(alice, bob);
    await shareAndAccept(alice, bob, "Alice's rivers lesson", "RIVERS BODY");

    await signIn(page, bob);
    await openLibrary(page);

    const card = page.getByRole("button", { name: /shared with me/i });
    await expect(card).toBeVisible();
    await expect(card).toContainText("1 resource");

    await card.click();
    await expect(page).toHaveURL(/folder=shared/);
    await expect(page.getByRole("heading", { name: "Shared with me", level: 2 })).toBeVisible();
    await expect(page.getByText("Alice's rivers lesson")).toBeVisible();

    // The row says who sent it. In this view that is what distinguishes one row
    // from another, so it replaces the folder in the meta line.
    await expect(page.getByText(/from Alice/i)).toBeVisible();
  });

  test("a teacher with nothing shared sees no card at all", async ({ page }) => {
    // Not an empty view: a teacher with no colleagues should not be given a
    // permanently empty card, in the way the requests panel only appears when
    // there are requests.
    await seedResource(bob, "Bob's own plan");

    await signIn(page, bob);
    await openLibrary(page);

    await expect(page.getByText("Bob's own plan")).toBeVisible();
    await expect(page.getByRole("button", { name: /shared with me/i })).toHaveCount(0);
  });

  test("a shared resource opens the reader rather than navigating to the tool", async ({
    page,
  }) => {
    await connect(alice, bob);
    await shareAndAccept(alice, bob, "Alice's rivers lesson", "# Rivers\n\nRIVERS BODY");

    await signIn(page, bob);
    await page.goto("/folders?folder=shared");

    // Not /^Alice's rivers lesson/: the row's kebab is labelled
    // "<title> menu" and comes first in the DOM, so a prefix match opens the
    // menu instead of the resource. The open target names the meta line too.
    await page.getByRole("button", { name: /Alice's rivers lesson Lesson Plan/ }).click();

    // A dialog, and NOT a navigation: in this view a click reads it, and the
    // row menu still carries Open for the editing route.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/folder=shared/);
    await expect(dialog.getByText(/shared by alice/i)).toBeVisible();

    // Already in the library, so there is nothing left to add. The modal works
    // this out from the share itself rather than from a prop.
    await expect(dialog.getByText(/in your library/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /add to library/i })).toHaveCount(0);
  });

  test("filing a shared resource keeps it in the view", async ({ page }) => {
    /*
     * THE LOAD-BEARING ONE. Provenance and filing are independent, so a shared
     * resource moved into a real folder must appear in BOTH. Move to folder
     * rather than drag: it is the keyboard route, and HTML5 drag and drop is
     * notoriously flaky to drive from Playwright.
     */
    await connect(alice, bob);
    await shareAndAccept(alice, bob, "Alice's rivers lesson", "RIVERS BODY");

    await signIn(page, bob);
    await openLibrary(page);

    await page.getByRole("button", { name: /new folder/i }).first().click();
    await page.getByLabel("Name").fill("Autumn 2");
    await page.getByRole("button", { name: /create folder/i }).click();
    // Named with its count: a folder card also carries a kebab labelled
    // "<name> menu", so a bare /Autumn 2/ matches two things.
    const folderCard = page.getByRole("button", { name: /Autumn 2 \d+ resource/ });
    await expect(folderCard).toBeVisible();

    await page.getByRole("button", { name: "Alice's rivers lesson menu" }).click();
    await page.getByRole("menuitem", { name: /move to folder/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Autumn 2" }).click();

    // It is in the folder.
    await expect(folderCard).toContainText("1 resource");
    await folderCard.click();
    await expect(page.getByText("Alice's rivers lesson")).toBeVisible();

    // AND it is still in Shared with me, which is the whole point.
    await page.goto("/folders?folder=shared");
    await expect(page.getByText("Alice's rivers lesson")).toBeVisible();
    await expect(page.getByRole("button", { name: /shared with me/i })).toContainText(
      "1 resource",
    );
  });
});
