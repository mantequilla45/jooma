// Where each copy block actually appears, for the preview in the edit modal.
//
// This lives in code rather than the database because it describes layout, and
// layout only changes when someone edits the component — at which point they
// are already in here. A `where_shown` string in copy_blocks tells an admin
// which page; this tells them which line of it, and at what size and weight.
//
// A key missing from this map is not an error: CopyPreview renders nothing and
// the modal falls back to a plain textarea.

export type SurfaceId = "landing-hero" | "dash-empty";

/** How the string is typeset in the real surface, so the preview shows an
 *  eyebrow as an eyebrow rather than rendering everything as body text. */
export type CopyRole = "eyebrow" | "h1" | "sub" | "button" | "fine" | "title" | "body";

export interface CopySurface {
  surface: SurfaceId;
  /** Which region of the wireframe lights up. Matches an id the wireframe knows. */
  region: string;
  role: CopyRole;
  /** One line for the admin: what this is, and anything they should not do to it. */
  note: string;
}

export const SURFACES: Record<string, CopySurface> = {
  "home.hero.eyebrow": {
    surface: "landing-hero",
    region: "eyebrow",
    role: "eyebrow",
    note: "The small blue pill above the headline. Three or four words.",
  },
  "home.hero.h1": {
    surface: "landing-hero",
    region: "h1",
    role: "h1",
    note: "The main headline. It wraps onto two lines by itself — don't try to add a line break.",
  },
  "home.hero.sub": {
    surface: "landing-hero",
    region: "sub",
    role: "sub",
    note: "The paragraph under the headline. One or two sentences.",
  },
  "home.hero.cta": {
    surface: "landing-hero",
    region: "cta",
    role: "button",
    note: "The black button. Two or three words — it has to fit on one line.",
  },
  "home.hero.reassure": {
    surface: "landing-hero",
    region: "reassure",
    role: "fine",
    note: "The small grey line under the button. Says what a teacher gets without paying.",
  },
  // pricing.headline and pricing.sub lived here until /pricing became a
  // redirect. The landing page carries its own pricing section, so those strings
  // rendered nowhere and are gone from CopyKey too.
  "dash.empty.title": {
    surface: "dash-empty",
    region: "title",
    role: "title",
    note: "Shown in Recently added when a teacher hasn't generated anything yet.",
  },
  "dash.empty.body": {
    surface: "dash-empty",
    region: "body",
    role: "body",
    note: "The second line of that same empty state — tell them what to do next.",
  },
};

export const SURFACE_LABEL: Record<SurfaceId, string> = {
  "landing-hero": "jooma.ai — hero",
  "dash-empty": "Dashboard — Recently added, empty",
};
