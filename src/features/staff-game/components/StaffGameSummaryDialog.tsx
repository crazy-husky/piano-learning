import { CircleHelp, RotateCcw, SkipForward, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StaffGameWrongAnswerRecord } from "../hooks/useStaffGameScoring";

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
  wrongAnswerRecords: StaffGameWrongAnswerRecord[];
  wrongNoteStatisticsEnabled: boolean;
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
  wrongAnswerRecords,
  wrongNoteStatisticsEnabled,
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
  const [showWrongAnswerDetails, setShowWrongAnswerDetails] = useState(false);
  const detailsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const detailsDialogRef = useRef<HTMLElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  const hasOpenedDetailsRef = useRef(false);
  const wrongAnswerGroups = Array.from(
    wrongAnswerRecords
      .reduce((groups, record) => {
        const key = `${record.expectedNote}\u0000${record.recognizedNote}`;
        const current = groups.get(key);
        groups.set(
          key,
          current ? { ...current, count: current.count + 1 } : { ...record, count: 1 }
        );
        return groups;
      }, new Map<string, StaffGameWrongAnswerRecord & { count: number }>())
      .values()
  );

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
          <div
            aria-label={isSongMode ? songTitle : `第 ${level} 关`}
            className="staff-game-summary-level-badge"
            role="img"
          >
            <img alt="" aria-hidden="true" draggable="false" src={levelBannerImage} />
            <strong className={isSongMode ? "is-song-title" : undefined}>
              {isSongMode ? songTitle : `LEVEL ${level}`}
            </strong>
          </div>
          <div className="staff-game-summary-content">
            <div aria-hidden="true" className="staff-game-summary-celebration">
              {fireworks}
              {mascot}
            </div>
            {isSongMode || earnedStars > 0 ? (
              <h2>{isSongMode ? "演奏完成！" : "闯关成功！"}</h2>
            ) : null}
            <div className="staff-game-result-stats">
              {wrongNoteStatisticsEnabled ? (
                <div className="is-wrong-count">
                  <span>错音</span>
                  <strong>
                    <span>{wrongAnswerRecords.length} 次</span>
                    <button
                      aria-label="查看错音统计详情"
                      className="staff-game-wrong-answer-details-trigger"
                      onClick={() => setShowWrongAnswerDetails(true)}
                      ref={detailsTriggerRef}
                      type="button"
                    >
                      <CircleHelp aria-hidden="true" size={16} />
                    </button>
                  </strong>
                </div>
              ) : null}
              <div>
                <span>最大连击数</span>
                <strong>
                  <span className="staff-game-result-value">{comboCount} 次</span>
                  {isNewComboRecord ? <em>新纪录</em> : null}
                </strong>
              </div>
              <div className="is-score">
                <span>获得的分数</span>
                <strong>
                  <span className="staff-game-score-result staff-game-result-value">
                    {Math.round(score)} 分
                  </span>
                  {isNewScoreRecord ? <em>新纪录</em> : null}
                </strong>
              </div>
              {isSongMode ? (
                <div>
                  <span>首次准确率</span>
                  <strong>{Math.round(accuracy)}%</strong>
                </div>
              ) : null}
            </div>
            <div className="staff-game-summary-actions">
              <button className="staff-game-primary" onClick={onRetry} type="button">
                <RotateCcw size={16} />
                {isSongMode ? "再弹一次" : "再试一次"}
              </button>
              {isSongMode ? (
                <>
                  <button className="staff-game-secondary" onClick={onPlayNextSong} type="button">
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
                  disabled={isFinalLevel}
                  onClick={onAdvanceLevel}
                  type="button"
                >
                  <SkipForward size={16} />
                  {isFinalLevel ? "已通关" : "下一级"}
                </button>
              )}
            </div>
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
            aria-labelledby="staff-game-wrong-answer-details-title"
            aria-modal="true"
            className="staff-game-wrong-answer-details"
            ref={detailsDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="关闭错音统计详情"
              className="staff-game-wrong-answer-details-close"
              onClick={() => setShowWrongAnswerDetails(false)}
              ref={detailsCloseButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={19} />
            </button>
            <h2 id="staff-game-wrong-answer-details-title">错音统计详情</h2>
            <p className="staff-game-wrong-answer-conclusion">
              {wrongAnswerRecords.length === 0 ? (
                "本局没有记录到错音。"
              ) : (
                <>
                  本局共记录 <strong>{wrongAnswerRecords.length}</strong> 次错音，涉及{" "}
                  <strong>{wrongAnswerGroups.length}</strong> 组音符。
                </>
              )}
            </p>
            <div className="staff-game-wrong-answer-table-wrap">
              <table className="staff-game-wrong-answer-table">
                <thead>
                  <tr>
                    <th scope="col">目标音</th>
                    <th scope="col">识别到的音</th>
                    <th scope="col">次数</th>
                  </tr>
                </thead>
                <tbody>
                  {wrongAnswerGroups.length > 0 ? (
                    wrongAnswerGroups.map((group) => (
                      <tr key={`${group.expectedNote}-${group.recognizedNote}`}>
                        <td>{group.expectedNote}</td>
                        <td>{group.recognizedNote}</td>
                        <td>{group.count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>没有错误音符记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </>,
    document.body
  );
}
