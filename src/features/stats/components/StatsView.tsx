import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "../../../domain/types";
import type { StaffGameProficiencySample } from "../../../domain/types";
import { db } from "../../../data/db";
import { answerEventToStaffGameProficiencySample } from "../../../data/answerEvents";
import { formatTargetNoteLabel } from "../../../domain/notes";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { resolveHistoryLimit } from "../../../shared/components/HistoryLimitControl";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/sessionProgressPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useNightMode } from "../../../shared/appearance/pageAppearance";
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
import {
  getStatsRangeCutoff,
  parseStatsRangeDays,
  STATS_RANGE_PRESETS,
  type StatsRange,
} from "./statsRange";
import {
  PRACTICE_MICROPHONE_PREFERENCES_KEY,
  parsePracticeMicrophonePreferences,
  type PracticeMicrophoneAlgorithm,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  aggregateStaffGameProficiencySamples,
  type StaffGameProficiencyNoteStats,
} from "../../staff-game/logic/staffGameProficiency";
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
  moduleScope?: "single-note";
}

const STATS_TAB_LABELS: Record<StatsTab, string> = {
  overview: "练习概览",
  notes: "单音诊断",
  progress: "练习进度",
  "wrong-notes": "练习表现",
};
const STATS_TAB_TRANSITION_MS = 180;

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];
type ProficiencyInputMode = StaffGameProficiencySample["inputMode"];
type ProficiencyGameModeFilter = "learning" | "arcade" | "all";

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
  moduleScope,
}: StatsViewProps): JSX.Element {
  const isNightMode = useNightMode();
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
  const [answerEvents, setAnswerEvents] = useState<
    Awaited<ReturnType<typeof db.answerEvents.toArray>>
  >([]);
  const [proficiencySamples, setProficiencySamples] = useState<StaffGameProficiencySample[]>([]);
  const [proficiencyInputMode, setProficiencyInputMode] =
    useState<ProficiencyInputMode>("microphone");
  const [proficiencyGameMode, setProficiencyGameMode] =
    useState<ProficiencyGameModeFilter>("learning");
  const [proficiencyAlgorithm, setProficiencyAlgorithm] = useState<PracticeMicrophoneAlgorithm>(
    () => {
      try {
        if (typeof localStorage === "undefined") return "swiftf0";
        return parsePracticeMicrophonePreferences(
          JSON.parse(localStorage.getItem(PRACTICE_MICROPHONE_PREFERENCES_KEY) ?? "null")
        ).algorithm;
      } catch {
        return "swiftf0";
      }
    }
  );
  const [proficiencySensitivityLevel, setProficiencySensitivityLevel] = useState<1 | 2 | 3 | 4 | 5>(
    () => {
      try {
        if (typeof localStorage === "undefined") return 3;
        return parsePracticeMicrophonePreferences(
          JSON.parse(localStorage.getItem(PRACTICE_MICROPHONE_PREFERENCES_KEY) ?? "null")
        ).sensitivityLevel;
      } catch {
        return 3;
      }
    }
  );
  const [weakNoteSortMode, setWeakNoteSortMode] = useState<"errors" | "response">("errors");
  const [customRangeDraft, setCustomRangeDraft] = useState(() =>
    String(statsUiPreferences.customRangeDays)
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<StatsTab>>(() =>
    moduleScope ? new Set(["notes"]) : new Set(["overview", statsUiPreferences.activeTab])
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

  useEffect(() => {
    let active = true;
    void db.answerEvents
      .toArray()
      .then((events) => {
        const samples = events
          .map(answerEventToStaffGameProficiencySample)
          .filter((sample): sample is NonNullable<typeof sample> => !!sample);
        if (active) {
          setAnswerEvents(events);
          setProficiencySamples(samples);
        }
      })
      .catch(() => {
        if (active) {
          setAnswerEvents([]);
          setProficiencySamples([]);
        }
      });
    return () => {
      active = false;
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
  const moduleSessionIds = useMemo(() => {
    if (!moduleScope) return null;
    return new Set(
      answerEvents
        .filter(
          (event) =>
            event.dataSetId === settings.dataSetId &&
            event.mode === "free-practice" &&
            !event.duetTargetNoteIds?.length &&
            event.duetDifficulty === undefined &&
            event.duetLevel === undefined &&
            event.targetMidiHigh === undefined &&
            event.targetMidiLow === undefined
        )
        .map((event) => event.sessionId)
    );
  }, [answerEvents, moduleScope, settings.dataSetId]);
  const statsSessions = useMemo(
    () =>
      moduleSessionIds ? sessions.filter((session) => moduleSessionIds.has(session.id)) : sessions,
    [moduleSessionIds, sessions]
  );
  const sessionProgressEffectiveHistoryLimit = resolveHistoryLimit(
    sessionProgressHistoryLimit,
    sessionProgressAllHistory,
    statsSessions.length
  );
  const statsReviews = useMemo(
    () =>
      moduleSessionIds
        ? reviews.filter((review) => moduleSessionIds.has(review.sessionId))
        : reviews,
    [moduleSessionIds, reviews]
  );
  const noteMetric =
    moduleScope && statsUiPreferences.noteMetric === "proficiency"
      ? "speed"
      : statsUiPreferences.noteMetric;
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
    activeNotes,
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
    reviews: statsReviews,
    sessions: statsSessions,
    range,
    primaryContentReady,
    recognitionStatsReady,
    sessionProgressStatsReady,
    noteRangeStatsReady,
    recognitionTimeGrouping: statsUiPreferences.recognitionTimeGrouping,
    sessionProgressEffectiveHistoryLimit,
    sessionProgressMode,
  });
  const proficiencySamplesInRange = useMemo(() => {
    const cutoff = getStatsRangeCutoff(range);
    return proficiencySamples.filter(
      (sample) =>
        sample.dataSetId === settings.dataSetId &&
        !moduleScope &&
        (!cutoff || new Date(sample.endedAt) >= cutoff) &&
        sample.mode === "staff-game" &&
        (proficiencyGameMode === "all" ||
          (sample.staffGameSource === "challenge" && sample.gameMode === proficiencyGameMode))
    );
  }, [moduleScope, proficiencyGameMode, proficiencySamples, range, settings.dataSetId]);
  const proficiencyNoteStats = useMemo(
    () =>
      aggregateStaffGameProficiencySamples(
        proficiencySamplesInRange,
        proficiencyInputMode,
        proficiencySensitivityLevel,
        proficiencyAlgorithm
      ),
    [
      proficiencyAlgorithm,
      proficiencyInputMode,
      proficiencySamplesInRange,
      proficiencySensitivityLevel,
    ]
  );
  const proficiencyStatsByMidi = useMemo(
    () =>
      new Map<number, StaffGameProficiencyNoteStats>(
        proficiencyNoteStats.map((item) => [item.midi, item])
      ),
    [proficiencyNoteStats]
  );
  const proficiencyStaffNotes = useMemo(
    () =>
      statsRangeSettings.enabledGroupIds.length
        ? activeNotes.map((note) => {
            const pitchClass = [
              "C",
              "C#",
              "D",
              "D#",
              "E",
              "F",
              "F#",
              "G",
              "G#",
              "A",
              "A#",
              "B",
            ].indexOf(note.noteName);
            const accidental =
              note.accidental === "sharp" ? 1 : note.accidental === "flat" ? -1 : 0;
            const stat = proficiencyStatsByMidi.get(
              (note.octave + 1) * 12 + pitchClass + accidental
            );
            return {
              note,
              value: stat?.appearanceCount ?? 0,
              diagnosticStatus: stat?.status ?? "insufficient",
              durations: { medianMs: stat?.meanResponseTimeMs ?? undefined },
            };
          })
        : [],
    [activeNotes, proficiencyStatsByMidi, statsRangeSettings.enabledGroupIds.length]
  );

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

  const visibleTabs: readonly StatsTab[] = moduleScope ? ["notes"] : STATS_TABS;
  const activeTab: StatsTab = moduleScope ? "notes" : statsUiPreferences.activeTab;
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
    noteMetric === "proficiency"
      ? proficiencyStaffNotes
      : noteMetric === "speed"
        ? timeStaffNotes
        : errorStaffNotes;
  const effectiveWeakNoteSortMode = moduleScope ? "errors" : weakNoteSortMode;
  const weakNoteRows =
    effectiveWeakNoteSortMode === "response"
      ? proficiencyNoteStats
          .filter((item) => item.appearanceCount >= 3 && item.meanResponseTimeMs !== null)
          .sort((left, right) => right.meanResponseTimeMs! - left.meanResponseTimeMs!)
          .slice(0, 8)
          .flatMap((item) => {
            const note = activeNotes.find((candidate) => {
              const pitchClass = [
                "C",
                "C#",
                "D",
                "D#",
                "E",
                "F",
                "F#",
                "G",
                "G#",
                "A",
                "A#",
                "B",
              ].indexOf(candidate.noteName);
              const accidental =
                candidate.accidental === "sharp" ? 1 : candidate.accidental === "flat" ? -1 : 0;
              return (candidate.octave + 1) * 12 + pitchClass + accidental === item.midi;
            });
            return note
              ? [
                  {
                    key: note.id,
                    label: formatTargetNoteLabel(note, new Set([note.id])),
                    value: `${(item.meanResponseTimeMs! / 1000).toFixed(1)}s`,
                  },
                ]
              : [];
          })
      : errorStaffNotes
          .filter((item) => (item.value ?? 0) > 0)
          .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
          .slice(0, 8)
          .map((item) => ({
            key: item.note.id,
            label: formatTargetNoteLabel(item.note, new Set([item.note.id])),
            value: `${item.value} 次错音`,
          }));
  const noteRangeHasMetricData =
    noteMetric === "proficiency"
      ? proficiencyNoteStats.length > 0
      : noteMetric === "errors"
        ? noteRangeHasData
        : timeStaffNotes.some((item) => item.value !== undefined);

  return (
    <section className="stats-shell stats-tabbed-shell">
      <div className="stats-page-heading">
        <h1>{moduleScope ? "单音诊断" : "统计"}</h1>
      </div>

      {!moduleScope ? (
        <div
          aria-label="统计页签"
          className="stats-main-tabs"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const currentIndex = visibleTabs.indexOf(activeTab);
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const nextTab =
              visibleTabs[(currentIndex + direction + visibleTabs.length) % visibleTabs.length]!;
            setActiveTab(nextTab);
            window.requestAnimationFrame(() =>
              document.getElementById(`stats-tab-${nextTab}`)?.focus()
            );
          }}
          role="tablist"
          tabIndex={-1}
        >
          {visibleTabs.map((tab) => (
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
      ) : null}

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
                      <p>
                        {noteMetric === "proficiency"
                          ? "熟练度按输入方式和敏感度档位分别统计"
                          : "按当前统计音域与时间范围汇总"}
                      </p>
                    </div>
                    <div aria-label="音域图表指标" className="segmented stats-compact-segmented">
                      <button
                        aria-pressed={noteMetric === "speed"}
                        className={noteMetric === "speed" ? "active" : ""}
                        onClick={() =>
                          setStatsUiPreferences((current) => ({ ...current, noteMetric: "speed" }))
                        }
                        type="button"
                      >
                        识别速度
                      </button>
                      <button
                        aria-pressed={noteMetric === "errors"}
                        className={noteMetric === "errors" ? "active" : ""}
                        onClick={() =>
                          setStatsUiPreferences((current) => ({ ...current, noteMetric: "errors" }))
                        }
                        type="button"
                      >
                        错音次数
                      </button>
                      {!moduleScope ? (
                        <button
                          aria-pressed={statsUiPreferences.noteMetric === "proficiency"}
                          className={
                            statsUiPreferences.noteMetric === "proficiency" ? "active" : ""
                          }
                          onClick={() =>
                            setStatsUiPreferences((current) => ({
                              ...current,
                              noteMetric: "proficiency",
                            }))
                          }
                          type="button"
                        >
                          熟练度
                        </button>
                      ) : null}
                    </div>
                  </header>
                  {!moduleScope && noteMetric === "proficiency" ? (
                    <div className="stats-proficiency-filters">
                      <label>
                        练习模式
                        <select
                          aria-label="熟练度练习模式"
                          onChange={(event) =>
                            setProficiencyGameMode(event.target.value as ProficiencyGameModeFilter)
                          }
                          value={proficiencyGameMode}
                        >
                          <option value="all">全部练习（含错题复习）</option>
                          <option value="learning">学习测试</option>
                          <option value="arcade">娱乐模式</option>
                        </select>
                      </label>
                      <label>
                        输入方式
                        <select
                          aria-label="熟练度输入方式"
                          onChange={(event) =>
                            setProficiencyInputMode(event.target.value as ProficiencyInputMode)
                          }
                          value={proficiencyInputMode}
                        >
                          <option value="microphone">麦克风</option>
                          <option value="midi">MIDI</option>
                          <option value="virtual-keyboard">虚拟键盘</option>
                        </select>
                      </label>
                      <label>
                        敏感度
                        <select
                          aria-label="熟练度敏感度档位"
                          onChange={(event) =>
                            setProficiencySensitivityLevel(
                              Number(event.target.value) as 1 | 2 | 3 | 4 | 5
                            )
                          }
                          value={proficiencySensitivityLevel}
                        >
                          {[1, 2, 3, 4, 5].map((level) => (
                            <option key={level} value={level}>
                              {level} 档
                            </option>
                          ))}
                        </select>
                      </label>
                      {proficiencyInputMode === "microphone" ? (
                        <label>
                          算法
                          <select
                            aria-label="熟练度麦克风算法"
                            onChange={(event) =>
                              setProficiencyAlgorithm(
                                event.target.value as PracticeMicrophoneAlgorithm
                              )
                            }
                            value={proficiencyAlgorithm}
                          >
                            <option value="swiftf0">SwiftF0</option>
                            <option value="yin">YIN / 回退</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {!primaryContentReady ? (
                    <div className="sr-only" aria-label="正在生成单音诊断" role="status" />
                  ) : !noteRangeHasMetricData ? (
                    <div className="stats-inline-empty" role="status">
                      此时间范围内暂无音符记录
                    </div>
                  ) : (
                    <>
                      <div className="note-heat-row-heading stats-note-range-legend">
                        {noteMetric === "speed" ? (
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
                        ) : noteMetric === "proficiency" ? (
                          <>
                            <h3>熟练度诊断</h3>
                            <div className="range-legend">
                              <span>
                                <LegendSwatch color={isNightMode ? "#ed766b" : "#ad3226"} />
                                有错音 / 漏音
                              </span>
                              <span>
                                <LegendSwatch color={isNightMode ? "#e0bd5b" : "#ad7b12"} />
                                反应 &gt; 1.5s
                              </span>
                              <span>
                                <LegendSwatch color={isNightMode ? "#55c5b3" : "#2f7d55"} />
                                反应 &lt; 1.0s
                              </span>
                              <span>
                                <LegendSwatch
                                  color={isNightMode ? "#bcc6be" : STATS_COLORS.range.neutral}
                                />
                                样本不足 / 中间区间
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
                          noteMetric === "speed"
                            ? "识别速度音域分布"
                            : noteMetric === "proficiency"
                              ? "熟练度音域分布"
                              : "错音次数音域分布"
                        }
                        notes={currentNoteNotes}
                        staffNotationMode={rangeSettingsScope.staffNotationMode}
                        tone={noteMetric === "speed" ? "blue" : "red"}
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
                    <div className="stats-weak-note-sort">
                      <label htmlFor="stats-weak-note-sort">排序</label>
                      <select
                        id="stats-weak-note-sort"
                        onChange={(event) =>
                          setWeakNoteSortMode(event.target.value as "errors" | "response")
                        }
                        value={effectiveWeakNoteSortMode}
                      >
                        <option value="errors">错音次数</option>
                        {!moduleScope ? <option value="response">平均反应耗时</option> : null}
                      </select>
                      {effectiveWeakNoteSortMode === "response" ? (
                        <small>
                          {proficiencyInputMode === "microphone"
                            ? "麦克风"
                            : proficiencyInputMode === "midi"
                              ? "MIDI"
                              : "虚拟键盘"}
                          · {proficiencySensitivityLevel} 档
                          {proficiencyInputMode === "microphone"
                            ? ` · ${proficiencyAlgorithm === "swiftf0" ? "SwiftF0" : "YIN / 回退"}`
                            : ""}
                        </small>
                      ) : null}
                    </div>
                  </div>
                  {weakNoteRows.length === 0 ? (
                    <p className="stats-inline-empty" role="status">
                      {effectiveWeakNoteSortMode === "response"
                        ? "此范围内暂无足够的反应时间样本"
                        : "此时间范围内暂无错音记录"}
                    </p>
                  ) : (
                    <ol className="stats-weak-note-list">
                      {weakNoteRows.map((item, index) => (
                        <li key={item.key}>
                          <span className="stats-weak-note-rank">{index + 1}</span>
                          <strong>{item.label}</strong>
                          <span>{item.value}</span>
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
