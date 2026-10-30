import { ArrowLeft, Pause, Play, RotateCcw, Settings2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getPianoAudioTime, playMuffledMidiNote, playTargetNote } from "../../../audio/piano";
import { resolveDrillNoteNames, resolveQueueStrategy } from "../../../data/db";
import { writeBackupIfSafe } from "../../../data/backup";
import {
  markMidiLatencyStage,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
} from "../../../diagnostics/midiLatencyDiagnostics";
import { markMidiLatencyAfterPaint } from "../../../diagnostics/midiLatencyPaint";
import {
  isPracticeAnswerCorrect,
  getTargetMidiNoteNumber,
  normalizeAnswerPitchMode,
  type PracticeAnswerInput,
} from "../../../domain/answerInput";
import { createMelodyGenerationState } from "../../../domain/melody";
import { ANSWER_BUTTONS, getNotesForSelection } from "../../../domain/notes";
import { getEffectivePracticeNotes } from "../../../domain/practiceComparison";
import {
  selectNextNote,
  selectNotePage,
  type AdaptiveNoteScheduler,
} from "../../../domain/scheduler";
import type { SessionProgressMode } from "../../../domain/sessionProgress";
import { filterLongTermReviews } from "../../../domain/stats";
import type {
  AppSettings,
  AnswerPitchMode,
  DuetPracticeLevel,
  InterruptReason,
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PracticeSessionStartSnapshot,
  PromptDisplayMode,
  PromptNoteDuration,
  PianoKeyName,
  ReviewRecord,
  Staff,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import type { MetronomeController } from "../../metronome/useMetronomeController";
import { resolveHistoryLimit } from "../../../shared/components/HistoryLimitControl";
import {
  isInteractiveShortcutTarget,
  shouldHandleGlobalEnter,
} from "../../../shared/keyboard/keyboardShortcuts";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/sessionProgressPreferences";
import { PauseOverlay } from "../../../shared/components/PauseOverlay";
import { PracticeQuestionLimitDialog } from "../../../shared/components/PracticeQuestionLimitDialog";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { LoadingActivityText } from "../../../shared/components/LoadingActivity";
import { B6SwiftF0ReminderDialog } from "../../vocal-pitch/components/B6SwiftF0ReminderDialog";
import type { PracticePagePreferences } from "../../../shared/preferences/practicePagePreferences";
import type { PracticeDistanceMode } from "../../../routing/appRoutes";
import { VirtualPianoKeyboard } from "../../../shared/components/VirtualPianoKeyboard";
import { isNaturalPianoKey, NATURAL_PIANO_KEYS } from "../../../shared/components/pianoKeyNames";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffPrompt } from "./StaffPrompt";
import { ReturnToCurrentNoteButton } from "./ReturnToCurrentNoteButton";
import {
  DUET_PRACTICE_PAGE_STAFF_LAYOUT,
  MOBILE_DUET_PRACTICE_PAGE_STAFF_LAYOUT,
  MOBILE_PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_STAFF_WIDTH_TUNING,
  getPracticeStaffMeasureAreaWidthPx,
  getPracticeStaffMeasuresPerRow,
} from "../../../shared/staff/staffLayoutProfiles";
import {
  chunkStaffPageGroupsByAdaptiveMeasureWidth,
  buildStaffPageView,
  DESKTOP_STAFF_PAGE_NOTE_COUNT,
  DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT,
  DUET_DESKTOP_MEASURES_PER_ROW,
  DUET_MOBILE_STAFF_PAGE_NOTE_COUNT,
  DUET_MOBILE_MEASURES_PER_ROW,
  getStaffPageRowIndex,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "../logic/staffPageFlow";
import {
  getQuarterNoteBeats,
  PROMPT_NOTE_DURATIONS,
  type GeneratedStaffPageRhythm,
} from "../logic/staffPageNotation";
import type { ScoreChaseEvent } from "../logic/scoreChase";
import {
  DEFAULT_SCORE_CHASE_PREFERENCES,
  SCORE_CHASE_SPEED_OPTIONS,
  uniformFreePracticeChaseSegmentDuration,
} from "../logic/scoreChase";
import { useScoreChase } from "../hooks/useScoreChase";
import { useSongRowPlayback, type SongRowPlaybackNote } from "../song-practice/useSongRowPlayback";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/staffPageUiPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useDelayedBusy } from "../../../shared/hooks/useDelayedBusy";
import { usePracticeTimers } from "../hooks/usePracticeTimers";
import {
  usePracticeSessionLifecycle,
  type PracticePromptRuntime as PromptRuntime,
  type PracticeStaffPageRuntime as StaffPageRuntime,
} from "../hooks/usePracticeSessionLifecycle";
import { usePracticeInput } from "../hooks/usePracticeInput";
import { usePracticeSessionState } from "../hooks/usePracticeSessionState";
import { usePracticeSessionStart } from "../hooks/usePracticeSessionStart";
import {
  usePracticeAnswerFlow,
  type PracticeAnswerOutcomePolicy,
} from "../hooks/usePracticeAnswerFlow";
import { usePreReadingPracticeController } from "../hooks/usePreReadingPracticeController";
import { usePreReadingPracticePreferences } from "../hooks/usePreReadingPracticePreferences";
import { usePracticeStaffPageFlow } from "../hooks/usePracticeStaffPageFlow";
import { usePracticeSummaryData } from "../hooks/usePracticeSummaryData";
import { PracticeSummaryView } from "./PracticeSummaryView";
import { PracticeFullscreenToggle } from "./PracticeFullscreenFrame";
import { StaffDistancePracticeView } from "./StaffDistancePracticeView";
import {
  PracticeSetupView,
  type PracticeSetupTab,
  type PracticeSetupUiPreferences,
} from "./PracticeSetupView";
import { SongPracticeView } from "../song-practice/SongPracticeView";
import { NameToKeyPracticeView } from "../name-to-key/NameToKeyPracticeView";
import {
  PracticeChaseSettingsDialog,
  type PracticeChaseSettings,
} from "./PracticeChaseSettingsDialog";
import type {
  SongPracticeInputMode,
  SongPracticeSelection,
} from "../song-practice/songPracticeMaterials";
import { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { type PracticeMicrophonePreferences } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  ensurePracticeMicrophoneForResume,
  releasePracticeMicrophoneOnPause,
} from "../logic/practiceInputLifecycle";
import {
  DEFAULT_DUET_PRACTICE_RANGE_PRESET,
  getDuetPracticeGroupIds,
  getDuetTargetMidis,
  normalizeDuetPracticeRangePreset,
  type DuetTargetPair,
} from "../logic/duetPractice";
import {
  getPracticeBeatAtAudioTime,
  getPracticeAudioTimeAtBeat,
  getPracticeTimingGrade,
  getPracticeTimingWindowMs,
  PRACTICE_PROGRESS_MARKER_LEAD_SECONDS,
  PRACTICE_TEMPO_ANCHOR_HISTORY_LIMIT,
  type PracticeTempoAnchor,
} from "../logic/practiceMetronomeSync";
import {
  DUET_PRACTICE_CURRICULUM_VERSION,
  DUET_PROMPT_TIMEOUT_MS,
  normalizeDuetPracticeLevel,
} from "../logic/duetPractice";

const FREE_STAFF_ROW_PREVIEW_TEMPO_BPM = 60;

interface PracticeViewProps {
  midi: MidiInputController;
  metronomeController: MetronomeController;
  practiceMicrophonePreferences: PracticeMicrophonePreferences;
  practicePagePreferences: PracticePagePreferences;
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onNavigationExit?: (targetView: PracticeNavigationExitTarget) => void;
  onSettingsSaved: (
    settings: AppSettings,
    options?: { feedback?: boolean }
  ) => void | Promise<void>;
  onDataChanged: () => Promise<void>;
  onOpenStats: () => void;
  onBeforePracticeStart: () => Promise<PracticeStartPreflightResult>;
  onPracticeDistanceModeChange: (mode: PracticeDistanceMode, replace?: boolean) => void;
  onPracticeTabChange: (tab: PracticeSetupTab) => void;
  onPracticeFinished: () => void;
  onPracticeStageChange: (active: boolean) => void;
  onFullscreenAvailabilityChange: (active: boolean) => void;
  onVirtualKeyboardActiveChange: (active: boolean) => void;
  onInputModeChange: (mode: PracticeInputMode) => void;
  practiceTab: PracticeSetupTab;
  practiceDistanceMode?: PracticeDistanceMode;
  isLearningRoutePractice?: boolean;
  onRunningChange: (running: boolean) => void;
  onMetronomeSyncToggleChange?: (toggle: (() => void) | undefined) => void;
  onMetronomeSyncPauseChange?: (pause: (() => void) | undefined) => void;
  showPracticeKindTabs?: boolean;
  practiceModeLock?: "single" | "duet";
  practiceProfile?: "pre-reading";
}

export type PracticeNavigationExitTarget =
  "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome";

export type PracticeInputMode = "midi" | "virtual-keyboard" | "microphone";

export interface PracticeStartPreflightResult {
  proceed: boolean;
  reviews?: ReviewRecord[];
  settings?: AppSettings;
}

export interface PracticeNavigationExitRequest {
  id: number;
  returnToSetup?: boolean;
  targetView: PracticeNavigationExitTarget;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const STAFF_PAGE_SCROLL_DURATION_MS = 200;
const MELODY_BUFFER_SIZE = 16;
const PRACTICE_SETUP_UI_PREFERENCES_KEY = "anki-note.practiceSetupUiPreferences";
const PRACTICE_MODES: readonly PracticeMode[] = ["open-ended", "fixed-count", "fixed-duration"];
const PROMPT_DISPLAY_MODES: readonly PromptDisplayMode[] = ["single-note", "staff-page"];

const PRACTICE_QUEUE_STRATEGIES: readonly PracticeQueueStrategy[] = [
  "adaptive",
  "focused",
  "melody",
  "note-drill",
];
const CROSS_GROUP_NOTE_RATE = 0.08;

function pickRangeExtensionNote(
  notes: readonly TargetNote[],
  lastTargetNoteId?: TargetNoteId
): TargetNote | undefined {
  const eligible = notes.filter((note) => note.id !== lastTargetNoteId);
  const pool = eligible.length > 0 ? eligible : notes;
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === "string" && PRACTICE_MODES.includes(value as PracticeMode);
}

function isPromptDisplayMode(value: unknown): value is PromptDisplayMode {
  return typeof value === "string" && PROMPT_DISPLAY_MODES.includes(value as PromptDisplayMode);
}

function isPromptNoteDuration(value: unknown): value is PromptNoteDuration {
  return typeof value === "string" && PROMPT_NOTE_DURATIONS.includes(value as PromptNoteDuration);
}

function normalizePromptNoteDurations(
  value: unknown,
  fallback: readonly PromptNoteDuration[]
): PromptNoteDuration[] {
  const candidates = Array.isArray(value) ? value.filter(isPromptNoteDuration) : [...fallback];
  const selected = new Set(candidates);
  const normalized = PROMPT_NOTE_DURATIONS.filter((duration) => selected.has(duration));
  return normalized.length > 0 ? normalized : [...fallback];
}

function isPracticeQueueStrategy(value: unknown): value is PracticeQueueStrategy {
  return (
    typeof value === "string" && PRACTICE_QUEUE_STRATEGIES.includes(value as PracticeQueueStrategy)
  );
}

function normalizeFixedCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : fallback;
}

function normalizeFixedDurationSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(60, Math.round(parsed)) : fallback;
}

function normalizeDrillNoteNames(value: unknown, fallback: NoteName[]): NoteName[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const selected = new Set(
    value.filter((noteName): noteName is string => typeof noteName === "string")
  );
  return ANSWER_BUTTONS.map((button) => button.noteName).filter((noteName) =>
    selected.has(noteName)
  );
}

function makeDefaultPracticeSetupUiPreferences(settings: AppSettings): PracticeSetupUiPreferences {
  const promptNoteDurations = normalizePromptNoteDurations(settings.promptNoteDurations, [
    settings.promptNoteDuration ?? "quarter",
  ]);
  return {
    answerPitchMode: settings.answerPitchMode,
    practiceMode: "single",
    metronomeSyncEnabled: false,
    duetLevel: "level-1",
    duetRangePreset: DEFAULT_DUET_PRACTICE_RANGE_PRESET,
    duetCurriculumVersion: DUET_PRACTICE_CURRICULUM_VERSION,
    duetAllowDottedRhythms: false,
    autoPlayTarget: settings.autoPlayTarget,
    midiAutoPlayTarget: false,
    chaseEnabled: DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
    chaseHandMode: "both",
    chasePreferencesVersion: 2,
    chaseSpeedMultiplier: DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier,
    chaseStartCount: DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
    playAnswerNote: settings.playAnswerNote,
    midiPlayAnswerNote: false,
    drillNoteNames: resolveDrillNoteNames(settings),
    fixedCount: settings.fixedCount,
    fixedDurationSeconds: settings.fixedDurationSeconds,
    mode: settings.defaultMode,
    promptDisplayMode:
      promptNoteDurations.length > 1 ? "staff-page" : (settings.promptDisplayMode ?? "staff-page"),
    promptNoteDuration: promptNoteDurations[0]!,
    promptNoteDurations,
    queueStrategy: resolveQueueStrategy(settings),
  };
}

function parsePracticeSetupUiPreferences(
  value: unknown,
  fallback: PracticeSetupUiPreferences
): PracticeSetupUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  const migrateLegacyChaseDefaults =
    value.chasePreferencesVersion !== 2 &&
    value.chaseSpeedMultiplier === 1.5 &&
    value.chaseStartCount === 4;
  const promptNoteDurations = normalizePromptNoteDurations(value.promptNoteDurations, [
    isPromptNoteDuration(value.promptNoteDuration)
      ? value.promptNoteDuration
      : fallback.promptNoteDuration,
  ]);
  const duetCurriculumVersion =
    typeof value.duetCurriculumVersion === "number" ? value.duetCurriculumVersion : undefined;

  return {
    answerPitchMode: normalizeAnswerPitchMode(value.answerPitchMode, fallback.answerPitchMode),
    practiceMode: value.practiceMode === "duet" ? "duet" : "single",
    metronomeSyncEnabled:
      typeof value.metronomeSyncEnabled === "boolean" ? value.metronomeSyncEnabled : false,
    duetLevel: normalizeDuetPracticeLevel(
      value.duetLevel ?? value.duetDifficulty,
      duetCurriculumVersion
    ),
    duetRangePreset: normalizeDuetPracticeRangePreset(value.duetRangePreset),
    duetCurriculumVersion: DUET_PRACTICE_CURRICULUM_VERSION,
    duetAllowDottedRhythms:
      typeof value.duetAllowDottedRhythms === "boolean" ? value.duetAllowDottedRhythms : false,
    autoPlayTarget:
      typeof value.autoPlayTarget === "boolean" ? value.autoPlayTarget : fallback.autoPlayTarget,
    midiAutoPlayTarget:
      typeof value.midiAutoPlayTarget === "boolean" ? value.midiAutoPlayTarget : false,
    chaseEnabled:
      typeof value.chaseEnabled === "boolean"
        ? value.chaseEnabled
        : DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
    chaseHandMode:
      value.chaseHandMode === "left" ||
      value.chaseHandMode === "right" ||
      value.chaseHandMode === "both"
        ? value.chaseHandMode
        : "both",
    chasePreferencesVersion: 2,
    chaseSpeedMultiplier:
      !migrateLegacyChaseDefaults &&
      typeof value.chaseSpeedMultiplier === "number" &&
      SCORE_CHASE_SPEED_OPTIONS.some((speed) => speed === value.chaseSpeedMultiplier)
        ? value.chaseSpeedMultiplier
        : DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier,
    chaseStartCount:
      !migrateLegacyChaseDefaults &&
      typeof value.chaseStartCount === "number" &&
      Number.isInteger(value.chaseStartCount) &&
      value.chaseStartCount >= 2 &&
      value.chaseStartCount <= 12
        ? value.chaseStartCount
        : DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
    playAnswerNote:
      typeof value.playAnswerNote === "boolean" ? value.playAnswerNote : fallback.playAnswerNote,
    midiPlayAnswerNote:
      typeof value.midiPlayAnswerNote === "boolean" ? value.midiPlayAnswerNote : false,
    drillNoteNames: normalizeDrillNoteNames(value.drillNoteNames, fallback.drillNoteNames),
    fixedCount: normalizeFixedCount(value.fixedCount, fallback.fixedCount),
    fixedDurationSeconds: normalizeFixedDurationSeconds(
      value.fixedDurationSeconds,
      fallback.fixedDurationSeconds
    ),
    mode: isPracticeMode(value.mode) ? value.mode : fallback.mode,
    promptDisplayMode:
      promptNoteDurations.length > 1
        ? "staff-page"
        : isPromptDisplayMode(value.promptDisplayMode)
          ? value.promptDisplayMode
          : fallback.promptDisplayMode,
    promptNoteDuration: promptNoteDurations[0]!,
    promptNoteDurations,
    queueStrategy: isPracticeQueueStrategy(value.queueStrategy)
      ? value.queueStrategy === "focused"
        ? "adaptive"
        : value.queueStrategy
      : fallback.queueStrategy,
  };
}

export function PracticeView({
  midi,
  metronomeController,
  practiceMicrophonePreferences,
  practicePagePreferences,
  settings,
  sessions,
  reviews,
  navigationExitRequest,
  onNavigationExit,
  onSettingsSaved,
  onDataChanged,
  onOpenStats,
  onBeforePracticeStart,
  onPracticeDistanceModeChange,
  onPracticeTabChange,
  onPracticeFinished,
  onPracticeStageChange,
  onFullscreenAvailabilityChange,
  onVirtualKeyboardActiveChange,
  onInputModeChange,
  practiceTab,
  onRunningChange,
  onMetronomeSyncToggleChange,
  onMetronomeSyncPauseChange,
  practiceDistanceMode,
  isLearningRoutePractice = false,
  showPracticeKindTabs = true,
  practiceModeLock,
  practiceProfile,
}: PracticeViewProps): JSX.Element {
  const isPreReadingPractice = practiceProfile === "pre-reading";
  const freePracticeCopy = isPreReadingPractice
    ? {
        title: "提前识谱",
        description: "打破逐音视奏，训练眼睛走在手的前面。",
      }
    : practiceModeLock === "single"
      ? {
          title: "单音极速反应",
          description: "看谱后迅速识别音高并作答，练习连续、轻松的单手反应。",
        }
      : practiceModeLock === "duet"
        ? {
            title: "双手协同",
            description: "同时跟踪高低声部，让左右手在同一节奏中协作。",
          }
        : {
            title: "自由练习",
            description: "看到音符后，快速识别音高并找到对应琴键。",
          };
  const {
    audioError: metronomeAudioError,
    getAudioTime: getMetronomeAudioTime,
    isPlaying: isMetronomePlaying,
    performanceTimeToAudioTime,
    scheduleAtAudioTime,
    preferences: metronomePreferences,
    prepare: prepareMetronome,
    setSyncLocked: setMetronomeSyncLocked,
    start: startMetronome,
    stop: stopMetronome,
    subscribeBeat: subscribeMetronomeBeat,
  } = metronomeController;
  const defaultPracticeSetupUiPreferences = useMemo(
    () => makeDefaultPracticeSetupUiPreferences(settings),
    [settings]
  );
  const [practiceSetupPreferences, setPracticeSetupPreferences] = useLocalStorageState(
    PRACTICE_SETUP_UI_PREFERENCES_KEY,
    defaultPracticeSetupUiPreferences,
    { parse: parsePracticeSetupUiPreferences }
  );
  const {
    bufferSize: preReadingBufferSize,
    metronomeSyncEnabled: preReadingMetronomeSyncEnabled,
    setBufferSize: setPreReadingBufferSize,
    setMetronomeSyncEnabled: setPreReadingMetronomeSyncEnabled,
  } = usePreReadingPracticePreferences();
  const [sessionProgressPreferences, setSessionProgressPreferences] = useLocalStorageState(
    SESSION_PROGRESS_UI_PREFERENCES_KEY,
    DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
    { parse: parseSessionProgressUiPreferences }
  );
  const [staffPageUiPreferences, setStaffPageUiPreferences] = useLocalStorageState(
    STAFF_PAGE_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    { parse: parseStaffPageUiPreferences }
  );
  const {
    beginSessionState,
    completedCount,
    currentNote,
    finishSessionState,
    phase,
    session,
    wrongAnswerCount,
    setCompletedCount,
    setCurrentNote,
    setPhase,
    summary,
    setWrongAnswerCount,
  } = usePracticeSessionState();
  const [feedback, setFeedback] = useState<{
    diagnosticSampleId?: number;
    staffPageIndex?: number;
    type: "wrong" | "correct";
    noteName?: NoteName;
    staff?: Staff;
  } | null>(null);
  const [songPracticeSelection, setSongPracticeSelection] = useState<SongPracticeSelection | null>(
    null
  );
  const [distanceInputMode, setDistanceInputMode] = useState<PracticeInputMode | null>(null);
  const [nameKeyInputMode, setNameKeyInputMode] = useState<PracticeInputMode | null>(null);
  const [songInputMode, setSongInputMode] = useState<PracticeInputMode | null>(null);
  const midiConnectedRef = useRef(midi.isConnected);
  midiConnectedRef.current = midi.isConnected;
  const previousMidiConnectionRef = useRef(midi.isConnected);
  const answerPitchModeSelectionRevisionRef = useRef(0);
  const [isStaffDistanceRunning, setIsStaffDistanceRunning] = useState(false);
  const [isStaffDistanceStageActive, setIsStaffDistanceStageActive] = useState(false);
  const [isStaffDistanceFullscreenActive, setIsStaffDistanceFullscreenActive] = useState(false);
  const [isNameToKeyRunning, setIsNameToKeyRunning] = useState(false);
  const [isNameToKeyStageActive, setIsNameToKeyStageActive] = useState(false);
  const [isSongPracticeFullscreenActive, setIsSongPracticeFullscreenActive] = useState(false);
  const [isChaseSettingsOpen, setIsChaseSettingsOpen] = useState(false);
  const [isRestartingPractice, setIsRestartingPractice] = useState(false);
  const handleStaffDistanceStageChange = useCallback(
    (active: boolean): void => {
      setIsStaffDistanceStageActive(active);
      onPracticeStageChange(active);
    },
    [onPracticeStageChange]
  );
  const handleNameToKeyStageChange = useCallback(
    (active: boolean): void => {
      setIsNameToKeyStageActive(active);
      onPracticeStageChange(active);
    },
    [onPracticeStageChange]
  );
  const fullscreenAvailable =
    phase === "running" ||
    isStaffDistanceFullscreenActive ||
    isNameToKeyStageActive ||
    isSongPracticeFullscreenActive;

  useEffect(() => {
    onFullscreenAvailabilityChange(fullscreenAvailable);
  }, [fullscreenAvailable, onFullscreenAvailabilityChange]);
  const songPracticeMicrophoneAnswerRef = useRef<(answer: PracticeAnswerInput) => void>(() => {});
  const nameToKeyMicrophoneAnswerRef = useRef<((answer: PracticeAnswerInput) => void) | null>(null);
  const freeRowPlaybackActiveRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [staffPageNotes, setStaffPageNotes] = useState<TargetNote[]>([]);
  const [staffPageNoteGroups, setStaffPageNoteGroups] = useState<TargetNote[][]>([]);
  const [staffPageRhythm, setStaffPageRhythm] = useState<GeneratedStaffPageRhythm | undefined>();
  const [staffPageIndex, setStaffPageIndex] = useState(0);
  const [staffPageCompletedCount, setStaffPageCompletedCount] = useState(0);
  const [staffPageFirstNoteOffset, setStaffPageFirstNoteOffset] = useState(0);
  const [freeTrackedNoteVisibility, setFreeTrackedNoteVisibility] = useState<{
    noteOffset: number;
    visible: boolean;
  } | null>(null);
  const staffPagePromptContainerRef = useRef<HTMLDivElement | null>(null);
  const [staffPageRendererWidthPx, setStaffPageRendererWidthPx] = useState(0);
  const [syncCountInBeat, setSyncCountInBeat] = useState<number | null>(null);
  const [syncProgressMarkerLeadEnabled, setSyncProgressMarkerLeadEnabled] = useState(false);
  const [syncTimingFeedback, setSyncTimingFeedback] = useState<
    Array<{
      noteIndex: number;
      staff: Staff;
      midi?: number;
      result: "matched" | "missed" | "offbeat";
    }>
  >([]);
  const [isStaffPageScrolling, setIsStaffPageScrolling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isQuestionLimitReached, setIsQuestionLimitReached] = useState(false);
  const questionLimitReachedRef = useRef(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches
  );
  const { isBusyVisible: showStartingSessionStatus, run: runSessionStart } = useDelayedBusy();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );

  const runningStartSnapshot =
    phase === "running" &&
    (session?.schemaVersion === 3 || session?.schemaVersion === 4 || session?.schemaVersion === 5)
      ? session.startSnapshot
      : undefined;
  const isDuetPractice = runningStartSnapshot
    ? runningStartSnapshot.practiceConfig.duetLevel !== undefined ||
      runningStartSnapshot.practiceConfig.duetDifficulty !== undefined
    : practiceTab === "free" &&
      (practiceModeLock ?? practiceSetupPreferences.practiceMode) === "duet";
  const duetLevel = runningStartSnapshot
    ? normalizeDuetPracticeLevel(
        runningStartSnapshot.practiceConfig.duetLevel ??
          runningStartSnapshot.practiceConfig.duetDifficulty,
        runningStartSnapshot.practiceConfig.duetCurriculumVersion
      )
    : isDuetPractice
      ? practiceSetupPreferences.duetLevel
      : undefined;
  const duetAllowDottedRhythms =
    runningStartSnapshot?.practiceConfig.duetAllowDottedRhythms ??
    practiceSetupPreferences.duetAllowDottedRhythms;
  const duetRangePreset = normalizeDuetPracticeRangePreset(
    practiceSetupPreferences.duetRangePreset
  );
  const answerPitchMode = isDuetPractice
    ? "exact-pitch"
    : runningStartSnapshot
      ? normalizeAnswerPitchMode(runningStartSnapshot.practiceConfig.answerPitchMode)
      : normalizeAnswerPitchMode(practiceSetupPreferences.answerPitchMode);
  const requiresMidiStaffPage = practiceTab === "free" && answerPitchMode === "exact-pitch";
  const isMetronomeSyncMandatory = practiceTab === "free" && isDuetPractice;
  const supportsMetronomeSyncNoteDurations =
    practiceSetupPreferences.promptNoteDurations.length > 0 &&
    practiceSetupPreferences.promptNoteDurations.every(
      (duration) => duration === "whole" || duration === "quarter"
    );
  const isMetronomeSyncSelected =
    practiceTab === "free" &&
    !isDuetPractice &&
    answerPitchMode === "exact-pitch" &&
    supportsMetronomeSyncNoteDurations &&
    (isPreReadingPractice
      ? preReadingMetronomeSyncEnabled
      : practiceSetupPreferences.metronomeSyncEnabled);
  const shouldSynchronizeMetronome = isMetronomeSyncMandatory || isMetronomeSyncSelected;
  const activePracticeInputMode: PracticeInputMode | null =
    practiceTab === "free"
      ? answerPitchMode === "microphone"
        ? "microphone"
        : answerPitchMode === "note-name"
          ? "virtual-keyboard"
          : "midi"
      : practiceTab === "distance"
        ? distanceInputMode
        : practiceTab === "name-key"
          ? nameKeyInputMode
          : songPracticeSelection
            ? (songInputMode ??
              (songPracticeSelection.inputMode === "virtual"
                ? "virtual-keyboard"
                : songPracticeSelection.inputMode))
            : midi.isConnected
              ? "midi"
              : "microphone";

  useLayoutEffect(() => {
    if (activePracticeInputMode) onInputModeChange(activePracticeInputMode);
  }, [activePracticeInputMode, onInputModeChange]);
  const mode = runningStartSnapshot?.practiceConfig.mode ?? practiceSetupPreferences.mode;
  const promptDisplayMode = isPreReadingPractice
    ? "staff-page"
    : isDuetPractice || requiresMidiStaffPage
      ? "staff-page"
      : (runningStartSnapshot?.presentationConfig.promptDisplayMode ??
        practiceSetupPreferences.promptDisplayMode);
  const isContinuousStaffPage = practiceTab === "free" && promptDisplayMode === "staff-page";
  const isMobileStaffPage = isMobileViewport && promptDisplayMode === "staff-page";
  const responsivePracticeStaffLayout = isDuetPractice
    ? isMobileStaffPage
      ? MOBILE_DUET_PRACTICE_PAGE_STAFF_LAYOUT
      : DUET_PRACTICE_PAGE_STAFF_LAYOUT
    : isMobileStaffPage
      ? MOBILE_PRACTICE_PAGE_STAFF_LAYOUT
      : PRACTICE_PAGE_STAFF_LAYOUT;
  const fallbackRendererWidthPx = isMobileStaffPage
    ? typeof window !== "undefined"
      ? window.innerWidth
      : 360
    : isContinuousStaffPage
      ? Math.min(
          typeof window !== "undefined"
            ? window.innerWidth
            : PRACTICE_PAGE_STAFF_LAYOUT.width.maxPx,
          PRACTICE_PAGE_STAFF_LAYOUT.width.maxPx
        )
      : responsivePracticeStaffLayout.width.maxPx;
  const adaptiveRendererWidthPx = staffPageRendererWidthPx || fallbackRendererWidthPx;
  const adaptiveMeasureAreaWidthPx = getPracticeStaffMeasureAreaWidthPx(
    adaptiveRendererWidthPx,
    responsivePracticeStaffLayout.horizontal
  );
  const adaptiveMeasuresPerRow = getPracticeStaffMeasuresPerRow(
    adaptiveRendererWidthPx,
    responsivePracticeStaffLayout.horizontal,
    PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
  );

  useLayoutEffect(() => {
    if (phase !== "running" || promptDisplayMode !== "staff-page") {
      setStaffPageRendererWidthPx(0);
      return undefined;
    }

    const prompt = staffPagePromptContainerRef.current;
    const renderer = prompt?.querySelector<HTMLElement>(".staff-page-renderer");
    if (!renderer) return undefined;

    let resizeTimer = 0;
    let lastObservedWidth = renderer.clientWidth;
    const commitWidth = (width: number): void => {
      if (!Number.isFinite(width) || width <= 0) return;
      if (
        Math.abs(width - lastObservedWidth) < PRACTICE_STAFF_WIDTH_TUNING.resizeWidthThresholdPx
      ) {
        return;
      }
      lastObservedWidth = width;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setStaffPageRendererWidthPx((current) =>
          Math.abs(current - width) < PRACTICE_STAFF_WIDTH_TUNING.resizeWidthThresholdPx
            ? current
            : width
        );
      }, PRACTICE_STAFF_WIDTH_TUNING.resizeDebounceMs);
    };

    const initialWidth = renderer.clientWidth;
    if (initialWidth > 0) {
      lastObservedWidth = initialWidth;
      setStaffPageRendererWidthPx((current) =>
        Math.abs(current - initialWidth) < PRACTICE_STAFF_WIDTH_TUNING.resizeWidthThresholdPx
          ? current
          : initialWidth
      );
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? renderer.clientWidth;
      commitWidth(width);
    });
    observer.observe(renderer);

    return () => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
    };
  }, [phase, promptDisplayMode]);
  const isMetronomeSyncActive =
    phase === "running" &&
    practiceTab === "free" &&
    runningStartSnapshot?.practiceConfig.metronomeSync === true &&
    answerPitchMode === "exact-pitch" &&
    promptDisplayMode === "staff-page";
  const metronomeSyncActiveRef = useRef(isMetronomeSyncActive);
  metronomeSyncActiveRef.current = isMetronomeSyncActive;
  const promptNoteDurations = useMemo(
    () =>
      runningStartSnapshot
        ? normalizePromptNoteDurations(
            runningStartSnapshot.presentationConfig.promptNoteDurations,
            [runningStartSnapshot.presentationConfig.promptNoteDuration]
          )
        : practiceSetupPreferences.promptNoteDurations,
    [practiceSetupPreferences.promptNoteDurations, runningStartSnapshot]
  );
  const promptNoteDuration =
    runningStartSnapshot?.presentationConfig.promptNoteDuration ??
    practiceSetupPreferences.promptNoteDuration;
  const fixedCount =
    runningStartSnapshot?.practiceConfig.fixedCount ?? practiceSetupPreferences.fixedCount;
  const fixedDurationSeconds =
    runningStartSnapshot?.practiceConfig.fixedDurationSeconds ??
    practiceSetupPreferences.fixedDurationSeconds;
  const autoPlayTarget =
    runningStartSnapshot?.presentationConfig.autoPlayTarget ??
    (answerPitchMode === "exact-pitch"
      ? practiceSetupPreferences.midiAutoPlayTarget
      : practiceSetupPreferences.autoPlayTarget);
  const playAnswerNote =
    runningStartSnapshot?.presentationConfig.playAnswerNote ??
    (answerPitchMode === "exact-pitch"
      ? practiceSetupPreferences.midiPlayAnswerNote
      : practiceSetupPreferences.playAnswerNote);
  const queueStrategy =
    runningStartSnapshot?.practiceConfig.queueStrategy ?? practiceSetupPreferences.queueStrategy;
  const drillNoteNames =
    runningStartSnapshot?.practiceConfig.drillNoteNames ?? practiceSetupPreferences.drillNoteNames;
  const startPausedReading = staffPageUiPreferences.startPausedReading;
  const effectivePromptNoteDuration =
    runningStartSnapshot?.presentationConfig.promptNoteDuration ?? promptNoteDuration;
  const staffPageScrollDurationMs =
    (runningStartSnapshot?.presentationConfig.smoothStaffPageScroll ??
      staffPageUiPreferences.smoothStaffPageScroll) &&
    !(runningStartSnapshot?.environment.prefersReducedMotion ?? prefersReducedMotion)
      ? STAFF_PAGE_SCROLL_DURATION_MS
      : 0;
  const summaryProgressMode = sessionProgressPreferences.mode;
  const summaryAllHistory = sessionProgressPreferences.allHistory;
  const summaryHistoryLimit = sessionProgressPreferences.historyLimit;
  const summaryEffectiveHistoryLimit = resolveHistoryLimit(
    summaryHistoryLimit,
    summaryAllHistory,
    sessions.length
  );
  const setMode = (nextMode: PracticeMode): void => {
    setPracticeSetupPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setAnswerPitchMode = useCallback(
    (nextAnswerPitchMode: AnswerPitchMode): void => {
      answerPitchModeSelectionRevisionRef.current += 1;
      setPracticeSetupPreferences((current) => ({
        ...current,
        answerPitchMode: nextAnswerPitchMode,
      }));
    },
    [setPracticeSetupPreferences]
  );
  useEffect(() => {
    const wasConnected = previousMidiConnectionRef.current;
    previousMidiConnectionRef.current = midi.isConnected;
    if (
      wasConnected ||
      !midi.isConnected ||
      phase !== "setup" ||
      practiceTab !== "free" ||
      isDuetPractice ||
      answerPitchMode !== "microphone"
    ) {
      return;
    }

    setAnswerPitchMode("exact-pitch");
    const autoSwitchRevision = answerPitchModeSelectionRevisionRef.current;
    toast.message("已切换到你上次选择的 MIDI 设备", {
      action: {
        label: "撤销",
        onClick: () => {
          if (answerPitchModeSelectionRevisionRef.current === autoSwitchRevision) {
            setAnswerPitchMode("microphone");
          }
        },
      },
      duration: 5000,
    });
  }, [
    answerPitchMode,
    isDuetPractice,
    midi.isConnected,
    phase,
    practiceTab,
    setAnswerPitchMode,
    setPracticeSetupPreferences,
  ]);
  const setPracticeMode = (nextPracticeMode: "single" | "duet"): void => {
    setPracticeSetupPreferences((current) => ({ ...current, practiceMode: nextPracticeMode }));
  };
  const setDuetLevel = (nextDuetLevel: DuetPracticeLevel): void => {
    setPracticeSetupPreferences((current) => ({ ...current, duetLevel: nextDuetLevel }));
  };
  const setDuetRangePreset = (preset: PracticeSetupUiPreferences["duetRangePreset"]): void => {
    setPracticeSetupPreferences((current) => ({ ...current, duetRangePreset: preset }));
  };
  const setDuetAllowDottedRhythms = (enabled: boolean): void => {
    setPracticeSetupPreferences((current) => ({ ...current, duetAllowDottedRhythms: enabled }));
  };
  const setMetronomeSyncEnabled = (enabled: boolean): void => {
    if (isPreReadingPractice) {
      setPreReadingMetronomeSyncEnabled(enabled);
      return;
    }
    setPracticeSetupPreferences((current) => ({ ...current, metronomeSyncEnabled: enabled }));
  };
  const setPromptDisplayMode = (nextPromptDisplayMode: PromptDisplayMode): void => {
    if (isPreReadingPractice) return;
    setPracticeSetupPreferences((current) =>
      requiresMidiStaffPage ||
      (nextPromptDisplayMode === "single-note" && current.promptNoteDurations.length > 1)
        ? current
        : { ...current, promptDisplayMode: nextPromptDisplayMode }
    );
  };
  const setPromptNoteDurations = (nextPromptNoteDurations: PromptNoteDuration[]): void => {
    const normalized = PROMPT_NOTE_DURATIONS.filter((duration) =>
      nextPromptNoteDurations.includes(duration)
    );
    if (normalized.length === 0) return;
    setPracticeSetupPreferences((current) => ({
      ...current,
      promptDisplayMode: normalized.length > 1 ? "staff-page" : current.promptDisplayMode,
      promptNoteDuration: normalized[0]!,
      promptNoteDurations: normalized,
    }));
  };
  const setFixedCount = (nextFixedCount: number): void => {
    setPracticeSetupPreferences((current) => ({
      ...current,
      fixedCount: normalizeFixedCount(nextFixedCount, current.fixedCount),
    }));
  };
  const setFixedDurationSeconds = (nextFixedDurationSeconds: number): void => {
    setPracticeSetupPreferences((current) => ({
      ...current,
      fixedDurationSeconds: normalizeFixedDurationSeconds(
        nextFixedDurationSeconds,
        current.fixedDurationSeconds
      ),
    }));
  };
  const setAutoPlayTarget = (nextAutoPlayTarget: boolean): void => {
    setPracticeSetupPreferences((current) =>
      answerPitchMode === "exact-pitch"
        ? { ...current, midiAutoPlayTarget: nextAutoPlayTarget }
        : { ...current, autoPlayTarget: nextAutoPlayTarget }
    );
  };
  const setPlayAnswerNote = (nextPlayAnswerNote: boolean): void => {
    setPracticeSetupPreferences((current) =>
      answerPitchMode === "exact-pitch"
        ? { ...current, midiPlayAnswerNote: nextPlayAnswerNote }
        : { ...current, playAnswerNote: nextPlayAnswerNote }
    );
  };
  const setQueueStrategy = (nextQueueStrategy: PracticeQueueStrategy): void => {
    setPracticeSetupPreferences((current) => ({ ...current, queueStrategy: nextQueueStrategy }));
  };
  const setSummaryProgressMode = (nextMode: SessionProgressMode): void => {
    setSessionProgressPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setSummaryHistoryLimit = (nextHistoryLimit: number): void => {
    setSessionProgressPreferences((current) => ({ ...current, historyLimit: nextHistoryLimit }));
  };
  const setSummaryAllHistory = (allHistory: boolean): void => {
    setSessionProgressPreferences((current) => ({ ...current, allHistory }));
  };

  const promptRef = useRef<PromptRuntime | null>(null);
  const pendingEarlySyncAnswersRef = useRef<
    Array<{ targetIndex: number; answer: PracticeAnswerInput }>
  >([]);
  const sessionRef = useRef<PracticeSessionRecord | null>(null);
  const sessionStartSnapshotRef = useRef<PracticeSessionStartSnapshot | null>(null);
  const syncSessionRef = useRef(false);
  const syncRunningSeenRef = useRef(false);
  const syncStartInFlightRef = useRef(false);
  const preReadingSyncStartPendingRef = useRef(false);
  const syncAllowBeatWhilePausedRef = useRef(false);
  const startSynchronizedMetronomeRef = useRef<() => Promise<boolean>>(async () => false);
  const syncCountInStartSequenceRef = useRef<number | null>(null);
  const syncCountInBaseBeatRef = useRef(0);
  const syncTempoAnchorsRef = useRef<PracticeTempoAnchor[]>([]);
  const preReadingCountdownResetRef = useRef<() => void>(() => undefined);
  const sessionReviewsRef = useRef<ReviewRecord[]>([]);
  const lastTargetNoteIdRef = useRef<TargetNote["id"] | undefined>();
  const adaptiveSchedulerRef = useRef<AdaptiveNoteScheduler | null>(null);
  const melodyQueueRef = useRef<TargetNote[]>([]);
  const melodyGenerationStateRef = useRef(createMelodyGenerationState());
  const staffPageRef = useRef<StaffPageRuntime | null>(null);
  const endingRef = useRef(false);
  const isPausedRef = useRef(false);
  const pendingAfterPauseRef = useRef<(() => void) | null>(null);
  const answerInputLockedRef = useRef(false);
  const lastBackupCompletedRef = useRef(0);
  const lastBackupAtRef = useRef<number>(performance.now());
  const handledNavigationExitRequestIdRef = useRef<number | null>(null);
  const microphoneResumeInFlightRef = useRef(false);
  const prepareMicrophoneRecoveryReloadRef = useRef<() => Promise<void>>(async () => undefined);
  const practiceTimers = usePracticeTimers(promptRef);
  const {
    getPromptActiveMs,
    getPromptInactiveMs,
    getSessionActiveMs,
    markPromptInput,
    pauseActiveTimers,
    resetSessionActiveTimer,
    resumeActiveTimers,
  } = practiceTimers;
  const submitAnswerRef = useRef<(answer: PracticeAnswerInput) => void>(() => undefined);
  const staffDistanceMicrophoneAnswerRef = useRef<((answer: PracticeAnswerInput) => void) | null>(
    null
  );
  const practiceMicrophone = usePracticeMicrophoneInput(
    (answer) => {
      if (staffDistanceMicrophoneAnswerRef.current) {
        staffDistanceMicrophoneAnswerRef.current(answer);
      } else if (songPracticeSelection) {
        songPracticeMicrophoneAnswerRef.current(answer);
      } else if (nameToKeyMicrophoneAnswerRef.current) {
        nameToKeyMicrophoneAnswerRef.current(answer);
      } else {
        submitAnswerRef.current(answer);
      }
    },
    practiceMicrophonePreferences,
    {
      beforeRecoveryReload: () => prepareMicrophoneRecoveryReloadRef.current(),
    }
  );
  const preparePracticeMicrophone = practiceMicrophone.prepare;
  useEffect(() => {
    const microphoneInputSelected =
      (practiceTab === "free" && !isDuetPractice && answerPitchMode === "microphone") ||
      (practiceTab === "distance" && distanceInputMode === "microphone") ||
      (practiceTab === "name-key" && nameKeyInputMode === "microphone") ||
      (practiceTab === "songs" && !songPracticeSelection && !midi.isConnected);
    if (!microphoneInputSelected || practiceMicrophonePreferences.algorithm !== "swiftf0") {
      return;
    }
    void preparePracticeMicrophone().catch(() => undefined);
  }, [
    answerPitchMode,
    distanceInputMode,
    isDuetPractice,
    midi.isConnected,
    nameKeyInputMode,
    practiceTab,
    preparePracticeMicrophone,
    practiceMicrophonePreferences.algorithm,
    songPracticeSelection,
  ]);
  const registerSongPracticeMicrophoneAnswer = useCallback(
    (handler: (answer: PracticeAnswerInput) => void): void => {
      songPracticeMicrophoneAnswerRef.current = handler;
    },
    []
  );
  const registerNameToKeyMicrophoneAnswer = useCallback(
    (handler: ((answer: PracticeAnswerInput) => void) | null): void => {
      nameToKeyMicrophoneAnswerRef.current = handler;
    },
    []
  );
  const practiceMicrophoneStatus = practiceMicrophone.status;
  const stopPracticeMicrophone = practiceMicrophone.stop;

  useLayoutEffect(() => {
    const diagnosticSampleId = feedback?.diagnosticSampleId;
    if (diagnosticSampleId === undefined) {
      return undefined;
    }
    markMidiLatencyStage(diagnosticSampleId, "reactCommit");
    return markMidiLatencyAfterPaint(diagnosticSampleId, "paintApprox");
  }, [feedback]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const onChange = (): void => setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    onRunningChange(phase === "running" || isStaffDistanceRunning || isNameToKeyRunning);
  }, [isNameToKeyRunning, isStaffDistanceRunning, onRunningChange, phase]);

  useLayoutEffect(() => {
    onVirtualKeyboardActiveChange(phase === "running" && answerPitchMode === "note-name");
    return () => onVirtualKeyboardActiveChange(false);
  }, [answerPitchMode, onVirtualKeyboardActiveChange, phase]);

  useEffect(() => () => onRunningChange(false), [onRunningChange]);

  const applySettingsSnapshot = useCallback(
    (nextSettings: AppSettings): void => {
      setPracticeSetupPreferences((current) => ({
        ...makeDefaultPracticeSetupUiPreferences(nextSettings),
        practiceMode: current.practiceMode,
        metronomeSyncEnabled: current.metronomeSyncEnabled,
        duetLevel: current.duetLevel,
        duetRangePreset: current.duetRangePreset,
        duetCurriculumVersion: current.duetCurriculumVersion,
        duetAllowDottedRhythms: current.duetAllowDottedRhythms,
        midiAutoPlayTarget: current.midiAutoPlayTarget,
        midiPlayAnswerNote: current.midiPlayAnswerNote,
        chaseEnabled: current.chaseEnabled,
        chaseHandMode: current.chaseHandMode,
        chaseSpeedMultiplier: current.chaseSpeedMultiplier,
        chaseStartCount: current.chaseStartCount,
      }));
    },
    [setPracticeSetupPreferences]
  );

  const staffNotationMode = isDuetPractice
    ? "grand"
    : (runningStartSnapshot?.practiceConfig.staffNotationMode ?? settings.staffNotationMode);
  const preReadingRange = useMemo(
    () => settings.staffRangeProfiles?.[staffNotationMode] ?? settings,
    [settings, staffNotationMode]
  );
  const effectiveEnabledGroupIds = isDuetPractice
    ? (runningStartSnapshot?.practiceConfig.enabledGroupIds ??
      getDuetPracticeGroupIds(duetRangePreset))
    : (runningStartSnapshot?.practiceConfig.enabledGroupIds ??
      (isPreReadingPractice ? preReadingRange.enabledGroupIds : settings.enabledGroupIds));
  const effectiveEnabledPitchIds = isDuetPractice
    ? undefined
    : (runningStartSnapshot?.practiceConfig.enabledPitchIds ??
      (isPreReadingPractice ? preReadingRange.enabledPitchIds : settings.enabledPitchIds));
  const effectiveCrossGroupPitchIds = isDuetPractice
    ? undefined
    : (runningStartSnapshot?.practiceConfig.crossGroupPitchIds ??
      (isPreReadingPractice ? preReadingRange.crossGroupPitchIds : settings.crossGroupPitchIds));
  const effectiveInterStaffLedgerSpellings =
    staffNotationMode === "grand"
      ? false
      : (runningStartSnapshot?.practiceConfig.includeInterStaffLedgerSpellings ??
        settings.includeInterStaffLedgerSpellings);
  const enabledNotes = useMemo(
    () =>
      getNotesForSelection(
        effectiveEnabledGroupIds,
        effectiveEnabledPitchIds,
        effectiveCrossGroupPitchIds,
        effectiveInterStaffLedgerSpellings,
        staffNotationMode
      ),
    [
      effectiveEnabledGroupIds,
      effectiveEnabledPitchIds,
      effectiveCrossGroupPitchIds,
      effectiveInterStaffLedgerSpellings,
      staffNotationMode,
    ]
  );
  const coreEnabledNotes = useMemo(
    () =>
      getNotesForSelection(
        effectiveEnabledGroupIds,
        effectiveEnabledPitchIds,
        undefined,
        effectiveInterStaffLedgerSpellings,
        staffNotationMode
      ),
    [
      effectiveEnabledGroupIds,
      effectiveEnabledPitchIds,
      effectiveInterStaffLedgerSpellings,
      staffNotationMode,
    ]
  );
  const useLedgerGap = enabledNotes.some((note) => note.isInterStaffLedgerSpelling);
  const allQueueNotes = useMemo(
    () =>
      getEffectivePracticeNotes({
        crossGroupPitchIds: effectiveCrossGroupPitchIds,
        drillNoteNames,
        enabledGroupIds: effectiveEnabledGroupIds,
        enabledPitchIds: effectiveEnabledPitchIds,
        includeInterStaffLedgerSpellings: effectiveInterStaffLedgerSpellings,
        queueStrategy,
        staffNotationMode,
      }),
    [
      drillNoteNames,
      queueStrategy,
      effectiveEnabledGroupIds,
      effectiveEnabledPitchIds,
      effectiveCrossGroupPitchIds,
      effectiveInterStaffLedgerSpellings,
      staffNotationMode,
    ]
  );
  const coreQueueNotes = useMemo(
    () =>
      getEffectivePracticeNotes({
        drillNoteNames,
        enabledGroupIds: effectiveEnabledGroupIds,
        enabledPitchIds: effectiveEnabledPitchIds,
        includeInterStaffLedgerSpellings: effectiveInterStaffLedgerSpellings,
        queueStrategy,
        staffNotationMode,
      }),
    [
      drillNoteNames,
      queueStrategy,
      effectiveEnabledGroupIds,
      effectiveEnabledPitchIds,
      effectiveInterStaffLedgerSpellings,
      staffNotationMode,
    ]
  );
  const queueNotes = coreQueueNotes.length > 0 ? coreQueueNotes : allQueueNotes;
  const rangeExtensionNoteIds = useMemo(
    () => new Set(effectiveCrossGroupPitchIds ?? []),
    [effectiveCrossGroupPitchIds]
  );
  const rangeExtensionNotes = useMemo(
    () =>
      coreQueueNotes.length > 0
        ? allQueueNotes.filter((note) => rangeExtensionNoteIds.has(note.pitchId))
        : [],
    [allQueueNotes, coreQueueNotes.length, rangeExtensionNoteIds]
  );
  const effectiveTargetNoteIds = useMemo(
    () => new Set(allQueueNotes.map((note) => note.id)),
    [allQueueNotes]
  );
  const schedulerReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);
  const savePracticeSetupSettings = useCallback(
    (nextSettings: AppSettings): void | Promise<void> => {
      if (!isPreReadingPractice) return onSettingsSaved(nextSettings);
      return onSettingsSaved({
        ...settings,
        staffNotationMode: nextSettings.staffNotationMode,
        enabledGroupIds: nextSettings.enabledGroupIds,
        enabledPitchIds: nextSettings.enabledPitchIds,
        crossGroupPitchIds: nextSettings.crossGroupPitchIds,
        staffRangeProfiles: nextSettings.staffRangeProfiles,
        includeInterStaffLedgerSpellings: nextSettings.includeInterStaffLedgerSpellings,
      });
    },
    [isPreReadingPractice, onSettingsSaved, settings]
  );
  const setupSettings = useMemo<AppSettings>(
    () => ({
      ...settings,
      ...(isPreReadingPractice
        ? {
            staffRangeProfiles: {
              ...settings.staffRangeProfiles,
              [staffNotationMode]: preReadingRange,
            },
          }
        : {}),
      staffNotationMode,
      answerPitchMode,
      autoPlayTarget,
      playAnswerNote,
      defaultMode: mode,
      drillNoteNames,
      fixedCount,
      fixedDurationSeconds,
      focusedTraining: false,
      promptDisplayMode,
      promptNoteDuration,
      promptNoteDurations,
      queueStrategy,
    }),
    [
      answerPitchMode,
      autoPlayTarget,
      playAnswerNote,
      drillNoteNames,
      fixedCount,
      fixedDurationSeconds,
      isPreReadingPractice,
      mode,
      preReadingRange,
      promptDisplayMode,
      promptNoteDuration,
      promptNoteDurations,
      queueStrategy,
      settings,
      staffNotationMode,
    ]
  );

  const toggleDrillNoteName = useCallback(
    (noteName: NoteName, checked: boolean): void => {
      setPracticeSetupPreferences((current) => {
        const next = checked
          ? [...current.drillNoteNames, noteName]
          : current.drillNoteNames.filter((name) => name !== noteName);
        const selected = new Set(next);
        return {
          ...current,
          drillNoteNames: ANSWER_BUTTONS.map((button) => button.noteName).filter((name) =>
            selected.has(name)
          ),
        };
      });
    },
    [setPracticeSetupPreferences]
  );

  const markInterrupted = useCallback((reason: InterruptReason): void => {
    const prompt = promptRef.current;
    if (!prompt || prompt.interrupted) {
      return;
    }
    prompt.interrupted = true;
    prompt.interruptReason = reason;
  }, []);

  const pausePractice = useCallback(
    (interruptReason?: InterruptReason): void => {
      if (interruptReason) {
        markInterrupted(interruptReason);
      }
      releasePracticeMicrophoneOnPause(answerPitchMode, () =>
        stopPracticeMicrophone({
          captureStopReason: "practice-paused",
          preserveError: practiceMicrophoneStatus === "error",
        })
      );
      pauseActiveTimers();
      if (!isPausedRef.current) {
        isPausedRef.current = true;
        setIsPaused(true);
      }
      if (syncSessionRef.current) {
        syncCountInStartSequenceRef.current = null;
        syncTempoAnchorsRef.current = [];
        preReadingCountdownResetRef.current();
        setSyncProgressMarkerLeadEnabled(false);
        setSyncCountInBeat(null);
        stopMetronome();
      }
    },
    [
      answerPitchMode,
      markInterrupted,
      stopMetronome,
      pauseActiveTimers,
      practiceMicrophoneStatus,
      stopPracticeMicrophone,
    ]
  );

  const pauseAtQuestionLimit = useCallback((): void => {
    if (questionLimitReachedRef.current) return;
    questionLimitReachedRef.current = true;
    setIsQuestionLimitReached(true);
    pausePractice();
  }, [pausePractice]);

  const resumePractice = useCallback(async (): Promise<void> => {
    if (!isPausedRef.current) {
      return;
    }
    if (answerPitchMode === "exact-pitch" && !midi.isConnected) {
      return;
    }
    if (microphoneResumeInFlightRef.current) {
      return;
    }
    if (answerPitchMode === "microphone") {
      microphoneResumeInFlightRef.current = true;
      try {
        const microphoneReady = await ensurePracticeMicrophoneForResume({
          answerPitchMode,
          isListening: practiceMicrophone.isListening,
          startMicrophone: practiceMicrophone.start,
        });
        if (!microphoneReady || !isPausedRef.current || endingRef.current) {
          return;
        }
      } finally {
        microphoneResumeInFlightRef.current = false;
      }
    }
    const synchronizedPractice = metronomeSyncActiveRef.current;
    let pendingHandledBeforeCountIn = false;
    if (synchronizedPractice) {
      const pendingAfterPause = pendingAfterPauseRef.current;
      pendingAfterPauseRef.current = null;
      if (pendingAfterPause) {
        pendingAfterPause();
        pendingHandledBeforeCountIn = true;
      }
      syncAllowBeatWhilePausedRef.current = true;
      const metronomeStarted = await startSynchronizedMetronomeRef.current();
      if (!metronomeStarted || !isPausedRef.current || endingRef.current) {
        syncAllowBeatWhilePausedRef.current = false;
        return;
      }
    }
    isPausedRef.current = false;
    setIsPaused(false);
    syncAllowBeatWhilePausedRef.current = false;
    const pendingAfterPause = pendingAfterPauseRef.current;
    pendingAfterPauseRef.current = null;
    if (pendingAfterPause && !pendingHandledBeforeCountIn) {
      pendingAfterPause();
      return;
    }
    if (promptRef.current) {
      resumeActiveTimers();
      if (sessionStartSnapshotRef.current?.presentationConfig.autoPlayTarget ?? autoPlayTarget) {
        const prompt = promptRef.current;
        if (prompt.duetTargets) {
          void Promise.all(
            [...prompt.duetTargets.low, ...prompt.duetTargets.high].map((target) =>
              playTargetNote(target)
            )
          ).catch(() => undefined);
        } else {
          void playTargetNote(prompt.note).catch(() => undefined);
        }
      }
    }
  }, [
    answerPitchMode,
    autoPlayTarget,
    midi.isConnected,
    practiceMicrophone.isListening,
    practiceMicrophone.start,
    resumeActiveTimers,
    endingRef,
    isPausedRef,
  ]);

  const togglePause = useCallback((): void => {
    if (isPausedRef.current) {
      void resumePractice();
      return;
    }
    pausePractice("manual-pause");
  }, [pausePractice, resumePractice]);

  useEffect(() => {
    onMetronomeSyncToggleChange?.(isMetronomeSyncActive ? togglePause : undefined);
    onMetronomeSyncPauseChange?.(isMetronomeSyncActive ? pausePractice : undefined);
    return () => {
      onMetronomeSyncToggleChange?.(undefined);
      onMetronomeSyncPauseChange?.(undefined);
    };
  }, [
    isMetronomeSyncActive,
    onMetronomeSyncPauseChange,
    onMetronomeSyncToggleChange,
    pausePractice,
    togglePause,
  ]);

  const pauseForFocusLoss = useCallback(
    (lostFocusAt = new Date().toISOString()): void => {
      if (isPausedRef.current) {
        return;
      }
      const prompt = promptRef.current;
      if (prompt) {
        const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
        if (!lastLoss || lastLoss.regainedFocusAt) {
          prompt.focusLosses.push({ lostFocusAt });
        }
      }
      pausePractice("focus-lost");
    },
    [pausePractice]
  );

  useEffect(() => {
    if (phase === "running" && answerPitchMode === "exact-pitch" && !midi.isConnected) {
      // A MIDI disconnect is recoverable: pause the active prompt without marking
      // it interrupted, so reconnecting and answering it still counts normally.
      // Exiting the session will mark any unfinished prompt as interrupted.
      pausePractice();
    }
  }, [answerPitchMode, midi.isConnected, pausePractice, phase]);

  useEffect(() => {
    if (
      phase === "running" &&
      answerPitchMode === "microphone" &&
      practiceMicrophoneStatus === "error"
    ) {
      pausePractice("microphone-disconnected");
    }
  }, [answerPitchMode, pausePractice, phase, practiceMicrophoneStatus]);

  useEffect(() => {
    if (
      phase === "running" &&
      answerPitchMode === "microphone" &&
      isPaused &&
      !microphoneResumeInFlightRef.current &&
      practiceMicrophoneStatus === "listening"
    ) {
      stopPracticeMicrophone();
    }
  }, [answerPitchMode, isPaused, phase, practiceMicrophoneStatus, stopPracticeMicrophone]);

  const persistConfig = useCallback(async (): Promise<AppSettings> => {
    const nextSettings: AppSettings = {
      ...settings,
      answerPitchMode: isDuetPractice ? settings.answerPitchMode : answerPitchMode,
      defaultMode: mode,
      promptDisplayMode:
        isDuetPractice || isPreReadingPractice ? settings.promptDisplayMode : promptDisplayMode,
      promptNoteDuration,
      promptNoteDurations,
      fixedCount,
      fixedDurationSeconds,
      autoPlayTarget,
      playAnswerNote,
      queueStrategy,
      drillNoteNames,
      focusedTraining: false,
    };
    await onSettingsSaved(nextSettings, { feedback: false });
    return nextSettings;
  }, [
    answerPitchMode,
    isDuetPractice,
    isPreReadingPractice,
    autoPlayTarget,
    playAnswerNote,
    fixedCount,
    fixedDurationSeconds,
    drillNoteNames,
    mode,
    onSettingsSaved,
    queueStrategy,
    settings,
    promptDisplayMode,
    promptNoteDuration,
    promptNoteDurations,
  ]);

  const maybeBackupDuringOpenEnded = useCallback(
    async (nextCompletedCount: number): Promise<void> => {
      if (mode !== "open-ended") {
        return;
      }
      const now = performance.now();
      const reviewsSinceBackup = nextCompletedCount - lastBackupCompletedRef.current;
      const msSinceBackup = now - lastBackupAtRef.current;
      if (reviewsSinceBackup < 50 && msSinceBackup < 5 * 60 * 1000) {
        return;
      }
      lastBackupCompletedRef.current = nextCompletedCount;
      lastBackupAtRef.current = now;
      await writeBackupIfSafe();
    },
    [mode]
  );

  const startPrompt = useCallback(
    (note: TargetNote, duetTargets?: DuetTargetPair): void => {
      const now = performance.now();
      const startsPaused = isPausedRef.current;
      promptRef.current = {
        note,
        ...(duetTargets ? { duetTargets } : {}),
        completedDuetStaves: duetTargets
          ? [
              ...(duetTargets.high.length === 0 ? (["treble"] as const) : []),
              ...(duetTargets.low.length === 0 ? (["bass"] as const) : []),
            ]
          : [],
        completedDuetMidis: [],
        completedDuetTargetNoteIds: [],
        startedAt: new Date().toISOString(),
        activeBaseMs: 0,
        activeStartedAt: startsPaused ? null : now,
        lastInputAt: now,
        answerAttempts: [],
        wrongAnswers: [],
        replayCount: 0,
        focusLosses: [],
        interrupted: false,
      };
      setCurrentNote(note);
      setFeedback(null);
      answerInputLockedRef.current = false;
      if (
        (sessionStartSnapshotRef.current?.presentationConfig.autoPlayTarget ?? autoPlayTarget) &&
        !startsPaused
      ) {
        if (duetTargets) {
          void Promise.all(
            [...duetTargets.low, ...duetTargets.high].map((target) => playTargetNote(target))
          ).catch(() => undefined);
        } else {
          void playTargetNote(note).catch(() => undefined);
        }
      }
      const pageIndex = staffPageRef.current?.index;
      if (pageIndex !== undefined) {
        const queuedAnswers = pendingEarlySyncAnswersRef.current.filter(
          (entry) => entry.targetIndex === pageIndex
        );
        pendingEarlySyncAnswersRef.current = pendingEarlySyncAnswersRef.current.filter(
          (entry) => entry.targetIndex !== pageIndex
        );
        if (queuedAnswers.length > 0) {
          window.setTimeout(() => {
            queuedAnswers.forEach(({ answer }) => submitAnswerRef.current(answer));
          }, 0);
        }
      }
    },
    [autoPlayTarget, setCurrentNote]
  );

  const adaptiveEventsPerMeasure = Math.max(
    1,
    Math.round(4 / getQuarterNoteBeats(effectivePromptNoteDuration))
  );
  const adaptiveEventsPerRow = adaptiveMeasuresPerRow * adaptiveEventsPerMeasure;
  const adaptiveStaffRows = useMemo(() => {
    if (
      !isContinuousStaffPage ||
      !staffPageRhythm ||
      staffPageRhythm.measures.length !== staffPageNotes.length
    ) {
      return null;
    }
    const groups =
      staffPageNoteGroups.length === staffPageNotes.length
        ? staffPageNoteGroups
        : staffPageNotes.map((note) => [note]);
    return chunkStaffPageGroupsByAdaptiveMeasureWidth(
      groups,
      staffPageRhythm.measures,
      adaptiveMeasureAreaWidthPx,
      adaptiveMeasuresPerRow,
      undefined,
      staffPageRhythm.onsets,
      PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
    );
  }, [
    adaptiveMeasureAreaWidthPx,
    adaptiveMeasuresPerRow,
    isContinuousStaffPage,
    staffPageNoteGroups,
    staffPageNotes,
    staffPageRhythm,
  ]);

  const {
    clearStaffPageScrollSchedule,
    markCurrentStaffPageNoteComplete,
    markCurrentStaffPageStaffNoteComplete,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
    syncStaffPage,
  } = usePracticeStaffPageFlow({
    values: {
      drillNoteNames,
      enabledNotes: coreEnabledNotes,
      duetLevel: isDuetPractice ? duetLevel : undefined,
      adaptiveMeasureAreaWidthPx:
        isContinuousStaffPage || isDuetPractice ? adaptiveMeasureAreaWidthPx : undefined,
      adaptiveMaxMeasuresPerRow: isContinuousStaffPage
        ? adaptiveMeasuresPerRow
        : isDuetPractice
          ? isMobileViewport
            ? DUET_MOBILE_MEASURES_PER_ROW
            : DUET_DESKTOP_MEASURES_PER_ROW
          : undefined,
      staffPageRowStartIndices: isContinuousStaffPage
        ? adaptiveStaffRows?.rowStartIndices
        : undefined,
      allowDottedRhythms: duetAllowDottedRhythms,
      forceRhythmGeneration: requiresMidiStaffPage || isDuetPractice,
      promptNoteDurations,
      rangeExtensionNotes,
      retainHistory: practiceTab === "free" && promptDisplayMode === "staff-page",
      fixedCount,
      isMobileViewport,
      mode,
      pageNoteCount:
        isContinuousStaffPage && !isDuetPractice
          ? adaptiveMeasuresPerRow *
            Math.max(1, Math.round(4 / getQuarterNoteBeats(effectivePromptNoteDuration)))
          : isMobileViewport
            ? isDuetPractice
              ? DUET_MOBILE_STAFF_PAGE_NOTE_COUNT
              : MOBILE_STAFF_PAGE_NOTE_COUNT
            : isDuetPractice
              ? DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT
              : DESKTOP_STAFF_PAGE_NOTE_COUNT,
      queueStrategy,
      schedulerReviews,
      sessions,
      staffPageScrollDurationMs,
    },
    runtime: {
      adaptiveSchedulerRef,
      isPausedRef,
      lastTargetNoteIdRef,
      melodyGenerationStateRef,
      pendingAfterPauseRef,
      sessionRef,
      sessionReviewsRef,
      staffPageRef,
    },
    services: {
      resumeActiveTimers,
      startPrompt,
    },
    ui: {
      setIsStaffPageScrolling,
      setStaffPageCompletedCount,
      setStaffPageFirstNoteOffset,
      setStaffPageIndex,
      setStaffPageNotes,
      setStaffPageNoteGroups,
      setStaffPageRhythm,
    },
  });
  const getCurrentSyncScoreBeat = useCallback((): number => {
    const page = staffPageRef.current;
    if (!page) return 0;
    return page.rhythm?.onsets[page.index] ?? page.index;
  }, []);
  const appendSynchronizedTempoAnchor = useCallback((audioTime: number, bpm: number): void => {
    const anchors = syncTempoAnchorsRef.current;
    const previous = anchors.at(-1);
    if (!previous || !Number.isFinite(audioTime) || !Number.isFinite(bpm) || bpm <= 0) return;

    // Continue from the prior clock position so a tempo change never rescales
    // beats that have already elapsed.
    const beat = getPracticeBeatAtAudioTime(audioTime, anchors, previous.bpm);
    if (beat === undefined) return;

    const isSameAnchorTime = Math.abs(audioTime - previous.audioTime) <= 0.0001;
    if (!isSameAnchorTime && (audioTime < previous.audioTime || beat <= previous.beat)) return;

    const anchor: PracticeTempoAnchor = { audioTime, beat, bpm };
    if (isSameAnchorTime) {
      anchors[anchors.length - 1] = anchor;
      return;
    }

    anchors.push(anchor);
    if (anchors.length > PRACTICE_TEMPO_ANCHOR_HISTORY_LIMIT) {
      anchors.splice(0, anchors.length - PRACTICE_TEMPO_ANCHOR_HISTORY_LIMIT);
    }
  }, []);
  const replaceSynchronizedTempoAnchor = useCallback(
    (audioTime: number, beat: number, bpm: number): void => {
      syncTempoAnchorsRef.current = [{ audioTime, beat, bpm }];
    },
    []
  );
  const clearPendingSyncAnswers = useCallback((): void => {
    pendingEarlySyncAnswersRef.current = [];
  }, []);
  const preReadingCurrentNoteIndex = staffPageFirstNoteOffset + staffPageIndex;
  const preReadingController = usePreReadingPracticeController({
    bufferSize: preReadingBufferSize,
    clearPendingAnswers: clearPendingSyncAnswers,
    currentNoteIndex: preReadingCurrentNoteIndex,
    enabled: isPreReadingPractice,
    isMetronomeSyncActive,
    isPaused,
    notesReady: staffPageNotes.length > 0,
    phaseRunning: phase === "running",
    replaceTempoAnchor: replaceSynchronizedTempoAnchor,
    scheduleAtAudioTime,
    sessionId: session?.id,
    setProgressMarkerLeadEnabled: setSyncProgressMarkerLeadEnabled,
    syncCountInBeat,
    syncSessionRef,
    getCurrentScoreBeat: getCurrentSyncScoreBeat,
    appendTempoAnchor: appendSynchronizedTempoAnchor,
  });
  const {
    countdownComplete: preReadingCountdownComplete,
    handleBeat: handlePreReadingBeat,
    resetCountdown: resetPreReadingCountdown,
    scoreWindow: preReadingScoreWindow,
  } = preReadingController;
  preReadingCountdownResetRef.current = resetPreReadingCountdown;
  const startSynchronizedMetronome = useCallback(async (): Promise<boolean> => {
    if (metronomePreferences.beatsPerBar !== 4) return false;
    pendingEarlySyncAnswersRef.current = [];
    syncSessionRef.current = true;
    syncCountInStartSequenceRef.current = null;
    syncTempoAnchorsRef.current = [];
    resetPreReadingCountdown();
    syncCountInBaseBeatRef.current = getCurrentSyncScoreBeat();
    setSyncCountInBeat(isPreReadingPractice ? null : 4);
    setMetronomeSyncLocked(true);
    syncStartInFlightRef.current = true;
    stopMetronome();

    const shouldDeferPreReadingStart =
      isPreReadingPractice &&
      (phase !== "running" ||
        staffPageNotes.length === 0 ||
        preReadingScoreWindow.openingSecondsRemaining > 0);
    if (shouldDeferPreReadingStart) {
      preReadingSyncStartPendingRef.current = true;
      try {
        const prepared = await prepareMetronome();
        if (!prepared) {
          preReadingSyncStartPendingRef.current = false;
          syncSessionRef.current = false;
          setSyncProgressMarkerLeadEnabled(false);
          setSyncCountInBeat(null);
          setMetronomeSyncLocked(false);
        }
        return prepared;
      } finally {
        syncStartInFlightRef.current = false;
      }
    }

    preReadingSyncStartPendingRef.current = false;
    try {
      const started = await startMetronome();
      if (!started) {
        syncSessionRef.current = false;
        setSyncProgressMarkerLeadEnabled(false);
        setSyncCountInBeat(null);
        setMetronomeSyncLocked(false);
      }
      return started;
    } finally {
      syncStartInFlightRef.current = false;
    }
  }, [
    getCurrentSyncScoreBeat,
    isPreReadingPractice,
    metronomePreferences.beatsPerBar,
    phase,
    preReadingScoreWindow.openingSecondsRemaining,
    prepareMetronome,
    resetPreReadingCountdown,
    setMetronomeSyncLocked,
    setSyncCountInBeat,
    setSyncProgressMarkerLeadEnabled,
    staffPageNotes.length,
    startMetronome,
    stopMetronome,
  ]);
  startSynchronizedMetronomeRef.current = startSynchronizedMetronome;
  const stopSynchronizedMetronome = useCallback((): void => {
    pendingEarlySyncAnswersRef.current = [];
    syncSessionRef.current = false;
    syncCountInStartSequenceRef.current = null;
    syncTempoAnchorsRef.current = [];
    resetPreReadingCountdown();
    preReadingSyncStartPendingRef.current = false;
    setSyncProgressMarkerLeadEnabled(false);
    setSyncCountInBeat(null);
    stopMetronome();
    setMetronomeSyncLocked(false);
  }, [resetPreReadingCountdown, setMetronomeSyncLocked, stopMetronome]);
  useEffect(
    () =>
      subscribeMetronomeBeat((event) => {
        if (!syncSessionRef.current) return;
        if (isPausedRef.current && !syncAllowBeatWhilePausedRef.current) return;
        if (isPreReadingPractice) {
          handlePreReadingBeat(event);
          return;
        }
        if (syncCountInStartSequenceRef.current === null) {
          if (event.beatIndex !== 0) return;
          syncCountInStartSequenceRef.current = event.sequence;
          syncCountInBaseBeatRef.current = getCurrentSyncScoreBeat();
          return;
        }
        const countInStartSequence = syncCountInStartSequenceRef.current;
        const setCountInBeatAtAudioTime = (beat: number | null): void => {
          scheduleAtAudioTime(() => {
            if (
              !syncSessionRef.current ||
              syncCountInStartSequenceRef.current !== countInStartSequence
            ) {
              return;
            }
            setSyncCountInBeat(beat);
          }, event.audioTime);
        };
        const countInElapsed = event.sequence - syncCountInStartSequenceRef.current;
        if (countInElapsed < 4) {
          if (countInElapsed === 3 && event.bpm > 0) {
            const firstScoreBeatAudioTime = event.audioTime + 60 / event.bpm;
            syncTempoAnchorsRef.current = [
              {
                audioTime: firstScoreBeatAudioTime,
                beat: syncCountInBaseBeatRef.current,
                bpm: event.bpm,
              },
            ];
            scheduleAtAudioTime(() => {
              if (
                syncSessionRef.current &&
                syncCountInStartSequenceRef.current === countInStartSequence
              ) {
                setSyncProgressMarkerLeadEnabled(true);
              }
            }, firstScoreBeatAudioTime - PRACTICE_PROGRESS_MARKER_LEAD_SECONDS);
          }
          setCountInBeatAtAudioTime(Math.max(1, 4 - countInElapsed));
          return;
        }
        setCountInBeatAtAudioTime(null);
        appendSynchronizedTempoAnchor(event.audioTime, event.bpm);
      }),
    [
      appendSynchronizedTempoAnchor,
      getCurrentSyncScoreBeat,
      handlePreReadingBeat,
      isPreReadingPractice,
      scheduleAtAudioTime,
      subscribeMetronomeBeat,
    ]
  );
  useEffect(() => {
    if (
      !isMetronomeSyncActive ||
      !isPreReadingPractice ||
      isPaused ||
      !preReadingSyncStartPendingRef.current ||
      preReadingScoreWindow.openingSecondsRemaining > 0 ||
      staffPageNotes.length === 0 ||
      isMetronomePlaying ||
      syncStartInFlightRef.current
    ) {
      return;
    }

    void startSynchronizedMetronomeRef.current().then((started) => {
      if (!started) pausePractice("manual-pause");
    });
  }, [
    isMetronomeSyncActive,
    isPreReadingPractice,
    isPaused,
    isMetronomePlaying,
    pausePractice,
    preReadingScoreWindow.openingSecondsRemaining,
    staffPageNotes.length,
  ]);
  useEffect(() => {
    if (!isMetronomeSyncActive) {
      if (syncRunningSeenRef.current && phase !== "running") {
        stopSynchronizedMetronome();
        syncRunningSeenRef.current = false;
      } else if (!syncSessionRef.current) {
        setMetronomeSyncLocked(false);
      }
      return;
    }
    syncRunningSeenRef.current = true;
    syncSessionRef.current = true;
    setMetronomeSyncLocked(true);
    if (isPaused && isMetronomePlaying && !syncStartInFlightRef.current) {
      stopMetronome();
      return;
    }
    if (
      !isPaused &&
      !isMetronomePlaying &&
      !syncStartInFlightRef.current &&
      !(isPreReadingPractice && preReadingSyncStartPendingRef.current)
    ) {
      pausePractice("manual-pause");
    }
  }, [
    isMetronomeSyncActive,
    isPausedRef,
    isPaused,
    isMetronomePlaying,
    isPreReadingPractice,
    setMetronomeSyncLocked,
    stopMetronome,
    pausePractice,
    phase,
    preReadingScoreWindow.openingSecondsRemaining,
    stopSynchronizedMetronome,
  ]);
  useEffect(
    () => () => {
      if (!syncSessionRef.current) return;
      stopMetronome();
      setMetronomeSyncLocked(false);
    },
    [setMetronomeSyncLocked, stopMetronome]
  );
  const drawMelodyNote = useCallback(
    (sourceNotes: TargetNote[], remainingCount?: number): TargetNote => {
      if (melodyQueueRef.current.length === 0) {
        const count =
          remainingCount === undefined
            ? MELODY_BUFFER_SIZE
            : Math.min(MELODY_BUFFER_SIZE, Math.max(1, remainingCount));
        melodyQueueRef.current = selectNotePage({
          notes: sourceNotes,
          reviews: [],
          queueStrategy: "melody",
          lastTargetNoteId: lastTargetNoteIdRef.current,
          melodyState: melodyGenerationStateRef.current,
          count,
        });
      }
      const [nextNote, ...remainingNotes] = melodyQueueRef.current;
      if (!nextNote) {
        throw new Error("Cannot draw a melody note without enabled groups.");
      }
      melodyQueueRef.current = remainingNotes;
      return nextNote;
    },
    []
  );

  const selectAndStartNext = useCallback(
    (nextCompletedCount: number): void => {
      const remainingCount = mode === "fixed-count" ? fixedCount - nextCompletedCount : undefined;
      const rangeExtensionNote =
        rangeExtensionNotes.length > 0 && Math.random() < CROSS_GROUP_NOTE_RATE
          ? pickRangeExtensionNote(rangeExtensionNotes, lastTargetNoteIdRef.current)
          : undefined;
      const note =
        rangeExtensionNote ??
        (queueStrategy === "melody"
          ? drawMelodyNote(coreEnabledNotes, remainingCount)
          : (adaptiveSchedulerRef.current?.select({
              lastTargetNoteId: lastTargetNoteIdRef.current,
            }) ??
            selectNextNote({
              notes: queueNotes,
              reviews: [...schedulerReviews, ...sessionReviewsRef.current],
              sessions,
              currentSessionId: sessionRef.current?.id,
              queueStrategy,
              drillNoteNames,
              lastTargetNoteId: lastTargetNoteIdRef.current,
            })));
      startPrompt(note);
    },
    [
      drillNoteNames,
      drawMelodyNote,
      coreEnabledNotes,
      fixedCount,
      mode,
      queueStrategy,
      queueNotes,
      schedulerReviews,
      rangeExtensionNotes,
      sessions,
      startPrompt,
    ]
  );

  const sessionLifecycleRuntime = useMemo(
    () => ({
      promptRef,
      sessionRef,
      sessionReviewsRef,
      lastTargetNoteIdRef,
      adaptiveSchedulerRef,
      endingRef,
      staffPageRef,
      isPausedRef,
      pendingAfterPauseRef,
    }),
    []
  );
  const sessionLifecycleTimers = useMemo(
    () => ({ getPromptActiveMs, getSessionActiveMs, pauseActiveTimers }),
    [getPromptActiveMs, getSessionActiveMs, pauseActiveTimers]
  );
  const sessionLifecycleServices = useMemo(
    () => ({
      stopMicrophone: practiceMicrophone.stop,
      clearStaffPageScrollSchedule,
      onDataChanged,
      onPracticeFinished,
    }),
    [clearStaffPageScrollSchedule, onDataChanged, onPracticeFinished, practiceMicrophone.stop]
  );
  const sessionLifecycleUi = useMemo(
    () => ({
      finishSessionState,
      syncStaffPage,
      setIsStaffPageScrolling,
      setIsPaused,
    }),
    [finishSessionState, syncStaffPage]
  );
  const { completeSession, finishCurrentReview } = usePracticeSessionLifecycle({
    runtime: sessionLifecycleRuntime,
    timers: sessionLifecycleTimers,
    services: sessionLifecycleServices,
    ui: sessionLifecycleUi,
  });
  prepareMicrophoneRecoveryReloadRef.current = async (): Promise<void> => {
    if (!sessionRef.current) return;
    await completeSession("manual-stop", "microphone-disconnected", {
      showSummary: false,
      updateUi: false,
    });
  };

  useEffect(() => {
    if (
      phase !== "running" ||
      !navigationExitRequest ||
      handledNavigationExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledNavigationExitRequestIdRef.current = navigationExitRequest.id;
    const returnToSetup = navigationExitRequest.returnToSetup === true;
    const backgroundExit = Promise.resolve().then(() =>
      completeSession("manual-stop", "manual-stop", {
        showSummary: false,
        updateUi: returnToSetup,
      })
    );
    if (returnToSetup) {
      void backgroundExit
        .then(() => onNavigationExit?.(navigationExitRequest.targetView))
        .catch(() => undefined);
    } else {
      onNavigationExit?.(navigationExitRequest.targetView);
      void backgroundExit.catch(() => undefined);
    }
  }, [completeSession, navigationExitRequest, onNavigationExit, phase]);

  const { startSession } = usePracticeSessionStart({
    values: {
      answerPitchMode,
      isDuetPractice,
      shouldSynchronizeMetronome,
      midiAutoPlayTarget: practiceSetupPreferences.midiAutoPlayTarget,
      midiPlayAnswerNote: practiceSetupPreferences.midiPlayAnswerNote,
      duetLevel,
      duetRangePreset,
      duetAllowDottedRhythms,
      midi,
      prefersReducedMotion,
      queueNotes,
      schedulerReviews,
      sessions,
      staffPageUiPreferences,
      startPausedReading,
      ...(isPreReadingPractice ? { preReadingBufferSize } : {}),
    },
    runtime: {
      adaptiveSchedulerRef,
      endingRef,
      isPausedRef,
      lastBackupAtRef,
      lastBackupCompletedRef,
      lastTargetNoteIdRef,
      melodyGenerationStateRef,
      melodyQueueRef,
      pendingAfterPauseRef,
      sessionRef,
      sessionReviewsRef,
      sessionStartSnapshotRef,
    },
    services: {
      onBeforePracticeStart,
      onSettingsSaved,
      persistConfig,
      practiceMicrophone,
      runSessionStart,
      startSynchronizedMetronome,
      stopSynchronizedMetronome,
    },
    ui: {
      applySettingsSnapshot,
      beginSessionState: (nextSession) => {
        questionLimitReachedRef.current = false;
        setIsQuestionLimitReached(false);
        setSyncTimingFeedback([]);
        pendingEarlySyncAnswersRef.current = [];
        beginSessionState(nextSession);
      },
      drawMelodyNote,
      resetSessionActiveTimer,
      setIsPaused,
      setIsStaffPageScrolling,
      startPrompt,
      startStaffPage,
      syncStaffPage,
    },
  });
  const restartCurrentPractice = useCallback(async (): Promise<void> => {
    if (!isLearningRoutePractice || phase !== "running" || isRestartingPractice) return;
    setIsRestartingPractice(true);
    try {
      await completeSession("manual-stop", "manual-stop", {
        discard: true,
        showSummary: false,
      });
      sessionReviewsRef.current = [];
      sessionStartSnapshotRef.current = null;
      await startSession();
    } catch (error) {
      toast.error(`重新开始练习失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRestartingPractice(false);
    }
  }, [completeSession, isLearningRoutePractice, isRestartingPractice, phase, startSession]);
  const replayTarget = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt || isPausedRef.current || answerPitchMode === "microphone") {
      return;
    }
    markPromptInput();
    prompt.replayCount += 1;
    if (prompt.duetTargets) {
      await Promise.all(
        [...prompt.duetTargets.low, ...prompt.duetTargets.high].map((target) =>
          playTargetNote(target)
        )
      ).catch(() => undefined);
      return;
    }
    await playTargetNote(prompt.note).catch(() => undefined);
  }, [answerPitchMode, markPromptInput]);

  const duetStaffPageNoteCount = isMobileViewport
    ? DUET_MOBILE_STAFF_PAGE_NOTE_COUNT
    : DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const duetMaxMeasuresPerRow = isMobileViewport
    ? DUET_MOBILE_MEASURES_PER_ROW
    : DUET_DESKTOP_MEASURES_PER_ROW;
  const freePlaybackNotesPerRow = isDuetPractice
    ? duetStaffPageNoteCount
    : isContinuousStaffPage
      ? adaptiveEventsPerRow
      : isMobileViewport
        ? MOBILE_STAFF_PAGE_NOTE_COUNT
        : DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const duetStaffRows = useMemo(() => {
    if (
      !isDuetPractice ||
      !staffPageRhythm ||
      staffPageRhythm.measures.length !== staffPageNotes.length
    ) {
      return null;
    }
    return chunkStaffPageGroupsByAdaptiveMeasureWidth(
      staffPageNotes,
      staffPageRhythm.measures,
      adaptiveMeasureAreaWidthPx,
      duetMaxMeasuresPerRow,
      undefined,
      staffPageRhythm.onsets,
      PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
    );
  }, [
    adaptiveMeasureAreaWidthPx,
    isDuetPractice,
    duetMaxMeasuresPerRow,
    staffPageNotes,
    staffPageRhythm,
  ]);
  const freePlaybackRows = useMemo<SongRowPlaybackNote[][]>(() => {
    const rows: SongRowPlaybackNote[][] = [];
    staffPageNotes.forEach((note, noteIndex) => {
      const rowIndex = adaptiveStaffRows
        ? getStaffPageRowIndex(adaptiveStaffRows.rowStartIndices, noteIndex)
        : isDuetPractice && duetStaffRows
          ? getStaffPageRowIndex(duetStaffRows.rowStartIndices, noteIndex)
          : Math.floor(noteIndex / freePlaybackNotesPerRow);
      if (rowIndex < 0) return;
      const row = rows[rowIndex] ?? (rows[rowIndex] = []);
      const duration = staffPageRhythm?.durations[noteIndex] ?? effectivePromptNoteDuration;
      const startBeat =
        staffPageRhythm?.onsets[noteIndex] ??
        noteIndex * getQuarterNoteBeats(effectivePromptNoteDuration);
      (staffPageNoteGroups[noteIndex] ?? [note]).forEach((target) => {
        const staffDuration =
          staffPageRhythm?.staffNoteDurations?.[noteIndex]?.[target.staff] ?? duration;
        row.push({
          durationBeats: getQuarterNoteBeats(staffDuration),
          eventIndex: staffPageFirstNoteOffset + noteIndex,
          note: target,
          startBeat,
        });
      });
    });
    return rows;
  }, [
    duetStaffRows,
    adaptiveStaffRows,
    effectivePromptNoteDuration,
    freePlaybackNotesPerRow,
    isDuetPractice,
    staffPageFirstNoteOffset,
    staffPageNotes,
    staffPageNoteGroups,
    staffPageRhythm,
  ]);
  const {
    cancel: cancelFreeRowPlayback,
    playbackCursor: freePlaybackCursor,
    playingNoteIndex: freePlayingNoteIndex,
    playingRowIndex: freePlayingRowIndex,
    toggleRow: toggleFreeScoreRow,
  } = useSongRowPlayback();
  const toggleFreeScoreRowPlayback = useCallback(
    (rowIndex: number): void => {
      if (freeRowPlaybackActiveRef.current === rowIndex) {
        freeRowPlaybackActiveRef.current = null;
        cancelFreeRowPlayback();
        return;
      }
      const rowNotes = freePlaybackRows[rowIndex] ?? [];
      if (rowNotes.length === 0) return;
      freeRowPlaybackActiveRef.current = rowIndex;
      toggleFreeScoreRow(rowIndex, rowNotes, { tempoBpm: FREE_STAFF_ROW_PREVIEW_TEMPO_BPM });
    },
    [cancelFreeRowPlayback, freePlaybackRows, toggleFreeScoreRow]
  );
  useEffect(() => {
    if (freePlayingRowIndex === null) freeRowPlaybackActiveRef.current = null;
  }, [freePlayingRowIndex]);
  useEffect(() => {
    if (
      phase === "running" &&
      !isPaused &&
      practiceTab === "free" &&
      promptDisplayMode === "staff-page"
    ) {
      return;
    }
    freeRowPlaybackActiveRef.current = null;
    cancelFreeRowPlayback();
  }, [cancelFreeRowPlayback, isPaused, phase, practiceTab, promptDisplayMode]);

  const freeChaseEvents = useMemo<ScoreChaseEvent[]>(
    () =>
      staffPageNotes.map((note, index) => {
        const eventIndex = staffPageFirstNoteOffset + index;
        return {
          eventIndex,
          beatPosition: index,
          staves: isDuetPractice ? ["treble", "bass"] : [note.staff],
        };
      }),
    [isDuetPractice, staffPageFirstNoteOffset, staffPageNotes]
  );
  const freeChaseStaves = useMemo(() => {
    if (isDuetPractice) return ["treble", "bass"] as const;
    if (staffNotationMode === "bass-only") return ["bass"] as const;
    if (staffNotationMode === "treble-only") return ["treble"] as const;
    if (practiceSetupPreferences.chaseHandMode === "left") return ["bass"] as const;
    if (practiceSetupPreferences.chaseHandMode === "right") return ["treble"] as const;
    return ["treble", "bass"] as const;
  }, [isDuetPractice, practiceSetupPreferences.chaseHandMode, staffNotationMode]);
  const isFreeScoreChaseEnabled =
    practiceTab === "free" &&
    phase === "running" &&
    promptDisplayMode === "staff-page" &&
    practiceSetupPreferences.chaseEnabled &&
    !isMetronomeSyncActive;
  const { cursor: freeChaseCursor, recordCorrectTarget: recordFreeChaseTarget } = useScoreChase({
    activeStaves: freeChaseStaves,
    enabled: isFreeScoreChaseEnabled,
    events: freeChaseEvents,
    getAudioTime: getPianoAudioTime,
    paused: isPaused || phase !== "running" || freePlayingRowIndex !== null,
    segmentDurationSeconds: uniformFreePracticeChaseSegmentDuration,
    speedMultiplier: practiceSetupPreferences.chaseSpeedMultiplier,
    startCount: practiceSetupPreferences.chaseStartCount,
    tempoBpm: 120,
  });
  const visibleFreeChaseCursor = freePlayingRowIndex === null ? freeChaseCursor : null;
  const recordFreeStaffPageChaseTarget = useCallback((): void => {
    const page = staffPageRef.current;
    if (!page) return;
    recordFreeChaseTarget(staffPageFirstNoteOffset + page.index);
  }, [recordFreeChaseTarget, staffPageFirstNoteOffset, staffPageRef]);
  const saveFreeChaseSettings = useCallback(
    (next: PracticeChaseSettings): void => {
      setPracticeSetupPreferences((current) => ({
        ...current,
        chaseEnabled: next.enabled,
        chaseHandMode: next.handMode,
        chaseSpeedMultiplier: next.speedMultiplier,
        chaseStartCount: next.startCount,
      }));
    },
    [setPracticeSetupPreferences]
  );

  const getSyncOnsetAtIndex = useCallback(
    (
      index: number
    ): { index: number; currentBeat: number; nextBeat: number; gapBeats: number } | undefined => {
      const page = staffPageRef.current;
      if (!page) return undefined;
      const currentBeat = page.rhythm?.onsets[index] ?? index;
      const nextBeat = page.rhythm?.onsets[index + 1] ?? page.rhythm?.endBeat;
      const previousBeat = index > 0 ? page.rhythm?.onsets[index - 1] : undefined;
      const adjacentGaps = [
        nextBeat === undefined ? undefined : nextBeat - currentBeat,
        previousBeat === undefined ? undefined : currentBeat - previousBeat,
      ].filter((gap): gap is number => gap !== undefined && gap > 0);
      const nearestGap = adjacentGaps.length > 0 ? Math.min(...adjacentGaps) : 1;
      if (nextBeat === undefined || nextBeat <= currentBeat) {
        return { index, currentBeat, nextBeat: currentBeat + 1, gapBeats: nearestGap };
      }
      return { index, currentBeat, nextBeat, gapBeats: nearestGap };
    },
    []
  );
  const getCurrentSyncOnset = useCallback(() => {
    const page = staffPageRef.current;
    return page ? getSyncOnsetAtIndex(page.index) : undefined;
  }, [getSyncOnsetAtIndex]);
  const getSynchronizedAdvanceAudioTime = useCallback((): number | undefined => {
    const onset = getCurrentSyncOnset();
    if (!onset) return undefined;
    return getPracticeAudioTimeAtBeat(
      onset.nextBeat,
      syncTempoAnchorsRef.current,
      metronomePreferences.bpm
    );
  }, [getCurrentSyncOnset, metronomePreferences.bpm]);
  const schedulePracticeContinuationAtAudioTime = useCallback(
    (callback: () => void, audioTime: number): void => {
      const delayMs = Math.max(0, (audioTime - getMetronomeAudioTime()) * 1000);
      window.setTimeout(callback, delayMs);
    },
    [getMetronomeAudioTime]
  );
  const getSynchronizedProgressBeat = useCallback((): number | undefined => {
    if (!isMetronomeSyncActive || isPaused) return undefined;
    return getPracticeBeatAtAudioTime(
      getMetronomeAudioTime() + PRACTICE_PROGRESS_MARKER_LEAD_SECONDS,
      syncTempoAnchorsRef.current,
      metronomePreferences.bpm
    );
  }, [getMetronomeAudioTime, isMetronomeSyncActive, isPaused, metronomePreferences.bpm]);
  const markSynchronizedTargetMissed = useCallback((): void => {
    const prompt = promptRef.current;
    const page = staffPageRef.current;
    if (!prompt || !page) return;
    const noteIndex = staffPageFirstNoteOffset + page.index;
    const targets = prompt.duetTargets
      ? [...prompt.duetTargets.high, ...prompt.duetTargets.low].map((target) => ({
          staff: target.staff,
          midi: getTargetMidiNoteNumber(target),
        }))
      : [{ staff: prompt.note.staff, midi: getTargetMidiNoteNumber(prompt.note) }];
    const pendingTargets = targets.filter(
      (target) => !prompt.completedDuetMidis.includes(target.midi)
    );
    setSyncTimingFeedback((current) => {
      const next = current.filter(
        (entry) =>
          !pendingTargets.some(
            (target) =>
              entry.noteIndex === noteIndex &&
              entry.staff === target.staff &&
              (entry.midi === undefined || entry.midi === target.midi)
          )
      );
      return [
        ...next,
        ...pendingTargets.map((target) => ({ noteIndex, ...target, result: "missed" as const })),
      ];
    });
  }, [staffPageFirstNoteOffset]);
  const preReadingAnswerOutcomePolicy = useMemo<PracticeAnswerOutcomePolicy | undefined>(
    () =>
      isPreReadingPractice
        ? {
            advanceAfterWrong: !isDuetPractice,
            onResolvedAnswer: ({ answeredCorrectly, answerMidi, targetNote }) => {
              if (answeredCorrectly) {
                void playTargetNote(targetNote).catch(() => undefined);
              } else {
                void playMuffledMidiNote(answerMidi ?? getTargetMidiNoteNumber(targetNote)).catch(
                  () => undefined
                );
              }
            },
            suppressConfiguredAnswerNote: true,
            wrongAnswerDelayMs: 180,
          }
        : undefined,
    [isDuetPractice, isPreReadingPractice]
  );
  const { handleDuetTimeout, handleSynchronizedTimeout, submitAnswer } = usePracticeAnswerFlow({
    values: {
      answerPitchMode,
      correctDelayMs: settings.correctDelayMs,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      mode,
      playAnswerNote,
      outcomePolicy: preReadingAnswerOutcomePolicy,
      promptDisplayMode,
      queueStrategy,
      schedulerReviews,
      synchronizedPractice: isMetronomeSyncActive,
    },
    runtime: {
      answerInputLockedRef,
      isPausedRef,
      pendingAfterPauseRef,
      promptRef,
      sessionRef,
      sessionReviewsRef,
      sessionStartSnapshotRef,
      staffPageRef,
    },
    services: {
      completeSession,
      finishCurrentReview,
      getPromptActiveMs,
      getSynchronizedAdvanceAudioTime,
      markCurrentStaffPageNoteComplete,
      markCurrentStaffPageStaffNoteComplete,
      markPromptInput,
      maybeBackupDuringOpenEnded,
      onQuestionLimitReached: pauseAtQuestionLimit,
      recordStaffPageChaseTarget: recordFreeStaffPageChaseTarget,
      resumeActiveTimers,
      scheduleAtAudioTime: schedulePracticeContinuationAtAudioTime,
      selectAndStartNext,
      startStaffPage,
      startStaffPageIndex,
      startStaffPageScroll,
    },
    ui: {
      setCompletedCount,
      setFeedback,
      setWrongAnswerCount,
    },
  });
  const submitPracticeAnswer = useCallback(
    (answer: PracticeAnswerInput): void => {
      if (isPausedRef.current) return;
      if (freeRowPlaybackActiveRef.current !== null) return;
      if (isPreReadingPractice && preReadingScoreWindow.phase !== "training") return;
      if (isMetronomeSyncActive && answer.source === "midi") {
        // The final count-in callback establishes the first score-beat anchor.
        // Keep accepting MIDI inside that beat's early window while the count-in
        // numeral is still visible on screen.
        if (syncTempoAnchorsRef.current.length === 0) return;
        const prompt = promptRef.current;
        const page = staffPageRef.current;
        const answerMidi = answer.midiNoteNumber;
        const inputTime = performanceTimeToAudioTime(answer.inputTimeMs ?? performance.now());
        if (page && answerMidi !== undefined && page.index + 1 < page.notes.length) {
          const futureIndex = page.index + 1;
          const futureOnset = getSyncOnsetAtIndex(futureIndex);
          const futureTime = futureOnset
            ? getPracticeAudioTimeAtBeat(
                futureOnset.currentBeat,
                syncTempoAnchorsRef.current,
                metronomePreferences.bpm
              )
            : undefined;
          const futureWindow = futureOnset
            ? getPracticeTimingWindowMs(metronomePreferences.bpm, futureOnset.gapBeats)
            : 0;
          const futureDeltaMs =
            futureTime === undefined ? undefined : (inputTime - futureTime) * 1000;
          if (
            futureOnset &&
            futureDeltaMs !== undefined &&
            Math.abs(futureDeltaMs) <= futureWindow
          ) {
            const futureTargets =
              page.noteGroups?.[futureIndex] ??
              (page.notes[futureIndex] ? [page.notes[futureIndex]!] : []);
            const target = futureTargets.find(
              (candidate) => getTargetMidiNoteNumber(candidate) === answerMidi
            );
            const futureNoteIndex = staffPageFirstNoteOffset + futureIndex;
            const targetStaves = [...new Set(futureTargets.map((candidate) => candidate.staff))];
            if (target) {
              setSyncTimingFeedback((current) => [
                ...current.filter(
                  (entry) =>
                    entry.noteIndex !== futureNoteIndex ||
                    entry.staff !== target.staff ||
                    (entry.midi !== undefined && entry.midi !== answerMidi)
                ),
                {
                  noteIndex: futureNoteIndex,
                  staff: target.staff,
                  midi: answerMidi,
                  result: "matched",
                },
              ]);
            } else {
              setSyncTimingFeedback((current) => [
                ...current.filter(
                  (entry) =>
                    entry.noteIndex !== futureNoteIndex ||
                    !targetStaves.includes(entry.staff) ||
                    entry.midi !== undefined
                ),
                ...targetStaves.map((staff) => ({
                  noteIndex: futureNoteIndex,
                  staff,
                  result: "missed" as const,
                })),
              ]);
            }
            if (
              !pendingEarlySyncAnswersRef.current.some(
                (entry) =>
                  entry.targetIndex === futureIndex &&
                  entry.answer.midiNoteNumber === answerMidi &&
                  entry.answer.inputTimeMs === answer.inputTimeMs
              )
            ) {
              pendingEarlySyncAnswersRef.current.push({ targetIndex: futureIndex, answer });
            }
            return;
          }
        }
        const onset = getCurrentSyncOnset();
        if (prompt && onset && !answerInputLockedRef.current) {
          const targetMidis = prompt.duetTargets
            ? getDuetTargetMidis(prompt.duetTargets)
            : undefined;
          let matchedStaff: Staff | undefined;
          if (targetMidis && answerMidi !== undefined) {
            for (const staff of ["treble", "bass"] as const) {
              if (
                targetMidis[staff].includes(answerMidi) &&
                !prompt.completedDuetMidis.includes(answerMidi)
              ) {
                matchedStaff = staff;
                break;
              }
            }
          }
          const answeredCorrectly = targetMidis
            ? matchedStaff !== undefined
            : isPracticeAnswerCorrect(answer, prompt.note, "exact-pitch");
          const noteIndex = staffPageFirstNoteOffset + onset.index;
          if (!answeredCorrectly) {
            const staves = targetMidis
              ? (["treble", "bass"] as const).filter(
                  (staff) => !prompt.completedDuetStaves.includes(staff)
                )
              : [prompt.note.staff];
            setSyncTimingFeedback((current) => {
              const next = current.filter(
                (entry) =>
                  entry.noteIndex !== noteIndex ||
                  !staves.includes(entry.staff) ||
                  entry.midi !== undefined
              );
              return [
                ...next,
                ...staves.map((staff) => ({ noteIndex, staff, result: "missed" as const })),
              ];
            });
          } else {
            const expectedTime = getPracticeAudioTimeAtBeat(
              onset.currentBeat,
              syncTempoAnchorsRef.current,
              metronomePreferences.bpm
            );
            const windowMs = getPracticeTimingWindowMs(metronomePreferences.bpm, onset.gapBeats);
            const grade =
              expectedTime === undefined
                ? "on-time"
                : getPracticeTimingGrade((inputTime - expectedTime) * 1000, windowMs);
            const staff = matchedStaff ?? prompt.note.staff;
            if (grade !== "on-time") {
              setSyncTimingFeedback((current) => {
                const next = current.filter(
                  (entry) =>
                    entry.noteIndex !== noteIndex ||
                    entry.staff !== staff ||
                    (entry.midi !== undefined && entry.midi !== answerMidi)
                );
                return [...next, { noteIndex, staff, midi: answerMidi, result: "offbeat" }];
              });
            } else {
              setSyncTimingFeedback((current) => [
                ...current.filter(
                  (entry) =>
                    entry.noteIndex !== noteIndex ||
                    entry.staff !== staff ||
                    (entry.midi !== undefined && entry.midi !== answerMidi)
                ),
                { noteIndex, staff, midi: answerMidi, result: "matched" },
              ]);
            }
          }
        }
      }
      void submitAnswer(answer);
    },
    [
      answerInputLockedRef,
      getCurrentSyncOnset,
      getSyncOnsetAtIndex,
      isMetronomeSyncActive,
      isPreReadingPractice,
      preReadingScoreWindow.phase,
      metronomePreferences.bpm,
      performanceTimeToAudioTime,
      staffPageFirstNoteOffset,
      submitAnswer,
      setSyncTimingFeedback,
    ]
  );
  submitAnswerRef.current = submitPracticeAnswer;

  const handleExitPractice = useCallback((): void => {
    void completeSession("manual-stop", "manual-stop");
  }, [completeSession]);
  const { pressedAnswerKeys } = usePracticeInput({
    answerPitchMode,
    canStartOnMidi: songPracticeSelection === null && practiceTab === "free",
    isPausedRef,
    isRunning: phase === "running",
    midi,
    onResume: () => void resumePractice(),
    onStartSession: () => void startSession(),
    onSubmitAnswer: submitPracticeAnswer,
    onTogglePause: togglePause,
  });

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    let focusLossStartedAt: number | null = null;
    let pauseTimeout: number | null = null;

    function onVisibilityOrBlur(): void {
      // Mobile browsers can report document.hasFocus() as false while the
      // practice page is still visible (for example during the transition
      // from the setup screen). Treat backgrounding, rather than transient
      // window focus changes, as a pause on mobile.
      const hasFocus =
        document.visibilityState !== "hidden" && (isMobileViewport || document.hasFocus());
      if (!hasFocus) {
        if (focusLossStartedAt !== null) {
          return;
        }
        const lostFocusAt = Date.now();
        focusLossStartedAt = lostFocusAt;
        const pauseDelayMs = practicePagePreferences.focusLossPauseSeconds * 1000;
        if (pauseDelayMs === 0) {
          focusLossStartedAt = null;
          pauseForFocusLoss(new Date(lostFocusAt).toISOString());
          return;
        }
        pauseTimeout = window.setTimeout(() => {
          pauseTimeout = null;
          const lostFocusAt = focusLossStartedAt;
          focusLossStartedAt = null;
          if (lostFocusAt !== null && Date.now() - lostFocusAt >= pauseDelayMs) {
            pauseForFocusLoss(new Date(lostFocusAt).toISOString());
          }
        }, pauseDelayMs);
        return;
      }

      if (focusLossStartedAt === null) {
        return;
      }
      const lostFocusAt = focusLossStartedAt;
      focusLossStartedAt = null;
      if (pauseTimeout !== null) {
        window.clearTimeout(pauseTimeout);
        pauseTimeout = null;
      }
      if (Date.now() - lostFocusAt >= practicePagePreferences.focusLossPauseSeconds * 1000) {
        pauseForFocusLoss(new Date(lostFocusAt).toISOString());
      }
    }

    window.addEventListener("blur", onVisibilityOrBlur);
    window.addEventListener("focus", onVisibilityOrBlur);
    document.addEventListener("visibilitychange", onVisibilityOrBlur);
    return () => {
      window.removeEventListener("blur", onVisibilityOrBlur);
      window.removeEventListener("focus", onVisibilityOrBlur);
      document.removeEventListener("visibilitychange", onVisibilityOrBlur);
      if (pauseTimeout !== null) {
        window.clearTimeout(pauseTimeout);
      }
    };
  }, [isMobileViewport, pauseForFocusLoss, phase, practicePagePreferences.focusLossPauseSeconds]);

  useEffect(() => {
    if (
      !isMetronomeSyncActive ||
      phase !== "running" ||
      isPaused ||
      (isPreReadingPractice && preReadingScoreWindow.phase !== "training") ||
      syncCountInBeat !== null ||
      syncTempoAnchorsRef.current.length === 0
    ) {
      return undefined;
    }
    const prompt = promptRef.current;
    const onset = getCurrentSyncOnset();
    if (!prompt || !onset) return undefined;
    const expectedTime = getPracticeAudioTimeAtBeat(
      onset.currentBeat,
      syncTempoAnchorsRef.current,
      metronomePreferences.bpm
    );
    if (expectedTime === undefined) return undefined;
    const timingWindowMs = getPracticeTimingWindowMs(metronomePreferences.bpm, onset.gapBeats);
    const targetIndex = onset.index;
    let isCurrentDeadline = true;
    let timeoutId: number | null = null;
    const deadlineAudioTime = expectedTime + timingWindowMs / 1000;
    const checkDeadline = (): void => {
      if (
        !isCurrentDeadline ||
        isPausedRef.current ||
        answerInputLockedRef.current ||
        promptRef.current !== prompt ||
        staffPageRef.current?.index !== targetIndex
      ) {
        return;
      }
      const remainingMs = (deadlineAudioTime - getMetronomeAudioTime()) * 1000;
      if (remainingMs > 5) {
        // Tone.Draw is designed for visual callbacks. Use the audio clock to
        // re-check deadlines so a missed-note event cannot stall when a draw
        // callback is delayed or skipped by the browser.
        timeoutId = window.setTimeout(checkDeadline, Math.min(remainingMs, 80));
        return;
      }
      markSynchronizedTargetMissed();
      void handleSynchronizedTimeout();
    };
    timeoutId = window.setTimeout(
      checkDeadline,
      Math.max(0, (deadlineAudioTime - getMetronomeAudioTime()) * 1000)
    );
    return () => {
      isCurrentDeadline = false;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    answerInputLockedRef,
    currentNote?.id,
    getMetronomeAudioTime,
    getCurrentSyncOnset,
    handleSynchronizedTimeout,
    isMetronomeSyncActive,
    isPaused,
    isPreReadingPractice,
    markSynchronizedTargetMissed,
    metronomePreferences.bpm,
    phase,
    preReadingScoreWindow.phase,
    staffPageIndex,
    syncCountInBeat,
  ]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const interval = window.setInterval(() => {
      const prompt = promptRef.current;
      if (
        !isMetronomeSyncActive &&
        prompt &&
        prompt.activeStartedAt !== null &&
        !prompt.interrupted
      ) {
        if (prompt.duetTargets) {
          if (getPromptActiveMs() >= DUET_PROMPT_TIMEOUT_MS) {
            void handleDuetTimeout();
          }
        } else {
          const inactiveMs = getPromptInactiveMs();
          const inactivityThresholdSeconds =
            sessionStartSnapshotRef.current?.interactionConfig.inactivityThresholdSeconds ??
            settings.inactivityThresholdSeconds;
          if (inactiveMs >= inactivityThresholdSeconds * 1000) {
            markInterrupted("inactive-timeout");
          }
        }
      }
      if (mode === "fixed-duration" && getSessionActiveMs() >= fixedDurationSeconds * 1000) {
        void completeSession("completed-duration", "duration-ended");
      }
      setTick((value) => value + 1);
    }, 250);
    return () => window.clearInterval(interval);
  }, [
    completeSession,
    fixedDurationSeconds,
    getPromptActiveMs,
    getPromptInactiveMs,
    getSessionActiveMs,
    handleDuetTimeout,
    isMetronomeSyncActive,
    markInterrupted,
    mode,
    phase,
    settings.inactivityThresholdSeconds,
  ]);

  const setupDisabledReason =
    shouldSynchronizeMetronome && metronomePreferences.beatsPerBar !== 4
      ? "谱面同步目前使用 4/4 拍，请先将节拍器拍号设为 4/4"
      : (isDuetPractice || (practiceTab === "free" && answerPitchMode === "exact-pitch")) &&
          !midi.isConnected
        ? isDuetPractice
          ? "请连接并选择 MIDI 键盘后开始左右手合弹"
          : "请先连接并选择 MIDI 输入设备，再开始练习"
        : isDuetPractice && queueStrategy === "note-drill" && drillNoteNames.length === 0
          ? "请至少选择一个强化音名"
          : isDuetPractice
            ? undefined
            : enabledNotes.length === 0
              ? "请至少选择一个上方的练习音组"
              : queueStrategy === "note-drill" && drillNoteNames.length === 0
                ? "请至少选择一个强化音名"
                : undefined;
  const setupDisabled = setupDisabledReason !== undefined;

  useEffect(() => {
    if (phase === "running") {
      return;
    }

    function handleEnter(event: KeyboardEvent): void {
      if (
        !shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target)) ||
        (phase === "setup" && practiceTab !== "free") ||
        (phase === "setup" && setupDisabled) ||
        songPracticeSelection !== null
      ) {
        return;
      }
      event.preventDefault();
      void startSession();
    }

    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [phase, practiceTab, setupDisabled, songPracticeSelection, startSession]);

  const remainingMs =
    mode === "fixed-duration" ? fixedDurationSeconds * 1000 - getSessionActiveMs() : 0;
  const mobileStaffPageRowCount = 1;
  const mobileStaffPageNoteCount = MOBILE_STAFF_PAGE_NOTE_COUNT * mobileStaffPageRowCount;
  const staffPageRowCount = 1;
  const showPracticeKeyboard = activePracticeInputMode === "virtual-keyboard";
  const mobileStaffPageStartIndex = isContinuousStaffPage
    ? 0
    : Math.floor(Math.max(0, staffPageIndex) / mobileStaffPageNoteCount) * mobileStaffPageNoteCount;
  const mobileStaffPageNotes = useMemo(
    () =>
      isMobileStaffPage && !isContinuousStaffPage
        ? staffPageNotes.slice(
            mobileStaffPageStartIndex,
            mobileStaffPageStartIndex + mobileStaffPageNoteCount
          )
        : staffPageNotes,
    [
      isContinuousStaffPage,
      isMobileStaffPage,
      mobileStaffPageNoteCount,
      mobileStaffPageStartIndex,
      staffPageNotes,
    ]
  );
  const mobileStaffPageNoteGroups = useMemo(
    () =>
      isMobileStaffPage && !isContinuousStaffPage
        ? staffPageNoteGroups.slice(
            mobileStaffPageStartIndex,
            mobileStaffPageStartIndex + mobileStaffPageNoteCount
          )
        : staffPageNoteGroups,
    [
      isContinuousStaffPage,
      isMobileStaffPage,
      mobileStaffPageNoteCount,
      mobileStaffPageStartIndex,
      staffPageNoteGroups,
    ]
  );
  const visibleCompletedStaffNoteIndices = (() => {
    const completed = staffPageRef.current?.completedStaffNoteIndices;
    if (!completed) return undefined;
    if (!isMobileStaffPage || isContinuousStaffPage) return completed;
    return Object.fromEntries(
      Object.entries(completed).map(([staff, indices]) => [
        staff,
        indices!
          .filter(
            (index) =>
              index >= mobileStaffPageStartIndex &&
              index < mobileStaffPageStartIndex + mobileStaffPageNoteCount
          )
          .map((index) => index - mobileStaffPageStartIndex),
      ])
    ) as Partial<Record<Staff, number[]>>;
  })();
  const visibleStaffPageRhythm = useMemo(() => {
    if (!staffPageRhythm) return undefined;
    if (!isMobileStaffPage || isContinuousStaffPage) return staffPageRhythm;
    const start = mobileStaffPageStartIndex;
    const end = start + mobileStaffPageNoteCount;
    return {
      ...staffPageRhythm,
      durations: staffPageRhythm.durations.slice(start, end),
      measures: staffPageRhythm.measures.slice(start, end),
      noteBeamGroups: staffPageRhythm.noteBeamGroups.slice(start, end),
      onsets: staffPageRhythm.onsets.slice(start, end),
      ...(staffPageRhythm.staffNoteDurations
        ? { staffNoteDurations: staffPageRhythm.staffNoteDurations.slice(start, end) }
        : {}),
    };
  }, [
    isContinuousStaffPage,
    isMobileStaffPage,
    mobileStaffPageNoteCount,
    mobileStaffPageStartIndex,
    staffPageRhythm,
  ]);
  const staffPageBarlineAfterNoteIndices = useMemo(() => {
    if (!visibleStaffPageRhythm) return undefined;
    return visibleStaffPageRhythm.measures.flatMap((measure, index) =>
      index < visibleStaffPageRhythm.measures.length - 1 &&
      visibleStaffPageRhythm.measures[index + 1] !== measure
        ? [index]
        : []
    );
  }, [visibleStaffPageRhythm]);
  const staffPageNoteCount = isDuetPractice
    ? duetStaffPageNoteCount
    : isMobileStaffPage
      ? mobileStaffPageNoteCount
      : DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const staffPageRenderedRowCount = Math.max(
    1,
    adaptiveStaffRows?.rows.length ??
      duetStaffRows?.rows.length ??
      Math.ceil(
        staffPageNotes.length / (isContinuousStaffPage ? adaptiveEventsPerRow : staffPageNoteCount)
      )
  );
  const freeCursorIndexOffset =
    staffPageFirstNoteOffset + (isMobileStaffPage ? mobileStaffPageStartIndex : 0);
  const visiblePreReadingNoteStates = isPreReadingPractice
    ? mobileStaffPageNotes.map((_, index) =>
        preReadingScoreWindow.getNoteVisibility(freeCursorIndexOffset + index)
      )
    : undefined;
  const visibleSyncNoteStatuses = useMemo(
    () =>
      syncTimingFeedback
        .filter(
          (entry) =>
            entry.noteIndex >= freeCursorIndexOffset &&
            entry.noteIndex < freeCursorIndexOffset + mobileStaffPageNotes.length
        )
        .map((entry) => ({ ...entry, index: entry.noteIndex - freeCursorIndexOffset })),
    [freeCursorIndexOffset, mobileStaffPageNotes.length, syncTimingFeedback]
  );
  const freeChaseCurrentIndex =
    freeChaseCursor?.staffCursors.treble?.currentEventIndices[0] ??
    freeChaseCursor?.staffCursors.bass?.currentEventIndices[0];
  const freeChaseLocalIndex =
    freeChaseCurrentIndex === undefined ? -1 : freeChaseCurrentIndex - freeCursorIndexOffset;
  const freeChaseFollowRowIndex =
    freeChaseLocalIndex >= 0
      ? adaptiveStaffRows
        ? getStaffPageRowIndex(adaptiveStaffRows.rowStartIndices, freeChaseLocalIndex)
        : isDuetPractice && duetStaffRows
          ? getStaffPageRowIndex(duetStaffRows.rowStartIndices, freeChaseLocalIndex)
          : Math.floor(freeChaseLocalIndex / staffPageNoteCount)
      : undefined;
  const freePracticeFollowRowIndex = isContinuousStaffPage
    ? adaptiveStaffRows
      ? getStaffPageRowIndex(adaptiveStaffRows.rowStartIndices, Math.max(0, staffPageIndex))
      : isDuetPractice && duetStaffRows
        ? getStaffPageRowIndex(duetStaffRows.rowStartIndices, Math.max(0, staffPageIndex))
        : Math.floor(
            Math.max(0, staffPageIndex) /
              (isDuetPractice ? staffPageNoteCount : adaptiveEventsPerRow)
          )
    : freeChaseFollowRowIndex;
  const shouldShowStaffPageContinuationHint =
    isContinuousStaffPage &&
    freePracticeFollowRowIndex !== undefined &&
    freePracticeFollowRowIndex >= Math.max(1, staffPageRenderedRowCount - 2) &&
    (mode !== "fixed-count" || staffPageFirstNoteOffset + staffPageNotes.length < fixedCount);
  const staffPageView = useMemo(
    () =>
      promptDisplayMode === "staff-page"
        ? buildStaffPageView({
            completedCount: staffPageCompletedCount,
            currentIndex: staffPageIndex,
            firstNoteOffset: staffPageFirstNoteOffset,
            fixedSessionCount: mode === "fixed-count" ? fixedCount : undefined,
            notes: staffPageNotes,
            pageNoteCount: staffPageNoteCount,
          })
        : null,
    [
      fixedCount,
      mode,
      promptDisplayMode,
      staffPageCompletedCount,
      staffPageFirstNoteOffset,
      staffPageIndex,
      staffPageNoteCount,
      staffPageNotes,
    ]
  );
  const trackedFreeScoreNoteIndex =
    isMobileStaffPage && !isContinuousStaffPage
      ? (staffPageView?.noteIndexInPage ?? staffPageIndex - mobileStaffPageStartIndex)
      : staffPageIndex;
  const handleFreeTrackedNoteVisibilityChange = useCallback(
    (visible: boolean): void => {
      setFreeTrackedNoteVisibility({
        noteOffset: staffPageFirstNoteOffset,
        visible,
      });
    },
    [staffPageFirstNoteOffset]
  );
  const getFreeCurrentNoteTarget = useCallback((): SVGElement | null => {
    const prompt = staffPagePromptContainerRef.current;
    const note = prompt?.querySelector<SVGElement>(
      `[data-staff-page-note-index="${trackedFreeScoreNoteIndex}"]`
    );
    const rowIndex = adaptiveStaffRows
      ? getStaffPageRowIndex(adaptiveStaffRows.rowStartIndices, trackedFreeScoreNoteIndex)
      : isDuetPractice && duetStaffRows
        ? getStaffPageRowIndex(duetStaffRows.rowStartIndices, trackedFreeScoreNoteIndex)
        : Math.floor(trackedFreeScoreNoteIndex / staffPageNoteCount);
    const row = prompt?.querySelector<SVGElement>(`[data-staff-row-index="${rowIndex}"]`);
    return note ?? row ?? null;
  }, [
    adaptiveStaffRows,
    duetStaffRows,
    isDuetPractice,
    staffPageNoteCount,
    trackedFreeScoreNoteIndex,
  ]);
  const {
    formatQualifiedTimeMedian,
    formatQualifiedTimeP90,
    summaryAllHistoryCount,
    summaryHasTooManyErrors,
    summaryProgressBenchmark,
    summaryProgressSeries,
    weakestNotes,
  } = usePracticeSummaryData({
    historyLimit: summaryEffectiveHistoryLimit,
    mode: summaryProgressMode,
    reviews,
    sessions,
    summary,
  });

  if (songPracticeSelection) {
    return (
      <SongPracticeView
        microphone={practiceMicrophone}
        midi={midi}
        onFullscreenAvailabilityChange={setIsSongPracticeFullscreenActive}
        onInputModeChange={(mode) =>
          setSongInputMode(mode === "virtual" ? "virtual-keyboard" : mode)
        }
        onBack={() => {
          setSongPracticeSelection(null);
        }}
        onRegisterMicrophoneAnswer={registerSongPracticeMicrophoneAnswer}
        selection={songPracticeSelection}
      />
    );
  }

  if (phase === "setup") {
    return (
      <PracticeSetupView
        activeTab={practiceTab}
        freePracticeTitle={freePracticeCopy.title}
        freePracticeDescription={freePracticeCopy.description}
        showPracticeKindTabs={showPracticeKindTabs}
        showPracticeModeTabs={practiceModeLock === undefined}
        lockedPromptDisplayMode={isPreReadingPractice ? "staff-page" : undefined}
        preReadingBufferSize={isPreReadingPractice ? preReadingBufferSize : undefined}
        onPreReadingBufferSizeChange={isPreReadingPractice ? setPreReadingBufferSize : undefined}
        distanceContent={
          <StaffDistancePracticeView
            isActive={practiceTab === "distance"}
            showRestartControl={isLearningRoutePractice}
            midi={midi}
            microphone={{
              error: practiceMicrophone.error,
              isListening: practiceMicrophone.isListening,
              isPreparingSwiftF0: practiceMicrophone.isPreparingSwiftF0,
              start: practiceMicrophone.start,
              status: practiceMicrophone.status,
              stop: practiceMicrophone.stop,
            }}
            onMicrophoneAnswerHandlerChange={(handler) => {
              staffDistanceMicrophoneAnswerRef.current = handler;
            }}
            onInputModeChange={setDistanceInputMode}
            navigationExitRequest={navigationExitRequest}
            onBeforePracticeStart={onBeforePracticeStart}
            onDataChanged={onDataChanged}
            onNavigationExit={onNavigationExit}
            onDistanceModeChange={onPracticeDistanceModeChange}
            onPracticeFinished={onPracticeFinished}
            onFullscreenAvailabilityChange={setIsStaffDistanceFullscreenActive}
            onRunStageChange={handleStaffDistanceStageChange}
            onRunningChange={setIsStaffDistanceRunning}
            onSettingsSaved={onSettingsSaved}
            settings={setupSettings}
            distanceMode={practiceDistanceMode}
          />
        }
        nameKeyContent={
          <NameToKeyPracticeView
            isActive={practiceTab === "name-key"}
            showRestartControl={isLearningRoutePractice}
            midi={midi}
            navigationExitRequest={navigationExitRequest}
            microphone={{
              error: practiceMicrophone.error,
              inputLevel: practiceMicrophone.inputLevel,
              isListening: practiceMicrophone.isListening,
              isPreparingSwiftF0: practiceMicrophone.isPreparingSwiftF0,
              start: practiceMicrophone.start,
              status: practiceMicrophone.status,
              stop: practiceMicrophone.stop,
              suppressRecognizedNotes: practiceMicrophone.suppressRecognizedNotes,
            }}
            onBeforePracticeStart={onBeforePracticeStart}
            onInputModeChange={setNameKeyInputMode}
            onDataChanged={onDataChanged}
            onNavigationExit={onNavigationExit}
            onPracticeFinished={onPracticeFinished}
            onRegisterMicrophoneAnswer={registerNameToKeyMicrophoneAnswer}
            onRunningChange={setIsNameToKeyRunning}
            onStageChange={handleNameToKeyStageChange}
          />
        }
        distanceStageActive={isStaffDistanceStageActive || isNameToKeyStageActive}
        actions={{
          onAnswerPitchModeChange: setAnswerPitchMode,
          onPracticeModeChange: setPracticeMode,
          onMetronomeSyncEnabledChange: setMetronomeSyncEnabled,
          onDuetLevelChange: setDuetLevel,
          onDuetRangePresetChange: setDuetRangePreset,
          onDuetAllowDottedRhythmsChange: setDuetAllowDottedRhythms,
          onAutoPlayTargetChange: setAutoPlayTarget,
          onFixedCountChange: setFixedCount,
          onFixedDurationSecondsChange: setFixedDurationSeconds,
          onModeChange: setMode,
          onOpenStats,
          onPlayAnswerNoteChange: setPlayAnswerNote,
          onPromptDisplayModeChange: setPromptDisplayMode,
          onPromptNoteDurationsChange: setPromptNoteDurations,
          onQueueStrategyChange: setQueueStrategy,
          onSettingsSaved: savePracticeSetupSettings,
          onStartSongPractice: async (selection) => {
            let activeInputMode: SongPracticeInputMode = midiConnectedRef.current
              ? "midi"
              : "microphone";
            if (activeInputMode === "microphone") {
              const microphoneReady = await practiceMicrophone.start({
                includeAccidentals: true,
              });
              if (!microphoneReady && !midiConnectedRef.current) return false;
              activeInputMode = midiConnectedRef.current ? "midi" : "microphone";
            }
            if (activeInputMode === "midi") {
              practiceMicrophone.stop();
            }
            setSongInputMode(activeInputMode);
            setSongPracticeSelection({ ...selection, inputMode: activeInputMode });
            return true;
          },
          onStartPausedReadingChange: (enabled) =>
            setStaffPageUiPreferences((current) => ({ ...current, startPausedReading: enabled })),
          onStartSession: () => void startSession(),
          onSetupTabChange: onPracticeTabChange,
          onToggleDrillNoteName: toggleDrillNoteName,
        }}
        isBusy={showStartingSessionStatus}
        microphoneError={practiceMicrophone.error}
        microphoneIsPreparingModel={practiceMicrophone.isPreparingSwiftF0}
        microphoneStatus={practiceMicrophone.status}
        metronomeError={metronomeAudioError}
        onRetryMicrophone={() =>
          practiceMicrophone.start({ includeAccidentals: practiceTab === "songs" })
        }
        midi={midi}
        preferences={{
          ...practiceSetupPreferences,
          metronomeSyncEnabled: isPreReadingPractice
            ? preReadingMetronomeSyncEnabled
            : practiceSetupPreferences.metronomeSyncEnabled,
          practiceMode: practiceModeLock ?? practiceSetupPreferences.practiceMode,
          ...(isPreReadingPractice ? { promptDisplayMode: "staff-page" as const } : {}),
        }}
        setupDisabledReason={setupDisabledReason}
        metronomeBeatsPerBar={metronomePreferences.beatsPerBar}
        startPausedReading={startPausedReading}
        settings={setupSettings}
        overlay={
          <B6SwiftF0ReminderDialog
            active={
              practiceTab === "free" &&
              answerPitchMode === "microphone" &&
              practiceMicrophonePreferences.algorithm !== "swiftf0" &&
              allQueueNotes.some((note) => getTargetMidiNoteNumber(note) === 95)
            }
          />
        }
      />
    );
  }

  if (phase === "summary" && summary) {
    return (
      <PracticeSummaryView
        allHistory={summaryAllHistory}
        allHistoryCount={summaryAllHistoryCount}
        benchmark={summaryProgressBenchmark}
        formatQualifiedTimeMedian={formatQualifiedTimeMedian}
        formatQualifiedTimeP90={formatQualifiedTimeP90}
        historyLimit={summaryHistoryLimit}
        isBusy={showStartingSessionStatus}
        isMidiConnected={midi.isConnected}
        mode={summaryProgressMode}
        onAllHistoryChange={setSummaryAllHistory}
        onHistoryLimitChange={setSummaryHistoryLimit}
        onModeChange={setSummaryProgressMode}
        onReturnToSetup={() => setPhase("setup")}
        onStartAgain={() => void startSession()}
        series={summaryProgressSeries}
        summary={summary}
        summaryHasTooManyErrors={summaryHasTooManyErrors}
        weakestNotes={weakestNotes}
      />
    );
  }

  return (
    <section
      className={[
        "practice-shell",
        "practice-running-shell",
        isContinuousStaffPage ? "is-free-score-stream" : "",
        isMobileViewport ? "practice-running-mobile" : "",
        isMobileViewport && answerPitchMode !== "note-name"
          ? "practice-without-touch-keyboard"
          : "",
        `practice-${promptDisplayMode}`,
        promptDisplayMode === "staff-page"
          ? `practice-staff-page-rows-${isMobileStaffPage ? mobileStaffPageRowCount : staffPageRowCount}`
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="practice-topline">
        {practiceTab === "free" ? (
          <h1 className="practice-running-title">{freePracticeCopy.title}</h1>
        ) : null}
        <div className="progress-readout">
          {mode === "open-ended" ? (
            <span>完成 {completedCount}</span>
          ) : mode === "fixed-count" ? (
            <span>
              音符：{completedCount}/{fixedCount}
            </span>
          ) : (
            <span>
              完成 {completedCount} · {formatDuration(remainingMs)}
            </span>
          )}
        </div>
        <div className="topline-actions">
          <button
            aria-label="退出练习并返回配置"
            className="practice-return-home"
            title="退出练习并返回配置"
            onClick={() =>
              void completeSession("manual-stop", "manual-stop", { showSummary: false })
            }
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            退出
          </button>
          {practiceTab !== "free" &&
          answerPitchMode !== "microphone" &&
          answerPitchMode !== "note-name" ? (
            <button title="重播目标音" onClick={() => void replayTarget()}>
              <Volume2 size={18} />
              重播
            </button>
          ) : null}
          <button
            title={
              answerPitchMode === "microphone"
                ? isPaused
                  ? "重新连接麦克风并继续"
                  : "暂停"
                : isPaused
                  ? "继续"
                  : "暂停"
            }
            onClick={togglePause}
          >
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? "继续" : "暂停"}
          </button>
          {isLearningRoutePractice ? (
            <button
              aria-label="重新开始当前练习"
              disabled={isRestartingPractice}
              onClick={() => void restartCurrentPractice()}
              title="重新开始当前练习"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={18} />
              重新开始
            </button>
          ) : null}
          {practiceTab === "free" && promptDisplayMode === "staff-page" ? (
            <button
              aria-label="追逐游戏设置"
              className="song-chase-settings-button"
              title="追逐游戏设置"
              type="button"
              onClick={() => setIsChaseSettingsOpen(true)}
            >
              <Settings2 aria-hidden="true" size={16} />
              追逐游戏设置
              <span aria-hidden="true" className="song-chase-new-badge">
                NEW
              </span>
            </button>
          ) : null}
          {answerPitchMode === "exact-pitch" ? (
            <MidiInputControl
              ariaLabel={`${freePracticeCopy.title} MIDI 输入设备`}
              className={phase === "running" && !midi.isConnected ? "needs-attention" : undefined}
              midi={midi}
            />
          ) : null}
          <PracticeFullscreenToggle />
        </div>
      </div>

      {answerPitchMode === "microphone" ? (
        <div className="practice-microphone-status">
          <span
            className={`practice-microphone-indicator ${practiceMicrophone.error ? "error" : practiceMicrophone.status}`}
            aria-hidden="true"
          />
          {practiceMicrophone.status === "listening" ? (
            <>
              <span role="status">正在监听麦克风</span>
              <div
                aria-label="麦克风输入音量"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(practiceMicrophone.inputLevel * 100)}
                aria-valuetext={`${Math.round(practiceMicrophone.inputLevel * 100)}%`}
                className="practice-microphone-level"
                role="meter"
              >
                <span
                  className="practice-microphone-level-fill"
                  style={{ width: `${Math.round(practiceMicrophone.inputLevel * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <span role="status">
              {practiceMicrophone.status === "requesting" ? (
                <LoadingActivityText
                  kind={practiceMicrophone.isPreparingSwiftF0 ? "dots" : "spinner"}
                >
                  {practiceMicrophone.isPreparingSwiftF0 ? "正在准备识别模型" : "正在连接麦克风…"}
                </LoadingActivityText>
              ) : (
                (practiceMicrophone.error ?? (isPaused ? "已暂停，麦克风已释放" : "麦克风未连接"))
              )}
            </span>
          )}
          {practiceMicrophone.error ||
          practiceMicrophone.status === "error" ||
          practiceMicrophone.status === "requesting" ? (
            <PracticeMicrophoneRetryButton
              isConnecting={practiceMicrophone.status === "requesting"}
              isPreparingModel={practiceMicrophone.isPreparingSwiftF0}
              onRetry={() => practiceMicrophone.start()}
            />
          ) : null}
          {practiceMicrophone.recoveryReloadAvailable ? (
            <button
              className="practice-microphone-recovery-reload"
              type="button"
              onClick={() => void practiceMicrophone.reloadAfterRecoveryFailure()}
            >
              刷新页面重试
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={
          promptDisplayMode === "staff-page" ? "prompt-stage staff-page-stage" : "prompt-stage"
        }
      >
        {isPreReadingPractice && preReadingScoreWindow.phase !== "idle" ? (
          <div className="pre-reading-window-status" role="status" aria-live="polite">
            {preReadingScoreWindow.phase === "training" ? (
              `记住后方清晰的 ${preReadingBufferSize} 个音，听到节拍后靠记忆弹奏。`
            ) : isMetronomeSyncActive ? (
              preReadingScoreWindow.openingSecondsRemaining > 0 ? (
                <>
                  全谱预读与节拍对齐 ·{" "}
                  <strong className="pre-reading-countdown-value">
                    {preReadingScoreWindow.openingSecondsRemaining}
                  </strong>{" "}
                  秒后开始
                </>
              ) : (
                "预读完成，等待节拍器首拍…"
              )
            ) : (
              `全谱预读 · ${preReadingScoreWindow.openingSecondsRemaining} 秒后开始训练`
            )}
          </div>
        ) : null}
        {isMetronomeSyncActive ? (
          <div className="practice-metronome-sync-status" role="status" aria-live="polite">
            {syncCountInBeat !== null ? <strong>准备拍 {syncCountInBeat}</strong> : null}
            <strong>{metronomePreferences.bpm} BPM</strong>
            <span className="practice-metronome-sync-legend" aria-label="谱面颜色说明">
              <span className="is-error">红色：错音或漏拍</span>
              <span className="is-warning">黄色：时机偏早或偏晚</span>
            </span>
          </div>
        ) : null}
        {promptDisplayMode === "staff-page" ? (
          <div
            ref={staffPagePromptContainerRef}
            className={[
              isMobileStaffPage ? "staff-page-mobile-view" : "staff-page-desktop-view",
              isContinuousStaffPage ? "staff-page-scroll-viewport" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <StaffPagePrompt
              notes={mobileStaffPageNotes}
              verticalRangeNotes={enabledNotes}
              canonicalRowStartIndices={
                isContinuousStaffPage ? adaptiveStaffRows?.rowStartIndices : undefined
              }
              noteGroups={isDuetPractice ? mobileStaffPageNoteGroups : undefined}
              completedStaffNoteIndices={
                isDuetPractice ? (visibleCompletedStaffNoteIndices ?? {}) : undefined
              }
              wrongStaffIndex={
                isDuetPractice &&
                feedback?.type === "wrong" &&
                feedback.staffPageIndex !== undefined
                  ? isMobileStaffPage && !isContinuousStaffPage
                    ? feedback.staffPageIndex - mobileStaffPageStartIndex
                    : feedback.staffPageIndex
                  : undefined
              }
              wrongStaff={isDuetPractice ? feedback?.staff : undefined}
              barlineAfterNoteIndices={staffPageBarlineAfterNoteIndices}
              beatsPerMeasure={visibleStaffPageRhythm ? 4 : undefined}
              completedCount={
                isMobileStaffPage && !isContinuousStaffPage
                  ? (staffPageView?.completedCount ?? staffPageCompletedCount)
                  : staffPageCompletedCount
              }
              cursorIndexOffset={freeCursorIndexOffset}
              diagnosticSampleId={feedback?.diagnosticSampleId}
              isScrolling={
                isContinuousStaffPage ? false : isMobileStaffPage ? false : isStaffPageScrolling
              }
              getAudioTime={getPianoAudioTime}
              getPracticeProgressBeat={
                isMetronomeSyncActive ? getSynchronizedProgressBeat : undefined
              }
              alignPracticeProgressMarkerToNote={isPreReadingPractice}
              followRowIndex={freePracticeFollowRowIndex}
              trackedNoteIndex={trackedFreeScoreNoteIndex}
              preReadingNoteStates={visiblePreReadingNoteStates}
              preReadingCurrentNoteIndex={
                isPreReadingPractice
                  ? preReadingCurrentNoteIndex - freeCursorIndexOffset
                  : undefined
              }
              isPreReadingPaused={isPreReadingPractice && isPaused}
              onTrackedNoteVisibilityChange={handleFreeTrackedNoteVisibilityChange}
              isFiniteScore={
                isContinuousStaffPage &&
                mode === "fixed-count" &&
                staffPageFirstNoteOffset + staffPageNotes.length >= fixedCount
              }
              layout={responsivePracticeStaffLayout}
              noteDuration={effectivePromptNoteDuration}
              noteDurations={visibleStaffPageRhythm?.durations}
              noteMeasures={visibleStaffPageRhythm?.measures}
              noteOnsets={visibleStaffPageRhythm?.onsets}
              syncNoteStatuses={visibleSyncNoteStatuses}
              practiceProgressMarkerEnabled={
                !isMetronomeSyncActive ||
                (syncCountInBeat === null &&
                  (!isPreReadingPractice || preReadingCountdownComplete)) ||
                syncProgressMarkerLeadEnabled
              }
              noteBeamGroups={visibleStaffPageRhythm?.noteBeamGroups}
              staffNoteDurations={visibleStaffPageRhythm?.staffNoteDurations}
              monophonicGrandStaff
              showGrandStaffRests={
                isDuetPractice && (duetLevel === "level-1" || duetLevel === "level-2")
              }
              keepMeasuresTogether={
                isDuetPractice || (isContinuousStaffPage && visibleStaffPageRhythm !== undefined)
              }
              maxMeasuresPerRow={
                isContinuousStaffPage ? adaptiveMeasuresPerRow : duetMaxMeasuresPerRow
              }
              onToggleRowPlayback={isMetronomeSyncActive ? undefined : toggleFreeScoreRowPlayback}
              scrollDurationMs={staffPageScrollDurationMs}
              followRowAtTop={isContinuousStaffPage}
              staffNotationMode={staffNotationMode}
              useLedgerGap={useLedgerGap}
              virtualizeRows={isContinuousStaffPage}
              adaptiveWidthLayout={isContinuousStaffPage || isDuetPractice}
              adaptiveMeasureAreaWidthPx={adaptiveMeasureAreaWidthPx}
              distributeNotesEvenly={false}
              timeSignature={visibleStaffPageRhythm ? "4/4" : undefined}
              notesPerRow={
                isContinuousStaffPage
                  ? adaptiveEventsPerRow
                  : isDuetPractice
                    ? staffPageNoteCount
                    : isMobileStaffPage
                      ? MOBILE_STAFF_PAGE_NOTE_COUNT
                      : undefined
              }
              maxRowCount={
                isContinuousStaffPage
                  ? staffPageRenderedRowCount
                  : isMobileStaffPage
                    ? mobileStaffPageRowCount
                    : undefined
              }
              minDisplayWidthPx={isMobileStaffPage ? 0 : undefined}
              visibleRowCount={
                isContinuousStaffPage
                  ? staffPageRenderedRowCount
                  : isMobileStaffPage
                    ? mobileStaffPageRowCount
                    : staffPageRowCount
              }
              playingRowIndex={freePlayingRowIndex}
              playbackCursor={freePlaybackCursor}
              playbackProgressIndex={
                freePlayingRowIndex !== null && freePlayingNoteIndex !== null
                  ? (freePlaybackRows[freePlayingRowIndex]?.[freePlayingNoteIndex]?.eventIndex ??
                    null)
                  : null
              }
              chaseCursor={visibleFreeChaseCursor}
              wrongIndex={
                !isDuetPractice &&
                feedback?.type === "wrong" &&
                feedback.staffPageIndex !== undefined
                  ? isMobileStaffPage && !isContinuousStaffPage
                    ? feedback.staffPageIndex - mobileStaffPageStartIndex
                    : feedback.staffPageIndex
                  : undefined
              }
            />
            {shouldShowStaffPageContinuationHint ? (
              <>
                <p className="staff-page-continuation-hint">
                  音符补给正在路上！继续弹，快到末尾时新谱就接上啦～
                </p>
                <div aria-hidden="true" className="staff-page-continuation-scroll-tail" />
              </>
            ) : null}
          </div>
        ) : currentNote ? (
          <StaffPrompt
            effectiveTargetNoteIds={effectiveTargetNoteIds}
            note={currentNote}
            noteDuration={effectivePromptNoteDuration}
            staffNotationMode={staffNotationMode}
            useLedgerGap={useLedgerGap}
            wrong={feedback?.type === "wrong"}
          />
        ) : null}
      </div>

      {phase === "running" &&
      practiceTab === "free" &&
      promptDisplayMode === "staff-page" &&
      !isPaused &&
      freeTrackedNoteVisibility !== null &&
      freeTrackedNoteVisibility.noteOffset === staffPageFirstNoteOffset &&
      !freeTrackedNoteVisibility.visible ? (
        <ReturnToCurrentNoteButton getTarget={getFreeCurrentNoteTarget} />
      ) : null}

      {showPracticeKeyboard ? (
        <VirtualPianoKeyboard
          ariaLabel="答案琴键"
          className="practice-virtual-piano-keyboard"
          disabled={isPaused || freePlayingRowIndex !== null}
          enabledKeys={
            answerPitchMode === "note-name" ? NATURAL_PIANO_KEYS : new Set<PianoKeyName>()
          }
          feedback={
            feedback?.noteName ? { keyName: feedback.noteName, type: feedback.type } : undefined
          }
          getKeyAriaLabel={(keyName) => `${keyName.replace("#", "♯")} 音键`}
          onKeyPress={(keyName) => {
            if (answerPitchMode === "note-name" && isNaturalPianoKey(keyName)) {
              submitPracticeAnswer({ noteName: keyName, source: "screen-keyboard" });
            }
          }}
          onKeyTransitionEnd={
            MIDI_LATENCY_DIAGNOSTICS_ENABLED
              ? (keyName, type, propertyName) => {
                  const diagnosticSampleId = feedback?.diagnosticSampleId;
                  if (
                    type === feedback?.type &&
                    feedback?.noteName === keyName &&
                    diagnosticSampleId !== undefined &&
                    propertyName.startsWith("border-") &&
                    propertyName.endsWith("-color")
                  ) {
                    markMidiLatencyStage(diagnosticSampleId, "transitionEnd");
                  }
                }
              : undefined
          }
          pressedKeys={pressedAnswerKeys}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {tick} {wrongAnswerCount}
      </span>
      {isPaused ? (
        <PauseOverlay
          onExit={handleExitPractice}
          onResume={resumePractice}
          onRestart={isLearningRoutePractice ? () => void restartCurrentPractice() : undefined}
          allowBackdropResume={!isMobileViewport}
          resumeBlockedMessage={
            answerPitchMode === "exact-pitch" && !midi.isConnected
              ? "MIDI 连接已断开；重新连接后可继续练习"
              : undefined
          }
          resumeMessage={
            answerPitchMode === "microphone"
              ? practiceMicrophone.status === "requesting"
                ? "正在重新连接麦克风…"
                : practiceMicrophone.isListening
                  ? "麦克风已连接，正在继续练习…"
                  : practiceMicrophone.error
                    ? "麦克风重连失败，点击下方按钮重试"
                    : isMobileViewport
                      ? "暂停期间麦克风已释放；点击空白处重新连接"
                      : "暂停期间麦克风已释放；点击空白处重新连接"
              : undefined
          }
          recoveryReloadAvailable={practiceMicrophone.recoveryReloadAvailable}
          onReloadAfterRecoveryFailure={() => void practiceMicrophone.reloadAfterRecoveryFailure()}
          microphoneError={
            answerPitchMode === "microphone"
              ? (practiceMicrophone.error ??
                (practiceMicrophone.status === "requesting"
                  ? "正在重新连接麦克风…"
                  : practiceMicrophone.status === "error"
                    ? "麦克风连接失败，请重试连接。"
                    : null))
              : null
          }
          microphoneConnecting={practiceMicrophone.status === "requesting"}
          microphoneIsPreparingModel={practiceMicrophone.isPreparingSwiftF0}
          onRetryMicrophone={answerPitchMode === "microphone" ? resumePractice : undefined}
          showKeyboardShortcuts={!isMobileViewport}
        />
      ) : null}
      {isQuestionLimitReached ? (
        <PracticeQuestionLimitDialog
          onEnd={() => void completeSession("completed-count", undefined, { showSummary: false })}
        />
      ) : null}
      <PracticeChaseSettingsDialog
        hideHandMode={staffNotationMode !== "grand"}
        isMidiConnected={midi.isConnected}
        isOpen={isChaseSettingsOpen}
        mode="free"
        settings={{
          enabled: practiceSetupPreferences.chaseEnabled,
          handMode: practiceSetupPreferences.chaseHandMode,
          speedMultiplier: practiceSetupPreferences.chaseSpeedMultiplier,
          startCount: practiceSetupPreferences.chaseStartCount,
        }}
        onClose={() => setIsChaseSettingsOpen(false)}
        onSave={saveFreeChaseSettings}
      />
    </section>
  );
}
