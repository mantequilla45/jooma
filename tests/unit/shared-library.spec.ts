import { test, expect } from "@playwright/test";
import { indexBySavedRun, type Share } from "@/app/lib/colleagues";
import { isStructuredOutput } from "@/app/lib/toolRunDisplay";

/*
 * The two pure decisions behind "Shared with me".
 *
 * Neither needs a browser or a database: one is a map build, the other a lookup
 * against a slug list. The Playwright specs cover the screens; these cover the
 * rules those screens rest on, where a failure is unambiguous.
 */

/** A share with only the fields these functions read. The real row carries a
 *  dozen more, and passing them would say they mattered here. */
function share(over: Partial<Share>): Share {
  return {
    id: "s1",
    sender_id: "alice",
    recipient_id: "bob",
    source_run_id: null,
    tool_slug: "lesson-planner",
    title: "Rivers",
    input: {},
    output: "# Rivers",
    created_at: "2026-09-01T00:00:00Z",
    saved_at: null,
    saved_run_id: null,
    ...over,
  };
}

test.describe("Indexing shares by the resource they became", () => {
  test("keys by saved_run_id, not by share id", () => {
    // The Library holds tool_runs and asks "did this resource come from a
    // colleague". It has a run id in hand, never a share id, so keying by
    // anything else would make the map unusable at the only call site.
    const byRun = indexBySavedRun([share({ id: "s1", saved_run_id: "run-9" })]);

    expect(byRun.has("run-9")).toBe(true);
    expect(byRun.has("s1")).toBe(false);
    expect(byRun.get("run-9")?.id).toBe("s1");
  });

  test("drops shares still waiting in the feed", () => {
    // A share with no saved_run_id has not been added, so it is not in the
    // library, so it is not in the view. This IS the "only ones you added"
    // rule, and it is enforced here rather than at the query.
    const byRun = indexBySavedRun([
      share({ id: "waiting", saved_run_id: null }),
      share({ id: "added", saved_run_id: "run-1", saved_at: "2026-09-02T00:00:00Z" }),
    ]);

    expect(byRun.size).toBe(1);
    expect(byRun.get("run-1")?.id).toBe("added");
  });

  test("an empty feed is an empty map, not a throw", () => {
    // listSharedWithMe returns [] when the table is not there yet, and the
    // Library mounts on the result either way.
    expect(indexBySavedRun([]).size).toBe(0);
  });

  test("keeps the whole share, so the view can name the sender", () => {
    // The reason this returns a Map of shares rather than a Set of ids: the row
    // says "from Alice" and clicking it opens the snapshot.
    const row = share({ saved_run_id: "run-3", title: "Erosion", output: "## Erosion" });
    const found = indexBySavedRun([row]).get("run-3");

    expect(found?.title).toBe("Erosion");
    expect(found?.output).toBe("## Erosion");
    expect(found?.sender_id).toBe("alice");
  });
});

test.describe("Telling JSON output from markdown", () => {
  test("the three structured tools are known by slug alone", () => {
    // Matches TOOL_SLUG in LessonSlideshowForm, CpdSlideshowForm and
    // QuizGeneratorForm. Slug alone, because the viewer decides what to render
    // before it has looked at the body.
    expect(isStructuredOutput("lesson-slideshow")).toBe(true);
    expect(isStructuredOutput("cpd-slideshow")).toBe(true);
    expect(isStructuredOutput("quiz-generator")).toBe(true);
  });

  test("a markdown tool is not structured", () => {
    expect(isStructuredOutput("lesson-planner")).toBe(false);
    expect(isStructuredOutput("worksheet-generator")).toBe(false);
  });

  test("an unknown slug is treated as markdown", () => {
    // A run from a renamed or removed tool still renders. Guessing "structured"
    // would hide a readable document behind a notice; guessing "markdown" shows
    // it, which is the recoverable direction to be wrong in.
    expect(isStructuredOutput("some-tool-added-next-year")).toBe(false);
  });

  test("a JSON body is structured whatever the slug says", () => {
    // The slug list goes stale the moment a fourth structured tool ships and
    // nobody updates it. The shape gets the final word.
    expect(isStructuredOutput("lesson-planner", '[{"question":"..."}]')).toBe(true);
    expect(isStructuredOutput("lesson-planner", '\n  [{"q":1}]')).toBe(true);
  });

  test("markdown that merely contains a bracket is still markdown", () => {
    // Only a body that OPENS with `[` counts. A document full of links is the
    // ordinary case, so presence of a bracket cannot be the test.
    expect(isStructuredOutput("lesson-planner", "# Rivers\n\nSee [the map](x).")).toBe(false);
  });

  test("a markdown document that opens with a link is a false positive", () => {
    // Documented, not fixed. A body starting with `[` is read as JSON, so a
    // markdown file whose very first character is a link shows the wrong panel.
    // No tool emits one: every markdown prompt opens with a heading. Parsing
    // the body to be sure would mean running JSON.parse on every render to
    // answer a question the slug already answers for real cases.
    expect(isStructuredOutput("lesson-planner", "[See the plan](x)\n\n# Rivers")).toBe(true);
  });
});
