import { useState } from "react";
import { BarChart3, Keyboard, Mic, Music2, Play, Radio } from "lucide-react";
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
import {
  resolveSongPracticeTrack,
  type SongPracticeInputMode,
  type SongPracticeSelection,
  type SongPracticeTrackMode,
} from "../song-practice/songPracticeMaterials";
import { BUILT_IN_YE_QU_SCORE } from "../song-practice/yeQuScore";

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
  onStartSongPractice: (selection: SongPracticeSelection) => Promise<boolean>;
  onStartPausedReadingChange: (enabled: boolean) => void;
  onStartSession: () => void;
  onSetupTabChange: (tab: PracticeSetupTab) => void;
  onToggleDrillNoteName: (noteName: NoteName, checked: boolean) => void;
}

export type PracticeSetupTab = "free" | "songs";

interface PracticeSetupViewProps {
  activeTab: PracticeSetupTab;
  actions: PracticeSetupActions;
  fixedCountPresets: number[];
  isBusy: boolean;
  microphoneError: string | null;
  midi: Pick<MidiInputController, "connect" | "isConnected" | "selectedInput" | "status">;
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

const PROMPT_NOTE_DURATION_OPTIONS: Array<{
  ariaLabel: string;
  label: string;
  value: PromptNoteDuration;
}> = [
  { ariaLabel: "全音符", label: "全音符 𝅝", value: "whole" },
  { ariaLabel: "四分音符", label: "四分 ♩", value: "quarter" },
  { ariaLabel: "八分音符", label: "八分 ♪", value: "eighth" },
  { ariaLabel: "十六分音符", label: "十六分 𝅘𝅥𝅯", value: "sixteenth" },
];

const PRACTICE_QUEUE_OPTIONS: Array<{
  strategy: PracticeQueueStrategy;
  label: string;
  description: string;
}> = [
  {
    strategy: "adaptive",
    label: "自适应队列",
    description: "根据近期识别速度优先练习薄弱音，同时保持全音域复习。",
  },
  { strategy: "melody", label: "旋律生成", description: "在启用组音域内生成级进为主的练习" },
  {
    strategy: "note-drill",
    label: "单音强化",
    description: "只抽所选音名；仅选择一个音名时不写入统计",
  },
];

const SONG_TRACK_OPTIONS: Array<{
  id: SongPracticeTrackMode;
  label: string;
  detail: string;
}> = [
  { id: "treble", label: "只弹高音", detail: "上排旋律" },
  { id: "bass", label: "只弹低音", detail: "下排单音" },
  { id: "mixed", label: "混合", detail: "按谱面先后单音弹奏" },
];

export function PracticeSetupView({
  activeTab,
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
    onStartSongPractice,
    onStartPausedReadingChange,
    onStartSession: startSession,
    onSetupTabChange,
    onToggleDrillNoteName: toggleDrillNoteName,
  } = actions;
  const setupDisabled = setupDisabledReason !== undefined;
  const [songInputMode, setSongInputMode] = useState<SongPracticeInputMode>("virtual");
  const [songTrackMode, setSongTrackMode] = useState<SongPracticeTrackMode>("treble");
  const [isStartingSongPractice, setIsStartingSongPractice] = useState(false);
  const [songStartError, setSongStartError] = useState<string | null>(null);
  const resolvedSongTrack = resolveSongPracticeTrack(BUILT_IN_YE_QU_SCORE, songTrackMode);

  const selectSongTrackMode = (trackMode: SongPracticeTrackMode): void => {
    setSongTrackMode(trackMode);
    if (trackMode === "mixed" && songInputMode === "virtual") setSongInputMode("midi");
  };

  const startSongPractice = async (): Promise<void> => {
    if (resolvedSongTrack.notes.length === 0 || isStartingSongPractice) return;
    setSongStartError(null);
    setIsStartingSongPractice(true);
    try {
      const entered = await onStartSongPractice({
        inputMode: songInputMode,
        notes: resolvedSongTrack.notes,
        partName: resolvedSongTrack.partName,
        scoreTitle: BUILT_IN_YE_QU_SCORE.title,
        songId: "ye-qu",
        trackMode: songTrackMode,
        skippedBassNoteCount: resolvedSongTrack.skippedBassNoteCount,
      });
      if (!entered) setSongStartError("麦克风未能启动，请检查权限和输入设备后重试。");
    } catch (error) {
      setSongStartError(
        error instanceof Error ? error.message : "麦克风未能启动，请检查权限和输入设备后重试。"
      );
    } finally {
      setIsStartingSongPractice(false);
    }
  };

  return (
    <section className="practice-shell practice-setup-shell">
      <div aria-label="练习类型" className="practice-kind-tabs" role="tablist">
        <button
          aria-controls="practice-free-panel"
          aria-selected={activeTab === "free"}
          className={activeTab === "free" ? "is-active" : ""}
          disabled={isStartingSongPractice}
          id="practice-free-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("free")}
        >
          自由练习
        </button>
        <button
          aria-controls="practice-songs-panel"
          aria-selected={activeTab === "songs"}
          className={activeTab === "songs" ? "is-active" : ""}
          disabled={isStartingSongPractice}
          id="practice-songs-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("songs")}
        >
          歌曲
        </button>
      </div>
      <div
        className="practice-setup-tab-panel practice-free-tab-content"
        hidden={activeTab !== "free"}
        id="practice-free-panel"
        role="tabpanel"
        aria-labelledby="practice-free-tab"
      >
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
            <GlobalRangeControls settings={settings} onSettingsSaved={onSettingsSaved} />

            <div className="control-block">
              <span className="control-label">模式</span>
              <div className="segmented">
                <button
                  className={mode === "open-ended" ? "active" : ""}
                  onClick={() => setMode("open-ended")}
                >
                  无限
                </button>
                <button
                  className={mode === "fixed-count" ? "active" : ""}
                  onClick={() => setMode("fixed-count")}
                >
                  固定题数
                </button>
                <button
                  className={mode === "fixed-duration" ? "active" : ""}
                  onClick={() => setMode("fixed-duration")}
                >
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
                    <button
                      className={fixedCount === count ? "active" : ""}
                      key={count}
                      onClick={() => setFixedCount(count)}
                    >
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
                    onChange={(event) =>
                      setFixedDurationSeconds(inputMinutesToDurationSeconds(event.target.value))
                    }
                  />
                </div>
              </div>
            ) : null}

            <div className="control-block">
              <span className="control-label">训练策略</span>
              <div className="strategy-options">
                {PRACTICE_QUEUE_OPTIONS.map((option) => (
                  <label
                    aria-label={option.label}
                    className={
                      queueStrategy === option.strategy
                        ? "choice choice-active choice-detail"
                        : "choice choice-detail"
                    }
                    key={option.strategy}
                  >
                    <input
                      checked={queueStrategy === option.strategy}
                      name="practice-queue-strategy"
                      type="radio"
                      value={option.strategy}
                      onClick={(event) =>
                        blurQueueStrategyAfterPointerClick(event.currentTarget, event.detail)
                      }
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
                      <label
                        className={checked ? "choice choice-active" : "choice"}
                        key={button.noteName}
                      >
                        <input
                          checked={checked}
                          type="checkbox"
                          onChange={(event) =>
                            toggleDrillNoteName(button.noteName, event.target.checked)
                          }
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
                <span className="practice-microphone-error" role="status">
                  {microphoneError}
                </span>
              ) : null}
            </div>

            <div className="control-block">
              <span className="control-label">声音</span>
              <div className="practice-checkbox-options">
                <label
                  className={`practice-checkbox-option${answerPitchMode === "microphone" ? " is-disabled" : ""}`}
                  title={
                    answerPitchMode === "microphone" ? "disabled：麦克风模式下不可用" : undefined
                  }
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
                  title={
                    answerPitchMode === "microphone" ? "disabled：麦克风模式下不可用" : undefined
                  }
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
              <span className="practice-start-action" title={setupDisabledReason ?? undefined}>
                <button
                  aria-keyshortcuts="Enter"
                  aria-describedby={
                    setupDisabledReason ? "practice-start-disabled-reason" : undefined
                  }
                  className="primary"
                  disabled={setupDisabled || showStartingSessionStatus}
                  onClick={() => void startSession()}
                >
                  {showStartingSessionStatus ? (
                    "检查中"
                  ) : (
                    <>
                      <Play size={18} />
                      开始<kbd>Enter</kbd>
                      {midi.isConnected ? <kbd>C4</kbd> : null}
                    </>
                  )}
                </button>
                {setupDisabledReason ? (
                  <span
                    className="practice-start-tooltip"
                    id="practice-start-disabled-reason"
                    role="tooltip"
                  >
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
      </div>
      <div
        className="setup-grid practice-setup-tab-panel"
        hidden={activeTab !== "songs"}
        id="practice-songs-panel"
        role="tabpanel"
        aria-labelledby="practice-songs-tab"
      >
        <section className="panel setup-panel song-selection-panel">
          <div className="panel-heading">
            <div>
              <h1>歌曲练习</h1>
              <p className="song-practice-description">
                选择曲目和输入方式，按确认后进入整首谱面跟弹。
              </p>
            </div>
            <div className="practice-midi-heading-status">
              <span title={midi.selectedInput?.name}>
                {midi.isConnected ? `MIDI 已连接：${midi.selectedInput?.name}` : "MIDI 未连接"}
              </span>
              <button onClick={onOpenSettings}>设备设置</button>
            </div>
          </div>

          <div className="song-selection-section">
            <h2>选择歌曲</h2>
            <button aria-pressed="true" className="song-choice-card is-selected" type="button">
              <span className="song-choice-icon">
                <Music2 aria-hidden="true" size={20} />
              </span>
              <span className="song-choice-copy">
                <strong>夜曲</strong>
                <span>用户提供的四页谱面 · 高低音已整理</span>
              </span>
              <span className="song-choice-key">C 调单音</span>
            </button>
            <p className="song-loaded-part">
              已整理 {BUILT_IN_YE_QU_SCORE.parts[0].notes.length} 个高音和{" "}
              {BUILT_IN_YE_QU_SCORE.parts[1].notes.length} 个低音单音。
            </p>
          </div>

          <div className="song-selection-section">
            <h2>选择声部</h2>
            <div className="song-track-options" role="group" aria-label="歌曲声部">
              {SONG_TRACK_OPTIONS.map(({ id, label, detail }) => (
                <button
                  aria-pressed={songTrackMode === id}
                  className={`song-track-option${songTrackMode === id ? " is-selected" : ""}`}
                  disabled={isStartingSongPractice}
                  key={id}
                  type="button"
                  onClick={() => {
                    selectSongTrackMode(id);
                    setSongStartError(null);
                  }}
                >
                  <strong>{label}</strong>
                  <span>{detail}</span>
                  <small>
                    {resolveSongPracticeTrack(BUILT_IN_YE_QU_SCORE, id).notes.length} 个单音
                  </small>
                </button>
              ))}
            </div>
            <p className="song-score-conversion-note">
              {songTrackMode === "mixed"
                ? `混合时有 ${resolvedSongTrack.skippedBassNoteCount} 个低音与高音同拍，已略去低音；同一时刻只保留一个目标音。`
                : "原谱按级数转为 C 调自然音；歌词跟随高音旋律，伴奏和弦不练。"}
            </p>
          </div>

          <div className="song-selection-section">
            <h2>选择输入方式</h2>
            <div className="song-input-options" role="group" aria-label="歌曲输入方式">
              {(
                [
                  { icon: Keyboard, id: "virtual", label: "虚拟键盘", detail: "点击屏幕琴键" },
                  {
                    icon: Radio,
                    id: "midi",
                    label: "MIDI 键盘",
                    detail: midi.isConnected
                      ? (midi.selectedInput?.name ?? "已连接")
                      : "连接外接键盘",
                  },
                  { icon: Mic, id: "microphone", label: "麦克风", detail: "识别钢琴或键盘声音" },
                ] as const
              ).map(({ icon: Icon, id, label, detail }) => (
                <button
                  aria-pressed={songInputMode === id}
                  className={`song-input-option${songInputMode === id ? " is-selected" : ""}`}
                  disabled={
                    isStartingSongPractice || (songTrackMode === "mixed" && id === "virtual")
                  }
                  key={id}
                  type="button"
                  onClick={() => {
                    setSongInputMode(id);
                    setSongStartError(null);
                  }}
                >
                  <Icon aria-hidden="true" size={20} />
                  <strong>{label}</strong>
                  <span>
                    {songTrackMode === "mixed" && id === "virtual" ? "混合模式不可用" : detail}
                  </span>
                </button>
              ))}
            </div>
            {songInputMode === "midi" && !midi.isConnected ? (
              <button
                className="song-connect-midi"
                type="button"
                onClick={() => void midi.connect()}
              >
                连接 MIDI 键盘
              </button>
            ) : null}
            {songInputMode === "microphone" && (songStartError || microphoneError) ? (
              <div className="song-selection-error" role="status">
                {songStartError ? <p>{songStartError}</p> : null}
                {microphoneError && microphoneError !== songStartError ? (
                  <p>{microphoneError}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="song-selection-footer">
            <span>确认后进入谱面；弹完当前页会自动翻页。</span>
            <button
              className="primary"
              disabled={
                isStartingSongPractice ||
                resolvedSongTrack.notes.length === 0 ||
                (songInputMode === "midi" && !midi.isConnected)
              }
              type="button"
              onClick={() => void startSongPractice()}
            >
              {isStartingSongPractice
                ? songInputMode === "microphone"
                  ? "正在申请麦克风…"
                  : "正在进入练习…"
                : "确认并进入练习"}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
