import { createClient } from "@/app/lib/auth/client";
import { streakFrom } from "@/app/lib/badgeCriteria";
import { minutesSavedFor } from "@/app/lib/tools";
import type { ToolRun } from "@/app/lib/toolRuns";
import { fireToolRunSaved } from "@/app/lib/toolRuns";

/*
 * Colleagues, connections and sharing. Persisted to colleague_requests,
 * colleague_edges and shares (see supabase/migrations/20260904000000_colleagues.sql).
 *
 * Unlike every other data module here, this one is not purely RLS-scoped reads.
 * Three of its calls are security definer RPCs, because three of the questions
 * this feature asks are about ANOTHER teacher's data: who exists, what have they
 * made, and may I write to them. RLS can express "my own rows" and nothing else,
 * and every policy that would answer those questions instead would also expose
 * resource bodies. The migration header sets out the reasoning per function.
 *
 * Follows userBadges.ts rather than folders.ts on failure: a missing table or
 * function returns an empty result instead of throwing. This ships before the
 * migration is applied by hand, and a throw on the Colleagues page mount would
 * take the screen down over a feature that has no data yet anyway.
 */

/** Postgres 42P01 is undefined_table, 42883 undefined_function. PostgREST also
 *  reports an unknown relation as PGRST205 before it reaches Postgres. */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING.has(error.code)) return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("does not exist") || message.includes("could not find");
}

/** The shape every teacher-facing row renders from. `user_id` is theirs, not
 *  the viewer's. */
export interface ColleagueProfile {
  user_id: string;
  first_name: string | null;
  surname: string | null;
  username: string | null;
  avatar_url: string | null;
}

export type ColleagueStatus = "none" | "pending_out" | "pending_in" | "connected";

export interface ColleagueSearchResult extends ColleagueProfile {
  status: ColleagueStatus;
}

export interface Colleague extends ColleagueProfile {
  connected_at: string;
}

export interface ColleagueRequest {
  id: string;
  created_at: string;
  profile: ColleagueProfile;
}

/**
 * Raw evidence for the four headline metrics, deliberately not the metrics.
 *
 * See colleagueMetrics below, and the migration header: the streak rule and the
 * minutes-per-tool table live in TypeScript and restating either in SQL would
 * be a second copy of a rule that moves.
 */
export interface ColleagueStatsRow {
  user_id: string;
  resources_made: number;
  badges_earned: number;
  /** Distinct Europe/London day keys, last 400 days. Fed to streakFrom. */
  active_day_keys: string[];
  /** tool_slug to run count. Fed to minutesSavedFor. */
  slug_counts: Record<string, number>;
}

/** What a colleague row actually displays. */
export interface ColleagueMetrics {
  streak: number;
  resources: number;
  badges: number;
  minutesSaved: number;
}

/* ── Names and faces ───────────────────────────────────────────────────────── */

function toProfile(row: unknown, userId: string): ColleagueProfile {
  const p = (row ?? {}) as Partial<ColleagueProfile>;
  return {
    user_id: userId,
    first_name: p.first_name ?? null,
    surname: p.surname ?? null,
    username: p.username ?? null,
    avatar_url: p.avatar_url ?? null,
  };
}

/**
 * Name, handle and photo for a batch of people.
 *
 * A definer RPC rather than a PostgREST embed off a foreign key. An embed would
 * be one query instead of two, but it only returns rows the caller can already
 * read, and `profiles` is own-row-only, so it would come back null for every
 * colleague. Making it work needs a read policy on profiles, and a policy grants
 * the WHOLE ROW: phone, country, plan, Stripe ids, suspension history. None of
 * that belongs to this feature. The function returns four columns and cannot
 * grow to leak a fifth by accident.
 *
 * Returns a Map so callers can look up by id without a nested find.
 */
async function profilesFor(userIds: string[]): Promise<Map<string, ColleagueProfile>> {
  const out = new Map<string, ColleagueProfile>();
  if (userIds.length === 0) return out;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("colleague_profiles", {
    colleague_ids: userIds,
  });

  if (error) {
    if (isMissingSchema(error)) return out;
    throw error;
  }

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = row.user_id as string;
    out.set(id, toProfile(row, id));
  }
  return out;
}

/* ── Connections ───────────────────────────────────────────────────────────── */

/**
 * Everyone this teacher is connected to.
 *
 * A single equality rather than a two-branch OR, because colleague_edges stores
 * both directions. See the migration header for why that shape was chosen.
 */
export async function listColleagues(): Promise<Colleague[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colleague_edges")
    .select("other_id, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }

  const edges = (data ?? []) as { other_id: string; created_at: string }[];
  const profiles = await profilesFor(edges.map((e) => e.other_id));

  return edges.map((e) => ({
    ...(profiles.get(e.other_id) ?? toProfile(null, e.other_id)),
    connected_at: e.created_at,
  }));
}

/**
 * Search by username or email, both exact.
 *
 * Names are deliberately not searchable: a prefix match on a surname lets
 * anybody with an account walk the alphabet and assemble a directory of real
 * teachers. See 20260912000000 for the reversal and its reasoning.
 *
 * A definer RPC, not a query: profiles is select-own-row-only and email is not
 * on profiles at all. Every bound (exact match on email and username, a three
 * character floor, ten results, no email in the result) lives in the function.
 * This only passes the term through, so the bounds cannot be loosened from the
 * browser.
 */
export async function findColleagues(query: string): Promise<ColleagueSearchResult[]> {
  const term = query.trim();
  if (term.length < 3) return [];

  const supabase = createClient();
  const { data, error } = await supabase.rpc("find_colleagues", { q: term });

  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...toProfile(row, row.user_id as string),
    status: (row.status as ColleagueStatus) ?? "none",
  }));
}

/** Ask to connect. Grants nothing until they accept. */
export async function requestColleague(userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("colleague_requests")
    .insert({ recipient_id: userId });
  // A duplicate is the request already being pending, which is the state the
  // caller wanted. 23505 is unique_violation.
  if (error && error.code !== "23505") throw error;
}

/** Requests waiting on this teacher. */
export async function listIncomingRequests(): Promise<ColleagueRequest[]> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) return [];

  // Incoming only. RLS lets both parties read the row, so filtering on
  // recipient_id here is what separates "waiting on you" from "waiting on them".
  const { data, error } = await supabase
    .from("colleague_requests")
    .select("id, created_at, sender_id")
    .eq("recipient_id", me)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }

  const rows = (data ?? []) as { id: string; created_at: string; sender_id: string }[];
  const profiles = await profilesFor(rows.map((r) => r.sender_id));

  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    profile: profiles.get(r.sender_id) ?? toProfile(null, r.sender_id),
  }));
}

/**
 * Accept. Writes both edges in one statement inside a definer function, which
 * is the only path into colleague_edges: see the migration header for why that
 * table has no insert policy.
 */
export async function acceptColleagueRequest(requestId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("accept_colleague_request", {
    request_id: requestId,
  });
  if (error) throw error;
}

/** Decline, or withdraw one you sent. Deleted rather than marked: a refusal is
 *  not a record anybody needs to be able to read back. */
export async function deleteColleagueRequest(requestId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("colleague_requests").delete().eq("id", requestId);
  if (error) throw error;
}

/**
 * Remove a colleague.
 *
 * Deletes both directions. RLS only permits deleting the row where you are
 * user_id, so the second delete is a no-op unless the policy is ever widened;
 * it is issued anyway so the intent is in one place. If only one lands, the
 * surviving edge grants the OTHER person access, which is the safe direction to
 * fail in.
 */
export async function removeColleague(userId: string): Promise<void> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;

  const { error } = await supabase
    .from("colleague_edges")
    .delete()
    .or(`and(user_id.eq.${me},other_id.eq.${userId}),and(user_id.eq.${userId},other_id.eq.${me})`);
  if (error) throw error;
}

/* ── Their numbers ─────────────────────────────────────────────────────────── */

/**
 * The evidence behind the four metrics, for a batch of colleagues.
 *
 * One round trip for the whole list rather than one per row: the page renders
 * six of these at once and six sequential RPCs is six times the latency for the
 * same answer.
 *
 * An id with no accepted connection simply produces no entry. The caller renders
 * a row without numbers rather than treating it as an error, because that is
 * also what a brand new colleague with no history looks like.
 */
export async function colleagueStats(
  userIds: string[],
): Promise<Map<string, ColleagueStatsRow>> {
  const out = new Map<string, ColleagueStatsRow>();
  if (userIds.length === 0) return out;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("colleague_stats", {
    colleague_ids: userIds,
  });

  if (error) {
    if (isMissingSchema(error)) return out;
    throw error;
  }

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = row.user_id as string;
    out.set(id, {
      user_id: id,
      resources_made: Number(row.resources_made ?? 0),
      badges_earned: Number(row.badges_earned ?? 0),
      active_day_keys: (row.active_day_keys as string[] | null) ?? [],
      slug_counts: (row.slug_counts as Record<string, number> | null) ?? {},
    });
  }
  return out;
}

/**
 * The four headline numbers, from the evidence.
 *
 * Deliberately here and not in SQL. Every one of these is already computed for
 * the teacher's own dashboard by code in this repo, and a colleague's row must
 * show the same number that colleague sees on their own Today. Two
 * implementations guarantee they eventually differ, and the one that would
 * differ first is the streak, whose rule is the most argued-over in the product.
 */
export function colleagueMetrics(row: ColleagueStatsRow, now: Date): ColleagueMetrics {
  let minutes = 0;
  for (const [slug, count] of Object.entries(row.slug_counts)) {
    minutes += minutesSavedFor(slug) * count;
  }
  return {
    streak: streakFrom(new Set(row.active_day_keys), now),
    resources: row.resources_made,
    badges: row.badges_earned,
    minutesSaved: minutes,
  };
}

/* ── Shares ────────────────────────────────────────────────────────────────── */

export interface Share {
  id: string;
  sender_id: string;
  recipient_id: string;
  source_run_id: string | null;
  tool_slug: string;
  title: string | null;
  input: Record<string, unknown>;
  output: string;
  created_at: string;
  saved_at: string | null;
  saved_run_id: string | null;
  /** Who sent it. Present on the incoming feed, absent on your own sent rows. */
  sender?: ColleagueProfile;
}

/**
 * Offer a resource to colleagues.
 *
 * Copies the payload INTO the share row rather than referencing the original. A
 * share is a copy and a copy is taken when it is made: if the sender edits or
 * deletes their resource tomorrow, what the recipient was offered must not
 * change under them. It is also what lets the recipient's feed render with a
 * plain select instead of a function that reads the sender's rows.
 *
 * One row per recipient, unique on (sender, recipient, source run), so sharing
 * the same thing twice is a no-op rather than a doubled feed row.
 */
export async function shareRun(runId: string, recipientIds: string[]): Promise<void> {
  if (recipientIds.length === 0) return;

  const supabase = createClient();

  // Read the resource first. RLS scopes this to the sender's own rows, so a
  // runId belonging to somebody else returns nothing and the share cannot be
  // forged from a borrowed id.
  const { data: run, error: runError } = await supabase
    .from("tool_runs")
    .select("id, tool_slug, title, input, output")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) throw new Error("That resource could not be found.");

  const { error } = await supabase.from("shares").insert(
    recipientIds.map((recipient_id) => ({
      recipient_id,
      source_run_id: run.id,
      tool_slug: run.tool_slug,
      title: run.title,
      input: run.input ?? {},
      output: run.output,
    })),
  );
  // Already shared with one of them. The teacher's intent is satisfied either
  // way, and telling them off for it would be noise.
  if (error && error.code !== "23505") throw error;
}

/**
 * What colleagues have offered this teacher, newest first.
 *
 * Unsaved only by default: a saved share has become a resource and belongs in
 * the Library, not in a feed still asking to be dealt with.
 */
export async function listSharedWithMe(opts?: { includeSaved?: boolean }): Promise<Share[]> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) return [];

  let query = supabase
    .from("shares")
    .select("*")
    .eq("recipient_id", me)
    .order("created_at", { ascending: false });

  if (!opts?.includeSaved) query = query.is("saved_at", null);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }

  const rows = (data ?? []) as unknown as Share[];
  const profiles = await profilesFor([...new Set(rows.map((r) => r.sender_id))]);

  // A missing sender profile is a real state rather than an error:
  // colleague_profiles only answers for current connections, so if the teacher
  // removed this colleague after the share arrived, the name is no longer
  // readable. The share itself still is, because it is a snapshot they were
  // given. displayName renders "a colleague", which is true and better than
  // dropping a resource out of the feed.
  return rows.map((r) => ({
    ...r,
    sender: profiles.get(r.sender_id) ?? toProfile(null, r.sender_id),
  }));
}

/** How many arrived in the last seven days and are still waiting. Drives the
 *  "3 new this week" line beside the feed heading. */
export function newThisWeek(shares: Share[], now: Date): number {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return shares.filter((s) => !s.saved_at && new Date(s.created_at).getTime() >= cutoff).length;
}

/**
 * Take the copy.
 *
 * Two writes, and both are the recipient's own: insert their tool_runs row from
 * the snapshot, then stamp the share. There is no definer function anywhere in
 * this path, which is the whole reason the copy happens here rather than at
 * share time. The insert is not into somebody else's library, so it needs no
 * privilege to be one.
 *
 * The stamp is second and its failure is swallowed. If it does not land, the
 * teacher has their resource and the row stays in the feed, which is a visible
 * duplicate they can dismiss. The other order risks a share marked saved with
 * no resource behind it, which is a resource silently lost.
 */
export async function saveSharedToLibrary(share: Share): Promise<ToolRun> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tool_runs")
    .insert({
      tool_slug: share.tool_slug,
      title: share.title,
      input: share.input ?? {},
      output: share.output,
    })
    .select()
    .single();
  if (error) throw error;

  const run = data as ToolRun;

  await supabase
    .from("shares")
    .update({ saved_at: new Date().toISOString(), saved_run_id: run.id })
    .eq("id", share.id);

  // Same hook saveToolRun fires, so badge progress re-evaluates and `received`
  // can be earned. A listener must never be able to fail this: the resource is
  // what the teacher pressed the button for.
  fireToolRunSaved();

  return run;
}

/** Dismiss without saving. Deleted rather than kept: an offer declined is not a
 *  fact worth storing, and the sender's own share count is what the share
 *  badges measure. */
export async function dismissShare(shareId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("shares").delete().eq("id", shareId);
  if (error) throw error;
}

/* ── Badge evidence ────────────────────────────────────────────────────────── */

export interface ShareCounts {
  sent: number;
  distinctRecipients: number;
  savedFromOthers: number;
}

/**
 * The counts the six share badges are judged on.
 *
 * Returns null, not zeroes, when the table is not there: the badge store treats
 * null as "this feature does not exist yet" and leaves those badges alone,
 * exactly as it does for folderCount. Zeroes would mean "you have shared
 * nothing", which is a different and wrong statement.
 */
export async function shareCounts(): Promise<ShareCounts | null> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id;
  if (!me) return null;

  const [sent, received] = await Promise.all([
    supabase.from("shares").select("recipient_id").eq("sender_id", me),
    supabase
      .from("shares")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", me)
      .not("saved_at", "is", null),
  ]);

  if (sent.error) {
    if (isMissingSchema(sent.error)) return null;
    throw sent.error;
  }

  const rows = (sent.data ?? []) as { recipient_id: string }[];
  return {
    sent: rows.length,
    distinctRecipients: new Set(rows.map((r) => r.recipient_id)).size,
    savedFromOthers: received.count ?? 0,
  };
}

/* ── Usernames ─────────────────────────────────────────────────────────────── */

/** The shape the CHECK constraint enforces. Kept here so the profile form can
 *  say why a handle was rejected before the round trip. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function usernameProblem(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (v.length < 3) return "Usernames are at least 3 characters.";
  if (v.length > 20) return "Usernames are at most 20 characters.";
  if (!USERNAME_PATTERN.test(v)) {
    return "Use lowercase letters, numbers and underscores only.";
  }
  return null;
}
