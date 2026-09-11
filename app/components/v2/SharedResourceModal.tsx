"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import MarkdownResult from "@/app/components/MarkdownResult";
import { OutlineRail } from "@/app/components/OutputOutline";
import { ToolTile } from "@/app/components/v2/Squircle";
import { saveSharedToLibrary, type Share } from "@/app/lib/colleagues";
import { displayName } from "@/app/lib/colleagueDisplay";
import type { ToolRun } from "@/app/lib/toolRuns";
import { isStructuredOutput, typeLabel } from "@/app/lib/toolRunDisplay";
import { v2ToolForSlug, toolSolid } from "@/app/lib/tools";
import styles from "./SharedResourceModal.module.css";

/*
 * Read a resource a colleague sent you.
 *
 * Before this existed the feed offered Save and Dismiss and nothing else, so
 * the only things a teacher could judge an offer on were its title and who sent
 * it. That is a decision made blind, and the content to make it properly was
 * already in the browser.
 *
 * OPENS WITH NO NETWORK CALL. A share carries a full snapshot of the resource
 * (tool_slug, title, input, output) rather than a reference to it, so the row
 * the feed already loaded is everything this needs. That is the payoff of the
 * schema decision argued for in the migration header: the recipient can read
 * the offer without a definer function reaching into the sender's rows.
 *
 * Read-only on purpose. ResultPanel is the other thing that renders a
 * generation, and it is wrong here twice over: idle it swaps in the Tiptap
 * editor, and with historyMeta set it saves a tool_runs row of its own. Neither
 * belongs on a resource that is not yours yet.
 */

interface SharedResourceModalProps {
  /** The share to read. Null closes the modal. */
  share: Share | null;
  onClose: () => void;
  /** Fired after Add to library succeeds. Omitted by the Library, which is
   *  already looking at the copy this would make. */
  onAdded?: (run: ToolRun, share: Share) => void;
}

/*
 * A gate, so the dialog below only exists while something is being read.
 *
 * The unmount is the reset, as in ShareModal: no stale `busy` or `error`
 * survives a close. `key` covers the other direction, opening one share
 * directly from another, which is a prop change rather than a remount and
 * would otherwise carry the previous scroll position and confirmation across.
 */
export default function SharedResourceModal({ share, ...props }: SharedResourceModalProps) {
  if (!share || typeof document === "undefined") return null;
  return <SharedResourceDialog key={share.id} share={share} {...props} />;
}

function SharedResourceDialog({
  share,
  onClose,
  onAdded,
}: SharedResourceModalProps & { share: Share }) {
  /*
   * Whether this is already in the library.
   *
   * Seeded from the share itself rather than passed in, which is what lets one
   * component serve both callers with no mode prop: the Colleagues feed only
   * ever holds unsaved shares, so it opens on the Add button, and the Library's
   * "Shared with me" only ever holds saved ones, so it opens on the
   * confirmation.
   */
  const [added, setAdded] = useState(share.saved_at !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The scrolling element, held in STATE and set by a callback ref.
   *
   * A useRef would not do: OutlineRail attaches an IntersectionObserver to this
   * node in an effect, and a ref assignment does not re-render, so the effect
   * would run once with null and never again, leaving every outline link dead.
   */
  const [body, setBody] = useState<HTMLElement | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // Escape closes, focus moves in on open and returns to whatever opened it.
  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
  }, [onClose]);

  // Scroll lock, matching ShareModal and TopUpModal.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const tool = v2ToolForSlug(share.tool_slug);
  const title = share.title?.trim() || typeLabel(share.tool_slug);
  const from = share.sender ? displayName(share.sender) : "a colleague";
  const structured = isStructuredOutput(share.tool_slug, share.output);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await saveSharedToLibrary(share);
      setAdded(true);
      onAdded?.(run, share);
    } catch {
      setError("That could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-title"
        className={styles.modal}
      >
        <header className={styles.head}>
          <ToolTile icon={tool?.icon ?? "file-text"} solid={toolSolid(tool)} size="sm" />
          <span className={styles.headText}>
            <h2 id="shared-title" className={styles.title} tabIndex={-1} ref={headingRef}>
              {title}
            </h2>
            <p className={styles.sub}>
              Shared by {from} · {typeLabel(share.tool_slug)}
            </p>
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X width={16} height={16} />
          </button>
        </header>

        <div className={styles.body}>
          {/* Renders nothing when the document has fewer than two headings, so
              a short resource gets the full width without a special case. */}
          {!structured && <OutlineRail markdown={share.output} scrollRoot={body} />}

          <div className={styles.content} ref={setBody}>
            {structured ? <StructuredNotice slug={share.tool_slug} /> : (
              <MarkdownResult text={share.output} />
            )}
          </div>
        </div>

        <div className={styles.foot}>
          {error ? (
            <p className={styles.error} role="status">
              {error}
            </p>
          ) : null}

          <button type="button" className={styles.cancel} onClick={onClose}>
            Close
          </button>

          {/* Stays open after adding. The teacher opened this to read the
              thing, so closing it the moment they save would take away what
              they came for as a reward for saving. */}
          {added ? (
            <span className={styles.done}>
              <Check weight="bold" width={15} height={15} />
              In your library
            </span>
          ) : (
            <button type="button" className={styles.save} onClick={add} disabled={busy}>
              {busy ? "Adding" : "Add to library"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What to show when `output` is JSON rather than markdown.
 *
 * Three tools store a structure, not a document (see isStructuredOutput).
 * Handing one to MarkdownResult gives a screenful of literal braces, which
 * reads as a corrupted resource rather than as the wrong renderer. Say what it
 * is instead, and leave Add enabled: adding is exactly what unblocks opening it
 * properly in the tool that made it.
 *
 * Rendering slides or questions here would need MiniSlide, a theme and a
 * presentation shape. Separate piece of work.
 */
function StructuredNotice({ slug }: { slug: string }) {
  const quiz = slug === "quiz-generator";
  return (
    <div className={styles.notice}>
      <p className={styles.noticeTitle}>
        {quiz ? "This one is a quiz." : "This one is a set of slides."}
      </p>
      <p className={styles.noticeBody}>
        Add it to your library and open it in {typeLabel(slug)} to see
        {quiz ? " and edit the questions." : " and edit the slides."}
      </p>
    </div>
  );
}
