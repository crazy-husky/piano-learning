import type { StaffGameWrongNoteArchive, StaffGameWrongNoteArchiveRun } from "./types";
import {
  filterStaffGameWrongNoteArchivesByRange,
  getStaffGameWrongNoteRunErrorCount,
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
  runId: string;
  archiveDate: string;
  endedAt: string;
  firstTryAccuracyPercent: number | null;
  errorRatePercent: number | null;
  errorCount: number;
  targetCount: number;
  averageResponseMs: number | null;
}

const MAX_TREND_RUNS = 8;
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

/** Count older, otherwise comparable runs that lack the draw settings required by trends. */
export function countStaffGameWrongNoteTrendRunsMissingSettings(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): number {
  return filterStaffGameWrongNoteArchivesByRange(archives, range, today).reduce(
    (total, archive) =>
      total +
      archive.runs.filter(
        (run) =>
          getStaffGameWrongNoteRunErrorCount(run) > 0 &&
          hasCompleteStaffGameWrongNoteComparisonData(run) &&
          !hasCompleteTrendSettings(run)
      ).length,
    0
  );
}

/** Build comparable cohorts from complete, non-zero-error archived runs. */
export function buildStaffGameWrongNoteTrendGroups(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteTrendGroup[] {
  const groups = new Map<string, StaffGameWrongNoteTrendGroup>();
  for (const archive of filterStaffGameWrongNoteArchivesByRange(archives, range, today)) {
    for (const run of archive.runs) {
      if (
        getStaffGameWrongNoteRunErrorCount(run) === 0 ||
        !hasCompleteStaffGameWrongNoteComparisonData(run) ||
        !hasCompleteTrendSettings(run)
      ) {
        continue;
      }

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

/**
 * Keep only notes that appeared in every plotted run, so the line compares the
 * same notes over time instead of changing meaning as the review pool changes.
 */
export function buildStaffGameWrongNoteTrendPoints(
  group: StaffGameWrongNoteTrendGroup,
  limit = MAX_TREND_RUNS
): { commonNoteMidis: number[]; points: StaffGameWrongNoteTrendPoint[] } {
  const runs = group.runs.slice(-Math.max(1, limit));
  if (runs.length === 0) return { commonNoteMidis: [], points: [] };

  const firstRun = runs[0]?.run;
  if (!firstRun) return { commonNoteMidis: [], points: [] };

  const commonNoteMidis = Object.keys(firstRun.notes)
    .map(Number)
    .filter((midi) =>
      runs.every(({ run }) => {
        const note = run.notes[String(midi)];
        return note !== undefined && note.appear > 0;
      })
    )
    .sort((left, right) => left - right);

  if (commonNoteMidis.length === 0) return { commonNoteMidis, points: [] };

  const points = runs.map(({ archiveDate, run }) => {
    let appear = 0;
    let correct = 0;
    let errorCount = 0;
    let responseTotalMs = 0;
    let responseSampleCount = 0;

    for (const midi of commonNoteMidis) {
      const note = run.notes[String(midi)];
      if (!note) continue;
      appear += note.appear;
      correct += note.correct;
      errorCount += note.wrong + note.missed;
      if ((note.responseSampleCount ?? 0) > 0) {
        responseTotalMs += note.totalResponseMs ?? 0;
        responseSampleCount += note.responseSampleCount ?? 0;
      }
    }

    return {
      runId: run.runId,
      archiveDate,
      endedAt: run.endedAt,
      firstTryAccuracyPercent: appear > 0 ? (correct / appear) * 100 : null,
      errorRatePercent: appear > 0 ? (errorCount / appear) * 100 : null,
      errorCount,
      targetCount: appear,
      averageResponseMs: responseSampleCount > 0 ? responseTotalMs / responseSampleCount : null,
    };
  });

  return { commonNoteMidis, points };
}
