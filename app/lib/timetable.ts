import { createClient } from "@/app/lib/auth/client";
import { validatePrefill, prefillHref } from "@/app/lib/toolPrefill";

// The teacher's teaching week. Persisted to timetable_pattern, timetable_weeks
// and timetable_lessons (see supabase/migrations/20260903000000_timetable.sql).
// Uses the auth browser client so RLS scopes every query to the signed-in user.
//
// Lessons are dated: a row belongs to one week, and a topic or an attached
// resource belongs with it. The recurring pattern the setup wizard captures is
// a seed for building a week that does not exist yet, and nothing on the render
// path ever reads it. The migration's header explains why at length.

/**
 * The five columns of the grid, in order.
 *
 * KEEP THE KEYS IN STEP WITH `timetable_days()` in the migration, which
 * whitelists them for the CHECK constraint. A key added here but not there is
 * rejected on insert; a key removed here but left there renders nowhere.
 *
 * `short` is the column heading, `long` is used in prose ("on Friday") and in
 * the lesson chooser, where "Mon, 9:00, Maths" reads worse than the full word.
 */
export const TIMETABLE_DAYS = [
  { key: "mon", short: "Mon", long: "Monday" },
  { key: "tue", short: "Tue", long: "Tuesday" },
  { key: "wed", short: "Wed", long: "Wednesday" },
  { key: "thu", short: "Thu", long: "Thursday" },
  { key: "fri", short: "Fri", long: "Friday" },
] as const;

export type TimetableDay = (typeof TIMETABLE_DAYS)[number]["key"];

/**
 * The prototype's school day, and the wizard's starting point.
 *
 * DUPLICATED IN TWO OTHER PLACES that must stay in step: the column default in
 * the migration (20260903000000_timetable.sql) and seedPattern in
 * tests/support/users.ts. Neither is enforced, so a change here is a change in
 * three files.
 */
export const DEFAULT_PERIODS = ["9:00", "11:00", "13:15", "14:45"];

/**
 * What a row is called when the teacher has not named it.
 *
 * A period label is free text: the teacher may keep the time, rename it to
 * "Period 2" or "Form time", or leave it blank. Blank is the interesting case,
 * because an empty left-hand column labels nothing and an empty inline label on
 * mobile leaves a cell that cannot say which slot it fills.
 *
 * Beyond the fourth row there is no default time to fall back to, so the
 * position is the honest answer. The column allows ten rows and DEFAULT_PERIODS
 * has four, so rows five to ten reach the second branch every time.
 */
export function periodLabel(periods: string[], index: number): string {
  return periods[index]?.trim() || DEFAULT_PERIODS[index] || `Period ${index + 1}`;
}

/** Index of a day in the week, which is also its grid column. */
export function dayIndex(day: TimetableDay): number {
  return TIMETABLE_DAYS.findIndex((d) => d.key === day);
}

export function dayName(day: TimetableDay): string {
  return TIMETABLE_DAYS.find((d) => d.key === day)?.long ?? "";
}

export interface PatternSlot {
  day: TimetableDay;
  period: number;
  subject: string;
}

export interface TimetablePattern {
  user_id: string;
  periods: string[];
  year_group: string | null;
  slots: PatternSlot[];
  created_at: string;
}

export interface TimetableLesson {
  id: string;
  week_start: string;
  day: TimetableDay;
  /** Index into the pattern's `periods`, never a time to be parsed. */
  period: number;
  subject: string;
  topic: string | null;
  year_group: string | null;
  resource_id: string | null;
  created_at: string;
}

/** A lesson with the resource attached to it, which is what a cell renders. */
export interface LessonWithResource extends TimetableLesson {
  resource: { id: string; title: string | null; tool_slug: string } | null;
}

/* ── Dates ───────────────────────────────────────────────────────────────────
 *
 * Pure, no network. A week is identified by the ISO date of its Monday, in the
 * teacher's own local time, and that string is the key for every read, write
 * and constraint. The migration enforces `isodow = 1` on both tables that store
 * one, so a bug here fails loudly at the insert rather than quietly filing rows
 * into a week the grid will never ask for.
 *
 * Deliberately built from local date parts rather than toISOString(), which
 * converts to UTC first: at 00:30 on a Monday in British Summer Time that would
 * hand back the previous Sunday, and the whole week would shift by one.
 */

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a yyyy-mm-dd into a local midnight Date. */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** The Monday of the week containing `date`, as yyyy-mm-dd. */
export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 for Sunday, so Sunday belongs to the week that started six
  // days ago rather than the one starting tomorrow.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return isoDate(d);
}

/** Move a week key forward or back. Crosses months and years by construction. */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = fromIso(weekStart);
  d.setDate(d.getDate() + weeks * 7);
  return isoDate(d);
}

/** The date a given day of a given week falls on. */
export function dateOfSlot(weekStart: string, day: TimetableDay): Date {
  const d = fromIso(weekStart);
  d.setDate(d.getDate() + dayIndex(day));
  return d;
}

/** "Week beginning 25 August", the prototype's header line. */
export function weekBeginningLabel(weekStart: string): string {
  const d = fromIso(weekStart);
  return `Week beginning ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

/** Whether a slot has already been and gone, to the day. */
export function isPastDay(weekStart: string, day: TimetableDay, now: Date): boolean {
  const slot = dateOfSlot(weekStart, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return slot < today;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/**
 * The teacher's pattern, or null if the wizard has never been finished.
 *
 * Null is what the Timetable page checks to decide between the wizard and the
 * grid. Skipping the wizard still writes a row, with empty slots, so a teacher
 * is asked once and never again.
 */
export async function getPattern(): Promise<TimetablePattern | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("timetable_pattern").select("*").maybeSingle();
  if (error) throw error;
  return (data as TimetablePattern | null) ?? null;
}

const LESSON_SELECT = "*, resource:tool_runs(id, title, tool_slug)";

/**
 * Read one week. NEVER WRITES.
 *
 * This is what Today calls. Materialising from Today would mean a teacher who
 * has not opened the Timetable yet quietly acquires a week of lessons by
 * visiting the dashboard, so the write lives in openWeek and nowhere else.
 */
export async function listWeek(weekStart: string): Promise<LessonWithResource[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("timetable_lessons")
    .select(LESSON_SELECT)
    .eq("week_start", weekStart);
  if (error) throw error;
  return sortLessons((data ?? []) as LessonWithResource[]);
}

/** Grid order: down the days, then through the periods. */
function sortLessons(rows: LessonWithResource[]): LessonWithResource[] {
  return [...rows].sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.period - b.period);
}

/**
 * Open a week: materialise it if this is the first visit, then read it. WRITES.
 *
 * Called from exactly one place, the Timetable page's week-change handler. See
 * listWeek for why.
 *
 * Materialisation is gated on the timetable_weeks receipt rather than on "this
 * week looks empty", which is what makes a deleted lesson stay deleted. Copying
 * takes `subject` and `year_group` only: a topic and a resource belong to the
 * week they were chosen for.
 *
 * Safe to run twice. The unique index on (user_id, week_start, day, period)
 * means a concurrent second run inserts nothing rather than doubling the grid,
 * so no lock is needed for a double click or StrictMode's double mount.
 */
export async function openWeek(weekStart: string): Promise<LessonWithResource[]> {
  const supabase = createClient();

  const { data: receipt, error: receiptError } = await supabase
    .from("timetable_weeks")
    .select("week_start")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (receiptError) throw receiptError;

  if (!receipt) {
    const seed = await seedFor(weekStart);
    if (seed.length > 0) {
      const { error } = await supabase
        .from("timetable_lessons")
        .upsert(
          seed.map((s) => ({ ...s, week_start: weekStart })),
          { onConflict: "user_id,week_start,day,period", ignoreDuplicates: true },
        );
      if (error) throw error;
    }
    // After the lessons, so a failure part way through leaves the week without
    // a receipt and the next visit tries again, rather than marking it done and
    // stranding the teacher with half a week.
    const { error: markError } = await supabase
      .from("timetable_weeks")
      .upsert({ week_start: weekStart }, { onConflict: "user_id,week_start", ignoreDuplicates: true });
    if (markError) throw markError;
  }

  return listWeek(weekStart);
}

/** What a new week is built from: the most recent earlier week, else the pattern. */
async function seedFor(
  weekStart: string,
): Promise<Array<{ day: TimetableDay; period: number; subject: string; year_group: string | null }>> {
  const supabase = createClient();

  const { data: previous, error } = await supabase
    .from("timetable_weeks")
    .select("week_start")
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (previous) {
    const rows = await listWeek((previous as { week_start: string }).week_start);
    return rows.map((l) => ({
      day: l.day,
      period: l.period,
      subject: l.subject,
      year_group: l.year_group,
    }));
  }

  const pattern = await getPattern();
  if (!pattern) return [];
  return pattern.slots.map((s) => ({
    day: s.day,
    period: s.period,
    subject: s.subject,
    year_group: pattern.year_group,
  }));
}

/* ── Writes ────────────────────────────────────────────────────────────────── */

/** Create or replace the pattern. The wizard's only write to this table. */
export async function savePattern(p: {
  periods: string[];
  yearGroup: string | null;
  slots: PatternSlot[];
}): Promise<TimetablePattern> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("timetable_pattern")
    .upsert(
      {
        periods: p.periods.map((x) => x.trim()).filter(Boolean),
        year_group: p.yearGroup,
        slots: p.slots,
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as TimetablePattern;
}

export async function addLesson(l: {
  weekStart: string;
  day: TimetableDay;
  period: number;
  subject: string;
  topic?: string | null;
  yearGroup?: string | null;
}): Promise<TimetableLesson> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("timetable_lessons")
    .insert({
      week_start: l.weekStart,
      day: l.day,
      period: l.period,
      // Trimmed here as well as checked in the constraint: the constraint
      // rejects a blank subject, this stops a merely untidy one being stored.
      subject: l.subject.trim(),
      topic: l.topic?.trim() || null,
      year_group: l.yearGroup?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as TimetableLesson;
}

export async function updateLesson(
  id: string,
  patch: { subject?: string; topic?: string | null; year_group?: string | null },
): Promise<void> {
  const supabase = createClient();
  const clean: Record<string, string | null> = {};
  if (patch.subject !== undefined) clean.subject = patch.subject.trim();
  if (patch.topic !== undefined) clean.topic = patch.topic?.trim() || null;
  if (patch.year_group !== undefined) clean.year_group = patch.year_group?.trim() || null;
  const { error } = await supabase.from("timetable_lessons").update(clean).eq("id", id);
  if (error) throw error;
}

/** Attach a resource to a lesson, or pass null to take it off again. */
export async function attachResource(lessonId: string, runId: string | null): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("timetable_lessons")
    .update({ resource_id: runId })
    .eq("id", lessonId);
  if (error) throw error;
}

/**
 * Delete a lesson. The attached resource is NOT deleted: it lives in the
 * Library and cost credits to make. Removing it from the week is all this does.
 */
export async function deleteLesson(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("timetable_lessons").delete().eq("id", id);
  if (error) throw error;
}

/** How many lessons sit in a period, for the count the remove-row confirm shows. */
export function lessonsInPeriod(lessons: TimetableLesson[], period: number): TimetableLesson[] {
  return lessons.filter((l) => l.period === period);
}

/**
 * Empty one row of one week. Used when a teacher removes a period that still
 * has lessons in it, after they have confirmed the count.
 */
export async function deleteLessonsInPeriod(weekStart: string, period: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("timetable_lessons")
    .delete()
    .eq("week_start", weekStart)
    .eq("period", period);
  if (error) throw error;
}

/**
 * Close the gap a removed row leaves: every lesson below it moves up one.
 *
 * WRITTEN DESCENDING, LOWEST INDEX LAST, and that ordering is the whole reason
 * this is a loop rather than one update. `period` is part of the unique index on
 * (user_id, week_start, day, period), so moving period 3 down to 2 while 2 is
 * still occupied collides. Going from the top down means the destination has
 * always just been vacated.
 *
 * Postgres checks a unique index per statement, not per transaction, so a single
 * `period = period - 1` over the whole range would trip on the first row it
 * moved. Hence one update per period, in order.
 */
export async function renumberLessonsAbove(weekStart: string, removed: number): Promise<void> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("timetable_lessons")
    .select("period")
    .eq("week_start", weekStart)
    .gt("period", removed);
  if (error) throw error;

  // Which rows actually need moving, nearest the gap first.
  const rows = [...new Set(((data ?? []) as Array<{ period: number }>).map((r) => r.period))].sort(
    (a, b) => a - b,
  );

  for (const period of rows) {
    const { data: moved, error: moveError } = await supabase
      .from("timetable_lessons")
      .update({ period: period - 1 })
      .eq("week_start", weekStart)
      .eq("period", period)
      // Selected back deliberately. An update that matches nothing is not an
      // error in PostgREST: it returns cleanly having done nothing at all, which
      // is indistinguishable from success and leaves a lesson stranded in a row
      // the grid no longer draws. Asking for the rows back is the only way this
      // failure mode is visible.
      .select("id");
    if (moveError) throw moveError;
    if (!moved || moved.length === 0) {
      throw new Error(`Could not move lessons out of period ${period}.`);
    }
  }
}

/* ── Derivations, shared by the grid and Today ─────────────────────────────── */

/**
 * The next lesson with nothing made for it, in grid order, ignoring days that
 * have already been. Null when the week is planned, or empty.
 *
 * Ordering is by day index then period index. Never by comparing the period
 * labels, which are strings: "9:00" sorts after "13:15".
 */
export function nextUnplanned(
  lessons: LessonWithResource[],
  weekStart: string,
  now: Date,
): LessonWithResource | null {
  return (
    sortLessons(lessons).find(
      (l) => !l.resource_id && !isPastDay(weekStart, l.day, now),
    ) ?? null
  );
}

export interface DaySummary {
  day: TimetableDay;
  date: Date;
  isToday: boolean;
  /** The day's headline lesson, which is its first period with something in it. */
  lesson: LessonWithResource;
  /** How many more lessons that day has, for the "and 2 more" line. */
  others: number;
}

/**
 * The rows for Today's "This week" panel: the next few days that have a lesson,
 * one row each, headed by that day's first lesson.
 *
 * Days already past are dropped, and a day with no lessons is not a row rather
 * than a row saying nothing is on. A week with nothing in it returns an empty
 * array and the caller keeps its empty state.
 */
export function upcomingDays(
  lessons: LessonWithResource[],
  weekStart: string,
  now: Date,
  limit = 4,
): DaySummary[] {
  const today = mondayOf(now) === weekStart ? isoDate(now) : null;
  const out: DaySummary[] = [];

  for (const { key } of TIMETABLE_DAYS) {
    if (out.length >= limit) break;
    if (isPastDay(weekStart, key, now)) continue;
    const onDay = sortLessons(lessons.filter((l) => l.day === key));
    const first = onDay[0];
    if (!first) continue;
    const date = dateOfSlot(weekStart, key);
    out.push({
      day: key,
      date,
      isToday: today !== null && isoDate(date) === today,
      lesson: first,
      others: onDay.length - 1,
    });
  }

  return out;
}

/**
 * The "Make it" target for a lesson.
 *
 * Lesson Plan is the tool a bare timetable lesson maps to: its required fields
 * are exactly subject and topic, which is precisely what a lesson has.
 *
 * Returns NULL when there is no topic, and that is the common case rather than
 * an edge one. A freshly seeded week has every topic blank, so on the day the
 * wizard runs nothing can offer Make it, and the caller must send the teacher
 * to fill the topic in instead. A form that claims to be prefilled and is not
 * is worse than no link at all, which is the same judgement validatePrefill
 * makes when it rejects a payload missing a required field.
 */
export function makeItHref(lesson: TimetableLesson): string | null {
  const topic = lesson.topic?.trim();
  if (!topic) return null;
  const prefill = validatePrefill({
    slug: "lesson-planner",
    fields: {
      subject: lesson.subject,
      topic,
      // Dropped silently by validatePrefill if it is not one of YEAR_GROUPS.
      // Harmless: it is not a required field.
      ...(lesson.year_group ? { yearGroup: lesson.year_group } : {}),
    },
  });
  return prefill ? prefillHref(prefill) : null;
}
