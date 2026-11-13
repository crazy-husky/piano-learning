import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpenCheck, Trash2, X } from "lucide-react";
import type {
  AppSettings,
  AnswerEvent,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../../../domain/types";
import type { LearningLevelId } from "../../../routing/appRoutes";
import { db, deletePracticeSessionWithReviews } from "../../../data/db";
import { buildDuetPracticeSummaryStats, formatDuetRate } from "../../../domain/duetPracticeSummary";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import { LearningPracticeDialog, LearningWeakDetailsDialog } from "./LearningPracticeDialog";
import { buildDuetWrongNoteTestPlan, type DuetWrongNoteTestPlan } from "../duetWrongNoteTest";
import {
  buildRecallWeakItems,
  buildWeakPracticeItems,
  dateBucket,
  eventMatchesLevel,
  eventMatchesPitchGroups,
  formatLearningNoteId,
  getEventTargetIds,
  getCorrectEventChoices,
  getEventDimension,
  getDuetMetricCounts,
  getMetricValue,
  getLearningStatsDimensions,
  isWithinLearningStatsRange,
  LEARNING_STATS_PITCH_OPTIONS,
  LEARNING_STATS_RANGES,
  type LearningStatsMetric,
  type LearningStatsRange,
  type WeakPracticeItem,
} from "./learningStatsData";

type ActionMode = "review" | "test";
type WeakSortMode = "frequency" | "occurrence";
type ManagerRow = { id: string; title: string; subtitle: string; count: number; date: string };
const WEAK_ITEMS_PER_PAGE = 10;
const MAX_PRACTICE_ITEMS = 100;
const DUET_TEST_RETURN_FILTERS_KEY = "anki-note.learningStats.duetTestReturnFilters.v1";

interface LearningStatsReturnFilters {
  levelId: LearningLevelId;
  range: LearningStatsRange;
  customStart: string;
  customEnd: string;
  pitchGroups: string[];
  dimension: string;
}

function consumeDuetTestReturnFilters(levelId: LearningLevelId): LearningStatsReturnFilters | null {
  try {
    const raw = window.sessionStorage.getItem(DUET_TEST_RETURN_FILTERS_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(DUET_TEST_RETURN_FILTERS_KEY);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<LearningStatsReturnFilters>;
    if (
      candidate.levelId !== levelId ||
      !LEARNING_STATS_RANGES.some((option) => option.value === candidate.range) ||
      !Array.isArray(candidate.pitchGroups) ||
      typeof candidate.dimension !== "string" ||
      !getLearningStatsDimensions(levelId).some((option) => option.value === candidate.dimension)
    ) {
      return null;
    }
    return {
      levelId,
      range: candidate.range!,
      customStart: typeof candidate.customStart === "string" ? candidate.customStart : "",
      customEnd: typeof candidate.customEnd === "string" ? candidate.customEnd : "",
      pitchGroups: candidate.pitchGroups.filter((item): item is string => typeof item === "string"),
      dimension: candidate.dimension,
    };
  } catch {
    return null;
  }
}

function saveDuetTestReturnFilters(filters: LearningStatsReturnFilters): void {
  try {
    window.sessionStorage.setItem(DUET_TEST_RETURN_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Returning to the statistics page still works if browser storage is unavailable.
  }
}

const METRICS: readonly { value: LearningStatsMetric; label: string }[] = [
  { value: "accuracy", label: "首次答对率" },
  { value: "response", label: "反应时间" },
  { value: "volume", label: "答题量" },
];

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} 毫秒`
    : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function eventIsMetricSample(event: AnswerEvent): boolean {
  return (
    event.wasInterrupted !== true &&
    event.wasSkipped !== true &&
    (typeof event.isCorrectFirstTry === "boolean" || event.isMissed)
  );
}

function noteIdInPitchGroups(noteId: string, pitchGroups: readonly string[]): boolean {
  if (pitchGroups.length === 0 || pitchGroups.includes("all")) return true;
  return pitchGroups.includes(noteId.match(/([2-6])$/)?.[1] ?? "");
}

function togglePitchGroupSelection(current: readonly string[], value: string): string[] {
  if (value === "all") return ["all"];
  const selected = current.includes("all") ? [] : [...current];
  const next = selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
  return next.length ? next : ["all"];
}

function summarizePitchGroups(pitchGroups: readonly string[]): string {
  if (pitchGroups.includes("all") || pitchGroups.length === 0) return "全部音区";
  const selected = LEARNING_STATS_PITCH_OPTIONS.filter(
    (option) => pitchGroups.includes(option.value) && option.value !== "all"
  );
  return selected.length <= 2
    ? selected.map((option) => option.label).join("、")
    : `已选 ${selected.length} 个音组`;
}

export function LearningStatsCenter({
  levelId,
  reviews,
  sessions,
  settings,
  staffRecallRuns,
  onDataChanged,
  onStartDuetWrongNoteTest,
}: {
  levelId: LearningLevelId;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  settings: AppSettings;
  staffRecallRuns: StaffRecallRunRecord[];
  onDataChanged: () => Promise<void>;
  onStartDuetWrongNoteTest?: (plan: DuetWrongNoteTestPlan) => void;
}): JSX.Element {
  const confirmDialog = useConfirmDialog();
  const [returnFilters] = useState(() => consumeDuetTestReturnFilters(levelId));
  const [events, setEvents] = useState<AnswerEvent[] | null>(null);
  const [range, setRange] = useState<LearningStatsRange>(returnFilters?.range ?? "30");
  const [customStart, setCustomStart] = useState(returnFilters?.customStart ?? "");
  const [customEnd, setCustomEnd] = useState(returnFilters?.customEnd ?? "");
  const [pitchGroups, setPitchGroups] = useState<string[]>(returnFilters?.pitchGroups ?? ["all"]);
  const [dimension, setDimension] = useState(
    returnFilters?.dimension ?? (levelId === 6 ? "level-1" : "all")
  );
  const dimensionWasManuallyChangedRef = useRef(false);
  const [metric, setMetric] = useState<LearningStatsMetric>(
    levelId === 1 ? "duration" : levelId === 6 ? "right-hand" : "accuracy"
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerRange, setManagerRange] = useState<LearningStatsRange>("all");
  const [managerCustomStart, setManagerCustomStart] = useState("");
  const [managerCustomEnd, setManagerCustomEnd] = useState("");
  const [managerPitchGroups, setManagerPitchGroups] = useState<string[]>(["all"]);
  const statsPitchFilterDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const managerPitchFilterDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const [managerDimension, setManagerDimension] = useState(
    returnFilters?.dimension ?? (levelId === 6 ? "level-1" : "all")
  );
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [weakSortMode, setWeakSortMode] = useState<WeakSortMode>("frequency");
  const [weakPage, setWeakPage] = useState(0);
  const [detailItem, setDetailItem] = useState<WeakPracticeItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dimensions = useMemo(() => getLearningStatsDimensions(levelId), [levelId]);
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );

  const reloadEvents = useCallback(async (): Promise<void> => {
    try {
      setEvents(await db.answerEvents.toArray());
      setError(null);
    } catch {
      setEvents([]);
      setError("读取统计记录失败，请刷新后重试。");
    }
  }, []);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  useEffect(() => {
    const closePitchFiltersOnOutsidePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      [statsPitchFilterDetailsRef, managerPitchFilterDetailsRef].forEach((ref) => {
        const details = ref.current;
        if (details?.open && !details.contains(event.target as Node)) details.open = false;
      });
    };

    document.addEventListener("pointerdown", closePitchFiltersOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closePitchFiltersOnOutsidePointerDown);
  }, []);

  const moduleEvents = useMemo(
    () =>
      (events ?? []).filter(
        (event) => event.dataSetId === settings.dataSetId && eventMatchesLevel(event, levelId)
      ),
    [events, levelId, settings.dataSetId]
  );
  useEffect(() => {
    if (
      levelId !== 6 ||
      events === null ||
      returnFilters !== null ||
      dimensionWasManuallyChangedRef.current
    ) {
      return;
    }
    const latestLevel = [...moduleEvents]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .map((event) => getEventDimension(levelId, event, sessionsById))
      .find(
        (value) => value !== "unclassified" && dimensions.some((option) => option.value === value)
      );
    setDimension(latestLevel ?? "level-1");
    setManagerDimension(latestLevel ?? "level-1");
  }, [dimensions, events, levelId, moduleEvents, returnFilters, sessionsById]);
  useEffect(() => {
    if (levelId === 6 && dimension === "level-1" && metric === "both-hands") {
      setMetric("right-hand");
    }
  }, [dimension, levelId, metric]);
  const selectedEvents = useMemo(
    () =>
      moduleEvents.filter(
        (event) =>
          isWithinLearningStatsRange(event.occurredAt, range, customStart, customEnd) &&
          eventMatchesPitchGroups(event, pitchGroups) &&
          (dimension === "all" || getEventDimension(levelId, event, sessionsById) === dimension)
      ),
    [customEnd, customStart, dimension, levelId, moduleEvents, pitchGroups, range, sessionsById]
  );
  const selectedRuns = useMemo(
    () =>
      staffRecallRuns.filter(
        (run) =>
          isWithinLearningStatsRange(run.endedAt, range, customStart, customEnd) &&
          (pitchGroups.length === 0 ||
            pitchGroups.includes("all") ||
            run.targetNoteIds.some((id) => noteIdInPitchGroups(id, pitchGroups)))
      ),
    [customEnd, customStart, pitchGroups, range, staffRecallRuns]
  );
  const managerSelectedEvents = useMemo(
    () =>
      moduleEvents.filter(
        (event) =>
          isWithinLearningStatsRange(
            event.occurredAt,
            managerRange,
            managerCustomStart,
            managerCustomEnd
          ) &&
          eventMatchesPitchGroups(event, managerPitchGroups) &&
          (managerDimension === "all" ||
            getEventDimension(levelId, event, sessionsById) === managerDimension)
      ),
    [
      levelId,
      managerCustomEnd,
      managerCustomStart,
      managerDimension,
      managerPitchGroups,
      managerRange,
      moduleEvents,
      sessionsById,
    ]
  );
  const managerSelectedRuns = useMemo(
    () =>
      staffRecallRuns.filter(
        (run) =>
          isWithinLearningStatsRange(
            run.endedAt,
            managerRange,
            managerCustomStart,
            managerCustomEnd
          ) &&
          (managerPitchGroups.length === 0 ||
            managerPitchGroups.includes("all") ||
            run.targetNoteIds.some((id) => noteIdInPitchGroups(id, managerPitchGroups)))
      ),
    [managerCustomEnd, managerCustomStart, managerPitchGroups, managerRange, staffRecallRuns]
  );
  const weakItems = useMemo<WeakPracticeItem[]>(
    () =>
      levelId === 1
        ? buildRecallWeakItems(selectedRuns, pitchGroups)
        : buildWeakPracticeItems(selectedEvents, levelId),
    [levelId, pitchGroups, selectedEvents, selectedRuns]
  );
  const metricEvents = selectedEvents.filter(eventIsMetricSample);
  const firstTryAccuracy = metricEvents.length
    ? metricEvents.filter((event) => event.isCorrectFirstTry === true).length / metricEvents.length
    : null;
  const responseTimes =
    levelId === 6
      ? []
      : metricEvents
          .filter((event) => !event.isMissed)
          .map((event) => event.responseTimeMs ?? event.rawResponseTimeMs)
          .filter((value): value is number => value !== null && value !== undefined && value > 0)
          .sort((left, right) => left - right);
  const medianResponse = responseTimes.length
    ? responseTimes.length % 2
      ? responseTimes[Math.floor(responseTimes.length / 2)]!
      : (responseTimes[responseTimes.length / 2 - 1]! + responseTimes[responseTimes.length / 2]!) /
        2
    : null;
  const duetSummaryStats = buildDuetPracticeSummaryStats(selectedEvents, true);
  const hasLegacyDuetEvents = selectedEvents.some((event) => event.duetPerformance === undefined);
  const correctControls = useMemo(
    () => getCorrectEventChoices(selectedEvents, weakItems, levelId),
    [levelId, selectedEvents, weakItems]
  );
  const managerDimensions = useMemo(() => getLearningStatsDimensions(levelId), [levelId]);

  const chartPoints = useMemo(() => {
    const grouped = new Map<
      string,
      { values: number[]; correct: number; total: number; firstAt: number }
    >();
    const append = (
      timestamp: string,
      value: number,
      counts?: { correct: number; total: number }
    ): void => {
      const label = dateBucket(timestamp, range);
      const timestampMs = Date.parse(timestamp);
      const bucket = grouped.get(label) ?? {
        values: [],
        correct: 0,
        total: 0,
        firstAt: timestampMs,
      };
      bucket.values.push(value);
      if (counts) {
        bucket.correct += counts.correct;
        bucket.total += counts.total;
      }
      bucket.firstAt = Math.min(bucket.firstAt, timestampMs);
      grouped.set(label, bucket);
    };
    if (levelId === 1) {
      for (const run of selectedRuns) {
        const duration = Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
        const filteredNoteCount = run.targetNoteIds.filter((id) =>
          noteIdInPitchGroups(id, pitchGroups)
        ).length;
        append(run.endedAt, metric === "volume" ? filteredNoteCount : duration);
      }
    } else if (levelId === 6) {
      for (const event of selectedEvents) {
        const counts = getDuetMetricCounts(event, metric);
        if (counts) append(event.occurredAt, counts.correct / counts.total, counts);
      }
    } else {
      for (const event of metricEvents) {
        const value = getMetricValue(event, metric);
        if (value === null) continue;
        append(event.occurredAt, value);
      }
    }
    return [...grouped.entries()]
      .map(([label, bucket]) => {
        const { values } = bucket;
        const value =
          levelId === 6
            ? bucket.total > 0
              ? bucket.correct / bucket.total
              : 0
            : metric === "accuracy"
              ? values.reduce((sum, item) => sum + item, 0) / values.length
              : metric === "response" || metric === "duration"
                ? values.reduce((sum, item) => sum + item, 0) / values.length
                : values.reduce((sum, item) => sum + item, 0);
        return {
          label,
          value,
          samples: levelId === 6 ? bucket.total : values.length,
          firstAt: bucket.firstAt,
        };
      })
      .sort((left, right) => left.firstAt - right.firstAt)
      .slice(-24);
  }, [levelId, metric, metricEvents, pitchGroups, range, selectedEvents, selectedRuns]);
  const maximum = Math.max(1, ...chartPoints.map((point) => point.value));

  const managerRows = useMemo<ManagerRow[]>(() => {
    if (levelId === 1) {
      return managerSelectedRuns.map((run) => ({
        id: run.id,
        title: `${run.targetNoteIds.length} 个目标音`,
        subtitle: run.schemaVersion === 2 ? run.staffNotationMode : "基础识谱",
        count: run.targetNoteIds.length,
        date: run.endedAt,
      }));
    }
    const selectedSessionIds = new Set(managerSelectedEvents.map((event) => event.sessionId));
    return [...selectedSessionIds]
      .map((sessionId) => {
        const fullSessionEvents = moduleEvents.filter((event) => event.sessionId === sessionId);
        const firstEvent = fullSessionEvents[0];
        return {
          id: sessionId,
          title: `${fullSessionEvents.length} 道答题记录`,
          subtitle: firstEvent
            ? (dimensions.find(
                (option) => option.value === getEventDimension(levelId, firstEvent, sessionsById)
              )?.label ?? "本关练习")
            : "本关练习",
          count: fullSessionEvents.length,
          date: fullSessionEvents.reduce(
            (latest, event) => (event.occurredAt > latest ? event.occurredAt : latest),
            ""
          ),
        };
      })
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [dimensions, levelId, managerSelectedEvents, managerSelectedRuns, moduleEvents, sessionsById]);

  const visibleSelectedRecords = useMemo(
    () => new Set([...selectedRecords].filter((id) => managerRows.some((row) => row.id === id))),
    [managerRows, selectedRecords]
  );

  useEffect(() => {
    if (!managerOpen) return;
    setSelectedRecords((current) => {
      const visibleIds = new Set(managerRows.map((row) => row.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [managerOpen, managerRows]);

  const openManager = (): void => {
    setSelectedRecords(new Set());
    setManagerDimension(dimension);
    setManagerOpen(true);
  };

  const deleteSelected = async (): Promise<void> => {
    if (visibleSelectedRecords.size === 0) return;
    const count = managerRows
      .filter((row) => visibleSelectedRecords.has(row.id))
      .reduce((sum, row) => sum + row.count, 0);
    const confirmed = await confirmDialog({
      title: `删除选中的 ${visibleSelectedRecords.size} 轮统计记录？`,
      description: `将删除 ${count} 条本关统计记录及对应练习历史，无法恢复；删除后首页的本关毕业进度会按剩余数据重新计算。`,
      cancelLabel: "取消",
      confirmLabel: "确认删除",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      if (levelId === 1) {
        await db.staffRecallRuns.bulkDelete([...visibleSelectedRecords]);
      } else {
        for (const sessionId of visibleSelectedRecords) {
          await deletePracticeSessionWithReviews(
            sessionId,
            reviews.filter((review) => review.sessionId === sessionId)
          );
        }
      }
      setManagerOpen(false);
      await reloadEvents();
      await onDataChanged();
    } catch {
      setError("删除失败。没有删除的记录仍会保留，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const isRecallLevel = levelId === 1;
  const metricOptions = isRecallLevel
    ? [
        { value: "duration" as const, label: "单轮用时" },
        { value: "volume" as const, label: "识别音符数" },
      ]
    : levelId === 6
      ? [
          { value: "right-hand" as const, label: "右手首答正确率" },
          { value: "left-hand" as const, label: "左手首答正确率" },
          { value: "beat" as const, label: "节拍命中率" },
          ...(dimension === "level-1"
            ? []
            : [{ value: "both-hands" as const, label: "双手同拍完整率" }]),
        ]
      : METRICS;
  const displayedWeakItems = useMemo(
    () =>
      [...weakItems].sort((left, right) => {
        if (weakSortMode === "occurrence") {
          return (
            (left.firstSeenAt ?? left.lastSeenAt).localeCompare(
              right.firstSeenAt ?? right.lastSeenAt
            ) || left.lastSeenAt.localeCompare(right.lastSeenAt)
          );
        }
        return right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt);
      }),
    [weakItems, weakSortMode]
  );
  const weakPageCount = Math.max(1, Math.ceil(displayedWeakItems.length / WEAK_ITEMS_PER_PAGE));
  const currentWeakPage = Math.min(weakPage, weakPageCount - 1);
  const pageWeakItems = displayedWeakItems.slice(
    currentWeakPage * WEAK_ITEMS_PER_PAGE,
    (currentWeakPage + 1) * WEAK_ITEMS_PER_PAGE
  );
  const practiceWeakItems = useMemo(
    () => displayedWeakItems.slice(0, MAX_PRACTICE_ITEMS),
    [displayedWeakItems]
  );
  const duetWrongNoteTestPlan = useMemo(
    () =>
      levelId === 6 && dimensions.some((option) => option.value === dimension)
        ? buildDuetWrongNoteTestPlan(
            dimension as DuetWrongNoteTestPlan["level"],
            practiceWeakItems,
            correctControls,
            pitchGroups
          )
        : null,
    [correctControls, dimension, dimensions, levelId, pitchGroups, practiceWeakItems]
  );
  const startWrongNoteTest = (): void => {
    if (levelId === 6) {
      if (duetWrongNoteTestPlan && onStartDuetWrongNoteTest) {
        saveDuetTestReturnFilters({
          levelId,
          range,
          customStart,
          customEnd,
          pitchGroups,
          dimension,
        });
        onStartDuetWrongNoteTest(duetWrongNoteTestPlan);
      }
      return;
    }
    setActionMode("test");
  };
  useEffect(() => {
    setWeakPage(0);
  }, [weakItems]);
  const recallWeakNoteIds = new Set(weakItems.flatMap((item) => item.noteIds));
  const recallControlNotes = isRecallLevel
    ? [
        ...new Set(
          selectedRuns
            .flatMap((run) => run.targetNoteIds)
            .filter((id) => noteIdInPitchGroups(id, pitchGroups) && !recallWeakNoteIds.has(id))
        ),
      ].slice(0, weakItems.length)
    : [];
  const controlItems = isRecallLevel
    ? recallControlNotes.map((noteId) => ({
        id: `recall-control:${noteId}`,
        title: formatLearningNoteId(noteId),
        subtitle: "熟悉音",
        count: 0,
        lastSeenAt: "",
        noteIds: [noteId],
      }))
    : correctControls.slice(0, Math.min(20, weakItems.length)).map((event) => ({
        id: `control:${event.id}`,
        title:
          event.targetDisplayName ??
          (event.targetNoteId ? formatLearningNoteId(event.targetNoteId) : event.targetNoteName) ??
          "已答对目标",
        subtitle: "已答对目标",
        count: 0,
        lastSeenAt: event.occurredAt,
        event,
        noteIds: getEventTargetIds(event),
      }));
  const pitchGroupSummary = summarizePitchGroups(pitchGroups);
  const managerPitchGroupSummary = summarizePitchGroups(managerPitchGroups);

  return (
    <section aria-label={`Level ${levelId} 统计中心`} className="learning-stats-center">
      <section aria-label="统计筛选" className="learning-stats-filters">
        <div className="learning-stats-filter-heading">
          <div>
            <span>本关数据</span>
            <h2>统计筛选</h2>
          </div>
          <button className="learning-stats-manage-button" onClick={openManager} type="button">
            <Trash2 aria-hidden="true" size={16} />
            管理
          </button>
        </div>
        <div className="learning-stats-filter-grid">
          <label>
            <span>日期</span>
            <select
              onChange={(event) => setRange(event.target.value as LearningStatsRange)}
              value={range}
            >
              {LEARNING_STATS_RANGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="learning-stats-pitch-filter">
            <span>音区范围</span>
            <details ref={statsPitchFilterDetailsRef}>
              <summary>{pitchGroupSummary}</summary>
              <div
                aria-label="选择一个或多个音区"
                className="learning-stats-pitch-options"
                role="group"
              >
                {LEARNING_STATS_PITCH_OPTIONS.map((option) => (
                  <label key={option.value}>
                    <input
                      checked={pitchGroups.includes(option.value)}
                      onChange={() =>
                        setPitchGroups((current) =>
                          togglePitchGroupSelection(current, option.value)
                        )
                      }
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          {dimensions.length > 1 ? (
            <label>
              <span>
                {levelId === 5
                  ? "预读深度"
                  : levelId === 6
                    ? "双手协同难度"
                    : levelId === 7
                      ? "输入方式"
                      : "训练方式"}
              </span>
              <select
                onChange={(event) => {
                  dimensionWasManuallyChangedRef.current = true;
                  setDimension(event.target.value);
                  if (levelId === 6) setManagerDimension(event.target.value);
                }}
                value={dimension}
              >
                {dimensions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {range === "custom" ? (
          <div className="learning-stats-custom-dates">
            <label>
              <span>开始日期</span>
              <input
                aria-label="统计开始日期"
                onChange={(event) => setCustomStart(event.target.value)}
                type="date"
                value={customStart}
              />
            </label>
            <label>
              <span>结束日期</span>
              <input
                aria-label="统计结束日期"
                onChange={(event) => setCustomEnd(event.target.value)}
                type="date"
                value={customEnd}
              />
            </label>
          </div>
        ) : null}
        <p>筛选只影响本页展示；音区选择不会修改练习配置。删除按完整练习轮次执行。</p>
      </section>

      {error ? (
        <p className="learning-stats-error" role="alert">
          {error}
        </p>
      ) : null}
      {events === null ? (
        <div aria-label="正在读取统计" className="learning-stats-loading" role="status" />
      ) : (
        <>
          <section aria-label="统计图表" className="learning-stats-chart-section">
            <header>
              <div>
                <span>练习表现</span>
                <h2>趋势图</h2>
              </div>
              <span className="learning-stats-sample-count">
                {isRecallLevel ? selectedRuns.length : metricEvents.length} 条记录
              </span>
            </header>
            <div aria-label="统计指标" className="learning-stats-metric-tabs" role="tablist">
              {metricOptions.map((option) => (
                <button
                  aria-selected={metric === option.value}
                  className={metric === option.value ? "is-active" : ""}
                  key={option.value}
                  onClick={() => setMetric(option.value)}
                  role="tab"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div
              aria-label={metricOptions.find((option) => option.value === metric)?.label}
              className="learning-stats-chart"
              role="img"
            >
              {chartPoints.length ? (
                chartPoints.map((point) => {
                  const rateMetric = levelId === 6 || metric === "accuracy";
                  const height = rateMetric ? point.value * 100 : (point.value / maximum) * 100;
                  const displayValue = rateMetric
                    ? `${Math.round(point.value * 100)}%`
                    : metric === "response" || metric === "duration"
                      ? formatDuration(point.value)
                      : `${point.value} 题`;
                  return (
                    <div className="learning-stats-chart-column" key={point.label}>
                      <span
                        style={{ height: `${Math.max(4, height)}%` }}
                        title={`${point.label} · ${displayValue} · ${point.samples} 个样本`}
                      />
                      <small>{point.label}</small>
                    </div>
                  );
                })
              ) : (
                <p role="status">当前筛选范围暂无图表数据。</p>
              )}
            </div>
            {levelId === 6 ? (
              <dl className="learning-stats-summary">
                <div>
                  <dt>右手首答正确率</dt>
                  <dd>
                    {formatDuetRate(duetSummaryStats.hands.treble)}
                    <small>
                      {duetSummaryStats.hands.treble.correct} /{" "}
                      {duetSummaryStats.hands.treble.total} 个音
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>左手首答正确率</dt>
                  <dd>
                    {formatDuetRate(duetSummaryStats.hands.bass)}
                    <small>
                      {duetSummaryStats.hands.bass.correct} / {duetSummaryStats.hands.bass.total}{" "}
                      个音
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>起音组准拍率</dt>
                  <dd>
                    {formatDuetRate({
                      correct: duetSummaryStats.timing.onTime,
                      total:
                        duetSummaryStats.timing.onTime +
                        duetSummaryStats.timing.early +
                        duetSummaryStats.timing.late +
                        duetSummaryStats.timing.missed,
                    })}
                    <small>
                      漏拍起音组 {duetSummaryStats.timing.missed} · 偏拍组{" "}
                      {duetSummaryStats.timing.early + duetSummaryStats.timing.late}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>双手同拍完整率</dt>
                  <dd>
                    {formatDuetRate(duetSummaryStats.bothHandEvents)}
                    <small>
                      {duetSummaryStats.bothHandEvents.correct} /{" "}
                      {duetSummaryStats.bothHandEvents.total} 组
                    </small>
                  </dd>
                </div>
              </dl>
            ) : levelId !== 1 ? (
              <dl className="learning-stats-summary">
                <div>
                  <dt>有效答题数</dt>
                  <dd>{metricEvents.length}</dd>
                </div>
                <div>
                  <dt>首次答对率</dt>
                  <dd>
                    {firstTryAccuracy === null ? "—" : `${Math.round(firstTryAccuracy * 100)}%`}
                  </dd>
                </div>
                <div>
                  <dt>中位反应时间</dt>
                  <dd>{medianResponse === null ? "—" : formatDuration(medianResponse)}</dd>
                </div>
                <div>
                  <dt>薄弱目标</dt>
                  <dd>{weakItems.length}</dd>
                </div>
              </dl>
            ) : (
              <dl className="learning-stats-summary">
                <div>
                  <dt>回忆轮数</dt>
                  <dd>{selectedRuns.length}</dd>
                </div>
                <div>
                  <dt>目标音数</dt>
                  <dd>
                    {selectedRuns.reduce(
                      (sum, run) =>
                        sum +
                        run.targetNoteIds.filter((id) => noteIdInPitchGroups(id, pitchGroups))
                          .length,
                      0
                    )}
                  </dd>
                </div>
                <div>
                  <dt>待巩固音名</dt>
                  <dd>{weakItems.length}</dd>
                </div>
              </dl>
            )}
            {levelId === 6 && hasLegacyDuetEvents ? (
              <p className="learning-stats-hint" role="status">
                部分历史练习记录没有左右手与拍点明细，不会计入以上细分统计。
              </p>
            ) : null}
          </section>

          <section
            aria-label={isRecallLevel ? "待巩固音" : "薄弱记录"}
            className="learning-stats-weak-list"
          >
            <header>
              <div>
                {isRecallLevel ? <span>识谱回忆</span> : null}
                <h2>{isRecallLevel ? "待巩固音" : "本关薄弱记录"}</h2>
              </div>
              <div className="learning-stats-weak-header-actions">
                <label className="learning-stats-weak-sort">
                  <span>排序</span>
                  <select
                    aria-label="薄弱记录排序方式"
                    onChange={(event) => {
                      setWeakSortMode(event.target.value as WeakSortMode);
                      setWeakPage(0);
                    }}
                    value={weakSortMode}
                  >
                    <option value="frequency">
                      {isRecallLevel ? "出现频率（从高到低）" : "错误频率（从高到低）"}
                    </option>
                    <option value="occurrence">发生顺序（从早到晚）</option>
                  </select>
                </label>
                <span>{weakItems.length} 项</span>
              </div>
            </header>
            {displayedWeakItems.length ? (
              <div className="learning-stats-weak-table-wrap">
                <table
                  aria-label={isRecallLevel ? "待巩固音记录" : "本关薄弱记录"}
                  className="learning-stats-weak-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">薄弱项</th>
                      <th scope="col">{isRecallLevel ? "薄弱依据" : "训练方式"}</th>
                      <th scope="col">{isRecallLevel ? "回忆次数" : "错误次数"}</th>
                      <th scope="col">首次发生</th>
                      <th scope="col">最近发生</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageWeakItems.map((item) => (
                      <tr key={item.id}>
                        <td data-label="薄弱项">
                          <strong>{item.title}</strong>
                        </td>
                        <td data-label={isRecallLevel ? "薄弱依据" : "训练方式"}>
                          {item.subtitle}
                          {isRecallLevel ? ` · ${formatDuration(item.averageMs ?? 0)}` : ""}
                        </td>
                        <td data-label={isRecallLevel ? "回忆次数" : "错误次数"}>{item.count}</td>
                        <td data-label="首次发生">
                          <time dateTime={item.firstSeenAt ?? item.lastSeenAt}>
                            {new Date(item.firstSeenAt ?? item.lastSeenAt).toLocaleString()}
                          </time>
                        </td>
                        <td data-label="最近发生">
                          <time dateTime={item.lastSeenAt}>
                            {new Date(item.lastSeenAt).toLocaleString()}
                          </time>
                        </td>
                        <td data-label="操作">
                          <button
                            aria-label={`查看${item.title}的题目与作答记录`}
                            className="learning-stats-weak-view-button"
                            onClick={() => setDetailItem(item)}
                            type="button"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="learning-stats-empty" role="status">
                {isRecallLevel ? "当前范围还没有可比较的识谱记录。" : "当前筛选条件下没有错题。"}
              </p>
            )}
            {weakItems.length > WEAK_ITEMS_PER_PAGE ? (
              <nav aria-label="薄弱记录分页" className="learning-stats-pagination">
                <span>
                  第 {currentWeakPage + 1} / {weakPageCount} 页 · 显示{" "}
                  {currentWeakPage * WEAK_ITEMS_PER_PAGE + 1}–
                  {Math.min((currentWeakPage + 1) * WEAK_ITEMS_PER_PAGE, weakItems.length)} 项，共{" "}
                  {weakItems.length} 项
                </span>
                <div>
                  <button
                    disabled={currentWeakPage === 0}
                    onClick={() => setWeakPage((page) => Math.max(0, page - 1))}
                    type="button"
                  >
                    上一页
                  </button>
                  <button
                    disabled={currentWeakPage + 1 >= weakPageCount}
                    onClick={() => setWeakPage((page) => Math.min(weakPageCount - 1, page + 1))}
                    type="button"
                  >
                    下一页
                  </button>
                </div>
              </nav>
            ) : null}
            {weakItems.length > MAX_PRACTICE_ITEMS ? (
              <p className="learning-stats-caption">
                复习与自测按当前排序覆盖前 {MAX_PRACTICE_ITEMS} 项；表格可分页查看全部{" "}
                {weakItems.length} 项。
              </p>
            ) : null}
          </section>

          <div className="learning-stats-actions">
            <button
              className="secondary"
              disabled={weakItems.length === 0}
              onClick={() => setActionMode("review")}
              type="button"
            >
              <BookOpenCheck aria-hidden="true" size={17} />
              {isRecallLevel ? "复习待巩固音" : "复习薄弱项"}
            </button>
            <button
              className="primary"
              disabled={
                weakItems.length === 0 ||
                (levelId === 6 && (!duetWrongNoteTestPlan || !onStartDuetWrongNoteTest))
              }
              onClick={startWrongNoteTest}
              type="button"
            >
              <BarChart3 aria-hidden="true" size={17} />
              {isRecallLevel ? "自测待巩固音" : "开始错题测试"}
            </button>
          </div>
          {isRecallLevel ? (
            <p className="learning-stats-caption">
              识谱回忆只记录每个音名列的累计耗时，不记录逐题对错；待巩固音按该列耗时均分估算。音区筛选用于限定音符清单，单轮用时仍按整轮计算。
            </p>
          ) : null}
        </>
      )}

      {managerOpen ? (
        <div className="learning-stats-dialog-backdrop" role="presentation">
          <button
            aria-label="关闭统计管理"
            className="learning-stats-dialog-backdrop-dismiss"
            onClick={() => setManagerOpen(false)}
            type="button"
          />
          <section
            aria-labelledby="learning-stats-manager-title"
            aria-modal="true"
            className="learning-stats-dialog learning-stats-manager"
            role="dialog"
          >
            <header>
              <div>
                <span>独立管理筛选</span>
                <h2 id="learning-stats-manager-title">管理统计记录</h2>
              </div>
              <button aria-label="关闭" onClick={() => setManagerOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <p>
              以下筛选独立于统计页，用于定位要管理的练习轮次。当前范围共 {managerRows.length}{" "}
              轮；删除会清除所选整轮答题和关联练习记录，包括筛选范围外的题目。
            </p>
            <div aria-label="管理范围筛选" className="learning-stats-manager-filters">
              <label>
                <span>日期范围</span>
                <select
                  onChange={(event) => setManagerRange(event.target.value as LearningStatsRange)}
                  value={managerRange}
                >
                  {LEARNING_STATS_RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="learning-stats-pitch-filter">
                <span>音区范围</span>
                <details ref={managerPitchFilterDetailsRef}>
                  <summary>{managerPitchGroupSummary}</summary>
                  <div
                    aria-label="管理音区范围"
                    className="learning-stats-pitch-options"
                    role="group"
                  >
                    {LEARNING_STATS_PITCH_OPTIONS.map((option) => (
                      <label key={option.value}>
                        <input
                          checked={managerPitchGroups.includes(option.value)}
                          onChange={() =>
                            setManagerPitchGroups((current) =>
                              togglePitchGroupSelection(current, option.value)
                            )
                          }
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              {managerDimensions.length > 1 ? (
                <label>
                  <span>训练方式</span>
                  <select
                    onChange={(event) => setManagerDimension(event.target.value)}
                    value={managerDimension}
                  >
                    {managerDimensions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {managerRange === "custom" ? (
              <div className="learning-stats-custom-dates">
                <label>
                  <span>开始日期</span>
                  <input
                    aria-label="管理开始日期"
                    onChange={(event) => setManagerCustomStart(event.target.value)}
                    type="date"
                    value={managerCustomStart}
                  />
                </label>
                <label>
                  <span>结束日期</span>
                  <input
                    aria-label="管理结束日期"
                    onChange={(event) => setManagerCustomEnd(event.target.value)}
                    type="date"
                    value={managerCustomEnd}
                  />
                </label>
              </div>
            ) : null}
            <div className="learning-stats-manager-tools">
              <button
                onClick={() => setSelectedRecords(new Set(managerRows.map((row) => row.id)))}
                type="button"
              >
                全选当前范围
              </button>
              <button onClick={() => setSelectedRecords(new Set())} type="button">
                清空选择
              </button>
            </div>
            <ul>
              {managerRows.map((row) => (
                <li key={row.id}>
                  <label aria-label={`选择 ${row.title}`} htmlFor={`manager-record-${row.id}`}>
                    <input
                      checked={visibleSelectedRecords.has(row.id)}
                      id={`manager-record-${row.id}`}
                      onChange={(event) =>
                        setSelectedRecords((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{row.title}</strong>
                      <small>
                        {row.subtitle} · {new Date(row.date).toLocaleString()}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {managerRows.length === 0 ? (
              <p className="learning-stats-empty" role="status">
                当前管理筛选范围没有可管理的练习轮次。
              </p>
            ) : null}
            <footer>
              <span>已选 {visibleSelectedRecords.size} 轮</span>
              <button
                className="danger"
                disabled={busy || visibleSelectedRecords.size === 0}
                onClick={() => void deleteSelected()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
                {busy ? "删除中…" : "删除选中"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {actionMode ? (
        <LearningPracticeDialog
          contextEvents={moduleEvents}
          controlItems={controlItems}
          controls={correctControls}
          controlNoteIds={recallControlNotes}
          items={practiceWeakItems}
          levelId={levelId}
          mode={actionMode}
          onClose={() => setActionMode(null)}
        />
      ) : null}
      {detailItem ? (
        <LearningWeakDetailsDialog
          contextEvents={moduleEvents}
          item={detailItem}
          levelId={levelId}
          onClose={() => setDetailItem(null)}
        />
      ) : null}
    </section>
  );
}
