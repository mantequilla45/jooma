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
