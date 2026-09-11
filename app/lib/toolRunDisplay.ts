import { TOOLS } from "@/app/lib/tools";

// Shared display helpers for rendering tool_runs (dashboard + analytics).

// Friendly short "type" labels; falls back to the tool's full label.
const TYPE_LABEL: Record<string, string> = {
  "lesson-planner": "Lesson plan",
  "worksheet-generator": "Worksheet",
  "quiz-generator": "Quiz",
  "comprehension-generator": "Comprehension",
  "lesson-slideshow": "Slideshow",
  "cpd-slideshow": "CPD Slideshow",
  "homework-generator": "Homework",
  "report-writer": "Report",
};

export function toolForSlug(slug: string) {
  return TOOLS.find((t) => t.href === `/tools/${slug}`);
}

/** Position of a tool in the TOOLS catalogue — the exact order /tools renders,
 *  which is the hand-curated array order rather than anything alphabetical.
 *  Unknown slugs sort last instead of colliding at index 0. */
export function catalogIndex(slug: string) {
  const i = TOOLS.findIndex((t) => t.href === `/tools/${slug}`);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function typeLabel(slug: string) {
  return TYPE_LABEL[slug] ?? toolForSlug(slug)?.label ?? slug;
}

/*
 * Three tools put JSON in tool_runs.output rather than markdown, because what
 * they make is a structure and not a document: a deck of slides, a list of
 * questions. See TOOL_SLUG in LessonSlideshowForm, CpdSlideshowForm and
 * QuizGeneratorForm, each of which JSON.stringify's its result before saving.
 *
 * Anything that renders an output it did not generate itself has to ask first.
 * Handing one of these to MarkdownResult produces a screenful of literal braces,
 * which reads as a broken resource rather than as the wrong renderer.
 */
const STRUCTURED_OUTPUT_SLUGS = new Set([
  "lesson-slideshow",
  "cpd-slideshow",
  "quiz-generator",
]);

/**
 * True when `output` holds JSON rather than markdown.
 *
 * Takes the output too, when the caller has it, because a hardcoded slug list
 * goes stale the moment a fourth structured tool is added and nobody thinks to
 * update this. A body that opens with `[` is a JSON array whatever the slug
 * says, so the shape gets the final word.
 */
export function isStructuredOutput(slug: string, output?: string): boolean {
  if (STRUCTURED_OUTPUT_SLUGS.has(slug)) return true;
  return output !== undefined && output.trimStart().startsWith("[");
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export const TAG_COLORS: Record<string, { bg: string; icon: string }> = {
  Planning: { bg: "bg-blue-100", icon: "text-blue-600" },
  Literacy: { bg: "bg-amber-100", icon: "text-amber-600" },
  Assessment: { bg: "bg-violet-100", icon: "text-violet-600" },
  "Early Years": { bg: "bg-emerald-100", icon: "text-emerald-600" },
  SEND: { bg: "bg-emerald-100", icon: "text-emerald-600" },
  Leadership: { bg: "bg-rose-100", icon: "text-rose-600" },
};
