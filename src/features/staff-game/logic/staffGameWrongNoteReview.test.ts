import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GAME_DIFFICULTIES,
  GAME_NOTE_PROGRESSION,
  WRONG_NOTE_REVIEW_BAG_SIZE,
  shuffledWrongNoteReviewBag,
  wrongNoteReviewDurationMs,
} from "./staffGameRules";

function makeWeights(count: number): Map<number, number> {
  return new Map(
    GAME_NOTE_PROGRESSION.slice(0, count).map((note, index) => [note.midi, index + 1])
  );
}

function countByMidi(bag: Array<{ midi: number }>): Map<number, number> {
  return bag.reduce((counts, note) => {
    counts.set(note.midi, (counts.get(note.midi) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
}

describe("wrong note review bag", () => {
  it.each([
    ["muggle", 90_000],
    ["easy", 60_000],
    ["normal", 45_000],
    ["hard", 30_000],
    ["nightmare", 30_000],
  ] as const)("calculates the review duration for %s difficulty", (difficulty, expected) => {
    const preset = GAME_DIFFICULTIES.find((item) => item.id === difficulty)!;

    expect(wrongNoteReviewDurationMs(preset.bubbleDurationMs)).toBe(expected);
  });

  it("uses the shared review bag size for duration and note bag defaults", () => {
    expect(WRONG_NOTE_REVIEW_BAG_SIZE).toBe(20);
    expect(wrongNoteReviewDurationMs(3_300, 10)).toBe(15_000);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { weakCount: 3, expectedWeakSlots: 7 },
    { weakCount: 8, expectedWeakSlots: 8 },
    { weakCount: 15, expectedWeakSlots: 15 },
  ])(
    "covers $weakCount weak notes and fills a 20-note bag with the expected weak share",
    ({ weakCount, expectedWeakSlots }) => {
      const weights = makeWeights(weakCount);
      const bag = shuffledWrongNoteReviewBag(20, weights);
      const counts = countByMidi(bag);
      const weakMidis = new Set(weights.keys());

      expect(bag).toHaveLength(20);
      expect(bag.filter((note) => weakMidis.has(note.midi))).toHaveLength(expectedWeakSlots);
      for (const midi of weakMidis) expect(counts.get(midi)).toBeGreaterThanOrEqual(1);
      expect(bag.filter((note) => !weakMidis.has(note.midi))).toHaveLength(20 - expectedWeakSlots);
    }
  );

  it("fills the full bag with weak notes when no unlocked buffer note exists", () => {
    const weights = makeWeights(5);
    const bag = shuffledWrongNoteReviewBag(5, weights);
    const counts = countByMidi(bag);

    expect(bag).toHaveLength(20);
    expect(new Set(bag.map((note) => note.midi))).toEqual(new Set(weights.keys()));
    for (const midi of weights.keys()) expect(counts.get(midi)).toBeGreaterThanOrEqual(1);
  });

  it("uses remaining weak-note slots as weighted draws", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const weights = makeWeights(3);
    const bag = shuffledWrongNoteReviewBag(20, weights);
    const counts = countByMidi(bag);
    const highestWeightMidi = GAME_NOTE_PROGRESSION[2]!.midi;

    expect(bag.filter((note) => weights.has(note.midi))).toHaveLength(7);
    expect(counts.get(highestWeightMidi)).toBe(5);
    expect(counts.get(GAME_NOTE_PROGRESSION[0]!.midi)).toBe(1);
    expect(counts.get(GAME_NOTE_PROGRESSION[1]!.midi)).toBe(1);
  });

  it("keeps only the 20 highest-weight notes when weak notes exceed bag size", () => {
    const weights = new Map(
      GAME_NOTE_PROGRESSION.slice(0, 25).map((note, index) => [note.midi, index + 1])
    );
    const expected = new Set(GAME_NOTE_PROGRESSION.slice(5, 25).map((note) => note.midi));
    const bag = shuffledWrongNoteReviewBag(25, weights);

    expect(bag).toHaveLength(20);
    expect(new Set(bag.map((note) => note.midi))).toEqual(expected);
  });

  it("uses only unlocked pitches for weak and buffer notes", () => {
    const weights = new Map([
      [GAME_NOTE_PROGRESSION[0]!.midi, 1],
      [GAME_NOTE_PROGRESSION[30]!.midi, 100],
    ]);
    const bag = shuffledWrongNoteReviewBag(20, weights);
    const unlockedMidis = new Set(GAME_NOTE_PROGRESSION.slice(0, 20).map((note) => note.midi));

    expect(bag).toHaveLength(20);
    expect(bag.every((note) => unlockedMidis.has(note.midi))).toBe(true);
    expect(bag.some((note) => note.midi === GAME_NOTE_PROGRESSION[30]!.midi)).toBe(false);
  });
});
