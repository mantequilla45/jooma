<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Project docs

Before implementing navigation, routing, loading states, Suspense, skeletons, or URL state, read:

- `docs/instant-navigation-guide.md` — canonical reference for `<Link>`, `loading.tsx`, Suspense streaming, skeleton UI, URL state, debounced search, and the Suspense `key` trick
<!-- END:nextjs-agent-rules -->

Two language rules are enforced by `pnpm lint` (`scripts/check-language.mjs`): no em dashes or en dashes anywhere, and no standalone word "AI" in the landing page, its v2 components, `NavAuth`, or the shared copy table (`app/lib/copy.ts`, `app/lib/landing`). That is the marketing and signed-out surface, not the whole app. Terms and privacy are exempt because the disclosure is factual there.

# Database writes

Always ask before writing a migration or touching the schema. Schema changes go in a Supabase migration (`supabase/migrations/`) that the user pushes themselves; one-off data seeding can be applied directly if they prefer. Never let an anonymous or public-facing write go through a plain RLS insert policy. Public write paths (contact forms, ambassador signups, etc.) go through a `SECURITY DEFINER` RPC granted to `anon`, with a honeypot plus per-email and per-IP throttling. The same applies to reading another user's row: expose specific columns through a definer function, never a broad RLS policy, since a policy grants the whole row.

# Testing

Two layers, and both hit the staging Supabase project, never a local one:

- `node scripts/verify-*.mjs` — standalone regression scripts, one per feature area (colleagues, ambassadors, and so on), that assert RLS and business-logic behaviour end to end against a real database. Fixtures are created with the service role, then every assertion runs through the ANON key, since the service role bypasses RLS and would pass no matter how wrong the policies were. Each cleans up after itself. Add a new one whenever a feature has a security or accounting invariant worth pinning down (an edge that cannot be forged, a total that cannot be reassigned), rather than folding it into an existing script.
- Playwright, one folder per area under `tests/`, each with its own script so a change re-runs only what it can break. Specs create and tear down their own throwaway users via the service role.

| Script | Folder | Covers |
|---|---|---|
| `pnpm test:unit` | `tests/unit` | Pure functions. No browser, no database, about a second. |
| `pnpm test:auth` | `tests/auth` | Sign in, password reset, the welcome screen. |
| `pnpm test:billing` | `tests/billing` | Plans, credits, top-up packs, admin MRR. |
| `pnpm test:growth` | `tests/growth` | Ambassadors, referrals, enquiry forms. |
| `pnpm test:library` | `tests/library` | Resources, folders, the editor, slideshows. |
| `pnpm test:planning` | `tests/planning` | Timetable, and what it puts on Today. |
| `pnpm test:profile` | `tests/profile` | Badges, levels, profile surfaces. |
| `pnpm test:shell` | `tests/shell` | The signed-in app shell and navigation. |
| `pnpm test:social` | `tests/social` | Colleagues, connections, sharing. |

`pnpm test:e2e` still runs everything. `tests/unit` has its own config so it starts no dev server; everything else needs one, and hits staging.

When you add a feature, put its spec in the folder it belongs to rather than a new file at the top of `tests/`. If no folder fits, add one with its script and list it here. Pure functions go in `tests/unit`; reach for a browser folder only when the thing being proved needs a real page or real RLS.

A feature needs no spec only when it has no behaviour of its own: copy, styling, and components that render what they are handed. Anything that writes to the database, gates on a plan, or has a state a teacher can get stuck in needs one.

Not yet covered, and worth writing when those areas are next touched: folder organisation and grid drag and drop, SEO metadata, colleague search, Google signup.

Two traps that have each cost an hour:

- Point Playwright at `localhost`, not `127.0.0.1`. React never hydrates against the loopback IP, so every controlled input stays empty and every gated button stays disabled.
- Wait for a client-rendered screen to finish loading before driving it. The timetable resolves its week in an effect and drops any save made before that lands, which looks exactly like a broken feature rather than an early test. See `waitForGrid` in `tests/planning/timetable.spec.ts`.

# Brand and tokens

Brand tokens live on `:root`; `.jooma-v2` is now an empty alias kept for compatibility. `globals.css` sets a `body` colour, so page-level resets need `:where()` to win on specificity without escalating it further.
