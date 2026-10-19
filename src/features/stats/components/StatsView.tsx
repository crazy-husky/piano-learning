import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "../../../domain/types";
import { formatTargetNoteLabel } from "../../../domain/notes";
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
import { SongPracticeStatsPanel } from "./SongPracticeStatsPanel";
import { StatsRangeStaff } from "./StatsRangeStaff";
import { STATS_COLORS } from "./statsColors";
import { parseStatsRangeDays, STATS_RANGE_PRESETS, type StatsRange } from "./statsRange";
import {
  DEFAULT_STATS_UI_PREFERENCES,
  parseStatsUiPreferences,
  STATS_TABS,
  STATS_UI_PREFERENCES_KEY,
  type StatsNoteScopePreferences,
  type StatsTab,
  type WrongNoteStatsTab,
} from "./statsUiPreferences";
import { useStatsViewData } from "./useStatsViewData";
import { useStaffGameWrongNoteArchives, WrongNoteStatsPanel } from "./WrongNoteStatsPanel";

interface StatsViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

const STATS_TAB_LABELS: Record<StatsTab, string> = {
  overview: "练习概览",
  notes: "单音诊断",
  progress: "练习进度",
  "wrong-notes": "错题趋势",
};
const STATS_TAB_TRANSITION_MS = 180;

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];

function LegendSwatch({ color }: { color: string }): JSX.Element {
  return <i className="legend-swatch" style={{ backgroundColor: color }} />;
}

function formatRangeSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function scopeFromAppSettings(settings: AppSettings): StatsNoteScopePreferences {
  return {
    staffNotationMode: settings.staffNotationMode,
    staffRangeProfiles: settings.staffRangeProfiles,
    enabledGroupIds: settings.enabledGroupIds,
    enabledPitchIds: settings.enabledPitchIds,
    crossGroupPitchIds: settings.crossGroupPitchIds,
    includeInterStaffLedgerSpellings: settings.includeInterStaffLedgerSpellings,
  };
}

export function StatsView({
  settings,
  reviews,
  sessions = EMPTY_SESSIONS,
}: StatsViewProps): JSX.Element {
  const [statsUiPreferences, setStatsUiPreferences] = useLocalStorageState(
    STATS_UI_PREFERENCES_KEY,
    DEFAULT_STATS_UI_PREFERENCES,
    { parse: parseStatsUiPreferences }
  );
  const [sessionProgressPreferences, setSessionProgressPreferences] = useLocalStorageState(
    SESSION_PROGRESS_UI_PREFERENCES_KEY,
    DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
    { parse: parseSessionProgressUiPreferences }
  );
  const {
    archives,
    error: archivesError,
    loading: archivesLoading,
    retry: retryArchives,
    setArchives,
  } = useStaffGameWrongNoteArchives();
  const [primaryContentReady, setPrimaryContentReady] = useState(false);
  const [customRangeDraft, setCustomRangeDraft] = useState(() =>
    String(statsUiPreferences.customRangeDays)
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<StatsTab>>(
    () => new Set(["overview", statsUiPreferences.activeTab])
  );
  const [leavingTab, setLeavingTab] = useState<StatsTab | null>(null);
  const tabTransitionTimeout = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (tabTransitionTimeout.current !== undefined) {
        window.clearTimeout(tabTransitionTimeout.current);
      }
    },
    []
  );

  useEffect(() => {
    setCustomRangeDraft(String(statsUiPreferences.customRangeDays));
  }, [statsUiPreferences.customRangeDays]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPrimaryContentReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  const range = statsUiPreferences.range;
  const customRangeSelected =
    range !== "all" && !STATS_RANGE_PRESETS.some((preset) => preset === range);
  const statsRangeSettings = useMemo(
    () => ({ ...settings, ...(statsUiPreferences.noteScope ?? scopeFromAppSettings(settings)) }),
    [settings, statsUiPreferences.noteScope]
  );
  const rangeSettingsScope = statsUiPreferences.noteScope ?? scopeFromAppSettings(settings);
  const persistStatsScope = (nextSettings: AppSettings): void => {
    setStatsUiPreferences((current) => ({
      ...current,
      noteScope: scopeFromAppSettings(nextSettings),
    }));
  };
  const sessionProgressMode = sessionProgressPreferences.mode;
  const sessionProgressAllHistory = sessionProgressPreferences.allHistory;
  const sessionProgressHistoryLimit = sessionProgressPreferences.historyLimit;
  const sessionProgressEffectiveHistoryLimit = resolveHistoryLimit(
    sessionProgressHistoryLimit,
    sessionProgressAllHistory,
    sessions.length
  );
  const recognitionVisibleSeries = useMemo(
    () =>
      RECOGNITION_SERIES_KEYS.filter(
        (seriesKey) => !statsUiPreferences.hiddenRecognitionSeries.includes(seriesKey)
      ),
    [statsUiPreferences.hiddenRecognitionSeries]
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
  const setActiveTab = (nextTab: StatsTab): void => {
    if (nextTab === statsUiPreferences.activeTab) return;
    setLeavingTab(statsUiPreferences.activeTab);
    setVisitedTabs((current) => new Set(current).add(nextTab));
    setStatsUiPreferences((current) => ({ ...current, activeTab: nextTab }));
    if (tabTransitionTimeout.current !== undefined) {
      window.clearTimeout(tabTransitionTimeout.current);
    }
    tabTransitionTimeout.current = window.setTimeout(
      () => setLeavingTab(null),
      STATS_TAB_TRANSITION_MS
    );
  };
  const setWrongNoteTab = (wrongNoteTab: WrongNoteStatsTab): void => {
    setStatsUiPreferences((current) => ({ ...current, wrongNoteTab }));
  };

  const recognitionStatsReady = primaryContentReady && visitedTabs.has("overview");
  const sessionProgressStatsReady = primaryContentReady && visitedTabs.has("progress");
  const noteRangeStatsReady = primaryContentReady && visitedTabs.has("notes");
  const {
    dailyStats,
    errorStaffNotes,
    errorTertileThresholds,
    noteRangeHasData,
    recognitionCoverage,
    recognitionTimeStats,
    sessionProgressComparison,
    timeStaffNotes,
    timeTertileThresholds,
  } = useStatsViewData({
    settings: statsRangeSettings,
    reviews,
    sessions,
    range,
    primaryContentReady,
    recognitionStatsReady,
    sessionProgressStatsReady,
    noteRangeStatsReady,
    recognitionTimeGrouping: statsUiPreferences.recognitionTimeGrouping,
    sessionProgressEffectiveHistoryLimit,
    sessionProgressMode,
  });

  const setSessionProgressMode = (mode: typeof sessionProgressMode): void => {
    setSessionProgressPreferences((current) => ({ ...current, mode }));
  };
  const setSessionProgressHistoryLimit = (historyLimit: number): void => {
    setSessionProgressPreferences((current) => ({ ...current, historyLimit }));
  };
  const setSessionProgressAllHistory = (allHistory: boolean): void => {
    setSessionProgressPreferences((current) => ({ ...current, allHistory }));
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
      hiddenRecognitionSeries: RECOGNITION_SERIES_KEYS.filter(
        (candidate) => candidate !== seriesKey
      ),
    }));
  };
  const toggleRecognitionSeries = (seriesKey: RecognitionSeriesKey): void => {
    setStatsUiPreferences((current) => {
      if (current.hiddenRecognitionSeries.includes(seriesKey)) {
        return {
          ...current,
          hiddenRecognitionSeries: current.hiddenRecognitionSeries.filter(
            (candidate) => candidate !== seriesKey
          ),
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

  const activeTab = statsUiPreferences.activeTab;
  const tabIsVisible = (tab: StatsTab): boolean => activeTab === tab || leavingTab === tab;
  const renderTabPanel = (tab: StatsTab, children: JSX.Element): JSX.Element => (
    <div
      aria-hidden={activeTab !== tab}
      className={`stats-tab-panel${activeTab === tab ? " is-entering" : " is-leaving"}`}
      hidden={!tabIsVisible(tab)}
      id={`stats-panel-${tab}`}
      inert={activeTab === tab ? undefined : ""}
      key={tab}
      role="tabpanel"
      aria-labelledby={`stats-tab-${tab}`}
    >
      {children}
    </div>
  );
  const currentNoteNotes =
    statsUiPreferences.noteMetric === "speed" ? timeStaffNotes : errorStaffNotes;
  const sortedWeakNotes = errorStaffNotes
    .filter((item) => (item.value ?? 0) > 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, 8);
  const noteRangeHasMetricData =
    statsUiPreferences.noteMetric === "errors"
      ? noteRangeHasData
      : timeStaffNotes.some((item) => item.value !== undefined);

  return (
    <section className="stats-shell stats-tabbed-shell">
      <div className="stats-page-heading">
        <h1>统计</h1>
      </div>

      <div
        aria-label="统计页签"
        className="stats-main-tabs"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const currentIndex = STATS_TABS.indexOf(activeTab);
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const nextTab =
            STATS_TABS[(currentIndex + direction + STATS_TABS.length) % STATS_TABS.length]!;
          setActiveTab(nextTab);
          window.requestAnimationFrame(() =>
            document.getElementById(`stats-tab-${nextTab}`)?.focus()
          );
        }}
        role="tablist"
        tabIndex={-1}
      >
        {STATS_TABS.map((tab) => (
          <button
            aria-controls={visitedTabs.has(tab) ? `stats-panel-${tab}` : undefined}
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            id={`stats-tab-${tab}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            {STATS_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="stats-date-filter-row">
        <div className="toolbar stats-range-filter">
          <div aria-label="统计记录时间范围" className="segmented">
            {STATS_RANGE_PRESETS.map((days) => (
              <button
                aria-pressed={range === days}
                className={range === days ? "active" : ""}
                key={days}
                onClick={() => setRange(days)}
                type="button"
              >
                {days} 天
              </button>
            ))}
            <button
              aria-pressed={range === "all"}
              className={range === "all" ? "active" : ""}
              onClick={() => setRange("all")}
              type="button"
            >
              全部
            </button>
            <div
              className={customRangeSelected ? "stats-range-custom active" : "stats-range-custom"}
            >
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
        <small>仅作用于带时间序列的练习记录</small>
      </div>

      <div className="stats-note-scope-context">
        <div className="stats-note-scope-heading">
          <strong>统计音域</strong>
          <small>仅影响统计图，不会更改练习范围</small>
        </div>
        <GlobalRangeControls settings={statsRangeSettings} onSettingsSaved={persistStatsScope} />
      </div>

      <div className="stats-tab-content" aria-live="polite">
        {visitedTabs.has("overview")
          ? renderTabPanel(
              "overview",
              <div className="stats-tab-section">
                {primaryContentReady ? (
                  <PracticeHeatmap dailyStats={dailyStats} range={range} />
                ) : (
                  <div className="sr-only" aria-label="正在生成统计内容" role="status" />
                )}
                {primaryContentReady ? (
                  <RecognitionTrendCard
                    coverage={recognitionCoverage}
                    data={recognitionTimeStats}
                    grouping={statsUiPreferences.recognitionTimeGrouping}
                    metric={statsUiPreferences.recognitionTimeMetric}
                    onGroupingChange={setRecognitionTimeGrouping}
                    onMetricChange={setRecognitionTimeMetric}
                    onSelectAllSeries={selectAllRecognitionSeries}
                    onSelectOnlySeries={selectOnlyRecognitionSeries}
                    onToggleSeries={toggleRecognitionSeries}
                    onRelativeBaselineModeChange={setRecognitionTimeRelativeBaselineMode}
                    onValueModeChange={setRecognitionTimeValueMode}
                    relativeBaselineMode={statsUiPreferences.recognitionTimeRelativeBaselineMode}
                    valueMode={statsUiPreferences.recognitionTimeValueMode}
                    visibleSeries={recognitionVisibleSeries}
                  />
                ) : null}
              </div>
            )
          : null}

        {visitedTabs.has("notes")
          ? renderTabPanel(
              "notes",
              <div className="stats-tab-section">
                <section className="panel stats-note-diagnostic-panel">
                  <header className="stats-note-diagnostic-heading">
                    <div>
                      <h2>单音诊断</h2>
                      <p>按当前统计音域与时间范围汇总</p>
                    </div>
                    <div aria-label="音域图表指标" className="segmented stats-compact-segmented">
                      <button
                        aria-pressed={statsUiPreferences.noteMetric === "speed"}
                        className={statsUiPreferences.noteMetric === "speed" ? "active" : ""}
                        onClick={() =>
                          setStatsUiPreferences((current) => ({ ...current, noteMetric: "speed" }))
                        }
                        type="button"
                      >
                        识别速度
                      </button>
                      <button
                        aria-pressed={statsUiPreferences.noteMetric === "errors"}
                        className={statsUiPreferences.noteMetric === "errors" ? "active" : ""}
                        onClick={() =>
                          setStatsUiPreferences((current) => ({ ...current, noteMetric: "errors" }))
                        }
                        type="button"
                      >
                        错音次数
                      </button>
                    </div>
                  </header>
                  {!primaryContentReady ? (
                    <div className="sr-only" aria-label="正在生成单音诊断" role="status" />
                  ) : !noteRangeHasMetricData ? (
                    <div className="stats-inline-empty" role="status">
                      此时间范围内暂无音符记录
                    </div>
                  ) : (
                    <>
                      <div className="note-heat-row-heading stats-note-range-legend">
                        {statsUiPreferences.noteMetric === "speed" ? (
                          <>
                            <h3>识别速度</h3>
                            <div className="range-legend">
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.neutral} />
                                无记录
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.blue[1]} />
                                较快
                                {timeTertileThresholds
                                  ? ` (≤${formatRangeSeconds(timeTertileThresholds.low)})`
                                  : ""}
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.blue[2]} />
                                中等
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.blue[3]} />
                                较慢
                                {timeTertileThresholds
                                  ? ` (>${formatRangeSeconds(timeTertileThresholds.high)})`
                                  : ""}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <h3>错音次数</h3>
                            <div className="range-legend">
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.neutral} />0
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.red[1]} />
                                较低
                                {errorTertileThresholds
                                  ? ` (≤${Math.floor(errorTertileThresholds.low)}次)`
                                  : ""}
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.red[2]} />
                                中等
                              </span>
                              <span>
                                <LegendSwatch color={STATS_COLORS.range.tone.red[3]} />
                                较高
                                {errorTertileThresholds
                                  ? ` (≥${Math.floor(errorTertileThresholds.high) + 1}次)`
                                  : ""}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      <StatsRangeStaff
                        label={
                          statsUiPreferences.noteMetric === "speed"
                            ? "识别速度音域分布"
                            : "错音次数音域分布"
                        }
                        notes={currentNoteNotes}
                        staffNotationMode={rangeSettingsScope.staffNotationMode}
                        tone={statsUiPreferences.noteMetric === "speed" ? "blue" : "red"}
                      />
                    </>
                  )}
                </section>

                <section
                  aria-labelledby="stats-weak-note-title"
                  className="panel stats-weak-note-panel"
                >
                  <div className="panel-heading">
                    <h2 id="stats-weak-note-title">薄弱音排行</h2>
                    <small>按错音次数排序</small>
                  </div>
                  {sortedWeakNotes.length === 0 ? (
                    <p className="stats-inline-empty" role="status">
                      此时间范围内暂无错音记录
                    </p>
                  ) : (
                    <ol className="stats-weak-note-list">
                      {sortedWeakNotes.map((item, index) => (
                        <li key={item.note.id}>
                          <span className="stats-weak-note-rank">{index + 1}</span>
                          <strong>
                            {formatTargetNoteLabel(item.note, new Set([item.note.id]))}
                          </strong>
                          <span>{item.value} 次错音</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            )
          : null}

        {visitedTabs.has("progress")
          ? renderTabPanel(
              "progress",
              <div className="stats-tab-section">
                {primaryContentReady ? (
                  <SessionProgressCard
                    allHistory={sessionProgressAllHistory}
                    historyLimit={sessionProgressHistoryLimit}
                    mode={sessionProgressMode}
                    model={sessionProgressComparison}
                    onAllHistoryChange={setSessionProgressAllHistory}
                    onHistoryLimitChange={setSessionProgressHistoryLimit}
                    onModeChange={setSessionProgressMode}
                  />
                ) : null}
                <SongPracticeStatsPanel />
              </div>
            )
          : null}

        {visitedTabs.has("wrong-notes")
          ? renderTabPanel(
              "wrong-notes",
              <div className="stats-tab-section">
                {primaryContentReady ? (
                  <WrongNoteStatsPanel
                    activeTab={statsUiPreferences.wrongNoteTab}
                    archives={archives}
                    loadError={archivesError}
                    loading={archivesLoading}
                    onActiveTabChange={setWrongNoteTab}
                    onArchivesChange={setArchives}
                    onRetryLoad={retryArchives}
                    range={range}
                  />
                ) : (
                  <div className="stats-inline-empty" aria-label="正在读取错题记录" role="status" />
                )}
              </div>
            )
          : null}
      </div>
    </section>
  );
}
