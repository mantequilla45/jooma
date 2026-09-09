/*
 * Ambassadors: an end to end check against a real database.
 *
 *   node scripts/verify-ambassadors.mjs
 *
 * WHAT THIS IS FOR
 *
 * The schema can look right and still be wrong. This asserts the BEHAVIOUR the
 * migration's comments claim, and in particular the things that would be a
 * security or an accounting bug rather than a broken feature:
 *
 *   - the three tables are unreadable by an ordinary teacher
 *   - a teacher cannot forge a referral, or point one at a different ambassador
 *   - the admin RPCs refuse a non-admin caller
 *   - a referral that has never PAID can never be marked payable, which is what
 *     stops a free signup and an admin comp from earning somebody money
 *   - attribution is first-code-wins and is never reassigned
 *
 * HOW IT PROVES ANYTHING
 *
 * Fixtures are created with the service role, then every assertion runs through
 * the ANON key as one of those users. That distinction is the whole point: the
 * service role bypasses RLS, so a test written against it would pass no matter
 * how wrong the policies were.
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
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.",
  );
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

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const created = { users: [], ambassadors: [] };

async function makeUser(label) {
  const email = `e2e-amb-${label}-${tag}@jooma.test`;
  const password = `Pw-${tag}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create ${label}: ${error.message}`);
  created.users.push(data.user.id);

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    first_name: label,
    surname: "Ambtest",
  });
  if (profileError) throw new Error(`Could not write ${label}'s profile: ${profileError.message}`);

  return { id: data.user.id, email, password };
}

/** A client signed in AS that user, so RLS applies exactly as in the browser. */
async function asUser(user) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Could not sign in as ${user.email}: ${error.message}`);
  return client;
}

async function cleanup() {
  // Referrals and codes cascade from the ambassador; profiles cascade from the
  // auth user. Delete the parents and the rest goes with them.
  for (const id of created.ambassadors) {
    await admin.from("ambassadors").delete().eq("id", id);
  }
  for (const id of created.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

/* ── The run ─────────────────────────────────────────────────────────────── */

async function main() {
  console.log("\nAmbassadors\n");

  const teacher = await makeUser("teacher");
  const other = await makeUser("other");
  const staff = await makeUser("staff");

  // One admin, so the admin-only RPCs have a caller that should succeed.
  await admin.from("profiles").update({ is_admin: true }).eq("id", staff.id);

  const teacherClient = await asUser(teacher);
  const otherClient = await asUser(other);
  const staffClient = await asUser(staff);

  // Two ambassadors with a code each, written through the service role because
  // that is what the admin route does.
  const { data: amb1, error: ambError } = await admin
    .from("ambassadors")
    .insert({ full_name: `ZZ Amb One ${tag}`, email: `zz-one-${tag}@example.com` })
    .select()
    .single();
  if (ambError) throw new Error(`Could not create ambassador: ${ambError.message}`);
  created.ambassadors.push(amb1.id);

  const { data: amb2 } = await admin
    .from("ambassadors")
    .insert({ full_name: `ZZ Amb Two ${tag}`, email: `zz-two-${tag}@example.com` })
    .select()
    .single();
  created.ambassadors.push(amb2.id);

  const codeOne = `ZZAMBONE${tag}`.toUpperCase().slice(0, 40);
  const codeTwo = `ZZAMBTWO${tag}`.toUpperCase().slice(0, 40);

  const { data: code1 } = await admin
    .from("ambassador_codes")
    .insert({ ambassador_id: amb1.id, promotion_code_id: `promo_zz1${tag}`, code: codeOne })
    .select()
    .single();

  await admin
    .from("ambassador_codes")
    .insert({ ambassador_id: amb2.id, promotion_code_id: `promo_zz2${tag}`, code: codeTwo });

  /* ── 1. The tables are invisible to a teacher ──────────────────────────── */
  console.log("Reading as an ordinary teacher");

  for (const table of ["ambassadors", "ambassador_codes", "ambassador_referrals"]) {
    const { data, error } = await teacherClient.from(table).select("*");
    // RLS with no matching policy returns an empty set rather than an error.
    // Either is fine; rows are not.
    check(
      `${table} returns nothing to a teacher`,
      error !== null || (data ?? []).length === 0,
      error ? undefined : `got ${(data ?? []).length} rows`,
    );
  }

  /* ── 2. A teacher cannot forge a referral ──────────────────────────────── */
  console.log("\nForging a referral");

  const { error: forgeError } = await teacherClient
    .from("ambassador_referrals")
    .insert({ ambassador_id: amb1.id, code_id: code1.id, user_id: teacher.id });
  check("a teacher cannot insert their own referral", forgeError !== null);

  /* ── 3. The admin RPCs refuse a non-admin ──────────────────────────────── */
  console.log("\nAdmin RPCs");

  const { error: listError } = await teacherClient.rpc("admin_ambassadors");
  check("admin_ambassadors() refuses a teacher", listError !== null, listError?.message);

  const { error: refError } = await teacherClient.rpc("admin_ambassador_referrals", {
    p_ambassador_id: amb1.id,
  });
  check("admin_ambassador_referrals() refuses a teacher", refError !== null);

  const { error: createError } = await teacherClient.rpc("admin_create_ambassador", {
    payload: { full_name: "Hacker", email: "hacker@example.com" },
  });
  check("admin_create_ambassador() refuses a teacher", createError !== null);

  const { data: adminList, error: adminListError } = await staffClient.rpc("admin_ambassadors");
  check(
    "admin_ambassadors() works for an admin",
    !adminListError && Array.isArray(adminList),
    adminListError?.message,
  );

  /* ── 4. Claiming ───────────────────────────────────────────────────────── */
  console.log("\nClaiming a code");

  const { data: claim1, error: claim1Error } = await teacherClient.rpc("claim_ambassador_code", {
    p_code: codeOne,
  });
  check("a teacher can claim a code", !claim1Error && claim1?.claimed === true, claim1Error?.message);

  // Case-insensitively, the way Stripe matches at checkout.
  const { data: claimLower } = await otherClient.rpc("claim_ambassador_code", {
    p_code: codeOne.toLowerCase(),
  });
  check("a code matches regardless of case", claimLower?.claimed === true);

  const { data: claimAgain } = await teacherClient.rpc("claim_ambassador_code", {
    p_code: codeTwo,
  });
  check(
    "a second code does NOT reassign attribution",
    claimAgain?.claimed === false && claimAgain?.reason === "already_claimed",
    JSON.stringify(claimAgain),
  );

  const { data: stillFirst } = await admin
    .from("ambassador_referrals")
    .select("ambassador_id")
    .eq("user_id", teacher.id)
    .single();
  check("the original ambassador still owns the referral", stillFirst?.ambassador_id === amb1.id);

  const { data: unknown } = await teacherClient.rpc("claim_ambassador_code", {
    p_code: `NOSUCHCODE${tag}`,
  });
  check("an unknown code is refused", unknown?.claimed === false && unknown?.reason === "unknown_code");

  // A paused ambassador stops taking new referrals.
  await admin.from("ambassadors").update({ status: "paused" }).eq("id", amb2.id);
  const third = await makeUser("third");
  const thirdClient = await asUser(third);
  const { data: pausedClaim } = await thirdClient.rpc("claim_ambassador_code", { p_code: codeTwo });
  check(
    "a paused ambassador takes no new referrals",
    pausedClaim?.claimed === false && pausedClaim?.reason === "inactive",
    JSON.stringify(pausedClaim),
  );
  await admin.from("ambassadors").update({ status: "active" }).eq("id", amb2.id);

  /* ── 5. THE PAYOUT RULE ────────────────────────────────────────────────── */
  // The one this whole feature rests on: no payment, no payout. A free signup
  // and an admin comp must both be unpayable.
  console.log("\nPayouts");

  const { data: referral } = await admin
    .from("ambassador_referrals")
    .select("id, payout_status, first_paid_at")
    .eq("user_id", teacher.id)
    .single();

  check("a new referral starts as N/A", referral?.payout_status === "na" && referral?.first_paid_at === null);

  const { error: prematureError } = await staffClient.rpc("admin_set_referral_payout", {
    p_referral_id: referral.id,
    p_status: "unpaid",
  });
  check(
    "an unpaid teacher cannot be marked payable, even by an admin",
    prematureError !== null,
    prematureError ? undefined : "the RPC allowed it",
  );

  // A COMP: plan says pro, but there is no Stripe subscription behind it. This
  // is the shape teacher_mrr() calls out, and it must not become payable either.
  await admin
    .from("profiles")
    .update({ plan: "pro", subscription_status: "active", stripe_subscription_id: null })
    .eq("id", teacher.id);

  const { error: compError } = await staffClient.rpc("admin_set_referral_payout", {
    p_referral_id: referral.id,
    p_status: "paid",
  });
  check(
    "a comped teacher is still not payable",
    compError !== null,
    compError ? undefined : "the RPC allowed a payout for a comp",
  );

  // The database constraint holds even against a direct service-role write,
  // so a future code path cannot create the bad state either.
  const { error: constraintError } = await admin
    .from("ambassador_referrals")
    .update({ payout_status: "paid" })
    .eq("id", referral.id);
  check(
    "the table itself refuses a payout with no payment",
    constraintError !== null,
    constraintError ? undefined : "the constraint did not fire",
  );

  // Now simulate what the Stripe webhook does on invoice.paid.
  await admin
    .from("ambassador_referrals")
    .update({ first_paid_at: new Date().toISOString(), first_paid_plan: "pro", payout_status: "unpaid" })
    .eq("id", referral.id);

  const { error: payError } = await staffClient.rpc("admin_set_referral_payout", {
    p_referral_id: referral.id,
    p_status: "paid",
  });
  check("a paid subscriber CAN be marked paid", payError === null, payError?.message);

  const { data: afterPay } = await admin
    .from("ambassador_referrals")
    .select("payout_status, payout_at")
    .eq("id", referral.id)
    .single();
  check(
    "marking paid records when",
    afterPay?.payout_status === "paid" && afterPay?.payout_at !== null,
  );

  const { error: teacherPayoutError } = await teacherClient.rpc("admin_set_referral_payout", {
    p_referral_id: referral.id,
    p_status: "paid",
  });
  check("a teacher cannot move a payout", teacherPayoutError !== null);

  /* ── 6. The counts an admin sees ───────────────────────────────────────── */
  console.log("\nWhat the admin page reports");

  const { data: rows } = await staffClient.rpc("admin_ambassadors");
  const mine = (rows ?? []).find((r) => r.id === amb1.id);
  check("the ambassador lists their referrals", Number(mine?.referrals) === 2, `got ${mine?.referrals}`);
  check("only the paying one counts as a subscriber", Number(mine?.subscribers) === 1, `got ${mine?.subscribers}`);
  check("the settled payout is counted as paid", Number(mine?.paid) === 1, `got ${mine?.paid}`);

  const { data: detail } = await staffClient.rpc("admin_ambassador_referrals", {
    p_ambassador_id: amb1.id,
  });
  check("the referral list names the teacher", (detail ?? []).some((r) => r.teacher_email === teacher.email));
  check(
    "a free referral reports no first payment",
    (detail ?? []).some((r) => r.user_id === other.id && r.first_paid_at === null),
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${passed} passed, ${failures.length} failed\n`);
    if (failures.length > 0) {
      for (const f of failures) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
      process.exit(1);
    }
  })
  .catch(async (err) => {
    // Clean up even when a fixture blew up half way through, so a failed run
    // does not leave test users behind.
    await cleanup();
    console.error("\nRun failed:", err.message, "\n");
    process.exit(1);
  });
