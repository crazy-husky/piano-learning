// ⚠️ [整局趋势]。详见 docs/product-decisions.md
import type { AnswerEvent, StaffGameWrongNoteArchive, StaffGameWrongNoteArchiveRun } from "./types";
import {
  filterStaffGameWrongNoteArchivesByCalendarRange,
  hasCompleteStaffGameWrongNoteComparisonData,
  type StaffGameWrongNoteRange,
} from "./staffGameWrongNoteArchives";

export type StaffGameWrongNoteTrendSource = "challenge" | "review";

export interface StaffGameWrongNoteTrendRun {
  archiveDate: string;
  run: StaffGameWrongNoteArchiveRun;
}

export interface StaffGameWrongNoteTrendGroup {
  id: string;
  source: StaffGameWrongNoteTrendSource;
  reviewRange: StaffGameWrongNoteArchiveRun["reviewRange"];
  level: number | null;
  difficulty: string;
  inputMode: string;
  notePoolScope: StaffGameWrongNoteArchiveRun["notePoolScope"];
  noteSchedulingStrategy: StaffGameWrongNoteArchiveRun["noteSchedulingStrategy"];
  runs: StaffGameWrongNoteTrendRun[];
}

export interface StaffGameWrongNoteTrendPoint {
  date: string;
  endedAt: string | null;
  runCount: number;
  firstTryAccuracyPercent: number | null;
  errorCount: number;
  targetCount: number;
  averageResponseMs: number | null;
}

export type StaffGameWrongNoteTrendDisplayMode = "run" | "day";

const NOTE_POOL_SCOPES = new Set(["current-group", "all-history", "all-history-current-clef"]);
const CHALLENGE_SCHEDULING_STRATEGIES = new Set(["random", "system"]);

function hasCompleteTrendSettings(run: StaffGameWrongNoteArchiveRun): boolean {
  if (run.source === "review") {
    return run.notePoolScope === null && run.noteSchedulingStrategy === "review-weighted";
  }
  return (
    NOTE_POOL_SCOPES.has(run.notePoolScope ?? "") &&
    CHALLENGE_SCHEDULING_STRATEGIES.has(run.noteSchedulingStrategy ?? "")
  );
}

function hasCompleteTrendPerformanceData(run: StaffGameWrongNoteArchiveRun): boolean {
  if (!run.notes || typeof run.notes !== "object" || Array.isArray(run.notes)) return false;

  const notes: StaffGameWrongNoteArchiveRun["notes"] = {};
  for (const [midi, note] of Object.entries(run.notes)) {
    if (!note || typeof note !== "object" || Array.isArray(note)) return false;
    notes[midi] = {
      ...note,
      totalResponseMs: Object.prototype.hasOwnProperty.call(note, "totalResponseMs")
        ? note.totalResponseMs
        : 0,
      responseSampleCount: Object.prototype.hasOwnProperty.call(note, "responseSampleCount")
        ? note.responseSampleCount
        : 0,
    };
  }

  return hasCompleteStaffGameWrongNoteComparisonData({ ...run, notes });
}

/** The shared run eligibility rule for overall practice trends and single-note stats. */
export function isStaffGameWrongNoteTrendEligibleRun(run: StaffGameWrongNoteArchiveRun): boolean {
  return (
    hasCompleteTrendPerformanceData(run) && hasCompleteTrendSettings(run) && run.totalTargets > 0
  );
}

/** Keep the same run population in the stats page's trend and single-note panels. */
export function filterStaffGameWrongNoteTrendEligibleArchives(
  archives: readonly StaffGameWrongNoteArchive[]
): StaffGameWrongNoteArchive[] {
  return archives.flatMap((archive) => {
    const runs = archive.runs.filter(isStaffGameWrongNoteTrendEligibleRun);
    return runs.length > 0 ? [{ ...archive, runs }] : [];
  });
}

interface RecoveredNoteResponseStats {
  correct: number;
  missed: number;
  responseSampleCount: number;
  totalResponseMs: number;
  total: number;
  wrong: number;
}

/** Restore missing per-note reaction times from the raw answer-event rows for one run. */
export function recoverStaffGameWrongNoteRunResponseTimes(
  run: StaffGameWrongNoteArchiveRun,
  events: readonly AnswerEvent[]
): StaffGameWrongNoteArchiveRun | null {
  if (run.source !== "challenge" && run.source !== "review") return null;
  const noteEntries = Object.entries(run.notes ?? {});
  if (noteEntries.length === 0) return null;

  const statsByMidi = new Map<number, RecoveredNoteResponseStats>();
  for (const event of events) {
    if (
      event.sessionId !== run.runId ||
      event.mode !== "staff-game" ||
      event.targetMidi === undefined ||
      event.wasInterrupted === true
    ) {
      continue;
    }
    if (
      event.isCorrectFirstTry !== true &&
      event.isCorrectFirstTry !== false &&
      event.isCorrectFirstTry !== null
    ) {
      return null;
    }

    const stats = statsByMidi.get(event.targetMidi) ?? {
      correct: 0,
      missed: 0,
      responseSampleCount: 0,
      totalResponseMs: 0,
      total: 0,
      wrong: 0,
    };
    stats.total += 1;
    if (event.isCorrectFirstTry === true) {
      stats.correct += 1;
      if (
        typeof event.responseTimeMs === "number" &&
        Number.isFinite(event.responseTimeMs) &&
        event.responseTimeMs >= 0
      ) {
        stats.totalResponseMs += event.responseTimeMs;
        stats.responseSampleCount += 1;
      }
    } else if (event.isCorrectFirstTry === false) {
      stats.wrong += 1;
    } else {
      stats.missed += 1;
    }
    statsByMidi.set(event.targetMidi, stats);
  }

  if (statsByMidi.size !== noteEntries.length) return null;
  let totalTargets = 0;
  let firstTryCorrect = 0;
  const notes: StaffGameWrongNoteArchiveRun["notes"] = {};
  for (const [key, note] of noteEntries) {
    const stats = statsByMidi.get(note.midi);
    if (
      !stats ||
      stats.total !== note.appear ||
      stats.correct !== note.correct ||
      (!run.trendOnly && (stats.wrong !== note.wrong || stats.missed !== note.missed))
    ) {
      return null;
    }
    totalTargets += stats.total;
    firstTryCorrect += stats.correct;
    notes[key] = {
      ...note,
      totalResponseMs: stats.totalResponseMs,
      responseSampleCount: stats.responseSampleCount,
    };
  }

  if (totalTargets !== run.totalTargets || firstTryCorrect !== run.firstTryCorrect) return null;
  return { ...run, notes, responseTimeBasis: "first-correct" };
}

/** Count older, otherwise comparable runs that lack the draw settings required by trends. */
export function countStaffGameWrongNoteTrendRunsMissingSettings(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): number {
  return filterStaffGameWrongNoteArchivesByCalendarRange(archives, range, today).reduce(
    (total, archive) =>
      total +
      archive.runs.filter(
        (run) => hasCompleteTrendPerformanceData(run) && !hasCompleteTrendSettings(run)
      ).length,
    0
  );
}

/** Build comparable cohorts from complete performance records, including all-correct runs. */
export function buildStaffGameWrongNoteTrendGroups(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteTrendGroup[] {
  const groups = new Map<string, StaffGameWrongNoteTrendGroup>();
  for (const archive of filterStaffGameWrongNoteArchivesByCalendarRange(archives, range, today)) {
    for (const run of archive.runs) {
      if (!isStaffGameWrongNoteTrendEligibleRun(run)) continue;

      const id = JSON.stringify([
        run.source,
        run.reviewRange,
        run.level,
        run.difficulty,
        run.inputMode,
        run.notePoolScope,
        run.noteSchedulingStrategy,
      ]);
      const group = groups.get(id) ?? {
        id,
        source: run.source,
        reviewRange: run.reviewRange,
        level: run.level,
        difficulty: run.difficulty,
        inputMode: run.inputMode,
        notePoolScope: run.notePoolScope,
        noteSchedulingStrategy: run.noteSchedulingStrategy,
        runs: [],
      };
      group.runs.push({ archiveDate: archive.date, run });
      groups.set(id, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      runs: group.runs.sort((left, right) => left.run.endedAt.localeCompare(right.run.endedAt)),
    }))
    .sort((left, right) => {
      const leftLatest = left.runs.at(-1)?.run.endedAt ?? "";
      const rightLatest = right.runs.at(-1)?.run.endedAt ?? "";
      return rightLatest.localeCompare(leftLatest);
    });
}

/** Aggregate each comparable cohort by local archive date using pooled target counts. */
export function buildStaffGameWrongNoteTrendPoints(group: StaffGameWrongNoteTrendGroup): {
  displayMode: StaffGameWrongNoteTrendDisplayMode;
  runCount: number;
  groupAccuracyPercent: number | null;
  groupAverageResponseMs: number | null;
  points: StaffGameWrongNoteTrendPoint[];
} {
  const byDate = new Map<
    string,
    {
      runCount: number;
      correctCount: number;
      targetCount: number;
      errorCount: number;
      responseTotalMs: number;
      responseSampleCount: number;
    }
  >();
  let groupCorrectCount = 0;
  let groupTargetCount = 0;
  let groupResponseTotalMs = 0;
  let groupResponseSampleCount = 0;
  let runCount = 0;
  const runPoints: StaffGameWrongNoteTrendPoint[] = [];

  for (const { archiveDate, run } of group.runs) {
    if (run.totalTargets <= 0) continue;
    runCount += 1;
    groupCorrectCount += run.firstTryCorrect;
    groupTargetCount += run.totalTargets;
    let responseTotalMs = 0;
    let responseSampleCount = 0;
    const daily = byDate.get(archiveDate) ?? {
      runCount: 0,
      correctCount: 0,
      targetCount: 0,
      errorCount: 0,
      responseTotalMs: 0,
      responseSampleCount: 0,
    };
    daily.runCount += 1;
    daily.correctCount += run.firstTryCorrect;
    daily.targetCount += run.totalTargets;
    daily.errorCount += Object.values(run.notes).reduce(
      (total, note) => total + Math.max(0, note.wrong) + Math.max(0, note.missed),
      0
    );
    for (const note of Object.values(run.notes)) {
      const noteResponseTotalMs = Math.max(0, note.totalResponseMs ?? 0);
      const noteResponseSampleCount = Math.max(0, note.responseSampleCount ?? 0);
      responseTotalMs += noteResponseTotalMs;
      responseSampleCount += noteResponseSampleCount;
    }
    daily.responseTotalMs += responseTotalMs;
    daily.responseSampleCount += responseSampleCount;
    groupResponseTotalMs += responseTotalMs;
    groupResponseSampleCount += responseSampleCount;
    runPoints.push({
      date: archiveDate,
      endedAt: run.endedAt,
      runCount: 1,
      firstTryAccuracyPercent: (run.firstTryCorrect / run.totalTargets) * 100,
      errorCount: Object.values(run.notes).reduce(
        (total, note) => total + Math.max(0, note.wrong) + Math.max(0, note.missed),
        0
      ),
      targetCount: run.totalTargets,
      averageResponseMs: responseSampleCount > 0 ? responseTotalMs / responseSampleCount : null,
    });
    byDate.set(archiveDate, daily);
  }

  const dailyPoints = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, daily]) => ({
      date,
      endedAt: null,
      runCount: daily.runCount,
      firstTryAccuracyPercent:
        daily.targetCount > 0 ? (daily.correctCount / daily.targetCount) * 100 : null,
      errorCount: daily.errorCount,
      targetCount: daily.targetCount,
      averageResponseMs:
        daily.responseSampleCount > 0 ? daily.responseTotalMs / daily.responseSampleCount : null,
    }));
  const displayMode: StaffGameWrongNoteTrendDisplayMode = byDate.size === 1 ? "run" : "day";

  return {
    displayMode,
    runCount,
    groupAccuracyPercent:
      groupTargetCount > 0 ? (groupCorrectCount / groupTargetCount) * 100 : null,
    groupAverageResponseMs:
      groupResponseSampleCount > 0 ? groupResponseTotalMs / groupResponseSampleCount : null,
    points: displayMode === "run" ? runPoints : dailyPoints,
  };
}

/** Three-consecutive-point simple moving average; missing metric values break a segment. */
export function calculateStaffGameWrongNoteTrendMovingAverage(
  values: readonly (number | null)[],
  windowSize = 3
): Array<{ index: number; value: number }> {
  const window = Math.max(1, Math.floor(windowSize));
  const result: Array<{ index: number; value: number }> = [];
  for (let endIndex = window - 1; endIndex < values.length; endIndex += 1) {
    const windowValues = values.slice(endIndex - window + 1, endIndex + 1);
    const numericValues = windowValues.filter((value): value is number => value !== null);
    if (numericValues.length !== window) continue;
    result.push({
      index: endIndex,
      value: numericValues.reduce((total, value) => total + value, 0) / window,
    });
  }
  return result;
}
