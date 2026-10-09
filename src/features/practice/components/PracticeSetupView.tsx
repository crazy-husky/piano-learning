import { BarChart3, Play } from "lucide-react";
import type {
  AnswerPitchMode,
  AppSettings,
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PromptDisplayMode,
  PromptNoteDuration,
} from "../../../domain/types";
import { ANSWER_BUTTONS } from "../../../domain/notes";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";

export interface PracticeSetupUiPreferences {
  answerPitchMode: AnswerPitchMode;
  autoPlayTarget: boolean;
  playAnswerNote: boolean;
  drillNoteNames: NoteName[];
  fixedCount: number;
  fixedDurationSeconds: number;
  mode: PracticeMode;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  queueStrategy: PracticeQueueStrategy;
}

interface PracticeSetupActions {
  onAnswerPitchModeChange: (mode: AnswerPitchMode) => void;
  onAutoPlayTargetChange: (enabled: boolean) => void;
  onFixedCountChange: (count: number) => void;
  onFixedDurationSecondsChange: (seconds: number) => void;
  onModeChange: (mode: PracticeMode) => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  onPlayAnswerNoteChange: (enabled: boolean) => void;
  onPromptDisplayModeChange: (mode: PromptDisplayMode) => void;
  onPromptNoteDurationChange: (duration: PromptNoteDuration) => void;
  onQueueStrategyChange: (strategy: PracticeQueueStrategy) => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  onStartPausedReadingChange: (enabled: boolean) => void;
  onStartSession: () => void;
  onToggleDrillNoteName: (noteName: NoteName, checked: boolean) => void;
}

interface PracticeSetupViewProps {
  actions: PracticeSetupActions;
  fixedCountPresets: number[];
  isBusy: boolean;
  microphoneError: string | null;
  midi: Pick<MidiInputController, "isConnected" | "selectedInput">;
  preferences: PracticeSetupUiPreferences;
  setupDisabledReason?: string;
  startPausedReading: boolean;
  settings: AppSettings;
}

function durationSecondsToInputMinutes(seconds: number): string {
  return Number((seconds / 60).toFixed(2)).toString();
}

function inputMinutesToDurationSeconds(value: string): number {
  return Math.max(60, Math.round(Number(value) * 60));
}

function blurQueueStrategyAfterPointerClick(input: HTMLInputElement, clickCount: number): void {
  if (clickCount === 0) return;
  window.setTimeout(() => {
    if (document.activeElement === input) input.blur();
  }, 0);
}

const PROMPT_NOTE_DURATION_OPTIONS: Array<{ ariaLabel: string; label: string; value: PromptNoteDuration }> = [
  { ariaLabel: "全音符", label: "全音符 𝅝", value: "whole" },
  { ariaLabel: "四分音符", label: "四分 ♩", value: "quarter" },
  { ariaLabel: "八分音符", label: "八分 ♪", value: "eighth" },
  { ariaLabel: "十六分音符", label: "十六分 𝅘𝅥𝅯", value: "sixteenth" },
];

const PRACTICE_QUEUE_OPTIONS: Array<{ strategy: PracticeQueueStrategy; label: string; description: string }> = [
  { strategy: "adaptive", label: "自适应队列", description: "根据近期识别速度优先练习薄弱音，同时保持全音域复习。" },
  { strategy: "melody", label: "旋律生成", description: "在启用组音域内生成级进为主的练习" },
  { strategy: "note-drill", label: "单音强化", description: "只抽所选音名；仅选择一个音名时不写入统计" },
];

export function PracticeSetupView({
  actions,
  fixedCountPresets,
  isBusy: showStartingSessionStatus,
  microphoneError,
  midi,
  preferences,
  setupDisabledReason,
  startPausedReading,
  settings,
}: PracticeSetupViewProps): JSX.Element {
  const {
    answerPitchMode,
    autoPlayTarget,
    drillNoteNames,
    fixedCount,
    fixedDurationSeconds,
    mode,
    playAnswerNote,
    promptDisplayMode,
    promptNoteDuration,
    queueStrategy,
  } = preferences;
  const {
    onAnswerPitchModeChange: setAnswerPitchMode,
    onAutoPlayTargetChange: setAutoPlayTarget,
    onFixedCountChange: setFixedCount,
    onFixedDurationSecondsChange: setFixedDurationSeconds,
    onModeChange: setMode,
    onOpenSettings,
    onOpenStats,
    onPlayAnswerNoteChange: setPlayAnswerNote,
    onPromptDisplayModeChange: setPromptDisplayMode,
    onPromptNoteDurationChange: setPromptNoteDuration,
    onQueueStrategyChange: setQueueStrategy,
    onSettingsSaved,
    onStartPausedReadingChange,
    onStartSession: startSession,
    onToggleDrillNoteName: toggleDrillNoteName,
  } = actions;
  const setupDisabled = setupDisabledReason !== undefined;

  return (
      <section className="practice-shell practice-setup-shell">
        <GlobalRangeControls settings={settings} onSettingsSaved={onSettingsSaved} />
        <div className="setup-grid">
          <div className="panel setup-panel">
            <div className="panel-heading">
              <h1>识谱视奏</h1>
              <div className="practice-setup-heading-meta">
                <div className="practice-midi-heading-status">
                  <span title={midi.selectedInput?.name}>
                    {midi.isConnected ? `MIDI 已连接：${midi.selectedInput?.name}` : "MIDI 未连接"}
                  </span>
                  <button onClick={onOpenSettings}>设备设置</button>
                </div>
              </div>
            </div>

            <div className="control-block">
              <span className="control-label">模式</span>
              <div className="segmented">
                <button className={mode === "open-ended" ? "active" : ""} onClick={() => setMode("open-ended")}>
                  无限
                </button>
                <button className={mode === "fixed-count" ? "active" : ""} onClick={() => setMode("fixed-count")}>
                  固定题数
                </button>
                <button className={mode === "fixed-duration" ? "active" : ""} onClick={() => setMode("fixed-duration")}>
                  固定时长
                </button>
              </div>
            </div>

            <div className="control-block">
              <span className="control-label">显示方式</span>
              <div className="display-options">
                <div className="segmented">
                  <button
                    className={promptDisplayMode === "single-note" ? "active" : ""}
                    onClick={() => setPromptDisplayMode("single-note")}
                  >
                    单音
                  </button>
                  <button
                    className={promptDisplayMode === "staff-page" ? "active" : ""}
                    onClick={() => setPromptDisplayMode("staff-page")}
                  >
                    谱页
                  </button>
                </div>
                <div className="segmented prompt-note-duration-options">
                  {PROMPT_NOTE_DURATION_OPTIONS.map((option) => (
                    <button
                      aria-label={option.ariaLabel}
                      className={promptNoteDuration === option.value ? "active" : ""}
                      key={option.value}
                      onClick={() => setPromptNoteDuration(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {promptDisplayMode === "staff-page" ? (
              <div className="control-block">
                <span className="control-label">谱页选项</span>
                <label className="practice-checkbox-option">
                  <input
                    checked={startPausedReading}
                    type="checkbox"
                    onChange={(event) => onStartPausedReadingChange(event.target.checked)}
                  />
                  <span>开始后暂停（读谱）</span>
                </label>
              </div>
            ) : null}

            {mode === "fixed-count" ? (
              <div className="control-block">
                <span className="control-label">题数</span>
                <div className="number-row">
                  {fixedCountPresets.map((count) => (
                    <button className={fixedCount === count ? "active" : ""} key={count} onClick={() => setFixedCount(count)}>
                      {count}
                    </button>
                  ))}
                  <input
                    min={1}
                    max={500}
                    type="number"
                    value={fixedCount}
                    onChange={(event) => setFixedCount(Math.max(1, Number(event.target.value)))}
                  />
                </div>
              </div>
            ) : null}

            {mode === "fixed-duration" ? (
              <div className="control-block">
                <span className="control-label">时长</span>
                <div className="number-row practice-duration-row">
                  {[60, 120, 180, 300].map((seconds) => (
                    <button
                      className={fixedDurationSeconds === seconds ? "active" : ""}
                      key={seconds}
                      onClick={() => setFixedDurationSeconds(seconds)}
                    >
                      {seconds / 60} 分钟
                    </button>
                  ))}
                  <input
                    min={1}
                    max={120}
                    step={0.5}
                    type="number"
                    value={durationSecondsToInputMinutes(fixedDurationSeconds)}
                    onChange={(event) => setFixedDurationSeconds(inputMinutesToDurationSeconds(event.target.value))}
                  />
                </div>
              </div>
            ) : null}

            <div className="control-block">
              <span className="control-label">训练策略</span>
              <div className="strategy-options">
                {PRACTICE_QUEUE_OPTIONS.map((option) => (
                  <label
                    className={queueStrategy === option.strategy ? "choice choice-active choice-detail" : "choice choice-detail"}
                    key={option.strategy}
                  >
                    <input
                      checked={queueStrategy === option.strategy}
                      name="practice-queue-strategy"
                      type="radio"
                      value={option.strategy}
                      onClick={(event) => blurQueueStrategyAfterPointerClick(event.currentTarget, event.detail)}
                      onChange={() => setQueueStrategy(option.strategy)}
                    />
                    <div className="choice-body">
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {queueStrategy === "note-drill" ? (
              <div className="control-block">
                <span className="control-label">强化音名</span>
                <div className="note-name-options">
                  {ANSWER_BUTTONS.map((button) => {
                    const checked = drillNoteNames.includes(button.noteName);
                    return (
                      <label className={checked ? "choice choice-active" : "choice"} key={button.noteName}>
                        <input
                          checked={checked}
                          type="checkbox"
                          onChange={(event) => toggleDrillNoteName(button.noteName, event.target.checked)}
                        />
                        <span>{button.noteName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="control-block">
              <span className="control-label">答题方式</span>
              <div className="display-options">
                <div className="segmented">
                  <button
                    className={answerPitchMode === "note-name" ? "active" : ""}
                    onClick={() => setAnswerPitchMode("note-name")}
                  >
                    只认音名
                  </button>
                  <button
                    className={answerPitchMode === "exact-pitch" ? "active" : ""}
                    disabled={!midi.isConnected}
                    title={!midi.isConnected ? "需要连接 MIDI 设备" : undefined}
                    onClick={() => setAnswerPitchMode("exact-pitch")}
                  >
                    MIDI 精确音高
                  </button>
                  <button
                    className={answerPitchMode === "microphone" ? "active" : ""}
                    onClick={() => setAnswerPitchMode("microphone")}
                  >
                    麦克风单音
                  </button>
                </div>
                <span className="practice-answer-mode-description">
                  {answerPitchMode === "note-name"
                    ? "键盘、屏幕琴键和 MIDI 只需音名正确，不限八度"
                    : answerPitchMode === "microphone"
                      ? "开始练习时请求麦克风权限；识别 F1–G6 自然音并核对八度"
                      : "仅 MIDI 可作答，必须与谱面八度一致"}
                </span>
              </div>
              {answerPitchMode === "microphone" && microphoneError ? (
                <span className="practice-microphone-error" role="status">{microphoneError}</span>
              ) : null}
            </div>

            <div className="control-block">
              <span className="control-label">声音</span>
              <div className="practice-checkbox-options">
                <label
                  className={`practice-checkbox-option${answerPitchMode === "microphone" ? " is-disabled" : ""}`}
                  title={answerPitchMode === "microphone" ? "disabled：麦克风模式下不可用" : undefined}
                >
                  <input
                    checked={answerPitchMode === "microphone" ? false : autoPlayTarget}
                    disabled={answerPitchMode === "microphone"}
                    type="checkbox"
                    onChange={(event) => setAutoPlayTarget(event.target.checked)}
                  />
                  <span>自动播放目标音</span>
                </label>
                <label
                  className={`practice-checkbox-option${answerPitchMode === "microphone" ? " is-disabled" : ""}`}
                  title={answerPitchMode === "microphone" ? "disabled：麦克风模式下不可用" : undefined}
                >
                  <input
                    checked={answerPitchMode === "microphone" ? false : playAnswerNote}
                    disabled={answerPitchMode === "microphone"}
                    type="checkbox"
                    onChange={(event) => setPlayAnswerNote(event.target.checked)}
                  />
                  <span>按键时播放声音</span>
                </label>
              </div>
              {answerPitchMode === "microphone" ? (
                <span className="practice-answer-mode-description practice-microphone-sound-note">
                  麦克风模式不播放应用提示音，避免把提示音识别成弹奏。
                </span>
              ) : null}
            </div>

            <div className="action-row">
              <span className="practice-start-action" tabIndex={setupDisabled ? 0 : undefined}>
                <button
                  aria-keyshortcuts="Enter"
                  className="primary"
                  disabled={setupDisabled || showStartingSessionStatus}
                  onClick={() => void startSession()}
                >
                  {showStartingSessionStatus ? (
                    "检查中"
                  ) : (
                    <>
                      <Play size={18} />
                      开始<kbd>Enter</kbd>{midi.isConnected ? <kbd>C4</kbd> : null}
                    </>
                  )}
                </button>
                {setupDisabledReason ? (
                  <span className="practice-start-tooltip" role="tooltip">
                    {setupDisabledReason}
                  </span>
                ) : null}
              </span>
              <button onClick={onOpenStats}>
                <BarChart3 size={18} />
                统计
              </button>
            </div>
          </div>
        </div>
      </section>
  );
}
