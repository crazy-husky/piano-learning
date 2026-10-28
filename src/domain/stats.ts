import { ALL_NOTES, NOTE_NAMES, normalizeCurrentPracticeGroupIds } from "./notes";
import { isCompletedReview, isStatisticalReview } from "./reviews";
import adaptiveV2Spec from "./adaptiveV2Spec.json";
import type {
  NoteName,
  PracticeGroupId,
  PracticeSessionRecord,
  ReviewRecord,
  TargetNoteId,
} from "./types";

export interface DailyStat {
  date: string;
  completedReviews: number;
  totalActiveMs: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  heatLevel: HeatLevel;
}

export interface NoteStat {
  targetNoteId: TargetNoteId;
  groupId: PracticeGroupId;
  reviewCount: number;
  errorCount: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  errorRate: number;
  commonConfusion?: NoteName;
  commonConfusions: NoteConfusionStat[];
  weaknessScore: number;
}

export interface NoteConfusionStat {
  count: number;
  noteName: NoteName;
}

export interface PracticeSessionStat {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  completedReviews: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
}

export type RecognitionTrendGrouping = "day" | "practice-session";

export interface RecognitionTrendPoint {
  boundaryAt: string;
  coveredNoteCount: number;
  coveredNoteIds: TargetNoteId[];
  errorRate?: number;
  key: string;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  totalNoteCount: number;
}

export const MIN_SESSION_STAT_REVIEWS = 5;
const HEAVY_ERROR_WRONG_ANSWER_COUNT = 3;
const PERFORMANCE_REVIEW_LIMIT = adaptiveV2Spec.performanceReviewLimit;
export type PositiveHeatLevel = 1 | 2 | 3;
export type HeatLevel = 0 | PositiveHeatLevel;

export type LongTermStatsIneligibilityReason =
  "not-enough-statistical-reviews" | "too-many-error-reviews" | "too-many-heavy-error-reviews";

export interface LongTermStatsEligibility {
  eligible: boolean;
  errorReviewCount: number;
  heavyErrorReviewCount: number;
  reason?: LongTermStatsIneligibilityReason;
  statisticalReviewCount: number;
}

function groupReviewsBySession(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const reviewsBySession = new Map<string, ReviewRecord[]>();
  for (const review of reviews) {
    const sessionReviews = reviewsBySession.get(review.sessionId);
    if (sessionReviews) {
      sessionReviews.push(review);
    } else {
      reviewsBySession.set(review.sessionId, [review]);
    }
  }
  return reviewsBySession;
}

export function getLongTermStatsEligibility(reviews: ReviewRecord[]): LongTermStatsEligibility {
  let statisticalReviewCount = 0;
  let errorReviewCount = 0;
  let heavyErrorReviewCount = 0;

  for (const review of reviews) {
    if (!isStatisticalReview(review)) {
      continue;
    }
    statisticalReviewCount += 1;
    if (review.wrongAnswers.length > 0 || review.wasMissed) {
      errorReviewCount += 1;
    }
    if (review.wrongAnswers.length >= HEAVY_ERROR_WRONG_ANSWER_COUNT) {
      heavyErrorReviewCount += 1;
    }
  }

  const reason =
    statisticalReviewCount < MIN_SESSION_STAT_REVIEWS
      ? "not-enough-statistical-reviews"
      : heavyErrorReviewCount * 2 > statisticalReviewCount
        ? "too-many-heavy-error-reviews"
        : errorReviewCount * 3 > statisticalReviewCount * 2
          ? "too-many-error-reviews"
          : undefined;
  return {
    eligible: reason === undefined,
    errorReviewCount,
    heavyErrorReviewCount,
    reason,
    statisticalReviewCount,
  };
}

export function isLongTermStatsEligible(reviews: ReviewRecord[]): boolean {
  return getLongTermStatsEligibility(reviews).eligible;
}

export function filterLongTermReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  const reviewsBySession = groupReviewsBySession(reviews);
  const eligibleSessionIds = new Set(
    [...reviewsBySession.entries()]
      .filter(([, sessionReviews]) => isLongTermStatsEligible(sessionReviews))
      .map(([sessionId]) => sessionId)
  );
  return reviews.filter((review) => eligibleSessionIds.has(review.sessionId));
}

export function percentile(values: number[], percent: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return percentileFromSorted(sorted, percent);
}

function percentileFromSorted(sorted: readonly number[], percent: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = (sorted.length - 1) * percent;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export interface PositiveTertileThresholds {
  high: number;
  low: number;
}

export function positiveTertileThresholds(
  positiveValues: number[]
): PositiveTertileThresholds | undefined {
  const low = percentile(positiveValues, 1 / 3);
  const high = percentile(positiveValues, 2 / 3);
  return low === undefined || high === undefined ? undefined : { low, high };
}

export function positiveTertileLevel(value: number, positiveValues: number[]): PositiveHeatLevel {
  const thresholds = positiveTertileThresholds(positiveValues);
  if (!thresholds || value <= thresholds.low) {
    return 1;
  }
  return value <= thresholds.high ? 2 : 3;
}

export function localDateKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function commonConfusions(
  reviews: ReviewRecord[],
  targetNoteId: TargetNoteId,
  targetNoteName: NoteName
): NoteConfusionStat[] {
  const counts = new Map<NoteName, number>();
  for (const review of reviews) {
    for (const wrongAnswer of getWrongAnswersForTarget(review, targetNoteId)) {
      if (wrongAnswer.noteName === targetNoteName) {
        continue;
      }
      counts.set(wrongAnswer.noteName, (counts.get(wrongAnswer.noteName) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([noteName, count]) => ({ noteName, count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        NOTE_NAMES.indexOf(left.noteName) - NOTE_NAMES.indexOf(right.noteName)
    )
    .slice(0, 3);
}

export function buildDailyStats(reviews: ReviewRecord[]): DailyStat[] {
  const byDate = new Map<string, ReviewRecord[]>();
  for (const review of reviews.filter(isStatisticalReview)) {
    const date = localDateKey(review.answeredAt ?? review.endedAt);
    const dayReviews = byDate.get(date);
    if (dayReviews) {
      dayReviews.push(review);
    } else {
      byDate.set(date, [review]);
    }
  }

  const totalActiveMsByDate = new Map(
    [...byDate.entries()].map(([date, dayReviews]) => [
      date,
      dayReviews.reduce((total, review) => total + review.activeMs, 0),
    ])
  );
  const positiveActiveMsTotals = [...totalActiveMsByDate.values()].filter(
    (totalActiveMs) => totalActiveMs > 0
  );

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayReviews]) => {
      const times = dayReviews.filter(isCompletedReview).map((review) => review.activeMs);
      const completedReviews = dayReviews.length;
      const totalActiveMs = totalActiveMsByDate.get(date) ?? 0;
      return {
        date,
        completedReviews,
        totalActiveMs,
        p10Ms: percentile(times, 0.1),
        medianMs: percentile(times, 0.5),
        p90Ms: percentile(times, 0.9),
        heatLevel:
          totalActiveMs === 0 ? 0 : positiveTertileLevel(totalActiveMs, positiveActiveMsTotals),
      };
    });
}

function earliestReviewStartedAt(reviews: ReviewRecord[]): string {
  return reviews.reduce(
    (earliest, review) =>
      new Date(review.startedAt).getTime() < new Date(earliest).getTime()
        ? review.startedAt
        : earliest,
    reviews[0].startedAt
  );
}

function latestReviewEndedAt(reviews: ReviewRecord[]): string {
  return reviews.reduce(
    (latest, review) =>
      new Date(review.endedAt).getTime() > new Date(latest).getTime() ? review.endedAt : latest,
    reviews[0].endedAt
  );
}

export function buildPracticeSessionStats(
  reviews: ReviewRecord[],
  sessions: PracticeSessionRecord[] = []
): PracticeSessionStat[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const reviewsBySession = new Map<string, ReviewRecord[]>();

  for (const review of reviews.filter(isStatisticalReview)) {
    reviewsBySession.set(review.sessionId, [
      ...(reviewsBySession.get(review.sessionId) ?? []),
      review,
    ]);
  }

  return [...reviewsBySession.entries()]
    .map(([sessionId, sessionReviews]) => {
      const session = sessionsById.get(sessionId);
      const times = sessionReviews.filter(isCompletedReview).map((review) => review.activeMs);
      return {
        sessionId,
        startedAt: session?.startedAt ?? earliestReviewStartedAt(sessionReviews),
        endedAt: session?.endedAt ?? latestReviewEndedAt(sessionReviews),
        completedReviews: sessionReviews.length,
        p10Ms: percentile(times, 0.1),
        medianMs: percentile(times, 0.5),
        p90Ms: percentile(times, 0.9),
      };
    })
    .sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() ||
        a.sessionId.localeCompare(b.sessionId)
    );
}

function average(values: number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reviewCompletedAt(review: ReviewRecord): number {
  return new Date(review.answeredAt ?? review.endedAt).getTime();
}

interface RecognitionNoteWindow {
  recent: { activeMs?: number; hasError: boolean }[];
  recentErrorCount: number;
  sortedActiveMs: number[];
  totalCount: number;
}

function getReviewTargetNoteIds(review: ReviewRecord): TargetNoteId[] {
  return [...new Set([review.targetNoteId, ...(review.duetTargetNoteIds ?? [])])];
}

function wasTargetMissed(review: ReviewRecord, targetNoteId: TargetNoteId): boolean {
  if (!review.wasMissed) return false;
  // Older duet records do not carry per-target completion state, so retain their
  // historical behavior and treat the timeout as a miss for every target.
  if (!review.duetCompletedTargetNoteIds) return true;
  return !review.duetCompletedTargetNoteIds.includes(targetNoteId);
}

function getWrongAnswersForTarget(
  review: ReviewRecord,
  targetNoteId: TargetNoteId
): ReviewRecord["wrongAnswers"] {
  const hasDuetAttribution = Boolean(
    review.duetTargetNoteIds?.length &&
    review.wrongAnswers.some((answer) => answer.duetTargetNoteId !== undefined)
  );
  if (!hasDuetAttribution) return review.wrongAnswers;
  return review.wrongAnswers.filter((answer) => answer.duetTargetNoteId === targetNoteId);
}

function reviewHasTargetError(review: ReviewRecord, targetNoteId: TargetNoteId): boolean {
  return (
    getWrongAnswersForTarget(review, targetNoteId).length > 0 ||
    wasTargetMissed(review, targetNoteId)
  );
}

function sortedInsertionIndex(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function addRecognitionReview(
  window: RecognitionNoteWindow,
  review: ReviewRecord,
  targetNoteId: TargetNoteId
): void {
  const recentReview = {
    ...(isCompletedReview(review) ? { activeMs: review.activeMs } : {}),
    hasError: reviewHasTargetError(review, targetNoteId),
  };
  window.totalCount += 1;
  window.recent.push(recentReview);
  if (recentReview.activeMs !== undefined) {
    window.sortedActiveMs.splice(
      sortedInsertionIndex(window.sortedActiveMs, recentReview.activeMs),
      0,
      recentReview.activeMs
    );
  }
  if (recentReview.hasError) {
    window.recentErrorCount += 1;
  }

  if (window.recent.length <= PERFORMANCE_REVIEW_LIMIT) {
    return;
  }
  const removed = window.recent.shift()!;
  if (removed.activeMs !== undefined) {
    const sortedIndex = window.sortedActiveMs.indexOf(removed.activeMs);
    if (sortedIndex >= 0) window.sortedActiveMs.splice(sortedIndex, 1);
  }
  if (removed.hasError) {
    window.recentErrorCount -= 1;
  }
}

export function buildRecognitionTrend(
  reviews: ReviewRecord[],
  sessions: PracticeSessionRecord[],
  targetNoteIds: readonly TargetNoteId[],
  grouping: RecognitionTrendGrouping
): RecognitionTrendPoint[] {
  const targetIds = [...new Set(targetNoteIds)].sort();
  const targetIdSet = new Set(targetIds);
  const statisticalReviews = reviews
    .filter(
      (review) =>
        getReviewTargetNoteIds(review).some((targetId) => targetIdSet.has(targetId)) &&
        isStatisticalReview(review)
    )
    .map((review) => ({
      completedAt: reviewCompletedAt(review),
      review,
      startedAt: new Date(review.startedAt).getTime(),
    }))
    .sort(
      (left, right) => left.completedAt - right.completedAt || left.startedAt - right.startedAt
    );
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const statisticalReviewsBySession = new Map<string, ReviewRecord[]>();
  for (const { review } of statisticalReviews) {
    const sessionReviews = statisticalReviewsBySession.get(review.sessionId);
    if (sessionReviews) {
      sessionReviews.push(review);
    } else {
      statisticalReviewsBySession.set(review.sessionId, [review]);
    }
  }
  const sessionBoundaries = [...statisticalReviewsBySession.entries()]
    .map(([sessionId, sessionReviews]) => {
      const boundaryAt =
        sessionsById.get(sessionId)?.endedAt ?? latestReviewEndedAt(sessionReviews);
      return {
        boundaryAt,
        boundaryTime: new Date(boundaryAt).getTime(),
        key: sessionId,
      };
    })
    .sort(
      (left, right) => left.boundaryTime - right.boundaryTime || left.key.localeCompare(right.key)
    );
  const byNote = new Map<TargetNoteId, RecognitionNoteWindow>(
    targetIds.map((noteId) => [
      noteId,
      {
        recent: [],
        recentErrorCount: 0,
        sortedActiveMs: [],
        totalCount: 0,
      },
    ])
  );
  let reviewIndex = 0;
  const sessionTrend = sessionBoundaries.map((boundary) => {
    while (
      reviewIndex < statisticalReviews.length &&
      statisticalReviews[reviewIndex].completedAt <= boundary.boundaryTime
    ) {
      const review = statisticalReviews[reviewIndex].review;
      getReviewTargetNoteIds(review).forEach((targetNoteId) => {
        const noteWindow = byNote.get(targetNoteId);
        if (noteWindow) addRecognitionReview(noteWindow, review, targetNoteId);
      });
      reviewIndex += 1;
    }
    const cohort = targetIds.filter((noteId) => (byNote.get(noteId)?.totalCount ?? 0) >= 20);
    const noteMetrics = cohort.map((noteId) => {
      const noteWindow = byNote.get(noteId)!;
      return {
        errorRate: noteWindow.recentErrorCount / noteWindow.recent.length,
        medianMs: percentileFromSorted(noteWindow.sortedActiveMs, 0.5),
        p10Ms: percentileFromSorted(noteWindow.sortedActiveMs, 0.1),
        p90Ms: percentileFromSorted(noteWindow.sortedActiveMs, 0.9),
      };
    });
    const reactionTimeMetrics = noteMetrics.filter((metric) => metric.medianMs !== undefined);
    return {
      boundaryAt: boundary.boundaryAt,
      coveredNoteCount: cohort.length,
      coveredNoteIds: cohort,
      errorRate: average(noteMetrics.map((metric) => metric.errorRate)),
      key: boundary.key,
      medianMs: average(reactionTimeMetrics.map((metric) => metric.medianMs!)),
      p10Ms: average(reactionTimeMetrics.map((metric) => metric.p10Ms!)),
      p90Ms: average(reactionTimeMetrics.map((metric) => metric.p90Ms!)),
      totalNoteCount: targetIds.length,
    };
  });

  return grouping === "day" ? groupRecognitionTrendByDay(sessionTrend) : sessionTrend;
}

export function groupRecognitionTrendByDay(
  sessionTrend: RecognitionTrendPoint[]
): RecognitionTrendPoint[] {
  const latestByDate = new Map<string, RecognitionTrendPoint>();
  for (const point of sessionTrend) {
    const date = localDateKey(point.boundaryAt);
    latestByDate.set(date, { ...point, key: date });
  }
  return [...latestByDate.values()];
}

export function buildNoteStats(
  reviews: ReviewRecord[],
  groupFilter?: PracticeGroupId[]
): NoteStat[] {
  const allowedGroups =
    groupFilter && groupFilter.length > 0
      ? new Set(normalizeCurrentPracticeGroupIds(groupFilter))
      : undefined;
  return ALL_NOTES.filter((note) => !allowedGroups || allowedGroups.has(note.groupId)).map(
    (note) => {
      const noteReviews = reviews.filter(
        (review) =>
          (review.targetNoteId === note.id || review.duetTargetNoteIds?.includes(note.id)) &&
          isStatisticalReview(review)
      );
      const times = noteReviews.filter(isCompletedReview).map((review) => review.activeMs);
      const reviewsWithErrors = noteReviews.filter((review) =>
        reviewHasTargetError(review, note.id)
      ).length;
      const errorCount = noteReviews.reduce(
        (count, review) =>
          count +
          getWrongAnswersForTarget(review, note.id).length +
          Number(wasTargetMissed(review, note.id)),
        0
      );
      const p10Ms = percentile(times, 0.1);
      const medianMs = percentile(times, 0.5);
      const p90Ms = percentile(times, 0.9);
      const errorRate = noteReviews.length === 0 ? 0 : reviewsWithErrors / noteReviews.length;
      const speedScore = medianMs === undefined ? 2 : medianMs / 1000;
      const confusionStats = commonConfusions(noteReviews, note.id, note.noteName);
      return {
        targetNoteId: note.id,
        groupId: note.groupId,
        reviewCount: noteReviews.length,
        errorCount,
        p10Ms,
        medianMs,
        p90Ms,
        errorRate,
        commonConfusion: confusionStats[0]?.noteName,
        commonConfusions: confusionStats,
        weaknessScore: speedScore + errorRate * 3 + (noteReviews.length === 0 ? 2 : 0),
      };
    }
  );
}

export function formatMs(ms?: number): string {
  if (ms === undefined) {
    return "-";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
