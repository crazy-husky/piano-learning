import { describe, expect, it } from "vitest";
import {
  summarizeStaffGameWrongNoteOutcomes,
  summarizeStaffGameWrongNoteRunPerformance,
} from "./staffGameWrongNoteArchive";

describe("summarizeStaffGameWrongNoteOutcomes", () => {
  it("aggregates first tries, confusions, and misses without storing reaction times in archives", () => {
    const result = summarizeStaffGameWrongNoteOutcomes(
      [
        {
          token: 1,
          midi: 60,
          note: "C4",
          firstInputCorrect: true,
          missed: false,
          responseMs: 350,
        },
        {
          token: 2,
          midi: 60,
          note: "C4",
          firstInputCorrect: false,
          missed: false,
          errorAt: 8_000,
          responseMs: 0,
        },
        { token: 3, midi: 62, note: "D4", firstInputCorrect: null, missed: true, errorAt: 9_000 },
      ],
      [{ token: 2, recognizedNote: "D4" }],
      "1970-01-01T00:00:20.000Z"
    );

    expect(result.firstTryCorrect).toBe(1);
    expect(result.notes["60"]).toMatchObject({
      appear: 2,
      correct: 1,
      wrong: 1,
      lastErrorAt: "1970-01-01T00:00:08.000Z",
      confusions: { D4: 1 },
    });
    expect(result.notes["60"]).not.toHaveProperty("totalResponseMs");
    expect(result.notes["60"]).not.toHaveProperty("responseSampleCount");
    expect(result.notes["62"]).toMatchObject({
      appear: 1,
      missed: 1,
      lastErrorAt: "1970-01-01T00:00:09.000Z",
    });
  });
});

describe("summarizeStaffGameWrongNoteRunPerformance", () => {
  it("computes full-round accuracy, weak-note count, and sampled reaction average", () => {
    const result = summarizeStaffGameWrongNoteRunPerformance({
      runId: "run-1",
      source: "review",
      level: null,
      difficulty: "easy",
      inputMode: "midi",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      updatedAt: "2026-10-15T10:01:00.000Z",
      reviewRange: 7,
      totalTargets: 5,
      firstTryCorrect: 3,
      lowSample: true,
      notes: {
        "60": {
          midi: 60,
          note: "C4",
          appear: 3,
          correct: 2,
          wrong: 1,
          missed: 0,
          confusions: {},
          totalResponseMs: 1_200,
          responseSampleCount: 2,
        },
        "62": {
          midi: 62,
          note: "D4",
          appear: 2,
          correct: 1,
          wrong: 0,
          missed: 1,
          confusions: {},
          totalResponseMs: 800,
          responseSampleCount: 1,
        },
      },
    });

    expect(result).toEqual({
      targetCount: 5,
      firstTryAccuracyPercent: 60,
      averageResponseMs: 2000 / 3,
      weakNoteCount: 2,
    });
  });

  it("returns no accuracy or reaction average when the run has no samples", () => {
    const result = summarizeStaffGameWrongNoteRunPerformance({
      runId: "run-2",
      source: "review",
      level: null,
      difficulty: "easy",
      inputMode: "midi",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      updatedAt: "2026-10-15T10:01:00.000Z",
      reviewRange: 7,
      totalTargets: 0,
      firstTryCorrect: 0,
      lowSample: true,
      notes: {},
    });

    expect(result).toEqual({
      targetCount: 0,
      firstTryAccuracyPercent: null,
      averageResponseMs: null,
      weakNoteCount: 0,
    });
  });
});
