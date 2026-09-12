"use client";

import { useEffect, useRef, useState } from "react";
import { YEAR_GROUPS } from "@/app/lib/formOptions";
import { v2ToolForSlug } from "@/app/lib/tools";
import type { ToolRun } from "@/app/lib/toolRuns";
import { dayName, type LessonWithResource, type TimetableDay } from "@/app/lib/timetable";
import styles from "./timetable.module.css";

/*
 * Add or edit one lesson.
 *
 * This is also the keyboard route to attaching a resource. Dragging a resource
 * onto a cell is the quick way for a teacher with a mouse; the attach select in
 * here is the only way that works without one, which is the rule the Library
 * set when it shipped Move to folder alongside drag and drop.
 */

export interface SlotTarget {
  day: TimetableDay;
  period: number;
  /** The lesson already in this slot, or null when the slot is empty. */
  lesson: LessonWithResource | null;
  /** Open with the topic field focused, for a lesson that cannot offer Make it. */
  focusTopic?: boolean;
}

export interface SlotDraft {
  subject: string;
  topic: string;
  yearGroup: string;
  resourceId: string | null;
}

/** Shared shell: scrim, Escape, focus in on open and back out on close. */
function ModalShell({
  title,
  sub,
  wide,
  onCancel,
  children,
}: {
  title: string;
  sub: string;
  wide?: boolean;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const returnTo = useRef<HTMLElement | null>(null);

  /*
   * Held in a ref so the effect below can run ONCE, on open and close, and
   * never in between.
   *
   * Depending on [onCancel] directly looks harmless and is not: callers pass an
   * inline arrow, so its identity changes on every render of the page. Any
   * setState while the modal is open then re-runs this effect's cleanup, and
   * that cleanup moves focus. A modal whose save does several awaited requests
   * in a row gets its focus yanked mid-flight and the in-flight request is
   * ABORTED, which surfaces as a write that silently does nothing: no error, no
   * rejection, just a promise that never settles. Cost an afternoon.
   */
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
  }, []);

  return (
    <div
      className={styles.modalScrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={`${styles.modalCard} ${wide ? styles.modalCardWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className={styles.modalTitle}>{title}</h2>
        <p className={styles.modalSub}>{sub}</p>
        {children}
      </div>
    </div>
  );
}

export { ModalShell };

export default function SlotEditor({
  target,
  periods,
  runs,
  defaultYearGroup,
  onCancel,
  onSave,
  onDelete,
}: {
  target: SlotTarget;
  periods: string[];
  runs: ToolRun[];
  defaultYearGroup: string | null;
  onCancel: () => void;
  onSave: (draft: SlotDraft) => void;
  onDelete: () => void;
}) {
  const editing = target.lesson !== null;
  const [subject, setSubject] = useState(target.lesson?.subject ?? "");
  const [topic, setTopic] = useState(target.lesson?.topic ?? "");
  const [yearGroup, setYearGroup] = useState(
    target.lesson?.year_group ?? defaultYearGroup ?? "",
  );
  const [resourceId, setResourceId] = useState<string | null>(
    target.lesson?.resource_id ?? null,
  );

  const subjectRef = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  // A lesson with no topic cannot be built from, so when the teacher arrives
  // here by pressing an orange "Nothing made" block the topic is the thing they
  // came to fill in. Otherwise start at the top.
  useEffect(() => {
    const el = target.focusTopic ? topicRef.current : subjectRef.current;
    el?.focus();
    el?.select();
  }, [target.focusTopic]);

  const valid = subject.trim().length > 0 && subject.trim().length <= 40;
  const submit = () => {
    if (valid) onSave({ subject, topic, yearGroup, resourceId });
  };

  const when = `${dayName(target.day)}, ${periods[target.period] ?? ""}`;

  return (
    <ModalShell
      title={editing ? "Edit lesson" : "Add a lesson"}
      sub={when}
      onCancel={onCancel}
    >
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="slot-subject">
          Subject
        </label>
        <input
          id="slot-subject"
          ref={subjectRef}
          value={subject}
          maxLength={40}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Maths"
          className={styles.fieldInput}
        />
      </div>

      {/* Only when editing. Laying out a week is a fast pass over subjects and
          year groups, and the topic is the one thing a teacher cannot answer
          yet at that moment. It stays on the edit form because that is where
          both prompts for it land: the cell's "Add a topic first" and Today's
          "Add a topic" each open an existing lesson with this field focused. */}
      {editing && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="slot-topic">
            Topic
          </label>
          <input
            id="slot-topic"
            ref={topicRef}
            value={topic}
            maxLength={80}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Equivalent fractions"
            className={styles.fieldInput}
          />
          <span className={styles.fieldHint}>
            Jooma needs the topic before it can make anything for this lesson.
          </span>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="slot-year">
          Year group
        </label>
        <select
          id="slot-year"
          value={yearGroup}
          onChange={(e) => setYearGroup(e.target.value)}
          className={styles.fieldSelect}
        >
          <option value="">Not set</option>
          {YEAR_GROUPS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* The keyboard equivalent of dropping a resource on the cell. Only
          offered on a lesson that exists: there is nothing to attach to until
          the row has been saved once. */}
      {editing && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="slot-resource">
            Attached resource
          </label>
          <select
            id="slot-resource"
            value={resourceId ?? ""}
            onChange={(e) => setResourceId(e.target.value || null)}
            className={styles.fieldSelect}
          >
            <option value="">Nothing attached</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title?.trim() || v2ToolForSlug(r.tool_slug)?.name || "Untitled"}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.modalFoot}>
        {editing && (
          <button type="button" className={styles.modalDelete} onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className={styles.modalCancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.modalSave} disabled={!valid} onClick={submit}>
          {editing ? "Save lesson" : "Add lesson"}
        </button>
      </div>
    </ModalShell>
  );
}
