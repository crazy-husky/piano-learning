import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { formatTargetNoteLabel, getNoteById } from "../../../domain/notes";
import { isCompletedReview } from "../../../domain/reviews";
import { formatMs, type NoteStat } from "../../../domain/stats";
import type {
  SessionProgressBenchmark,
  SessionProgressMode,
  SessionProgressSeries,
} from "../../../domain/sessionProgress";
import type { PracticeSessionSummary } from "../hooks/usePracticeSessionState";
import {
  SessionProgressChart,
  SessionProgressControls,
  SessionProgressLegend,
} from "../../../shared/components/SessionProgressChart";

interface PracticeSummaryViewProps {
  allHistory: boolean;
  allHistoryCount: number;
  benchmark?: SessionProgressBenchmark;
  formatQualifiedTimeMedian: string;
  formatQualifiedTimeP90: string;
  historyLimit: number;
  isBusy: boolean;
  isMidiConnected: boolean;
  mode: SessionProgressMode;
  onAllHistoryChange: (allHistory: boolean) => void;
  onHistoryLimitChange: (limit: number) => void;
  onModeChange: (mode: SessionProgressMode) => void;
  onReturnToSetup: () => void;
  onStartAgain: () => void;
  series: SessionProgressSeries[];
  summary: PracticeSessionSummary;
  summaryHasTooManyErrors: boolean;
  weakestNotes: NoteStat[];
}

export function PracticeSummaryView({
  allHistory,
  allHistoryCount,
  benchmark,
  formatQualifiedTimeMedian,
  formatQualifiedTimeP90,
  historyLimit,
  isBusy,
  isMidiConnected,
  mode,
  onAllHistoryChange,
  onHistoryLimitChange,
  onModeChange,
  onReturnToSetup,
  onStartAgain,
  series,
  summary,
  summaryHasTooManyErrors,
  weakestNotes,
}: PracticeSummaryViewProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return undefined;

    dialog.showModal();
    dialog.querySelector<HTMLElement>("#practice-summary-title")?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-labelledby="practice-summary-title"
      className="practice-summary-overlay"
      ref={dialogRef}
      onCancel={(event) => event.preventDefault()}
    >
      <div className="panel summary-panel practice-summary-dialog">
        <div className="panel-heading summary-result-heading">
          <h1 id="practice-summary-title" tabIndex={-1}>
            本次结果
          </h1>
          {summaryHasTooManyErrors ? (
            <p className="summary-quality-warning">
              错音有点多{">_<"} 这次先不算~ <br />
              或许从更少的音区开始练习，或者先去学习页学习/默写一下吧~
            </p>
          ) : null}
        </div>
        <div className="metric-grid practice-summary-metrics">
          <div className="metric">
            <span>答对</span>
            <strong>{summary.reviews.filter(isCompletedReview).length}</strong>
          </div>
          <div className="metric">
            <span>错误</span>
            <strong>
              {summary.reviews.reduce(
                (sum, review) =>
                  sum + review.wrongAnswers.length + Number(review.wasMissed === true),
                0
              )}
            </strong>
          </div>
          <div className="metric">
            <span>中位时长</span>
            <strong>{formatQualifiedTimeMedian}</strong>
          </div>
          <div className="metric">
            <span>P90</span>
            <strong>{formatQualifiedTimeP90}</strong>
          </div>
        </div>
        <section className="summary-section">
          <div className="summary-section-heading">
            <h2>薄弱音</h2>
          </div>
          <div className="note-list">
            <div className="note-row note-row-header">
              <span>目标音</span>
              <span>中位时长</span>
              <span>错音率</span>
              <span>常错音</span>
            </div>
            {weakestNotes.map((note) => (
              <div className="note-row" key={note.targetNoteId}>
                <span>{formatTargetNoteLabel(getNoteById(note.targetNoteId))}</span>
                <span>{formatMs(note.medianMs)}</span>
                <span>{Math.round(note.errorRate * 100)}%</span>
                <span>{note.commonConfusion ?? "无"}</span>
              </div>
            ))}
          </div>
        </section>
        {!summaryHasTooManyErrors && series.length > 0 ? (
          <section className="summary-section">
            <div className="summary-section-heading session-progress-heading">
              <h2>答对进度</h2>
              <SessionProgressControls
                allHistory={allHistory}
                allHistoryCount={allHistoryCount}
                benchmark={benchmark}
                historyLimit={historyLimit}
                mode={mode}
                onAllHistoryChange={onAllHistoryChange}
                onHistoryLimitChange={onHistoryLimitChange}
                onModeChange={onModeChange}
              />
            </div>
            <SessionProgressChart series={series} />
            <SessionProgressLegend series={series} />
          </section>
        ) : null}
        <div className="action-row">
          <button onClick={onReturnToSetup}>
            <SlidersHorizontal size={18} />
            返回配置
          </button>
          <button
            aria-keyshortcuts="Enter"
            className="primary"
            disabled={isBusy}
            onClick={onStartAgain}
          >
            {isBusy ? (
              "检查中"
            ) : (
              <>
                <RotateCcw size={18} />
                再来一次<kbd>Enter</kbd>
                {isMidiConnected ? <kbd>C4</kbd> : null}
              </>
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}
