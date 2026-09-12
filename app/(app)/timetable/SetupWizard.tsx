"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import { YEAR_GROUPS } from "@/app/lib/formOptions";
import {
  TIMETABLE_DAYS,
  DEFAULT_PERIODS,
  periodLabel,
  type PatternSlot,
  type TimetableDay,
} from "@/app/lib/timetable";
import app from "@/app/components/v2/app.module.css";
import styles from "./timetable.module.css";

/*
 * Timetable setup.
 *
 * The handover leaves timetable capture as an open decision, and this is the
 * answer: three short steps, then the grid. Minimum viable capture is which
 * year group, which subjects and which days, which is exactly steps one to
 * three.
 *
 * Every step is skippable in one press. Step three is twenty decisions before
 * any value has been delivered, and a teacher who quits there must still end up
 * with a working screen rather than back where they started, so Skip writes a
 * pattern with no lessons and the grid opens empty with Add a lesson ready.
 */

const SUBJECT_SUGGESTIONS = [
  "Maths",
  "English",
  "Science",
  "History",
  "Geography",
  "Art",
  "PE",
  "Music",
  "Computing",
  "RE",
  "PSHE",
  "French",
];

export default function SetupWizard({
  saving,
  error,
  onFinish,
}: {
  saving: boolean;
  error: string | null;
  onFinish: (p: {
    periods: string[];
    yearGroup: string | null;
    slots: PatternSlot[];
  }) => void;
}) {
  const [step, setStep] = useState(0);
  const [yearGroup, setYearGroup] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [periods, setPeriods] = useState<string[]>(DEFAULT_PERIODS);
  // Keyed "day-period" so a cell can be read and written without scanning.
  const [slots, setSlots] = useState<Record<string, string>>({});

  const addSubject = (raw: string) => {
    const name = raw.trim();
    if (!name || name.length > 40) return;
    // Case-insensitive, so "maths" typed after "Maths" does not make a second
    // chip that looks like a duplicate and behaves like one.
    if (subjects.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setSubjectDraft("");
      return;
    }
    setSubjects((prev) => [...prev, name]);
    setSubjectDraft("");
  };

  const removeSubject = (name: string) => {
    setSubjects((prev) => prev.filter((s) => s !== name));
    // Drop any slot that used it, so step three cannot keep a subject the
    // teacher has just said they do not teach.
    setSlots((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== name) next[k] = v;
      return next;
    });
  };

  const setPeriodAt = (i: number, value: string) => {
    setPeriods((prev) => prev.map((p, n) => (n === i ? value : p)));
  };

  const removePeriodAt = (i: number) => {
    setPeriods((prev) => prev.filter((_, n) => n !== i));
    // Slots below the removed period shift up with it, so the grid the teacher
    // filled in stays the grid they meant.
    setSlots((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [day, p] = k.split("-");
        const n = Number(p);
        if (n === i) continue;
        next[`${day}-${n > i ? n - 1 : n}`] = v;
      }
      return next;
    });
  };

  const finish = (withSlots: boolean) => {
    const clean = periods.map((p) => p.trim()).filter(Boolean);
    onFinish({
      periods: clean.length > 0 ? clean : DEFAULT_PERIODS,
      yearGroup: yearGroup || null,
      slots: withSlots ? toPatternSlots(slots) : [],
    });
  };

  const filled = useMemo(() => Object.values(slots).filter(Boolean).length, [slots]);

  return (
    <div className={styles.wizard}>
      <div className={styles.wizardSteps} aria-hidden="true">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className={`${styles.wizardStep} ${n <= step ? styles.wizardStepOn : ""}`}
          />
        ))}
      </div>

      {step === 0 && (
        <>
          <h2 className={styles.wizardTitle}>What do you teach?</h2>
          <p className={styles.wizardSub}>
            This fills in your year group and subject on anything you make from a lesson.
          </p>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="wiz-year">
              Year group
            </label>
            <select
              id="wiz-year"
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

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="wiz-subject">
              Subjects
            </label>
            <div className={styles.subjectAdd}>
              <input
                id="wiz-subject"
                value={subjectDraft}
                maxLength={40}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubject(subjectDraft);
                  }
                }}
                placeholder="Maths"
                className={styles.fieldInput}
              />
              <button
                type="button"
                className={app.btn}
                onClick={() => addSubject(subjectDraft)}
                disabled={!subjectDraft.trim()}
              >
                <Plus className={app.btnIcon} />
                Add
              </button>
            </div>

            {subjects.length > 0 && (
              <div className={styles.subjectList}>
                {subjects.map((s) => (
                  <span key={s} className={styles.subjectChip}>
                    {s}
                    <button
                      type="button"
                      className={styles.subjectRemove}
                      aria-label={`Remove ${s}`}
                      onClick={() => removeSubject(s)}
                    >
                      <X weight="bold" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {subjects.length === 0 && (
              <div className={styles.subjectList}>
                {SUBJECT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={app.chip}
                    onClick={() => addSubject(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h2 className={styles.wizardTitle}>What are your rows called?</h2>
          <p className={styles.wizardSub}>
            These label the rows of your week. Call them whatever you call them, times or
            names, and leave one blank to use its time. You can change any of this later.
          </p>

          {periods.map((p, i) => (
            <div key={i} className={styles.periodRow}>
              <span className={styles.periodNum}>Period {i + 1}</span>
              <input
                value={p}
                maxLength={12}
                onChange={(e) => setPeriodAt(i, e.target.value)}
                aria-label={`Period ${i + 1} label`}
                placeholder={periodLabel(periods, i)}
                className={styles.fieldInput}
              />
              <button
                type="button"
                className={styles.subjectRemove}
                aria-label={`Remove period ${i + 1}`}
                onClick={() => removePeriodAt(i)}
                disabled={periods.length <= 1}
              >
                <X weight="bold" />
              </button>
            </div>
          ))}

          {periods.length < 10 && (
            <button
              type="button"
              className={app.btn}
              onClick={() => setPeriods((prev) => [...prev, ""])}
            >
              <Plus className={app.btnIcon} />
              Add a row
            </button>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className={styles.wizardTitle}>Which lessons go where?</h2>
          <p className={styles.wizardSub}>
            Leave anything blank and add it later. You can change any of this week by week.
          </p>

          <div className={styles.wizardScroll}>
            <div className={styles.ttgrid}>
              <div />
              {TIMETABLE_DAYS.map((d) => (
                <div key={d.key} className={styles.tthead}>
                  {d.short}
                </div>
              ))}

              {periods.map((p, row) => (
                <Row
                  key={row}
                  label={periodLabel(periods, row)}
                  row={row}
                  subjects={subjects}
                  slots={slots}
                  onSet={(day, value) =>
                    setSlots((prev) => {
                      const next = { ...prev };
                      if (value) next[`${day}-${row}`] = value;
                      else delete next[`${day}-${row}`];
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </div>

          {subjects.length === 0 && (
            <p className={styles.fieldHint}>
              You did not add any subjects, so there is nothing to place here. Go back a
              step, or finish and build your week a lesson at a time.
            </p>
          )}
        </>
      )}

      {error && (
        <p className={`${styles.status} ${styles.statusError}`} role="alert">
          {error}
        </p>
      )}

      <div className={styles.wizardFoot}>
        <button
          type="button"
          className={styles.wizardSkip}
          onClick={() => finish(false)}
          disabled={saving}
        >
          Skip and set it up myself
        </button>

        {step > 0 && (
          <button
            type="button"
            className={app.btn}
            onClick={() => setStep(step - 1)}
            disabled={saving}
          >
            Back
          </button>
        )}

        {step < 2 ? (
          <button
            type="button"
            className={`${app.btn} ${app.btnP}`}
            onClick={() => setStep(step + 1)}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className={`${app.btn} ${app.btnP}`}
            onClick={() => finish(true)}
            disabled={saving}
          >
            {saving ? "Setting up…" : filled > 0 ? `Build my week` : "Finish"}
          </button>
        )}
      </div>
    </div>
  );
}

/** One period's row of selects, plus its label in the left column. */
function Row({
  label,
  row,
  subjects,
  slots,
  onSet,
}: {
  label: string;
  row: number;
  subjects: string[];
  slots: Record<string, string>;
  onSet: (day: TimetableDay, value: string) => void;
}) {
  return (
    <>
      <div className={styles.ttslot}>{label}</div>
      {TIMETABLE_DAYS.map((d) => {
        const value = slots[`${d.key}-${row}`] ?? "";
        return (
          <select
            key={d.key}
            value={value}
            onChange={(e) => onSet(d.key, e.target.value)}
            aria-label={`${d.long}, ${label}`}
            className={`${styles.wizardCell} ${value ? styles.wizardCellOn : ""}`}
          >
            <option value="">Free</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}

/** Flatten the keyed draft into the rows the pattern stores. */
function toPatternSlots(slots: Record<string, string>): PatternSlot[] {
  const out: PatternSlot[] = [];
  for (const [key, subject] of Object.entries(slots)) {
    if (!subject) continue;
    const [day, period] = key.split("-");
    out.push({ day: day as TimetableDay, period: Number(period), subject });
  }
  return out;
}
