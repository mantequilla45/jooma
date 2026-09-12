"use client";

import { useState } from "react";
import { Plus, X } from "@phosphor-icons/react/dist/ssr";
import { DEFAULT_PERIODS, periodLabel } from "@/app/lib/timetable";
import { ModalShell } from "./SlotEditor";
import app from "@/app/components/v2/app.module.css";
import styles from "./timetable.module.css";

/*
 * Edit the rows of the week.
 *
 * The period list was captured once by the setup wizard and then unreachable
 * forever: a teacher who mistyped a time, whose school changed its day, or who
 * simply calls the row "Period 2" had no way back to it. This is that way back,
 * and it is the same interaction as the wizard's step one rather than a second
 * idea about how periods are edited.
 *
 * A LABEL IS FREE TEXT, NOT A TIME. The migration is explicit that these are
 * labels: "9:00" is merely the default, and "Period 2", "Form time" or "AM" are
 * all equally valid. Blank is valid too and falls back to the default, which is
 * what periodLabel() decides.
 *
 * Removing a row that still has lessons in it is a conversation, not a refusal.
 * The migration deliberately leaves `period` unconstrained against this array's
 * length precisely so the client can ask rather than fail, so the count is shown
 * and confirmed before anything is deleted.
 */

/** The column's CHECK allows one to ten. Offering an eleventh would fail at the
 *  database, so the button goes away instead. */
const MAX_PERIODS = 10;

export interface PeriodPlan {
  periods: string[];
  /** Rows that existed when the modal opened and no longer do, as their ORIGINAL
   *  indexes. The page needs these to clear and renumber the week. */
  removed: number[];
}

export default function PeriodEditor({
  periods: saved,
  saving,
  countInPeriod,
  onCancel,
  onSave,
}: {
  periods: string[];
  saving: boolean;
  /** How many lessons sit in a row of the current week, for the confirm line. */
  countInPeriod: (period: number) => number;
  onCancel: () => void;
  onSave: (plan: PeriodPlan) => void;
}) {
  /*
   * Each row carries the index it had when the modal opened, or null when the
   * teacher has just added it.
   *
   * Tracking the origin rather than diffing two arrays at the end is what makes
   * "which lessons are about to be deleted" answerable: after two removals and
   * an insert, position in the list no longer says anything about which row of
   * the week a label started life as.
   */
  const [rows, setRows] = useState<Array<{ from: number | null; label: string }>>(() =>
    (saved.length > 0 ? saved : DEFAULT_PERIODS).map((label, i) => ({ from: i, label })),
  );

  /** A row the teacher has asked to remove that still has lessons in it. */
  const [confirming, setConfirming] = useState<number | null>(null);

  const setLabel = (i: number, value: string) => {
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, label: value } : r)));
  };

  const removeAt = (i: number) => {
    setRows((prev) => prev.filter((_, n) => n !== i));
    setConfirming(null);
  };

  /* Remove asks first, but only when there is something to lose. A row that is
     empty, or one the teacher added in this modal and has not saved, just goes. */
  const askRemove = (i: number) => {
    const from = rows[i]?.from;
    if (from !== null && from !== undefined && countInPeriod(from) > 0) {
      setConfirming(i);
      return;
    }
    removeAt(i);
  };

  const labels = rows.map((r) => r.label);

  const submit = () => {
    const survivors = new Set(
      rows.map((r) => r.from).filter((n): n is number => n !== null),
    );
    onSave({
      // Trimmed, but NOT filtered: a blank row is a row the teacher wants, and
      // periodLabel gives it a name. Dropping it here would silently delete a
      // row for the crime of having no label typed into it.
      periods: rows.map((r, i) => r.label.trim() || periodLabel(labels, i)),
      removed: saved.map((_, i) => i).filter((i) => !survivors.has(i)),
    });
  };

  const pending = confirming === null ? null : rows[confirming];
  const pendingCount =
    pending && pending.from !== null ? countInPeriod(pending.from) : 0;

  return (
    <ModalShell
      title="Edit rows"
      sub="Name these whatever you call them. Leave one blank to use its time."
      onCancel={onCancel}
    >
      {rows.map((row, i) => (
        <div key={`${row.from ?? "new"}-${i}`} className={styles.periodRow}>
          <span className={styles.periodNum}>Period {i + 1}</span>
          <input
            value={row.label}
            maxLength={12}
            onChange={(e) => setLabel(i, e.target.value)}
            aria-label={`Period ${i + 1} label`}
            placeholder={periodLabel(labels, i)}
            className={styles.fieldInput}
          />
          <button
            type="button"
            className={styles.subjectRemove}
            aria-label={`Remove period ${i + 1}`}
            onClick={() => askRemove(i)}
            /* One row is the floor, same as the wizard and the column's CHECK:
               a week with no rows has no grid to draw. */
            disabled={rows.length <= 1 || saving}
          >
            <X weight="bold" />
          </button>
        </div>
      ))}

      {/* The confirm for a row with lessons in it. Inline rather than a second
          modal stacked on this one: it is about a row that is on screen, and a
          nested dialog would take the focus story from bad to worse. */}
      {pending && (
        <p className={styles.periodWarn} role="alert">
          <b>Remove Period {confirming! + 1}?</b> It has {pendingCount}{" "}
          {pendingCount === 1 ? "lesson" : "lessons"} in it this week, and{" "}
          {pendingCount === 1 ? "it" : "they"} will be removed with it.
          <span className={styles.periodWarnActions}>
            <button
              type="button"
              className={app.btn}
              onClick={() => setConfirming(null)}
            >
              Keep it
            </button>
            <button
              type="button"
              className={styles.modalDelete}
              onClick={() => removeAt(confirming!)}
            >
              Remove row
            </button>
          </span>
        </p>
      )}

      {rows.length < MAX_PERIODS && (
        <button
          type="button"
          className={app.btn}
          onClick={() => setRows((prev) => [...prev, { from: null, label: "" }])}
          disabled={saving}
        >
          <Plus className={app.btnIcon} />
          Add a row
        </button>
      )}

      <div className={styles.modalFoot}>
        <button type="button" className={styles.modalCancel} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className={styles.modalSave} onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save rows"}
        </button>
      </div>
    </ModalShell>
  );
}
