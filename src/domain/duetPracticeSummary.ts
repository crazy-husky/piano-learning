import type { DuetPracticeLevel, DuetTimingGrade, ReviewRecord, Staff } from "./types";

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
    correctOffbeatOnsets: number;
  };
  singleNoteEvents: DuetCountRate;
  multiNoteEvents: DuetCountRate;
  bothHandEvents: DuetCountRate;
}

export interface DuetPracticeSuggestionOptions {
  allowDottedRhythms: boolean;
  level: DuetPracticeLevel;
  metronomeBpm?: number;
  strictHandAlternation: boolean;
  syncEnabled: boolean;
  wrongNoteTest: boolean;
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
  performance: NonNullable<ReviewRecord["duetPerformance"]>,
  syncEnabled: boolean
): boolean {
  const { targets } = performance;
  return (
    targets.length > 0 &&
    targets.every((target) => target.firstTryCorrect) &&
    (!syncEnabled ||
      (performance.timingModel === "onset-v1"
        ? performance.onsetTimingGrade === "on-time"
        : targets.every(isOnBeat)))
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
      correctOffbeatOnsets: 0,
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
    }

    if (syncEnabled && performance.timingModel === "onset-v1") {
      if (performance.onsetTimingGrade === "early") stats.timing.early += 1;
      else if (performance.onsetTimingGrade === "on-time") stats.timing.onTime += 1;
      else if (performance.onsetTimingGrade === "late") stats.timing.late += 1;
      if (performance.onsetTimingGrade && performance.onsetTimingGrade !== "on-time") {
        stats.timing.correctOffbeatOnsets += 1;
      }
      if (performance.onsetMissed) stats.timing.missed += 1;
    } else {
      for (const target of attemptedTargets) {
        if (target.completed && target.timingGrade) {
          if (target.timingGrade === "early") stats.timing.early += 1;
          else if (target.timingGrade === "on-time") stats.timing.onTime += 1;
          else stats.timing.late += 1;
          if (target.timingGrade !== "on-time") stats.timing.correctOffbeatOnsets += 1;
        }
        if (syncEnabled && target.missedOnset) stats.timing.missed += 1;
      }
    }

    stats.timing.wrongOnTimeAttempts += performance.wrongOnTimeAttempts;

    const wasInterrupted = review.interrupted ?? review.wasInterrupted ?? false;
    const wasMissed = review.wasMissed ?? review.isMissed ?? false;
    if ((wasInterrupted && !wasMissed) || attemptedTargets.length !== performance.targets.length) {
      continue;
    }

    if (performance.targets.length === 1) {
      stats.singleNoteEvents.total += 1;
      stats.singleNoteEvents.correct += Number(isCompleteOnFirstTry(performance, syncEnabled));
    } else if (performance.targets.length > 1) {
      stats.multiNoteEvents.total += 1;
      stats.multiNoteEvents.correct += Number(isCompleteOnFirstTry(performance, syncEnabled));
    }

    const staves = new Set(performance.targets.map((target) => target.staff));
    if (staves.has("treble") && staves.has("bass")) {
      stats.bothHandEvents.total += 1;
      stats.bothHandEvents.correct += Number(isCompleteOnFirstTry(performance, syncEnabled));
    }
  }

  return stats;
}

export function formatDuetRate(rate: DuetCountRate): string {
  return rate.total > 0 ? `${Math.round((rate.correct / rate.total) * 100)}%` : "—";
}

export function buildDuetPracticeSuggestion(
  stats: DuetPracticeSummaryStats,
  options: DuetPracticeSuggestionOptions
): string {
  if (options.wrongNoteTest) {
    return "本轮是错音专项测试，结果用于检查薄弱音，不用于判断关卡进度；建议继续针对这些错音练习。";
  }

  const hands = (["bass", "treble"] as const)
    .filter((staff) => stats.hands[staff].total > 0)
    .map((staff) => ({
      staff,
      rate: stats.hands[staff].correct / stats.hands[staff].total,
    }))
    .sort((left, right) => left.rate - right.rate);
  if (hands.length === 0) {
    return "本次有效首答样本不足，暂时无法判断练习重点；完成一轮后再查看建议。";
  }

  const weakestHand = hands[0]!;
  const weakHands = hands.filter((hand) => hand.rate < 0.5);
  if (weakHands.length > 0) {
    const handNames = weakHands.map(({ staff }) => (staff === "treble" ? "右手" : "左手"));
    const handAdvice =
      handNames.length === 2
        ? "左右手首答正确率都低于 50%，建议先回到自由练习，分别进行单手单音练习，稳固音高判断。"
        : `${handNames[0]}首答正确率低于 50%，建议先回到自由练习，选择${handNames[0]}进行单手单音练习，稳固音高判断。`;
    const tempoAdvice =
      options.syncEnabled && options.metronomeBpm !== undefined && options.metronomeBpm > 40
        ? `当前全局木鱼速度为 ${options.metronomeBpm} BPM，可能偏快，建议先降到 40 BPM；稳定后再逐步加速。`
        : "";
    return `${handAdvice}${tempoAdvice ? ` ${tempoAdvice}` : ""}`;
  }

  const weakestHandName = weakestHand.staff === "treble" ? "右手" : "左手";
  if (weakestHand.rate < 0.8) {
    return `表现还不错，但${weakestHandName}首答正确率还未达到 80% 达标线。建议到统计页面针对错音进行复习，优先巩固${weakestHandName}的薄弱音。`;
  }
  if (hands.length < 2) {
    return `${weakestHandName}首答正确率表现不错；本次样本尚未覆盖左右手，建议完成包含双手的练习后再查看进阶建议。`;
  }
  if (weakestHand.rate < 0.9) {
    return `左右手首答正确率都已达到 80% 达标线，表现很棒；继续巩固${weakestHandName}，向 90% 正确率冲刺。`;
  }

  const nextLevelAdvice: Partial<Record<DuetPracticeLevel, string>> = {
    "level-2": "可以尝试 Level 3「大量同步」，提升两手同时起音的密度。",
    "level-3": "可以尝试 Level 4「柱式和弦」，练习左手和弦与右手旋律的配合。",
    "level-4": "可以尝试 Level 5「八分音符」，练习更连续的旋律与和弦配合。",
    "level-5": "可以尝试 Level 6「分解和弦」，练习左手分解和弦与右手旋律的配合。",
  };

  if (options.level === "level-1") {
    return options.strictHandAlternation
      ? "左右手轮流挑战中也达到 90% 以上，可以尝试 Level 2「少量同步」，开始练习两手偶尔同时起音。"
      : "左右手首答正确率已达到 90% 以上，可以开启「左右手轮流出现音符（更难）」，挑战严格的左右手交替。";
  }
  if (options.level === "level-6") {
    return options.allowDottedRhythms
      ? "本关已达到 90% 以上。可以继续巩固分解和弦与附点节奏，或尝试更宽的练习音区。"
      : "本关已达到 90% 以上，可以开启「附点节奏挑战」，继续练习节奏变化。";
  }
  return nextLevelAdvice[options.level] ?? "表现很棒，继续保持稳定的双手协同。";
}
