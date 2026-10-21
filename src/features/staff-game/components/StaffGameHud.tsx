import { SkipForward } from "lucide-react";
import type { Ref } from "react";

export interface StaffGameHudProps {
  songSelectionHeaderTitle: string | null;
  isSongMode: boolean;
  isLearningChallenge: boolean;
  isQuestionCountProgress: boolean;
  isWrongNoteReview: boolean;
  isReady: boolean;
  rushModeActive: boolean;
  historyLabel: string;
  historyStars: number;
  medalLabel: string;
  activeProgress: number;
  currentRoundStars: number;
  progressLabel: string;
  progressValue: string | number;
  learningProgressValue: string;
  reviewTimeSeconds: number;
  showScore: boolean;
  scoreLabel: string;
  displayedScore: number;
  scoreDetail: string;
  scoreValueRef: Ref<HTMLElement>;
  showLevelJump: boolean;
  onOpenLevels: () => void;
}

export function StaffGameHud({
  songSelectionHeaderTitle,
  isSongMode,
  isLearningChallenge,
  isQuestionCountProgress,
  isWrongNoteReview,
  isReady,
  rushModeActive,
  historyLabel,
  historyStars,
  medalLabel,
  activeProgress,
  currentRoundStars,
  progressLabel,
  progressValue,
  learningProgressValue,
  reviewTimeSeconds,
  showScore,
  scoreLabel,
  displayedScore,
  scoreDetail,
  scoreValueRef,
  showLevelJump,
  onOpenLevels,
}: StaffGameHudProps) {
  if (songSelectionHeaderTitle !== null) {
    return (
      <header className="staff-game-song-hud">
        <span aria-hidden="true" />
        <div>
          <strong>游戏歌曲模式</strong>
          <span>{songSelectionHeaderTitle}</span>
        </div>
        <span aria-hidden="true" />
      </header>
    );
  }

  if (isWrongNoteReview) {
    return (
      <header
        className={`staff-game-hud is-wrong-note-review is-review-capsule${isReady ? " is-ready" : ""}`}
      >
        <div
          aria-label="错题复习进度和剩余时间"
          className="staff-game-review-hud-capsule"
          role="group"
        >
          <div className="staff-game-review-hud-item">
            <span>{progressLabel}</span>
            <strong>{progressValue}</strong>
          </div>
          <span aria-hidden="true" className="staff-game-review-hud-divider" />
          <div className="staff-game-review-hud-item">
            <span>剩余</span>
            <strong>{reviewTimeSeconds}s</strong>
          </div>
        </div>
      </header>
    );
  }

  const medalClassName = `staff-game-level-medal${isSongMode ? " is-song-progress" : ""}${isQuestionCountProgress ? " is-learning-test" : ""}${isWrongNoteReview ? " is-review-question-progress" : ""}`;
  const isArcadeMode = !isSongMode && !isLearningChallenge;
  const medalContent = isQuestionCountProgress ? (
    <>
      <span>{progressLabel}</span>
      <span aria-hidden="true" className="staff-game-question-progress-track">
        <span
          className="staff-game-question-progress-fill"
          style={{ width: `${Math.max(0, Math.min(100, activeProgress * 100))}%` }}
        />
      </span>
      <strong>{progressValue}</strong>
    </>
  ) : (
    <>
      <svg aria-hidden="true" className="staff-game-level-progress" viewBox="0 0 120 120">
        <path
          className="staff-game-level-progress-track"
          d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06"
          pathLength="1000"
        />
        <path
          className="staff-game-level-progress-fill"
          d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06"
          pathLength="1000"
          strokeDashoffset={1000 * (1 - activeProgress)}
        />
        {!isSongMode
          ? [
              { x: 15, y: 93.94 },
              { x: 105, y: 93.94 },
              { x: 93.94, y: 26.06 },
            ].map((position, index) => (
              <text
                className={`staff-game-level-progress-star${currentRoundStars > index ? " earned" : ""}`}
                dominantBaseline="central"
                key={index}
                textAnchor="middle"
                x={position.x}
                y={position.y}
              >
                ★
              </text>
            ))
          : null}
      </svg>
      <span>{progressLabel}</span>
      <strong className={isSongMode ? "staff-game-song-progress-value" : undefined}>
        {progressValue}
      </strong>
    </>
  );
  const canJumpFromMedal = showLevelJump && !isQuestionCountProgress && !isSongMode;

  return (
    <header
      className={`staff-game-hud${isSongMode ? " is-song-mode" : ""}${isLearningChallenge ? " is-learning-test" : ""}${isArcadeMode ? " is-arcade-mode" : ""}${rushModeActive ? " is-rush-mode" : ""}${isWrongNoteReview ? " is-wrong-note-review" : ""}${isReady ? " is-ready" : ""}`}
    >
      {!rushModeActive && !isWrongNoteReview ? (
        <div
          aria-hidden={rushModeActive}
          className="staff-game-hud-card hud-panel-css staff-game-display-card"
        >
          {isLearningChallenge && isReady ? (
            <>
              <span>{historyLabel}</span>
              <strong
                aria-label={`进度 ${learningProgressValue}`}
                className="staff-game-learning-ready-progress"
              >
                {learningProgressValue}
              </strong>
            </>
          ) : (
            <>
              <span>{historyLabel}</span>
              <strong aria-label={`${historyStars} 颗星`} className="staff-game-history-stars">
                {[1, 2, 3].map((star) => (
                  <span
                    aria-hidden="true"
                    className={historyStars >= star ? "earned" : ""}
                    key={star}
                  >
                    ★
                  </span>
                ))}
              </strong>
            </>
          )}
        </div>
      ) : null}
      {!rushModeActive && (isQuestionCountProgress || !isWrongNoteReview) ? (
        canJumpFromMedal ? (
          <button
            aria-label={`${medalLabel}，点击选择关卡`}
            className={`${medalClassName} is-jump-trigger`}
            onClick={onOpenLevels}
            type="button"
          >
            {medalContent}
          </button>
        ) : (
          <div
            aria-hidden={rushModeActive}
            aria-label={medalLabel}
            className={medalClassName}
            aria-valuemax={isQuestionCountProgress ? 100 : undefined}
            aria-valuemin={isQuestionCountProgress ? 0 : undefined}
            aria-valuenow={
              isQuestionCountProgress
                ? Math.round(Math.max(0, Math.min(1, activeProgress)) * 100)
                : undefined
            }
            role={isQuestionCountProgress ? "progressbar" : undefined}
          >
            {medalContent}
          </div>
        )
      ) : null}
      <div className="staff-game-score-group">
        {showScore ? (
          <div className="staff-game-hud-card hud-panel-css staff-game-score-card">
            {!rushModeActive ? <span>{scoreLabel}</span> : null}
            <strong
              aria-label={`当前得分 ${Math.round(displayedScore)}`}
              className={rushModeActive ? "is-rush-score" : undefined}
              ref={scoreValueRef}
            >
              {Math.round(displayedScore)}
            </strong>
            {!rushModeActive && scoreDetail ? <small>{scoreDetail}</small> : null}
          </div>
        ) : null}
        {showLevelJump && !rushModeActive && !isWrongNoteReview ? (
          <button
            aria-label="选择关卡"
            className="staff-game-jump-button"
            onClick={onOpenLevels}
            type="button"
          >
            <SkipForward aria-hidden="true" size={14} />
            选择关卡
          </button>
        ) : null}
      </div>
    </header>
  );
}
