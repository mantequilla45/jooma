-- ── Ambassadors: affiliate attribution for promo codes ───────────────────────
--
-- Promo codes already exist and live entirely in Stripe (see
-- 20260805001100_promos_read_from_stripe.sql). What they cannot answer is WHO
-- BROUGHT A TEACHER IN: the only attribution today is a free-text
-- `metadata.channel` string such as 'Twitter' or 'BETT'. Nothing links a
-- redemption to a person, so an influencer cannot be paid for the subscribers
-- they generated.
--
-- This is the missing layer. An ambassador is a named person with a Jooma
-- account and one or more codes attributed to them; every teacher who redeems
-- one is recorded here with their join date, first paid month, plan, and a
-- payout state an admin moves by hand.
--
-- THREE RULES THE SCHEMA ENFORCES
--
--   1. FREE COUNTS BUT NEVER PAYS. A teacher who redeems and stays on Free is
--      tracked, and is never payable. That is why payout_status is a three-way
--      enum with 'na' as the default rather than a boolean: "not applicable" and
--      "owed but unpaid" are genuinely different states, and collapsing them
--      would either hide free referrals or invent debts.
--
--   2. ONE AND DONE. Codes discount a single month, so a subscriber is worth at
--      most one payout. There is no accrual to model, which is why this holds a
--      timestamp and a status rather than a ledger.
--
--   3. ATTRIBUTION IS FIRST-CODE-WINS AND PERMANENT. Enforced by the UNIQUE on
--      ambassador_referrals.user_id, not by application logic.
--
-- WHY ATTRIBUTION IS NOT A COLUMN ON `profiles`
--
-- profiles_guard_privileged_columns_trg (20260811000400) blocks a teacher from
-- writing their own plan and stripe_* columns, precisely because a browser
-- holding the anon key could otherwise grant itself Pro. A referral column on
-- profiles would be exactly the same class of hole: anyone could assign
-- themselves to an ambassador, or move their attribution to a friend. Keeping it
-- in its own admin-only table means the only write paths are a definer function
-- and the service role.
--
-- WHY A COMP MUST NEVER TRIGGER A PAYOUT
--
-- An admin granting Pro writes plan='pro' and fakes subscription_status='active'
-- with no card on file. teacher_mrr() already treats `stripe_subscription_id IS
-- NULL` as the honest discriminator for that (see 20260909000100_honest_mrr.sql,
-- which measured three such profiles on production). The same rule applies here:
-- first_paid_at is written by the Stripe webhook on invoice.paid and by nothing
-- else, so a comped teacher never becomes payable no matter what their plan says.

-- ── Ambassadors ──────────────────────────────────────────────────────────────
create table if not exists ambassadors (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (length(btrim(full_name)) between 1 and 120),
  -- Their own Jooma login, for paying and contacting them. Nullable with
  -- `on delete set null` rather than cascade: an ambassador closing their
  -- account must not delete the payout history of the teachers they brought in.
  user_id      uuid references auth.users (id) on delete set null,
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- 'paused' stops new claims without deleting the history. Codes are
  -- deactivated in Stripe separately; this is the local switch.
  status       text not null default 'active' check (status in ('active','paused')),
  notes        text check (notes is null or length(notes) <= 2000),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table ambassadors enable row level security;

drop policy if exists "admins manage ambassadors" on ambassadors;
create policy "admins manage ambassadors" on ambassadors
  for all using (is_admin()) with check (is_admin());

-- ── Codes ────────────────────────────────────────────────────────────────────
-- One row per Stripe promotion code attributed to an ambassador. A separate
-- table rather than a column because an ambassador may run several codes, and
-- because a Stripe coupon is immutable: changing an offer means a NEW code, and
-- the old one must keep its redemption history.
--
-- Only the identifiers are stored. The discount itself is always read live from
-- Stripe, for the reason 20260805001100 gives at length: a local copy is a
-- second source of truth that can disagree with the system that actually
-- validates the code at checkout, and the customer-facing one always wins.
create table if not exists ambassador_codes (
  id                 uuid primary key default gen_random_uuid(),
  ambassador_id      uuid not null references ambassadors (id) on delete cascade,
  promotion_code_id  text not null unique,   -- promo_xxx, Stripe's id
  code               text not null unique,   -- the string a teacher types
  created_at         timestamptz not null default now()
);

alter table ambassador_codes enable row level security;

drop policy if exists "admins manage ambassador codes" on ambassador_codes;
create policy "admins manage ambassador codes" on ambassador_codes
  for all using (is_admin()) with check (is_admin());

-- ── Referrals ────────────────────────────────────────────────────────────────
create table if not exists ambassador_referrals (
  id              uuid primary key default gen_random_uuid(),
  ambassador_id   uuid not null references ambassadors (id) on delete cascade,
  code_id         uuid not null references ambassador_codes (id) on delete cascade,

  -- ONE REFERRAL PER TEACHER, EVER.
  --
  -- This UNIQUE is the whole of the "attribution is locked to the first code
  -- they use" rule. Enforcing it here rather than in the application means two
  -- concurrent claims cannot both win, and a later code cannot quietly move a
  -- teacher from one ambassador to another.
  user_id         uuid not null unique references auth.users (id) on delete cascade,

  redeemed_at     timestamptz not null default now(),

  -- The first month money actually ARRIVED. Written once by the Stripe webhook
  -- on invoice.paid and never bumped by a renewal, so "first subscribed month"
  -- stays the first one. Null while they are on Free, which is a normal and
  -- expected state, not missing data.
  first_paid_at   timestamptz,
  first_paid_plan text check (first_paid_plan in ('pro','max')),

  -- Manual payout tracking, moved by an admin through admin_set_referral_payout.
  -- 'na' until they subscribe: see rule 1 in the header.
  payout_status   text not null default 'na' check (payout_status in ('na','unpaid','paid')),
  payout_at       timestamptz,
  payout_note     text check (payout_note is null or length(payout_note) <= 500),

  -- Set when the teacher HAD claimed a code but Stripe refused it at checkout
  -- (expired, redemption cap reached, deactivated). The referral deliberately
  -- survives and the ambassador is still owed: they did bring this teacher in,
  -- and only the discount went stale. This column exists so the admin console
  -- can say so plainly instead of leaving someone to wonder why the charge was
  -- full price.
  discount_failed_reason text check (discount_failed_reason is null
                                     or length(discount_failed_reason) <= 200),

  -- A payout cannot be owed or settled before money has arrived. Belt and braces
  -- alongside the check inside admin_set_referral_payout: the RPC gives a decent
  -- error message, and this makes the bad state unrepresentable even if some
  -- future code path writes the column directly.
  constraint ambassador_referrals_payout_needs_payment check (
    payout_status = 'na' or first_paid_at is not null
  )
);

alter table ambassador_referrals enable row level security;

drop policy if exists "admins manage ambassador referrals" on ambassador_referrals;
create policy "admins manage ambassador referrals" on ambassador_referrals
  for all using (is_admin()) with check (is_admin());

-- NO teacher-facing policy, and deliberately no anon insert policy.
--
-- Public and self-service writes go through a security definer function instead,
-- which grants exactly one operation where a policy would grant the whole table.
-- This is the same conclusion 20260805000300_generated_images_rls_hardening.sql
-- and 20260908000000_enquiries.sql both reached; claim_ambassador_code() below
-- is the only way a teacher's own referral is ever written.

create index if not exists ambassador_referrals_ambassador_idx
  on ambassador_referrals (ambassador_id, redeemed_at desc);
create index if not exists ambassador_referrals_payout_idx
  on ambassador_referrals (payout_status);
create index if not exists ambassador_codes_ambassador_idx
  on ambassador_codes (ambassador_id);
-- Codes are matched case-insensitively at signup, the way Stripe matches them.
create unique index if not exists ambassador_codes_code_lower_idx
  on ambassador_codes (lower(code));


-- ── Read: the ambassador list ────────────────────────────────────────────────
-- One row per ambassador with the counts the table header shows, so the page
-- does not have to pull every referral to size a collapsed row.
create or replace function admin_ambassadors()
returns table (
  id             uuid,
  full_name      text,
  email          text,
  status         text,
  user_id        uuid,
  notes          text,
  created_at     timestamptz,
  codes          text[],
  referrals      bigint,
  subscribers    bigint,
  owed           bigint,
  paid           bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  return query
  select
    a.id,
    a.full_name,
    a.email,
    a.status,
    a.user_id,
    a.notes,
    a.created_at,
    coalesce(
      (select array_agg(c.code order by c.created_at)
         from ambassador_codes c where c.ambassador_id = a.id),
      array[]::text[]
    ),
    (select count(*) from ambassador_referrals r where r.ambassador_id = a.id),
    -- "Subscribers" means money actually arrived, not merely that they hold a
    -- paid plan today: a comp would otherwise inflate an ambassador's numbers.
    (select count(*) from ambassador_referrals r
      where r.ambassador_id = a.id and r.first_paid_at is not null),
    (select count(*) from ambassador_referrals r
      where r.ambassador_id = a.id and r.payout_status = 'unpaid'),
    (select count(*) from ambassador_referrals r
      where r.ambassador_id = a.id and r.payout_status = 'paid')
  from ambassadors a
  order by a.created_at desc;
end;
$$;

revoke execute on function admin_ambassadors() from anon, public;
grant execute on function admin_ambassadors() to authenticated;

comment on function admin_ambassadors() is
  'Ambassadors with their codes and referral counts. "subscribers" counts referrals whose first payment actually arrived, so comped teachers are excluded.';


-- ── Read: one ambassador's referrals ─────────────────────────────────────────
-- The rows behind the expanded dropdown. Reads the teacher's CURRENT plan
-- alongside the plan they first paid on, so a lapsed subscriber shows honestly
-- rather than being frozen at whatever they bought once.
create or replace function admin_ambassador_referrals(p_ambassador_id uuid)
returns table (
  id                     uuid,
  user_id                uuid,
  teacher_name           text,
  teacher_email          text,
  joined_at              timestamptz,
  first_paid_at          timestamptz,
  first_paid_plan        text,
  current_plan           text,
  payout_status          text,
  payout_at              timestamptz,
  payout_note            text,
  discount_failed_reason text,
  code                   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  return query
  select
    r.id,
    r.user_id,
    btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')),
    u.email::text,
    r.redeemed_at,
    r.first_paid_at,
    r.first_paid_plan,
    coalesce(p.plan, 'free'),
    r.payout_status,
    r.payout_at,
    r.payout_note,
    r.discount_failed_reason,
    c.code
  from ambassador_referrals r
  join ambassador_codes c on c.id = r.code_id
  left join profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
  where r.ambassador_id = p_ambassador_id
  order by r.redeemed_at desc;
end;
$$;

revoke execute on function admin_ambassador_referrals(uuid) from anon, public;
grant execute on function admin_ambassador_referrals(uuid) to authenticated;


-- ── Write: create an ambassador ──────────────────────────────────────────────
-- jsonb payload rather than a positional signature, matching
-- admin_create_school: the modal grows fields over time and a 6-argument
-- function breaks every caller each time one is added.
create or replace function admin_create_ambassador(payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_name  text;
  v_email text;
  v_user  uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  v_name  := nullif(btrim(coalesce(payload->>'full_name', '')), '');
  v_email := lower(nullif(btrim(coalesce(payload->>'email', '')), ''));

  if v_name is null then
    raise exception 'an ambassador needs a name';
  end if;
  if v_email is null then
    raise exception 'an ambassador needs an email';
  end if;

  -- Link to their Jooma account when one exists. Not required: an ambassador is
  -- often signed up before they have logged in, and refusing to create the row
  -- would block the code being handed out. The admin page shows whether the
  -- link resolved.
  select u.id into v_user from auth.users u where lower(u.email) = v_email;

  insert into ambassadors (full_name, email, user_id, notes, created_by)
  values (
    v_name,
    v_email,
    v_user,
    nullif(btrim(coalesce(payload->>'notes', '')), ''),
    auth.uid()
  )
  returning id into v_id;

  perform admin_log(
    format('Added ambassador %s', v_name),
    'billing',
    'ambassador',
    v_id::text,
    v_name,
    jsonb_build_object('email', v_email, 'linked_user', v_user is not null)
  );

  return v_id;
end;
$$;

revoke execute on function admin_create_ambassador(jsonb) from anon, public;
grant execute on function admin_create_ambassador(jsonb) to authenticated;


-- ── Write: attach a Stripe code to an ambassador ─────────────────────────────
-- The code itself is created in Stripe by /api/admin/promos, which already
-- handles validation, immutability and audit logging. This only records who it
-- belongs to.
create or replace function admin_attach_ambassador_code(
  p_ambassador_id     uuid,
  p_promotion_code_id text,
  p_code              text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select full_name into v_name from ambassadors where id = p_ambassador_id;
  if v_name is null then
    raise exception 'no such ambassador';
  end if;

  if coalesce(p_promotion_code_id, '') not like 'promo\_%' then
    raise exception 'a Stripe promotion code id is required';
  end if;

  insert into ambassador_codes (ambassador_id, promotion_code_id, code)
  values (p_ambassador_id, p_promotion_code_id, upper(btrim(p_code)))
  returning id into v_id;

  perform admin_log(
    format('Attached code %s to ambassador %s', upper(btrim(p_code)), v_name),
    'billing',
    'ambassador_code',
    v_id::text,
    upper(btrim(p_code)),
    jsonb_build_object('ambassador_id', p_ambassador_id, 'promotion_code_id', p_promotion_code_id)
  );

  return v_id;
end;
$$;

revoke execute on function admin_attach_ambassador_code(uuid, text, text) from anon, public;
grant execute on function admin_attach_ambassador_code(uuid, text, text) to authenticated;


-- ── Write: move a payout ─────────────────────────────────────────────────────
-- The ONLY writer of payout_status. Refuses to make a referral payable before
-- money has arrived, which is the rule the whole feature rests on: Free is
-- tracked but never paid for, and neither is a comp.
create or replace function admin_set_referral_payout(
  p_referral_id uuid,
  p_status      text,
  p_note        text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  if p_status not in ('na', 'unpaid', 'paid') then
    raise exception 'unknown payout status';
  end if;

  select * into r from ambassador_referrals where id = p_referral_id;
  if r is null then
    raise exception 'no such referral';
  end if;

  -- The guard. A referral with no first payment is either still on Free or is a
  -- comp, and neither earns a payout.
  if p_status <> 'na' and r.first_paid_at is null then
    raise exception 'this teacher has not paid for a subscription yet, so there is nothing to pay out';
  end if;

  update ambassador_referrals
     set payout_status = p_status,
         payout_at     = case when p_status = 'paid' then now() else null end,
         payout_note   = coalesce(nullif(btrim(coalesce(p_note, '')), ''), payout_note)
   where id = p_referral_id;

  perform admin_log(
    format('Marked ambassador payout %s', p_status),
    'billing',
    'ambassador_referral',
    p_referral_id::text,
    coalesce(r.first_paid_plan, 'free'),
    jsonb_build_object('from', r.payout_status, 'to', p_status)
  );
end;
$$;

revoke execute on function admin_set_referral_payout(uuid, text, text) from anon, public;
grant execute on function admin_set_referral_payout(uuid, text, text) to authenticated;


-- ── Write: a teacher claims a code ───────────────────────────────────────────
-- Called by /api/ambassadors/claim for the SIGNED-IN user only. Security
-- definer and granted to authenticated, because ambassador_referrals has no
-- teacher-facing policy by design.
--
-- Two things this deliberately does NOT do:
--
--   - It never grants a plan or a discount. It records attribution; Stripe
--     applies the discount at checkout. Anything else would be a self-service
--     upgrade, which is exactly what 20260811000400 exists to prevent.
--   - It never reassigns an existing referral. `on conflict do nothing` means a
--     teacher who already has one keeps it, so a second code cannot move them
--     between ambassadors.
create or replace function claim_ambassador_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    record;
  v_claimed boolean;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, c.ambassador_id, c.code, a.status
    into v_code
    from ambassador_codes c
    join ambassadors a on a.id = c.ambassador_id
   where lower(c.code) = lower(btrim(p_code));

  if v_code is null then
    return jsonb_build_object('claimed', false, 'reason', 'unknown_code');
  end if;

  -- A paused ambassador stops taking new referrals. Existing ones are untouched.
  if v_code.status <> 'active' then
    return jsonb_build_object('claimed', false, 'reason', 'inactive');
  end if;

  insert into ambassador_referrals (ambassador_id, code_id, user_id)
  values (v_code.ambassador_id, v_code.id, v_uid)
  on conflict (user_id) do nothing;

  v_claimed := found;

  return jsonb_build_object(
    'claimed', v_claimed,
    'code', v_code.code,
    -- Distinguishes "you already have a code" from a failure, so the UI can say
    -- something true rather than reporting an error for a harmless repeat.
    'reason', case when v_claimed then null else 'already_claimed' end
  );
end;
$$;

revoke execute on function claim_ambassador_code(text) from anon, public;
grant execute on function claim_ambassador_code(text) to authenticated;

comment on function claim_ambassador_code(text) is
  'Records the signed-in teacher as referred by the ambassador who owns this code. Grants nothing: the discount is applied by Stripe at checkout. First code wins and is never reassigned.';
