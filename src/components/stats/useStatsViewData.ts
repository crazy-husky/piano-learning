import { useMemo } from "react";
import { getNotesForGroups } from "../../domain/notes";
import {
  buildDailyStats,
  buildNoteStats,
  buildRecognitionTrend,
  filterLongTermReviews,
  groupRecognitionTrendByDay,
  positiveTertileThresholds,
} from "../../domain/stats";
import type { SessionProgressMode } from "../../domain/sessionProgress";
import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "../../domain/types";
import type { SessionProgressComparisonModel } from "./useSessionProgressComparison";
import { useSessionProgressComparison } from "./useSessionProgressComparison";
import {
  applyRecognitionRangeTransitions,
  findRecognitionRangeTransitions,
  type RecognitionTimeChartStat,
  type RecognitionTimeGrouping,
} from "./recognitionTrend";
import type { StaffHeatNote } from "./StatsRangeStaff";
import { getStatsRangeCutoff, type StatsRange } from "./statsRange";

interface UseStatsViewDataOptions {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  range: StatsRange;
  primaryContentReady: boolean;
  recognitionStatsReady: boolean;
  sessionProgressStatsReady: boolean;
  noteRangeStatsReady: boolean;
  recognitionTimeGrouping: RecognitionTimeGrouping;
  sessionProgressEffectiveHistoryLimit: number;
  sessionProgressMode: SessionProgressMode;
}

export interface StatsViewDataModel {
  activeNotes: ReturnType<typeof getNotesForGroups>;
  dailyStats: ReturnType<typeof buildDailyStats>;
  errorStaffNotes: StaffHeatNote[];
  errorTertileThresholds: ReturnType<typeof positiveTertileThresholds>;
  recognitionCoverage: { coveredNoteCount: number; totalNoteCount: number };
  recognitionTimeStats: RecognitionTimeChartStat[];
  sessionProgressComparison: SessionProgressComparisonModel;
  timeStaffNotes: StaffHeatNote[];
  timeTertileThresholds: ReturnType<typeof positiveTertileThresholds>;
}

function formatShortDateTime(iso: string): { label: string; tooltipLabel: string } {
  const date = new Date(iso);
  const shortDate = `${String(date.getFullYear()).slice(2)}/${date.getMonth() + 1}/${date.getDate()}`;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return {
    label: `${shortDate}\n${time}`,
    tooltipLabel: `${shortDate} ${time}`,
  };
}

function formatShortDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${String(date.getFullYear()).slice(2)}/${date.getMonth() + 1}/${date.getDate()}`;
}

function filterByRange(reviews: ReviewRecord[], range: StatsRange): ReviewRecord[] {
  const cutoff = getStatsRangeCutoff(range);
  return cutoff ? reviews.filter((review) => new Date(review.endedAt) >= cutoff) : reviews;
}

function positiveStaffHeatValues(notes: StaffHeatNote[]): number[] {
  return notes
    .map((note) => note.value)
    .filter((value): value is number => value !== undefined && value > 0);
}

export function useStatsViewData({
  settings,
  reviews,
  sessions,
  range,
  primaryContentReady,
  recognitionStatsReady,
  sessionProgressStatsReady,
  noteRangeStatsReady,
  recognitionTimeGrouping,
  sessionProgressEffectiveHistoryLimit,
  sessionProgressMode,
}: UseStatsViewDataOptions): StatsViewDataModel {
  const longTermReviews = useMemo(
    () => primaryContentReady ? filterLongTermReviews(reviews) : [],
    [primaryContentReady, reviews],
  );
  const staffNotationMode = settings.staffNotationMode;
  const activeNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode),
    [settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode],
  );
  const rangeScopedReviews = useMemo(() => {
    const rangedIds = new Set(activeNotes.map((note) => note.id));
    return longTermReviews.filter((review) => rangedIds.has(review.targetNoteId));
  }, [activeNotes, longTermReviews]);
  const filteredReviews = useMemo(
    () => filterByRange(rangeScopedReviews, range),
    [range, rangeScopedReviews],
  );
  const dailyStats = useMemo(
    () => primaryContentReady ? buildDailyStats(filteredReviews) : [],
    [filteredReviews, primaryContentReady],
  );
  const recognitionTrendBySession = useMemo(
    () => recognitionStatsReady
      ? buildRecognitionTrend(
          longTermReviews,
          sessions,
          activeNotes.map((note) => note.id),
          "practice-session",
        )
      : [],
    [activeNotes, longTermReviews, recognitionStatsReady, sessions],
  );
  const recognitionRangeTransitions = useMemo(
    () => findRecognitionRangeTransitions(sessions, activeNotes, recognitionTrendBySession),
    [activeNotes, recognitionTrendBySession, sessions],
  );
  const recognitionTransitionBaselinesBySession = useMemo(
    () => recognitionRangeTransitions.map((transition) => ({
      transition,
      trend: transition.baselineNoteIds.length
        ? buildRecognitionTrend(
            longTermReviews,
            sessions,
            transition.baselineNoteIds,
            "practice-session",
          )
        : [],
    })),
    [longTermReviews, recognitionRangeTransitions, sessions],
  );
  const recognitionTrend = useMemo(
    () => {
      const trend = recognitionTimeGrouping === "day"
        ? groupRecognitionTrendByDay(recognitionTrendBySession)
        : recognitionTrendBySession;
      const baselines = recognitionTransitionBaselinesBySession.map(({ transition, trend: baselineTrend }) => ({
        transition,
        trend: recognitionTimeGrouping === "day"
          ? groupRecognitionTrendByDay(baselineTrend)
          : baselineTrend,
      }));
      return applyRecognitionRangeTransitions(trend, baselines, recognitionTimeGrouping);
    },
    [recognitionTimeGrouping, recognitionTransitionBaselinesBySession, recognitionTrendBySession],
  );
  const recognitionTimeStats = useMemo<RecognitionTimeChartStat[]>(() => {
    const cutoff = getStatsRangeCutoff(range);
    const visible = cutoff
      ? recognitionTrend.filter((point) => new Date(point.boundaryAt) >= cutoff)
      : recognitionTrend;
    return visible.map((stat) => {
      const formatted = recognitionTimeGrouping === "day"
        ? { label: formatShortDate(stat.key), tooltipLabel: formatShortDate(stat.key) }
        : formatShortDateTime(stat.boundaryAt);
      return {
        ...formatted,
        boundaryLabel: stat.boundaryLabel,
        breakBefore: stat.breakBefore,
        coveredNoteCount: stat.coveredNoteCount,
        errorRate: stat.errorRate === undefined ? undefined : stat.errorRate * 100,
        formalRangeStart: stat.formalRangeStart,
        key: stat.key,
        median: stat.medianMs === undefined ? undefined : stat.medianMs / 1000,
        p10: stat.p10Ms === undefined ? undefined : stat.p10Ms / 1000,
        p90: stat.p90Ms === undefined ? undefined : stat.p90Ms / 1000,
        relativeBaseline: stat.relativeBaseline
          ? {
              median: stat.relativeBaseline.medianMs === undefined ? undefined : stat.relativeBaseline.medianMs / 1000,
              p10: stat.relativeBaseline.p10Ms === undefined ? undefined : stat.relativeBaseline.p10Ms / 1000,
              p90: stat.relativeBaseline.p90Ms === undefined ? undefined : stat.relativeBaseline.p90Ms / 1000,
            }
          : undefined,
        totalNoteCount: stat.totalNoteCount,
        transition: stat.transition,
        transitionKind: stat.transitionKind,
      };
    });
  }, [range, recognitionTimeGrouping, recognitionTrend]);
  const recognitionCoverage = recognitionTrend[recognitionTrend.length - 1] ?? {
    coveredNoteCount: 0,
    totalNoteCount: activeNotes.length,
  };
  const sessionProgressComparison = useSessionProgressComparison({
    activeNotes,
    enabled: sessionProgressStatsReady,
    historyLimit: sessionProgressEffectiveHistoryLimit,
    mode: sessionProgressMode,
    reviews,
    sessions,
  });
  const { selection: sessionProgressSelection, selectedSessionIds: sessionProgressSessionIds } = sessionProgressComparison;
  const noteRangeReviews = useMemo(() => {
    if (!noteRangeStatsReady) return [];
    if (!sessionProgressSelection) return filteredReviews;
    return filterByRange(
      rangeScopedReviews.filter((review) => sessionProgressSessionIds.has(review.sessionId)),
      range,
    );
  }, [filteredReviews, noteRangeStatsReady, range, rangeScopedReviews, sessionProgressSelection, sessionProgressSessionIds]);
  const noteStats = useMemo(() => {
    if (!noteRangeStatsReady || activeNotes.length === 0) return [];
    const activeTargetNoteIds = new Set(activeNotes.map((note) => note.id));
    return buildNoteStats(noteRangeReviews).filter((stat) => activeTargetNoteIds.has(stat.targetNoteId));
  }, [activeNotes, noteRangeReviews, noteRangeStatsReady]);
  const rangeStaffNotes = useMemo(() => {
    const statsByNoteId = new Map(noteStats.map((stat) => [stat.targetNoteId, stat]));
    return activeNotes.map((note) => ({ note, stat: statsByNoteId.get(note.id) }));
  }, [activeNotes, noteStats]);
  const errorStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({
      confusions: stat?.commonConfusions ?? [],
      note,
      value: stat?.errorCount ?? 0,
    })),
    [rangeStaffNotes],
  );
  const timeStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({
      durations: { medianMs: stat?.medianMs, p10Ms: stat?.p10Ms, p90Ms: stat?.p90Ms },
      note,
      value: stat?.p90Ms,
    })),
    [rangeStaffNotes],
  );
  const timeTertileThresholds = useMemo(
    () => positiveTertileThresholds(positiveStaffHeatValues(timeStaffNotes)),
    [timeStaffNotes],
  );
  const errorTertileThresholds = useMemo(
    () => positiveTertileThresholds(positiveStaffHeatValues(errorStaffNotes)),
    [errorStaffNotes],
  );

  return {
    activeNotes,
    dailyStats,
    errorStaffNotes,
    errorTertileThresholds,
    recognitionCoverage,
    recognitionTimeStats,
    sessionProgressComparison,
    timeStaffNotes,
    timeTertileThresholds,
  };
}
