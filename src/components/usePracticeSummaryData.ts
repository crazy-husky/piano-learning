import { useMemo } from "react";
import type { PracticeSessionRecord, ReviewRecord } from "../domain/types";
import {
  buildNoteStats,
  formatMs,
  getLongTermStatsEligibility,
  percentile,
} from "../domain/stats";
import { isCompletedReview } from "../domain/reviews";
import {
  buildSessionProgressBenchmark,
  buildSessionProgressSeries,
  type SessionProgressMode,
} from "../domain/sessionProgress";
import type { PracticeSessionSummary } from "./usePracticeSessionState";

export function usePracticeSummaryData({
  summary,
  sessions,
  reviews,
  historyLimit,
  mode,
}: {
  summary: PracticeSessionSummary | null;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  historyLimit: number;
  mode: SessionProgressMode;
}) {
  const sessionQualifiedTimes = useMemo(
    () => (summary?.reviews ?? [])
      .filter(isCompletedReview)
      .map((review) => review.activeMs),
    [summary],
  );
  const summaryStatsEligibility = useMemo(
    () => summary ? getLongTermStatsEligibility(summary.reviews) : undefined,
    [summary],
  );
  const summaryHasTooManyErrors =
    summaryStatsEligibility?.reason === "too-many-heavy-error-reviews" ||
    summaryStatsEligibility?.reason === "too-many-error-reviews";
  const weakestNotes = useMemo(
    () => summary
      ? buildNoteStats(summary.reviews)
          .filter((stat) => stat.reviewCount > 0)
          .sort((a, b) => b.weaknessScore - a.weaknessScore)
          .slice(0, 4)
      : [],
    [summary],
  );
  const summaryProgressSeries = useMemo(
    () => summary
      ? buildSessionProgressSeries({
          currentSession: summary.session,
          currentReviews: summary.reviews,
          sessions,
          reviews,
          historyLimit,
          mode,
        })
      : [],
    [historyLimit, mode, reviews, sessions, summary],
  );
  const summaryProgressBenchmark = useMemo(
    () => summary
      ? buildSessionProgressBenchmark({
          currentSession: summary.session,
          currentReviews: summary.reviews,
          sessions,
          reviews,
        })
      : undefined,
    [reviews, sessions, summary],
  );

  return {
    formatQualifiedTimeMedian: formatMs(percentile(sessionQualifiedTimes, 0.5)),
    formatQualifiedTimeP90: formatMs(percentile(sessionQualifiedTimes, 0.9)),
    summaryAllHistoryCount: summaryProgressSeries.filter((series) => !series.isCurrent).length,
    summaryHasTooManyErrors,
    summaryProgressBenchmark,
    summaryProgressSeries,
    weakestNotes,
  };
}
