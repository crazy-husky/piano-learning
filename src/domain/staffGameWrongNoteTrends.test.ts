import { describe, expect, it } from "vitest";
import type {
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  StaffGameWrongNoteNoteStats,
} from "./types";
import {
  buildStaffGameWrongNoteTrendGroups,
  buildStaffGameWrongNoteTrendPoints,
  calculateStaffGameWrongNoteTrendMovingAverage,
} from "./staffGameWrongNoteTrends";

function note(
  midi: number,
  appear: number,
  correct: number,
  options: Partial<StaffGameWrongNoteNoteStats> = {}
): StaffGameWrongNoteNoteStats {
  return {
    midi,
    note: `note-${midi}`,
    appear,
    correct,
    wrong: appear - correct,
    missed: 0,
    confusions: {},
    totalResponseMs: 0,
    responseSampleCount: 0,
    ...options,
  };
}

function run(
  runId: string,
  endedAt: string,
  notes: Record<string, StaffGameWrongNoteNoteStats>,
  options: Partial<StaffGameWrongNoteArchiveRun> = {}
): StaffGameWrongNoteArchiveRun {
  const source = options.source ?? "challenge";
  return {
    runId,
    source,
    level: source === "challenge" ? 2 : null,
    difficulty: "hard",
    inputMode: "virtual",
    startedAt: endedAt,
    endedAt,
    updatedAt: endedAt,
    reviewRange: source === "review" ? 7 : null,
    notePoolScope: source === "challenge" ? "current-group" : null,
    noteSchedulingStrategy: source === "challenge" ? "random" : "review-weighted",
    trendOnly: false,
    responseTimeBasis: "first-correct",
    totalTargets: Object.values(notes).reduce((total, item) => total + item.appear, 0),
    firstTryCorrect: Object.values(notes).reduce((total, item) => total + item.correct, 0),
    lowSample: false,
    notes,
    ...options,
  };
}

function makeArchives(...runs: StaffGameWrongNoteArchiveRun[]): StaffGameWrongNoteArchive[] {
  const byDate = new Map<string, StaffGameWrongNoteArchiveRun[]>();
  for (const item of runs) {
    const date = item.endedAt.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return [...byDate].map(([date, items]) => ({ id: date, date, runs: items }));
}

describe("staff game wrong note trends", () => {
  it("keeps learning-test and arcade challenge runs in separate cohorts", () => {
    const base = {
      "60": note(60, 2, 1, { totalResponseMs: 900, responseSampleCount: 1 }),
    };
    const groups = buildStaffGameWrongNoteTrendGroups(
      makeArchives(
        run("learning", "2026-10-15T10:00:00.000Z", base, { gameMode: "learning" }),
        run("arcade", "2026-10-15T11:00:00.000Z", base, { gameMode: "arcade" })
      ),
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.gameMode).sort()).toEqual(["arcade", "learning"]);
  });

  it("pools run accuracy by local day without requiring note intersections", () => {
    const archives = makeArchives(
      run("day-1-a", "2026-10-13T10:00:00.000Z", {
        "60": note(60, 2, 1, { totalResponseMs: 1000, responseSampleCount: 1 }),
      }),
      run("day-1-b", "2026-10-13T12:00:00.000Z", {
        "62": note(62, 10, 8, { totalResponseMs: 9000, responseSampleCount: 3 }),
      }),
      run("day-2", "2026-10-14T10:00:00.000Z", {
        "64": note(64, 4, 3, { totalResponseMs: 3000, responseSampleCount: 2 }),
      }),
      run(
        "day-3-trend-only",
        "2026-10-15T10:00:00.000Z",
        { "67": note(67, 5, 5, { totalResponseMs: 5000, responseSampleCount: 5 }) },
        { trendOnly: true }
      )
    );
    const groups = buildStaffGameWrongNoteTrendGroups(archives, "all", new Date(2026, 9, 15, 12));
    const trend = buildStaffGameWrongNoteTrendPoints(groups[0]!);

    expect(groups).toHaveLength(1);
    expect(trend.runCount).toBe(4);
    expect(trend.displayMode).toBe("day");
    expect(trend.groupAccuracyPercent).toBe((17 / 21) * 100);
    expect(trend.groupAverageResponseMs).toBe(18000 / 11);
    expect(trend.points).toEqual([
      {
        date: "2026-10-13",
        endedAt: null,
        runCount: 2,
        firstTryAccuracyPercent: (9 / 12) * 100,
        errorCount: 3,
        targetCount: 12,
        averageResponseMs: 2500,
      },
      {
        date: "2026-10-14",
        endedAt: null,
        runCount: 1,
        firstTryAccuracyPercent: 75,
        errorCount: 1,
        targetCount: 4,
        averageResponseMs: 1500,
      },
      {
        date: "2026-10-15",
        endedAt: null,
        runCount: 1,
        firstTryAccuracyPercent: 100,
        errorCount: 0,
        targetCount: 5,
        averageResponseMs: 1000,
      },
    ]);
  });

  it("shows individual runs when a cohort has records from only one date", () => {
    const archives = makeArchives(
      run("same-day-later", "2026-10-15T12:00:00.000Z", {
        "60": note(60, 4, 3, { totalResponseMs: 3000, responseSampleCount: 2 }),
      }),
      run("same-day-earlier", "2026-10-15T10:00:00.000Z", {
        "62": note(62, 2, 1, { totalResponseMs: 1000, responseSampleCount: 1 }),
      })
    );
    const groups = buildStaffGameWrongNoteTrendGroups(archives, "all", new Date(2026, 9, 15, 12));
    const trend = buildStaffGameWrongNoteTrendPoints(groups[0]!);

    expect(trend.displayMode).toBe("run");
    expect(trend.points).toEqual([
      {
        date: "2026-10-15",
        endedAt: "2026-10-15T10:00:00.000Z",
        runCount: 1,
        firstTryAccuracyPercent: 50,
        errorCount: 1,
        targetCount: 2,
        averageResponseMs: 1000,
      },
      {
        date: "2026-10-15",
        endedAt: "2026-10-15T12:00:00.000Z",
        runCount: 1,
        firstTryAccuracyPercent: 75,
        errorCount: 1,
        targetCount: 4,
        averageResponseMs: 1500,
      },
    ]);
  });

  it("keeps different source, range, level, difficulty, input, pool, and strategy cohorts separate", () => {
    const base = run("base", "2026-10-15T10:00:00.000Z", { "60": note(60, 1, 1) });
    const variants = [
      {
        runId: "source",
        source: "review" as const,
        level: null,
        reviewRange: 7 as const,
        notePoolScope: null,
        noteSchedulingStrategy: "review-weighted" as const,
      },
      {
        runId: "review-range",
        source: "review" as const,
        level: null,
        reviewRange: 3 as const,
        notePoolScope: null,
        noteSchedulingStrategy: "review-weighted" as const,
      },
      { runId: "level", level: 3 },
      { runId: "difficulty", difficulty: "normal" },
      { runId: "input", inputMode: "midi" },
      { runId: "pool", notePoolScope: "all-history" as const },
      { runId: "strategy", noteSchedulingStrategy: "system" as const },
    ];
    const runs = [base, ...variants.map((variant) => ({ ...base, ...variant }))];

    expect(
      buildStaffGameWrongNoteTrendGroups(makeArchives(...runs), "all", new Date(2026, 9, 15, 12))
    ).toHaveLength(runs.length);
  });

  it("computes a three-point moving average and breaks across missing values", () => {
    expect(
      calculateStaffGameWrongNoteTrendMovingAverage([10, 20, 30, 40, null, 60, 70, 80])
    ).toEqual([
      { index: 2, value: 20 },
      { index: 3, value: 30 },
      { index: 7, value: 70 },
    ]);
  });

  it("uses saved response samples from runs without a timing basis marker", () => {
    const noBasis = run(
      "legacy-time",
      "2026-10-15T10:00:00.000Z",
      {
        "60": note(60, 2, 1, { totalResponseMs: 1200, responseSampleCount: 1 }),
      },
      { responseTimeBasis: undefined }
    );
    const groups = buildStaffGameWrongNoteTrendGroups(
      makeArchives(noBasis),
      "all",
      new Date(2026, 9, 15, 12)
    );

    expect(buildStaffGameWrongNoteTrendPoints(groups[0]!).points[0]?.averageResponseMs).toBe(1200);
  });
});
