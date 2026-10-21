import { AlertTriangle, CircleHelp, RotateCcw, X } from "lucide-react";
import type { RefObject } from "react";
import type { StaffGameWrongNoteComparison } from "../../../domain/staffGameWrongNoteArchives";
import type { StaffGameWrongNoteRunPerformance } from "../logic/staffGameWrongNoteArchive";

interface StaffGameReviewSummaryContentProps {
  timedOut: boolean;
  archiveMode: "automatic" | "manual" | "trend" | null;
  performance: StaffGameWrongNoteRunPerformance | null;
  averageResponseMs: number | null;
  comparison: StaffGameWrongNoteComparison | null;
  wrongNoteStatisticsEnabled: boolean;
  archiveStatus: "idle" | "manual" | "saving" | "saved" | "error";
  archiveRetryQueued: boolean;
  archiveDateLabel: string;
  onRetryArchive: () => void;
  onRetry: () => void;
  onExit: () => void;
  onShowWeakNoteDetails: () => void;
  detailsTriggerRef: RefObject<HTMLButtonElement>;
}

function formatRateChange(change: number): string {
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
  const sign = change > 0 ? "+" : "";
  return `${arrow} ${sign}${change} 个百分点`;
}

function formatReactionChange(change: number): string {
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
  const sign = change > 0 ? "+" : "";
  return `${arrow} ${sign}${change.toFixed(1)}s`;
}

function changeTone(change: number, lowerIsBetter = false): string {
  if (change === 0) return "is-neutral";
  return (lowerIsBetter ? change < 0 : change > 0) ? "is-positive" : "is-negative";
}

export function StaffGameReviewSummaryContent({
  timedOut,
  archiveMode,
  performance,
  averageResponseMs,
  comparison,
  wrongNoteStatisticsEnabled,
  archiveStatus,
  archiveRetryQueued,
  archiveDateLabel,
  onRetryArchive,
  onRetry,
  onExit,
  onShowWeakNoteDetails,
  detailsTriggerRef,
}: StaffGameReviewSummaryContentProps) {
  const rateChange = comparison
    ? Math.round(comparison.currentFirstTryAccuracyPercent) -
      Math.round(comparison.previousFirstTryAccuracyPercent)
    : null;
  const reactionChangeSeconds =
    comparison?.currentAverageResponseMs !== null &&
    comparison?.currentAverageResponseMs !== undefined &&
    comparison.previousAverageResponseMs !== null
      ? Math.round(
          (comparison.currentAverageResponseMs - comparison.previousAverageResponseMs) / 100
        ) / 10
      : null;
  const previousDate = comparison ? new Date(comparison.previousRun.endedAt) : null;
  const previousDateLabel =
    previousDate && !Number.isNaN(previousDate.getTime())
      ? `${previousDate.getMonth() + 1}月${previousDate.getDate()}日`
      : "";
  const previousSourceLabel = comparison
    ? comparison.previousRun.source === "challenge"
      ? "闯关"
      : "错题复习"
    : "";
  const targetCount = performance?.targetCount ?? 0;
  const firstTryCorrectCount = Math.round(
    (targetCount * (performance?.firstTryAccuracyPercent ?? 0)) / 100
  );
  const missedOrWrongQuestionCount = Math.max(0, targetCount - firstTryCorrectCount);

  return (
    <div className="staff-game-review-summary">
      <h2>{timedOut ? "时间到，复习结束" : "复习完成"}</h2>
      <section aria-label="本局表现" className="staff-game-review-summary-core">
        <div className="staff-game-review-current-metrics">
          <div className="staff-game-review-current-metric is-accuracy">
            <span>首次正确率</span>
            <strong>
              {performance?.firstTryAccuracyPercent === null || !performance
                ? "暂无"
                : `${Math.round(performance.firstTryAccuracyPercent)}%`}
            </strong>
          </div>
          <div className="staff-game-review-current-metric is-response-time">
            <span>首次答对用时</span>
            <strong>
              {averageResponseMs === null ? "暂无" : `${(averageResponseMs / 1_000).toFixed(1)}s`}
            </strong>
          </div>
        </div>
        <div className="staff-game-review-summary-result-line">
          <p>
            本局共 {targetCount} 题，答对 {firstTryCorrectCount} 题
            {wrongNoteStatisticsEnabled ? `，错漏 ${missedOrWrongQuestionCount} 题` : ""}。
          </p>
          {wrongNoteStatisticsEnabled ? (
            <button
              aria-label="查看薄弱音统计详情"
              className="staff-game-review-summary-detail-button"
              onClick={onShowWeakNoteDetails}
              ref={detailsTriggerRef}
              type="button"
            >
              <CircleHelp aria-hidden="true" size={15} />
              查看明细
            </button>
          ) : null}
        </div>
        <p className="staff-game-review-summary-footnote">
          * 以上准确率与用时，均仅统计“第一次输入就答对”的样本。
        </p>
      </section>

      <section
        aria-labelledby="staff-game-review-comparison-title"
        className={`staff-game-review-summary-comparison${comparison ? "" : " is-baseline"}`}
      >
        <div className="staff-game-review-summary-section-heading">
          <h3 id="staff-game-review-comparison-title">对比上次</h3>
          {performance && performance.targetCount < 10 ? (
            <span className="staff-game-review-summary-sample-hint">
              <AlertTriangle aria-hidden="true" size={13} />
              样本较少，建议再练一轮看趋势
            </span>
          ) : null}
        </div>
        {comparison ? (
          <>
            <p className="staff-game-review-summary-common-notes">
              按共同音符对比 · {comparison.commonNoteMidis.length} 个
            </p>
            <div className="staff-game-review-comparison-metrics">
              <div className="staff-game-review-comparison-metric">
                <div className="staff-game-review-comparison-primary-line">
                  <h4>准确率（第一次就按对）</h4>
                  <strong>{Math.round(comparison.currentFirstTryAccuracyPercent)}%</strong>
                  <span
                    className={`staff-game-review-comparison-change ${changeTone(rateChange ?? 0)}`}
                  >
                    {formatRateChange(rateChange ?? 0)}
                  </span>
                </div>
                <p className="staff-game-review-comparison-previous-line">
                  上次 {Math.round(comparison.previousFirstTryAccuracyPercent)}%
                  {previousDateLabel ? ` · ${previousDateLabel}` : ""}
                  {previousSourceLabel ? ` · ${previousSourceLabel}` : ""}
                </p>
                {wrongNoteStatisticsEnabled ? (
                  <p className="staff-game-review-comparison-previous-line">
                    共同音符错漏：本次 {comparison.currentWeakNoteCount}/
                    {comparison.currentCommonTargetCount} · 上次 {comparison.previousWeakNoteCount}/
                    {comparison.previousCommonTargetCount}
                  </p>
                ) : null}
              </div>

              {comparison.currentAverageResponseMs !== null &&
              comparison.previousAverageResponseMs !== null ? (
                <div className="staff-game-review-comparison-metric">
                  <div className="staff-game-review-comparison-primary-line">
                    <h4>首次答对平均用时</h4>
                    <strong>{(comparison.currentAverageResponseMs / 1_000).toFixed(1)}s</strong>
                    <span
                      className={`staff-game-review-comparison-change ${changeTone(reactionChangeSeconds ?? 0, true)}`}
                    >
                      {formatReactionChange(reactionChangeSeconds ?? 0)}
                    </span>
                  </div>
                  <p className="staff-game-review-comparison-previous-line">
                    上次 {(comparison.previousAverageResponseMs / 1_000).toFixed(1)}s
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="staff-game-review-summary-baseline">暂无历史基线，下次可对比进步情况</div>
        )}
      </section>

      <div className="staff-game-review-summary-actions">
        <button className="staff-game-primary" onClick={onRetry} type="button">
          <RotateCcw aria-hidden="true" size={16} />
          再练一轮
        </button>
        <button className="staff-game-secondary" onClick={onExit} type="button">
          <X aria-hidden="true" size={16} />
          退出复习
        </button>
      </div>
      {archiveStatus !== "idle" && archiveStatus !== "manual" ? (
        <div
          aria-live="polite"
          className={`staff-game-wrong-note-archive-status is-${archiveStatus}`}
        >
          {archiveStatus === "saving" ? (
            <span>{archiveMode === "trend" ? "正在保存本局趋势…" : "正在保存到错题集…"}</span>
          ) : archiveStatus === "error" ? (
            <>
              <span>
                {archiveRetryQueued
                  ? archiveMode === "trend"
                    ? "本局趋势保存失败，已暂存并会在下次进入游戏页时自动重试"
                    : "错题集保存失败，已暂存并会在下次进入游戏页时自动重试"
                  : archiveMode === "trend"
                    ? "本局趋势保存和本地暂存均失败，请点击重试"
                    : "错题集保存和本地暂存均失败，请点击重试"}
              </span>
              <button onClick={onRetryArchive} type="button">
                重试
              </button>
            </>
          ) : archiveMode === "trend" ? (
            <span>✓ 已记录本局趋势</span>
          ) : (
            <span>✓ 已自动归档{archiveDateLabel ? ` · ${archiveDateLabel}` : ""}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
