import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateKey } from "../../../domain/stats";
import type {
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  StaffGameWrongNoteNoteStats,
} from "../../../domain/types";
import { drawNextWrongNoteReviewNote, GAME_NOTE_PROGRESSION } from "./staffGameRules";
import {
  buildStaffGameWrongNoteReviewPlan,
  formatStaffGameWrongNoteReviewDuration,
  getStaffGameWrongNoteMasteredMidis,
  staffGameWrongNoteReviewDurationMs,
  staffGameWrongNoteReviewFamiliarTargetCount,
  staffGameWrongNoteReviewQuestionCounts,
} from "./staffGameWrongNoteReview";

function makeWeights(count: number): Map<number, number> {
  return new Map(
    GAME_NOTE_PROGRESSION.slice(0, count).map((note, index) => [note.midi, index + 1])
  );
}

function countByMidi(notes: Array<{ midi: number }>): Map<number, number> {
  return notes.reduce((counts, note) => {
    counts.set(note.midi, (counts.get(note.midi) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
}

function dateOffset(today: Date, daysBefore: number): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - daysBefore);
  return localDateKey(date.toISOString());
}

function archiveFor(
  date: string,
  runId: string,
  notes: StaffGameWrongNoteNoteStats[],
  trendOnly = false
): StaffGameWrongNoteArchive {
  const run: StaffGameWrongNoteArchiveRun = {
    runId,
    source: "challenge",
    ...(trendOnly ? { trendOnly: true } : {}),
    level: 1,
    difficulty: "normal",
    inputMode: "virtual",
    startedAt: `${date}T12:00:00.000Z`,
    endedAt: `${date}T12:01:00.000Z`,
    totalTargets: notes.reduce((total, note) => total + note.appear, 0),
    firstTryCorrect: notes.reduce((total, note) => total + note.correct, 0),
    lowSample: false,
    notes: Object.fromEntries(notes.map((note) => [String(note.midi), note])),
  };
  return { id: date, date, runs: [run] };
}

function makeNoteStats(midi: number, appear: number, correct: number): StaffGameWrongNoteNoteStats {
  return {
    midi,
    note: "C4",
    appear,
    correct,
    wrong: appear - correct,
    missed: 0,
    confusions: {},
  };
}

describe("wrong note review plan", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [18, 15_000, 135_000],
    [46, 15_000, 180_000],
    [18, 7_000, 63_000],
    [46, 7_000, 161_000],
    [18, 2_200, 60_000],
    [46, 2_200, 60_000],
  ])("calculates the review time limit for %i questions", (count, fallTime, expected) => {
    expect(staffGameWrongNoteReviewDurationMs(count, fallTime)).toBe(expected);
  });

  it.each([
    [60_000, "1分"],
    [63_000, "1分3秒"],
    [180_000, "3分"],
  ])("formats %i ms as %s", (duration, expected) => {
    expect(formatStaffGameWrongNoteReviewDuration(duration)).toBe(expected);
  });

  it.each([
    [0, 0],
    [1, 2],
    [2, 4],
    [4, 8],
    [5, 10],
    [6, 10],
    [10, 11],
    [20, 13],
    [30, 15],
  ])("sets the familiar-note target for N=%i to %i", (weakCount, expected) => {
    expect(staffGameWrongNoteReviewFamiliarTargetCount(weakCount)).toBe(expected);
  });

  it.each([
    [1, 10, 4],
    [4, 10, 14],
    [5, 10, 18],
    [10, 30, 26],
    [20, 40, 43],
    [30, 55, 60],
  ])(
    "calculates the finite question count for %i weak notes",
    (weakCount, availableFamiliarCount, expectedTotal) => {
      const counts = staffGameWrongNoteReviewQuestionCounts(weakCount, availableFamiliarCount);

      expect(counts.totalQuestionCount).toBe(expectedTotal);
      expect(counts.weakNoteCount).toBe(weakCount);
      expect(counts.weightedRepeatCount).toBe(Math.ceil(weakCount / 2));
    }
  );

  it("covers every weak pitch, adds weighted repeats, and prefers stable familiar pitches", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, 12);
    const weights = makeWeights(3);
    const masteredMidis = new Set([unlockedNotes[3]!.midi, unlockedNotes[4]!.midi]);
    const plan = buildStaffGameWrongNoteReviewPlan(unlockedNotes, weights, masteredMidis);
    const counts = countByMidi(plan.notes);
    const weakMidis = new Set(weights.keys());
    const familiarNotes = plan.notes.filter((note) => !weakMidis.has(note.midi));

    expect(plan.weakNoteCount).toBe(3);
    expect(plan.weightedRepeatCount).toBe(2);
    expect(plan.familiarNoteCount).toBe(6);
    expect(plan.totalQuestionCount).toBe(11);
    expect(plan.notes).toHaveLength(11);
    for (const midi of weakMidis) expect(counts.get(midi)).toBeGreaterThanOrEqual(1);
    expect(plan.notes.filter((note) => weakMidis.has(note.midi))).toHaveLength(5);
    expect(new Set(familiarNotes.map((note) => note.midi)).size).toBe(6);
    expect(familiarNotes.some((note) => masteredMidis.has(note.midi))).toBe(true);
    expect(counts.get(unlockedNotes[0]!.midi)).toBe(3);
  });

  it("shrinks the familiar layer when fewer non-weak unlocked pitches exist", () => {
    const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, 3);
    const plan = buildStaffGameWrongNoteReviewPlan(
      unlockedNotes,
      makeWeights(2),
      new Set<number>()
    );

    expect(plan.weakNoteCount).toBe(2);
    expect(plan.weightedRepeatCount).toBe(1);
    expect(plan.familiarNoteCount).toBe(1);
    expect(plan.totalQuestionCount).toBe(4);
    expect(
      plan.notes.filter((note) => ![...makeWeights(2).keys()].includes(note.midi))
    ).toHaveLength(1);
  });

  it("keeps full weak-note coverage when there are more than 20 weak pitches", () => {
    const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, 40);
    const weights = makeWeights(25);
    const plan = buildStaffGameWrongNoteReviewPlan(unlockedNotes, weights, new Set<number>());
    const counts = countByMidi(plan.notes);

    expect(plan.weakNoteCount).toBe(25);
    expect(plan.totalQuestionCount).toBe(52);
    for (const midi of weights.keys()) expect(counts.get(midi)).toBeGreaterThanOrEqual(1);
  });

  it("uses stable accuracy over the last 14 local calendar days", () => {
    const today = new Date(2026, 9, 16, 12);
    const archives = [
      archiveFor(dateOffset(today, 13), "oldest-in-window", [makeNoteStats(60, 2, 2)]),
      archiveFor(dateOffset(today, 1), "recent-in-window", [
        makeNoteStats(60, 3, 2),
        makeNoteStats(61, 2, 2),
      ]),
      archiveFor(dateOffset(today, 14), "outside-window", [makeNoteStats(62, 5, 5)]),
      archiveFor(dateOffset(today, 0), "today", [makeNoteStats(63, 5, 3)]),
      archiveFor(dateOffset(today, 0), "trend-only", [makeNoteStats(64, 5, 5)], true),
    ];

    expect(getStaffGameWrongNoteMasteredMidis(archives, today)).toEqual(new Set([60]));
  });

  it("consumes the finite queue once and returns null when it is exhausted", () => {
    const noteBag = GAME_NOTE_PROGRESSION.slice(0, 3).map((note) => ({ ...note }));
    const drawn = [
      drawNextWrongNoteReviewNote(noteBag, []),
      drawNextWrongNoteReviewNote(noteBag, []),
      drawNextWrongNoteReviewNote(noteBag, []),
    ];

    expect(drawn.every((note) => note !== null)).toBe(true);
    expect(new Set(drawn.map((note) => note!.midi))).toEqual(
      new Set(GAME_NOTE_PROGRESSION.slice(0, 3).map((note) => note.midi))
    );
    expect(noteBag).toHaveLength(0);
    expect(drawNextWrongNoteReviewNote(noteBag, [])).toBeNull();
  });
});
