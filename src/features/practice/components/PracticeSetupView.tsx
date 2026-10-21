import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, Keyboard, Mic, Music2, Play, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type {
  AnswerPitchMode,
  AppSettings,
  NoteName,
  PitchId,
  PracticeMode,
  PracticeQueueStrategy,
  PromptDisplayMode,
  PromptNoteDuration,
} from "../../../domain/types";
import {
  ANSWER_BUTTONS,
  AVAILABLE_PITCH_IDS,
  getStaffSelectedPitchIds,
} from "../../../domain/notes";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
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
import { getSongPracticeProgressEntries } from "../song-practice/songPracticeProgress";

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
  isBusy: boolean;
  microphoneError: string | null;
  midi: MidiInputController;
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

function formatSelectedPitchRanges(pitchIds: readonly PitchId[]): string {
  const selected = new Set(pitchIds);
  const ranges: PitchId[][] = [];
  let currentRange: PitchId[] = [];

  AVAILABLE_PITCH_IDS.forEach((pitchId) => {
    if (selected.has(pitchId)) {
      currentRange.push(pitchId);
    } else if (currentRange.length > 0) {
      ranges.push(currentRange);
      currentRange = [];
    }
  });

  if (currentRange.length > 0) ranges.push(currentRange);

  return ranges
    .map((range) => (range.length === 1 ? range[0] : `${range[0]}–${range[range.length - 1]}`))
    .join("、");
}

function ConditionalReveal({
  children,
  className = "",
  visible,
}: {
  children: ReactNode;
  className?: string;
  visible: boolean;
}): JSX.Element {
  return (
    <div
      aria-hidden={!visible}
      className={`practice-free-reveal${visible ? " is-open" : ""} ${className}`.trim()}
      ref={(element) => {
        if (element) element.inert = !visible;
      }}
    >
      <div className="practice-free-reveal-inner">{children}</div>
    </div>
  );
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

const FIXED_COUNT_PRESETS = [10, 20, 50] as const;

const PRACTICE_QUEUE_OPTIONS: Array<{
  strategy: PracticeQueueStrategy;
  label: string;
  description: string;
}> = [
  {
    strategy: "adaptive",
    label: "智能练习",
    description: "多练最近识别较慢的音，同时复习整个音域。",
  },
  {
    strategy: "melody",
    label: "连续旋律",
    description: "音符以相邻级进为主，像短旋律一样连续出现。",
  },
  {
    strategy: "note-drill",
    label: "指定音名",
    description: "只练选中的音名；仅选择一个音名时不计入统计。",
  },
];

const SONG_HAND_OPTIONS: Array<{
  id: SongPracticeHandMode;
  label: string;
}> = [
  { id: "right", label: "右手" },
  { id: "left", label: "左手" },
  { id: "both", label: "混弹" },
];

const SONG_KEY_OPTIONS: Array<{
  id: Exclude<SongPracticeKeyVersion, "source">;
  label: string;
}> = [
  { id: "c", label: "C 调简单版" },
  { id: "original", label: "原调完整版" },
];

export function PracticeSetupView({
  activeTab,
  actions,
  distanceContent,
  distanceStageActive,
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isCustomCountSelected, setIsCustomCountSelected] = useState(
    () => !FIXED_COUNT_PRESETS.includes(fixedCount as (typeof FIXED_COUNT_PRESETS)[number])
  );
  const [customFixedCount, setCustomFixedCount] = useState(() =>
    FIXED_COUNT_PRESETS.includes(fixedCount as (typeof FIXED_COUNT_PRESETS)[number])
      ? 30
      : fixedCount
  );
  const customFixedCountInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!FIXED_COUNT_PRESETS.includes(fixedCount as (typeof FIXED_COUNT_PRESETS)[number])) {
      setIsCustomCountSelected(true);
      setCustomFixedCount(fixedCount);
    }
  }, [fixedCount]);
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
  const completedSongSessions = new Map<string, number>();
  getSongPracticeProgressEntries().forEach(({ key, progress }) => {
    const separatorIndex = key.lastIndexOf(":");
    if (separatorIndex <= 0) return;
    const songId = key.slice(0, separatorIndex);
    completedSongSessions.set(
      songId,
      (completedSongSessions.get(songId) ?? 0) + progress.completedSessions
    );
  });
  const activeRange = settings.staffRangeProfiles?.[settings.staffNotationMode] ?? settings;
  const selectedPitchIds = getStaffSelectedPitchIds(
    activeRange.enabledGroupIds,
    activeRange.enabledPitchIds,
    activeRange.crossGroupPitchIds,
    settings.staffNotationMode
  );
  const staffSummary =
    settings.staffNotationMode === "treble-only"
      ? "高音谱表"
      : settings.staffNotationMode === "bass-only"
        ? "低音谱表"
        : "大谱表";
  const rangeSummary =
    selectedPitchIds.length === 0 ? "未选音域" : formatSelectedPitchRanges(selectedPitchIds);
  const modeSummary =
    mode === "open-ended"
      ? "无限练习"
      : mode === "fixed-count"
        ? `${fixedCount}题`
        : `${durationSecondsToInputMinutes(fixedDurationSeconds)}分钟`;
  const displaySummary = promptDisplayMode === "single-note" ? "单音模式" : "谱页模式";
  const answerSummary =
    answerPitchMode === "note-name"
      ? "虚拟键盘·音名"
      : answerPitchMode === "microphone"
        ? "麦克风"
        : "MIDI 键盘";
  const recommendedAnswerMode = midi.isConnected ? "exact-pitch" : "note-name";

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
    <section
      className={`practice-shell practice-setup-shell${activeTab === "free" ? " is-free-practice-setup" : ""}${activeTab === "distance" ? " is-distance-practice-setup" : ""}${activeTab === "songs" ? " is-song-practice-setup" : ""}`}
    >
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
        <div className="practice-free-page">
          <div className="practice-free-page-header">
            <div>
              <h1>自由练习</h1>
              <p className="practice-panel-description">看到音符后，快速识别音高并找到对应琴键。</p>
            </div>
            <div className="practice-setup-heading-meta">
              <div className="practice-midi-heading-status">
                <MidiInputControl ariaLabel="自由练习 MIDI 输入设备" midi={midi} />
              </div>
            </div>
          </div>
          <div className="practice-free-config-content">
            <section className="practice-free-section practice-free-range-section">
              <GlobalRangeControls
                allowInterStaffLedgerChoice={false}
                compactSummary
                rangeControlPart="base"
                settings={settings}
                onSettingsSaved={onSettingsSaved}
              />
            </section>

            <section aria-label="基础设置" className="practice-free-basics-section">
              <div className="practice-free-basics-grid">
                <div className="practice-free-field practice-free-length-field">
                  <span className="control-label">练习长度</span>
                  <div className="practice-free-mode-row">
                    <div
                      aria-label="练习长度模式"
                      className="segmented practice-free-segmented practice-free-length-mode"
                    >
                      <button
                        aria-pressed={mode === "open-ended"}
                        className={mode === "open-ended" ? "active" : ""}
                        onClick={() => setMode("open-ended")}
                        type="button"
                      >
                        无限
                      </button>
                      <button
                        aria-pressed={mode === "fixed-count"}
                        className={mode === "fixed-count" ? "active" : ""}
                        onClick={() => setMode("fixed-count")}
                        type="button"
                      >
                        题数
                      </button>
                      <button
                        aria-pressed={mode === "fixed-duration"}
                        className={mode === "fixed-duration" ? "active" : ""}
                        onClick={() => setMode("fixed-duration")}
                        type="button"
                      >
                        时长
                      </button>
                    </div>

                    <div className="practice-free-mode-values">
                      <ConditionalReveal visible={mode === "fixed-count"}>
                        <div aria-label="练习题数" className="practice-free-value-options">
                          {FIXED_COUNT_PRESETS.map((count) => (
                            <button
                              aria-pressed={!isCustomCountSelected && fixedCount === count}
                              className={
                                !isCustomCountSelected && fixedCount === count ? "active" : ""
                              }
                              key={count}
                              onClick={() => {
                                setIsCustomCountSelected(false);
                                setFixedCount(count);
                              }}
                              type="button"
                            >
                              {count}题
                            </button>
                          ))}
                          {isCustomCountSelected ? (
                            <label className="practice-free-custom-count-control is-active">
                              <input
                                aria-label="自定义题数"
                                max={500}
                                min={1}
                                ref={customFixedCountInputRef}
                                type="number"
                                value={fixedCount}
                                onChange={(event) => {
                                  const count = Math.min(
                                    500,
                                    Math.max(1, Number(event.target.value) || 1)
                                  );
                                  setCustomFixedCount(count);
                                  setFixedCount(count);
                                }}
                              />
                              <span aria-hidden="true">题</span>
                            </label>
                          ) : (
                            <button
                              aria-pressed={false}
                              onClick={() => {
                                setIsCustomCountSelected(true);
                                setFixedCount(customFixedCount);
                                window.requestAnimationFrame(() =>
                                  customFixedCountInputRef.current?.focus()
                                );
                              }}
                              type="button"
                            >
                              自定义
                            </button>
                          )}
                        </div>
                      </ConditionalReveal>
                      <ConditionalReveal visible={mode === "fixed-duration"}>
                        <div aria-label="练习时长" className="practice-free-value-options">
                          {[60, 120, 180, 300].map((seconds) => (
                            <button
                              aria-pressed={fixedDurationSeconds === seconds}
                              className={fixedDurationSeconds === seconds ? "active" : ""}
                              key={seconds}
                              onClick={() => setFixedDurationSeconds(seconds)}
                              type="button"
                            >
                              {seconds / 60}分钟
                            </button>
                          ))}
                          <label className="practice-free-inline-input">
                            <input
                              aria-label="自定义时长，分钟"
                              min={1}
                              max={120}
                              step={0.5}
                              type="number"
                              value={durationSecondsToInputMinutes(fixedDurationSeconds)}
                              onChange={(event) =>
                                setFixedDurationSeconds(
                                  inputMinutesToDurationSeconds(event.target.value)
                                )
                              }
                            />
                            分钟
                          </label>
                        </div>
                      </ConditionalReveal>
                      {mode === "open-ended" ? (
                        <p className="practice-free-mode-hint">不限题数和时长，随时结束练习。</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="practice-free-field practice-free-answer-field">
                  <span className="control-label">怎么作答</span>
                  <div aria-label="答题方式" className="practice-free-answer-options">
                    <button
                      aria-pressed={answerPitchMode === "microphone"}
                      className={answerPitchMode === "microphone" ? "is-selected" : ""}
                      onClick={() => setAnswerPitchMode("microphone")}
                      type="button"
                    >
                      <Mic aria-hidden="true" size={16} />
                      <span className="practice-free-answer-option-copy">
                        <span className="practice-free-answer-option-heading">
                          <strong>麦克风</strong>
                        </span>
                        <small>不用连线，直接弹奏即可</small>
                      </span>
                    </button>
                    <button
                      aria-pressed={answerPitchMode === "exact-pitch"}
                      className={answerPitchMode === "exact-pitch" ? "is-selected" : ""}
                      disabled={!midi.isConnected}
                      title={!midi.isConnected ? "连接 MIDI 设备后可用" : undefined}
                      onClick={() => setAnswerPitchMode("exact-pitch")}
                      type="button"
                    >
                      <Music2 aria-hidden="true" size={16} />
                      <span className="practice-free-answer-option-copy">
                        <span className="practice-free-answer-option-heading">
                          <strong>MIDI 键盘</strong>
                          {recommendedAnswerMode === "exact-pitch" ? (
                            <small className="practice-free-recommended">推荐</small>
                          ) : null}
                        </span>
                        <small>音高与八度精准识别，不受环境噪声影响</small>
                      </span>
                    </button>
                    <button
                      aria-pressed={answerPitchMode === "note-name"}
                      className={answerPitchMode === "note-name" ? "is-selected" : ""}
                      onClick={() => setAnswerPitchMode("note-name")}
                      type="button"
                    >
                      <Keyboard aria-hidden="true" size={16} />
                      <span className="practice-free-answer-option-copy">
                        <span className="practice-free-answer-option-heading">
                          <strong>虚拟键盘</strong>
                        </span>
                        <small>无需连接乐器，点击屏幕或敲击键盘作答</small>
                      </span>
                    </button>
                  </div>
                  {answerPitchMode === "microphone" && microphoneError ? (
                    <span className="practice-microphone-error practice-free-warning" role="status">
                      {microphoneError}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="practice-free-advanced-disclosure">
              <button
                aria-controls="practice-free-advanced-options"
                aria-expanded={isAdvancedOpen}
                className="practice-free-advanced-toggle"
                onClick={() => setIsAdvancedOpen((open) => !open)}
                type="button"
                title="音域加练、练习方式、谱面与节奏、声音"
              >
                <Settings2 aria-hidden="true" size={16} />
                <span>更多设置</span>
                <span className="practice-free-advanced-count">4组</span>
                <ChevronDown
                  aria-hidden="true"
                  className={isAdvancedOpen ? "is-open" : ""}
                  size={16}
                />
              </button>
              <div
                className="practice-free-advanced-content"
                hidden={!isAdvancedOpen}
                id="practice-free-advanced-options"
              >
                <section className="practice-free-field">
                  <GlobalRangeControls
                    allowInterStaffLedgerChoice={false}
                    rangeControlPart="extensions"
                    settings={settings}
                    onSettingsSaved={onSettingsSaved}
                  />
                </section>

                <section className="practice-free-field practice-free-strategy-field">
                  <span className="control-label">练习方式</span>
                  <div className="practice-free-strategy-list">
                    {PRACTICE_QUEUE_OPTIONS.map((option) => (
                      <label
                        aria-label={option.label}
                        className={`practice-free-strategy-option${queueStrategy === option.strategy ? " is-selected" : ""}`}
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
                        <span className="practice-free-strategy-copy">
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <ConditionalReveal
                    className="practice-free-note-drill-reveal"
                    visible={queueStrategy === "note-drill"}
                  >
                    <div className="practice-free-drill-options">
                      <span className="practice-free-sub-label">强化音名</span>
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
                  </ConditionalReveal>
                </section>

                <section className="practice-free-field">
                  <span className="control-label">谱面与节奏</span>
                  <div className="practice-free-display-row">
                    <div aria-label="谱面呈现方式" className="segmented practice-free-segmented">
                      <button
                        aria-pressed={promptDisplayMode === "single-note"}
                        className={promptDisplayMode === "single-note" ? "active" : ""}
                        disabled={promptNoteDurations.length > 1}
                        onClick={() => setPromptDisplayMode("single-note")}
                        title={
                          promptNoteDurations.length > 1 ? "多选时值需要使用谱页展示" : undefined
                        }
                        type="button"
                      >
                        逐个看音
                      </button>
                      <button
                        aria-pressed={promptDisplayMode === "staff-page"}
                        className={promptDisplayMode === "staff-page" ? "active" : ""}
                        onClick={() => setPromptDisplayMode("staff-page")}
                        type="button"
                      >
                        连续看谱
                      </button>
                    </div>
                    <div aria-label="练习时值，可多选" className="practice-free-duration-tags">
                      {PROMPT_NOTE_DURATION_OPTIONS.map((option) => (
                        <button
                          aria-pressed={promptNoteDurations.includes(option.value)}
                          aria-label={option.ariaLabel}
                          className={
                            promptNoteDurations.includes(option.value) ? "is-selected" : ""
                          }
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
                              PROMPT_NOTE_DURATION_OPTIONS.map((item) => item.value).filter(
                                (value) => selected.has(value)
                              )
                            );
                          }}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {promptNoteDurations.length > 1 ? (
                    <small className="practice-free-helper">
                      混合时值按连续谱面显示，仍逐音答题。
                    </small>
                  ) : null}
                  <ConditionalReveal
                    className="practice-free-pause-reveal"
                    visible={promptDisplayMode === "staff-page"}
                  >
                    <label className="practice-checkbox-option">
                      <input
                        checked={startPausedReading}
                        type="checkbox"
                        onChange={(event) => onStartPausedReadingChange(event.target.checked)}
                      />
                      <span>开始后暂停读谱</span>
                    </label>
                  </ConditionalReveal>
                </section>

                <section className="practice-free-field practice-free-sound-field">
                  <span className="control-label">声音</span>
                  <div className="practice-checkbox-options practice-free-sound-options">
                    <label
                      className={`practice-checkbox-option${answerPitchMode === "microphone" ? " is-disabled" : ""}`}
                      title={answerPitchMode === "microphone" ? "麦克风模式下不可用" : undefined}
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
                      title={answerPitchMode === "microphone" ? "麦克风模式下不可用" : undefined}
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
                    <span className="practice-free-helper">
                      麦克风模式关闭应用提示音，避免影响识别。
                    </span>
                  ) : null}
                </section>
              </div>
            </section>
          </div>

          <div className="practice-free-action-dock">
            <div aria-label="当前配置摘要" className="practice-free-config-summary">
              <span className="practice-free-summary-label">当前配置</span>
              {[staffSummary, rangeSummary, displaySummary, modeSummary, answerSummary].map(
                (item) => (
                  <span className="practice-free-summary-chip" key={item}>
                    {item}
                  </span>
                )
              )}
            </div>
            <div className="practice-free-action-buttons">
              <span className="practice-start-action" title={setupDisabledReason ?? undefined}>
                <button
                  aria-keyshortcuts="Enter"
                  aria-describedby={
                    setupDisabledReason ? "practice-start-disabled-reason" : undefined
                  }
                  className="primary practice-free-start-button"
                  disabled={setupDisabled || showStartingSessionStatus}
                  onClick={() => void startSession()}
                >
                  {showStartingSessionStatus ? (
                    "检查中"
                  ) : (
                    <>
                      <Play size={19} />
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
              <button className="practice-free-stats-button" onClick={onOpenStats} type="button">
                <BarChart3 size={17} />
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
        <div className="practice-free-page song-selection-panel">
          <header className="practice-free-page-header">
            <div>
              <h1>歌曲练习</h1>
              <p className="practice-panel-description song-practice-description">
                选择熟悉的旋律，跟随谱面练习读谱与弹奏。
              </p>
            </div>
            <div className="practice-midi-heading-status">
              <MidiInputControl ariaLabel="歌曲练习 MIDI 输入设备" midi={midi} />
            </div>
          </header>

          <div className="song-selection-section song-selection-song-section">
            <h2>选择歌曲</h2>
            <div className="song-choice-list">
              {BUILT_IN_SONG_PRACTICE_SCORES.map((score) => {
                const isSelected = selectedSongId === score.id;
                const completedCount = completedSongSessions.get(score.id) ?? 0;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`song-choice-option${isSelected ? " is-selected" : ""}`}
                    disabled={isStartingSongPractice}
                    key={score.id}
                    type="button"
                    onClick={() => {
                      updateSongPreferences({ selectedSongId: score.id });
                      setSongStartError(null);
                    }}
                  >
                    <strong>{score.title}</strong>
                    {completedCount > 0 ? (
                      <span className="song-choice-completion">已完成 {completedCount} 次</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`song-selection-config-grid${isMidiSong ? " has-version" : ""}`}>
            {isMidiSong ? (
              <div className="song-selection-section">
                <h2>选择版本</h2>
                <div
                  className="song-segment-control"
                  role="group"
                  aria-label={`${selectedScore.title}版本`}
                >
                  {SONG_KEY_OPTIONS.map(({ id, label }) => (
                    <button
                      aria-pressed={songKeyVersion === id}
                      className={songKeyVersion === id ? "is-selected" : ""}
                      disabled={isStartingSongPractice}
                      key={id}
                      type="button"
                      onClick={() => {
                        updateSongPreferences({ keyVersion: id });
                        setSongStartError(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="song-selection-section">
              <div className="song-section-heading">
                <h2>演奏手型</h2>
                <span className="song-hand-tip">
                  <span aria-hidden="true">i</span> 练习中可随时切换
                </span>
              </div>
              <div
                className="song-segment-control song-hand-segment-control"
                role="group"
                aria-label="歌曲演奏手型"
              >
                {SONG_HAND_OPTIONS.map(({ id, label }) => {
                  const requiresMidiForOption = id === "both";
                  const isDisabled =
                    isStartingSongPractice || (requiresMidiForOption && !midi.isConnected);
                  return (
                    <button
                      aria-pressed={songHandMode === id}
                      className={`${songHandMode === id ? "is-selected " : ""}${isDisabled && requiresMidiForOption ? "is-midi-disabled" : ""}`.trim()}
                      disabled={isDisabled}
                      key={id}
                      type="button"
                      onClick={() => {
                        updateSongPreferences({ handMode: id });
                        setSongStartError(null);
                      }}
                    >
                      {label}
                      {requiresMidiForOption && !midi.isConnected ? (
                        <span className="song-midi-required">需 MIDI</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {showSongArrangementWarning ? (
                <p className="song-arrangement-note" role="note">
                  {requiresMidi && !midi.isConnected
                    ? "混弹需要 MIDI 键盘，连接后即可使用。"
                    : "这首曲目含同拍多音，麦克风会简化为单音：右手保留最高音，左手保留最低音。"}
                </p>
              ) : null}
            </div>
          </div>

          {songStartError || (!midi.isConnected && microphoneError) ? (
            <div className="song-selection-error" role="status">
              <p>{songStartError ?? microphoneError}</p>
            </div>
          ) : null}

          <div className="song-selection-footer" role="group" aria-label="当前练习设置">
            <div className="song-selection-summary">
              <span className="song-selection-chip">{selectedScore.title}</span>
              <span className="song-selection-chip">
                {isMidiSong
                  ? SONG_KEY_OPTIONS.find(({ id }) => id === songKeyVersion)?.label
                  : "原谱"}
              </span>
              <span className="song-selection-chip">
                {SONG_HAND_OPTIONS.find(({ id }) => id === songHandMode)?.label}
                {requiresMidi && !midi.isConnected ? " · 需 MIDI" : ""}
              </span>
              <span className="song-selection-chip song-selection-input-chip">
                {activeInputMode === "microphone" ? (
                  <Mic aria-hidden="true" size={14} />
                ) : (
                  <Keyboard aria-hidden="true" size={14} />
                )}
                {activeInputMode === "microphone" ? "麦克风" : "MIDI"}
              </span>
            </div>
            <button
              className="primary song-selection-start"
              type="button"
              onClick={() => void startSongPractice()}
            >
              {isStartingSongPractice
                ? activeInputMode === "microphone"
                  ? "正在申请麦克风…"
                  : "正在进入练习…"
                : "确认并进入练习"}
            </button>
          </div>
        </div>
      </div>
      {overlay}
    </section>
  );
}
