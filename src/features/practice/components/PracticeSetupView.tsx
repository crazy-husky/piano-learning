import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, Keyboard, Mic, Music2, Play, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type {
  AnswerPitchMode,
  DuetPracticeLevel,
  AppSettings,
  NoteName,
  PitchId,
  PracticeMode,
  PracticeQueueStrategy,
  PromptDisplayMode,
  PromptNoteDuration,
} from "../../../domain/types";
import type { ChaseHandMode } from "../logic/scoreChase";
import { getDuetPracticeLevelDescription, getDuetPracticeLevelLabel } from "../logic/duetPractice";
import { PRACTICE_FIXED_COUNT_PRESETS } from "../logic/practiceLengthOptions";
import {
  ANSWER_BUTTONS,
  AVAILABLE_PITCH_IDS,
  getStaffSelectedPitchIds,
} from "../../../domain/notes";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { GlobalRangeControls } from "../../../shared/components/GlobalRangeControls";
import { BoundedNumberInput } from "../../../shared/components/BoundedNumberInput";
import { useMidiConnectionAttention } from "../../../shared/hooks/useMidiConnectionAttention";
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
import type { PracticeMicrophoneStatus } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";

export interface PracticeSetupUiPreferences {
  answerPitchMode: AnswerPitchMode;
  practiceMode: "single" | "duet";
  duetLevel: DuetPracticeLevel;
  duetCurriculumVersion: number;
  duetAllowDottedRhythms: boolean;
  autoPlayTarget: boolean;
  midiAutoPlayTarget: boolean;
  chaseEnabled: boolean;
  chaseHandMode: ChaseHandMode;
  chasePreferencesVersion: 2;
  chaseSpeedMultiplier: number;
  chaseStartCount: number;
  playAnswerNote: boolean;
  midiPlayAnswerNote: boolean;
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
  onPracticeModeChange: (mode: "single" | "duet") => void;
  onDuetLevelChange: (level: DuetPracticeLevel) => void;
  onDuetAllowDottedRhythmsChange: (enabled: boolean) => void;
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

export type PracticeSetupTab = "free" | "distance" | "name-key" | "songs";

interface PracticeSetupViewProps {
  activeTab: PracticeSetupTab;
  actions: PracticeSetupActions;
  distanceContent: ReactNode;
  nameKeyContent: ReactNode;
  distanceStageActive: boolean;
  isBusy: boolean;
  microphoneError: string | null;
  microphoneIsPreparingModel: boolean;
  microphoneStatus: PracticeMicrophoneStatus;
  onRetryMicrophone: () => Promise<boolean>;
  midi: MidiInputController;
  overlay?: ReactNode;
  preferences: PracticeSetupUiPreferences;
  setupDisabledReason?: string;
  metronomeError?: string | null;
  startPausedReading: boolean;
  settings: AppSettings;
  metronomeBeatsPerBar: 2 | 3 | 4 | 6;
}

const DUET_PRACTICE_LEVELS: DuetPracticeLevel[] = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
];

function durationSecondsToInputMinutes(seconds: number): number {
  return Number((seconds / 60).toFixed(2));
}

function inputMinutesToDurationSeconds(value: number): number {
  return Math.max(60, Math.round(value * 60));
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
  nameKeyContent,
  distanceStageActive,
  isBusy: showStartingSessionStatus,
  microphoneError,
  microphoneIsPreparingModel,
  microphoneStatus,
  onRetryMicrophone,
  midi,
  overlay,
  preferences,
  setupDisabledReason,
  metronomeError,
  startPausedReading,
  settings,
  metronomeBeatsPerBar,
}: PracticeSetupViewProps): JSX.Element {
  const {
    canRequestConnection: canShowMidiAttention,
    isActive: isMidiConnectAttentionActive,
    show: triggerMidiAttention,
  } = useMidiConnectionAttention(midi);
  const {
    answerPitchMode,
    practiceMode,
    duetLevel,
    duetAllowDottedRhythms,
    autoPlayTarget: nonMidiAutoPlayTarget,
    midiAutoPlayTarget,
    drillNoteNames,
    fixedCount,
    fixedDurationSeconds,
    mode,
    playAnswerNote: nonMidiPlayAnswerNote,
    midiPlayAnswerNote,
    promptDisplayMode: savedPromptDisplayMode,
    promptNoteDurations,
    queueStrategy,
  } = preferences;
  const isDuetPractice = practiceMode === "duet";
  const activeAnswerPitchMode = isDuetPractice ? "exact-pitch" : answerPitchMode;
  const promptDisplayMode =
    activeAnswerPitchMode === "exact-pitch" ? "staff-page" : savedPromptDisplayMode;
  const autoPlayTarget =
    activeAnswerPitchMode === "exact-pitch" ? midiAutoPlayTarget : nonMidiAutoPlayTarget;
  const playAnswerNote =
    activeAnswerPitchMode === "exact-pitch" ? midiPlayAnswerNote : nonMidiPlayAnswerNote;
  const {
    onAnswerPitchModeChange: setAnswerPitchMode,
    onPracticeModeChange,
    onDuetLevelChange,
    onDuetAllowDottedRhythmsChange,
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
  const [midiAttentionSource, setMidiAttentionSource] = useState<
    "answer-mode" | "start" | "song-hand" | "song-start" | null
  >(null);
  const freePracticeNeedsMidi =
    activeTab === "free" &&
    activeAnswerPitchMode === "exact-pitch" &&
    !midi.isConnected &&
    metronomeBeatsPerBar === 4;
  const showMidiAttention = (
    source: "answer-mode" | "start" | "song-hand" | "song-start"
  ): void => {
    setMidiAttentionSource(source);
    triggerMidiAttention();
  };
  const handleMidiAnswerModeClick = (): void => {
    if (!isDuetPractice) {
      setAnswerPitchMode("exact-pitch");
    }
    if (canShowMidiAttention) {
      showMidiAttention("answer-mode");
    }
  };

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
    () =>
      !PRACTICE_FIXED_COUNT_PRESETS.includes(
        fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
      )
  );
  const [customFixedCount, setCustomFixedCount] = useState(() =>
    PRACTICE_FIXED_COUNT_PRESETS.includes(
      fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
    )
      ? PRACTICE_FIXED_COUNT_PRESETS[0]
      : fixedCount
  );
  const customFixedCountInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (
      !PRACTICE_FIXED_COUNT_PRESETS.includes(
        fixedCount as (typeof PRACTICE_FIXED_COUNT_PRESETS)[number]
      )
    ) {
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
  const staffSummary = isDuetPractice
    ? "大谱表（固定）"
    : settings.staffNotationMode === "treble-only"
      ? "高音谱表"
      : settings.staffNotationMode === "bass-only"
        ? "低音谱表"
        : "大谱表";
  const rangeSummary = isDuetPractice
    ? "C3–B3 + C4–B4（全白键）"
    : selectedPitchIds.length === 0
      ? "未选音域"
      : formatSelectedPitchRanges(selectedPitchIds);
  const modeSummary =
    mode === "open-ended"
      ? "无限练习"
      : mode === "fixed-count"
        ? `${fixedCount}题`
        : `${durationSecondsToInputMinutes(fixedDurationSeconds)}分钟`;
  const displaySummary = isDuetPractice
    ? "谱页模式（固定）"
    : promptDisplayMode === "single-note"
      ? "单音模式"
      : "谱页模式";
  const duetDifficultySummary = getDuetPracticeLevelLabel(duetLevel);
  const answerSummary =
    activeAnswerPitchMode === "note-name"
      ? "虚拟键盘·音名"
      : activeAnswerPitchMode === "microphone"
        ? "麦克风"
        : "MIDI 键盘";
  const recommendedAnswerMode = midi.isConnected ? "exact-pitch" : "note-name";
  const configSummaryItems = isDuetPractice
    ? [modeSummary, duetDifficultySummary, answerSummary]
    : [staffSummary, rangeSummary, displaySummary, modeSummary, answerSummary];

  const startSongPractice = async (): Promise<void> => {
    if (requiresMidi && !midi.isConnected) {
      showMidiAttention("song-start");
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
      className={`practice-shell practice-setup-shell${activeTab === "free" ? " is-free-practice-setup" : ""}${activeTab === "distance" ? " is-distance-practice-setup" : ""}${activeTab === "name-key" ? " is-name-key-practice-setup" : ""}${activeTab === "songs" ? " is-song-practice-setup" : ""}`}
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
          音距速推
        </button>
        <button
          aria-controls="practice-name-key-panel"
          aria-selected={activeTab === "name-key"}
          className={activeTab === "name-key" ? "is-active" : ""}
          disabled={distanceStageActive || isStartingSongPractice}
          id="practice-name-key-tab"
          role="tab"
          type="button"
          onClick={() => onSetupTabChange("name-key")}
        >
          音名找键
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
        <div className="practice-free-page practice-setup-framed-page">
          <div className="practice-free-page-header">
            <div>
              <h1>自由练习</h1>
              <p className="practice-panel-description">看到音符后，快速识别音高并找到对应琴键。</p>
            </div>
            {activeAnswerPitchMode === "exact-pitch" ? (
              <div className="practice-setup-heading-meta">
                <div className="practice-midi-heading-status">
                  <MidiInputControl
                    ariaLabel="自由练习 MIDI 输入设备"
                    className={isMidiConnectAttentionActive ? "needs-attention" : undefined}
                    midi={midi}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="practice-free-config-content">
            <section
              aria-label="练习方式"
              className="practice-free-section practice-free-hand-mode"
            >
              <div className="practice-free-field">
                <span className="control-label">练习方式</span>
                <div
                  aria-label="练习方式"
                  className="segmented practice-free-segmented"
                  role="group"
                >
                  <button
                    aria-pressed={!isDuetPractice}
                    className={!isDuetPractice ? "active" : ""}
                    onClick={() => onPracticeModeChange("single")}
                    type="button"
                  >
                    单手（默认）
                  </button>
                  <button
                    aria-pressed={isDuetPractice}
                    className={isDuetPractice ? "active" : ""}
                    onClick={() => onPracticeModeChange("duet")}
                    type="button"
                  >
                    左右手合弹
                  </button>
                </div>
                {isDuetPractice ? (
                  <>
                    <label
                      className="practice-free-duet-difficulty"
                      htmlFor="practice-duet-difficulty"
                    >
                      <span className="control-label">合弹难度</span>
                      <select
                        id="practice-duet-difficulty"
                        value={duetLevel}
                        onChange={(event) =>
                          onDuetLevelChange(event.currentTarget.value as DuetPracticeLevel)
                        }
                      >
                        {DUET_PRACTICE_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {getDuetPracticeLevelLabel(level)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="practice-free-mode-hint">
                      {getDuetPracticeLevelDescription(duetLevel)}
                    </p>
                  </>
                ) : null}
              </div>
            </section>

            {!isDuetPractice ? (
              <section className="practice-free-section practice-free-range-section">
                <GlobalRangeControls
                  allowInterStaffLedgerChoice={false}
                  compactSummary
                  rangeControlPart="base"
                  settings={settings}
                  onSettingsSaved={onSettingsSaved}
                />
              </section>
            ) : null}

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
                          {PRACTICE_FIXED_COUNT_PRESETS.map((count) => (
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
                            <label
                              className="practice-free-custom-count-control is-active"
                              htmlFor="practice-free-custom-count"
                            >
                              <BoundedNumberInput
                                aria-label="自定义题数"
                                id="practice-free-custom-count"
                                inputRef={customFixedCountInputRef}
                                max={500}
                                min={1}
                                value={fixedCount}
                                onCommit={(count) => {
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
                          <label
                            className="practice-free-inline-input"
                            htmlFor="practice-free-duration"
                          >
                            <BoundedNumberInput
                              aria-label="自定义时长，分钟"
                              id="practice-free-duration"
                              min={1}
                              max={120}
                              step={0.5}
                              value={durationSecondsToInputMinutes(fixedDurationSeconds)}
                              onCommit={(minutes) =>
                                setFixedDurationSeconds(inputMinutesToDurationSeconds(minutes))
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
                  <div
                    aria-label="答题方式"
                    className={`practice-free-answer-options${isDuetPractice ? " is-duet" : ""}`}
                  >
                    {!isDuetPractice ? (
                      <button
                        aria-pressed={activeAnswerPitchMode === "microphone"}
                        className={activeAnswerPitchMode === "microphone" ? "is-selected" : ""}
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
                    ) : null}
                    <button
                      aria-pressed={activeAnswerPitchMode === "exact-pitch"}
                      className={activeAnswerPitchMode === "exact-pitch" ? "is-selected" : ""}
                      disabled={isDuetPractice && !canShowMidiAttention}
                      onClick={handleMidiAnswerModeClick}
                      type="button"
                    >
                      <Music2 aria-hidden="true" size={16} />
                      <span className="practice-free-answer-option-copy">
                        <span className="practice-free-answer-option-heading">
                          <strong>MIDI 键盘</strong>
                          {!isDuetPractice && recommendedAnswerMode === "exact-pitch" ? (
                            <small className="practice-free-recommended">推荐</small>
                          ) : null}
                        </span>
                        <small
                          className={
                            isMidiConnectAttentionActive &&
                            midiAttentionSource === "answer-mode" &&
                            !midi.isConnected
                              ? "is-midi-attention"
                              : undefined
                          }
                        >
                          {midi.isConnected
                            ? "音高与八度精准识别，练习中可切换设备"
                            : "请先连接并选择 MIDI 设备，再开始练习"}
                        </small>
                      </span>
                    </button>
                    {!isDuetPractice ? (
                      <button
                        aria-pressed={activeAnswerPitchMode === "note-name"}
                        className={activeAnswerPitchMode === "note-name" ? "is-selected" : ""}
                        onClick={() => setAnswerPitchMode("note-name")}
                        type="button"
                      >
                        <Keyboard aria-hidden="true" size={16} />
                        <span className="practice-free-answer-option-copy">
                          <span className="practice-free-answer-option-heading">
                            <strong>虚拟键盘</strong>
                          </span>
                          <small>无需连接乐器，点击虚拟键盘或敲击键盘作答</small>
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {isDuetPractice && !midi.isConnected ? (
                    <p
                      className={`practice-free-warning${isMidiConnectAttentionActive && midiAttentionSource === "answer-mode" ? " is-midi-attention" : ""}`}
                      role="status"
                    >
                      请连接 MIDI 键盘后开始左右手合弹。
                    </p>
                  ) : null}
                  {activeAnswerPitchMode === "microphone" &&
                  (microphoneError ||
                    microphoneStatus === "error" ||
                    microphoneStatus === "requesting" ||
                    microphoneIsPreparingModel) ? (
                    <div
                      className="practice-microphone-error-actions practice-free-warning"
                      aria-live="polite"
                    >
                      <span>
                        {microphoneStatus === "requesting"
                          ? microphoneIsPreparingModel
                            ? "正在准备识别模型…"
                            : "正在连接麦克风…"
                          : (microphoneError ?? "麦克风连接失败，请检查权限和输入设备后重试。")}
                      </span>
                      <PracticeMicrophoneRetryButton
                        isConnecting={microphoneStatus === "requesting"}
                        isPreparingModel={microphoneIsPreparingModel}
                        onRetry={onRetryMicrophone}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {activeAnswerPitchMode === "exact-pitch" ? (
              <section aria-label="节拍同步" className="practice-free-section">
                <div className="practice-free-field">
                  <span className="control-label">节拍同步</span>
                  <small className="practice-free-helper">
                    {metronomeBeatsPerBar === 4
                      ? "MIDI 弹奏时，谱面会按木鱼节拍自动推进并反馈节奏。"
                      : "同步谱面目前使用 4/4，请先在木鱼节拍器中将拍号调为 4/4。"}
                  </small>
                  {metronomeError ? (
                    <small className="practice-free-warning" role="alert">
                      节拍器无法启动：{metronomeError}
                    </small>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="practice-free-advanced-disclosure">
              <button
                aria-controls="practice-free-advanced-options"
                aria-expanded={isAdvancedOpen}
                className="practice-free-advanced-toggle"
                onClick={() => setIsAdvancedOpen((open) => !open)}
                type="button"
                title={
                  isDuetPractice
                    ? "出题策略、音符时值、合弹微调"
                    : "音域加练、出题策略、谱面与节奏、声音"
                }
              >
                <Settings2 aria-hidden="true" size={16} />
                <span>更多设置</span>
                <span className="practice-free-advanced-count">
                  {isDuetPractice ? "3组" : "4组"}
                </span>
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
                {isDuetPractice ? (
                  <section className="practice-free-field practice-free-duet-advanced-field">
                    <span className="control-label">合弹微调</span>
                    <div className="practice-checkbox-options practice-free-duet-advanced-options">
                      <label className="practice-checkbox-option">
                        <input
                          checked={duetAllowDottedRhythms}
                          type="checkbox"
                          onChange={(event) =>
                            onDuetAllowDottedRhythmsChange(event.currentTarget.checked)
                          }
                        />
                        <span>附点节奏挑战</span>
                      </label>
                    </div>
                    <small className="practice-free-helper">
                      开启后，每四小节乐句的末小节加入附点节奏；左右手编排仍按所选等级进行。
                    </small>
                  </section>
                ) : null}

                {!isDuetPractice ? (
                  <section className="practice-free-field">
                    <GlobalRangeControls
                      allowInterStaffLedgerChoice={false}
                      rangeControlPart="extensions"
                      settings={settings}
                      onSettingsSaved={onSettingsSaved}
                    />
                  </section>
                ) : null}

                <section className="practice-free-field practice-free-strategy-field">
                  <span className="control-label">出题策略</span>
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
                  <span className="control-label">
                    {isDuetPractice ? "音符时值" : "谱面与节奏"}
                  </span>
                  <div className="practice-free-display-row">
                    {!isDuetPractice ? (
                      <div aria-label="谱面呈现方式" className="segmented practice-free-segmented">
                        <button
                          aria-pressed={promptDisplayMode === "single-note"}
                          className={promptDisplayMode === "single-note" ? "active" : ""}
                          disabled={
                            promptNoteDurations.length > 1 ||
                            activeAnswerPitchMode === "exact-pitch"
                          }
                          onClick={() => setPromptDisplayMode("single-note")}
                          title={
                            activeAnswerPitchMode === "exact-pitch"
                              ? "MIDI 弹奏会自动同步节拍，请使用连续看谱"
                              : promptNoteDurations.length > 1
                                ? "多选时值需要使用谱页展示"
                                : undefined
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
                    ) : null}
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
                  {!isDuetPractice ? (
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
                  ) : null}
                </section>

                {!isDuetPractice ? (
                  <section className="practice-free-field practice-free-sound-field">
                    <span className="control-label">声音</span>
                    <div className="practice-checkbox-options practice-free-sound-options">
                      <label
                        className={`practice-checkbox-option${activeAnswerPitchMode === "microphone" ? " is-disabled" : ""}`}
                        title={
                          activeAnswerPitchMode === "microphone" ? "麦克风模式下不可用" : undefined
                        }
                      >
                        <input
                          checked={activeAnswerPitchMode === "microphone" ? false : autoPlayTarget}
                          disabled={activeAnswerPitchMode === "microphone"}
                          type="checkbox"
                          onChange={(event) => setAutoPlayTarget(event.target.checked)}
                        />
                        <span>自动播放目标音</span>
                      </label>
                      <label
                        className={`practice-checkbox-option${activeAnswerPitchMode === "microphone" ? " is-disabled" : ""}`}
                        title={
                          activeAnswerPitchMode === "microphone" ? "麦克风模式下不可用" : undefined
                        }
                      >
                        <input
                          checked={activeAnswerPitchMode === "microphone" ? false : playAnswerNote}
                          disabled={activeAnswerPitchMode === "microphone"}
                          type="checkbox"
                          onChange={(event) => setPlayAnswerNote(event.target.checked)}
                        />
                        <span>按键时播放声音</span>
                      </label>
                    </div>
                    {activeAnswerPitchMode === "microphone" ? (
                      <span className="practice-free-helper">
                        麦克风模式关闭应用提示音，避免影响识别。
                      </span>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </section>

            {isDuetPractice ? (
              <section
                aria-label="练习辅助"
                className="practice-free-section practice-free-duet-assist"
              >
                <span className="control-label">练习辅助</span>
                <div className="practice-checkbox-options practice-free-sound-options practice-free-duet-assist-options">
                  <label className="practice-checkbox-option">
                    <input
                      checked={autoPlayTarget}
                      type="checkbox"
                      onChange={(event) => setAutoPlayTarget(event.target.checked)}
                    />
                    <span>自动播放目标音</span>
                  </label>
                  <label className="practice-checkbox-option">
                    <input
                      checked={playAnswerNote}
                      type="checkbox"
                      onChange={(event) => setPlayAnswerNote(event.target.checked)}
                    />
                    <span>按键时播放声音</span>
                  </label>
                  <label className="practice-checkbox-option">
                    <input
                      checked={startPausedReading}
                      type="checkbox"
                      onChange={(event) => onStartPausedReadingChange(event.target.checked)}
                    />
                    <span>开始后暂停读谱</span>
                  </label>
                </div>
              </section>
            ) : null}
          </div>

          <div className="practice-free-action-dock">
            <div aria-label="当前配置摘要" className="practice-free-config-summary">
              <span className="practice-free-summary-label">当前配置</span>
              {configSummaryItems.map((item) => (
                <span className="practice-free-summary-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <div className="practice-free-action-buttons">
              <span className="practice-start-action" title={setupDisabledReason ?? undefined}>
                <button
                  aria-keyshortcuts="Enter"
                  aria-describedby={
                    setupDisabledReason ? "practice-start-disabled-reason" : undefined
                  }
                  className="primary practice-free-start-button"
                  disabled={(setupDisabled && !freePracticeNeedsMidi) || showStartingSessionStatus}
                  onClick={() => {
                    if (freePracticeNeedsMidi) {
                      showMidiAttention("start");
                      return;
                    }
                    void startSession();
                  }}
                >
                  {showStartingSessionStatus ? (
                    microphoneStatus === "requesting" ? (
                      microphoneIsPreparingModel ? (
                        "准备识别模型…"
                      ) : (
                        "连接麦克风…"
                      )
                    ) : (
                      "检查中"
                    )
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
                    className={`practice-start-tooltip${freePracticeNeedsMidi && isMidiConnectAttentionActive ? " is-midi-attention" : ""}`}
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
        className="practice-setup-tab-panel"
        hidden={activeTab !== "name-key"}
        id="practice-name-key-panel"
        role="tabpanel"
        aria-labelledby="practice-name-key-tab"
      >
        {nameKeyContent}
      </div>
      <div
        className="setup-grid practice-setup-tab-panel"
        hidden={activeTab !== "songs"}
        id="practice-songs-panel"
        role="tabpanel"
        aria-labelledby="practice-songs-tab"
      >
        <div className="practice-free-page practice-setup-framed-page song-selection-panel">
          <header className="practice-free-page-header">
            <div>
              <h1>歌曲练习</h1>
              <p className="practice-panel-description song-practice-description">
                选择熟悉的旋律，跟随谱面练习读谱与弹奏。
              </p>
            </div>
            {activeInputMode === "midi" || requiresMidi || !midi.isConnected ? (
              <div className="practice-midi-heading-status">
                <MidiInputControl
                  ariaLabel="歌曲练习 MIDI 输入设备"
                  className={
                    isMidiConnectAttentionActive && midiAttentionSource?.startsWith("song-")
                      ? "needs-attention"
                      : undefined
                  }
                  midi={midi}
                />
              </div>
            ) : null}
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
                    isStartingSongPractice ||
                    (requiresMidiForOption && !midi.isConnected && !canShowMidiAttention);
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
                        if (requiresMidiForOption && !midi.isConnected) {
                          showMidiAttention("song-hand");
                        }
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
                <p
                  className={`song-arrangement-note${isMidiConnectAttentionActive && midiAttentionSource === "song-hand" ? " is-midi-attention" : ""}`}
                  role="note"
                >
                  {requiresMidi && !midi.isConnected
                    ? "混弹需要 MIDI 键盘，连接后即可使用。"
                    : "这首曲目含同拍多音，麦克风会简化为单音：右手保留最高音，左手保留最低音。"}
                </p>
              ) : null}
            </div>
          </div>

          {songStartError ||
          (!midi.isConnected && microphoneError) ||
          microphoneIsPreparingModel ||
          microphoneStatus === "requesting" ? (
            <div aria-live="polite" className="song-selection-error">
              <p>
                {microphoneStatus === "requesting"
                  ? microphoneIsPreparingModel
                    ? "正在准备识别模型…"
                    : "正在连接麦克风…"
                  : (songStartError ?? microphoneError)}
              </p>
              {microphoneError ||
              microphoneStatus === "error" ||
              microphoneStatus === "requesting" ? (
                <PracticeMicrophoneRetryButton
                  isConnecting={microphoneStatus === "requesting"}
                  isPreparingModel={microphoneIsPreparingModel}
                  onRetry={async () => {
                    const connected = await onRetryMicrophone();
                    if (connected) setSongStartError(null);
                    return connected;
                  }}
                />
              ) : null}
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
