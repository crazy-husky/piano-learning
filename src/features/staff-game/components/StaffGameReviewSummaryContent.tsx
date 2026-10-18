import { CircleHelp, RotateCcw, X } from "lucide-react";
import type { RefObject } from "react";
import type { StaffGameWrongNoteComparison } from "../../../domain/staffGameWrongNoteArchives";
import type { StaffGameWrongNoteRunPerformance } from "../logic/staffGameWrongNoteArchive";

interface StaffGameReviewSummaryContentProps {
  timedOut: boolean;
  questionCount: number;
  generatedQuestionCount: number;
  archiveMode: "automatic" | "manual" | "trend" | null;
  performance: StaffGameWrongNoteRunPerformance | null;
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
  questionCount,
  generatedQuestionCount,
  archiveMode,
  performance,
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

  return (
    <div className="staff-game-review-summary">
      <h2>{timedOut ? "时间到，复习结束" : "复习完成"}</h2>
      <p className="staff-game-review-summary-progress">
        已出题 {Math.min(generatedQuestionCount, questionCount)} / {questionCount} 题
      </p>

      <section aria-labelledby="staff-game-review-current-title">
        <h3 id="staff-game-review-current-title">本次表现</h3>
        <div className="staff-game-review-current-metrics">
          <div className="staff-game-review-current-metric">
            <span>准确率（第一次就按对）</span>
            <strong>
              {performance?.firstTryAccuracyPercent === null || !performance
                ? "—"
                : `${Math.round(performance.firstTryAccuracyPercent)}%`}
            </strong>
          </div>
          <div className="staff-game-review-current-metric">
            <span>首次答对平均用时</span>
            <strong>
              {performance?.averageResponseMs === null || !performance
                ? "暂无样本"
                : `${(performance.averageResponseMs / 1_000).toFixed(1)}s`}
            </strong>
          </div>
          {wrongNoteStatisticsEnabled ? (
            <div className="staff-game-review-current-metric">
              <span className="staff-game-review-current-label-with-help">
                错漏音 / 总音
                <button
                  aria-label="查看薄弱音统计详情"
                  className="staff-game-wrong-answer-details-trigger"
                  onClick={onShowWeakNoteDetails}
                  ref={detailsTriggerRef}
                  type="button"
                >
                  <CircleHelp aria-hidden="true" size={16} />
                </button>
              </span>
              <strong>
                {performance?.weakNoteCount ?? 0} / {performance?.targetCount ?? 0}
              </strong>
            </div>
          ) : null}
        </div>
        <p className="staff-game-review-summary-note">
          首次答对平均用时只统计第一次输入就答对的目标；第一次答错后补答正确不计入。
        </p>
        {performance && performance.targetCount < 10 ? (
          <p className="staff-game-review-summary-note">
            本局共出现 {performance.targetCount} 个目标音，样本较少，建议再练一轮看趋势
          </p>
        ) : null}
        {performance?.weakNoteCount === 0 ? (
          <p className="staff-game-review-summary-note is-mastery">全对！这组音已经掌握</p>
        ) : null}
      </section>

      {comparison || (performance?.weakNoteCount ?? 0) > 0 ? (
        <section
          aria-labelledby="staff-game-review-comparison-title"
          className="staff-game-review-summary-comparison"
        >
          <h3 id="staff-game-review-comparison-title">对比上次</h3>
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
                      {comparison.currentCommonTargetCount} · 上次{" "}
                      {comparison.previousWeakNoteCount}/{comparison.previousCommonTargetCount}
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
            <p className="staff-game-review-summary-note">本次作为基线，下次可对比</p>
          )}
        </section>
      ) : null}

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
    </div>
  );
}
