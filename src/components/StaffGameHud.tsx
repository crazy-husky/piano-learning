import { SkipForward } from "lucide-react";
import type { Ref } from "react";

export interface StaffGameHudProps {
  songSelectionHeaderTitle: string | null;
  isSongMode: boolean;
  rushModeActive: boolean;
  historyLabel: string;
  historyStars: number;
  starImage: string;
  medalLabel: string;
  activeProgress: number;
  currentRoundStars: number;
  progressLabel: string;
  progressValue: string | number;
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
  rushModeActive,
  historyLabel,
  historyStars,
  starImage,
  medalLabel,
  activeProgress,
  currentRoundStars,
  progressLabel,
  progressValue,
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
        <div><strong>游戏歌曲模式</strong><span>{songSelectionHeaderTitle}</span></div>
        <span aria-hidden="true" />
      </header>
    );
  }

  return (
    <header className={`staff-game-hud${isSongMode ? " is-song-mode" : ""}${rushModeActive ? " is-rush-mode" : ""}`}>
      <div aria-hidden={rushModeActive} className="staff-game-hud-card staff-game-display-card">
        <span>{historyLabel}</span>
        <strong aria-label={`${historyStars} 颗星`} className="staff-game-history-stars">
          {[1, 2, 3].map((star) => (
            <img alt="" className={historyStars >= star ? "earned" : ""} key={star} src={starImage} />
          ))}
        </strong>
      </div>
      <div aria-hidden={rushModeActive} aria-label={medalLabel} className={`staff-game-level-medal${isSongMode ? " is-song-progress" : ""}`}>
        <svg aria-hidden="true" className="staff-game-level-progress" viewBox="0 0 120 120">
          <path className="staff-game-level-progress-track" d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06" pathLength="1000" />
          <path
            className="staff-game-level-progress-fill"
            d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06"
            pathLength="1000"
            strokeDashoffset={1000 * (1 - activeProgress)}
          />
          {!isSongMode ? [
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
            >★</text>
          )) : null}
        </svg>
        <span>{progressLabel}</span>
        <strong className={isSongMode ? "staff-game-song-progress-value" : undefined}>{progressValue}</strong>
      </div>
      <div className="staff-game-score-group">
        <div className="staff-game-hud-card staff-game-score-card">
          <span>{scoreLabel}</span>
          <strong aria-label={`当前得分 ${displayedScore}`} className={rushModeActive ? "is-rush-score" : undefined} ref={scoreValueRef}>
            {displayedScore}
          </strong>
          <small>{scoreDetail}</small>
        </div>
        {showLevelJump ? (
          <button aria-label="选择关卡跳级" className="staff-game-jump-button" onClick={onOpenLevels} type="button">
            <SkipForward aria-hidden="true" size={14} />跳级
          </button>
        ) : null}
      </div>
    </header>
  );
}
