/*
 * Colleagues and sharing: an end to end check against a real database.
 *
 *   node scripts/verify-colleagues.mjs
 *
 * WHAT THIS IS FOR
 *
 * The schema can look right and still be wrong. This asserts the BEHAVIOUR that
 * the migration's comments claim, and in particular the four things that would
 * be a security bug rather than a broken feature:
 *
 *   - a colleague edge cannot be forged from the browser
 *   - stats are unreadable without an accepted connection
 *   - a profile's private columns (phone, plan, Stripe) never leave the table
 *   - a share cannot be pushed at somebody you are not connected to
 *
 * HOW IT PROVES ANYTHING
 *
 * Two throwaway users are created with the service role, then every assertion
 * runs through the ANON key as one of those users. That distinction is the
 * whole point: the service role bypasses RLS, so a test written against it
 * would pass no matter how wrong the policies were.
 *
 * It cleans up after itself, including when it fails part way through.
 *
 * RUN IT ON STAGING. It creates and deletes users.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/* ── Environment ─────────────────────────────────────────────────────────── */

// .env.local by hand: this is a standalone script, so there is no Next.js
// runtime to load it. The \r strip matters on Windows, where the file has CRLF
// endings and a trailing carriage return otherwise ends up inside every value.
for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (line === "" || line.startsWith("#")) continue;
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/* ── Reporting ───────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const stamp = Date.now();
const PEOPLE = {
  alice: { email: `verify-a-${stamp}@jooma.test`, password: `pw-${stamp}-aaa`, username: `vera${stamp}`.slice(0, 20) },
  bob: { email: `verify-b-${stamp}@jooma.test`, password: `pw-${stamp}-bbb`, username: `verb${stamp}`.slice(0, 20) },
  carol: { email: `verify-c-${stamp}@jooma.test`, password: `pw-${stamp}-ccc`, username: `verc${stamp}`.slice(0, 20) },
};

/** A client signed in as this person, holding a real user JWT. */
async function signIn(person) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw new Error(`Could not sign in ${person.email}: ${error.message}`);
  return client;
}

async function createPeople() {
  for (const [name, person] of Object.entries(PEOPLE)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: person.email,
      password: person.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not create ${name}: ${error.message}`);
    person.id = data.user.id;

    // The profile row, with the private columns filled in so the leak test has
    // something real to look for. /complete-profile normally writes this.
    const { error: pe } = await admin.from("profiles").upsert({
      id: person.id,
      first_name: name[0].toUpperCase() + name.slice(1),
      surname: "Testerson",
      username: person.username,
      phone: "07700900123",
      country: "GB",
    });
    if (pe) throw new Error(`Could not write ${name}'s profile: ${pe.message}`);
  }
}

async function cleanUp() {
  for (const person of Object.values(PEOPLE)) {
    if (person.id) {
      await admin.auth.admin.deleteUser(person.id).catch(() => {});
    }
  }
}

/* ── The checks ──────────────────────────────────────────────────────────── */

async function run() {
  await createPeople();

  const alice = await signIn(PEOPLE.alice);
  const bob = await signIn(PEOPLE.bob);
  const carol = await signIn(PEOPLE.carol);

  const A = PEOPLE.alice.id;
  const B = PEOPLE.bob.id;
  const C = PEOPLE.carol.id;

  /* ── The authorisation boundary ─────────────────────────────────────── */

  section("The authorisation boundary");

  // The one that matters most. An edge authorises reading someone's statistics
  // and writing into their share feed, so forging one is a full bypass.
  {
    const { error } = await alice.from("colleague_edges").insert({ user_id: A, other_id: B });
    check("colleague_edges INSERT is refused from the browser", error !== null,
      error ? "" : "A CONNECTION WAS FORGED. colleague_edges has an insert grant or policy it must not have.");
  }

  // Before any connection: stats must be silent.
  {
    const { data } = await alice.rpc("colleague_stats", { colleague_ids: [B] });
    check("colleague_stats returns nothing for a stranger", (data ?? []).length === 0,
      `Returned ${(data ?? []).length} row(s) for someone with no connection.`);
  }

  {
    const { data } = await alice.rpc("colleague_profiles", { colleague_ids: [B] });
    check("colleague_profiles returns nothing for a stranger", (data ?? []).length === 0,
      `Returned ${(data ?? []).length} row(s) for someone with no connection.`);
  }

  // A share to someone you are not connected to would make this table an
  // unsolicited message channel.
  {
    const { error } = await alice.from("shares").insert({
      recipient_id: B, tool_slug: "lesson-planner", title: "Uninvited", output: "x",
    });
    check("shares INSERT to a non-colleague is refused", error !== null,
      error ? "" : "ARBITRARY TEXT CAN BE PUSHED INTO A STRANGER'S FEED.");
  }

  /* ── Profile privacy ────────────────────────────────────────────────── */

  section("Profile privacy");

  // Direct read of another teacher's row, connected or not, must return nothing.
  {
    const { data } = await alice.from("profiles").select("*").eq("id", B);
    check("profiles is not directly readable for another user", (data ?? []).length === 0,
      `Read ${(data ?? []).length} row(s) of somebody else's profile.`);
  }

  /* ── Connecting ─────────────────────────────────────────────────────── */

  section("Connecting");

  let requestId = null;
  {
    const { error } = await alice.from("colleague_requests").insert({ recipient_id: B });
    check("a request can be sent", error === null, error?.message);

    const { data } = await bob.from("colleague_requests").select("id, sender_id").eq("recipient_id", B);
    requestId = data?.[0]?.id ?? null;
    check("the recipient sees the incoming request", data?.length === 1 && data[0].sender_id === A);
  }

  // A request is not a connection: stats stay closed until it is accepted.
  {
    const { data } = await alice.rpc("colleague_stats", { colleague_ids: [B] });
    check("a pending request does not expose stats", (data ?? []).length === 0,
      "Stats were readable before the request was accepted.");
  }

  // Only the addressee can accept. Carol accepting Alice's request to Bob would
  // let anyone connect themselves to anyone.
  {
    const { error } = await carol.rpc("accept_colleague_request", { request_id: requestId });
    check("a third party cannot accept somebody else's request", error !== null,
      error ? "" : "CAROL ACCEPTED A REQUEST ADDRESSED TO BOB.");
  }

  {
    const { error } = await bob.rpc("accept_colleague_request", { request_id: requestId });
    check("the recipient can accept", error === null, error?.message);
  }

  // Both directions, written atomically. A one-sided pair would mean one
  // teacher can read the other but not vice versa.
  {
    const { data: aSide } = await alice.from("colleague_edges").select("other_id");
    const { data: bSide } = await bob.from("colleague_edges").select("other_id");
    check("accepting writes both directions",
      aSide?.some((e) => e.other_id === B) && bSide?.some((e) => e.other_id === A));
  }

  {
    const { data } = await bob.from("colleague_requests").select("id").eq("id", requestId);
    check("the request is consumed on accept", (data ?? []).length === 0);
  }

  /* ── What a connection opens up ─────────────────────────────────────── */

  section("What a connection opens up");

  {
    const { data } = await alice.rpc("colleague_profiles", { colleague_ids: [B] });
    const row = data?.[0];
    check("a colleague's name is readable", row?.first_name === "Bob", JSON.stringify(row));

    // The reason colleague_profiles exists instead of an RLS policy.
    const leaked = row ? Object.keys(row).filter((k) => k !== "user_id" && !["first_name", "surname", "username", "avatar_url"].includes(k)) : [];
    check("colleague_profiles returns ONLY the four display columns", leaked.length === 0,
      leaked.length ? `LEAKED: ${leaked.join(", ")}` : "");
  }

  // Still no direct table read, even now they are connected.
  {
    const { data } = await alice.from("profiles").select("phone, plan").eq("id", B);
    check("a colleague still cannot read phone or plan directly", (data ?? []).length === 0,
      `Read ${(data ?? []).length} row(s) including private columns.`);
  }

  {
    const { data } = await alice.rpc("colleague_stats", { colleague_ids: [B] });
    check("stats become readable once connected", (data ?? []).length === 1, JSON.stringify(data));

    const row = data?.[0];
    const shape = row && "resources_made" in row && "badges_earned" in row
      && "active_day_keys" in row && "slug_counts" in row;
    check("stats return evidence, not a computed streak", shape && !("streak" in row),
      row ? `Got: ${Object.keys(row).join(", ")}` : "");
  }

  // Carol is connected to nobody, so the join in colleague_stats is doing the
  // work rather than the argument list.
  {
    const { data } = await carol.rpc("colleague_stats", { colleague_ids: [A, B] });
    check("an unconnected third party still sees nothing", (data ?? []).length === 0,
      `Carol read ${(data ?? []).length} row(s) she has no connection to.`);
  }

  /* ── Sharing ────────────────────────────────────────────────────────── */

  section("Sharing");

  // A resource of Alice's to share. Written as Alice, through RLS.
  const { data: run, error: runError } = await alice
    .from("tool_runs")
    .insert({ tool_slug: "lesson-planner", title: "Fractions", input: {}, output: "ORIGINAL" })
    .select()
    .single();
  if (runError) throw new Error(`Could not create a test resource: ${runError.message}`);

  let shareId = null;
  {
    const { error } = await alice.from("shares").insert({
      recipient_id: B, source_run_id: run.id, tool_slug: run.tool_slug,
      title: run.title, input: {}, output: run.output,
    });
    check("a resource can be shared with a colleague", error === null, error?.message);
  }

  {
    const { data } = await bob.from("shares").select("id, title, output").eq("recipient_id", B);
    shareId = data?.[0]?.id ?? null;
    check("it lands in the recipient's feed", data?.length === 1 && data[0].title === "Fractions");
  }

  // Bob must not have gained a resource. The offer is not the copy.
  {
    const { data } = await bob.from("tool_runs").select("id");
    check("nothing has entered the recipient's library yet", (data ?? []).length === 0,
      `The recipient has ${(data ?? []).length} resource(s) they never accepted.`);
  }

  {
    const { error } = await alice.from("shares").insert({
      recipient_id: B, source_run_id: run.id, tool_slug: run.tool_slug,
      title: run.title, input: {}, output: run.output,
    });
    check("sharing the same resource twice is refused", error !== null,
      error ? "" : "A duplicate feed row was created.");
  }

  // The snapshot is the promise: what was offered must not change afterwards.
  {
    await alice.from("tool_runs").update({ output: "EDITED AFTER SHARING" }).eq("id", run.id);
    const { data } = await bob.from("shares").select("output").eq("id", shareId);
    check("editing the original does not alter what was offered", data?.[0]?.output === "ORIGINAL",
      `Feed now shows: ${data?.[0]?.output}`);
  }

  {
    await alice.from("tool_runs").delete().eq("id", run.id);
    const { data } = await bob.from("shares").select("id, output").eq("id", shareId);
    check("deleting the original does not withdraw the share",
      data?.length === 1 && data[0].output === "ORIGINAL");
  }

  // The sender must not be able to rewrite a snapshot already in a feed.
  {
    const { error } = await alice.from("shares").update({ output: "SWAPPED" }).eq("id", shareId);
    const { data } = await bob.from("shares").select("output").eq("id", shareId);
    check("the sender cannot rewrite a share after sending it",
      data?.[0]?.output === "ORIGINAL",
      error ? "" : "THE SNAPSHOT WAS REWRITTEN IN THE RECIPIENT'S FEED.");
  }

  // The guard trigger: the recipient owns the row but may only stamp it.
  {
    const { error } = await bob.from("shares").update({ output: "TAMPERED" }).eq("id", shareId);
    check("the recipient cannot rewrite the snapshot either", error !== null,
      error ? "" : "The deny-list trigger did not fire.");
  }

  /* ── Saving to the library ──────────────────────────────────────────── */

  section("Saving to the library");

  {
    const { data: share } = await bob.from("shares").select("*").eq("id", shareId).single();
    const { data: copy, error } = await bob.from("tool_runs").insert({
      tool_slug: share.tool_slug, title: share.title, input: share.input, output: share.output,
    }).select().single();
    check("the recipient can save their own copy", error === null, error?.message);

    if (copy) {
      const { error: stampError } = await bob.from("shares")
        .update({ saved_at: new Date().toISOString(), saved_run_id: copy.id })
        .eq("id", shareId);
      check("the share can be stamped as saved", stampError === null, stampError?.message);

      check("the copy carries the original content", copy.output === "ORIGINAL");
    }
  }

  /* ── Search ─────────────────────────────────────────────────────────── */

  section("Search");

  {
    const { data } = await alice.rpc("find_colleagues", { q: PEOPLE.carol.username });
    check("an exact username is found", data?.some((r) => r.user_id === C), JSON.stringify(data));

    const row = data?.find((r) => r.user_id === C);
    const leaked = row ? Object.keys(row).filter((k) => !["user_id", "first_name", "surname", "username", "avatar_url", "status"].includes(k)) : [];
    check("search never returns an email or a private column", leaked.length === 0,
      leaked.length ? `LEAKED: ${leaked.join(", ")}` : "");
  }

  {
    // The point of dropping the name branches: a surname must not walk the
    // staffroom. See 20260912000000.
    const { data } = await alice.rpc("find_colleagues", { q: "Testers" });
    check("a name prefix finds nobody", (data ?? []).length === 0,
      "A NAME PREFIX MATCHED. find_colleagues is still enumerable by name.");
  }

  {
    const { data } = await alice.rpc("find_colleagues", { q: PEOPLE.carol.email });
    check("an exact email is found", data?.some((r) => r.user_id === C));
  }

  {
    // The point of exact-match-only on email: a prefix must not walk addresses.
    const { data } = await alice.rpc("find_colleagues", { q: PEOPLE.carol.email.slice(0, 12) });
    check("a partial email finds nobody", !data?.some((r) => r.user_id === C),
      "AN EMAIL PREFIX MATCHED. find_colleagues is scraping addresses.");
  }

  {
    const { data } = await alice.rpc("find_colleagues", { q: "ab" });
    check("a two character term returns nothing", (data ?? []).length === 0);
  }

  {
    const { data } = await alice.rpc("find_colleagues", { q: PEOPLE.alice.username });
    check("you never find yourself", !data?.some((r) => r.user_id === A));
  }

  {
    const { data } = await alice.rpc("find_colleagues", { q: PEOPLE.bob.username });
    check("a connected colleague reads as connected",
      data?.find((r) => r.user_id === B)?.status === "connected",
      `status was: ${data?.find((r) => r.user_id === B)?.status}`);
  }

  /* ── Removing ───────────────────────────────────────────────────────── */

  section("Removing a colleague");

  {
    await alice.from("colleague_edges").delete().eq("user_id", A).eq("other_id", B);
    await bob.from("colleague_edges").delete().eq("user_id", B).eq("other_id", A);

    const { data } = await alice.rpc("colleague_stats", { colleague_ids: [B] });
    check("stats close again once disconnected", (data ?? []).length === 0,
      "Stats were still readable after the connection was removed.");
  }

  {
    const { data } = await bob.from("shares").select("id").eq("id", shareId);
    check("an already delivered share survives the disconnection", data?.length === 1);
  }
}

/* ── Go ──────────────────────────────────────────────────────────────────── */

console.log(`Verifying colleagues against ${URL}\n`);

try {
  await run();
} catch (error) {
  console.error(`\nThe run stopped early: ${error.message}`);
  failures.push({ name: "the script itself", detail: error.message });
} finally {
  await cleanUp();
}

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`All ${passed} checks passed. Test users removed.`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED. Test users removed.\n`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `\n    ${f.detail}` : ""}`);
  process.exit(1);
}
