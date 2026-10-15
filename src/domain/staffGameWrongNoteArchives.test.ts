import { describe, expect, it } from "vitest";
import {
  calculateStaffGameWrongNoteErrorCounts,
  calculateStaffGameWrongNoteWeights,
  compareStaffGameWrongNoteRun,
  filterStaffGameWrongNoteArchivesByRange,
  mergeStaffGameWrongNoteArchives,
} from "./staffGameWrongNoteArchives";
import type {
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  StaffGameWrongNoteNoteStats,
} from "./types";

function archive(date: string, runId: string, midi: number, wrong: number, missed = 0) {
  return {
    id: date,
    date,
    runs: [
      {
        runId,
        source: "challenge" as const,
        level: 1,
        difficulty: "easy",
        inputMode: "midi",
        startedAt: `${date}T10:00:00.000Z`,
        endedAt: `${date}T10:01:00.000Z`,
        updatedAt: `${date}T10:01:00.000Z`,
        totalTargets: wrong + missed,
        firstTryCorrect: 0,
        lowSample: false,
        notes: {
          [midi]: {
            midi,
            note: `midi-${midi}`,
            appear: wrong + missed,
            correct: 0,
            wrong,
            missed,
            confusions: {},
          },
        },
      },
    ],
  } satisfies StaffGameWrongNoteArchive;
}

function noteStats(
  midi: number,
  stats: Partial<StaffGameWrongNoteNoteStats> = {}
): StaffGameWrongNoteNoteStats {
  return {
    midi,
    note: `midi-${midi}`,
    appear: 1,
    correct: 1,
    wrong: 0,
    missed: 0,
    confusions: {},
    totalResponseMs: 0,
    responseSampleCount: 0,
    ...stats,
  };
}

function run(
  runId: string,
  source: StaffGameWrongNoteArchiveRun["source"],
  endedAt: string,
  notes: StaffGameWrongNoteArchiveRun["notes"],
  options: { difficulty?: string; reviewRange?: StaffGameWrongNoteArchiveRun["reviewRange"] } = {}
): StaffGameWrongNoteArchiveRun {
  return {
    runId,
    source,
    level: source === "challenge" ? 1 : null,
    difficulty: options.difficulty ?? "normal",
    inputMode: "virtual",
    startedAt: endedAt,
    endedAt,
    updatedAt: endedAt,
    reviewRange: options.reviewRange ?? null,
    totalTargets: Object.values(notes).reduce((total, note) => total + note.appear, 0),
    firstTryCorrect: Object.values(notes).reduce((total, note) => total + note.correct, 0),
    lowSample: false,
    notes,
  };
}

function archives(...runs: StaffGameWrongNoteArchiveRun[]): StaffGameWrongNoteArchive[] {
  const byDate = new Map<string, StaffGameWrongNoteArchiveRun[]>();
  for (const item of runs) {
    const date = item.endedAt.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return [...byDate].map(([date, items]) => ({ id: date, date, runs: items }));
}

describe("staff game wrong note archives", () => {
  it("deduplicates runs by runId while merging dates", () => {
    const first = archive("2026-10-15", "run-a", 60, 1);
    const second = archive("2026-10-15", "run-b", 62, 2);

    expect(mergeStaffGameWrongNoteArchives([first], [first, second])).toEqual([
      { ...first, runs: [first.runs[0], second.runs[0]] },
    ]);
  });

  it("keeps the newer version when imported archives contain a conflicting runId", () => {
    const older = archive("2026-10-15", "run-a", 60, 1);
    const newer = archive("2026-10-15", "run-a", 62, 2);
    newer.runs[0]!.updatedAt = "2026-10-15T10:05:00.000Z";

    expect(mergeStaffGameWrongNoteArchives([older], [newer])[0]?.runs).toEqual(newer.runs);
    expect(mergeStaffGameWrongNoteArchives([newer], [older])[0]?.runs).toEqual(newer.runs);
  });

  it("uses endedAt to compare legacy runs without updatedAt", () => {
    const older = archive("2026-10-15", "run-a", 60, 1);
    const newer = archive("2026-10-15", "run-a", 62, 2);
    const withoutUpdatedAt = (item: StaffGameWrongNoteArchive) => ({
      ...item,
      runs: item.runs.map(({ updatedAt: _updatedAt, ...run }) => ({ ...run })),
    });
    const legacyOlder = withoutUpdatedAt(older);
    const legacyNewer = withoutUpdatedAt(newer);
    legacyNewer.runs[0]!.endedAt = "2026-10-15T10:05:00.000Z";

    expect(mergeStaffGameWrongNoteArchives([legacyOlder], [legacyNewer])[0]?.runs).toEqual(
      legacyNewer.runs
    );
  });

  it("weights wrong and missed notes with a seven-day half-life and inclusive local-day range", () => {
    const archives = [
      archive("2026-10-15", "today", 60, 1, 2),
      archive("2026-10-14", "yesterday", 60, 2),
      archive("2026-10-12", "three-days-ago", 64, 10),
    ];
    const weights = calculateStaffGameWrongNoteWeights(archives, 3, new Date(2026, 9, 15, 12));

    expect(weights.get(60)).toBeCloseTo(3 + 2 * 0.5 ** (1 / 7));
    expect(weights.has(64)).toBe(false);
  });

  it("shares local-calendar range filtering and sorts real error counts by pitch", () => {
    const rows = [
      archive("2026-10-15", "today", 64, 1, 2),
      archive("2026-10-14", "yesterday", 60, 2, 1),
      archive("2026-10-13", "two-days-ago", 64, 1),
      archive("2026-10-12", "outside-range", 67, 9),
    ];
    const today = new Date(2026, 9, 15, 12);

    expect(filterStaffGameWrongNoteArchivesByRange(rows, 3, today).map((row) => row.date)).toEqual([
      "2026-10-15",
      "2026-10-14",
      "2026-10-13",
    ]);
    expect(calculateStaffGameWrongNoteErrorCounts(rows, 3, today)).toEqual([
      { midi: 64, errorCount: 4 },
      { midi: 60, errorCount: 3 },
    ]);
  });

  it("prioritizes the latest same-range and same-difficulty review run", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "hard", reviewRange: 7 }
    );
    const olderBestMatch = run(
      "same-range-same-difficulty-old",
      "review",
      "2026-10-10T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "hard", reviewRange: 7 }
    );
    const newerBestMatch = run(
      "same-range-same-difficulty-new",
      "review",
      "2026-10-12T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "hard", reviewRange: 7 }
    );
    const moreRecentDifferentDifficulty = run(
      "different-difficulty",
      "review",
      "2026-10-14T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "easy", reviewRange: 7 }
    );
    const moreRecentOtherRange = run(
      "other-range",
      "review",
      "2026-10-14T18:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "hard", reviewRange: 30 }
    );
    const recentChallenge = run("challenge", "challenge", "2026-10-14T23:00:00.000Z", {
      "60": noteStats(60),
    });

    expect(
      compareStaffGameWrongNoteRun(
        archives(
          olderBestMatch,
          newerBestMatch,
          moreRecentDifferentDifficulty,
          moreRecentOtherRange,
          recentChallenge
        ),
        current
      )?.previousRun.runId
    ).toBe("same-range-same-difficulty-new");
  });

  it("falls back from same-range matching to any review and then challenge", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "hard", reviewRange: 7 }
    );
    const differentDifficulty = run(
      "same-range-other-difficulty",
      "review",
      "2026-10-12T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "easy", reviewRange: 7 }
    );
    const anotherReview = run(
      "other-range-review",
      "review",
      "2026-10-14T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "easy", reviewRange: 30 }
    );
    const drill = run("drill", "drill", "2026-10-14T18:00:00.000Z", { "60": noteStats(60) });
    const challenge = run("challenge", "challenge", "2026-10-14T23:00:00.000Z", {
      "60": noteStats(60),
    });

    expect(
      compareStaffGameWrongNoteRun(archives(differentDifficulty), current)?.previousRun.runId
    ).toBe("same-range-other-difficulty");
    expect(
      compareStaffGameWrongNoteRun(archives(anotherReview, drill, challenge), current)?.previousRun
        .runId
    ).toBe("drill");
    expect(compareStaffGameWrongNoteRun(archives(challenge), current)?.previousRun.runId).toBe(
      "challenge"
    );
  });

  it("keeps drill comparisons on the drill history line", () => {
    const current = run("current-drill", "drill", "2026-10-15T12:00:00.000Z", {
      "60": noteStats(60),
    });
    const challenge = run("challenge", "challenge", "2026-10-14T23:00:00.000Z", {
      "60": noteStats(60),
    });
    const olderDrill = run("older-drill", "drill", "2026-10-10T12:00:00.000Z", {
      "60": noteStats(60),
    });

    expect(compareStaffGameWrongNoteRun(archives(challenge), current)).toBeNull();
    expect(
      compareStaffGameWrongNoteRun(archives(challenge, olderDrill), current)?.previousRun.runId
    ).toBe("older-drill");
  });

  it("skips historical runs missing any required comparison field", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    const completeCandidate = run(
      "candidate",
      "review",
      "2026-10-14T12:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    const { reviewRange: _reviewRange, ...missingReviewRange } = completeCandidate;
    const { totalResponseMs: _totalResponseMs, ...missingTotalResponseMs } = noteStats(60);
    const { responseSampleCount: _responseSampleCount, ...missingResponseSampleCount } =
      noteStats(60);
    const incompleteCandidates = [
      missingReviewRange as StaffGameWrongNoteArchiveRun,
      {
        ...completeCandidate,
        notes: { "60": missingTotalResponseMs },
      } as unknown as StaffGameWrongNoteArchiveRun,
      {
        ...completeCandidate,
        notes: { "60": missingResponseSampleCount },
      } as unknown as StaffGameWrongNoteArchiveRun,
      {
        ...completeCandidate,
        reviewRange: null,
      },
      {
        ...completeCandidate,
        source: "legacy-review" as StaffGameWrongNoteArchiveRun["source"],
      },
    ];

    for (const candidate of incompleteCandidates) {
      expect(compareStaffGameWrongNoteRun(archives(candidate), current)).toBeNull();
    }
  });

  it("does not create a comparison when the current run lacks required fields", () => {
    const completePrevious = run(
      "previous",
      "review",
      "2026-10-14T12:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    const currentWithoutRange = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    delete (currentWithoutRange as Partial<StaffGameWrongNoteArchiveRun>).reviewRange;

    expect(
      compareStaffGameWrongNoteRun(archives(completePrevious), currentWithoutRange)
    ).toBeNull();
  });

  it("compares only intersecting notes and averages shared positive response samples", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      {
        "60": noteStats(60, {
          appear: 2,
          correct: 1,
          wrong: 1,
          totalResponseMs: 1_800,
          responseSampleCount: 2,
        }),
        "62": noteStats(62, {
          appear: 1,
          correct: 0,
          missed: 1,
          totalResponseMs: 900,
          responseSampleCount: 1,
        }),
      },
      { difficulty: "normal", reviewRange: 7 }
    );
    const previous = run(
      "previous",
      "review",
      "2026-10-13T12:00:00.000Z",
      {
        "60": noteStats(60, {
          appear: 4,
          correct: 3,
          wrong: 1,
          totalResponseMs: 3_000,
          responseSampleCount: 2,
        }),
        "64": noteStats(64),
      },
      { difficulty: "normal", reviewRange: 7 }
    );

    expect(compareStaffGameWrongNoteRun(archives(previous), current)).toMatchObject({
      commonNoteMidis: [60],
      currentFirstTryAccuracyPercent: 50,
      previousFirstTryAccuracyPercent: 75,
      currentWeakNoteCount: 1,
      previousWeakNoteCount: 1,
      currentAverageResponseMs: 900,
      previousAverageResponseMs: 1_500,
    });
  });

  it("omits the reaction comparison when the shared-note set has no paired samples", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60, { responseSampleCount: 1, totalResponseMs: 800 }) },
      { difficulty: "normal", reviewRange: 7 }
    );
    const previous = run(
      "previous",
      "review",
      "2026-10-13T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "normal", reviewRange: 7 }
    );

    expect(compareStaffGameWrongNoteRun(archives(previous), current)).toMatchObject({
      currentAverageResponseMs: null,
      previousAverageResponseMs: null,
    });
  });
});
