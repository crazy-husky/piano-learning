import type { DuetTimingGrade, ReviewRecord, Staff } from "./types";

export interface DuetCountRate {
  correct: number;
  total: number;
}

export interface DuetPracticeSummaryStats {
  hands: Record<Staff, DuetCountRate & { completed: number }>;
  timing: {
    early: number;
    onTime: number;
    late: number;
    missed: number;
    wrongOnTimeAttempts: number;
    correctOffbeatTargets: number;
  };
  singleNoteEvents: DuetCountRate;
  multiNoteEvents: DuetCountRate;
  bothHandEvents: DuetCountRate;
}

type DuetSummaryRecord = {
  duetPerformance?: ReviewRecord["duetPerformance"];
  interrupted?: boolean;
  wasInterrupted?: boolean;
  wasMissed?: boolean;
  isMissed?: boolean;
};

function isOnBeat(target: { timingGrade?: DuetTimingGrade }): boolean {
  return target.timingGrade === "on-time";
}

function isCompleteOnFirstTry(
  targets: NonNullable<ReviewRecord["duetPerformance"]>["targets"],
  syncEnabled: boolean
): boolean {
  return (
    targets.length > 0 &&
    targets.every((target) =>
      syncEnabled ? target.firstTryCorrect && isOnBeat(target) : target.firstTryCorrect
    )
  );
}

export function buildDuetPracticeSummaryStats(
  reviews: DuetSummaryRecord[],
  syncEnabledFallback = false
): DuetPracticeSummaryStats {
  const stats: DuetPracticeSummaryStats = {
    hands: {
      treble: { correct: 0, total: 0, completed: 0 },
      bass: { correct: 0, total: 0, completed: 0 },
    },
    timing: {
      early: 0,
      onTime: 0,
      late: 0,
      missed: 0,
      wrongOnTimeAttempts: 0,
      correctOffbeatTargets: 0,
    },
    singleNoteEvents: { correct: 0, total: 0 },
    multiNoteEvents: { correct: 0, total: 0 },
    bothHandEvents: { correct: 0, total: 0 },
  };

  for (const review of reviews) {
    const performance = review.duetPerformance;
    if (!performance) continue;
    const syncEnabled = performance.syncEnabled ?? syncEnabledFallback;

    const attemptedTargets = performance.targets.filter((target) => target.attempted);
    for (const target of attemptedTargets) {
      const hand = stats.hands[target.staff];
      hand.total += 1;
      hand.correct += Number(target.firstTryCorrect);
      hand.completed += Number(target.completed);

      if (target.completed && target.timingGrade) {
        if (target.timingGrade === "early") stats.timing.early += 1;
        else if (target.timingGrade === "on-time") stats.timing.onTime += 1;
        else stats.timing.late += 1;
        if (target.timingGrade !== "on-time") stats.timing.correctOffbeatTargets += 1;
      }
      if (syncEnabled && target.missedOnset) stats.timing.missed += 1;
    }

    stats.timing.wrongOnTimeAttempts += performance.wrongOnTimeAttempts;

    const wasInterrupted = review.interrupted ?? review.wasInterrupted ?? false;
    const wasMissed = review.wasMissed ?? review.isMissed ?? false;
    if ((wasInterrupted && !wasMissed) || attemptedTargets.length !== performance.targets.length) {
      continue;
    }

    if (performance.targets.length === 1) {
      stats.singleNoteEvents.total += 1;
      stats.singleNoteEvents.correct += Number(
        isCompleteOnFirstTry(performance.targets, syncEnabled)
      );
    } else if (performance.targets.length > 1) {
      stats.multiNoteEvents.total += 1;
      stats.multiNoteEvents.correct += Number(
        isCompleteOnFirstTry(performance.targets, syncEnabled)
      );
    }

    const staves = new Set(performance.targets.map((target) => target.staff));
    if (staves.has("treble") && staves.has("bass")) {
      stats.bothHandEvents.total += 1;
      stats.bothHandEvents.correct += Number(
        isCompleteOnFirstTry(performance.targets, syncEnabled)
      );
    }
  }

  return stats;
}

export function formatDuetRate(rate: DuetCountRate): string {
  return rate.total > 0 ? `${Math.round((rate.correct / rate.total) * 100)}%` : "—";
}
