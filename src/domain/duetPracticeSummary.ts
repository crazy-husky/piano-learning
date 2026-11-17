import type { DuetPracticeLevel, DuetTimingGrade, ReviewRecord, Staff } from "./types";

export interface DuetCountRate {
  correct: number;
  total: number;
}

export type DuetStaffCountRates = Record<Staff, DuetCountRate>;

export interface DuetEventCountRate extends DuetCountRate {
  hands: DuetStaffCountRates;
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
  singleNoteEvents: DuetEventCountRate;
  multiNoteEvents: DuetEventCountRate;
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

function isPitchCompleteOnFirstTry(
  performance: NonNullable<ReviewRecord["duetPerformance"]>
): boolean {
  return (
    performance.targets.length > 0 && performance.targets.every((target) => target.firstTryCorrect)
  );
}

export function buildDuetPracticeSummaryStats(
  reviews: DuetSummaryRecord[],
  syncEnabledFallback = false
): DuetPracticeSummaryStats {
  const createEventRate = (): DuetEventCountRate => ({
    correct: 0,
    total: 0,
    hands: {
      treble: { correct: 0, total: 0 },
      bass: { correct: 0, total: 0 },
    },
  });
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
    singleNoteEvents: createEventRate(),
    multiNoteEvents: createEventRate(),
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

    if (performance.targets.length > 0) {
      const eventRate =
        performance.targets.length === 1 ? stats.singleNoteEvents : stats.multiNoteEvents;
      const eventCorrect = isPitchCompleteOnFirstTry(performance);
      eventRate.total += 1;
      eventRate.correct += Number(eventCorrect);
      for (const target of performance.targets) {
        const handRate = eventRate.hands[target.staff];
        handRate.total += 1;
        handRate.correct += Number(target.firstTryCorrect);
      }
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
    return "本轮用于检查薄弱音，建议继续针对这些错音进行练习。";
  }

  const hands = (["bass", "treble"] as const)
    .filter((staff) => stats.hands[staff].total > 0)
    .map((staff) => ({
      staff,
      rate: stats.hands[staff].correct / stats.hands[staff].total,
    }))
    .sort((left, right) => left.rate - right.rate);
  if (hands.length === 0) {
    return "本次练习数据还不足以判断练习重点，建议再完成一轮双手协同练习。";
  }

  const weakestHand = hands[0]!;
  const weakHands = hands.filter((hand) => hand.rate < 0.5);
  if (weakHands.length > 0) {
    const handNames = weakHands.map(({ staff }) => (staff === "treble" ? "右手" : "左手"));
    const handAdvice =
      handNames.length === 2
        ? "左右手的音高判断还不够稳定，建议先到 Level 2「单音极速反应」分别进行单手单音练习，稳固认音和找键。"
        : `${handNames[0]}的音高判断还不够稳定，建议先到 Level 2「单音极速反应」进行单手单音练习，稳固认音和找键。`;
    const tempoAdvice =
      options.syncEnabled && options.metronomeBpm !== undefined && options.metronomeBpm > 40
        ? "当前节拍可能偏快，建议适当调慢；稳定后再逐步加快。"
        : "";
    return `${handAdvice}${tempoAdvice ? ` ${tempoAdvice}` : ""}`;
  }

  const weakestHandName = weakestHand.staff === "treble" ? "右手" : "左手";
  if (weakestHand.rate < 0.8) {
    return `整体表现不错，${weakestHandName}的音高判断还有提升空间。建议到统计页面针对薄弱音进行复习，再回到双手协同巩固。`;
  }
  if (hands.length < 2) {
    return `${weakestHandName}的表现不错；本次只练习了一只手，建议选择包含左右手的练习后再查看双手建议。`;
  }
  if (weakestHand.rate < 0.9) {
    return `左右手配合已经很不错，音高判断也比较稳定。继续练习并保持稳定，可以挑战更高的准确度。`;
  }

  const nextLevelAdvice: Partial<Record<DuetPracticeLevel, string>> = {
    "level-2": "可以尝试 Level 3「大量同步」，提升两手同时起音的密度。",
    "level-3": "可以尝试 Level 4「柱式和弦」，练习左手和弦与右手旋律的配合。",
    "level-4": "可以尝试 Level 5「八分音符」，练习更连续的旋律与和弦配合。",
    "level-5": "可以尝试 Level 6「分解和弦」，练习左手分解和弦与右手旋律的配合。",
  };

  if (options.level === "level-1") {
    return options.strictHandAlternation
      ? "严格轮流挑战已经完成得很稳，可以尝试 Level 2「少量同步」，开始练习两手偶尔同时起音。"
      : "双手音高判断已经很稳定，可以开启「左右手轮流出现音符（更难）」，挑战更严格的左右手交替。";
  }
  if (options.level === "level-6") {
    return options.allowDottedRhythms
      ? "分解和弦与附点节奏的配合已经比较稳定。可以继续巩固，也可以尝试更宽的练习音区。"
      : "本关练习表现稳定，可以开启「附点节奏挑战」，继续练习节奏变化。";
  }
  return nextLevelAdvice[options.level] ?? "表现很棒，继续保持稳定的双手协同。";
}
