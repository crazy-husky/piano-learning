import { useEffect, useMemo, useState } from "react";
import type { AnswerEvent } from "../../../domain/types";
import { db } from "../../../data/db";

type ModuleEventKind = "name-to-key" | "staff-to-name" | "staff-distance" | "pre-reading" | "duet";

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
  { title: string; empty: string; description: string; accuracyLabel?: string }
> = {
  "name-to-key": {
    title: "音名找键统计",
    empty: "完成音名找键练习后，这里会显示练习次数、最终答对率和反应时间。",
    description: "只统计音名找键练习，不混入其他练习数据。",
    accuracyLabel: "最终答对率",
  },
  "staff-to-name": {
    title: "看谱认音统计",
    empty: "完成看谱认音练习后，这里会显示练习次数、最终答对率和反应时间。",
    description: "只统计从五线谱识别音名的练习，不混入音名找键数据。",
    accuracyLabel: "最终答对率",
  },
  "staff-distance": {
    title: "音距速推统计",
    empty: "完成音距速推练习后，这里会显示练习次数、准确率和反应时间。",
    description: "只统计间距推导练习。",
  },
  "pre-reading": {
    title: "提前识谱统计",
    empty: "完成提前识谱练习后，这里会显示答题数、正确率和反应时间。",
    description:
      "只统计开启视线前置的谱页练习。初期反应时间可能因预读负荷暂时变长，可结合正确率观察变化。",
  },
  duet: {
    title: "双手协同统计",
    empty: "完成双手合弹练习后，这里会显示练习次数、准确率和反应时间。",
    description: "只统计左右手合弹练习。",
  },
};

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} 毫秒`
    : `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function getLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isDuetEvent(event: AnswerEvent): boolean {
  return EVENT_FILTERS.duet(event);
}

export function ModuleEventStats({
  dataSetId,
  kind,
}: {
  dataSetId: string;
  kind: ModuleEventKind;
}): JSX.Element {
  const [events, setEvents] = useState<AnswerEvent[] | null>(null);

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

  const selectedEvents = useMemo(
    () =>
      (events ?? [])
        .filter((event) => event.dataSetId === dataSetId && EVENT_FILTERS[kind](event))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    [dataSetId, events, kind]
  );
  const answeredEvents = selectedEvents.filter((event) => event.isCorrectFinal !== null);
  const correctCount = answeredEvents.filter((event) => event.isCorrectFinal === true).length;
  const responseTimes = selectedEvents
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
    const counts = new Map<string, number>();
    const today = new Date();
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      counts.set(key, 0);
    }
    for (const event of selectedEvents) {
      const key = getLocalDateKey(event.occurredAt);
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }
    return [...counts.entries()];
  }, [selectedEvents]);
  const maxDailyCount = Math.max(1, ...lastFourteenDays.map(([, count]) => count));

  if (events === null) {
    return <div aria-label="正在加载模块统计" className="module-stats-loading" role="status" />;
  }

  return (
    <section aria-labelledby={`module-event-stats-${kind}`} className="module-stats-view">
      <header className="module-stats-heading">
        <div>
          <span>本阶段数据</span>
          <h2 id={`module-event-stats-${kind}`}>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </header>
      {selectedEvents.length === 0 ? (
        <p className="module-stats-empty" role="status">
          {copy.empty}
        </p>
      ) : (
        <>
          <dl className="module-stats-metrics">
            <div>
              <dt>答题数</dt>
              <dd>{selectedEvents.length}</dd>
            </div>
            <div>
              <dt>{copy.accuracyLabel ?? "准确率"}</dt>
              <dd>
                {answeredEvents.length
                  ? `${Math.round((correctCount / answeredEvents.length) * 100)}%`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>中位反应时间</dt>
              <dd>{formatDuration(medianResponse)}</dd>
            </div>
            <div>
              <dt>最近练习</dt>
              <dd>{new Date(selectedEvents[0]!.occurredAt).toLocaleDateString()}</dd>
            </div>
          </dl>
          <section aria-label="近十四天练习量" className="module-stats-activity">
            <h3>近 14 天答题量</h3>
            <div className="module-stats-bars">
              {lastFourteenDays.map(([date, count]) => (
                <div className="module-stats-bar-column" key={date}>
                  <span
                    aria-label={`${date}：${count} 题`}
                    className={count ? "has-activity" : ""}
                    style={{ height: `${Math.max(4, (count / maxDailyCount) * 100)}%` }}
                    title={`${date}：${count} 题`}
                  />
                </div>
              ))}
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
                <span className={event.isCorrectFinal === true ? "is-correct" : "is-incorrect"}>
                  {event.wasInterrupted
                    ? "中断"
                    : event.isMissed
                      ? "漏答"
                      : event.isCorrectFinal
                        ? "正确"
                        : "错误"}
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

export function DuetStats({ dataSetId }: { dataSetId: string }): JSX.Element {
  return <ModuleEventStats dataSetId={dataSetId} kind="duet" />;
}

export function isDuetAnswerEvent(event: AnswerEvent): boolean {
  return isDuetEvent(event);
}
