-- ── Spend and top-up history must outlive the account that generated it ──────
--
-- Found while verifying self-serve account deletion against staging. The
-- assumption everywhere, including the header of app/api/resources/delete,
-- was that the cost tables link to a run by a bare run_id with no foreign key,
-- so the spend history survives anything that happens to the teacher:
--
--   "The spend happened, and monitoring, margin and the cost ceiling all depend
--    on the history staying complete."
--
-- That comment predates the user_id columns. Those arrived later
-- (20260613000000 and friends) as `references auth.users (id) on delete
-- cascade`, and a cascade beats a missing FK: deleting an auth user took the
-- spend rows with it. Confirmed on staging by deleting a throwaway account with
-- one token_usage row and watching the count go 1 -> 0.
--
-- Nothing had noticed because nothing deleted accounts until now. Account
-- deletion turns a dormant inconsistency into monthly data loss, and the
-- tables it silently empties are the ones margin and the cost ceiling are
-- computed from.
--
-- topup_purchases is the same shape and worse in kind: it is the record that a
-- teacher paid us actual money. It cascaded too.
--
-- All four become `on delete set null`, matching invoices.user_id,
-- safeguarding_flags.user_id and support_threads.user_id, which already work
-- this way for exactly this reason. The row survives, anonymised: the spend and
-- the payment stay on the books, the person does not.
--
-- NOTE the deliberate asymmetry with allowance_grants, which keeps its cascade.
-- A granted allowance is an entitlement to future usage, not a record of past
-- money, and an entitlement belonging to nobody is meaningless. It should go
-- with the account.


-- token_usage.user_id and asset_cost.user_id are NOT NULL, so `set null` is not
-- even expressible until the constraint is dropped. Nothing reads these columns
-- expecting them to be present -- every query either filters by a known user or
-- aggregates -- and a null user_id is exactly the "this spend happened, we no
-- longer say whose" signal we want.
alter table token_usage alter column user_id drop not null;
alter table token_usage drop constraint if exists token_usage_user_id_fkey;
alter table token_usage add constraint token_usage_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

alter table asset_cost alter column user_id drop not null;
alter table asset_cost drop constraint if exists asset_cost_user_id_fkey;
alter table asset_cost add constraint asset_cost_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

alter table slide_cost alter column user_id drop not null;
alter table slide_cost drop constraint if exists slide_cost_user_id_fkey;
alter table slide_cost add constraint slide_cost_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- The record of a payment. Same treatment, and the one with the clearest
-- argument: money changed hands, and that stays true after the payer leaves.
alter table topup_purchases alter column user_id drop not null;
alter table topup_purchases drop constraint if exists topup_purchases_user_id_fkey;
alter table topup_purchases add constraint topup_purchases_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
