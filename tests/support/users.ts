import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/*
 * Throwaway teachers for an end to end run.
 *
 * Created through the service role and deleted afterwards, so a run leaves no
 * trace and two runs cannot collide on the same fixture. Same approach as
 * scripts/verify-colleagues.mjs, which checks the same feature one layer down.
 *
 * The service role is used ONLY here, to set up and tear down. Everything the
 * test then asserts happens in a real browser, signed in as a real user, under
 * RLS. A test that talked to the database as the service role would prove
 * nothing about what a teacher can actually see.
 */

/** .env.local by hand: Playwright does not load it, and the \r strip matters on
 *  Windows where the file has CRLF endings. */
function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(".env.local", "utf8");
  } catch {
    throw new Error("No .env.local. These tests need the Supabase URL, anon key and service role key.");
  }
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !SERVICE) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
}

export const admin: SupabaseClient = createClient(URL, SERVICE, {
  auth: { persistSession: false },
});

export interface TestTeacher {
  id: string;
  email: string;
  password: string;
  firstName: string;
  surname: string;
  username: string;
}

/**
 * A signed-up teacher with a complete profile.
 *
 * `email_confirm` skips the verification email, which is the one part of the
 * real signup flow a test cannot drive. Everything after this point goes
 * through the actual interface.
 */
export async function createTeacher(firstName: string): Promise<TestTeacher> {
  // Enough entropy that two runs overlapping in time cannot collide, and short
  // enough to fit the 20 character username constraint.
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const teacher: TestTeacher = {
    id: "",
    email: `e2e-${firstName.toLowerCase()}-${tag}@jooma.test`,
    password: `Pw-${tag}-Aa1!`,
    firstName,
    surname: "Testcase",
    username: `e2e${firstName.toLowerCase()}${tag}`.slice(0, 20),
  };

  const { data, error } = await admin.auth.admin.createUser({
    email: teacher.email,
    password: teacher.password,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create ${firstName}: ${error.message}`);
  teacher.id = data.user.id;

  // /complete-profile normally writes this. Seeded directly so each test starts
  // at the screen it is actually about.
  const { error: profileError } = await admin.from("profiles").upsert({
    id: teacher.id,
    first_name: teacher.firstName,
    surname: teacher.surname,
    username: teacher.username,
  });
  if (profileError) throw new Error(`Could not write ${firstName}'s profile: ${profileError.message}`);

  return teacher;
}

/** Deleting the auth user cascades to profiles, edges, requests and shares. */
export async function deleteTeacher(teacher: TestTeacher | null): Promise<void> {
  if (!teacher?.id) return;
  await admin.auth.admin.deleteUser(teacher.id).catch(() => {});
}

/**
 * A teacher with the admin flag set, for tests about the admin console.
 *
 * The flag is written through the service role because `profiles.is_admin` is
 * exactly the privilege a teacher must not be able to grant themselves — see
 * 20260811000400_lock_down_profile_self_update.sql. Torn down by
 * deleteTeacher() like any other.
 */
export async function createAdmin(firstName: string): Promise<TestTeacher> {
  const person = await createTeacher(firstName);
  const { error } = await admin.from("profiles").update({ is_admin: true }).eq("id", person.id);
  if (error) throw new Error(`Could not make ${firstName} an admin: ${error.message}`);
  return person;
}

/**
 * Put a teacher on a paid plan in one of the three states MRR has to tell
 * apart. The distinction that matters is `stripe_subscription_id`: a comp never
 * has one, and that absence is the only honest way to spot it, because the comp
 * path sets subscription_status to 'active' by hand.
 */
export async function setPlan(
  teacher: TestTeacher,
  plan: "pro" | "max",
  how: "paying" | "comped" | "ending",
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      plan,
      subscription_status: "active",
      // A comp has no Stripe customer and no subscription behind it.
      stripe_customer_id: how === "comped" ? null : `cus_e2e_${teacher.id.slice(0, 8)}`,
      stripe_subscription_id: how === "comped" ? null : `sub_e2e_${teacher.id.slice(0, 8)}`,
      cancel_at_period_end: how === "ending",
    })
    .eq("id", teacher.id);
  if (error) throw new Error(`Could not put ${teacher.firstName} on ${plan}: ${error.message}`);
}

/** A resource in this teacher's library, so there is something to share. */
export async function seedResource(
  teacher: TestTeacher,
  title: string,
  output = "Test resource body.",
): Promise<string> {
  const { data, error } = await admin
    .from("tool_runs")
    .insert({
      user_id: teacher.id,
      tool_slug: "lesson-planner",
      title,
      input: {},
      output,
    })
    .select()
    .single();
  if (error) throw new Error(`Could not seed a resource: ${error.message}`);
  return data.id as string;
}

/**
 * Sign in through the real login form.
 *
 * Not by injecting a session: the login page sets cookies the proxy reads on
 * every request, and a hand-built session would skip whatever that does. If
 * login breaks, these tests should notice.
 */
export async function signIn(page: Page, teacher: TestTeacher): Promise<void> {
  await page.goto("/login");

  const email = page.locator("#email");
  const password = page.locator("#password");
  const submit = page.getByRole("button", { name: /^sign in$/i });

  /*
   * Wait for HYDRATION before typing, not just for the input to exist.
   *
   * The login form is a client component with controlled inputs. Server-
   * rendered HTML puts the fields on screen well before React attaches, and a
   * fill() in that window writes straight to the DOM: React then hydrates,
   * finds its own state still empty, and wipes what was typed. The button stays
   * disabled because `canSubmit` reads that state, and the whole suite fails at
   * a click on a permanently disabled button with two visibly empty fields.
   *
   * Filling and then asserting the value is what makes this deterministic:
   * toHaveValue retries, so it rides out a hydration that lands mid-type.
   */
  await submit.waitFor({ state: "visible" });

  await email.fill(teacher.email);
  await expect(email).toHaveValue(teacher.email);

  await password.fill(teacher.password);
  await expect(password).toHaveValue(teacher.password);

  // Only enabled once React holds both values, so this is the real proof that
  // hydration has happened rather than a timer.
  await expect(submit).toBeEnabled();
  await submit.click();

  // Landing anywhere signed-in will do; the app chooses the destination.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Connect two teachers directly, for tests about what a connection ENABLES
 *  rather than about the connecting itself. colleague_edges has no insert
 *  policy by design, so this has to be the service role. */
export async function connect(a: TestTeacher, b: TestTeacher): Promise<void> {
  const { error } = await admin.from("colleague_edges").insert([
    { user_id: a.id, other_id: b.id },
    { user_id: b.id, other_id: a.id },
  ]);
  if (error) throw new Error(`Could not connect the two teachers: ${error.message}`);
}

/* ── Acting as a teacher, under RLS ────────────────────────────────────────── */

/**
 * A Supabase client on the ANON key, which is what a browser holds.
 *
 * The point of this is everything `admin` cannot prove. The service role
 * bypasses RLS, so asserting a teacher "cannot" do something through it passes
 * no matter how wrong the policies are. Anything about what is FORBIDDEN has to
 * go through this.
 *
 * The key is read when called rather than at module load: every existing spec
 * imports this file, and throwing at import time would break all of them for
 * anyone whose .env.local predates this helper.
 */
export function anonClient(): SupabaseClient {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local for RLS tests.");
  return createClient(URL, anon, { auth: { persistSession: false } });
}

/** An anon client already signed in as this teacher, so `auth.uid()` resolves
 *  and RLS sees a real JWT rather than an anonymous request. */
export async function asTeacher(teacher: TestTeacher): Promise<SupabaseClient> {
  const supabase = anonClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: teacher.email,
    password: teacher.password,
  });
  if (error) throw new Error(`Could not sign in as ${teacher.firstName}: ${error.message}`);
  return supabase;
}

/* ── Timetable fixtures ────────────────────────────────────────────────────── */

/**
 * The Monday of a given week, as YYYY-MM-DD.
 *
 * Not optional politeness: timetable_weeks.week_start carries a CHECK that it
 * is a Monday (extract(isodow) = 1), so a test that reached for "today" would
 * fail on six days out of seven.
 */
export function mondayOf(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay() is 0 for Sunday, which is 6 days after the Monday it belongs to
  // under ISO, not 1 day before the next one.
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export type TimetableDay = "mon" | "tue" | "wed" | "thu" | "fri";

/** The repeating week the wizard would otherwise write. Defaults match the
 *  migration's own, so a test that does not care about times can ignore them. */
export async function seedPattern(
  teacher: TestTeacher,
  p: {
    periods?: string[];
    yearGroup?: string | null;
    slots?: Array<{ day: TimetableDay; period: number; subject: string }>;
  } = {},
): Promise<void> {
  const { error } = await admin.from("timetable_pattern").upsert(
    {
      user_id: teacher.id,
      periods: p.periods ?? ["9:00", "11:00", "13:15", "14:45"],
      year_group: p.yearGroup ?? null,
      slots: p.slots ?? [],
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Could not seed a timetable pattern: ${error.message}`);
}

/** One lesson in one week. Returns its id, for attaching or deleting. */
export async function seedLesson(
  teacher: TestTeacher,
  l: {
    weekStart: string;
    day: TimetableDay;
    period: number;
    subject: string;
    topic?: string | null;
    yearGroup?: string | null;
    resourceId?: string | null;
  },
): Promise<string> {
  const { data, error } = await admin
    .from("timetable_lessons")
    .insert({
      user_id: teacher.id,
      week_start: l.weekStart,
      day: l.day,
      period: l.period,
      subject: l.subject,
      topic: l.topic ?? null,
      year_group: l.yearGroup ?? null,
      resource_id: l.resourceId ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Could not seed a lesson: ${error.message}`);
  return data.id as string;
}

/** Read a week back through the service role, for asserting what the interface
 *  actually wrote rather than what it appears to show. */
export async function listLessons(
  teacher: TestTeacher,
  weekStart: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from("timetable_lessons")
    .select("*")
    .eq("user_id", teacher.id)
    .eq("week_start", weekStart)
    .order("period");
  if (error) throw new Error(`Could not read the week back: ${error.message}`);
  return data ?? [];
}

/** Whether a week has been materialised. The receipt openWeek writes, and the
 *  thing Today must never create. */
export async function weekExists(teacher: TestTeacher, weekStart: string): Promise<boolean> {
  const { data, error } = await admin
    .from("timetable_weeks")
    .select("week_start")
    .eq("user_id", teacher.id)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw new Error(`Could not check for a week receipt: ${error.message}`);
  return data !== null;
}

/* ── Badge fixtures ────────────────────────────────────────────────────────── */

/**
 * Put badges on a teacher, for tests about what the profile then SHOWS.
 *
 * The service role, because it has to be: user_badges carries a select policy
 * and nothing else, so there is no insert a teacher could make. That is the
 * product working as designed, and tests/profile/badges.spec.ts asserts it
 * directly. Seeding here is the test rig standing in for claim_badges, not a
 * path anything in the app can take.
 */
export async function grantBadges(
  teacher: TestTeacher,
  badgeIds: string[],
  earnedAt?: string,
): Promise<void> {
  const { error } = await admin.from("user_badges").insert(
    badgeIds.map((badge_id) => ({
      user_id: teacher.id,
      badge_id,
      ...(earnedAt ? { earned_at: earnedAt } : {}),
    })),
  );
  if (error) throw new Error(`Could not grant badges: ${error.message}`);
}
