import { Pause, Play } from "lucide-react";
import { PausedPlaybackBpmInput } from "./PausedPlaybackBpmInput";
import type { RemainingPlaybackState } from "./remainingNotePlayback";

interface PauseOverlayProps {
  bpm?: number;
  onBpmChange?: (bpm: number) => void;
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
  onResume,
  onToggleRemainingPlayback,
  playbackState = "idle",
  resumeBlockedMessage,
  resumeMessage,
  showKeyboardShortcuts = true,
  showRemainingPlayback = false,
}: PauseOverlayProps): JSX.Element {
  const playbackLabel =
    playbackState === "playing" ? "暂停播放" : playbackState === "paused" ? "继续播放" : "播放剩余";

  return (
    <div
      aria-label="练习已暂停"
      aria-modal="true"
      className="pause-overlay"
      onClick={(event) => {
        if (event.currentTarget === event.target && !resumeBlockedMessage) {
          onResume();
        }
      }}
      role="dialog"
    >
      <div className="pause-overlay-content">
        <span>已暂停</span>
        {showRemainingPlayback ? (
          <div className="pause-playback-controls">
            <button onClick={onToggleRemainingPlayback} type="button">
              {playbackState === "playing" ? <Pause size={18} /> : <Play size={18} />}
              {playbackLabel}
            </button>
            <label>
              BPM
              <PausedPlaybackBpmInput onChange={(value) => onBpmChange?.(value)} value={bpm ?? 100} />
            </label>
          </div>
        ) : null}
        <small>
          {resumeBlockedMessage ?? resumeMessage ?? (
            showKeyboardShortcuts
              ? "按空格或点击空白处继续练习 · 按 Esc 退出练习"
              : "点击空白处继续练习"
          )}
        </small>
      </div>
    </div>
  );
}
