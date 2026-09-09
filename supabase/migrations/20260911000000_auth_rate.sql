-- ── Throttle log for the public password-link endpoint ───────────────────────
--
-- /api/auth/password-link is the second endpoint in the codebase reachable with
-- no session, after /api/enquiries. It sends email to an address the caller
-- typed, so without a brake it is a free relay: someone else's inbox, our
-- sending reputation.
--
-- Deliberately NOT enquiry_rate. That table counts one thing per row (an IP) and
-- is read as "this IP, in the last hour". Sharing it would mean five password
-- resets exhaust a school's enquiry allowance from the same office NAT, and the
-- two limits could never be tuned apart. One row shape, two kinds, one table.
--
-- Holds no email body, no token, no user id: it exists to be counted and pruned,
-- so it stores the least that makes it work. `identifier` is an IP for kind
-- 'ip' and a lowercased address for kind 'email' — never anything else, so a
-- leak of this table reveals only that someone asked for a reset.
create table if not exists auth_rate (
  id         uuid primary key default gen_random_uuid(),
  -- 'ip' or 'email'. Text rather than an enum: a third brake should not need a
  -- type migration to be added.
  kind       text not null check (kind in ('ip', 'email')),
  identifier text not null,
  created_at timestamptz not null default now()
);

alter table auth_rate enable row level security;

-- The lookup is always "this kind and identifier, in the last hour", and the
-- prune is always "older than a day". Mirrors enquiry_rate's two indexes.
create index if not exists auth_rate_lookup_idx
  on auth_rate (kind, identifier, created_at desc);
create index if not exists auth_rate_age_idx on auth_rate (created_at);

-- No policies and no grants at all: RLS on with nothing granted means only the
-- service role reaches it, which is exactly the intent. anon and authenticated
-- can neither read who has asked for a reset nor clear their own count. That
-- second half matters more here than it did for enquiries: a caller who could
-- delete their own rows could reset the throttle and enumerate addresses at
-- whatever rate they liked.

-- ── i_have_password() ────────────────────────────────────────────────────────
--
-- SUPERSEDED. Dropped by 20260911000100_drop_i_have_password.sql, which explains
-- why in full: it answered "does the signed-in account have a password" from
-- auth.users.encrypted_password, and that column turns out to track the signup
-- date rather than whether a password exists.
--
-- Left here as it ran rather than deleted. Both databases recorded this
-- migration as applied before the mistake was found, so a rewritten file would
-- no longer describe the databases it was supposed to describe. The correction
-- belongs in a migration of its own.
create or replace function i_have_password()
returns boolean
language sql
security definer
set search_path = auth, public, pg_temp
stable
as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
       from auth.users u
      where u.id = auth.uid()),
    false
  );
$$;

revoke execute on function i_have_password() from anon, public;
grant execute on function i_have_password() to authenticated;
