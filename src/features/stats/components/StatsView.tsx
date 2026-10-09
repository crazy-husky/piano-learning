import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
} from "../../../domain/types";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { resolveHistoryLimit } from "../../../shared/components/HistoryLimitControl";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/sessionProgressPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { PracticeHeatmap } from "./PracticeHeatmap";
import { RecognitionTrendCard } from "./RecognitionTrendCard";
import {
  RECOGNITION_SERIES_KEYS,
  type RecognitionRelativeBaselineMode,
  type RecognitionSeriesKey,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { SessionProgressCard } from "./SessionProgressCard";
import { StatsRangeStaff } from "./StatsRangeStaff";
import { STATS_COLORS } from "./statsColors";
import {
  parseStatsRangeDays,
  STATS_RANGE_PRESETS,
  type StatsRange,
} from "./statsRange";
import {
  DEFAULT_STATS_UI_PREFERENCES,
  parseStatsUiPreferences,
  STATS_CAROUSEL_CARD_IDS,
  STATS_UI_PREFERENCES_KEY,
  type StatsCarouselCardId,
} from "./statsUiPreferences";
import { useStatsViewData } from "./useStatsViewData";
import { useStatsCarousel } from "./useStatsCarousel";

interface StatsViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

const STATS_CAROUSEL_CARD_LABELS = ["识别趋势", "答对进度", "音域分布"] as const;
const STATS_CAROUSEL_PAIR_LABELS = ["识别趋势和答对进度", "答对进度和音域分布", "音域分布和识别趋势"] as const;
const STATS_IDLE_RENDER_TIMEOUT_MS = 600;
const STATS_IDLE_RENDER_FALLBACK_MS = 120;
interface StatsIdleWindow {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
}

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];

function LegendSwatch({ color }: { color: string }): JSX.Element {
  return <i className="legend-swatch" style={{ backgroundColor: color }} />;
}

function formatRangeSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StatsView({
  settings,
  reviews,
  sessions = EMPTY_SESSIONS,
  onSettingsSaved,
}: StatsViewProps): JSX.Element {
  const [statsUiPreferences, setStatsUiPreferences] = useLocalStorageState(
    STATS_UI_PREFERENCES_KEY,
    DEFAULT_STATS_UI_PREFERENCES,
    { parse: parseStatsUiPreferences },
  );
  const [sessionProgressPreferences, setSessionProgressPreferences] = useLocalStorageState(
    SESSION_PROGRESS_UI_PREFERENCES_KEY,
    DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
    { parse: parseSessionProgressUiPreferences },
  );
  const {
    beginStatsCarouselDrag,
    cancelStatsCarouselDrag,
    endStatsCarouselDrag,
    finishStatsCarouselTransition,
    jumpStatsCarousel,
    moveStatsCarousel,
    singleCardCarousel,
    statsCarouselIndex,
    statsCarouselOrder,
    statsCarouselTrackStyle,
    statsCarouselTransitionEnabled,
    updateStatsCarouselDrag,
    visibleStatsCarouselCardIds,
  } = useStatsCarousel({
    carouselCardId: statsUiPreferences.carouselCardId,
    setStatsUiPreferences,
  });
  const [primaryContentReady, setPrimaryContentReady] = useState(false);
  const [idleContentReady, setIdleContentReady] = useState(false);
  const [customRangeDraft, setCustomRangeDraft] = useState(() => String(statsUiPreferences.customRangeDays));

  useEffect(() => {
    setCustomRangeDraft(String(statsUiPreferences.customRangeDays));
  }, [statsUiPreferences.customRangeDays]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPrimaryContentReady(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    if (!primaryContentReady) {
      return undefined;
    }
    const idleWindow = window as unknown as StatsIdleWindow;
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const idleCallback = idleWindow.requestIdleCallback(
        () => setIdleContentReady(true),
        { timeout: STATS_IDLE_RENDER_TIMEOUT_MS },
      );
      return () => idleWindow.cancelIdleCallback?.(idleCallback);
    }
    const timeout = window.setTimeout(() => setIdleContentReady(true), STATS_IDLE_RENDER_FALLBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [primaryContentReady]);

  const preparedStatsCarouselCardIds = idleContentReady
    ? new Set<StatsCarouselCardId>(STATS_CAROUSEL_CARD_IDS)
    : visibleStatsCarouselCardIds;
  const recognitionStatsReady = primaryContentReady && preparedStatsCarouselCardIds.has("recognition-time");
  const sessionProgressStatsReady = primaryContentReady && (
    preparedStatsCarouselCardIds.has("session-progress") || preparedStatsCarouselCardIds.has("note-range")
  );
  const noteRangeStatsReady = primaryContentReady && preparedStatsCarouselCardIds.has("note-range");
  const range = statsUiPreferences.range;
  const customRangeSelected = range !== "all" && !STATS_RANGE_PRESETS.some((preset) => preset === range);
  const recognitionTimeGrouping = statsUiPreferences.recognitionTimeGrouping;
  const recognitionTimeMetric = statsUiPreferences.recognitionTimeMetric;
  const recognitionTimeRelativeBaselineMode = statsUiPreferences.recognitionTimeRelativeBaselineMode;
  const recognitionTimeValueMode = statsUiPreferences.recognitionTimeValueMode;
  const recognitionVisibleSeries = useMemo(
    () => RECOGNITION_SERIES_KEYS.filter(
      (seriesKey) => !statsUiPreferences.hiddenRecognitionSeries.includes(seriesKey),
    ),
    [statsUiPreferences.hiddenRecognitionSeries],
  );

  const sessionProgressMode = sessionProgressPreferences.mode;
  const sessionProgressAllHistory = sessionProgressPreferences.allHistory;
  const sessionProgressHistoryLimit = sessionProgressPreferences.historyLimit;
  const sessionProgressEffectiveHistoryLimit = resolveHistoryLimit(
    sessionProgressHistoryLimit,
    sessionProgressAllHistory,
    sessions.length,
  );
  const setRange = (nextRange: StatsRange): void => {
    setStatsUiPreferences((current) => ({ ...current, range: nextRange }));
  };
  const commitCustomRange = (): void => {
    const days = parseStatsRangeDays(customRangeDraft);
    if (days === undefined) {
      setCustomRangeDraft(String(statsUiPreferences.customRangeDays));
      return;
    }
    setStatsUiPreferences((current) => ({ ...current, customRangeDays: days, range: days }));
  };
  const setRecognitionTimeGrouping = (nextGrouping: RecognitionTimeGrouping): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeGrouping: nextGrouping }));
  };
  const setRecognitionTimeMetric = (nextMetric: RecognitionTimeMetric): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeMetric: nextMetric }));
  };
  const setRecognitionTimeRelativeBaselineMode = (mode: RecognitionRelativeBaselineMode): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeRelativeBaselineMode: mode }));
  };
  const setRecognitionTimeValueMode = (nextValueMode: RecognitionTimeValueMode): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeValueMode: nextValueMode }));
  };
  const selectAllRecognitionSeries = (): void => {
    setStatsUiPreferences((current) => ({ ...current, hiddenRecognitionSeries: [] }));
  };
  const selectOnlyRecognitionSeries = (seriesKey: RecognitionSeriesKey): void => {
    setStatsUiPreferences((current) => ({
      ...current,
      hiddenRecognitionSeries: RECOGNITION_SERIES_KEYS.filter((candidate) => candidate !== seriesKey),
    }));
  };
  const toggleRecognitionSeries = (seriesKey: RecognitionSeriesKey): void => {
    setStatsUiPreferences((current) => {
      if (current.hiddenRecognitionSeries.includes(seriesKey)) {
        return {
          ...current,
          hiddenRecognitionSeries: current.hiddenRecognitionSeries.filter((candidate) => candidate !== seriesKey),
        };
      }
      if (current.hiddenRecognitionSeries.length === RECOGNITION_SERIES_KEYS.length - 1) {
        return current;
      }
      return {
        ...current,
        hiddenRecognitionSeries: [...current.hiddenRecognitionSeries, seriesKey],
      };
    });
  };
  const setSessionProgressMode = (nextMode: typeof sessionProgressMode): void => {
    setSessionProgressPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setSessionProgressHistoryLimit = (nextHistoryLimit: number): void => {
    setSessionProgressPreferences((current) => ({ ...current, historyLimit: nextHistoryLimit }));
  };
  const setSessionProgressAllHistory = (allHistory: boolean): void => {
    setSessionProgressPreferences((current) => ({ ...current, allHistory }));
  };

  const {
    dailyStats,
    errorStaffNotes,
    errorTertileThresholds,
    recognitionCoverage,
    recognitionTimeStats,
    sessionProgressComparison,
    timeStaffNotes,
    timeTertileThresholds,
  } = useStatsViewData({
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
  });
  const { selection: sessionProgressSelection } = sessionProgressComparison;
  const staffNotationMode = settings.staffNotationMode;

  const renderStatsCard = (cardId: StatsCarouselCardId): JSX.Element => {
    if (cardId === "recognition-time") {
      return (
        <RecognitionTrendCard
          coverage={recognitionCoverage}
          data={recognitionTimeStats}
          grouping={recognitionTimeGrouping}
          metric={recognitionTimeMetric}
          onGroupingChange={setRecognitionTimeGrouping}
          onMetricChange={setRecognitionTimeMetric}
          onSelectAllSeries={selectAllRecognitionSeries}
          onSelectOnlySeries={selectOnlyRecognitionSeries}
          onToggleSeries={toggleRecognitionSeries}
          onRelativeBaselineModeChange={setRecognitionTimeRelativeBaselineMode}
          onValueModeChange={setRecognitionTimeValueMode}
          relativeBaselineMode={recognitionTimeRelativeBaselineMode}
          valueMode={recognitionTimeValueMode}
          visibleSeries={recognitionVisibleSeries}
        />
      );
    }

    if (cardId === "session-progress") {
      return (
        <SessionProgressCard
          allHistory={sessionProgressAllHistory}
          historyLimit={sessionProgressHistoryLimit}
          mode={sessionProgressMode}
          model={sessionProgressComparison}
          onAllHistoryChange={setSessionProgressAllHistory}
          onHistoryLimitChange={setSessionProgressHistoryLimit}
          onModeChange={setSessionProgressMode}
        />
      );
    }

    return (
      <div className="panel note-heat-panel stats-carousel-card">
        <div className="panel-heading">
          <h2>音域分布</h2>
          <small className="note-range-filter-note">
            {sessionProgressSelection
              ? "沿用答对进度的会话条件"
              : "暂无对应有效会话，已按目标音集合汇总"}
          </small>
        </div>
        <div className="note-heat-stack">
          <div className="note-heat-row">
            <div className="note-heat-row-heading">
              <h3>识别速度</h3>
              <div className="range-legend">
                <span>
                  <LegendSwatch color={STATS_COLORS.range.neutral} />
                  无记录
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[1]} />
                  较快{timeTertileThresholds ? ` (≤${formatRangeSeconds(timeTertileThresholds.low)})` : ""}
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[3]} />
                  较慢{timeTertileThresholds ? ` (>${formatRangeSeconds(timeTertileThresholds.high)})` : ""}
                </span>
              </div>
            </div>
            <StatsRangeStaff
              label="识别速度音域分布"
              notes={timeStaffNotes}
              staffNotationMode={staffNotationMode}
              tone="blue"
            />
          </div>
          <div className="note-heat-row">
            <div className="note-heat-row-heading">
              <h3>错音次数</h3>
              <div className="range-legend">
                <span>
                  <LegendSwatch color={STATS_COLORS.range.neutral} />
                  0
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[1]} />
                  较低{errorTertileThresholds ? ` (≤${Math.floor(errorTertileThresholds.low)}次)` : ""}
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[3]} />
                  较高{errorTertileThresholds ? ` (≥${Math.floor(errorTertileThresholds.high) + 1}次)` : ""}
                </span>
              </div>
            </div>
            <StatsRangeStaff
              label="错音次数音域分布"
              notes={errorStaffNotes}
              staffNotationMode={staffNotationMode}
              tone="red"
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="stats-shell">
      <GlobalRangeControls settings={settings} onSettingsSaved={onSettingsSaved} />
      <div className="stats-header">
        <div>
          <h1>统计</h1>
        </div>
        <div className="toolbar stats-range-filter stats-header-range-filter">
          <div className="segmented" aria-label="统计天数筛选">
            {STATS_RANGE_PRESETS.map((days) => (
              <button className={range === days ? "active" : ""} key={days} onClick={() => setRange(days)}>
                {days} 天
              </button>
            ))}
            <button className={range === "all" ? "active" : ""} onClick={() => setRange("all")}>
              全部
            </button>
            <div className={customRangeSelected ? "stats-range-custom active" : "stats-range-custom"}>
              <input
                aria-label="自定义统计天数"
                inputMode="numeric"
                min={1}
                onBlur={commitCustomRange}
                onChange={(event) => setCustomRangeDraft(event.currentTarget.value)}
                onClick={() => setRange(statsUiPreferences.customRangeDays)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                step={1}
                type="number"
                value={customRangeDraft}
              />
              <button
                aria-label="应用自定义统计天数"
                className="stats-range-custom-activate"
                onClick={commitCustomRange}
                type="button"
              >
                天
              </button>
            </div>
          </div>
        </div>
      </div>

      {primaryContentReady ? (
        <PracticeHeatmap dailyStats={dailyStats} range={range} />
      ) : (
        <div className="sr-only" aria-label="正在生成统计内容" role="status" />
      )}

      {primaryContentReady ? (
        <div
          className={singleCardCarousel ? "stats-card-carousel stats-card-carousel-single" : "stats-card-carousel"}
        >
          <div
            className="stats-card-carousel-viewport"
            onPointerCancel={cancelStatsCarouselDrag}
            onPointerDown={beginStatsCarouselDrag}
            onPointerMove={updateStatsCarouselDrag}
            onPointerUp={endStatsCarouselDrag}
          >
            <div
              className={
                statsCarouselTransitionEnabled
                  ? "stats-card-carousel-track"
                  : "stats-card-carousel-track stats-card-carousel-track-instant"
              }
              style={statsCarouselTrackStyle}
              onTransitionEnd={finishStatsCarouselTransition}
            >
              {statsCarouselOrder.map((cardId) => {
                const visible = visibleStatsCarouselCardIds.has(cardId);
                return (
                  <div
                    aria-hidden={!visible}
                    className="stats-card-carousel-slide"
                    inert={visible ? undefined : ""}
                    key={cardId}
                  >
                    {preparedStatsCarouselCardIds.has(cardId) ? (
                      renderStatsCard(cardId)
                    ) : (
                      <div className="panel stats-carousel-card stats-card-idle-placeholder" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="chart-carousel-nav stats-card-carousel-nav" aria-label="统计卡片切换" role="group">
            <button
              aria-label="查看上一组统计卡片"
              aria-keyshortcuts="ArrowLeft"
              className="chart-carousel-arrow"
              onClick={() => moveStatsCarousel(-1)}
              type="button"
            >
              <kbd aria-hidden="true">←</kbd>
            </button>
            <div className="chart-carousel-dots" aria-label="统计卡片位置">
              {STATS_CAROUSEL_CARD_IDS.map((cardId, index) => (
                <button
                  aria-label={`查看${
                    singleCardCarousel ? STATS_CAROUSEL_CARD_LABELS[index] : STATS_CAROUSEL_PAIR_LABELS[index]
                  }`}
                  className={statsCarouselIndex === index ? "active" : ""}
                  key={cardId}
                  onClick={() => jumpStatsCarousel(index)}
                  type="button"
                />
              ))}
            </div>
            <button
              aria-label="查看下一组统计卡片"
              aria-keyshortcuts="ArrowRight"
              className="chart-carousel-arrow"
              onClick={() => moveStatsCarousel(1)}
              type="button"
            >
              <kbd aria-hidden="true">→</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
