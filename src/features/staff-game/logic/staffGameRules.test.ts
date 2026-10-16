import { describe, expect, it } from "vitest";
import { GAME_DIFFICULTIES, starsForAccuracy } from "./staffGameRules";

describe("staff game difficulty and star rules", () => {
  it("defines the six approved timing and scoring tiers", () => {
    expect(
      GAME_DIFFICULTIES.map(
        ({ id, bubbleDurationMs, comboWindowMs, correctPoints, comboBonusPoints }) => [
          id,
          bubbleDurationMs,
          comboWindowMs,
          correctPoints,
          comboBonusPoints,
        ]
      )
    ).toEqual([
      ["muggle", 15_000, 9_000, 6, 1],
      ["leisure", 10_000, 6_000, 7, 2],
      ["easy", 7_000, 4_200, 8, 2],
      ["normal", 4_900, 3_000, 10, 3],
      ["hard", 3_300, 2_000, 12, 4],
      ["nightmare", 2_200, 1_300, 15, 5],
    ]);
  });

  it.each([
    [6, 10, 1],
    [7, 10, 1],
    [8, 10, 2],
    [9, 10, 3],
    [14, 20, 1],
    [15, 20, 2],
    [17, 20, 2],
    [18, 20, 3],
    [0, 0, 0],
  ])("scores %i/%i as %i stars", (correct, total, stars) => {
    expect(starsForAccuracy(correct, total)).toBe(stars);
  });
});
