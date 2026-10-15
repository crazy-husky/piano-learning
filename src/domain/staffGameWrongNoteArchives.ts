import type { StaffGameWrongNoteArchive, StaffGameWrongNoteArchiveRun } from "./types";

export type StaffGameWrongNoteRange = 3 | 7 | 15 | 30 | "all";

export interface StaffGameWrongNoteComparison {
  previousRun: StaffGameWrongNoteArchiveRun;
  commonNoteMidis: number[];
  currentFirstTryAccuracyPercent: number;
  previousFirstTryAccuracyPercent: number;
  currentWeakNoteCount: number;
  previousWeakNoteCount: number;
  currentAverageResponseMs: number | null;
  previousAverageResponseMs: number | null;
}

function runUpdatedAtMs(run: StaffGameWrongNoteArchiveRun): number {
  const timestamp = Date.parse(run.updatedAt ?? run.endedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function utcCalendarDay(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function archiveAgeDays(archiveDate: string, today: Date): number {
  return Math.max(
    0,
    Math.round((utcCalendarDay(localDateKey(today)) - utcCalendarDay(archiveDate)) / 86_400_000)
  );
}

/** Select daily archive rows using the same local-calendar-day boundary as review weighting. */
export function filterStaffGameWrongNoteArchivesByRange(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteArchive[] {
  if (range === "all") return [...archives];
  return archives.filter((archive) => archiveAgeDays(archive.date, today) < range);
}

/** Aggregate real wrong + missed counts for study browsing, without time-decay weighting. */
export function calculateStaffGameWrongNoteErrorCounts(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): Array<{ midi: number; errorCount: number }> {
  const counts = new Map<number, number>();
  for (const archive of filterStaffGameWrongNoteArchivesByRange(archives, range, today)) {
    for (const run of archive.runs) {
      for (const note of Object.values(run.notes)) {
        const errors = note.wrong + note.missed;
        if (errors > 0) counts.set(note.midi, (counts.get(note.midi) ?? 0) + errors);
      }
    }
  }
  return [...counts.entries()]
    .map(([midi, errorCount]) => ({ midi, errorCount }))
    .sort((left, right) => right.errorCount - left.errorCount || left.midi - right.midi);
}

export function mergeStaffGameWrongNoteArchives(
  ...archiveSets: Array<readonly StaffGameWrongNoteArchive[]>
): StaffGameWrongNoteArchive[] {
  const byDate = new Map<string, StaffGameWrongNoteArchive>();
  for (const archive of archiveSets.flat()) {
    const date = archive.date || archive.id;
    const current = byDate.get(date);
    const runs = new Map<string, StaffGameWrongNoteArchiveRun>();
    for (const run of [...(current?.runs ?? []), ...archive.runs]) {
      const existing = runs.get(run.runId);
      if (!existing || runUpdatedAtMs(run) > runUpdatedAtMs(existing)) {
        runs.set(run.runId, run);
      }
    }
    byDate.set(date, { id: date, date, runs: [...runs.values()] });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function calculateStaffGameWrongNoteWeights(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): Map<number, number> {
  const weights = new Map<number, number>();
  for (const archive of filterStaffGameWrongNoteArchivesByRange(archives, range, today)) {
    const ageDays = archiveAgeDays(archive.date, today);
    const decay = 0.5 ** (ageDays / 7);
    for (const run of archive.runs) {
      for (const note of Object.values(run.notes)) {
        const errors = note.wrong + note.missed;
        if (errors > 0) weights.set(note.midi, (weights.get(note.midi) ?? 0) + errors * decay);
      }
    }
  }
  return weights;
}

function commonNoteMidis(
  currentRun: StaffGameWrongNoteArchiveRun,
  candidate: StaffGameWrongNoteArchiveRun
): number[] {
  return Object.keys(currentRun.notes)
    .map(Number)
    .filter((midi) => {
      const currentNote = currentRun.notes[String(midi)];
      const candidateNote = candidate.notes[String(midi)];
      return Boolean(
        currentNote && candidateNote && currentNote.appear > 0 && candidateNote.appear > 0
      );
    })
    .sort((first, second) => first - second);
}

const STAFF_GAME_WRONG_NOTE_SOURCES = new Set(["challenge", "review", "drill"]);
const STAFF_GAME_WRONG_NOTE_REVIEW_RANGES = new Set([3, 7, 15, 30, "all"]);

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasCompleteComparisonFields(run: StaffGameWrongNoteArchiveRun): boolean {
  if (!STAFF_GAME_WRONG_NOTE_SOURCES.has(run.source)) return false;
  if (!hasOwnProperty(run, "reviewRange")) return false;
  if (
    run.source === "review"
      ? !STAFF_GAME_WRONG_NOTE_REVIEW_RANGES.has(run.reviewRange as number | string)
      : run.reviewRange !== null
  ) {
    return false;
  }

  if (!run.notes || typeof run.notes !== "object") return false;
  return Object.values(run.notes).every((note) => {
    if (!note || typeof note !== "object") return false;
    if (!hasOwnProperty(note, "totalResponseMs") || !hasOwnProperty(note, "responseSampleCount")) {
      return false;
    }
    return (
      typeof note.totalResponseMs === "number" &&
      Number.isFinite(note.totalResponseMs) &&
      note.totalResponseMs >= 0 &&
      typeof note.responseSampleCount === "number" &&
      Number.isInteger(note.responseSampleCount) &&
      note.responseSampleCount >= 0
    );
  });
}

function latestMatchingRun(
  runs: readonly StaffGameWrongNoteArchiveRun[],
  predicate: (run: StaffGameWrongNoteArchiveRun) => boolean,
  currentRun: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteArchiveRun | undefined {
  return runs
    .filter(
      (run) =>
        run.runId !== currentRun.runId &&
        hasCompleteComparisonFields(run) &&
        predicate(run) &&
        commonNoteMidis(currentRun, run).length > 0
    )
    .sort((first, second) => second.endedAt.localeCompare(first.endedAt))[0];
}

function summarizeNotes(
  run: StaffGameWrongNoteArchiveRun,
  midis: readonly number[]
): { accuracyPercent: number; weakNoteCount: number } {
  let appear = 0;
  let correct = 0;
  let weakNoteCount = 0;
  for (const midi of midis) {
    const note = run.notes[String(midi)];
    if (!note) continue;
    appear += note.appear;
    correct += note.correct;
    weakNoteCount += note.wrong + note.missed;
  }
  return {
    accuracyPercent: appear > 0 ? (correct / appear) * 100 : 0,
    weakNoteCount,
  };
}

function averageResponseMsForSharedSamples(
  currentRun: StaffGameWrongNoteArchiveRun,
  previousRun: StaffGameWrongNoteArchiveRun,
  commonMidis: readonly number[]
): [number | null, number | null] {
  let currentTotalMs = 0;
  let previousTotalMs = 0;
  let currentSampleCount = 0;
  let previousSampleCount = 0;

  for (const midi of commonMidis) {
    const currentNote = currentRun.notes[String(midi)];
    const previousNote = previousRun.notes[String(midi)];
    if (!currentNote || !previousNote) continue;
    const currentCount = currentNote.responseSampleCount ?? 0;
    const previousCount = previousNote.responseSampleCount ?? 0;
    if (currentCount <= 0 || previousCount <= 0) continue;
    currentTotalMs += currentNote.totalResponseMs ?? 0;
    previousTotalMs += previousNote.totalResponseMs ?? 0;
    currentSampleCount += currentCount;
    previousSampleCount += previousCount;
  }

  if (currentSampleCount === 0 || previousSampleCount === 0) return [null, null];
  return [currentTotalMs / currentSampleCount, previousTotalMs / previousSampleCount];
}

/**
 * Selects a comparable prior run according to the current activity's history line.
 * Review: same range+same difficulty, same range, any practice, then challenge.
 * Drill: drill history only. Challenge runs are not shown a comparison section.
 */
export function compareStaffGameWrongNoteRun(
  archives: readonly StaffGameWrongNoteArchive[],
  currentRun: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteComparison | null {
  if (!hasCompleteComparisonFields(currentRun)) return null;

  const runs = archives.flatMap((archive) => archive.runs);
  let previousRun: StaffGameWrongNoteArchiveRun | undefined;

  if (currentRun.source === "review") {
    const hasRange = currentRun.reviewRange !== undefined && currentRun.reviewRange !== null;
    if (hasRange) {
      previousRun = latestMatchingRun(
        runs,
        (run) =>
          run.source === "review" &&
          run.reviewRange === currentRun.reviewRange &&
          run.difficulty === currentRun.difficulty,
        currentRun
      );
      previousRun ??= latestMatchingRun(
        runs,
        (run) => run.source === "review" && run.reviewRange === currentRun.reviewRange,
        currentRun
      );
    }
    previousRun ??= latestMatchingRun(
      runs,
      (run) => run.source === "review" || run.source === "drill",
      currentRun
    );
    previousRun ??= latestMatchingRun(runs, (run) => run.source === "challenge", currentRun);
  } else if (currentRun.source === "drill") {
    previousRun = latestMatchingRun(runs, (run) => run.source === "drill", currentRun);
  } else {
    return null;
  }

  if (!previousRun) return null;
  const midis = commonNoteMidis(currentRun, previousRun);
  if (midis.length === 0) return null;
  const currentSummary = summarizeNotes(currentRun, midis);
  const previousSummary = summarizeNotes(previousRun, midis);
  const [currentAverageResponseMs, previousAverageResponseMs] = averageResponseMsForSharedSamples(
    currentRun,
    previousRun,
    midis
  );

  return {
    previousRun,
    commonNoteMidis: midis,
    currentFirstTryAccuracyPercent: currentSummary.accuracyPercent,
    previousFirstTryAccuracyPercent: previousSummary.accuracyPercent,
    currentWeakNoteCount: currentSummary.weakNoteCount,
    previousWeakNoteCount: previousSummary.weakNoteCount,
    currentAverageResponseMs,
    previousAverageResponseMs,
  };
}

export function getStaffGameWrongNoteArchiveRunCount(
  archives: readonly StaffGameWrongNoteArchive[]
): number {
  return archives.reduce((count, archive) => count + archive.runs.length, 0);
}
