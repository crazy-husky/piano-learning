import { describe, expect, it, vi } from "vitest";
import {
  drawNextNote,
  GAME_DIFFICULTIES,
  GAME_NOTE_PROGRESSION,
  learningTestNoteSequence,
  takeNextLearningTestNote,
  notePoolCandidates,
  starsForAccuracy,
} from "./staffGameRules";

describe("staff game difficulty and star rules", () => {
  it("covers every selected learning-test note exactly twice and never refills", () => {
    const pool = notePoolCandidates(8, "current-group");
    const expectedMidis = new Set(pool.map((note) => note.midi));
    const sequence = learningTestNoteSequence(8, "current-group");
    const drawn: number[] = [];

    expect(sequence).toHaveLength(expectedMidis.size * 2);
    while (sequence.length > 0) {
      const next = takeNextLearningTestNote(sequence);
      expect(next).not.toBeNull();
      drawn.push(next!.midi);
    }

    expect(takeNextLearningTestNote(sequence)).toBeNull();
    expect(new Set(drawn)).toEqual(expectedMidis);
    expect(
      [...new Set(drawn)].every((midi) => drawn.filter((item) => item === midi).length === 2)
    ).toBe(true);
  });

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

  it.each(["system", "random"] as const)(
    "replenishes the note bag with safe notes during prompt suppression (%s scheduling)",
    (scheduling) => {
      const [recentNote, suppressedNote, expectedNote] = GAME_NOTE_PROGRESSION;
      const noteBag = [{ ...recentNote! }, { ...suppressedNote! }];
      const next = drawNextNote(
        3,
        noteBag,
        [recentNote!.midi, recentNote!.midi],
        "all-history",
        scheduling,
        new Set([suppressedNote!.midi])
      );

      expect(next?.midi).toBe(expectedNote!.midi);
      expect(noteBag.some((note) => note.midi === suppressedNote!.midi)).toBe(true);
    }
  );

  it("uses a safe older note when system bag sampling misses the only eligible fallback", () => {
    const targetNote = GAME_NOTE_PROGRESSION[0]!;
    const focusNote = GAME_NOTE_PROGRESSION[19]!;
    const noteBag = [{ ...focusNote }];
    const excludedNotes = new Set(
      GAME_NOTE_PROGRESSION.slice(0, 20)
        .filter((note) => note.midi !== targetNote.midi)
        .map((note) => note.midi)
    );
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const next = drawNextNote(
        20,
        noteBag,
        [focusNote.midi, focusNote.midi],
        "all-history",
        "system",
        excludedNotes
      );

      expect(next?.midi).toBe(targetNote.midi);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
