-- ── Colleague search: identifiers only ───────────────────────────────────────
--
-- find_colleagues stops matching on names. Email and username, both exact, are
-- the only ways to find somebody from now on.
--
-- WHAT THIS SUPERSEDES
--
-- 20260904000000 argued the other way, and that argument is worth quoting
-- because this migration is a reversal rather than a refinement:
--
--   "NAME MATCHES BY PREFIX, and this is the loosest branch. [...] Somebody
--    patient could walk the alphabet and assemble a partial directory of
--    display names, usernames and avatars, which is the accepted cost of a
--    name-searchable staffroom."
--
-- That cost is no longer accepted. The paragraph is honest about what the
-- feature was: three characters and a limit of ten, repeated, enumerates real
-- teachers' names, usernames and photographs to anyone with an account. The
-- bound it relied on (a three character floor) is not a bound at all against
-- somebody working through "aa", "ab", "ac", and the data it exposes is
-- personal data belonging to people who never chose to be listed.
--
-- Under data minimisation the test is not "is this useful", it is "is the
-- searcher entitled to this". An exact email or an exact username means the
-- searcher already holds the identifier: they were given it, by the colleague
-- they are trying to add. That is the same standard the email branch has always
-- met, and the reason 20260904000000 gave for it applies word for word to names:
-- exact match "confirms membership for an address you already have", whereas a
-- prefix "turns this function into an address book scraper".
--
-- WHAT IS UNCHANGED
--
-- Everything else, deliberately. Same signature, same six output columns, same
-- three character floor, same exclusion of yourself and of suspended accounts,
-- same limit of ten, same grants.
--
-- first_name and surname are still RETURNED. Removing them would mean adding a
-- colleague you cannot identify, and the person on the other side of an exact
-- email match is somebody the searcher already knows by name. The change here is
-- to what can be SEARCHED, not to what a matched row shows: you can no longer
-- discover a stranger by typing letters, which is the enumeration this closes.
--
-- The ordering keeps its exact-username-first term. With the name branches gone
-- every row already matches exactly, so it decides nothing, but it costs nothing
-- and leaving it means this function still sorts sensibly if a looser branch is
-- ever added back.
create or replace function find_colleagues(q text)
returns table (
  user_id    uuid,
  first_name text,
  surname    text,
  username   text,
  avatar_url text,
  status     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- Every output parameter here (first_name, surname, username, avatar_url) is
-- also a column on profiles. See the note on colleague_stats.
#variable_conflict use_column
declare
  uid  uuid := (select auth.uid());
  term text := lower(btrim(coalesce(q, '')));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Kept, though every branch below is now an exact match and a short term
  -- simply finds nothing. It stops a one or two character term reaching the
  -- index at all, and it keeps the floor in one place if a branch is loosened.
  if length(term) < 3 then
    return;
  end if;

  return query
  select p.id,
         p.first_name,
         p.surname,
         p.username,
         p.avatar_url,
         colleague_status(uid, p.id)
    from profiles p
    join auth.users u on u.id = p.id
   where p.id <> uid
     -- A suspended account should not be discoverable. Nobody should be able to
     -- send a request to somebody who cannot answer it.
     and p.suspended_at is null
     -- Both exact. See the header: a prefix on either of these is an
     -- enumeration, and there is no third branch any more.
     and (
       lower(u.email) = term
       or lower(p.username) = term
     )
   order by (lower(p.username) = term) desc, p.surname, p.first_name
   limit 10;
end;
$$;

revoke all on function find_colleagues(text) from public, anon;
grant execute on function find_colleagues(text) to authenticated;
