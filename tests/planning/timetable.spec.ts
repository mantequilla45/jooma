import { test, expect, type Page } from "@playwright/test";
import {
  admin,
  createTeacher,
  deleteTeacher,
  listLessons,
  mondayOf,
  seedLesson,
  seedPattern,
  seedResource,
  signIn,
  weekExists,
  type TestTeacher,
} from "../support/users";

/*
 * The timetable, through the interface.
 *
 * WHAT IS WORTH A BROWSER HERE
 *
 * Not "the grid renders". The properties below are the ones that would be a
 * real bug and that nothing else would catch: a wizard that reappears over a
 * teacher's real timetable, a second lesson silently duplicating a slot, a
 * deleted resource taking the lesson down with it, and Today quietly writing to
 * a week it is only supposed to read.
 *
 * There are no data-testid attributes anywhere in this app, so every selector
 * here is a role, a label or an aria-label exactly as the component spells it.
 *
 * WHICH DAY A LESSON HAS TO GO ON, which is the fiddly part
 *
 * Both screens read the CURRENT week and nothing else. The timetable resolves it
 * from the browser clock on mount and offers no URL parameter; TodayView calls
 * listWeek(mondayOf(now)) the same way. So a lesson seeded into next week is
 * invisible to both, and every test here seeds the current week.
 *
 * Today additionally drops days that have already been and gone, so a Monday
 * lesson is invisible on the dashboard from Tuesday onwards. Anything asserting
 * what Today SHOWS therefore seeds a day that has not passed yet, worked out
 * from the clock rather than hardcoded: see upcomingDay() below.
 */

/**
 * A weekday in the current week that Today will still show.
 *
 * isPastDay compares dates with a strict `<`, so TODAY itself still counts and
 * the honest answer on a weekday is simply today. At the weekend mondayOf()
 * still returns the week just gone, every day of which is behind us, so there is
 * no such day at all and the caller must skip.
 */
function upcomingDay(): "mon" | "tue" | "wed" | "thu" | "fri" | null {
  const days = ["mon", "tue", "wed", "thu", "fri"] as const;
  // getDay() is 0 for Sunday and 6 for Saturday, neither of which is taught.
  const index = new Date().getDay() - 1;
  return index >= 0 && index <= 4 ? days[index]! : null;
}

/**
 * Wait until the grid has resolved its week before touching it.
 *
 * THE TRAP THIS EXISTS FOR, which cost an hour: saveSlot() opens with
 * `if (!week || !target) return`. The page resolves `week` from the browser
 * clock in an effect, so for the first moment after load it is null. A test
 * fast enough to open a cell and press Add in that window gets a dialog that
 * closes, a field that visibly held the right text, and NO REQUEST AT ALL. It
 * looks exactly like a broken save rather than a test that arrived early.
 *
 * The toolbar's week buttons are disabled while `loading` is true and the
 * eyebrow is blank until `week` is set, so the week label appearing is the real
 * signal that the page is ready to be driven.
 */
async function waitForGrid(page: Page): Promise<void> {
  await expect(page.getByText(/^Week beginning /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
}

/**
 * Type a subject into the open slot editor, and wait for React to have it.
 *
 * Not a bare fill(): the modal focuses the field and calls select() on mount,
 * so asserting the value back is what makes this deterministic, since
 * toHaveValue retries. Same trick, and the same reason, as signIn().
 */
async function fillSubject(page: Page, subject: string): Promise<void> {
  const field = page.getByRole("dialog").locator("#slot-subject");
  await field.fill(subject);
  await expect(field).toHaveValue(subject);
}

test.describe("Timetable setup", () => {
  let teacher: TestTeacher;

  test.beforeEach(async () => {
    teacher = await createTeacher("Tess");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a teacher with no pattern gets the wizard, and never sees it again", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");

    // The wizard is gated on getPattern() returning null, so this is what a
    // brand new teacher sees.
    await expect(page.getByText("Set up", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What do you teach?" })).toBeVisible();

    // Step 0: a year group and one subject.
    await page.locator("#wiz-year").selectOption("Year 4");
    await page.locator("#wiz-subject").fill("Maths");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 1: leave the default periods alone, they match the migration.
    await expect(page.getByRole("heading", { name: "What are your rows called?" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: put Maths in Monday's first period.
    await expect(page.getByRole("heading", { name: "Which lessons go where?" })).toBeVisible();
    await page.getByLabel("Monday, 9:00").selectOption("Maths");

    // The label changes to "Build my week" precisely because a slot is filled.
    await page.getByRole("button", { name: "Build my week" }).click();

    // The grid, with the lesson the wizard just wrote.
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });

    // THE PROPERTY: a reload must not put the wizard back. It is gated on the
    // pattern row, so a regression that failed to write one would strand the
    // teacher in setup forever with a week already built behind it.
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "What do you teach?" })).toBeHidden();
  });

  test("skipping the wizard still writes a pattern, so it does not reappear", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");

    await page.getByRole("button", { name: "Skip and set it up myself" }).click();

    // exact, because every empty cell in the grid is also "Add a lesson,
    // Tuesday, 11:00" and so on. Only the toolbar button is the bare label.
    await expect(page.getByRole("button", { name: "Add a lesson", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "What do you teach?" })).toBeHidden();
  });
});

test.describe("Lessons in a week", () => {
  let teacher: TestTeacher;
  // The grid opens on the current week and offers no way to deep link to
  // another, so this is the only week these tests can drive.
  const week = mondayOf();

  test.beforeEach(async () => {
    teacher = await createTeacher("Tess");
    // A pattern with no slots: past the wizard, into an empty grid.
    await seedPattern(teacher, { yearGroup: "Year 4" });
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a slot cannot be saved without a subject, and caps at forty characters", async ({
    page,
  }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    await page.getByRole("button", { name: "Add a lesson", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Empty subject: the save is gated on `subject.trim().length > 0`.
    const save = dialog.getByRole("button", { name: "Add lesson" });
    await expect(save).toBeDisabled();

    // Whitespace is not a subject either.
    await dialog.locator("#slot-subject").fill("   ");
    await expect(save).toBeDisabled();

    // maxLength=40 matches the CHECK on the column, so the interface cannot
    // offer something the database will refuse.
    await dialog.locator("#slot-subject").fill("x".repeat(41));
    await expect(dialog.locator("#slot-subject")).toHaveValue("x".repeat(40));
    await expect(save).toBeEnabled();
  });

  test("adding twice in one slot edits rather than duplicating", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    // First lesson into Monday, first period.
    await page.getByRole("button", { name: "Add a lesson, Monday, 9:00" }).click();
    await fillSubject(page, "Maths");
    await page.getByRole("dialog").getByRole("button", { name: "Add lesson" }).click();
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });

    // The same cell again. It must open as an EDIT, not a second add.
    await page.getByRole("button", { name: "Edit Maths, Monday, 9:00" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-label", "Edit lesson");
    await fillSubject(page, "English");
    await dialog.getByRole("button", { name: "Save lesson" }).click();
    await expect(page.getByRole("button", { name: "Edit English, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });

    // THE PROPERTY, checked in the database rather than on screen: the unique
    // index on (user_id, week_start, day, period) is what makes this safe, and
    // a grid showing one row while the table holds two is exactly the bug it
    // exists to prevent.
    const rows = await listLessons(teacher, week);
    const inSlot = rows.filter((r) => r.day === "mon" && r.period === 0);
    expect(inSlot).toHaveLength(1);
    expect(inSlot[0]!.subject).toBe("English");
  });

  test("adding a lesson does not ask for a topic, editing one does", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    // Laying out a week is a fast pass over subjects and year groups. The topic
    // is the one thing a teacher cannot answer at that moment.
    await page.getByRole("button", { name: "Add a lesson, Monday, 9:00" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-label", "Add a lesson");
    await expect(dialog.locator("#slot-topic")).toHaveCount(0);
    await expect(dialog.locator("#slot-subject")).toBeVisible();
    await expect(dialog.locator("#slot-year")).toBeVisible();

    await fillSubject(page, "Maths");
    await dialog.getByRole("button", { name: "Add lesson" }).click();
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });

    // THE OTHER HALF: the field must still exist on an edit, because that is
    // where both prompts for a topic land. makeItHref returns null without one,
    // so a topic that could never be typed would strand every lesson on
    // "Add a topic first" with nowhere to go.
    await page.getByRole("button", { name: "Edit Maths, Monday, 9:00" }).click();
    await expect(dialog).toHaveAttribute("aria-label", "Edit lesson");
    await expect(dialog.locator("#slot-topic")).toBeVisible();
  });

  test("deleting a lesson says so, and empties the slot", async ({ page }) => {
    await seedLesson(teacher, { weekStart: week, day: "mon", period: 0, subject: "Maths" });

    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    await page.getByRole("button", { name: "Edit Maths, Monday, 9:00" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    // The live region is the only confirmation a screen reader gets, so it is
    // worth pinning by its role. Filtered rather than taken bare: an
    // announcement banner elsewhere in the shell is also role=status, and which
    // of the two comes first in the DOM is not this test's business.
    await expect(
      page.locator("[role=status]").filter({ hasText: "Lesson removed from this week." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a lesson, Monday, 9:00" })).toBeVisible();
    expect(await listLessons(teacher, week)).toHaveLength(0);
  });

  test("deleting an attached resource leaves the lesson standing", async ({ page }) => {
    const resourceId = await seedResource(teacher, "Fractions plan");
    await seedLesson(teacher, {
      weekStart: week,
      day: "mon",
      period: 0,
      subject: "Maths",
      topic: "Fractions",
      resourceId,
    });

    // The teacher deletes the resource from their library.
    const { error } = await admin.from("tool_runs").delete().eq("id", resourceId);
    expect(error).toBeNull();

    await signIn(page, teacher);
    await page.goto("/timetable");

    // THE PROPERTY: resource_id is `on delete set null`, never cascade. A
    // migration that switched it to cascade would silently eat lessons, and
    // nothing in the interface would explain where the teacher's week went.
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Edit Maths, Monday, 9:00" }).click();
    await expect(page.getByRole("dialog").locator("#slot-resource")).toHaveValue("");

    const rows = await listLessons(teacher, week);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resource_id).toBeNull();
  });
});

test.describe("The rows of the week", () => {
  let teacher: TestTeacher;
  const week = mondayOf();

  test.beforeEach(async () => {
    teacher = await createTeacher("Tess");
    await seedPattern(teacher, { yearGroup: "Year 4" });
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("a row can be renamed, and the grid follows", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    await page.getByRole("button", { name: "Edit rows" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // THE REQUEST: a row is a label, not a time. A teacher who thinks in
    // "Period 2" should be able to say so.
    const field = dialog.getByLabel("Period 2 label");
    await field.fill("Period 2");
    await expect(field).toHaveValue("Period 2");
    await dialog.getByRole("button", { name: "Save rows" }).click();

    // The grid's empty cells are labelled by their period, so this is the label
    // reaching the thing the teacher actually looks at.
    await expect(page.getByRole("button", { name: "Add a lesson, Monday, Period 2" })).toBeVisible({
      timeout: 30_000,
    });

    const { data } = await admin
      .from("timetable_pattern")
      .select("periods")
      .eq("user_id", teacher.id)
      .single();
    expect((data!.periods as string[])[1]).toBe("Period 2");
  });

  test("a row left blank falls back to its default", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    await page.getByRole("button", { name: "Edit rows" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Period 1 label").fill("");
    await dialog.getByRole("button", { name: "Save rows" }).click();

    // An empty label would leave a column heading that says nothing and, on
    // mobile, a cell that cannot say which slot it fills.
    await expect(page.getByRole("button", { name: "Add a lesson, Monday, 9:00" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a row can be added", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);

    await page.getByRole("button", { name: "Edit rows" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add a row" }).click();
    await dialog.getByLabel("Period 5 label").fill("After school");
    await dialog.getByRole("button", { name: "Save rows" }).click();

    await expect(
      page.getByRole("button", { name: "Add a lesson, Monday, After school" }),
    ).toBeVisible({ timeout: 30_000 });

    const { data } = await admin
      .from("timetable_pattern")
      .select("periods")
      .eq("user_id", teacher.id)
      .single();
    expect(data!.periods as string[]).toHaveLength(5);
  });

  test("removing an occupied row takes its lessons and shifts the rest up", async ({ page }) => {
    await seedLesson(teacher, { weekStart: week, day: "mon", period: 0, subject: "Maths" });
    await seedLesson(teacher, { weekStart: week, day: "mon", period: 1, subject: "English" });

    await signIn(page, teacher);
    await page.goto("/timetable");
    await waitForGrid(page);
    await expect(page.getByRole("button", { name: "Edit Maths, Monday, 9:00" })).toBeVisible();

    await page.getByRole("button", { name: "Edit rows" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Remove period 1" }).click();

    // A row with lessons in it is a conversation, not a silent delete. The
    // migration leaves `period` unconstrained precisely so the client can ask.
    await expect(dialog.getByText(/It has 1 lesson in it this week/)).toBeVisible();
    await dialog.getByRole("button", { name: "Remove row" }).click();
    await dialog.getByRole("button", { name: "Save rows" }).click();

    // English moves up into row 0, and row 0 is now labelled "11:00": removing
    // the first row takes its LABEL with it as well as its lessons, so the
    // surviving row keeps the name it always had rather than inheriting "9:00".
    // The lesson moved; the label did not.
    await expect(page.getByRole("button", { name: "Edit English, Monday, 11:00" })).toBeVisible({
      timeout: 30_000,
    });

    /*
     * WAIT FOR THE SAVE TO ANNOUNCE ITSELF before reading the database.
     *
     * The cell above appears as soon as the grid re-renders, which happens while
     * the renumber is still in flight: saveRows deletes, then shifts every row
     * below up, then saves the pattern. Reading straight after the cell appears
     * races the last of those writes, and the page is torn down mid-request, so
     * the PATCH is ABORTED. It shows up as a lesson stranded at its old period
     * with no error anywhere, which reads exactly like a broken renumber rather
     * than a test that did not wait. Cost most of an afternoon.
     *
     * The status line is the honest signal: saveRows sets it last, after every
     * write has resolved.
     */
    await expect(
      page.locator("[role=status]").filter({ hasText: "Rows saved." }),
    ).toBeVisible({ timeout: 30_000 });

    const rows = await listLessons(teacher, week);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe("English");
    expect(rows[0]!.period).toBe(0);
  });
});

test.describe("What the timetable puts on Today", () => {
  let teacher: TestTeacher;
  const week = mondayOf();
  const day = upcomingDay();

  test.beforeEach(async () => {
    teacher = await createTeacher("Tess");
  });

  test.afterEach(async () => {
    await deleteTeacher(teacher);
  });

  test("no timetable at all offers to set one up", async ({ page }) => {
    await signIn(page, teacher);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
    await expect(page.getByText("Your week goes here")).toBeVisible();
    await expect(page.getByRole("link", { name: "Set up your timetable" })).toBeVisible();
  });

  test("a lesson with nothing made offers Make it, and Today never writes", async ({ page }) => {
    // At the weekend every day of the current week is behind us, so Today has
    // nothing upcoming to show and there is no version of this assertion to
    // make. Skipped rather than quietly rewritten into a weaker test.
    test.skip(day === null, "No upcoming teaching day at the weekend.");

    await seedPattern(teacher, { yearGroup: "Year 4" });
    await seedLesson(teacher, {
      weekStart: week,
      day: day!,
      period: 0,
      subject: "Maths",
      topic: "Fractions",
      yearGroup: "Year 4",
    });

    await signIn(page, teacher);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
    await expect(page.getByText("Year 4 Maths, Fractions")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Nothing made yet", { exact: true }).first()).toBeVisible();
    // A topic is present, so the honest offer is Make it rather than Add a topic.
    await expect(page.getByRole("link", { name: "Make it" }).first()).toBeVisible();

    // THE PROPERTY, and the reason this test exists: TodayView calls listWeek
    // and must never call openWeek. Materialising a week from the dashboard
    // would mean a teacher who only ever looks at Today silently accrues week
    // receipts, and a lesson they deleted comes back the moment they open the
    // timetable, because the receipt says the week is already built.
    expect(await weekExists(teacher, week)).toBe(false);
  });

  test("a lesson with no topic offers the topic instead of a broken prefill", async ({ page }) => {
    test.skip(day === null, "No upcoming teaching day at the weekend.");

    await seedPattern(teacher, { yearGroup: "Year 4" });
    await seedLesson(teacher, {
      weekStart: week,
      day: day!,
      period: 0,
      subject: "Maths",
      yearGroup: "Year 4",
    });

    await signIn(page, teacher);
    await page.goto("/dashboard");

    // makeItHref returns null without a topic, because Lesson Plan requires
    // one. A link claiming to be prefilled that is not is worse than no link.
    await expect(page.getByRole("link", { name: "Add a topic" }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("link", { name: "Make it" })).toHaveCount(0);
  });
});
