import { test, expect } from "@playwright/test";
import { londonDayKey, longestStreakFrom, streakFrom } from "@/app/lib/badgeCriteria";

/*
 * The day streak.
 *
 * Pure functions over a set of YYYY-MM-DD keys, so this needs no browser and no
 * database. `now` is passed in, which is what makes the rule testable at all:
 * a derivation that read the clock itself would give a different answer every
 * time this ran.
 *
 * THE THREE RULES BEING PINNED, and why each one is a product decision rather
 * than an implementation detail:
 *
 *   1. Weekends are SKIPPED, not broken and not counted. UK teachers do not
 *      work Saturdays. Under literal consecutive days every streak would cap at
 *      five and reset every Monday, and the only way to beat that would be to
 *      work through the weekend. A product that sells teachers their evenings
 *      back must not quietly reward giving up a Saturday.
 *   2. ONE missed weekday is forgiven. An INSET day, a sick day, a trip. Losing
 *      an eight week habit to one bout of flu makes the number adversarial.
 *   3. TWO missed weekdays end it. Half term should end a streak, honestly.
 *
 * All dates below are chosen deliberately: 2026-03-09 is a Monday, so
 * 2026-03-13 is the Friday and 14/15 are the weekend. Midday UTC keeps every
 * timestamp inside the same London day whatever the DST offset.
 */

/** Midday on a given key, so the London day is never in doubt. */
function at(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

const MON = "2026-03-09";
const TUE = "2026-03-10";
const WED = "2026-03-11";
const THU = "2026-03-12";
const FRI = "2026-03-13";
const SAT = "2026-03-14";
const NEXT_MON = "2026-03-16";
const NEXT_TUE = "2026-03-17";

test.describe("Current streak", () => {
  test("no activity at all is zero, not one", () => {
    expect(streakFrom(new Set(), at(MON))).toBe(0);
  });

  test("today alone is one", () => {
    expect(streakFrom(new Set([MON]), at(MON))).toBe(1);
  });

  test("a weekend does not break a run across it", () => {
    // Friday then Monday, with nothing on Saturday or Sunday. The whole point
    // of rule 1: this is two, not one.
    expect(streakFrom(new Set([FRI, NEXT_MON]), at(NEXT_MON))).toBe(2);
  });

  test("a weekend does not pad a run either", () => {
    // Working Saturday is not worth an extra day on the counter. Friday plus a
    // Saturday, counted on the Friday, is still one.
    expect(streakFrom(new Set([FRI, SAT]), at(FRI))).toBe(1);
  });

  test("a full taught week is five", () => {
    expect(streakFrom(new Set([MON, TUE, WED, THU, FRI]), at(FRI))).toBe(5);
  });

  test("one missed weekday is forgiven", () => {
    // Wednesday off, counted on the Friday. The run reaches back past the gap.
    expect(streakFrom(new Set([MON, TUE, THU, FRI]), at(FRI))).toBe(4);
  });

  test("two missed weekdays end it", () => {
    // Tuesday and Wednesday off. The grace covers one, the second stops the
    // walk, so only Thursday and Friday count.
    expect(streakFrom(new Set([MON, THU, FRI]), at(FRI))).toBe(2);
  });

  test("nothing made yet today has not broken anything", () => {
    // The day is not over. Counted on Tuesday with only Monday active, the walk
    // starts at Monday rather than failing at Tuesday.
    expect(streakFrom(new Set([MON]), at(TUE))).toBe(1);
  });

  test("a long absence ends the streak rather than surviving it", () => {
    // Half term. A streak that outlived two weeks off would be a lie.
    expect(streakFrom(new Set([MON, TUE]), at("2026-03-30"))).toBe(0);
  });
});

test.describe("Longest streak ever", () => {
  test("no activity is zero", () => {
    expect(longestStreakFrom(new Set())).toBe(0);
  });

  test("finds the best run, not the most recent one", () => {
    // A four day run in the first week, one day in the next. The badge should
    // remember the four.
    expect(longestStreakFrom(new Set([MON, TUE, WED, THU, NEXT_TUE]))).toBe(4);
  });

  test("counts a run that spans a weekend as one run", () => {
    expect(longestStreakFrom(new Set([THU, FRI, NEXT_MON]))).toBe(3);
  });

  test("survives a lapse, which is the point of it", () => {
    // streakFrom would be 0 long after these days. The best run stays earned,
    // so streak-7 and up are never revoked.
    const days = new Set([MON, TUE, WED, THU, FRI]);
    expect(longestStreakFrom(days)).toBe(5);
    expect(streakFrom(days, at("2026-05-01"))).toBe(0);
  });
});

test.describe("London day keys", () => {
  test("a timestamp buckets to its London calendar day", () => {
    expect(londonDayKey(new Date("2026-03-09T12:00:00Z"))).toBe(MON);
  });

  test("British Summer Time is respected, not UTC", () => {
    // Late June, so London is UTC+1: 23:30Z is already the next day there. A
    // naive UTC bucket would file this under the 20th and quietly shift every
    // evening's work back a day all summer.
    expect(londonDayKey(new Date("2026-06-20T23:30:00Z"))).toBe("2026-06-21");
  });
});
