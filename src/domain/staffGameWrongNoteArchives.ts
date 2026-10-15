import type { StaffGameWrongNoteArchive, StaffGameWrongNoteArchiveRun } from "./types";

export type StaffGameWrongNoteRange = 3 | 7 | 15 | 30 | "all";

export interface StaffGameWrongNoteComparison {
  previousRun: StaffGameWrongNoteArchiveRun;
  commonNoteMidis: number[];
  currentCommonTargetCount: number;
  previousCommonTargetCount: number;
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

function noteLastErrorDate(
  lastErrorAt: string | undefined,
  runEndedAt: string,
  archiveDate: string
): string {
  for (const timestamp of [lastErrorAt, runEndedAt]) {
    if (!timestamp) continue;
    const time = Date.parse(timestamp);
    if (Number.isFinite(time)) return localDateKey(new Date(time));
  }
  return archiveDate;
}

/** Apply the shared local-calendar-day boundary without filtering by run contents. */
export function filterStaffGameWrongNoteArchivesByCalendarRange(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteArchive[] {
  if (range === "all") return [...archives];
  return archives.filter((archive) => archiveAgeDays(archive.date, today) < range);
}

/** Select error archives using the same date boundary as review weighting. */
export function filterStaffGameWrongNoteArchivesByRange(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteArchive[] {
  return filterStaffGameWrongNoteArchivesByCalendarRange(
    filterStaffGameWrongNoteArchivesWithErrors(archives),
    range,
    today
  );
}

/** Count wrong and missed answers in one run. */
export function getStaffGameWrongNoteRunErrorCount(run: StaffGameWrongNoteArchiveRun): number {
  return Object.values(run.notes).reduce((total, note) => total + note.wrong + note.missed, 0);
}

/** Keep performance-only rows and all-correct runs out of weak-note workflows. */
export function filterStaffGameWrongNoteArchivesWithErrors(
  archives: readonly StaffGameWrongNoteArchive[]
): StaffGameWrongNoteArchive[] {
  return archives.flatMap((archive) => {
    const runs = archive.runs.filter(
      (run) => run.trendOnly !== true && getStaffGameWrongNoteRunErrorCount(run) > 0
    );
    return runs.length > 0 ? [{ ...archive, runs }] : [];
  });
}

export function getStaffGameWrongNoteArchiveDateCount(
  archives: readonly StaffGameWrongNoteArchive[]
): number {
  return filterStaffGameWrongNoteArchivesWithErrors(archives).length;
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

export interface StaffGameWrongNoteNoteDiagnostic {
  midi: number;
  appearanceCount: number;
  runCount: number;
  correctCount: number;
  errorCount: number;
  accuracyPercent: number | null;
  errorRatePercent: number | null;
  averageResponseMs: number | null;
  confusions: Array<{ note: string; count: number }>;
}

/** Summarize each played note from every saved performance row in the selected date range. */
export function calculateStaffGameWrongNoteNoteDiagnostics(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteNoteDiagnostic[] {
  const aggregates = new Map<
    number,
    {
      appearanceCount: number;
      runCount: number;
      correctCount: number;
      errorCount: number;
      responseTotalMs: number;
      responseSampleCount: number;
      confusions: Map<string, number>;
    }
  >();

  for (const archive of filterStaffGameWrongNoteArchivesByCalendarRange(archives, range, today)) {
    for (const run of archive.runs) {
      for (const note of Object.values(run.notes)) {
        if (note.appear <= 0 && note.wrong + note.missed <= 0) continue;
        const aggregate = aggregates.get(note.midi) ?? {
          appearanceCount: 0,
          runCount: 0,
          correctCount: 0,
          errorCount: 0,
          responseTotalMs: 0,
          responseSampleCount: 0,
          confusions: new Map<string, number>(),
        };
        aggregate.appearanceCount += Math.max(0, note.appear);
        aggregate.runCount += 1;
        aggregate.correctCount += Math.max(0, note.correct);
        aggregate.errorCount += Math.max(0, note.wrong) + Math.max(0, note.missed);
        if (run.responseTimeBasis === "first-correct") {
          aggregate.responseTotalMs += Math.max(0, note.totalResponseMs ?? 0);
          aggregate.responseSampleCount += Math.max(0, note.responseSampleCount ?? 0);
        }
        for (const [confusedNote, count] of Object.entries(note.confusions ?? {})) {
          if (count > 0) {
            aggregate.confusions.set(
              confusedNote,
              (aggregate.confusions.get(confusedNote) ?? 0) + count
            );
          }
        }
        aggregates.set(note.midi, aggregate);
      }
    }
  }

  return [...aggregates.entries()]
    .map(([midi, aggregate]) => ({
      midi,
      appearanceCount: aggregate.appearanceCount,
      runCount: aggregate.runCount,
      correctCount: aggregate.correctCount,
      errorCount: aggregate.errorCount,
      accuracyPercent:
        aggregate.appearanceCount > 0
          ? (aggregate.correctCount / aggregate.appearanceCount) * 100
          : null,
      errorRatePercent:
        aggregate.appearanceCount > 0
          ? (aggregate.errorCount / aggregate.appearanceCount) * 100
          : null,
      averageResponseMs:
        aggregate.responseSampleCount > 0
          ? aggregate.responseTotalMs / aggregate.responseSampleCount
          : null,
      confusions: [...aggregate.confusions.entries()]
        .map(([note, count]) => ({ note, count }))
        .sort((left, right) => right.count - left.count || left.note.localeCompare(right.note))
        .slice(0, 2),
    }))
    .sort((left, right) => {
      if (left.errorRatePercent === null && right.errorRatePercent !== null) return 1;
      if (right.errorRatePercent === null && left.errorRatePercent !== null) return -1;
      return (
        (right.errorRatePercent ?? 0) - (left.errorRatePercent ?? 0) ||
        right.errorCount - left.errorCount ||
        left.midi - right.midi
      );
    });
}

/** Remove legacy staff-game drill runs while retaining every other archive source. */
export function filterLegacyStaffGameDrillArchives(
  archives: readonly StaffGameWrongNoteArchive[]
): StaffGameWrongNoteArchive[] {
  return archives.flatMap((archive) => {
    const runs = archive.runs.filter((run) => (run.source as string) !== "drill");
    return runs.length > 0 ? [{ ...archive, runs }] : [];
  });
}

export function mergeStaffGameWrongNoteArchives(
  ...archiveSets: Array<readonly StaffGameWrongNoteArchive[]>
): StaffGameWrongNoteArchive[] {
  const byDate = new Map<string, StaffGameWrongNoteArchive>();
  for (const archive of filterLegacyStaffGameDrillArchives(archiveSets.flat())) {
    const date = archive.date || archive.id;
    const current = byDate.get(date);
    const runs = new Map<string, StaffGameWrongNoteArchiveRun>();
    for (const run of [...(current?.runs ?? []), ...archive.runs]) {
      const existing = runs.get(run.runId);
      const promotesTrendOnlyRun = existing?.trendOnly === true && run.trendOnly !== true;
      if (!existing || promotesTrendOnlyRun || runUpdatedAtMs(run) > runUpdatedAtMs(existing)) {
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
    for (const run of archive.runs) {
      for (const note of Object.values(run.notes)) {
        const errors = note.wrong + note.missed;
        if (errors <= 0) continue;
        const errorDate = noteLastErrorDate(note.lastErrorAt, run.endedAt, archive.date);
        const ageDays = archiveAgeDays(errorDate, today);
        const decay = 0.5 ** (ageDays / 7);
        weights.set(note.midi, (weights.get(note.midi) ?? 0) + errors * decay);
      }
    }
  }
  return weights;
}

export function getStaffGameWrongNotePriorityPreview(
  weights: ReadonlyMap<number, number>,
  eligibleMidis: ReadonlySet<number>,
  limit = 5
): Array<{ midi: number; weight: number }> {
  return [...weights.entries()]
    .filter(([midi, weight]) => eligibleMidis.has(midi) && weight > 0)
    .sort(
      ([leftMidi, leftWeight], [rightMidi, rightWeight]) =>
        rightWeight - leftWeight || leftMidi - rightMidi
    )
    .slice(0, Math.max(0, limit))
    .map(([midi, weight]) => ({ midi, weight }));
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

const STAFF_GAME_WRONG_NOTE_SOURCES = new Set(["challenge", "review"]);
const STAFF_GAME_WRONG_NOTE_REVIEW_RANGES = new Set([3, 7, 15, 30, "all"]);

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function hasCompleteStaffGameWrongNoteComparisonData(
  run: StaffGameWrongNoteArchiveRun
): boolean {
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
        hasCompleteStaffGameWrongNoteComparisonData(run) &&
        predicate(run) &&
        commonNoteMidis(currentRun, run).length > 0
    )
    .sort((first, second) => second.endedAt.localeCompare(first.endedAt))[0];
}

function summarizeNotes(
  run: StaffGameWrongNoteArchiveRun,
  midis: readonly number[]
): { accuracyPercent: number; errorCount: number; targetCount: number } {
  let appear = 0;
  let correct = 0;
  let errorCount = 0;
  for (const midi of midis) {
    const note = run.notes[String(midi)];
    if (!note) continue;
    appear += note.appear;
    correct += note.correct;
    errorCount += note.wrong + note.missed;
  }
  return {
    accuracyPercent: appear > 0 ? (correct / appear) * 100 : 0,
    errorCount,
    targetCount: appear,
  };
}

function averageResponseMsForSharedSamples(
  currentRun: StaffGameWrongNoteArchiveRun,
  previousRun: StaffGameWrongNoteArchiveRun,
  commonMidis: readonly number[]
): [number | null, number | null] {
  if (
    currentRun.responseTimeBasis !== "first-correct" ||
    previousRun.responseTimeBasis !== "first-correct"
  ) {
    return [null, null];
  }

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
 * Review: same range+same difficulty, same range, any review, then challenge.
 * Challenge runs are not shown a comparison section.
 */
export function compareStaffGameWrongNoteRun(
  archives: readonly StaffGameWrongNoteArchive[],
  currentRun: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteComparison | null {
  if (!hasCompleteStaffGameWrongNoteComparisonData(currentRun)) return null;

  const runs = filterStaffGameWrongNoteArchivesWithErrors(archives).flatMap(
    (archive) => archive.runs
  );
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
    previousRun ??= latestMatchingRun(runs, (run) => run.source === "review", currentRun);
    previousRun ??= latestMatchingRun(runs, (run) => run.source === "challenge", currentRun);
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
    currentCommonTargetCount: currentSummary.targetCount,
    previousCommonTargetCount: previousSummary.targetCount,
    currentFirstTryAccuracyPercent: currentSummary.accuracyPercent,
    previousFirstTryAccuracyPercent: previousSummary.accuracyPercent,
    currentWeakNoteCount: currentSummary.errorCount,
    previousWeakNoteCount: previousSummary.errorCount,
    currentAverageResponseMs,
    previousAverageResponseMs,
  };
}

export function getStaffGameWrongNoteArchiveRunCount(
  archives: readonly StaffGameWrongNoteArchive[]
): number {
  return archives.reduce((count, archive) => count + archive.runs.length, 0);
}
