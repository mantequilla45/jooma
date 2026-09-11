"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, X } from "lucide-react";
import { ChatTeardropDots } from "@phosphor-icons/react/dist/ssr";
import Card from "@/app/components/ui/Card";
import { extractHeadings, type Heading } from "@/app/lib/headings";
import styles from "./OutputOutline.module.css";

// Chapter navigation for a generated document, derived from the output itself.
//
// Replaces LessonPlannerNav, EYFSNav, WorksheetNav and SensoryActivitiesNav,
// which between them covered 4 of 32 markdown tools and each hardcoded the
// section names they expected, locating them by scanning the live DOM for an
// <h2> whose text started with the right string. Two consequences teachers hit:
// a heading the model phrased differently was unreachable, and editing a
// heading in the Tiptap editor silently broke its own link.
//
// Two presentations, one brain. On desktop this is the sticky sidebar card it
// has always been. Below the shell's 900px breakpoint the card is hidden and
// the same list is reached through a floating button, because stacked above a
// long document the card was just something to scroll past. Heading
// extraction, active tracking and scrolling are shared; only the frame differs.

/** Offset so a scrolled-to heading clears the sticky results header. Matches
 *  the value the four hardcoded navs used. */
const SCROLL_OFFSET = 160;

/** The same idea inside a modal, where there is no sticky header to clear and
 *  160px of dead space above the heading would look like a mistake. */
const MODAL_SCROLL_OFFSET = 24;

interface Props {
  /** The generated markdown. The outline re-derives whenever this changes, so
   *  it tracks edits for free. */
  markdown: string | null;
  /** Heading above the list. Also the floating button's accessible name. */
  title?: string;
}

/**
 * True only once hydration has happened, false on the server and on the
 * client's first render.
 *
 * The mobile half renders through a portal, which needs a real document. A
 * bare `typeof document === "undefined"` is NOT enough: it is false during the
 * client's first render too, so the client would render the button on a pass
 * where the server rendered nothing, which React reports as a hydration
 * mismatch. Same shape as the one in SupportLauncher.
 */
const subscribeToNothing = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * Heading extraction, active tracking and scrolling. The brain both
 * presentations share.
 *
 * `scrollRoot` is the one axis of variation. Left undefined, everything below
 * works against the window and the viewport, which is what all 32 tool forms
 * want and what this component did before the hook existed. Handed an element,
 * the same logic runs against that element's scrollport instead, which is what
 * a modal needs: its content scrolls in an internal overflow container, so
 * window.scrollTo would move the page behind the scrim and the viewport-relative
 * IntersectionObserver would never fire.
 */
export function useOutline({
  markdown,
  scrollRoot,
}: {
  markdown: string | null;
  /** The element that actually scrolls, or null/undefined for the window.
   *
   *  MUST arrive via useState and a callback ref, not useRef: a ref does not
   *  re-render, so the observer effect below would run once with null and never
   *  again, leaving the outline dead. */
  scrollRoot?: HTMLElement | null;
}) {
  const headings = useMemo(
    // Empty headings still occupy an index (see headings.ts) but have nothing
    // to label, so they are dropped here rather than from the id sequence.
    () => extractHeadings(markdown ?? "").filter((h) => h.text !== ""),
    [markdown],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  // Suppresses the observer while a click-driven smooth scroll is in flight —
  // otherwise passing over intermediate headings would flicker the highlight
  // through them before settling.
  const scrollingTo = useRef<string | null>(null);

  const contained = scrollRoot != null;
  const offset = contained ? MODAL_SCROLL_OFFSET : SCROLL_OFFSET;

  /** The rendered heading, looked up inside the scroll container first.
   *
   *  Ids are document-global, so a modal showing the same markdown as the page
   *  behind it would have two elements answering to one id and getElementById
   *  would return whichever came first. Scoping the query keeps the modal
   *  correct in that case. CSS.escape because a slug can start with a digit,
   *  which is a valid id but not a valid bare selector. */
  const find = useCallback(
    (id: string): HTMLElement | null => {
      if (scrollRoot) {
        const scoped = scrollRoot.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (scoped) return scoped;
      }
      return document.getElementById(id);
    },
    [scrollRoot],
  );

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingTo.current) return;
        // Whichever tracked heading is nearest the top wins.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      {
        // null is the viewport, which is the behaviour every existing consumer
        // has always had.
        root: scrollRoot ?? null,
        // Top band: a heading counts as "current" once it reaches the reading
        // position, not when it first peeks into view.
        rootMargin: `-${offset}px 0px -65% 0px`,
        threshold: 0,
      },
    );

    // Only headings that actually rendered ids — the Tiptap editor replaces
    // MarkdownResult once generation finishes and emits none, in which case
    // there is nothing to observe and the positional fallback in `scrollTo`
    // takes over.
    const observed = headings
      .map((h) => find(h.id))
      .filter((el): el is HTMLElement => el !== null);
    observed.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [headings, scrollRoot, offset, find]);

  /**
   * Scroll to a heading.
   *
   * Two strategies, in order:
   *   1. The element carrying the id — works while MarkdownResult is rendering.
   *   2. The nth heading in document order — the fallback once ResultPanel has
   *      swapped in the Tiptap editor, whose ProseMirror DOM carries no ids.
   *      Positional, so it keeps working after the teacher edits the heading
   *      text, which is exactly what broke the navs this replaces.
   *
   * Strategy 2 is WINDOW ONLY. A contained outline always renders through
   * MarkdownResult, which always emits ids, so the fallback has no job there
   * and could only mis-target: `.prose-editor` matches the editor on a tool
   * page, which in a modal is the document behind the scrim.
   */
  const go = useCallback(
    (h: Heading) => {
      const target = contained
        ? find(h.id)
        : (document.getElementById(h.id) ??
          // `.prose-editor` is the class RichTextEditor gives Tiptap's editable
          // node (see its editorProps); scoping to it avoids counting headings
          // from the page chrome — "My results", the sidebar panels — which a
          // bare h1/h2/h3 query would include, throwing the index off.
          document.querySelectorAll<HTMLElement>(
            ".prose-editor h1, .prose-editor h2, .prose-editor h3",
          )[h.index]);

      if (!target) return;

      setActiveId(h.id);
      scrollingTo.current = h.id;

      if (scrollRoot) {
        // The delta form, rather than offsetTop: offsetTop is measured from the
        // nearest positioned ancestor, which need not be the scrollport, so it
        // is wrong the moment anything between them is relative.
        const delta =
          target.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top;
        scrollRoot.scrollTo({
          top: scrollRoot.scrollTop + delta - offset,
          behavior: "smooth",
        });
      } else {
        window.scrollTo({
          top: target.getBoundingClientRect().top + window.scrollY - offset,
          behavior: "smooth",
        });
      }

      // Long enough for a smooth scroll to settle before the observer resumes.
      window.setTimeout(() => {
        scrollingTo.current = null;
      }, 700);
    },
    [contained, find, scrollRoot, offset],
  );

  // Nest ### under ## only when the document actually mixes levels; a flat list
  // of ### headings should not all sit indented.
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  return { headings, minLevel, activeId, go };
}

export default function OutputOutline({ markdown, title = "Jump to section" }: Props) {
  const { headings, minLevel, activeId, go } = useOutline({ markdown });

  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes the sheet, and the body stops scrolling behind it. Both are
  // scoped to `open`, so nothing is installed while the sheet is shut.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // One heading is a title, not an outline — nothing to navigate between.
  if (headings.length < 2) return null;

  const list = (
    <OutlineList
      headings={headings}
      minLevel={minLevel}
      activeId={activeId}
      onPick={(h) => {
        // Close BEFORE scrolling, so the scrim is not animating away over the
        // movement. Harmless on desktop, where the sheet is never open.
        setOpen(false);
        go(h);
      }}
    />
  );

  return (
    <>
      <Card className={`p-5 ${styles.card}`}>
        <p className="text-xs font-semibold text-(--color-muted) uppercase tracking-wide mb-3">
          {title}
        </p>
        <nav className="space-y-0.5 max-h-[60vh] overflow-y-auto">{list}</nav>
      </Card>

      {/*
        Portalled to <body>. The 32 consumer forms mount this inside
        `lg:sticky lg:top-8`, and a position: fixed child of a sticky or
        transformed ancestor anchors to that ancestor rather than the viewport,
        which would strand the button mid-page.
      */}
      {mounted &&
        createPortal(
          <div className={styles.floating}>
            {open && (
              <>
                <div className={styles.scrim} onClick={() => setOpen(false)} />
                <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
                  <div className={styles.sheetHead}>
                    <span className={styles.face} aria-hidden="true">
                      <ChatTeardropDots weight="fill" width={18} height={18} />
                    </span>
                    <span className={styles.headText}>
                      <b>Where to?</b>
                      <span>Pick a section and I&apos;ll take you there.</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className={styles.close}
                    >
                      <X width={16} height={16} />
                    </button>
                  </div>
                  <nav className={styles.sheetList}>{list}</nav>
                </div>
              </>
            )}

            <button
              ref={fabRef}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close sections" : title}
              aria-expanded={open}
              className={styles.fab}
            >
              <ArrowUp width={22} height={22} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The outline as a plain column, for a scroll container that is not the page.
 *
 * A third presentation rather than a fourth component. The modal cannot use
 * either of the other two: the card assumes the page scrolls beneath it, and
 * the floating button portals to document.body, which would put it ON TOP of
 * the scrim it is supposed to be inside.
 *
 * What it deliberately does NOT do, all of which the modal owns instead:
 * no body scroll lock, no Escape handler, no portal.
 */
export function OutlineRail({
  markdown,
  scrollRoot,
  title = "Jump to section",
}: {
  markdown: string | null;
  /** The scrolling element. Null until the modal has mounted its body, which
   *  is why this must come from state rather than a ref. */
  scrollRoot: HTMLElement | null;
  title?: string;
}) {
  const { headings, minLevel, activeId, go } = useOutline({ markdown, scrollRoot });

  // Same rule as the card: one heading is a title, not an outline.
  if (headings.length < 2) return null;

  return (
    <nav className={styles.rail} aria-label={title}>
      <p className={styles.railTitle}>{title}</p>
      <div className={styles.railList}>
        <OutlineList
          headings={headings}
          minLevel={minLevel}
          activeId={activeId}
          onPick={go}
        />
      </div>
    </nav>
  );
}

/**
 * The links themselves, shared by the card, the sheet and the rail so there is
 * one indentation rule and one active style rather than three that drift.
 */
function OutlineList({
  headings,
  minLevel,
  activeId,
  onPick,
}: {
  headings: Heading[];
  minLevel: number;
  activeId: string | null;
  onPick: (h: Heading) => void;
}) {
  return (
    <>
      {headings.map((h) => {
        const active = h.id === activeId;
        return (
          <button
            key={h.id}
            type="button"
            onClick={() => onPick(h)}
            aria-current={active ? "location" : undefined}
            title={h.text}
            className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer truncate ${
              active
                ? "bg-(--j-purple) text-white font-medium"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            style={{ paddingLeft: `${12 + (h.level - minLevel) * 14}px` }}
          >
            {h.text}
          </button>
        );
      })}
    </>
  );
}
