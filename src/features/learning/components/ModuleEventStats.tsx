import { useEffect, useMemo, useState } from "react";
import type {
  AnswerEvent,
  DuetPracticeLevel,
  PracticeSessionRecord,
  PreReadingBufferSize,
  StaffDistanceTrainingMode,
} from "../../../domain/types";
import { db } from "../../../data/db";

type ModuleEventKind = "name-to-key" | "staff-to-name" | "staff-distance" | "pre-reading" | "duet";

interface DimensionOption {
  value: string;
  label: string;
}

interface DimensionFilter {
  label: string;
  options: readonly DimensionOption[];
}

const DUET_LEVELS: readonly DuetPracticeLevel[] = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
];

const DIMENSION_FILTERS: Partial<Record<ModuleEventKind, DimensionFilter>> = {
  "staff-distance": {
    label: "训练方式",
    options: [
      { value: "look", label: "看间距" },
      { value: "play", label: "弹间距" },
      { value: "finger", label: "手指练习" },
    ],
  },
  "pre-reading": {
    label: "预读深度",
    options: [1, 2, 3, 4, 5].map((value) => ({
      value: String(value),
      label: `提前 ${value} 个音`,
    })),
  },
  duet: {
    label: "双手协同难度",
    options: DUET_LEVELS.map((value, index) => ({ value, label: `L${index + 1}` })),
  },
};

const EVENT_FILTERS: Record<ModuleEventKind, (event: AnswerEvent) => boolean> = {
  "name-to-key": (event) => event.mode === "name-to-key",
  "staff-to-name": (event) => event.mode === "staff-to-name",
  "staff-distance": (event) => event.mode === "staff-distance",
  "pre-reading": (event) => event.mode === "pre-reading",
  duet: (event) =>
    event.mode === "free-practice" &&
    (Boolean(event.duetTargetNoteIds?.length) ||
      event.duetDifficulty !== undefined ||
      event.duetLevel !== undefined ||
      event.targetMidiHigh !== undefined ||
      event.targetMidiLow !== undefined),
};

const COPY: Record<
  ModuleEventKind,
  { title: string; empty: string; description: string; accuracyLabel: string }
> = {
  "name-to-key": {
    title: "音名找键统计",
    empty: "暂无数据。完成音名找键练习后，这里会显示答题数、首次答对率和反应时间。",
    description: "只统计音名找键练习，不混入看谱认音数据。",
    accuracyLabel: "首次答对率",
  },
  "staff-to-name": {
    title: "看谱认音统计",
    empty: "暂无数据。完成看谱认音练习后，这里会显示答题数、首次答对率和反应时间。",
    description: "只统计从五线谱识别音名的练习。",
    accuracyLabel: "首次答对率",
  },
  "staff-distance": {
    title: "音距速推统计",
    empty: "暂无数据。完成当前训练方式后，这里会显示答题数、首次答对率和反应时间。",
    description: "按看间距、弹间距或手指练习分别统计。",
    accuracyLabel: "首次答对率",
  },
  "pre-reading": {
    title: "提前识谱统计",
    empty: "暂无数据。完成当前预读深度的练习后，这里会显示答题数、首次答对率和反应时间。",
    description: "按提前读取的音符数量分别统计。",
    accuracyLabel: "首次答对率",
  },
  duet: {
    title: "双手协同统计",
    empty: "暂无数据。完成当前难度的双手合弹练习后，这里会显示答题数、首次答对率和反应时间。",
    description: "按双手协同难度分别统计。",
    accuracyLabel: "首次答对率",
  },
};

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} 毫秒`
    : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function getLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isDuetEvent(event: AnswerEvent): boolean {
  return EVENT_FILTERS.duet(event);
}

function getSessionConfig(session: PracticeSessionRecord | undefined) {
  return session && "startSnapshot" in session ? session.startSnapshot.practiceConfig : undefined;
}

function getDimensionValue(
  kind: ModuleEventKind,
  event: AnswerEvent,
  sessionsById: ReadonlyMap<string, PracticeSessionRecord>
): string | undefined {
  const session = sessionsById.get(event.sessionId);
  if (kind === "staff-distance") {
    const trainingMode: StaffDistanceTrainingMode | undefined =
      event.staffDistance?.trainingMode ?? session?.staffDistance?.trainingMode;
    return trainingMode;
  }
  if (kind === "pre-reading") {
    const buffer = event.preReadingBufferSize ?? getSessionConfig(session)?.preReadingBufferSize;
    return buffer === undefined ? undefined : String(buffer satisfies PreReadingBufferSize);
  }
  if (kind === "duet") {
    const level = event.duetLevel ?? getSessionConfig(session)?.duetLevel;
    return level && DUET_LEVELS.includes(level) ? level : undefined;
  }
  return undefined;
}

function isMetricSample(event: AnswerEvent): boolean {
  return (
    event.wasInterrupted !== true &&
    event.wasSkipped !== true &&
    (typeof event.isCorrectFirstTry === "boolean" || event.isMissed === true)
  );
}

export function ModuleEventStats({
  dataSetId,
  kind,
  sessions = [],
}: {
  dataSetId: string;
  kind: ModuleEventKind;
  sessions?: PracticeSessionRecord[];
}): JSX.Element {
  const [events, setEvents] = useState<AnswerEvent[] | null>(null);
  const [filterSelection, setFilterSelection] = useState<{
    kind: ModuleEventKind;
    value: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void db.answerEvents
      .toArray()
      .then((rows) => {
        if (active) setEvents(rows);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const dimensionFilter = DIMENSION_FILTERS[kind];
  const activeFilter =
    filterSelection?.kind === kind ? filterSelection.value : dimensionFilter?.options[0]?.value;
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );
  const moduleEvents = useMemo(
    () =>
      (events ?? [])
        .filter((event) => event.dataSetId === dataSetId && EVENT_FILTERS[kind](event))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    [dataSetId, events, kind]
  );
  const selectedEvents = useMemo(
    () =>
      moduleEvents.filter((event) => {
        if (!dimensionFilter || activeFilter === undefined) return true;
        return getDimensionValue(kind, event, sessionsById) === activeFilter;
      }),
    [activeFilter, dimensionFilter, kind, moduleEvents, sessionsById]
  );
  const unclassifiedEventCount = dimensionFilter
    ? moduleEvents.filter((event) => getDimensionValue(kind, event, sessionsById) === undefined)
        .length
    : 0;
  const metricSamples = selectedEvents.filter(isMetricSample);
  const firstTryCorrectCount = metricSamples.filter(
    (event) => event.isCorrectFirstTry === true
  ).length;
  const firstTryAccuracy = metricSamples.length
    ? firstTryCorrectCount / metricSamples.length
    : null;
  const responseTimes = metricSamples
    .filter((event) => !event.isMissed)
    .map((event) => event.responseTimeMs ?? event.rawResponseTimeMs)
    .filter((value): value is number => value !== null && value !== undefined && value > 0)
    .sort((left, right) => left - right);
  const middle = Math.floor(responseTimes.length / 2);
  const medianResponse = responseTimes.length
    ? responseTimes.length % 2 === 0
      ? (responseTimes[middle - 1]! + responseTimes[middle]!) / 2
      : responseTimes[middle]!
    : null;
  const copy = COPY[kind];
  const lastFourteenDays = useMemo(() => {
    const days = new Map<string, { total: number; firstTryCorrect: number }>();
    const today = new Date();
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      days.set(key, { total: 0, firstTryCorrect: 0 });
    }
    for (const event of selectedEvents) {
      if (!isMetricSample(event)) continue;
      const day = days.get(getLocalDateKey(event.occurredAt));
      if (!day) continue;
      day.total += 1;
      if (event.isCorrectFirstTry === true) day.firstTryCorrect += 1;
    }
    return [...days.entries()];
  }, [selectedEvents]);
  const maxDailyCount = Math.max(1, ...lastFourteenDays.map(([, day]) => day.total));
  const selectedOption = dimensionFilter?.options.find((option) => option.value === activeFilter);
  const emptyMessage =
    moduleEvents.length === 0
      ? copy.empty
      : dimensionFilter
        ? `当前筛选暂无数据。${
            unclassifiedEventCount > 0
              ? `${unclassifiedEventCount} 条历史记录缺少${dimensionFilter.label}信息，无法归类；新练习会自动记录。`
              : "可以切换筛选条件查看其他练习记录。"
          }`
        : copy.empty;
  const headingTitle =
    kind === "staff-distance" && selectedOption
      ? `${selectedOption.label}统计`
      : kind === "pre-reading" && selectedOption
        ? `${selectedOption.label}统计`
        : kind === "duet" && selectedOption
          ? `双手协同 ${selectedOption.label} 统计`
          : copy.title;

  if (events === null) {
    return <div aria-label="正在加载模块统计" className="module-stats-loading" role="status" />;
  }

  return (
    <section aria-labelledby={`module-event-stats-${kind}`} className="module-stats-view">
      <header className="module-stats-heading">
        <div>
          <span>本阶段数据</span>
          <h2 id={`module-event-stats-${kind}`}>{headingTitle}</h2>
          <p>{copy.description}</p>
        </div>
      </header>
      {dimensionFilter ? (
        <div
          aria-label={dimensionFilter.label}
          className="module-stats-dimension-filter"
          role="group"
        >
          <span>{dimensionFilter.label}</span>
          <div>
            {dimensionFilter.options.map((option) => (
              <button
                aria-pressed={activeFilter === option.value}
                className={activeFilter === option.value ? "is-active" : ""}
                key={option.value}
                onClick={() => setFilterSelection({ kind, value: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {selectedEvents.length === 0 ? (
        <p className="module-stats-empty" role="status">
          {emptyMessage}
        </p>
      ) : (
        <>
          <dl className="module-stats-metrics">
            <div>
              <dt>有效答题数</dt>
              <dd>{metricSamples.length}</dd>
            </div>
            <div>
              <dt>{copy.accuracyLabel}</dt>
              <dd>{formatPercent(firstTryAccuracy)}</dd>
            </div>
            <div>
              <dt>中位反应时间</dt>
              <dd>{formatDuration(medianResponse)}</dd>
            </div>
            <div>
              <dt>最近练习</dt>
              <dd>
                <time
                  className="module-stats-recent-date"
                  dateTime={selectedEvents[0]!.occurredAt}
                  title={new Date(selectedEvents[0]!.occurredAt).toLocaleString()}
                >
                  {new Date(selectedEvents[0]!.occurredAt).toLocaleDateString()}
                </time>
              </dd>
            </div>
          </dl>
          <section aria-label="近十四天练习量" className="module-stats-activity">
            <h3>近 14 天答题量</h3>
            <div className="module-stats-bars">
              {lastFourteenDays.map(([date, day]) => (
                <div className="module-stats-bar-column" key={date}>
                  <span
                    aria-label={`${date}：${day.total} 题`}
                    className={day.total ? "has-activity" : ""}
                    role="img"
                    style={{ height: `${Math.max(4, (day.total / maxDailyCount) * 100)}%` }}
                    title={`${date}：${day.total} 题`}
                  />
                </div>
              ))}
            </div>
            <div className="module-stats-bars-labels">
              <span>14 天前</span>
              <span>今天</span>
            </div>
          </section>
          <section aria-label="近十四天首次答对率" className="module-stats-activity">
            <h3>近 14 天首次答对率（柱高代表准确率）</h3>
            <div className="module-stats-bars module-stats-accuracy-bars">
              {lastFourteenDays.map(([date, day]) => {
                const accuracy = day.total ? day.firstTryCorrect / day.total : null;
                return (
                  <div className="module-stats-bar-column" key={date}>
                    <span
                      aria-label={`${date}：${day.total ? formatPercent(accuracy) : "无答题"}`}
                      className={
                        day.total && accuracy !== 0
                          ? "has-activity"
                          : day.total
                            ? "has-activity is-zero"
                            : ""
                      }
                      role="img"
                      style={{
                        height: `${accuracy === 0 ? 0 : Math.max(4, (accuracy ?? 0) * 100)}%`,
                      }}
                      title={`${date}：${day.total ? `${formatPercent(accuracy)}，${day.total} 题` : "无答题"}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="module-stats-bars-labels">
              <span>14 天前</span>
              <span>今天</span>
            </div>
          </section>
          <ol aria-label="最近答题记录" className="module-stats-recent-list">
            {selectedEvents.slice(0, 5).map((event) => (
              <li key={event.id}>
                <span>{event.targetDisplayName ?? event.targetNoteName ?? "本次目标"}</span>
                <span
                  className={
                    event.isCorrectFirstTry === true
                      ? "is-correct"
                      : event.isCorrectFirstTry === false
                        ? "is-incorrect"
                        : ""
                  }
                >
                  {event.wasInterrupted
                    ? "中断"
                    : event.wasSkipped
                      ? "跳过"
                      : event.isMissed
                        ? "漏答"
                        : event.isCorrectFirstTry === true
                          ? "首次答对"
                          : event.isCorrectFirstTry === false
                            ? "首次答错"
                            : "暂无结果"}
                </span>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function NameToKeyStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="name-to-key" />;
}

export function StaffToNameStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="staff-to-name" />;
}

export function DistanceStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="staff-distance" />;
}

export function PreReadingStats({
  dataSetId,
  sessions,
}: {
  dataSetId: string;
  sessions: PracticeSessionRecord[];
}): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="pre-reading" sessions={sessions} />;
}

export function DuetStats({
  dataSetId,
  sessions,
}: {
  dataSetId: string;
  sessions: PracticeSessionRecord[];
}): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="duet" sessions={sessions} />;
}

export function isDuetAnswerEvent(event: AnswerEvent): boolean {
  return isDuetEvent(event);
}
