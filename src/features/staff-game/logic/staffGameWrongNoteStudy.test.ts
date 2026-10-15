import { describe, expect, it } from "vitest";
import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import {
  createStaffGameWrongNoteSelfTestProgress,
  getStaffGameWrongNoteStudyItems,
  isStaffGameWrongNoteSelfTestComplete,
  navigateStaffGameWrongNoteSelfTest,
  rateStaffGameWrongNoteSelfTestItem,
  revealStaffGameWrongNoteSelfTestAnswer,
  targetNoteFromStaffGameMidi,
} from "./staffGameWrongNoteStudy";

function archive(date: string, runId: string, notes: Record<string, [number, number]>) {
  return {
    id: date,
    date,
    runs: [
      {
        runId,
        source: "challenge" as const,
        level: 1,
        difficulty: "easy",
        inputMode: "virtual",
        startedAt: `${date}T10:00:00.000Z`,
        endedAt: `${date}T10:01:00.000Z`,
        updatedAt: `${date}T10:01:00.000Z`,
        reviewRange: null,
        totalTargets: 0,
        firstTryCorrect: 0,
        lowSample: false,
        notes: Object.fromEntries(
          Object.entries(notes).map(([midi, [wrong, missed]]) => [
            midi,
            {
              midi: Number(midi),
              note: `midi-${midi}`,
              appear: wrong + missed,
              correct: 0,
              wrong,
              missed,
              confusions: {},
              totalResponseMs: 0,
              responseSampleCount: 0,
            },
          ])
        ),
      },
    ],
  } satisfies StaffGameWrongNoteArchive;
}

describe("staff game wrong note study", () => {
  it("converts natural and sharp MIDI pitches into score notes", () => {
    const naturalNote = targetNoteFromStaffGameMidi(60);
    expect(naturalNote).toMatchObject({ noteName: "C", octave: 4 });
    expect(naturalNote).not.toHaveProperty("accidental");
    expect(targetNoteFromStaffGameMidi(61)).toMatchObject({
      noteName: "C",
      octave: 4,
      accidental: "sharp",
    });
  });

  it("orders notes by real wrong + missed totals, then by ascending pitch", () => {
    const items = getStaffGameWrongNoteStudyItems(
      [archive("2026-10-15", "run", { "64": [1, 1], "60": [1, 1], "62": [1, 2] })],
      7,
      new Date(2026, 9, 15, 12)
    );

    expect(items.map(({ midi, errorCount, label }) => ({ midi, errorCount, label }))).toEqual([
      { midi: 62, errorCount: 3, label: "D4" },
      { midi: 60, errorCount: 2, label: "C4" },
      { midi: 64, errorCount: 2, label: "E4" },
    ]);
  });

  it("reveals and records each self-test rating once, then completes the round", () => {
    const items = getStaffGameWrongNoteStudyItems(
      [archive("2026-10-15", "run", { "60": [1, 0], "62": [1, 0] })],
      7,
      new Date(2026, 9, 15, 12)
    );
    const initial = createStaffGameWrongNoteSelfTestProgress();
    expect(isStaffGameWrongNoteSelfTestComplete(initial, items.length)).toBe(false);

    const revealed = revealStaffGameWrongNoteSelfTestAnswer(initial, items.length);
    expect(revealed.isAnswerRevealed).toBe(true);
    expect(revealStaffGameWrongNoteSelfTestAnswer(revealed, items.length)).toBe(revealed);

    const firstRated = rateStaffGameWrongNoteSelfTestItem(revealed, items, true);
    expect(firstRated).toMatchObject({
      index: 1,
      isAnswerRevealed: false,
      rememberedMidis: [60],
      forgottenMidis: [],
    });
    expect(rateStaffGameWrongNoteSelfTestItem(firstRated, items, false)).toBe(firstRated);

    const secondRated = rateStaffGameWrongNoteSelfTestItem(
      revealStaffGameWrongNoteSelfTestAnswer(firstRated, items.length),
      items,
      false
    );
    expect(secondRated).toMatchObject({
      index: 2,
      rememberedMidis: [60],
      forgottenMidis: [62],
    });
    expect(isStaffGameWrongNoteSelfTestComplete(secondRated, items.length)).toBe(true);
  });

  it("visits unrated notes after jumping and replaces a prior self-rating", () => {
    const items = getStaffGameWrongNoteStudyItems(
      [archive("2026-10-15", "run", { "60": [1, 0], "62": [1, 0], "64": [1, 0] })],
      7,
      new Date(2026, 9, 15, 12)
    );

    const jumpedToThird = {
      ...createStaffGameWrongNoteSelfTestProgress(),
      index: 2,
      isAnswerRevealed: true,
    };
    const ratedThird = rateStaffGameWrongNoteSelfTestItem(jumpedToThird, items, true);
    expect(ratedThird).toMatchObject({ index: 0, rememberedMidis: [64], forgottenMidis: [] });

    const ratedFirst = rateStaffGameWrongNoteSelfTestItem(
      revealStaffGameWrongNoteSelfTestAnswer(ratedThird, items.length),
      items,
      false
    );
    expect(ratedFirst).toMatchObject({ index: 1, rememberedMidis: [64], forgottenMidis: [60] });

    const ratedSecond = rateStaffGameWrongNoteSelfTestItem(
      revealStaffGameWrongNoteSelfTestAnswer(ratedFirst, items.length),
      items,
      true
    );
    expect(isStaffGameWrongNoteSelfTestComplete(ratedSecond, items.length)).toBe(true);

    const changedFirstRating = rateStaffGameWrongNoteSelfTestItem(
      revealStaffGameWrongNoteSelfTestAnswer({ ...ratedSecond, index: 0 }, items.length),
      items,
      true
    );
    expect(changedFirstRating.rememberedMidis).toEqual([64, 62, 60]);
    expect(changedFirstRating.forgottenMidis).toEqual([]);
  });

  it("moves through self-test notes in order and hides a revealed answer after navigation", () => {
    const initial = createStaffGameWrongNoteSelfTestProgress();
    const revealed = revealStaffGameWrongNoteSelfTestAnswer(initial, 2);
    const next = navigateStaffGameWrongNoteSelfTest(revealed, 2, "next");

    expect(next).toMatchObject({ index: 1, isAnswerRevealed: false });
    expect(navigateStaffGameWrongNoteSelfTest(next, 2, "next")).toBe(next);
    expect(navigateStaffGameWrongNoteSelfTest(next, 2, "previous")).toMatchObject({
      index: 0,
      isAnswerRevealed: false,
    });
    expect(navigateStaffGameWrongNoteSelfTest(initial, 0, "next")).toBe(initial);
  });
});
