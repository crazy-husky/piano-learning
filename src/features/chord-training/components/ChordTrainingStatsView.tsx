import { useEffect, useMemo, useState } from "react";
import type { AnswerEvent } from "../../../domain/types";
import { db } from "../../../data/db";
import type { ChordTask } from "../logic/chordTraining";

interface ChordRunStat {
  id: string;
  task: ChordTask;
  startedAt: string;
  questionCount: number;
  correctCount: number;
}

function taskName(task: ChordTask): string {
  return task === "recognize" ? "认和弦" : task === "block" ? "柱式和弦" : "分解和弦";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ChordTrainingStatsView({ dataSetId }: { dataSetId: string }): JSX.Element {
  const [events, setEvents] = useState<AnswerEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db.answerEvents
      .toArray()
      .then((stored) => {
        if (cancelled) return;
        setEvents(
          stored.filter(
            (event) =>
              event.dataSetId === dataSetId &&
              event.learningLevelId === 8 &&
              event.mode === "chord-training" &&
              event.chordTraining !== undefined &&
              event.wasInterrupted !== true
          )
        );
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSetId]);

  const runs = useMemo((): ChordRunStat[] => {
    if (!events) return [];
    const bySession = new Map<string, AnswerEvent[]>();
    for (const event of events) {
      const group = bySession.get(event.sessionId) ?? [];
      group.push(event);
      bySession.set(event.sessionId, group);
    }
    return [...bySession.entries()]
      .map(([id, runEvents]) => {
        const ordered = [...runEvents].sort((left, right) => left.eventIndex - right.eventIndex);
        return {
          id,
          task: ordered[0]?.chordTraining?.task ?? "recognize",
          startedAt: ordered[0]?.occurredAt ?? "",
          questionCount: ordered.length,
          correctCount: ordered.filter((event) => event.isCorrectFirstTry === true).length,
        };
      })
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }, [events]);

  const totalCorrect = events?.filter((event) => event.isCorrectFirstTry === true).length ?? 0;
  const totalCount = events?.length ?? 0;
  const accuracy = totalCount > 0 ? Math.round((totalCorrect / totalCount) * 100) : 0;
  const recognized =
    events?.filter((event) => event.chordTraining?.task === "recognize").length ?? 0;
  const performance = totalCount - recognized;

  return (
    <section aria-labelledby="chord-training-stats-title" className="chord-training-stats">
      <header className="chord-training-stats-heading">
        <span className="chord-training-kicker">LEVEL 8 · 练习记录</span>
        <h2 id="chord-training-stats-title">和弦训练统计</h2>
        <p>按和弦组统计首答表现，不会拆分成单音成绩。</p>
      </header>

      {events === null ? (
        <p aria-busy="true" className="chord-training-stats-empty" role="status">
          正在读取和弦练习记录…
        </p>
      ) : totalCount === 0 ? (
        <div className="chord-training-stats-empty">
          <strong>还没有和弦练习记录</strong>
          <span>完成一轮和弦训练后，首答正确率和练习次数会显示在这里。</span>
        </div>
      ) : (
        <>
          <div className="chord-training-stats-metrics">
            <div>
              <span>首答正确率</span>
              <strong>{accuracy}%</strong>
            </div>
            <div>
              <span>完成和弦组</span>
              <strong>{totalCount}</strong>
            </div>
            <div>
              <span>练习轮次</span>
              <strong>{runs.length}</strong>
            </div>
          </div>
          <div className="chord-training-stats-split">
            <span>认和弦 {recognized} 组</span>
            <span>弹和弦 {performance} 组</span>
          </div>
          <div className="chord-training-run-list">
            <div className="chord-training-run-row is-heading">
              <span>时间</span>
              <span>练习方式</span>
              <span>首答正确</span>
              <span>正确率</span>
            </div>
            {runs.slice(0, 30).map((run) => (
              <div className="chord-training-run-row" key={run.id}>
                <span>{formatDate(run.startedAt)}</span>
                <span>{taskName(run.task)}</span>
                <span>
                  {run.correctCount} / {run.questionCount}
                </span>
                <strong>{Math.round((run.correctCount / run.questionCount) * 100)}%</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
