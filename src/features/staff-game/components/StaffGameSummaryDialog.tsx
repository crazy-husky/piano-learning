import { CircleHelp, RotateCcw, SkipForward, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StaffGameWrongNoteComparison } from "../../../domain/staffGameWrongNoteArchives";
import type { StaffGameChallengeMode } from "../../../domain/types";
import type { StaffGameWrongAnswerRecord } from "../hooks/useStaffGameScoring";
import type { StaffGameRoundNoteOutcome } from "../hooks/useStaffGameRoundClock";
import type { StaffGameWrongNoteRunPerformance } from "../logic/staffGameWrongNoteArchive";
import { StaffGameReviewSummaryContent } from "./StaffGameReviewSummaryContent";

export type StaffGameSummaryMode = "challenge" | "song" | "review";

export interface StaffGameSummaryDialogProps {
  mode: StaffGameSummaryMode;
  challengeMode: StaffGameChallengeMode;
  ariaLabel: string;
  gameArtStyle: CSSProperties;
  isSongMode: boolean;
  songTitle: string;
  level: number;
  revealedStars: number;
  earnedStars: number;
  gameEffectsEnabled: boolean;
  fireworks: ReactNode;
  mascot: ReactNode;
  starImage: string;
  levelBannerImage: string;
  comboCount: number;
  score: number;
  generatedNoteCount: number;
  wrongAnswerRecords: StaffGameWrongAnswerRecord[];
  weakNoteOutcomes: StaffGameRoundNoteOutcome[];
  wrongNoteStatisticsEnabled: boolean;
  isWrongNoteReview: boolean;
  wrongNoteReviewTimedOut: boolean;
  reviewQuestionCount: number;
  wrongNoteArchiveStatus: "idle" | "manual" | "saving" | "saved" | "error";
  wrongNoteArchiveRetryQueued: boolean;
  wrongNoteArchiveMode: "automatic" | "manual" | "trend" | null;
  wrongNoteArchiveDate: string | null;
  wrongNoteComparison: StaffGameWrongNoteComparison | null;
  reviewPerformance: StaffGameWrongNoteRunPerformance | null;
  accuracy: number;
  averagePlayerResponseMs: number | null;
  inputMode: "physical" | "midi" | "virtual";
  showFastPlayingHint: boolean;
  isNewComboRecord: boolean;
  isNewScoreRecord: boolean;
  hasNextSong: boolean;
  isFinalLevel: boolean;
  onRetry: () => void;
  onPlayNextSong: () => void;
  onReturnToSongList: () => void;
  onAdvanceLevel: () => void;
  onExitWrongNoteReview: () => void;
  onCloseChallengeSummary: () => void;
  onArchiveWrongNotes: () => void;
  onRetryArchive: () => void;
}

export function StaffGameSummaryDialog({
  mode,
  challengeMode,
  ariaLabel,
  gameArtStyle,
  isSongMode,
  songTitle,
  level,
  revealedStars,
  earnedStars,
  gameEffectsEnabled,
  fireworks,
  mascot,
  starImage,
  levelBannerImage,
  comboCount,
  score,
  generatedNoteCount,
  wrongAnswerRecords,
  weakNoteOutcomes,
  wrongNoteStatisticsEnabled,
  isWrongNoteReview,
  wrongNoteReviewTimedOut,
  reviewQuestionCount,
  wrongNoteArchiveStatus,
  wrongNoteArchiveRetryQueued,
  wrongNoteArchiveMode,
  wrongNoteArchiveDate,
  wrongNoteComparison,
  reviewPerformance,
  accuracy,
  averagePlayerResponseMs,
  inputMode,
  showFastPlayingHint,
  isNewComboRecord,
  isNewScoreRecord,
  hasNextSong,
  isFinalLevel,
  onRetry,
  onPlayNextSong,
  onReturnToSongList,
  onAdvanceLevel,
  onExitWrongNoteReview,
  onCloseChallengeSummary,
  onArchiveWrongNotes,
  onRetryArchive,
}: StaffGameSummaryDialogProps) {
  const [showWrongAnswerDetails, setShowWrongAnswerDetails] = useState(false);
  const detailsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const detailsDialogRef = useRef<HTMLElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  const hasOpenedDetailsRef = useRef(false);
  const weakNoteCount = weakNoteOutcomes.filter(
    (outcome) => outcome.firstInputCorrect !== true
  ).length;
  const firstTryFailurePercentage =
    generatedNoteCount > 0 ? Math.round((weakNoteCount / generatedNoteCount) * 100) : 0;
  const missedNoteCount = weakNoteOutcomes.filter((outcome) => outcome.missed).length;
  const wrongNoteCount = weakNoteOutcomes.filter(
    (outcome) => outcome.firstInputCorrect === false
  ).length;
  const isLearningTest = mode === "challenge" && challengeMode === "learning";
  const archiveDateLabel = wrongNoteArchiveDate
    ? (() => {
        const [, month, day] = wrongNoteArchiveDate.split("-");
        return `${Number(month)}月${Number(day)}日`;
      })()
    : "";
  const wrongResultsByToken = wrongAnswerRecords.reduce((results, record) => {
    if (!results.has(record.token)) results.set(record.token, record.recognizedNote);
    return results;
  }, new Map<number, string>());
  const weakNotesByPitch = new Map<
    string,
    {
      inputResultCounts: Map<string, number>;
      reasons: Set<string>;
      targetTokens: Set<number>;
    }
  >();

  weakNoteOutcomes.forEach((outcome) => {
    if (outcome.firstInputCorrect === true) return;
    const noteSummary = weakNotesByPitch.get(outcome.note) ?? {
      inputResultCounts: new Map<string, number>(),
      reasons: new Set<string>(),
      targetTokens: new Set<number>(),
    };
    noteSummary.targetTokens.add(outcome.token);
    const wrongResult = wrongResultsByToken.get(outcome.token);
    if (outcome.firstInputCorrect === false || wrongResult) noteSummary.reasons.add("错音");
    if (outcome.firstInputCorrect === null || outcome.missed) noteSummary.reasons.add("漏音");
    const inputResult = wrongResult ?? (outcome.firstInputCorrect === null ? "未输入" : undefined);
    if (inputResult) {
      noteSummary.inputResultCounts.set(
        inputResult,
        (noteSummary.inputResultCounts.get(inputResult) ?? 0) + 1
      );
    }
    weakNotesByPitch.set(outcome.note, noteSummary);
  });

  const weakNoteDetailsRows = Array.from(weakNotesByPitch, ([note, summary]) => {
    const inputResults = Array.from(summary.inputResultCounts)
      .sort((first, second) => second[1] - first[1])
      .map(([result, count]) => (count > 1 ? `${result} ×${count}` : result));
    return {
      key: note,
      expectedNote: note,
      inputResults,
      kind: Array.from(summary.reasons).join("、") || "—",
      count: summary.targetTokens.size,
    };
  });

  useEffect(() => {
    if (showWrongAnswerDetails) {
      hasOpenedDetailsRef.current = true;
      detailsCloseButtonRef.current?.focus();
    } else if (hasOpenedDetailsRef.current) {
      detailsTriggerRef.current?.focus();
    }
  }, [showWrongAnswerDetails]);

  useEffect(() => {
    if (!showWrongAnswerDetails) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const dialog = detailsDialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setShowWrongAnswerDetails(false);
        return;
      }

      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showWrongAnswerDetails]);

  useEffect(() => {
    if (!showWrongAnswerDetails) return undefined;
    const appRoot = document.getElementById("root");
    if (!appRoot) return undefined;

    const wasInert = appRoot.inert;
    appRoot.inert = true;
    return () => {
      appRoot.inert = wasInert;
    };
  }, [showWrongAnswerDetails]);

  return createPortal(
    <>
      <div
        aria-hidden={showWrongAnswerDetails}
        aria-label={ariaLabel}
        aria-modal={!showWrongAnswerDetails}
        className={`staff-game-summary-backdrop${isWrongNoteReview ? " has-review-comparison" : ""}${gameEffectsEnabled ? "" : " effects-disabled"}`}
        role="dialog"
        style={gameArtStyle}
      >
        {!isWrongNoteReview ? (
          <div
            aria-label={`${revealedStars} 颗星依次出现，获得 ${earnedStars} 颗星`}
            className={`staff-game-summary-stars has-star-halo${earnedStars === 0 ? " is-white-star-halo" : ""}${gameEffectsEnabled ? " is-animated" : ""}`}
            role="img"
          >
            {[1, 2, 3].map((star) => (
              <img
                alt=""
                className={`staff-game-summary-star${earnedStars >= star ? " earned" : ""}${revealedStars >= star ? " is-revealed" : ""}`}
                key={star}
                src={starImage}
              />
            ))}
          </div>
        ) : null}
        <section
          className={`staff-game-card staff-game-summary-card${isLearningTest ? " is-learning-test" : ""}`}
        >
          {mode === "challenge" ? (
            <button
              aria-label="关闭结算，返回关卡开始页"
              className="staff-game-summary-close"
              onClick={onCloseChallengeSummary}
              type="button"
            >
              <X aria-hidden="true" size={19} />
            </button>
          ) : null}
          <div
            aria-label={isWrongNoteReview ? "错题复习" : isSongMode ? songTitle : `第 ${level} 关`}
            className="staff-game-summary-level-badge"
            role="img"
          >
            <img alt="" aria-hidden="true" draggable="false" src={levelBannerImage} />
            <strong className={isSongMode ? "is-song-title" : undefined}>
              {isWrongNoteReview
                ? "错题复习"
                : isSongMode
                  ? songTitle
                  : isLearningTest
                    ? "学习测试"
                    : `LEVEL ${level}`}
            </strong>
          </div>
          <div className={`staff-game-summary-content${mode === "review" ? " is-review" : ""}`}>
            <div aria-hidden="true" className="staff-game-summary-celebration">
              {fireworks}
              {mascot}
            </div>
            {mode === "review" ? (
              <StaffGameReviewSummaryContent
                timedOut={wrongNoteReviewTimedOut}
                questionCount={reviewQuestionCount}
                generatedQuestionCount={generatedNoteCount}
                archiveMode={wrongNoteArchiveMode}
                archiveDateLabel={archiveDateLabel}
                archiveRetryQueued={wrongNoteArchiveRetryQueued}
                archiveStatus={wrongNoteArchiveStatus}
                comparison={wrongNoteComparison}
                detailsTriggerRef={detailsTriggerRef}
                onExit={onExitWrongNoteReview}
                onRetry={onRetry}
                onRetryArchive={onRetryArchive}
                onShowWeakNoteDetails={() => setShowWrongAnswerDetails(true)}
                performance={reviewPerformance}
                wrongNoteStatisticsEnabled={wrongNoteStatisticsEnabled}
              />
            ) : (
              <>
                {isLearningTest ? (
                  <section aria-label="学习测试结果" className="staff-game-learning-summary">
                    <h2>测试完成</h2>
                    <div className="staff-game-learning-summary-metrics">
                      <div className="is-accuracy">
                        <span>首次正确率</span>
                        <strong>{Math.round(accuracy)}%</strong>
                        <small>
                          {Math.max(0, generatedNoteCount - weakNoteCount)} / {generatedNoteCount}{" "}
                          题首次答对
                        </small>
                      </div>
                      <div className="is-errors">
                        <span>错漏题数</span>
                        <strong>{weakNoteCount} 题</strong>
                        <small>
                          错答 {wrongNoteCount} 题 · 漏答 {missedNoteCount} 题
                        </small>
                        {weakNoteCount > 0 ? (
                          <button
                            aria-label="查看错漏音明细"
                            className="staff-game-learning-details-button"
                            onClick={() => setShowWrongAnswerDetails(true)}
                            ref={detailsTriggerRef}
                            type="button"
                          >
                            查看明细
                          </button>
                        ) : null}
                      </div>
                      <div className="is-response">
                        <span>平均反应时间</span>
                        <strong>
                          {averagePlayerResponseMs === null
                            ? "暂无"
                            : `${(averagePlayerResponseMs / 1000).toFixed(1)} 秒`}
                        </strong>
                        <small>仅统计首次答对的音符</small>
                      </div>
                    </div>
                    <div className="staff-game-learning-game-flavor">
                      <span>得分 {Math.round(score)}</span>
                      <span>最高连击 {comboCount}</span>
                    </div>
                  </section>
                ) : (
                  <>
                    {isWrongNoteReview || isSongMode || earnedStars > 0 ? (
                      <h2>
                        {isWrongNoteReview ? "复习完成" : isSongMode ? "演奏完成！" : "闯关成功！"}
                      </h2>
                    ) : null}
                    <div className="staff-game-result-stats">
                      {wrongNoteStatisticsEnabled ? (
                        <div className="is-wrong-count">
                          <span>{isSongMode ? "错漏音 / 总音" : "错漏题 / 总题"}</span>
                          <strong>
                            <span className="staff-game-result-metric-value">
                              {weakNoteCount} / {generatedNoteCount}
                            </span>
                            <span className="staff-game-result-metric-accessory">
                              <button
                                aria-label="查看薄弱音统计详情"
                                className="staff-game-wrong-answer-details-trigger"
                                onClick={() => setShowWrongAnswerDetails(true)}
                                ref={detailsTriggerRef}
                                type="button"
                              >
                                <CircleHelp aria-hidden="true" size={16} />
                              </button>
                            </span>
                          </strong>
                        </div>
                      ) : null}
                      <div>
                        <span>最大连击数</span>
                        <strong>
                          <span className="staff-game-result-metric-value">{comboCount} 次</span>
                          <span className="staff-game-result-metric-accessory">
                            {isNewComboRecord ? <em>新纪录</em> : null}
                          </span>
                        </strong>
                      </div>
                      <div className="is-score">
                        <span>获得的分数</span>
                        <strong>
                          <span className="staff-game-result-metric-value">
                            {Math.round(score)} 分
                          </span>
                          <span className="staff-game-result-metric-accessory">
                            {isNewScoreRecord ? <em>新纪录</em> : null}
                          </span>
                        </strong>
                      </div>
                      {isSongMode ? (
                        <div>
                          <span>准确率（第一次就按对）</span>
                          <strong>
                            <span className="staff-game-result-metric-value">
                              {Math.round(accuracy)}%
                            </span>
                            <span className="staff-game-result-metric-accessory" />
                          </strong>
                        </div>
                      ) : null}
                    </div>
                    {generatedNoteCount > 0 ? (
                      <p className="staff-game-proficiency-summary">
                        {!isSongMode
                          ? `首次正确率 ${Math.round((100 * (generatedNoteCount - weakNoteCount)) / generatedNoteCount)}% · `
                          : ""}
                        {averagePlayerResponseMs === null
                          ? "暂无有效反应时间样本"
                          : `平均反应 ${(averagePlayerResponseMs / 1000).toFixed(1)}s${inputMode === "physical" ? "（已校准）" : ""}`}
                      </p>
                    ) : null}
                  </>
                )}
                {showFastPlayingHint && inputMode === "physical" ? (
                  <p className="staff-game-fast-playing-hint">
                    检测到您正在快速演奏，若识别准确率低，建议使用 MIDI 键盘或虚拟键盘。
                  </p>
                ) : null}
                {wrongNoteArchiveStatus !== "idle" && wrongNoteArchiveMode ? (
                  <div
                    className={`staff-game-wrong-note-archive-status is-${wrongNoteArchiveStatus}`}
                  >
                    {wrongNoteArchiveStatus === "saving" ? (
                      <span>
                        {wrongNoteArchiveMode === "trend"
                          ? "正在保存本局趋势…"
                          : "正在保存到错题集…"}
                      </span>
                    ) : wrongNoteArchiveStatus === "error" ? (
                      <>
                        <span>
                          {wrongNoteArchiveRetryQueued
                            ? wrongNoteArchiveMode === "trend"
                              ? "本局趋势保存失败，已暂存并会在下次进入游戏页时自动重试"
                              : "错题集保存失败，已暂存并会在下次进入游戏页时自动重试"
                            : wrongNoteArchiveMode === "trend"
                              ? "本局趋势保存和本地暂存均失败，请点击重试"
                              : "错题集保存和本地暂存均失败，请点击重试"}
                        </span>
                        <button onClick={onRetryArchive} type="button">
                          重试
                        </button>
                      </>
                    ) : wrongNoteArchiveStatus === "manual" ? (
                      <button onClick={onArchiveWrongNotes} type="button">
                        加入错题集
                      </button>
                    ) : (
                      <span>
                        ✓
                        {wrongNoteArchiveMode === "trend"
                          ? "已记录本局趋势"
                          : wrongNoteArchiveMode === "automatic"
                            ? "已自动归档"
                            : "已加入错题集"}
                        {archiveDateLabel ? ` · ${archiveDateLabel}` : ""}
                      </span>
                    )}
                  </div>
                ) : null}
                <div className="staff-game-summary-actions">
                  <button className="staff-game-primary" onClick={onRetry} type="button">
                    <RotateCcw size={16} />
                    {isWrongNoteReview ? "再练一轮" : isSongMode ? "再弹一次" : "再试一次"}
                  </button>
                  {isSongMode ? (
                    <>
                      <button
                        className="staff-game-secondary"
                        onClick={onPlayNextSong}
                        type="button"
                      >
                        <SkipForward size={16} />
                        {hasNextSong ? "下一首" : "回到歌曲列表"}
                      </button>
                      {hasNextSong ? (
                        <button
                          className="staff-game-summary-list-button"
                          onClick={onReturnToSongList}
                          type="button"
                        >
                          歌曲列表
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      className="staff-game-secondary"
                      disabled={!isWrongNoteReview && isFinalLevel}
                      onClick={isWrongNoteReview ? onExitWrongNoteReview : onAdvanceLevel}
                      type="button"
                    >
                      {isWrongNoteReview ? <X size={16} /> : <SkipForward size={16} />}
                      <span className="staff-game-summary-action-label">
                        {isWrongNoteReview ? "退出复习" : isFinalLevel ? "已通关" : "下一级"}
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
      {showWrongAnswerDetails ? (
        <div
          className="staff-game-wrong-answer-details-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowWrongAnswerDetails(false);
          }}
        >
          <section
            aria-labelledby="staff-game-weak-note-details-title"
            aria-modal="true"
            className="staff-game-wrong-answer-details"
            ref={detailsDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="关闭薄弱音统计详情"
              className="staff-game-wrong-answer-details-close"
              onClick={() => setShowWrongAnswerDetails(false)}
              ref={detailsCloseButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={19} />
            </button>
            <h2 id="staff-game-weak-note-details-title">
              {isLearningTest ? "错漏音明细" : "薄弱音统计详情"}
              <span className="staff-game-wrong-answer-details-title-note">（仅供参考）</span>
            </h2>
            <p className="staff-game-wrong-answer-conclusion">
              本局共出现 <strong>{generatedNoteCount}</strong> {isSongMode ? "个音符" : "道题"}，
              错答或漏答共计 <strong>{weakNoteCount}</strong> {isSongMode ? "个" : "道"}，占比{" "}
              <strong>{firstTryFailurePercentage}%</strong>。
            </p>
            <div className="staff-game-wrong-answer-table-wrap">
              <table className="staff-game-wrong-answer-table">
                <thead>
                  <tr>
                    <th scope="col">目标音</th>
                    <th scope="col">输入结果</th>
                    <th scope="col">薄弱原因</th>
                    <th scope="col">次数</th>
                  </tr>
                </thead>
                <tbody>
                  {weakNoteDetailsRows.length > 0 ? (
                    weakNoteDetailsRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.expectedNote}</td>
                        <td>
                          {row.inputResults.slice(0, 6).map((result, index) => (
                            <Fragment key={`${result}-${index}`}>
                              {index === 3 ? <br /> : index > 0 ? "、" : null}
                              {result}
                            </Fragment>
                          ))}
                          {row.inputResults.length > 6 ? "、…" : null}
                        </td>
                        <td>{row.kind}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>本局没有薄弱音记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="staff-game-wrong-answer-details-actions">
              {wrongNoteArchiveMode &&
              wrongNoteArchiveMode !== "trend" &&
              wrongNoteArchiveStatus !== "saved" ? (
                <button
                  className="staff-game-wrong-answer-details-archive"
                  disabled={wrongNoteArchiveStatus === "saving"}
                  onClick={onArchiveWrongNotes}
                  type="button"
                >
                  {wrongNoteArchiveStatus === "saving" ? "正在加入…" : "加入错题集"}
                </button>
              ) : null}
              <button
                className="staff-game-wrong-answer-details-dismiss"
                onClick={() => setShowWrongAnswerDetails(false)}
                type="button"
              >
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>,
    document.body
  );
}
