"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CaretLeft,
  CaretRight,
  CalendarPlus,
  Plus,
  Rows,
  CalendarBlank,
  Folder as FolderIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useAppShell } from "@/app/components/v2/AppShellContext";
import { ToolTile } from "@/app/components/v2/Squircle";
import { listRecentRuns, type ToolRun } from "@/app/lib/toolRuns";
import { listFolders, folderSwatch, type Folder } from "@/app/lib/folders";
import { v2ToolForSlug, toolSolid } from "@/app/lib/tools";
import { typeLabel, formatDate } from "@/app/lib/toolRunDisplay";
import {
  TIMETABLE_DAYS,
  DEFAULT_PERIODS,
  getPattern,
  openWeek,
  savePattern,
  addLesson,
  updateLesson,
  attachResource,
  deleteLesson,
  deleteLessonsInPeriod,
  renumberLessonsAbove,
  lessonsInPeriod,
  periodLabel,
  mondayOf,
  shiftWeek,
  dateOfSlot,
  weekBeginningLabel,
  dayName,
  makeItHref,
  type LessonWithResource,
  type TimetableDay,
  type TimetablePattern,
  type PatternSlot,
} from "@/app/lib/timetable";
import SetupWizard from "./SetupWizard";
import SlotEditor, { type SlotTarget, type SlotDraft } from "./SlotEditor";
import PeriodEditor, { type PeriodPlan } from "./PeriodEditor";
import app from "@/app/components/v2/app.module.css";
import styles from "./timetable.module.css";

/*
 * Timetable.
 *
 * Lessons are dated: this week's Maths is a different row from next week's, and
 * a topic or an attached resource belongs to the week it was chosen for. See
 * app/lib/timetable.ts and supabase/migrations/20260903000000_timetable.sql for
 * why that beat a recurring skeleton with per-week overrides.
 *
 * Import timetable is deliberately absent. The prototype has the button; it is
 * a separate piece of work with its own parsing and mapping questions, and a
 * button that opens nothing is worse than no button.
 *
 * Attaching is drag and drop, as the prototype has it, AND a select in the slot
 * editor. The select is not a fallback for a browser that cannot drag: it is the
 * only route that works from a keyboard, and this screen would otherwise put
 * attaching out of reach entirely. Same rule the Library set with Move to
 * folder.
 */

/** Everything, filed or not. The same sentinel the Library uses. */
const ALL = "all";

export default function TimetablePage() {
  useAppShell({ title: "Timetable" });

  const [pattern, setPattern] = useState<TimetablePattern | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [week, setWeek] = useState<string | null>(null);
  const [lessons, setLessons] = useState<LessonWithResource[]>([]);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [editingRows, setEditingRows] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /*
   * Which resources the strip is showing.
   *
   * Same three-state selection the Library uses, and the same meanings, so the
   * two screens agree: a folder id, ALL for everything, and null for the
   * unfiled pile. Local state rather than the URL, unlike the Library, because
   * here it is a filter on a supporting strip rather than the thing the page is
   * about, and the week in the URL would be the more useful thing to put there.
   */
  const [picked, setPicked] = useState<string | null>(ALL);

  /* The strip shows eight until asked for the rest. Eight is what fits beside
     the week without the page turning into a file list, and a teacher who is
     hunting for something specific has the Library for that. */
  const [expanded, setExpanded] = useState(false);

  const periods = pattern?.periods?.length ? pattern.periods : DEFAULT_PERIODS;

  /* First load. The week is resolved from the browser's clock, so it is
     established here rather than in initial state: a value computed during
     render would differ between the server pass and the client one. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        /* 1,000 is the Library's ceiling, and the strip filters by folder, so
           it needs the same reach: a folder's contents cannot be shown from
           the 50 most recent runs. */
        const [p, r, f] = await Promise.all([
          getPattern(),
          listRecentRuns(1000),
          listFolders(),
        ]);
        if (cancelled) return;
        setRuns(r);
        setFolders(f);
        setPattern(p);
        if (!p) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }
        const thisWeek = mondayOf(new Date());
        setWeek(thisWeek);
        setLessons(await openWeek(thisWeek));
      } catch {
        if (!cancelled) setStatus({ text: "Your timetable could not be loaded. Try again.", error: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Move to another week. This is the ONLY caller of openWeek, which writes:
     a week is materialised when the teacher goes to it and at no other time. */
  const goToWeek = useCallback(async (next: string) => {
    setWeek(next);
    setLoading(true);
    setStatus(null);
    try {
      setLessons(await openWeek(next));
    } catch {
      setStatus({ text: "That week could not be opened. Try again.", error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  const finishSetup = useCallback(
    async (p: { periods: string[]; yearGroup: string | null; slots: PatternSlot[] }) => {
      setSaving(true);
      setStatus(null);
      try {
        const saved = await savePattern(p);
        setPattern(saved);
        const thisWeek = mondayOf(new Date());
        setWeek(thisWeek);
        setLessons(await openWeek(thisWeek));
        setNeedsSetup(false);
      } catch {
        setStatus({ text: "That could not be saved. Try again.", error: true });
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /* Save from the slot editor: an insert for an empty slot, an update for a
     lesson that exists. Both are pessimistic. An insert has no id to show
     optimistically, and an edit that appeared to save and then reverted reads
     worse on a form the teacher is still looking at than a moment's wait. */
  const saveSlot = useCallback(
    async (draft: SlotDraft) => {
      if (!week || !target) return;
      setSaving(true);
      setStatus(null);
      try {
        if (target.lesson) {
          const id = target.lesson.id;
          await updateLesson(id, {
            subject: draft.subject,
            topic: draft.topic,
            year_group: draft.yearGroup || null,
          });
          if (draft.resourceId !== (target.lesson.resource_id ?? null)) {
            await attachResource(id, draft.resourceId);
          }
          const run = runs.find((r) => r.id === draft.resourceId) ?? null;
          setLessons((prev) =>
            prev.map((l) =>
              l.id === id
                ? {
                    ...l,
                    subject: draft.subject.trim(),
                    topic: draft.topic.trim() || null,
                    year_group: draft.yearGroup || null,
                    resource_id: draft.resourceId,
                    resource: run
                      ? { id: run.id, title: run.title, tool_slug: run.tool_slug }
                      : null,
                  }
                : l,
            ),
          );
        } else {
          const created = await addLesson({
            weekStart: week,
            day: target.day,
            period: target.period,
            subject: draft.subject,
            topic: draft.topic,
            yearGroup: draft.yearGroup || null,
          });
          setLessons((prev) => [...prev, { ...created, resource: null }]);
        }
        setTarget(null);
      } catch {
        setStatus({ text: "That lesson could not be saved. Try again.", error: true });
      } finally {
        setSaving(false);
      }
    },
    [week, target, runs],
  );

  /* Deletes await first and are never optimistic: a row removed and then put
     back on the next load is worse than a moment's wait. Same as the Library. */
  const removeSlot = useCallback(async () => {
    if (!target?.lesson) return;
    const id = target.lesson.id;
    setSaving(true);
    setStatus(null);
    try {
      await deleteLesson(id);
      setLessons((prev) => prev.filter((l) => l.id !== id));
      setTarget(null);
      setStatus({ text: "Lesson removed from this week.", error: false });
    } catch {
      setStatus({ text: "That lesson could not be removed. Try again.", error: true });
    } finally {
      setSaving(false);
    }
  }, [target]);

  /*
   * Save the rows of the week.
   *
   * Removals first, and DESCENDING, which is the part that has to be right. Each
   * removal empties its row and then shifts everything below it up one, so doing
   * the lowest index first would renumber the rows the later removals are still
   * named after. Going from the bottom up means an index that has not been
   * handled yet still means what it meant when the modal was open.
   *
   * Pessimistic throughout. A period list that appeared to save and then snapped
   * back would leave the teacher unsure which week they are looking at, and the
   * lessons being deleted underneath it make that worse, not better.
   */
  const saveRows = useCallback(
    async (plan: PeriodPlan) => {
      if (!week || !pattern) return;
      setSaving(true);
      setStatus(null);
      try {
        let removedLessons = 0;
        for (const period of [...plan.removed].sort((a, b) => b - a)) {
          removedLessons += lessonsInPeriod(lessons, period).length;
          await deleteLessonsInPeriod(week, period);
          await renumberLessonsAbove(week, period);
        }

        const saved = await savePattern({
          periods: plan.periods,
          // The wizard owns these two. Carried through untouched so saving rows
          // cannot quietly discard the year group or the seed behind them.
          yearGroup: pattern.year_group,
          slots: pattern.slots,
        });
        setPattern(saved);
        setLessons(await openWeek(week));
        setEditingRows(false);
        setStatus({
          text:
            removedLessons > 0
              ? `Rows saved. ${removedLessons} ${removedLessons === 1 ? "lesson" : "lessons"} removed from this week.`
              : "Rows saved.",
          error: false,
        });
      } catch {
        setStatus({ text: "Those rows could not be saved. Try again.", error: true });
      } finally {
        setSaving(false);
      }
    },
    [week, pattern, lessons],
  );

  /* Stable identities for the period modal's props.
     ModalShell keeps a keydown listener and restores focus on teardown, so a
     prop that changes identity on every render churns that effect while the
     modal is open. saveRows sets state several times with awaited writes in
     flight, which is exactly when that must not happen. */
  const closeRows = useCallback(() => setEditingRows(false), []);
  const countInPeriod = useCallback(
    (period: number) => lessonsInPeriod(lessons, period).length,
    [lessons],
  );

  /* Attaching, from a drop or from the strip's chooser. Optimistic, in the
     house pattern: capture before, set, await, roll back on failure. */
  const attach = useCallback(
    async (lessonId: string, runId: string | null) => {
      const before = lessons.find((l) => l.id === lessonId);
      if (!before || (before.resource_id ?? null) === runId) return;
      const run = runs.find((r) => r.id === runId) ?? null;

      setLessons((prev) =>
        prev.map((l) =>
          l.id === lessonId
            ? {
                ...l,
                resource_id: runId,
                resource: run ? { id: run.id, title: run.title, tool_slug: run.tool_slug } : null,
              }
            : l,
        ),
      );
      setStatus(null);

      try {
        await attachResource(lessonId, runId);
        // Announced, not just drawn. A chip appearing in a cell is invisible to
        // a screen reader, so the live region says what happened.
        const name = run?.title?.trim() || (run && v2ToolForSlug(run.tool_slug)?.name) || "Nothing";
        setStatus({
          text: runId
            ? `${name} is now on ${before.subject}, ${dayName(before.day)}.`
            : `Took the resource off ${before.subject}, ${dayName(before.day)}.`,
          error: false,
        });
      } catch {
        setLessons((prev) =>
          prev.map((l) =>
            l.id === lessonId
              ? { ...l, resource_id: before.resource_id, resource: before.resource }
              : l,
          ),
        );
        setStatus({ text: "That resource could not be attached. Try again.", error: true });
      }
    },
    [lessons, runs],
  );

  const byCell = useMemo(() => {
    const map = new Map<string, LessonWithResource>();
    for (const l of lessons) map.set(`${l.day}-${l.period}`, l);
    return map;
  }, [lessons]);

  const today = mondayOf(new Date()) === week ? new Date().getDay() : -1;

  /* The resources the strip shows, under the current filter. Same rules as the
     Library: ALL is everything, a folder id is that folder, null is unfiled. */
  const visible = useMemo(() => {
    if (picked === ALL) return runs;
    if (picked === null) return runs.filter((r) => !r.folder_id);
    return runs.filter((r) => r.folder_id === picked);
  }, [runs, picked]);

  const countFor = useCallback(
    (id: string | null) => {
      if (id === ALL) return runs.length;
      if (id === null) return runs.filter((r) => !r.folder_id).length;
      return runs.filter((r) => r.folder_id === id).length;
    },
    [runs],
  );

  /* Picking a folder collapses the list again. Carrying an expanded view across
     a filter change means landing in a folder already scrolled to its end. */
  const pick = useCallback((id: string | null) => {
    setPicked(id);
    setExpanded(false);
  }, []);

  if (needsSetup) {
    return (
      <>
        <div className={app.hello}>
          <p className={app.helloWhen}>Set up</p>
          <h1>Timetable</h1>
          <p className={app.helloSub}>
            Tell Jooma what you teach and when. It takes a minute, and it is what puts your
            week on Today.
          </p>
        </div>
        <SetupWizard
          saving={saving}
          error={status?.error ? status.text : null}
          onFinish={finishSetup}
        />
      </>
    );
  }

  return (
    <>
      <div className={app.hello}>
        <p className={app.helloWhen}>{week ? weekBeginningLabel(week) : " "}</p>
        <h1>Timetable</h1>
        <p className={app.helloSub}>
          Your teaching week. Drag a resource onto any lesson, or click a slot to add one.
        </p>
      </div>

      <div className={styles.ttbar}>
        <button
          type="button"
          className={app.btn}
          onClick={() => week && goToWeek(shiftWeek(week, -1))}
          disabled={!week || loading}
        >
          <CaretLeft className={app.btnIcon} />
          Previous
        </button>
        <button
          type="button"
          className={app.btn}
          onClick={() => goToWeek(mondayOf(new Date()))}
          disabled={loading}
        >
          This week
        </button>
        <button
          type="button"
          className={app.btn}
          onClick={() => week && goToWeek(shiftWeek(week, 1))}
          disabled={!week || loading}
        >
          Next
          <CaretRight className={app.btnIcon} />
        </button>
        <button
          type="button"
          className={`${app.btn} ${styles.ttbarEnd}`}
          onClick={() => setEditingRows(true)}
          disabled={loading || !pattern}
        >
          <Rows className={app.btnIcon} />
          Edit rows
        </button>
        <button
          type="button"
          className={`${app.btn} ${app.btnP}`}
          onClick={() => setTarget(firstFreeSlot(byCell, periods))}
          disabled={loading}
        >
          <CalendarPlus className={app.btnIcon} />
          Add a lesson
        </button>
      </div>

      <div className={styles.ttgrid}>
        <div />
        {TIMETABLE_DAYS.map((d, i) => (
          <div
            key={d.key}
            className={`${styles.tthead} ${today === i + 1 ? styles.ttheadToday : ""}`}
          >
            {d.short}
            <b className={styles.ttheadDate}>
              {week ? dateOfSlot(week, d.key).getDate() : ""}
            </b>
          </div>
        ))}

        {periods.map((_, row) => (
          <PeriodRow
            key={row}
            label={periodLabel(periods, row)}
            row={row}
            byCell={byCell}
            dropOn={dropOn}
            onOpen={setTarget}
            onDropTarget={setDropOn}
            onDropRun={attach}
          />
        ))}
      </div>

      <p
        className={`${styles.status} ${status?.error ? styles.statusError : ""}`}
        role="status"
      >
        {status?.text ?? ""}
      </p>

      <div className={app.sh}>
        <div className={app.shTitle}>
          <h2>Your resources</h2>
          <span className={app.shSub}>Drag one onto a lesson</span>
        </div>
        <Link href="/folders" className={app.shLink}>
          Library
        </Link>
      </div>

      {/* The same folders as the Library, as filter chips rather than cards.
          A grid of cards below the week would compete with it for the eye, and
          this strip is a place to pick something up from, not to file into. */}
      {runs.length > 0 && (
        <div className={styles.folderBar}>
          <button
            type="button"
            onClick={() => pick(ALL)}
            className={`${app.chip} ${picked === ALL ? app.chipOn : ""}`}
          >
            All resources
            <span className={styles.folderCount}>{countFor(ALL)}</span>
          </button>

          {folders.map((f) => {
            const swatch = folderSwatch(f.colour);
            const on = picked === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => pick(f.id)}
                className={`${app.chip} ${on ? app.chipOn : ""}`}
              >
                <span
                  className={styles.folderDot}
                  style={{ background: on ? "currentColor" : swatch.solid }}
                />
                {f.name}
                <span className={styles.folderCount}>{countFor(f.id)}</span>
              </button>
            );
          })}

          {/* Unfiled is a permanent view, not a folder, exactly as in the
              Library: it is folder_id IS NULL rather than a row. Shown only
              when something is actually unfiled, since a chip reading 0 on a
              tidy account is noise. */}
          {countFor(null) > 0 && (
            <button
              type="button"
              onClick={() => pick(null)}
              className={`${app.chip} ${picked === null ? app.chipOn : ""}`}
            >
              Unfiled
              <span className={styles.folderCount}>{countFor(null)}</span>
            </button>
          )}
        </div>
      )}

      <div className={app.panel}>
        {runs.length === 0 ? (
          <div className={app.empty}>
            <span className={app.emptyIcon}>
              <CalendarBlank weight="fill" />
            </span>
            <p className={app.emptyTitle}>Nothing to attach yet</p>
            <p className={app.emptyBody}>
              Anything you make shows up here, ready to put on the lesson it belongs to.
            </p>
          </div>
        ) : visible.length === 0 ? (
          /* A folder that exists but is empty. Says which one rather than
             leaving a blank panel that reads as a bug. */
          <div className={app.empty}>
            <span className={app.emptyIcon}>
              <FolderIcon weight="fill" />
            </span>
            <p className={app.emptyTitle}>Nothing in here yet</p>
            <p className={app.emptyBody}>
              File something into this folder from the Library, or pick another one above.
            </p>
          </div>
        ) : (
          <div className={styles.strip}>
            {visible.slice(0, expanded ? visible.length : 8).map((r) => {
              const tool = v2ToolForSlug(r.tool_slug);
              return (
                <div
                  key={r.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", r.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(r.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropOn(null);
                  }}
                  className={`${styles.stripRow} ${dragging === r.id ? styles.stripDragging : ""}`}
                >
                  <ToolTile icon={tool?.icon ?? "file-text"} solid={toolSolid(tool)} size="sm" />
                  <span className={styles.stripMain}>
                    <span className={styles.stripTitle}>
                      {r.title?.trim() || tool?.name || "Untitled"}
                    </span>
                    <span className={styles.stripMeta}>
                      {typeLabel(r.tool_slug)}, {formatDate(r.created_at)}
                      {/* Which folder, but only when looking at everything:
                          inside a folder it would repeat the chip above. */}
                      {picked === ALL && r.folder_id
                        ? `, ${folders.find((f) => f.id === r.folder_id)?.name ?? "Filed"}`
                        : ""}
                    </span>
                  </span>
                  <LessonChooser lessons={lessons} periods={periods} onPick={(id) => attach(id, r.id)} />
                </div>
              );
            })}
          </div>
        )}

        {visible.length > 8 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={styles.stripMore}
          >
            {expanded ? "Show fewer" : `Show all ${visible.length}`}
          </button>
        )}
      </div>

      {target && (
        <SlotEditor
          target={target}
          periods={periods}
          runs={runs}
          defaultYearGroup={pattern?.year_group ?? null}
          onCancel={() => setTarget(null)}
          onSave={saveSlot}
          onDelete={removeSlot}
        />
      )}

      {editingRows && (
        <PeriodEditor
          periods={periods}
          saving={saving}
          /* Counted against the week on screen, which is the week the confirm
             is about: removing a row deletes the lessons in THIS week, not in
             every week the teacher has ever opened.

             Memoised, like closeRows below. An inline arrow here is a new prop
             on every render, and saveRows calls setState several times while
             its awaited writes are in flight. */
          countInPeriod={countInPeriod}
          onCancel={closeRows}
          onSave={saveRows}
        />
      )}
    </>
  );
}

/** One period's row: its label, then a cell per day. */
function PeriodRow({
  label,
  row,
  byCell,
  dropOn,
  onOpen,
  onDropTarget,
  onDropRun,
}: {
  label: string;
  row: number;
  byCell: Map<string, LessonWithResource>;
  dropOn: string | null;
  onOpen: (t: SlotTarget) => void;
  onDropTarget: (id: string | null) => void;
  onDropRun: (lessonId: string, runId: string) => void;
}) {
  return (
    <>
      <div className={styles.ttslot}>{label}</div>
      {TIMETABLE_DAYS.map((d) => {
        const lesson = byCell.get(`${d.key}-${row}`) ?? null;

        if (!lesson) {
          return (
            <button
              key={d.key}
              type="button"
              aria-label={`Add a lesson, ${d.long}, ${label}`}
              onClick={() => onOpen({ day: d.key, period: row, lesson: null })}
              className={`${styles.ttcell} ${styles.ttcellEmpty}`}
            >
              {/* Carries the period on mobile, where the left-hand column is
                  hidden and a bare plus would say nothing about which slot it
                  fills. Hidden on desktop, where the column says it already. */}
              <span className={styles.ttslotInline}>{label}</span>
              <Plus />
            </button>
          );
        }

        const tool = lesson.resource ? v2ToolForSlug(lesson.resource.tool_slug) : undefined;
        const href = makeItHref(lesson);

        /*
         * The cell is a div, not a button, and holds two actions.
         *
         * A lesson with nothing made offers Make it, which opens the tool with
         * the lesson filled in, and that is the whole point of the screen. The
         * cell also has to open the editor. Two actions cannot live in one
         * button, and a link nested inside a button is invalid markup that
         * browsers resolve differently, so the cell carries the drop handlers
         * and its children carry the clicks.
         */
        return (
          <div
            key={d.key}
            /* Without preventDefault the drop never fires: the default action
               for a dragover is "reject this". Same as the Library's folders. */
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDropTarget(lesson.id);
            }}
            onDragLeave={() => onDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              onDropTarget(null);
              const runId = e.dataTransfer.getData("text/plain");
              if (runId) onDropRun(lesson.id, runId);
            }}
            className={`${styles.ttcell} ${dropOn === lesson.id ? styles.ttcellDrop : ""}`}
          >
            <span className={styles.ttslotInline}>{label}</span>

            <button
              type="button"
              aria-label={`Edit ${lesson.subject}, ${d.long}, ${label}`}
              onClick={() =>
                onOpen({ day: d.key, period: row, lesson, focusTopic: !lesson.topic })
              }
              className={styles.lessonBtn}
            >
              <span className={styles.lesson}>
                <b className={styles.lessonSubject}>{lesson.subject}</b>
                {lesson.topic && <span className={styles.lessonTopic}>{lesson.topic}</span>}
              </span>
            </button>

            {lesson.resource ? (
              <span className={styles.attach}>
                <ToolTile icon={tool?.icon ?? "file-text"} solid={toolSolid(tool)} size="xs" />
                <span className={styles.attachName}>
                  {lesson.resource.title?.trim() || tool?.name || "Attached"}
                </span>
              </span>
            ) : href ? (
              /* Make it. The lesson has a topic, so the tool's required fields
                 can genuinely be filled. */
              <Link href={href} className={styles.needs}>
                <b className={styles.needsTitle}>Nothing made</b>
                <span className={styles.needsHint}>Make it</span>
              </Link>
            ) : (
              /* No topic, so nothing can be prefilled honestly. This sends the
                 teacher to the topic field rather than to a form that would
                 open empty claiming to be filled in. */
              <button
                type="button"
                onClick={() =>
                  onOpen({ day: d.key, period: row, lesson, focusTopic: true })
                }
                className={styles.needs}
              >
                <b className={styles.needsTitle}>Nothing made</b>
                <span className={styles.needsHint}>Add a topic first</span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * The strip's keyboard route to attaching: pick a lesson from a list rather
 * than dragging onto one. A select rather than a menu, because it is a choice
 * from a short list and a native control is reachable everywhere without any
 * of the focus handling a custom menu would need.
 */
function LessonChooser({
  lessons,
  periods,
  onPick,
}: {
  lessons: LessonWithResource[];
  periods: string[];
  onPick: (lessonId: string) => void;
}) {
  if (lessons.length === 0) return null;
  return (
    <select
      value=""
      aria-label="Put this on a lesson"
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
      className={styles.wizardCell}
      style={{ width: "auto", flex: "none" }}
    >
      <option value="">Put on a lesson</option>
      {lessons.map((l) => (
        <option key={l.id} value={l.id}>
          {dayName(l.day)}, {periodLabel(periods, l.period)}, {l.subject}
        </option>
      ))}
    </select>
  );
}

/**
 * Where "Add a lesson" opens: the first free slot of the week.
 *
 * A full week has none, and falling back to a slot that is taken would open an
 * empty form whose save fails on the unique index. It opens that lesson for
 * editing instead, which is the only honest thing left to offer.
 */
function firstFreeSlot(
  byCell: Map<string, LessonWithResource>,
  periods: string[],
): SlotTarget {
  for (let row = 0; row < periods.length; row++) {
    for (const d of TIMETABLE_DAYS) {
      if (!byCell.has(`${d.key}-${row}`)) {
        return { day: d.key, period: row, lesson: null };
      }
    }
  }
  const taken = byCell.get("mon-0") ?? null;
  return { day: "mon" as TimetableDay, period: 0, lesson: taken };
}
