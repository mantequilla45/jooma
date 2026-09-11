-- ── Self-serve account deletion, with a 30 day grace period ──────────────────
--
-- Until now a teacher could not leave. An admin could suspend them
-- (profiles.suspended_at + auth.users.banned_until), but suspension is a
-- punitive state applied BY someone else, and there was no self-serve exit at
-- all. UK GDPR Article 17 says there has to be one.
--
-- The shape: a request is recorded, the account keeps working normally for 30
-- days, and a daily cron carries the deletion out when the window closes. The
-- teacher can cancel at any point in those 30 days with one click.
--
-- WHY A TABLE AND NOT COLUMNS ON `profiles`
--
-- profiles.id cascades from auth.users, so the moment the hard delete runs,
-- every column on that row evaporates. Putting the request there would destroy
-- the answer to "why did they leave" at exactly the moment we learn it, which
-- defeats the point of asking. The request therefore lives in its own table
-- whose user_id goes null rather than cascading, the same reasoning that keeps
-- invoices.user_id and ambassadors.user_id around after the person has gone.
--
-- WHAT SURVIVES A DELETION, DELIBERATELY
--
-- token_usage, asset_cost and slide_cost are never touched: they link to a run
-- by a bare run_id with NO foreign key, and that is on purpose (see
-- app/api/resources/delete/route.ts). The spend happened, and monitoring,
-- margin and the cost ceiling all depend on the history staying complete.
-- invoices, safeguarding_flags, support_threads, admin_audit_log and
-- ambassadors all use `on delete set null` so the financial, safeguarding and
-- attribution records outlive the person they describe. None of that is
-- tidied up here, and none of it should be later.
--
-- The consequence is worth stating plainly: those rows are ANONYMISED, not
-- attributed. After a deletion an invoice can no longer be traced back to a
-- person through Jooma, and token_usage has no user_id at all, so per-account
-- spend attribution ends at deletion while the aggregate total stays intact.
-- That is the intended outcome and the cleaner GDPR posture, not a gap.


-- ── The request ──────────────────────────────────────────────────────────────

create table if not exists account_deletion_requests (
  id             uuid primary key default gen_random_uuid(),
  -- `on delete set null`, deliberately, exactly as invoices.user_id: this row
  -- outlives the account it describes. It is the only record of why somebody
  -- left and would be worthless if the deletion erased it.
  user_id        uuid references auth.users (id) on delete set null,
  -- Kept because user_id goes null on success, so this is what a completed row
  -- is identified by afterwards. Lowercased by the route.
  email          text not null,
  reason_code    text not null check (reason_code in (
                   'too_expensive','not_using','missing_feature',
                   'found_alternative','privacy','other')),
  reason_text    text check (reason_text is null or length(reason_text) <= 2000),
  requested_at   timestamptz not null default now(),
  -- Materialised rather than computed as requested_at + 30 days. Two reasons:
  -- support can extend one person's window with a single update, and
  -- shortening the global period later must not retroactively delete accounts
  -- whose owners were told a different date.
  scheduled_for  timestamptz not null,
  cancelled_at   timestamptz,
  completed_at   timestamptz,
  status         text not null default 'pending'
                 check (status in ('pending','cancelled','completed','failed')),
  -- Why the executor gave up, so a human can pick it up. Set with 'failed'.
  failure_note   text,
  -- Whether billing was paused at request time, so cancelling knows whether it
  -- has anything to resume. Distinguishes "had no subscription" from "we
  -- cancelled theirs", which a null subscription id cannot.
  subscription_paused boolean not null default false,
  -- When the T-3 day reminder went out. The executor selects on a 24 hour
  -- window, so a manual run, a retry or a schedule change could otherwise mail
  -- the same person twice about the same deletion.
  reminded_at    timestamptz
);

-- At most one live request per account. Partial rather than plain: somebody who
-- cancels and later changes their mind again must be able to raise a second
-- request, and their first one stays on the record.
create unique index if not exists account_deletion_requests_one_pending_idx
  on account_deletion_requests (user_id)
  where status = 'pending';

-- The executor's only query: pending and due.
create index if not exists account_deletion_requests_due_idx
  on account_deletion_requests (scheduled_for)
  where status = 'pending';

-- The admin console lists these newest first.
create index if not exists account_deletion_requests_recent_idx
  on account_deletion_requests (requested_at desc);

alter table account_deletion_requests enable row level security;

-- Read your own, and nothing else. The section and the banner both need to know
-- whether a request is live and when it lands, so unlike auth_rate this table
-- does grant something to `authenticated`.
drop policy if exists "read own deletion request" on account_deletion_requests;
create policy "read own deletion request" on account_deletion_requests
  for select to authenticated
  using (user_id = auth.uid());

-- Admins read the lot, for /admin/deletions. The route re-checks the
-- see_deletions permission; this policy is what lets the query run at all.
drop policy if exists "admins read deletion requests" on account_deletion_requests;
create policy "admins read deletion requests" on account_deletion_requests
  for select to authenticated
  using (is_admin());

-- NOTE the absence of insert, update and delete policies. Requesting goes
-- through /api/account/deletion with the service role, because a client-side
-- insert would let a teacher choose their own scheduled_for -- either now(), a
-- self-inflicted instant deletion, or the year 3000, which turns the request
-- into a permanent un-deletable marker. Cancelling goes through the definer
-- function below. A self-serve delete policy would let a browser erase its own
-- pending request, which is the same class of hole as clearing your own
-- rate-limit rows.
grant select on account_deletion_requests to authenticated;


-- ── The cheap read surface on profiles ───────────────────────────────────────
--
-- The banner renders on every signed-in page. Reading account_deletion_requests
-- for it would be a second query on surfaces that already read profiles, so the
-- deadline is mirrored here. Exactly the role profiles.suspended_at plays for
-- auth.users.banned_until: the enforcing record is elsewhere, this is the one
-- the UI reads.
--
-- Two writes therefore have to agree, and the routes keep them in the order
-- that fails safe: the request row goes in FIRST, so a partial failure leaves a
-- request the executor will honour with no banner, rather than a banner with
-- nothing behind it.

alter table profiles add column if not exists deletion_scheduled_for timestamptz;


-- ── Re-arming the guard ──────────────────────────────────────────────────────
--
-- profiles_guard_privileged_columns is a DENY-LIST, so a new column on profiles
-- is self-editable from the browser with the anon key by default. Without the
-- clause added below, this works:
--
--   await supabase.from('profiles')
--     .update({ deletion_scheduled_for: null }).eq('id', myId)
--
-- which clears the banner while leaving the request live, so the account still
-- gets deleted on day 30 with nothing on screen to say so. That is a worse
-- failure than the self-service Pro upgrade this trigger was written to stop.
--
-- The escape hatch is new. A SECURITY DEFINER function still runs with
-- auth.uid() non-null, so cancel_my_account_deletion's own write would trip the
-- very clause being added. A transaction-local flag lets exactly that function
-- through: `true` on set_config scopes it to the transaction, so it cannot
-- leak to the next statement on a pooled connection, and nothing a browser can
-- call sets it.

create or replace function profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (webhooks, admin routes, migrations) legitimately changes
  -- these columns. It has no JWT, so auth.uid() is null -- that is the signal
  -- this is a trusted server-side write rather than a browser one.
  if auth.uid() is null then
    return new;
  end if;

  -- Set only by cancel_my_account_deletion(), transaction-locally, immediately
  -- before its own profiles write. Deliberately narrow: it exempts the whole
  -- row, so nothing else may ever set it.
  if current_setting('jooma.deletion_write', true) = 'on' then
    return new;
  end if;

  -- Admins may edit these through the console; their routes re-check is_admin
  -- server-side before they get here.
  if is_admin() then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'not authorized: is_admin cannot be changed here';
  end if;
  if new.plan is distinct from old.plan then
    raise exception 'not authorized: plan is set by billing, not by you';
  end if;
  if new.subscription_status is distinct from old.subscription_status
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.current_period_end is distinct from old.current_period_end then
    raise exception 'not authorized: billing fields are set by Stripe';
  end if;
  if new.school_id is distinct from old.school_id then
    raise exception 'not authorized: school membership is set by an admin';
  end if;
  if new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.suspended_by is distinct from old.suspended_by then
    raise exception 'not authorized: suspension is set by an admin';
  end if;
  if new.deletion_scheduled_for is distinct from old.deletion_scheduled_for then
    raise exception 'not authorized: deletion is scheduled by the account routes';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns_trg on profiles;
create trigger profiles_guard_privileged_columns_trg
  before update on profiles
  for each row
  execute function profiles_guard_privileged_columns();

-- The INSERT path needs the same treatment: "own profile insert" checks only
-- auth.uid() = id, so a brand-new user could sign up straight into
-- plan='pro', is_admin=true. /complete-profile legitimately inserts a row, so
-- this forces the privileged columns to their defaults rather than blocking it.
create or replace function profiles_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  new.is_admin := false;
  new.school_id := null;
  new.subscription_status := null;
  new.stripe_customer_id := null;
  new.stripe_subscription_id := null;
  new.current_period_end := null;
  new.suspended_at := null;
  new.suspended_reason := null;
  new.suspended_by := null;
  -- A fresh profile is never already scheduled for deletion. Forced rather than
  -- rejected, for the same reason as the columns above: /complete-profile has
  -- to keep working.
  new.deletion_scheduled_for := null;

  -- An admin-invited teacher has their plan stashed on the auth user at invite
  -- time (see /api/admin/teachers/invite). Honour that, but only that -- it was
  -- written by the service role, so it is not user-controlled. Anything else
  -- falls back to free.
  if new.plan is distinct from 'free' then
    if coalesce(
         (select (raw_user_meta_data ->> 'invited_plan') from auth.users where id = new.id),
         'free'
       ) is distinct from new.plan then
      new.plan := 'free';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_insert_trg on profiles;
create trigger profiles_guard_insert_trg
  before insert on profiles
  for each row
  execute function profiles_guard_insert();


-- ── Cancelling ───────────────────────────────────────────────────────────────
--
-- Two writes that must not partially apply: the request goes to 'cancelled' and
-- the mirror on profiles is cleared. A definer function rather than a route,
-- because it needs no service role -- auth.uid() IS the authorisation, and
-- there is nothing here a caller can point at somebody else's row.
--
-- Returns false rather than raising when there is nothing to cancel. A teacher
-- clicking "keep my account" twice, or landing on a stale tab, is not an error.

create or replace function cancel_my_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := (select auth.uid());
  found_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  update account_deletion_requests
     set status = 'cancelled', cancelled_at = now()
   where user_id = uid and status = 'pending'
  returning id into found_id;

  if found_id is null then
    return false;
  end if;

  -- Transaction-local, and read by the guard above. Without this the next
  -- statement raises 'deletion is scheduled by the account routes' -- the
  -- function is running as its owner but auth.uid() is still the caller's.
  perform set_config('jooma.deletion_write', 'on', true);

  update profiles set deletion_scheduled_for = null where id = uid;

  return true;
end;
$$;

revoke all on function cancel_my_account_deletion() from public, anon;
grant execute on function cancel_my_account_deletion() to authenticated;


-- ── The two foreign keys that would block the deletion ────────────────────────
--
-- Both were confirmed as NO ACTION against staging. Either one alone makes
-- auth.admin.deleteUser() raise a foreign-key violation, 30 days after the
-- teacher asked and with nobody watching.

-- presentations.user_id was added without an `on delete` clause
-- (20260601000000_presentations_user_isolation.sql), so it defaulted to NO
-- ACTION. The header of that migration says orphaned decks were the intent, but
-- the constraint never implemented it.
--
-- The executor also deletes these rows explicitly before calling deleteUser, so
-- this is belt and braces. It is worth having anyway: leaving a NO ACTION FK on
-- auth.users is a landmine for every future deletion path, including an admin
-- one.
alter table presentations drop constraint if exists presentations_user_id_fkey;
alter table presentations add constraint presentations_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- enquiry_replies.author_id is `not null references auth.users (id)` with no
-- `on delete`, so it blocks the deletion and `set null` is not even available
-- until the column is made nullable.
--
-- This one is NOT the departing teacher's own data. An enquiry reply is written
-- by staff answering somebody else's enquiry, so deleting the row would destroy
-- a third party's support record to get rid of an account. The reply text is
-- the record; the author is attribution, and attribution is exactly what
-- invoices.user_id, support_threads.user_id and admin_audit_log.actor_id
-- already give up when the person goes.
--
-- Readers must cope with a null author. The console's join is already a LEFT
-- JOIN (20260908000000_enquiries.sql), so it needs only a display fallback.
alter table enquiry_replies alter column author_id drop not null;
alter table enquiry_replies drop constraint if exists enquiry_replies_author_id_fkey;
alter table enquiry_replies add constraint enquiry_replies_author_id_fkey
  foreign key (author_id) references auth.users (id) on delete set null;


-- ── Admin permission ─────────────────────────────────────────────────────────
--
-- The seed in 20260805001700_content_and_roles.sql is guarded by
-- `where not exists (select 1 from role_permissions)`, i.e. it only ever runs
-- on an empty table, so a new permission needs its own insert with its own
-- guard or it silently never lands.
--
-- Support sees these because "I asked to delete my account and changed my mind"
-- arrives as a ticket. Finance does not: the billing consequences are already
-- on the invoice, and the free-text reason is the teacher's own words about
-- leaving, which is not finance's to read.

insert into role_permissions (role, permission, allowed)
select * from (values
  ('super_admin','see_deletions',true),
  ('support','see_deletions',true),
  ('finance','see_deletions',false),
  ('content','see_deletions',false),
  ('developer','see_deletions',false)
) as v(role, permission, allowed)
where not exists (
  select 1 from role_permissions where permission = 'see_deletions'
);


-- ── Email templates ──────────────────────────────────────────────────────────
--
-- Structure lives in app/lib/email-templates/; the subject, the editable prose
-- and the live/paused switch live here. Same `where not exists` guard per key
-- as the enquiry_reply seed, so re-running this migration cannot clobber an
-- admin's wording.
--
-- The scheduled one matters most: it is the only channel that reaches somebody
-- who requests deletion and then never opens the app again, and it carries the
-- cancel link.

insert into email_templates (key, name, trigger_description, subject, live, sort)
select 'account_deletion_scheduled', 'Account deletion scheduled',
       'A teacher asks to delete their account',
       'Your Jooma account is scheduled for deletion', true, 5
where not exists (select 1 from email_templates where key = 'account_deletion_scheduled');

insert into email_templates (key, name, trigger_description, subject, live, sort)
select 'account_deletion_reminder', 'Account deletion reminder',
       'Three days before a scheduled deletion',
       'Your Jooma account will be deleted in 3 days', true, 6
where not exists (select 1 from email_templates where key = 'account_deletion_reminder');

insert into email_templates (key, name, trigger_description, subject, live, sort)
select 'account_deleted', 'Account deleted',
       'A scheduled deletion completes',
       'Your Jooma account has been deleted', true, 7
where not exists (select 1 from email_templates where key = 'account_deleted');
