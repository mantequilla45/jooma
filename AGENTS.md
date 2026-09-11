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

# After finishing implementation

Run playwright test at 'localhost', and when you add a feature put its spec in the folder it belongs to at the tests folder. if no folder fits create one. Pure functions go in 'tests/unit'. Run only the specific test script that is relevant to the feature you are working on. If you are adding a new feature, add a test for it. If you are fixing a bug, add a regression test for it. If you are refactoring code, add a test to ensure the refactored code behaves the same as before.
