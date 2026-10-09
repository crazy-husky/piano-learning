import { RotateCcw, SkipForward } from "lucide-react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

export interface StaffGameSummaryDialogProps {
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
  accuracy: number;
  isNewComboRecord: boolean;
  isNewScoreRecord: boolean;
  hasNextSong: boolean;
  isFinalLevel: boolean;
  onRetry: () => void;
  onPlayNextSong: () => void;
  onReturnToSongList: () => void;
  onAdvanceLevel: () => void;
}

export function StaffGameSummaryDialog({
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
  accuracy,
  isNewComboRecord,
  isNewScoreRecord,
  hasNextSong,
  isFinalLevel,
  onRetry,
  onPlayNextSong,
  onReturnToSongList,
  onAdvanceLevel,
}: StaffGameSummaryDialogProps) {
  return createPortal(
    <div
      aria-label={ariaLabel}
      aria-modal="true"
      className={`staff-game-summary-backdrop${gameEffectsEnabled ? "" : " effects-disabled"}`}
      role="dialog"
      style={gameArtStyle}
    >
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
      <section className="staff-game-card staff-game-summary-card">
        <div aria-label={isSongMode ? songTitle : `第 ${level} 关`} className="staff-game-summary-level-badge" role="img">
          <img alt="" aria-hidden="true" draggable="false" src={levelBannerImage} />
          <strong className={isSongMode ? "is-song-title" : undefined}>{isSongMode ? songTitle : `LEVEL ${level}`}</strong>
        </div>
        <div className="staff-game-summary-content">
          <div aria-hidden="true" className="staff-game-summary-celebration">
            {fireworks}
            {mascot}
          </div>
          {isSongMode || earnedStars > 0 ? <h2>{isSongMode ? "演奏完成！" : "闯关成功！"}</h2> : null}
          <div className="staff-game-result-stats">
            <div>
              <span>最大连击数</span>
              <strong>
                <span>{comboCount} 次</span>
                {isNewComboRecord ? <em>新纪录</em> : null}
              </strong>
            </div>
            <div className="is-score">
              <span>获得的分数</span>
              <strong>
                <span>{score} 分</span>
                {isNewScoreRecord ? <em>新纪录</em> : null}
              </strong>
            </div>
            {isSongMode ? <div><span>首次准确率</span><strong>{accuracy}%</strong></div> : null}
          </div>
          <div className="staff-game-summary-actions">
            <button className="staff-game-primary" onClick={onRetry} type="button">
              <RotateCcw size={16} />{isSongMode ? "再弹一次" : "再试一次"}
            </button>
            {isSongMode ? (
              <>
                <button className="staff-game-secondary" onClick={onPlayNextSong} type="button">
                  <SkipForward size={16} />{hasNextSong ? "下一首" : "回到歌曲列表"}
                </button>
                {hasNextSong ? <button className="staff-game-summary-list-button" onClick={onReturnToSongList} type="button">歌曲列表</button> : null}
              </>
            ) : (
              <button className="staff-game-secondary" disabled={isFinalLevel} onClick={onAdvanceLevel} type="button">
                <SkipForward size={16} />{isFinalLevel ? "已通关" : "下一级"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
