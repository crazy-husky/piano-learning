import { Mic, Music2, Play, RotateCcw, Sparkles } from "lucide-react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";

interface StaffGameStatusOverlaysProps {
  gameError: string;
  isMidiInput: boolean;
  gameArtStyle: CSSProperties;
  isStarting: boolean;
  showLowFpsPrompt: boolean;
  showPauseDialog: boolean;
  gameEffectsEnabled: boolean;
  touchGameLayout: boolean;
  onDismissInputError: () => void;
  onRetryInput: () => void;
  onKeepEffects: () => void;
  onDisableEffects: () => void;
  onResume: () => void;
  onRetryLevel: () => void;
}

export function StaffGameErrorFlash({ active }: { active: boolean }) {
  return active ? <div aria-hidden="true" className="staff-game-error-flash" /> : null;
}

export function StaffGameStatusOverlays({
  gameError,
  isMidiInput,
  gameArtStyle,
  isStarting,
  showLowFpsPrompt,
  showPauseDialog,
  gameEffectsEnabled,
  touchGameLayout,
  onDismissInputError,
  onRetryInput,
  onKeepEffects,
  onDisableEffects,
  onResume,
  onRetryLevel,
}: StaffGameStatusOverlaysProps) {
  return (
    <>
        {gameError && typeof document !== "undefined" ? createPortal(
          <div className="staff-game-mic-dialog-backdrop" style={gameArtStyle}>
            <section aria-labelledby="staff-game-mic-dialog-title" aria-modal="true" className="staff-game-mic-dialog" role="alertdialog">
              <span className="staff-game-mic-dialog-icon">{isMidiInput ? <Music2 aria-hidden="true" size={22} /> : <Mic aria-hidden="true" size={22} />}</span>
              <h2 id="staff-game-mic-dialog-title">{isMidiInput ? "需要连接 MIDI 键盘" : "需要开启麦克风"}</h2>
              <p>{gameError}</p>
              <div className="staff-game-summary-actions">
                <button className="staff-game-secondary" onClick={onDismissInputError} type="button">稍后处理</button>
                <button className="staff-game-primary" disabled={isStarting} onClick={onRetryInput} type="button">
                  {isStarting ? "正在连接…" : "重新尝试"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        ) : null}
      {showLowFpsPrompt && typeof document !== "undefined" ? createPortal(
        <div className="staff-game-low-fps-backdrop">
          <section aria-labelledby="staff-game-low-fps-title" aria-modal="true" className="staff-game-low-fps-dialog" role="alertdialog">
            <Sparkles aria-hidden="true" className="staff-game-low-fps-icon" size={34} />
            <h2 id="staff-game-low-fps-title">检测到页面有些卡顿</h2>
            <p>最近几秒帧率低于 28 FPS。关闭粒子、流星和烟花等特效，可能会让游戏更流畅。</p>
            <div className="staff-game-low-fps-actions">
              <button className="staff-game-secondary" onClick={onKeepEffects} type="button">保持特效</button>
              <button className="staff-game-primary" onClick={onDisableEffects} type="button">关闭特效</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
      {showPauseDialog && typeof document !== "undefined" ? createPortal(
        <div className="staff-game-pause-backdrop" style={gameArtStyle}>
          <section aria-labelledby="staff-game-pause-title" aria-modal="true" className="staff-game-pause-dialog" role="dialog">
            <div aria-hidden="true" className={`staff-game-pause-clock${gameEffectsEnabled ? " is-animated" : ""}`}>
              <div className="staff-game-pause-clock-face">
                <span className="staff-game-pause-clock-hand is-hour" />
                <span className="staff-game-pause-clock-hand is-minute" />
                <span className="staff-game-pause-clock-pin" />
              </div>
            </div>
            <div aria-live="polite" className={`staff-game-pause-label${gameEffectsEnabled ? " is-animated" : ""}`}>
              <strong id="staff-game-pause-title">{touchGameLayout ? "暂停中.." : "暂停中，点击按钮或者按空格键继续。"}</strong>
            </div>
            <div className="staff-game-pause-actions">
              <button className="staff-game-primary" disabled={isStarting} onClick={onResume} type="button">
                <Play aria-hidden="true" fill="currentColor" size={20} />继续
              </button>
              <button className="staff-game-secondary" disabled={isStarting} onClick={onRetryLevel} type="button">
                <RotateCcw aria-hidden="true" size={20} />重新开始
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
