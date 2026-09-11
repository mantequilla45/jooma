import { test, expect } from "@playwright/test";
import {
  BADGES_PER_LEVEL,
  BADGE_LEVELS,
  EARNABLE_TOTAL,
  badgesToNextLevel,
  levelForEarned,
  levelFraction,
  levelTitle,
} from "@/app/lib/badges";

/*
 * The level a badge count buys.
 *
 * Pure arithmetic, so this needs no browser and no database.
 *
 * WHY NOTHING HERE HARDCODES TEN
 *
 * Ten badges are DISPLAYED per level, but eighteen of the hundred measure
 * features that do not exist yet and are marked pending, so the climb divides
 * the earnable total by the number of levels instead. Marking one more badge
 * pending changes BADGES_PER_LEVEL, and a test that had baked in ten would
 * start failing for a reason that is not a bug. Every expectation below is
 * derived from the exported constants for that reason.
 *
 * The two clamps are the interesting part. Without the lower one a teacher with
 * nothing sits at level 0, which no title exists for; without the upper one a
 * full set reads level 11 and levelTitle falls back to "Finding your feet",
 * which is the worst possible thing to tell somebody who just finished.
 */

test.describe("Level from badges earned", () => {
  test("nobody is below level 1, including a teacher with nothing", () => {
    expect(levelForEarned(0)).toBe(1);
    // Negative is not reachable through the app, but the clamp is what stops a
    // bad read becoming a crash in levelTitle.
    expect(levelForEarned(-5)).toBe(1);
  });

  test("nobody climbs past level 10, including a full set", () => {
    expect(levelForEarned(EARNABLE_TOTAL)).toBe(BADGE_LEVELS.length);
    expect(levelForEarned(EARNABLE_TOTAL * 2)).toBe(BADGE_LEVELS.length);
  });

  test("a level is exactly BADGES_PER_LEVEL wide", () => {
    // One short of the boundary is still the level below it.
    expect(levelForEarned(BADGES_PER_LEVEL - 1)).toBe(1);
    // The boundary itself is the promotion.
    expect(levelForEarned(BADGES_PER_LEVEL)).toBe(2);
    expect(levelForEarned(BADGES_PER_LEVEL * 2)).toBe(3);
  });

  test("every level has a title, and they are not all the same one", () => {
    const titles = BADGE_LEVELS.map((_, i) => levelTitle(i + 1));
    expect(titles).toHaveLength(BADGE_LEVELS.length);
    expect(new Set(titles).size).toBe(BADGE_LEVELS.length);
    expect(levelTitle(1)).toBe("Finding your feet");
    expect(levelTitle(BADGE_LEVELS.length)).toBe("Staffroom legend");
  });

  test("a level out of range still gets a title rather than undefined", () => {
    // levelTitle is called with whatever levelForEarned returns, so this is
    // belt and braces, but it renders into a heading and undefined would show.
    expect(levelTitle(0)).toBeTruthy();
    expect(levelTitle(99)).toBeTruthy();
  });
});

test.describe("Distance to the next level", () => {
  test("a fresh teacher needs a full level", () => {
    expect(badgesToNextLevel(0)).toBe(BADGES_PER_LEVEL);
  });

  test("one short of a boundary needs exactly one", () => {
    expect(badgesToNextLevel(BADGES_PER_LEVEL - 1)).toBe(1);
  });

  test("level 10 has nowhere left to go", () => {
    // Not BADGES_PER_LEVEL, and not negative. The sidebar renders this number
    // into "{n} more badges to reach Level {n+1}", which must not appear at all
    // once there is no next level.
    expect(badgesToNextLevel(EARNABLE_TOTAL)).toBe(0);
  });
});

test.describe("Progress through the current level", () => {
  test("stays within 0 and 1 at every count", () => {
    for (const earned of [0, 1, BADGES_PER_LEVEL - 1, BADGES_PER_LEVEL, EARNABLE_TOTAL]) {
      const f = levelFraction(earned);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  test("a boundary resets the bar rather than leaving it full", () => {
    // The moment of promotion: the track should read empty on the new level,
    // not stay pinned at the old one's end.
    expect(levelFraction(BADGES_PER_LEVEL)).toBe(0);
  });

  test("level 10 is full", () => {
    expect(levelFraction(EARNABLE_TOTAL)).toBe(1);
  });
});
