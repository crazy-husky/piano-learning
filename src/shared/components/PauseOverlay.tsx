import { useId } from "react";
import { Pause, Play } from "lucide-react";
import { PausedPlaybackBpmInput } from "./PausedPlaybackBpmInput";
import type { RemainingPlaybackState } from "../playback/remainingNotePlayback";

interface PauseOverlayProps {
  bpm?: number;
  onBpmChange?: (bpm: number) => void;
  onExit?: () => void;
  onResume: () => void;
  onToggleRemainingPlayback?: () => void;
  playbackState?: RemainingPlaybackState;
  resumeBlockedMessage?: string;
  resumeMessage?: string;
  showKeyboardShortcuts?: boolean;
  showRemainingPlayback?: boolean;
}

export function PauseOverlay({
  bpm,
  onBpmChange,
  onExit,
  onResume,
  onToggleRemainingPlayback,
  playbackState = "idle",
  resumeBlockedMessage,
  resumeMessage,
  showKeyboardShortcuts = true,
  showRemainingPlayback = false,
}: PauseOverlayProps): JSX.Element {
  const bpmInputId = useId();
  const playbackLabel =
    playbackState === "playing" ? "暂停播放" : playbackState === "paused" ? "继续播放" : "播放剩余";

  return (
    <div aria-label="练习已暂停" aria-modal="true" className="pause-overlay" role="dialog">
      <button
        aria-label="点击空白处继续练习"
        className="pause-overlay-backdrop"
        disabled={Boolean(resumeBlockedMessage)}
        onClick={onResume}
        type="button"
      />
      <div className="pause-overlay-content">
        <span>已暂停</span>
        {showRemainingPlayback ? (
          <div className="pause-playback-controls">
            <button onClick={onToggleRemainingPlayback} type="button">
              {playbackState === "playing" ? <Pause size={18} /> : <Play size={18} />}
              {playbackLabel}
            </button>
            <label htmlFor={bpmInputId}>
              BPM
              <PausedPlaybackBpmInput
                id={bpmInputId}
                onChange={(value) => onBpmChange?.(value)}
                value={bpm ?? 100}
              />
            </label>
          </div>
        ) : null}
        <small>
          {resumeBlockedMessage ??
            resumeMessage ??
            (showKeyboardShortcuts
              ? "按空格或点击空白处继续练习 · 按 Esc 退出练习"
              : "点击空白处或下方按钮继续练习")}
        </small>
        {!showKeyboardShortcuts ? (
          <div className="pause-overlay-touch-actions">
            {onExit ? (
              <button className="pause-overlay-exit" onClick={onExit} type="button">
                退出练习
              </button>
            ) : null}
            <button
              className="pause-overlay-resume"
              disabled={Boolean(resumeBlockedMessage)}
              onClick={onResume}
              type="button"
            >
              继续练习
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
