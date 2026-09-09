"use client";

// The "what does this actually change?" panel in the edit-copy modal.
//
// A copy key like `home.hero.reassure` tells an admin nothing about where the
// words come out or how big they are. This renders a small mock of the real
// surface with the edited region outlined and the live string in place, so the
// answer is visible rather than described — and it does it twice, side by side,
// so the change itself is the thing on screen.
//
// Built from styled divs rather than SVG on purpose: SVG cannot wrap text, and
// seeing a long headline wrap onto three lines is exactly the feedback this is
// for. Colours are lifted from the real surfaces so the mock reads as that page
// and not a generic grey box.

import { C, Note, Tag } from "../ui";
import { SURFACES, SURFACE_LABEL, type CopyRole, type SurfaceId } from "./surfaces";

interface WireframeProps {
  /** Which region is being edited; every other region renders as a grey bar. */
  region: string;
  /** The string to show in that region. */
  children: React.ReactNode;
}

/** Grey placeholder standing in for a region that isn't being edited. */
function Bar({ width }: { width: string }) {
  return (
    <div
      className="rounded mx-auto"
      style={{ height: 7, width, backgroundColor: C.divider }}
      aria-hidden
    />
  );
}

/** Wraps the edited region so it reads as the target. An outline rather than a
 *  border: it doesn't take up space, so nothing shifts. */
function Target({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded"
      style={{ outline: `2px solid ${C.brand}`, outlineOffset: 3 }}
    >
      {children}
    </div>
  );
}

/** Render `node` when this is the edited region, otherwise a placeholder bar. */
function slot(
  region: string,
  id: string,
  node: React.ReactNode,
  barWidth: string,
): React.ReactElement {
  return region === id ? <Target>{node}</Target> : <Bar width={barWidth} />;
}

function LandingHero({ region, children }: WireframeProps) {
  return (
    <div
      className="rounded-xl border p-5 text-center space-y-2.5"
      style={{ borderColor: C.border, backgroundColor: "#FFFFFF" }}
    >
      {slot(
        region,
        "eyebrow",
        <span
          className="inline-block text-[10px] px-2 py-1 rounded-full"
          style={{ backgroundColor: "#F1ECFC", color: "#5B2ED6" }}
        >
          {children}
        </span>,
        "92px",
      )}
      {slot(
        region,
        "h1",
        <p
          className="text-base font-bold leading-tight text-balance"
          style={{ color: "#1D1730" }}
        >
          {children}
        </p>,
        "72%",
      )}
      {slot(
        region,
        "sub",
        <p className="text-[11px] leading-snug" style={{ color: "#3C3552" }}>
          {children}
        </p>,
        "56%",
      )}
      {slot(
        region,
        "cta",
        <span
          className="inline-block text-[11px] font-semibold px-3.5 py-1.5 rounded-lg text-white"
          style={{ backgroundColor: "#1D1730" }}
        >
          {children}
        </span>,
        "84px",
      )}
      {slot(
        region,
        "reassure",
        <p className="text-[10px]" style={{ color: "#6D6683" }}>
          {children}
        </p>,
        "148px",
      )}
    </div>
  );
}

// PricingHeader was here, previewing the /pricing headline and sub. Both keys
// went when that page became a redirect: the landing page carries its own
// pricing section, so there was nothing left for this wireframe to describe.

function DashEmpty({ region, children }: WireframeProps) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: C.border, backgroundColor: "#F7F5FC" }}
    >
      <div
        className="rounded-lg border p-4"
        style={{ borderColor: C.border, backgroundColor: "#FFFFFF" }}
      >
        <div className="text-[11px] font-medium mb-3" style={{ color: C.ink }}>
          Recently added
        </div>
        <div className="py-4 text-center space-y-1.5">
          {slot(
            region,
            "title",
            <p className="text-[12px] font-medium" style={{ color: C.ink }}>
              {children}
            </p>,
            "110px",
          )}
          {slot(
            region,
            "body",
            <p className="text-[10.5px]" style={{ color: C.muted }}>
              {children}
            </p>,
            "180px",
          )}
        </div>
      </div>
    </div>
  );
}

const WIREFRAMES: Record<SurfaceId, (p: WireframeProps) => React.ReactElement> = {
  "landing-hero": LandingHero,
  "dash-empty": DashEmpty,
};

/** Placeholder for a region whose string is empty — an admin who clears a field
 *  should see that the page falls back, not a mysteriously blank mock. */
const EMPTY_HINT = "(empty — the page will use its built-in wording)";

function roleHint(role: CopyRole): string {
  switch (role) {
    case "button":
      return "Button label";
    case "eyebrow":
      return "Pill above the headline";
    case "h1":
      return "Headline";
    case "sub":
      return "Sub-heading";
    case "fine":
      return "Small print";
    case "title":
      return "Empty-state title";
    case "body":
      return "Empty-state body";
  }
}

export default function CopyPreview({
  copyKey,
  value,
  liveValue,
}: {
  copyKey: string;
  /** The draft in the textarea — the "after". */
  value: string;
  /** copy_blocks.value — what the site serves right now. */
  liveValue: string | null;
}) {
  const surface = SURFACES[copyKey];
  // An unmapped key degrades to no preview rather than breaking the modal.
  if (!surface) return null;

  const Wireframe = WIREFRAMES[surface.surface];
  const live = liveValue ?? "";
  const changed = value !== live;

  const render = (text: string) => (
    <Wireframe region={surface.region}>
      {text.trim().length > 0 ? (
        text
      ) : (
        <span style={{ color: C.muted, fontStyle: "italic" }}>{EMPTY_HINT}</span>
      )}
    </Wireframe>
  );

  return (
    <div className="mt-3">
      {/* Where this lands, in words, before the picture says it again. */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <Tag>{SURFACE_LABEL[surface.surface]}</Tag>
        <Tag tone="plain">{roleHint(surface.role)}</Tag>
      </div>
      <p className="text-xs mb-2.5" style={{ color: C.muted }}>
        {surface.note}
      </p>

      {changed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium mb-1.5" style={{ color: C.ink2 }}>
              Live now
            </div>
            {render(live)}
          </div>
          <div>
            <div className="text-xs font-medium mb-1.5" style={{ color: C.brand }}>
              After publishing
            </div>
            {render(value)}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs font-medium mb-1.5" style={{ color: C.ink2 }}>
            Live now — no change yet
          </div>
          {render(live)}
        </div>
      )}

      {/* A 60%-scale mock hides a trailing space or a smart quote. The counts
          don't. */}
      {changed && (
        <p className="text-xs mt-2 tabular-nums" style={{ color: C.muted }}>
          {live.length} → {value.length} characters
        </p>
      )}

      {liveValue === null && (
        <div className="mt-2">
          <Note>
            This block has never been published, so the site is showing its
            built-in wording. Publishing replaces it.
          </Note>
        </div>
      )}
    </div>
  );
}
