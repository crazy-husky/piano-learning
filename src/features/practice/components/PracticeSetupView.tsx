import { useState, type ReactNode } from "react";
import { BarChart3, Music2, Play } from "lucide-react";
import { toast } from "sonner";
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
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import {
  resolveSongPracticeArrangement,
  type SongPracticeHandMode,
  type SongPracticeKeyVersion,
  type SongPracticeSelection,
} from "../song-practice/songPracticeMaterials";
import {
  BUILT_IN_SONG_PRACTICE_SCORES,
  getBuiltInSongPracticeScore,
  getSongPracticeScore,
} from "../song-practice/songPracticeCatalog";
import {
  DEFAULT_SONG_PRACTICE_UI_PREFERENCES,
  parseSongPracticeUiPreferences,
  SONG_PRACTICE_UI_PREFERENCES_KEY,
} from "../song-practice/songPracticePreferences";

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
  promptNoteDurations: PromptNoteDuration[];
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
  onPromptNoteDurationsChange: (durations: PromptNoteDuration[]) => void;
  onQueueStrategyChange: (strategy: PracticeQueueStrategy) => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  onStartSongPractice: (selection: SongPracticeSelection) => Promise<boolean>;
  onStartPausedReadingChange: (enabled: boolean) => void;
  onStartSession: () => void;
  onSetupTabChange: (tab: PracticeSetupTab) => void;
  onToggleDrillNoteName: (noteName: NoteName, checked: boolean) => void;
}

export type PracticeSetupTab = "free" | "distance" | "songs";

interface PracticeSetupViewProps {
  activeTab: PracticeSetupTab;
  actions: PracticeSetupActions;
  distanceContent: ReactNode;
  distanceStageActive: boolean;
  fixedCountPresets: number[];
  isBusy: boolean;
  microphoneError: string | null;
  midi: Pick<MidiInputController, "isConnected" | "selectedInput">;
  overlay?: ReactNode;
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

const SONG_HAND_OPTIONS: Array<{
  id: SongPracticeHandMode;
  label: string;
  detail: string;
}> = [
  {
    id: "right",
    label: "右手",
    detail: "只练高音声部，按 MIDI 音高逐个作答。",
  },
  {
    id: "left",
    label: "左手",
    detail: "只练低音声部，按 MIDI 音高逐个作答。",
  },
  {
    id: "both",
    label: "混弹",
    detail: "左右手按原时间位置合并，同时音和和弦需一起弹出。",
  },
];

const SONG_KEY_OPTIONS: Array<{
  id: Exclude<SongPracticeKeyVersion, "source">;
  label: string;
  detail: string;
}> = [
  { id: "c", label: "C 调简单版", detail: "使用你提供的 C 调 MIDI 原始事件。" },
  { id: "original", label: "原调完整版", detail: "使用原调 MIDI 原始事件，保留升降音与完整声部。" },
];

export function PracticeSetupView({
  activeTab,
  actions,
  distanceContent,
  distanceStageActive,
  fixedCountPresets,
  isBusy: showStartingSessionStatus,
  microphoneError,
  midi,
  overlay,
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
    promptNoteDurations,
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
    onPromptNoteDurationsChange: setPromptNoteDurations,
    onQueueStrategyChange: setQueueStrategy,
    onSettingsSaved,
    onStartSongPractice,
    onStartPausedReadingChange,
    onStartSession: startSession,
    onSetupTabChange,
    onToggleDrillNoteName: toggleDrillNoteName,
  } = actions;
  const setupDisabled = setupDisabledReason !== undefined;
  const [songPreferences, setSongPreferences] = useLocalStorageState(
    SONG_PRACTICE_UI_PREFERENCES_KEY,
    DEFAULT_SONG_PRACTICE_UI_PREFERENCES,
    { parse: parseSongPracticeUiPreferences }
  );
  const { selectedSongId, keyVersion: songKeyVersion, handMode: songHandMode } = songPreferences;
  const updateSongPreferences = (
    update: Partial<typeof DEFAULT_SONG_PRACTICE_UI_PREFERENCES>
  ): void => setSongPreferences((current) => ({ ...current, ...update }));
  const [isStartingSongPractice, setIsStartingSongPractice] = useState(false);
  const [songStartError, setSongStartError] = useState<string | null>(null);
  const isMidiSong = selectedSongId === "cong-cong-na-nian" || selectedSongId === "always-with-me";
  const selectedScore = isMidiSong
    ? getSongPracticeScore(selectedSongId, songKeyVersion)
    : getBuiltInSongPracticeScore(selectedSongId);
  const activeHandMode = songHandMode === "both" && !midi.isConnected ? "right" : songHandMode;
  const resolvedArrangement = resolveSongPracticeArrangement(selectedScore, activeHandMode);
  const simultaneousTargetCount = resolvedArrangement.targets.filter(
    (target) => target.notes.length > 1
  ).length;
  const requiresMidi = songHandMode === "both";
  const preferredInputMode = midi.isConnected ? "midi" : "microphone";
  const activeInputMode = preferredInputMode;
  const showSongArrangementWarning =
    (requiresMidi && !midi.isConnected) ||
    (activeInputMode === "microphone" && simultaneousTargetCount > 0);

  const startSongPractice = async (): Promise<void> => {
    if (requiresMidi && !midi.isConnected) {
      setSongStartError(null);
      toast.error("混弹需要连接 MIDI 键盘，请连接后再进入练习。", { duration: 3500 });
      return;
    }
    if (isStartingSongPractice) {
      setSongStartError("正在进入练习，请稍候。");
      return;
    }
    if (resolvedArrangement.targets.length === 0) {
      setSongStartError("这首曲目暂无可练习音符。");
      return;
    }
    setSongStartError(null);
    setIsStartingSongPractice(true);
    try {
      const entered = await onStartSongPractice({
        handMode: songHandMode,
        inputMode: activeInputMode,
        keyVersion: isMidiSong ? songKeyVersion : "source",
        preferredInputMode,
        score: selectedScore,
        songId: isMidiSong ? selectedSongId : selectedScore.id,
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
          disabled={distanceStageActive || isStartingSongPractice}
          id="practice-free-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("free")}
        >
          自由练习
        </button>
        <button
          aria-controls="practice-distance-panel"
          aria-selected={activeTab === "distance"}
          className={activeTab === "distance" ? "is-active" : ""}
          disabled={distanceStageActive || isStartingSongPractice}
          id="practice-distance-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("distance")}
        >
          间距推导
        </button>
        <button
          aria-controls="practice-songs-panel"
          aria-selected={activeTab === "songs"}
          className={activeTab === "songs" ? "is-active" : ""}
          disabled={distanceStageActive || isStartingSongPractice}
          id="practice-songs-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("songs")}
        >
          歌曲
        </button>
      </div>
      <div
        className="practice-setup-tab-panel"
        hidden={activeTab !== "distance"}
        id="practice-distance-panel"
        role="tabpanel"
        aria-labelledby="practice-distance-tab"
      >
        {distanceContent}
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
              <div>
                <h1>自由练习</h1>
                <p className="practice-panel-description">
                  看到音符后，快速识别音高并找到对应琴键。
                </p>
              </div>
              <div className="practice-setup-heading-meta">
                <div className="practice-midi-heading-status">
                  <span title={midi.selectedInput?.name}>
                    {midi.isConnected ? `MIDI 已连接：${midi.selectedInput?.name}` : "MIDI 未连接"}
                  </span>
                  <button onClick={onOpenSettings}>设备设置</button>
                </div>
              </div>
            </div>
            <GlobalRangeControls
              allowInterStaffLedgerChoice={false}
              settings={settings}
              onSettingsSaved={onSettingsSaved}
            />

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
                    disabled={promptNoteDurations.length > 1}
                    onClick={() => setPromptDisplayMode("single-note")}
                    title={promptNoteDurations.length > 1 ? "多选时值需要使用谱页展示" : undefined}
                    type="button"
                  >
                    单音
                  </button>
                  <button
                    className={promptDisplayMode === "staff-page" ? "active" : ""}
                    onClick={() => setPromptDisplayMode("staff-page")}
                    type="button"
                  >
                    谱页
                  </button>
                </div>
                <div className="segmented prompt-note-duration-options">
                  {PROMPT_NOTE_DURATION_OPTIONS.map((option) => (
                    <button
                      aria-pressed={promptNoteDurations.includes(option.value)}
                      aria-label={option.ariaLabel}
                      className={promptNoteDurations.includes(option.value) ? "active" : ""}
                      key={option.value}
                      onClick={() => {
                        const selected = new Set(promptNoteDurations);
                        if (selected.has(option.value)) {
                          if (selected.size === 1) return;
                          selected.delete(option.value);
                        } else {
                          selected.add(option.value);
                        }
                        setPromptNoteDurations(
                          PROMPT_NOTE_DURATION_OPTIONS.map((item) => item.value).filter((value) =>
                            selected.has(value)
                          )
                        );
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {promptNoteDurations.length > 1 ? (
                  <small>多选后按混合节奏显示连续谱面，仍逐音答题。</small>
                ) : null}
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
              <p className="practice-panel-description song-practice-description">
                选择熟悉的旋律，跟随谱面练习读谱与弹奏。
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
            <div className="song-choice-list">
              {BUILT_IN_SONG_PRACTICE_SCORES.map((score) => {
                const isSelected = selectedSongId === score.id;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`song-choice-card${isSelected ? " is-selected" : ""}`}
                    disabled={isStartingSongPractice}
                    key={score.id}
                    type="button"
                    onClick={() => {
                      updateSongPreferences({ selectedSongId: score.id });
                      setSongStartError(null);
                    }}
                  >
                    <span className="song-choice-icon">
                      <Music2 aria-hidden="true" size={20} />
                    </span>
                    <span className="song-choice-copy">
                      <strong>{score.title}</strong>
                      <span>
                        {score.source.pageCount ? `${score.source.pageCount} 页谱图 · ` : ""}
                        {score.parts.length} 个声部
                      </span>
                    </span>
                    <span className="song-choice-key">
                      {score.source.originalKey.replace(/ major| minor/, "")} 调
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="song-loaded-part">
              当前版本含右手{" "}
              {selectedScore.parts.find((part) => part.id === "treble")?.notes.length ?? 0}{" "}
              个音符事件、左手{" "}
              {selectedScore.parts.find((part) => part.id === "bass")?.notes.length ?? 0}{" "}
              个音符事件；不移调、不合并或删除原 MIDI 音符。
            </p>
          </div>

          {isMidiSong ? (
            <div className="song-selection-section">
              <h2>选择调性版本</h2>
              <div
                className="song-track-options"
                role="group"
                aria-label={`${selectedScore.title}调性版本`}
              >
                {SONG_KEY_OPTIONS.map(({ id, label, detail }) => {
                  const versionScore = getSongPracticeScore(selectedSongId, id);
                  const versionArrangement = resolveSongPracticeArrangement(
                    versionScore,
                    songHandMode
                  );
                  return (
                    <button
                      aria-pressed={songKeyVersion === id}
                      className={`song-track-option${songKeyVersion === id ? " is-selected" : ""}`}
                      disabled={isStartingSongPractice}
                      key={id}
                      type="button"
                      onClick={() => {
                        updateSongPreferences({ keyVersion: id });
                        setSongStartError(null);
                      }}
                    >
                      <strong>{label}</strong>
                      <span>{detail}</span>
                      <small>
                        {versionArrangement.targets.length} 个演奏时点 ·{" "}
                        {versionArrangement.noteCount} 个音符 · {versionScore.tempoBpm} BPM ·{" "}
                        {versionScore.practiceKey} 调
                      </small>
                    </button>
                  );
                })}
              </div>
              <p className="song-score-conversion-note">
                两个版本分别读取对应 MIDI 文件，不互相移调。练习时切换手型会保留当前乐曲时间位置。
              </p>
            </div>
          ) : null}

          <div className="song-selection-section">
            <h2>选择演奏手型</h2>
            <div className="song-track-options" role="group" aria-label="歌曲演奏手型">
              {SONG_HAND_OPTIONS.map(({ id, label, detail }) => (
                <button
                  aria-pressed={songHandMode === id}
                  className={`song-track-option${songHandMode === id ? " is-selected" : ""}`}
                  disabled={isStartingSongPractice}
                  key={id}
                  type="button"
                  onClick={() => {
                    updateSongPreferences({
                      handMode: id,
                    });
                    setSongStartError(null);
                  }}
                >
                  <strong>{label}</strong>
                  <span>{detail}</span>
                  <small>
                    {resolveSongPracticeArrangement(selectedScore, id).targets.length} 个演奏时点 ·{" "}
                    {resolveSongPracticeArrangement(selectedScore, id).noteCount} 个音
                  </small>
                </button>
              ))}
            </div>
            <p
              className={`song-score-conversion-note${showSongArrangementWarning ? " song-requirement-warning" : ""}`}
            >
              {requiresMidi && !midi.isConnected
                ? "混弹需要连接 MIDI 键盘；连接后才能进入混弹练习。"
                : songHandMode === "both"
                  ? "已连接 MIDI，进入后自动使用 MIDI 保留左右手和弦。"
                  : simultaneousTargetCount > 0
                    ? activeInputMode === "midi"
                      ? `原谱有 ${simultaneousTargetCount} 处同拍多音；MIDI 模式会保留全部音符。`
                      : `原谱有 ${simultaneousTargetCount} 处同拍多音；麦克风模式会简化为单音：右手保留最高音，左手保留最低音。`
                    : `进入后自动使用${midi.isConnected ? "已连接的 MIDI 键盘" : "麦克风"}。`}
            </p>
          </div>

          <div className="song-selection-section">
            <h2>系统会自动选择输入方式</h2>
            <p className="song-score-conversion-note">
              {midi.isConnected
                ? `已连接${midi.selectedInput?.name ? ` ${midi.selectedInput.name}` : " MIDI 键盘"}，进入后自动使用 MIDI。`
                : "未连接 MIDI 时，单手模式会自动使用麦克风；混弹需要先连接 MIDI。"}
            </p>
            {songStartError || (!midi.isConnected && microphoneError) ? (
              <div className="song-selection-error" role="status">
                <p>{songStartError ?? microphoneError}</p>
              </div>
            ) : null}
          </div>

          <div className="song-selection-footer">
            <span>进入后可随时切换左手、右手和混弹；当前：{resolvedArrangement.partName}。</span>
            <button className="primary" type="button" onClick={() => void startSongPractice()}>
              {isStartingSongPractice
                ? activeInputMode === "microphone"
                  ? "正在申请麦克风…"
                  : "正在进入练习…"
                : "确认并进入练习"}
            </button>
          </div>
        </section>
      </div>
      {overlay}
    </section>
  );
}
