import { describe, expect, it } from "vitest";
import {
  calculateStaffGameWrongNoteNoteDiagnostics,
  calculateStaffGameWrongNoteErrorCounts,
  calculateStaffGameWrongNoteWeights,
  compareStaffGameWrongNoteRun,
  filterLegacyStaffGameDrillArchives,
  filterStaffGameWrongNoteArchivesByRange,
  filterStaffGameWrongNoteArchivesWithErrors,
  getStaffGameWrongNotePriorityPreview,
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

function withOneWrongAnswer(runRecord: StaffGameWrongNoteArchiveRun): StaffGameWrongNoteArchiveRun {
  const firstNoteEntry = Object.entries(runRecord.notes)[0];
  if (!firstNoteEntry) return runRecord;
  const [key, note] = firstNoteEntry;
  return {
    ...runRecord,
    notes: {
      ...runRecord.notes,
      [key]: { ...note, appear: note.appear + 1, wrong: note.wrong + 1 },
    },
  };
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

  it("decays each note from its last error time and falls back to the run time for old rows", () => {
    const recentArchive: StaffGameWrongNoteArchive = archive("2026-10-15", "recent-error", 60, 2);
    recentArchive.runs[0]!.notes["60"]!.lastErrorAt = "2026-10-01T10:01:00.000Z";
    const legacyArchive = archive("2026-10-15", "legacy-run", 60, 2);

    const weights = calculateStaffGameWrongNoteWeights(
      [recentArchive, legacyArchive],
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(weights.get(60)).toBeCloseTo(2 * 0.5 ** (14 / 7) + 2);
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

  it("diagnoses all saved note runs in range, including trend-only and all-correct runs", () => {
    const first: StaffGameWrongNoteArchiveRun = {
      ...run("first", "challenge", "2026-10-15T10:00:00.000Z", {
        "62": noteStats(62, {
          appear: 3,
          correct: 1,
          wrong: 2,
          confusions: { E4: 2, F4: 1, G4: 1 },
          totalResponseMs: 1000,
          responseSampleCount: 1,
        }),
      }),
      responseTimeBasis: "first-correct",
    };
    const second: StaffGameWrongNoteArchiveRun = {
      ...run(
        "second",
        "review",
        "2026-10-10T10:00:00.000Z",
        {
          "62": noteStats(62, {
            appear: 2,
            correct: 2,
            totalResponseMs: 3000,
            responseSampleCount: 2,
          }),
        },
        { reviewRange: 7 }
      ),
      responseTimeBasis: "first-correct",
      trendOnly: true,
    };
    const result = calculateStaffGameWrongNoteNoteDiagnostics(
      archives(first, second),
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(result).toEqual([
      {
        midi: 62,
        appearanceCount: 5,
        runCount: 2,
        correctCount: 3,
        errorCount: 2,
        accuracyPercent: 60,
        errorRatePercent: 40,
        averageResponseMs: 4000 / 3,
        confusions: [
          { note: "E4", count: 2 },
          { note: "F4", count: 1 },
        ],
      },
    ]);
    expect(
      calculateStaffGameWrongNoteNoteDiagnostics(
        archives(first, second),
        3,
        new Date(2026, 9, 15, 12)
      )
    ).toEqual([
      expect.objectContaining({
        midi: 62,
        appearanceCount: 3,
        runCount: 1,
        accuracyPercent: (1 / 3) * 100,
        errorRatePercent: (2 / 3) * 100,
      }),
    ]);
  });

  it("returns no accuracy, error-rate, or response samples when their denominators are empty", () => {
    const noSamples = run("no-samples", "challenge", "2026-10-15T10:00:00.000Z", {
      "60": noteStats(60, {
        appear: 0,
        correct: 0,
        wrong: 1,
        totalResponseMs: 0,
        responseSampleCount: 0,
      }),
    });
    const result = calculateStaffGameWrongNoteNoteDiagnostics(
      archives(noSamples),
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(result[0]).toMatchObject({
      midi: 60,
      appearanceCount: 0,
      runCount: 1,
      accuracyPercent: null,
      errorRatePercent: null,
      averageResponseMs: null,
    });
  });

  it("sorts single-note diagnostics by error rate from highest to lowest", () => {
    const result = calculateStaffGameWrongNoteNoteDiagnostics(
      archives(
        run("strong", "challenge", "2026-10-15T10:00:00.000Z", {
          "60": noteStats(60, { appear: 4, correct: 4 }),
        }),
        run("weak", "challenge", "2026-10-15T10:01:00.000Z", {
          "62": noteStats(62, { appear: 4, correct: 1, wrong: 3 }),
        }),
        run("middle", "challenge", "2026-10-15T10:02:00.000Z", {
          "64": noteStats(64, { appear: 4, correct: 2, wrong: 2 }),
        }),
        run("no-denominator", "challenge", "2026-10-15T10:03:00.000Z", {
          "65": noteStats(65, { appear: 0, correct: 0, wrong: 1 }),
        })
      ),
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(result.map(({ midi, errorRatePercent }) => [midi, errorRatePercent])).toEqual([
      [62, 75],
      [64, 50],
      [60, 0],
      [65, null],
    ]);
  });

  it("sorts the wait-page preview by review weights and filters locked notes", () => {
    expect(
      getStaffGameWrongNotePriorityPreview(
        new Map([
          [67, 4.1],
          [64, 4.1],
          [60, 2.2],
          [62, 9],
        ]),
        new Set([60, 64, 67]),
        2
      )
    ).toEqual([
      { midi: 64, weight: 4.1 },
      { midi: 67, weight: 4.1 },
    ]);
  });

  it("filters all-correct legacy runs from archive reads and aggregates", () => {
    const errorRun = archive("2026-10-15", "with-errors", 64, 2, 1).runs[0]!;
    const allCorrectRun = run("all-correct", "challenge", "2026-10-15T11:00:00.000Z", {
      "60": noteStats(60),
    });
    const allCorrectOnly = run(
      "all-correct-only",
      "review",
      "2026-10-14T11:00:00.000Z",
      {
        "62": noteStats(62),
      },
      { reviewRange: 7 }
    );
    const source = archives(errorRun, allCorrectRun, allCorrectOnly);

    expect(filterStaffGameWrongNoteArchivesWithErrors(source)).toEqual([
      { ...source[0]!, runs: [errorRun] },
    ]);
    expect(calculateStaffGameWrongNoteErrorCounts(source, "all")).toEqual([
      { midi: 64, errorCount: 3 },
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
    const olderBestMatch = withOneWrongAnswer(
      run(
        "same-range-same-difficulty-old",
        "review",
        "2026-10-10T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "hard", reviewRange: 7 }
      )
    );
    const newerBestMatch = withOneWrongAnswer(
      run(
        "same-range-same-difficulty-new",
        "review",
        "2026-10-12T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "hard", reviewRange: 7 }
      )
    );
    const moreRecentDifferentDifficulty = withOneWrongAnswer(
      run(
        "different-difficulty",
        "review",
        "2026-10-14T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "easy", reviewRange: 7 }
      )
    );
    const moreRecentOtherRange = withOneWrongAnswer(
      run(
        "other-range",
        "review",
        "2026-10-14T18:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "hard", reviewRange: 30 }
      )
    );
    const recentChallenge = withOneWrongAnswer(
      run("challenge", "challenge", "2026-10-14T23:00:00.000Z", {
        "60": noteStats(60),
      })
    );

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
    const differentDifficulty = withOneWrongAnswer(
      run(
        "same-range-other-difficulty",
        "review",
        "2026-10-12T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "easy", reviewRange: 7 }
      )
    );
    const anotherReview = withOneWrongAnswer(
      run(
        "other-range-review",
        "review",
        "2026-10-14T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "easy", reviewRange: 30 }
      )
    );
    const legacyDrill = {
      ...run("legacy-drill", "challenge", "2026-10-14T18:00:00.000Z", {
        "60": noteStats(60),
      }),
      source: "drill",
    } as unknown as StaffGameWrongNoteArchiveRun;
    const challenge = withOneWrongAnswer(
      run("challenge", "challenge", "2026-10-14T23:00:00.000Z", {
        "60": noteStats(60),
      })
    );

    expect(
      compareStaffGameWrongNoteRun(archives(differentDifficulty), current)?.previousRun.runId
    ).toBe("same-range-other-difficulty");
    expect(
      compareStaffGameWrongNoteRun(archives(anotherReview, legacyDrill, challenge), current)
        ?.previousRun.runId
    ).toBe("other-range-review");
    expect(compareStaffGameWrongNoteRun(archives(challenge), current)?.previousRun.runId).toBe(
      "challenge"
    );
  });

  it("compares an all-correct in-memory review run without making it a stored baseline", () => {
    const current = run(
      "current-all-correct",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "normal", reviewRange: 7 }
    );
    const legacyAllCorrect = run(
      "legacy-all-correct",
      "review",
      "2026-10-14T12:00:00.000Z",
      { "60": noteStats(60) },
      { difficulty: "normal", reviewRange: 7 }
    );
    const previousWithErrors = withOneWrongAnswer(
      run(
        "previous-with-errors",
        "review",
        "2026-10-13T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "normal", reviewRange: 7 }
      )
    );

    expect(
      compareStaffGameWrongNoteRun(archives(legacyAllCorrect, previousWithErrors), current)
    ).toMatchObject({
      previousRun: { runId: "previous-with-errors" },
      currentFirstTryAccuracyPercent: 100,
      previousFirstTryAccuracyPercent: 50,
    });
    expect(compareStaffGameWrongNoteRun(archives(legacyAllCorrect), current)).toBeNull();
  });

  it("filters historical drill runs while preserving other archive runs", () => {
    const challenge = run("challenge", "challenge", "2026-10-15T10:00:00.000Z", {
      "60": noteStats(60),
    });
    const review = run(
      "review",
      "review",
      "2026-10-15T11:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    const legacyDrill = {
      ...challenge,
      runId: "legacy-drill",
      source: "drill",
    } as unknown as StaffGameWrongNoteArchiveRun;
    const legacyOnlyArchive = {
      id: "2026-10-14",
      date: "2026-10-14",
      runs: [legacyDrill],
    } as unknown as StaffGameWrongNoteArchive;

    expect(
      filterLegacyStaffGameDrillArchives([
        legacyOnlyArchive,
        archives(challenge, legacyDrill, review)[0]!,
      ])
    ).toEqual([{ ...archives(challenge, legacyDrill, review)[0]!, runs: [challenge, review] }]);
    expect(filterLegacyStaffGameDrillArchives([legacyOnlyArchive])).toEqual([]);
  });

  it("skips historical runs missing any required comparison field", () => {
    const current = run(
      "current",
      "review",
      "2026-10-15T12:00:00.000Z",
      { "60": noteStats(60) },
      { reviewRange: 7 }
    );
    const completeCandidate = withOneWrongAnswer(
      run(
        "candidate",
        "review",
        "2026-10-14T12:00:00.000Z",
        { "60": noteStats(60) },
        { reviewRange: 7 }
      )
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
    const completePrevious = withOneWrongAnswer(
      run(
        "previous",
        "review",
        "2026-10-14T12:00:00.000Z",
        { "60": noteStats(60) },
        { reviewRange: 7 }
      )
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
    current.responseTimeBasis = "first-correct";
    previous.responseTimeBasis = "first-correct";

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
    const previous = withOneWrongAnswer(
      run(
        "previous",
        "review",
        "2026-10-13T12:00:00.000Z",
        { "60": noteStats(60) },
        { difficulty: "normal", reviewRange: 7 }
      )
    );

    expect(compareStaffGameWrongNoteRun(archives(previous), current)).toMatchObject({
      currentAverageResponseMs: null,
      previousAverageResponseMs: null,
    });
  });
});
