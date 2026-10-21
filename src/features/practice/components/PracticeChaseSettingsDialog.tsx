import { useEffect, useRef, useState } from "react";
import type { ChaseHandMode } from "../logic/scoreChase";
import { SCORE_CHASE_SPEED_OPTIONS } from "../logic/scoreChase";

export interface PracticeChaseSettings {
  enabled: boolean;
  handMode: ChaseHandMode;
  speedMultiplier: number;
  startCount: number;
}

interface PracticeChaseSettingsDialogProps {
  isMidiConnected: boolean;
  isOpen: boolean;
  hideHandMode?: boolean;
  mode?: "distance" | "free" | "song";
  settings: PracticeChaseSettings;
  onClose: () => void;
  onSave: (settings: PracticeChaseSettings) => void;
}

const HAND_OPTIONS: readonly { value: ChaseHandMode; label: string }[] = [
  { value: "left", label: "左手" },
  { value: "right", label: "右手" },
  { value: "both", label: "双手" },
];

export function PracticeChaseSettingsDialog({
  isMidiConnected,
  isOpen,
  hideHandMode = false,
  mode = "song",
  settings,
  onClose,
  onSave,
}: PracticeChaseSettingsDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState(settings);
  const [startCountInput, setStartCountInput] = useState(String(settings.startCount));
  const { enabled, handMode, speedMultiplier, startCount } = settings;

  const normalizedStartCount = (): number =>
    Math.max(2, Math.min(12, Math.trunc(Number(startCountInput) || 2)));
  const closeDialog = (): void => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen) {
      setDraft({ enabled, handMode, speedMultiplier, startCount });
      setStartCountInput(String(startCount));
      if (dialog && !dialog.open) dialog.showModal();
    } else if (dialog?.open) {
      dialog.close();
    }
  }, [enabled, handMode, isOpen, speedMultiplier, startCount]);

  return (
    <dialog
      aria-labelledby="song-chase-title"
      className="song-chase-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <form
        className="song-chase-dialog-content"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...draft, startCount: normalizedStartCount() });
          closeDialog();
        }}
      >
        <header className="song-chase-dialog-header">
          <div>
            <h2 id="song-chase-title">追逐游戏设置</h2>
            <p>
              {mode === "free"
                ? "答够目标数，小光点就出发追你啦！长音短音都一样，一步一个节奏。"
                : mode === "distance"
                  ? "弹着谱面往前走，小光点也会跟上来；答对够数，它就出发啦！"
                  : "答够目标数，小光点就沿着乐谱追过来，看看它能不能追上你！"}
            </p>
          </div>
          <button
            aria-label="关闭设置"
            className="song-chase-dialog-close"
            type="button"
            onClick={closeDialog}
          >
            ×
          </button>
        </header>

        <label aria-label="开启追赶" className="song-chase-enable-row" htmlFor="song-chase-enabled">
          <input
            checked={draft.enabled}
            id="song-chase-enabled"
            type="checkbox"
            onChange={(event) =>
              setDraft((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          <span>
            <strong>开启追赶</strong>
            <small>光点追上已弹奏的音符后，会播放落点反馈并等待下一轮。</small>
          </span>
        </label>

        {!hideHandMode ? (
          <fieldset className="song-chase-setting-group" disabled={!draft.enabled}>
            <legend>练习手别</legend>
            <div aria-label="追赶手别" className="song-chase-choice-row" role="group">
              {HAND_OPTIONS.map(({ value, label }) => (
                <button
                  aria-pressed={draft.handMode === value}
                  className={draft.handMode === value ? "is-active" : ""}
                  disabled={mode === "song" && value === "both" && !isMidiConnected}
                  key={value}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, handMode: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "song" && draft.handMode === "both" && !isMidiConnected ? (
              <small className="song-chase-hint">双手练习需要连接 MIDI 键盘。</small>
            ) : null}
          </fieldset>
        ) : null}

        <label className="song-chase-setting-group" htmlFor="song-chase-speed">
          <span className="song-chase-setting-label">
            <strong>追赶速度</strong>
            <span>{draft.speedMultiplier}×</span>
          </span>
          <input
            disabled={!draft.enabled}
            id="song-chase-speed"
            max={SCORE_CHASE_SPEED_OPTIONS.length - 1}
            min={0}
            step={1}
            type="range"
            value={SCORE_CHASE_SPEED_OPTIONS.indexOf(
              draft.speedMultiplier as (typeof SCORE_CHASE_SPEED_OPTIONS)[number]
            )}
            onChange={(event) => {
              const speedMultiplier = SCORE_CHASE_SPEED_OPTIONS[Number(event.target.value)] ?? 0.5;
              setDraft((current) => ({ ...current, speedMultiplier }));
            }}
          />
          <small>
            {mode === "free"
              ? "不管音符长短，小光点每一步都走得一样快。"
              : mode === "distance"
                ? "每答对一个目标，小光点就往前走一步。"
                : "按谱面节拍移动；双手各自跟随本声部的音符间隔。"}
          </small>
        </label>

        <label className="song-chase-start-count" htmlFor="song-chase-start-count">
          <span>开始追赶前答对</span>
          <input
            disabled={!draft.enabled}
            id="song-chase-start-count"
            max={12}
            min={2}
            type="number"
            value={startCountInput}
            onBlur={() => {
              const nextStartCount = normalizedStartCount();
              setStartCountInput(String(nextStartCount));
              setDraft((current) => ({ ...current, startCount: nextStartCount }));
            }}
            onChange={(event) => setStartCountInput(event.target.value)}
          />
          <span>个目标</span>
        </label>

        <p className="song-chase-dialog-note">白天和夜间都能玩，光点会跟着页面主题换颜色。</p>

        <footer className="song-chase-dialog-actions">
          <button className="song-chase-cancel" type="button" onClick={closeDialog}>
            取消
          </button>
          <button className="song-chase-save" type="submit">
            保存设置
          </button>
        </footer>
      </form>
    </dialog>
  );
}
