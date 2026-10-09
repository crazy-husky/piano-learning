import { ArrowLeft, BarChart3, Download, Pause, Play, SlidersHorizontal, Square, Volume2 } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { playTargetNote } from "../../../audio/piano";
import { db, resolveDrillNoteNames, resolveQueueStrategy } from "../../../data/db";
import { writeBackupIfSafe } from "../../../data/backup";
import {
  markMidiLatencyStage,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
} from "../../../diagnostics/midiLatencyDiagnostics";
import { markMidiLatencyAfterPaint } from "../../../diagnostics/midiLatencyPaint";
import {
  normalizeAnswerPitchMode,
  resolveAvailableAnswerPitchMode,
  type PracticeAnswerInput,
} from "../../../domain/answerInput";
import { createMelodyGenerationState } from "../../../domain/melody";
import {
  ANSWER_BUTTONS,
  getNotesForGroups,
  PRACTICE_GROUPS,
} from "../../../domain/notes";
import { getEffectivePracticeNotes } from "../../../domain/practiceComparison";
import { createAdaptiveNoteScheduler, selectNextNote, selectNotePage, type AdaptiveNoteScheduler } from "../../../domain/scheduler";
import type { SessionProgressMode } from "../../../domain/sessionProgress";
import { filterLongTermReviews } from "../../../domain/stats";
import type {
  AppSettings,
  AnswerPitchMode,
  InterruptReason,
  NoteName,
  PracticeGroupId,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PracticeSessionStartSnapshot,
  PromptDisplayMode,
  PromptNoteDuration,
  PianoKeyName,
  ReviewRecord,
  TargetNote,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { resolveHistoryLimit } from "../../../shared/components/HistoryLimitControl";
import { isInteractiveShortcutTarget, shouldHandleGlobalEnter } from "../../../shared/keyboard/keyboardShortcuts";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/sessionProgressPreferences";
import { PauseOverlay } from "../../../shared/components/PauseOverlay";
import type { PracticePagePreferences } from "../../../shared/preferences/practicePagePreferences";
import { isNaturalPianoKey, NATURAL_PIANO_KEYS, PianoKeyboard } from "../../../shared/components/PianoKeyboard";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffPrompt } from "./StaffPrompt";
import {
  MOBILE_PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_PAGE_STAFF_LAYOUT,
} from "../../../shared/staff/staffLayoutProfiles";
import {
  buildMobileStaffPageView,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "../logic/staffPageFlow";
import { PROMPT_NOTE_DURATIONS } from "../logic/staffPageNotation";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  normalizePausedPlaybackBpm,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "../../../shared/preferences/staffPageUiPreferences";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";
import { useDelayedBusy } from "../../../shared/hooks/useDelayedBusy";
import { useRemainingNotePlayback } from "../hooks/useRemainingNotePlayback";
import { usePracticeTimers } from "../hooks/usePracticeTimers";
import {
  usePracticeSessionLifecycle,
  type PracticePromptRuntime as PromptRuntime,
  type PracticeStaffPageRuntime as StaffPageRuntime,
} from "../hooks/usePracticeSessionLifecycle";
import { usePracticeInput } from "../hooks/usePracticeInput";
import { usePracticeSessionState } from "../hooks/usePracticeSessionState";
import { usePracticeSessionStart } from "../hooks/usePracticeSessionStart";
import { usePracticeAnswerFlow } from "../hooks/usePracticeAnswerFlow";
import { usePracticeStaffPageFlow } from "../hooks/usePracticeStaffPageFlow";
import { usePracticeSummaryData } from "../hooks/usePracticeSummaryData";
import { PracticeMicrophoneAnalysisDialog } from "./PracticeMicrophoneAnalysisDialog";
import { PracticeMicrophoneDebugDialog } from "./PracticeMicrophoneDebugDialog";
import { PracticeSummaryView } from "./PracticeSummaryView";
import { PracticeSetupView, type PracticeSetupUiPreferences } from "./PracticeSetupView";
import { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { StaffGameView } from "../../staff-game/components/StaffGameView";
import {
  parseExpectedPracticeNoteSequence,
  type PracticeMicrophoneAnalysis,
} from "../../vocal-pitch/logic/practiceMicrophoneAnalysis";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  normalizePracticeMicrophoneDebugParameters,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
  resolvePracticeMicrophoneConfiguration,
  resolvePracticeMicrophoneFrameIntervalMs,
  withPracticeMicrophoneAlgorithm,
  type PracticeMicrophoneAlgorithm,
  type PracticeMicrophoneDebugParameters,
  type PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  ensureSwiftF0PracticeRuntimeReady,
  isSwiftF0PracticeRuntimeReady,
  releaseSwiftF0PracticeRuntime,
} from "../../vocal-pitch/logic/swiftF0PracticeClient";
import { ensurePracticeMicrophoneForResume, releasePracticeMicrophoneOnPause } from "../logic/practiceInputLifecycle";

interface PracticeViewProps {
  midi: MidiInputController;
  practiceMicrophonePreferences: PracticeMicrophonePreferences;
  onPracticeMicrophonePreferencesChange: Dispatch<SetStateAction<PracticeMicrophonePreferences>>;
  practicePagePreferences: PracticePagePreferences;
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onNavigationExit?: (targetView: PracticeNavigationExitTarget) => void;
  onRequestNavigationExit: (targetView: PracticeNavigationExitTarget) => void;
  onSettingsSaved: (settings: AppSettings, options?: { feedback?: boolean }) => void | Promise<void>;
  onDataChanged: () => Promise<void>;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  isStaffGameRoute: boolean;
  initialStaffGameMode?: "levels" | "songs";
  initialSongSelectionStep?: "list" | "detail";
  initialSongId?: string;
  isStaffGameSongPlayRoute?: boolean;
  onStaffGameModeChange: (mode: "levels" | "songs") => void;
  onStaffGameSongStart: (songId: string) => void;
  onStaffGameSongSelectionExit: () => void;
  onStaffGameRouteChange: (isGame: boolean) => void;
  onBeforePracticeStart: () => Promise<PracticeStartPreflightResult>;
  onPracticeFinished: () => void;
  onRunningChange: (running: boolean) => void;
}

export type PracticeNavigationExitTarget = "home" | "practice" | "stats" | "settings" | "study" | "vocal";

export interface PracticeStartPreflightResult {
  proceed: boolean;
  reviews?: ReviewRecord[];
  settings?: AppSettings;
}

export interface PracticeNavigationExitRequest {
  id: number;
  targetView: PracticeNavigationExitTarget;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const ALL_GROUP_IDS: PracticeGroupId[] = PRACTICE_GROUPS.map((group) => group.id);
const STAFF_PAGE_SCROLL_DURATION_MS = 200;
const MELODY_BUFFER_SIZE = 16;
const PRACTICE_SETUP_UI_PREFERENCES_KEY = "anki-note.practiceSetupUiPreferences";
const PRACTICE_MODES: readonly PracticeMode[] = ["open-ended", "fixed-count", "fixed-duration"];
const PROMPT_DISPLAY_MODES: readonly PromptDisplayMode[] = ["single-note", "staff-page"];

const PRACTICE_QUEUE_STRATEGIES: readonly PracticeQueueStrategy[] = ["adaptive", "focused", "melody", "note-drill"];

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

function isPracticeQueueStrategy(value: unknown): value is PracticeQueueStrategy {
  return typeof value === "string" && PRACTICE_QUEUE_STRATEGIES.includes(value as PracticeQueueStrategy);
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
  const selected = new Set(value.filter((noteName): noteName is string => typeof noteName === "string"));
  return ANSWER_BUTTONS.map((button) => button.noteName).filter((noteName) => selected.has(noteName));
}

function makeDefaultPracticeSetupUiPreferences(settings: AppSettings): PracticeSetupUiPreferences {
  return {
    answerPitchMode: settings.answerPitchMode,
    autoPlayTarget: settings.autoPlayTarget,
    playAnswerNote: settings.playAnswerNote,
    drillNoteNames: resolveDrillNoteNames(settings),
    fixedCount: settings.fixedCount,
    fixedDurationSeconds: settings.fixedDurationSeconds,
    mode: settings.defaultMode,
    promptDisplayMode: settings.promptDisplayMode ?? "staff-page",
    promptNoteDuration: settings.promptNoteDuration ?? "quarter",
    queueStrategy: resolveQueueStrategy(settings),
  };
}

function parsePracticeSetupUiPreferences(
  value: unknown,
  fallback: PracticeSetupUiPreferences,
): PracticeSetupUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    answerPitchMode: normalizeAnswerPitchMode(value.answerPitchMode, fallback.answerPitchMode),
    autoPlayTarget: typeof value.autoPlayTarget === "boolean" ? value.autoPlayTarget : fallback.autoPlayTarget,
    playAnswerNote: typeof value.playAnswerNote === "boolean" ? value.playAnswerNote : fallback.playAnswerNote,
    drillNoteNames: normalizeDrillNoteNames(value.drillNoteNames, fallback.drillNoteNames),
    fixedCount: normalizeFixedCount(value.fixedCount, fallback.fixedCount),
    fixedDurationSeconds: normalizeFixedDurationSeconds(value.fixedDurationSeconds, fallback.fixedDurationSeconds),
    mode: isPracticeMode(value.mode) ? value.mode : fallback.mode,
    promptDisplayMode: isPromptDisplayMode(value.promptDisplayMode) ? value.promptDisplayMode : fallback.promptDisplayMode,
    promptNoteDuration: isPromptNoteDuration(value.promptNoteDuration) ? value.promptNoteDuration : fallback.promptNoteDuration,
    queueStrategy: isPracticeQueueStrategy(value.queueStrategy)
      ? value.queueStrategy === "focused" ? "adaptive" : value.queueStrategy
      : fallback.queueStrategy,
  };
}

export function PracticeView({
  midi,
  practiceMicrophonePreferences,
  onPracticeMicrophonePreferencesChange,
  practicePagePreferences,
  settings,
  sessions,
  reviews,
  navigationExitRequest,
  onNavigationExit,
  onRequestNavigationExit,
  onSettingsSaved,
  onDataChanged,
  onOpenStats,
  onOpenSettings,
  isStaffGameRoute,
  initialStaffGameMode = "levels",
  initialSongSelectionStep = "list",
  initialSongId,
  isStaffGameSongPlayRoute = false,
  onStaffGameModeChange,
  onStaffGameSongStart,
  onStaffGameSongSelectionExit,
  onStaffGameRouteChange,
  onBeforePracticeStart,
  onPracticeFinished,
  onRunningChange,
}: PracticeViewProps): JSX.Element {
  const practiceExperienceMode = isStaffGameRoute ? "game" : "free";
  const [staffGameSessionActive, setStaffGameSessionActive] = useState(false);
  const defaultPracticeSetupUiPreferences = useMemo(
    () => makeDefaultPracticeSetupUiPreferences(settings),
    [settings],
  );
  const [practiceSetupPreferences, setPracticeSetupPreferences] = useLocalStorageState(
    PRACTICE_SETUP_UI_PREFERENCES_KEY,
    defaultPracticeSetupUiPreferences,
    { parse: parsePracticeSetupUiPreferences },
  );
  const [sessionProgressPreferences, setSessionProgressPreferences] = useLocalStorageState(
    SESSION_PROGRESS_UI_PREFERENCES_KEY,
    DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
    { parse: parseSessionProgressUiPreferences },
  );
  const [staffPageUiPreferences, setStaffPageUiPreferences] = useLocalStorageState(
    STAFF_PAGE_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    { parse: parseStaffPageUiPreferences },
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
  const [microphoneCaptureAnalysis, setMicrophoneCaptureAnalysis] = useState<PracticeMicrophoneAnalysis | null>(null);
  const [microphoneCaptureNotice, setMicrophoneCaptureNotice] = useState<string | null>(null);
  const [expandedCandidateSegmentKey, setExpandedCandidateSegmentKey] = useState<string | null>(null);
  const [isMicrophoneAnalysisDialogOpen, setIsMicrophoneAnalysisDialogOpen] = useState(false);
  const [isMicrophoneDebugDialogOpen, setIsMicrophoneDebugDialogOpen] = useState(false);
  const [isLoadingMicrophoneAlgorithm, setIsLoadingMicrophoneAlgorithm] = useState(false);
  const [microphoneAlgorithmError, setMicrophoneAlgorithmError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    diagnosticSampleId?: number;
    type: "wrong" | "correct";
    noteName?: NoteName;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const [staffPageNotes, setStaffPageNotes] = useState<TargetNote[]>([]);
  const [staffPageIndex, setStaffPageIndex] = useState(0);
  const [staffPageCompletedCount, setStaffPageCompletedCount] = useState(0);
  const [staffPageFirstNoteOffset, setStaffPageFirstNoteOffset] = useState(0);
  const [isStaffPageScrolling, setIsStaffPageScrolling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches,
  );
  const { isBusyVisible: showStartingSessionStatus, run: runSessionStart } = useDelayedBusy();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const runningStartSnapshot = phase === "running" &&
      (session?.schemaVersion === 3 || session?.schemaVersion === 4 || session?.schemaVersion === 5)
    ? session.startSnapshot
    : undefined;
  const answerPitchMode = runningStartSnapshot
    ? normalizeAnswerPitchMode(runningStartSnapshot.practiceConfig.answerPitchMode)
    : resolveAvailableAnswerPitchMode(practiceSetupPreferences.answerPitchMode, midi.isConnected);
  const mode = runningStartSnapshot?.practiceConfig.mode ?? practiceSetupPreferences.mode;
  const promptDisplayMode = runningStartSnapshot?.presentationConfig.promptDisplayMode ?? practiceSetupPreferences.promptDisplayMode;
  const promptNoteDuration = runningStartSnapshot?.presentationConfig.promptNoteDuration ?? practiceSetupPreferences.promptNoteDuration;
  const fixedCount = runningStartSnapshot?.practiceConfig.fixedCount ?? practiceSetupPreferences.fixedCount;
  const fixedDurationSeconds =
    runningStartSnapshot?.practiceConfig.fixedDurationSeconds ?? practiceSetupPreferences.fixedDurationSeconds;
  const autoPlayTarget = runningStartSnapshot?.presentationConfig.autoPlayTarget ?? practiceSetupPreferences.autoPlayTarget;
  const playAnswerNote = runningStartSnapshot?.presentationConfig.playAnswerNote ?? practiceSetupPreferences.playAnswerNote;
  const queueStrategy = runningStartSnapshot?.practiceConfig.queueStrategy ?? practiceSetupPreferences.queueStrategy;
  const drillNoteNames = runningStartSnapshot?.practiceConfig.drillNoteNames ?? practiceSetupPreferences.drillNoteNames;
  const pausedPlaybackBpm = staffPageUiPreferences.pausedPlaybackBpm;
  const startPausedReading = staffPageUiPreferences.startPausedReading;
  const effectivePromptNoteDuration = runningStartSnapshot?.presentationConfig.promptNoteDuration ?? promptNoteDuration;
  const effectiveAnswerKeyboardScale = runningStartSnapshot?.interactionConfig.answerKeyboardScale ?? settings.answerKeyboardScale;
  const staffPageScrollDurationMs =
    (runningStartSnapshot?.presentationConfig.smoothStaffPageScroll ?? staffPageUiPreferences.smoothStaffPageScroll) &&
    !(runningStartSnapshot?.environment.prefersReducedMotion ?? prefersReducedMotion)
      ? STAFF_PAGE_SCROLL_DURATION_MS
      : 0;
  const summaryProgressMode = sessionProgressPreferences.mode;
  const summaryAllHistory = sessionProgressPreferences.allHistory;
  const summaryHistoryLimit = sessionProgressPreferences.historyLimit;
  const summaryEffectiveHistoryLimit = resolveHistoryLimit(summaryHistoryLimit, summaryAllHistory, sessions.length);
  const setMode = (nextMode: PracticeMode): void => {
    setPracticeSetupPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setAnswerPitchMode = (nextAnswerPitchMode: AnswerPitchMode): void => {
    setPracticeSetupPreferences((current) => ({ ...current, answerPitchMode: nextAnswerPitchMode }));
  };
  const setPromptDisplayMode = (nextPromptDisplayMode: PromptDisplayMode): void => {
    setPracticeSetupPreferences((current) => ({ ...current, promptDisplayMode: nextPromptDisplayMode }));
  };
  const setPromptNoteDuration = (nextPromptNoteDuration: PromptNoteDuration): void => {
    setPracticeSetupPreferences((current) => ({ ...current, promptNoteDuration: nextPromptNoteDuration }));
  };
  const setFixedCount = (nextFixedCount: number): void => {
    setPracticeSetupPreferences((current) => ({ ...current, fixedCount: normalizeFixedCount(nextFixedCount, current.fixedCount) }));
  };
  const setFixedDurationSeconds = (nextFixedDurationSeconds: number): void => {
    setPracticeSetupPreferences((current) => ({
      ...current,
      fixedDurationSeconds: normalizeFixedDurationSeconds(nextFixedDurationSeconds, current.fixedDurationSeconds),
    }));
  };
  const setAutoPlayTarget = (nextAutoPlayTarget: boolean): void => {
    setPracticeSetupPreferences((current) => ({ ...current, autoPlayTarget: nextAutoPlayTarget }));
  };
  const setPlayAnswerNote = (nextPlayAnswerNote: boolean): void => {
    setPracticeSetupPreferences((current) => ({ ...current, playAnswerNote: nextPlayAnswerNote }));
  };
  const setQueueStrategy = (nextQueueStrategy: PracticeQueueStrategy): void => {
    setPracticeSetupPreferences((current) => ({ ...current, queueStrategy: nextQueueStrategy }));
  };
  const setPausedPlaybackBpm = (nextBpm: number): void => {
    setStaffPageUiPreferences((current) => ({
      ...current,
      pausedPlaybackBpm: normalizePausedPlaybackBpm(nextBpm, current.pausedPlaybackBpm),
    }));
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
  const sessionRef = useRef<PracticeSessionRecord | null>(null);
  const sessionStartSnapshotRef = useRef<PracticeSessionStartSnapshot | null>(null);
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
  const staffGameAnswerHandlerRef = useRef<((answer: PracticeAnswerInput) => void) | null>(null);
  const registerStaffGameAnswerHandler = useCallback((handler: ((answer: PracticeAnswerInput) => void) | null): void => {
    staffGameAnswerHandlerRef.current = handler;
  }, []);
  const exitStaffGame = useCallback((): void => {
    onStaffGameRouteChange(false);
  }, [onStaffGameRouteChange]);
  const practiceMicrophone = usePracticeMicrophoneInput(
    (answer) => {
      if (staffGameAnswerHandlerRef.current) {
        staffGameAnswerHandlerRef.current(answer);
      } else {
        submitAnswerRef.current(answer);
      }
    },
    practiceMicrophonePreferences,
  );
  const microphoneConfiguration = useMemo(
    () => resolvePracticeMicrophoneConfiguration(practiceMicrophonePreferences),
    [practiceMicrophonePreferences],
  );
  const microphoneAnalysisIntervalMs = resolvePracticeMicrophoneFrameIntervalMs(microphoneConfiguration);
  const expectedMicrophoneSequence = useMemo(
    () => parseExpectedPracticeNoteSequence("C4 D4 E4 F4 G4 A4 B4"),
    [],
  );

  function updateMicrophoneDebugParameters(patch: Partial<PracticeMicrophoneDebugParameters>): void {
    if (Object.entries(patch).every(([key, value]) =>
      practiceMicrophonePreferences.debugParameters[key as keyof PracticeMicrophoneDebugParameters] === value)) {
      return;
    }
    onPracticeMicrophonePreferencesChange((current) => ({
      ...current,
      debugParameters: normalizePracticeMicrophoneDebugParameters({ ...current.debugParameters, ...patch }),
    }));
    toast.success("设置已保存并生效", { duration: 1_800, id: "practice-microphone-settings-saved" });
  }

  function restoreMicrophoneDebugDefaults(): void {
    if (practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting") return;
    const defaultPreferences = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES;
    const hasParameterChanges = Object.entries(defaultPreferences.debugParameters).some(([key, value]) =>
      practiceMicrophonePreferences.debugParameters[key as keyof PracticeMicrophoneDebugParameters] !== value);
    if (practiceMicrophonePreferences.algorithm === defaultPreferences.algorithm && !hasParameterChanges) return;
    if (practiceMicrophonePreferences.algorithm === "swiftf0") {
      releaseSwiftF0PracticeRuntime();
    }
    onPracticeMicrophonePreferencesChange((current) => ({
      ...current,
      algorithm: defaultPreferences.algorithm,
      debugParameters: { ...defaultPreferences.debugParameters },
    }));
    toast.success("设置已保存并生效", { duration: 1_800, id: "practice-microphone-settings-saved" });
  }

  async function selectMicrophoneAlgorithm(algorithm: PracticeMicrophoneAlgorithm): Promise<void> {
    if (algorithm === practiceMicrophonePreferences.algorithm || isLoadingMicrophoneAlgorithm) return;
    if (practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting") {
      setMicrophoneAlgorithmError("请先暂停练习并释放麦克风，再切换识别算法。");
      return;
    }
    setMicrophoneAlgorithmError(null);
    if (algorithm === "swiftf0" && !isSwiftF0PracticeRuntimeReady()) {
      setIsLoadingMicrophoneAlgorithm(true);
      try {
        await ensureSwiftF0PracticeRuntimeReady();
      } catch (error) {
        setMicrophoneAlgorithmError(
          `算法资源加载失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      } finally {
        setIsLoadingMicrophoneAlgorithm(false);
      }
    } else if (algorithm !== "swiftf0") {
      releaseSwiftF0PracticeRuntime();
    }
    onPracticeMicrophonePreferencesChange((current) => withPracticeMicrophoneAlgorithm(current, algorithm));
    toast.success("设置已保存并生效", { duration: 1_800, id: "practice-microphone-settings-saved" });
  }

  useLayoutEffect(() => {
    const diagnosticSampleId = feedback?.diagnosticSampleId;
    if (diagnosticSampleId === undefined) {
      return undefined;
    }
    markMidiLatencyStage(diagnosticSampleId, "reactCommit");
    return markMidiLatencyAfterPaint(diagnosticSampleId, "paintApprox");
  }, [feedback]);

  const getRemainingPlaybackNotes = useCallback((): TargetNote[] => {
    const page = staffPageRef.current;
    const startIndex = page ? Math.max(page.index, page.completedCount) : 0;
    return page ? page.notes.slice(startIndex) : [];
  }, []);
  const {
    cancel: cancelRemainingPlayback,
    state: remainingPlaybackState,
    toggle: toggleRemainingPlayback,
  } = useRemainingNotePlayback({
    bpm: pausedPlaybackBpm,
    getNotes: getRemainingPlaybackNotes,
    noteDuration: effectivePromptNoteDuration,
  });

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
    onRunningChange(phase === "running" || staffGameSessionActive);
    return () => onRunningChange(false);
  }, [onRunningChange, phase, staffGameSessionActive]);

  const applySettingsSnapshot = useCallback((nextSettings: AppSettings): void => {
    setPracticeSetupPreferences(makeDefaultPracticeSetupUiPreferences(nextSettings));
  }, [setPracticeSetupPreferences]);

  const staffNotationMode = runningStartSnapshot?.practiceConfig.staffNotationMode ?? settings.staffNotationMode;
  const effectiveEnabledGroupIds = runningStartSnapshot?.practiceConfig.enabledGroupIds ?? settings.enabledGroupIds;
  const effectiveInterStaffLedgerSpellings =
    runningStartSnapshot?.practiceConfig.includeInterStaffLedgerSpellings ?? settings.includeInterStaffLedgerSpellings;
  const enabledNotes = useMemo(
    () => getNotesForGroups(effectiveEnabledGroupIds, effectiveInterStaffLedgerSpellings, staffNotationMode),
    [effectiveEnabledGroupIds, effectiveInterStaffLedgerSpellings, staffNotationMode],
  );
  const useLedgerGap = enabledNotes.some((note) => note.isInterStaffLedgerSpelling);
  const fullPracticeCount = useMemo(
    () => getNotesForGroups(ALL_GROUP_IDS, effectiveInterStaffLedgerSpellings, staffNotationMode).length,
    [effectiveInterStaffLedgerSpellings, staffNotationMode],
  );
  const fixedCountPresets = useMemo(
    () => Array.from(new Set([10, 20, fullPracticeCount])).filter((count) => count > 0),
    [fullPracticeCount],
  );
  const queueNotes = useMemo(
    () =>
      getEffectivePracticeNotes({
        drillNoteNames,
        enabledGroupIds: effectiveEnabledGroupIds,
        includeInterStaffLedgerSpellings: effectiveInterStaffLedgerSpellings,
        queueStrategy,
        staffNotationMode,
      }),
    [
      drillNoteNames,
      queueStrategy,
      effectiveEnabledGroupIds,
      effectiveInterStaffLedgerSpellings,
      staffNotationMode,
    ],
  );
  const effectiveTargetNoteIds = useMemo(
    () => new Set(queueNotes.map((note) => note.id)),
    [queueNotes],
  );
  const schedulerReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);
  const setupSettings = useMemo<AppSettings>(
    () => ({
      ...settings,
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
      queueStrategy,
    }),
    [
      answerPitchMode,
      autoPlayTarget,
      playAnswerNote,
      drillNoteNames,
      fixedCount,
      fixedDurationSeconds,
      mode,
      promptDisplayMode,
      promptNoteDuration,
      queueStrategy,
      settings,
    ],
  );

  const toggleDrillNoteName = useCallback((noteName: NoteName, checked: boolean): void => {
    setPracticeSetupPreferences((current) => {
      const next = checked
        ? [...current.drillNoteNames, noteName]
        : current.drillNoteNames.filter((name) => name !== noteName);
      const selected = new Set(next);
      return {
        ...current,
        drillNoteNames: ANSWER_BUTTONS.map((button) => button.noteName).filter((name) => selected.has(name)),
      };
    });
  }, [setPracticeSetupPreferences]);

  const markInterrupted = useCallback((reason: InterruptReason): void => {
    const prompt = promptRef.current;
    if (!prompt || prompt.interrupted) {
      return;
    }
    prompt.interrupted = true;
    prompt.interruptReason = reason;
  }, []);


  const pausePractice = useCallback((interruptReason?: InterruptReason): void => {
    if (interruptReason) {
      markInterrupted(interruptReason);
    }
    releasePracticeMicrophoneOnPause(answerPitchMode, () =>
      practiceMicrophone.stop({
        captureStopReason: "practice-paused",
        preserveError: practiceMicrophone.status === "error",
      }),
    );
    pauseActiveTimers();
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, [answerPitchMode, markInterrupted, pauseActiveTimers, practiceMicrophone.status, practiceMicrophone.stop]);

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
    cancelRemainingPlayback();
    isPausedRef.current = false;
    setIsPaused(false);
    const pendingAfterPause = pendingAfterPauseRef.current;
    pendingAfterPauseRef.current = null;
    if (pendingAfterPause) {
      pendingAfterPause();
      return;
    }
    if (promptRef.current) {
      resumeActiveTimers();
      if (sessionStartSnapshotRef.current?.presentationConfig.autoPlayTarget ?? autoPlayTarget) {
        void playTargetNote(promptRef.current.note).catch(() => undefined);
      }
    }
  }, [
    answerPitchMode,
    autoPlayTarget,
    cancelRemainingPlayback,
    midi.isConnected,
    practiceMicrophone.isListening,
    practiceMicrophone.start,
    resumeActiveTimers,
  ]);

  const togglePause = useCallback((): void => {
    if (isPausedRef.current) {
      resumePractice();
      return;
    }
    pausePractice("manual-pause");
  }, [pausePractice, resumePractice]);

  const pauseForFocusLoss = useCallback((lostFocusAt = new Date().toISOString()): void => {
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
  }, [pausePractice]);

  useEffect(() => {
    if (phase === "running" && answerPitchMode === "exact-pitch" && !midi.isConnected) {
      pausePractice("midi-disconnected");
    }
  }, [answerPitchMode, midi.isConnected, pausePractice, phase]);

  useEffect(() => {
    if (phase === "running" && answerPitchMode === "microphone" && practiceMicrophone.status === "error") {
      pausePractice("microphone-disconnected");
    }
  }, [answerPitchMode, pausePractice, phase, practiceMicrophone.status]);

  useEffect(() => {
    if (
      phase === "running" &&
      answerPitchMode === "microphone" &&
      isPaused &&
      !microphoneResumeInFlightRef.current &&
      practiceMicrophone.status === "listening"
    ) {
      practiceMicrophone.stop();
    }
  }, [answerPitchMode, isPaused, phase, practiceMicrophone.status, practiceMicrophone.stop]);

  const persistConfig = useCallback(async (): Promise<AppSettings> => {
    const nextSettings: AppSettings = {
      ...settings,
      answerPitchMode,
      defaultMode: mode,
      promptDisplayMode,
      promptNoteDuration,
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
    [mode],
  );

  const startPrompt = useCallback(
    (note: TargetNote): void => {
      const now = performance.now();
      const startsPaused = isPausedRef.current;
      promptRef.current = {
        note,
        startedAt: new Date().toISOString(),
        activeBaseMs: 0,
        activeStartedAt: startsPaused ? null : now,
        lastInputAt: now,
        wrongAnswers: [],
        replayCount: 0,
        focusLosses: [],
        interrupted: false,
      };
      setCurrentNote(note);
      setFeedback(null);
      answerInputLockedRef.current = false;
      if ((sessionStartSnapshotRef.current?.presentationConfig.autoPlayTarget ?? autoPlayTarget) && !startsPaused) {
        void playTargetNote(note).catch(() => undefined);
      }
    },
    [autoPlayTarget],
  );

  const {
    clearStaffPageScrollSchedule,
    markCurrentStaffPageNoteComplete,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
    syncStaffPage,
  } = usePracticeStaffPageFlow({
    values: {
      drillNoteNames,
      enabledNotes,
      fixedCount,
      mode,
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
    },
  });
  const drawMelodyNote = useCallback((sourceNotes: TargetNote[], remainingCount?: number): TargetNote => {
    if (melodyQueueRef.current.length === 0) {
      const count =
        remainingCount === undefined ? MELODY_BUFFER_SIZE : Math.min(MELODY_BUFFER_SIZE, Math.max(1, remainingCount));
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
  }, []);

  const selectAndStartNext = useCallback(
    (nextCompletedCount: number): void => {
      const remainingCount = mode === "fixed-count" ? fixedCount - nextCompletedCount : undefined;
      const note =
        queueStrategy === "melody"
          ? drawMelodyNote(enabledNotes, remainingCount)
          : adaptiveSchedulerRef.current?.select({ lastTargetNoteId: lastTargetNoteIdRef.current }) ??
            selectNextNote({
              notes: enabledNotes,
              reviews: [...schedulerReviews, ...sessionReviewsRef.current],
              sessions,
              currentSessionId: sessionRef.current?.id,
              queueStrategy,
              drillNoteNames,
              lastTargetNoteId: lastTargetNoteIdRef.current,
            });
      startPrompt(note);
    },
    [drillNoteNames, drawMelodyNote, enabledNotes, fixedCount, mode, queueStrategy, schedulerReviews, sessions, startPrompt],
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
    [],
  );
  const sessionLifecycleTimers = useMemo(
    () => ({ getPromptActiveMs, getSessionActiveMs, pauseActiveTimers }),
    [getPromptActiveMs, getSessionActiveMs, pauseActiveTimers],
  );
  const sessionLifecycleServices = useMemo(
    () => ({
      stopMicrophone: practiceMicrophone.stop,
      cancelRemainingPlayback,
      clearStaffPageScrollSchedule,
      onDataChanged,
      onPracticeFinished,
    }),
    [cancelRemainingPlayback, clearStaffPageScrollSchedule, onDataChanged, onPracticeFinished, practiceMicrophone.stop],
  );
  const sessionLifecycleUi = useMemo(
    () => ({
      finishSessionState,
      syncStaffPage,
      setIsStaffPageScrolling,
      setIsPaused,
    }),
    [finishSessionState, syncStaffPage],
  );
  const { completeSession, finishCurrentReview } = usePracticeSessionLifecycle({
    runtime: sessionLifecycleRuntime,
    timers: sessionLifecycleTimers,
    services: sessionLifecycleServices,
    ui: sessionLifecycleUi,
  });

  useEffect(() => {
    if (
      phase !== "running" ||
      !navigationExitRequest ||
      handledNavigationExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledNavigationExitRequestIdRef.current = navigationExitRequest.id;
    const backgroundExit = Promise.resolve().then(() =>
      completeSession("manual-stop", "manual-stop", { showSummary: false, updateUi: false }),
    );
    onNavigationExit?.(navigationExitRequest.targetView);
    void backgroundExit.catch(() => undefined);
  }, [completeSession, navigationExitRequest, onNavigationExit, phase]);

  useEffect(() => {
    if (
      practiceExperienceMode !== "game" ||
      !staffGameSessionActive ||
      !navigationExitRequest ||
      handledNavigationExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledNavigationExitRequestIdRef.current = navigationExitRequest.id;
    practiceMicrophone.stop();
    setStaffGameSessionActive(false);
    onNavigationExit?.(navigationExitRequest.targetView);
  }, [navigationExitRequest, onNavigationExit, practiceExperienceMode, practiceMicrophone.stop, staffGameSessionActive]);

  const { startSession } = usePracticeSessionStart({
    values: {
      answerPitchMode,
      midi,
      prefersReducedMotion,
      queueNotes,
      schedulerReviews,
      sessions,
      staffNotationMode,
      staffPageUiPreferences,
      startPausedReading,
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
    },
    ui: {
      applySettingsSnapshot,
      beginSessionState,
      drawMelodyNote,
      resetSessionActiveTimer,
      setExpandedCandidateSegmentKey,
      setIsMicrophoneAnalysisDialogOpen,
      setIsPaused,
      setIsStaffPageScrolling,
      setMicrophoneCaptureAnalysis,
      setMicrophoneCaptureNotice,
      startPrompt,
      startStaffPage,
      syncStaffPage,
    },
  });
  const replayTarget = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt || isPausedRef.current || answerPitchMode === "microphone") {
      return;
    }
    markPromptInput();
    prompt.replayCount += 1;
    await playTargetNote(prompt.note).catch(() => undefined);
  }, [answerPitchMode, markPromptInput]);

  const { submitAnswer } = usePracticeAnswerFlow({
    values: {
      answerPitchMode,
      completedCount,
      correctDelayMs: settings.correctDelayMs,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      mode,
      playAnswerNote,
      promptDisplayMode,
      queueStrategy,
      schedulerReviews,
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
      markCurrentStaffPageNoteComplete,
      markPromptInput,
      maybeBackupDuringOpenEnded,
      resumeActiveTimers,
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
  submitAnswerRef.current = (answer) => void submitAnswer(answer);

  const handleInputEscape = useCallback((): void => {
    if (isMicrophoneDebugDialogOpen) {
      setIsMicrophoneDebugDialogOpen(false);
      return;
    }
    if (isMicrophoneAnalysisDialogOpen) {
      setIsMicrophoneAnalysisDialogOpen(false);
      return;
    }
    void completeSession("manual-stop", "manual-stop");
  }, [completeSession, isMicrophoneAnalysisDialogOpen, isMicrophoneDebugDialogOpen]);
  const { pressedAnswerKeys } = usePracticeInput({
    answerPitchMode,
    canStartOnMidi: practiceExperienceMode === "free",
    isPausedRef,
    isRunning: phase === "running",
    midi,
    onEscape: handleInputEscape,
    onResume: () => void resumePractice(),
    onStartSession: () => void startSession(),
    onSubmitAnswer: (answer) => void submitAnswer(answer),
    onTogglePause: togglePause,
  });

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    let focusLossStartedAt: number | null = null;
    let pauseTimeout: number | null = null;

    function onVisibilityOrBlur(): void {
      const hasFocus = document.visibilityState !== "hidden" && document.hasFocus();
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
  }, [pauseForFocusLoss, phase, practicePagePreferences.focusLossPauseSeconds]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const interval = window.setInterval(() => {
      const prompt = promptRef.current;
      if (prompt && prompt.activeStartedAt !== null && !prompt.interrupted) {
        const inactiveMs = getPromptInactiveMs();
        const inactivityThresholdSeconds =
          sessionStartSnapshotRef.current?.interactionConfig.inactivityThresholdSeconds ??
          settings.inactivityThresholdSeconds;
        if (inactiveMs >= inactivityThresholdSeconds * 1000) {
          markInterrupted("inactive-timeout");
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
    getPromptInactiveMs,
    getSessionActiveMs,
    markInterrupted,
    mode,
    phase,
    settings.inactivityThresholdSeconds,
  ]);

  const setupDisabledReason =
    enabledNotes.length === 0
      ? "请至少选择一组上方的音区"
      : queueStrategy === "note-drill" && drillNoteNames.length === 0
        ? "请至少选择一个强化音名"
        : undefined;
  const setupDisabled = setupDisabledReason !== undefined;

  useEffect(() => {
    if (phase === "running" || practiceExperienceMode === "game") {
      return;
    }

    function handleEnter(event: KeyboardEvent): void {
      if (
        !shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target)) ||
        (phase === "setup" && setupDisabled)
      ) {
        return;
      }
      event.preventDefault();
      void startSession();
    }

    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [phase, practiceExperienceMode, setupDisabled, startSession]);

  const remainingMs = mode === "fixed-duration" ? fixedDurationSeconds * 1000 - getSessionActiveMs() : 0;
  const mobileStaffPageRowCount = 1;
  const mobileStaffPageNoteCount = MOBILE_STAFF_PAGE_NOTE_COUNT * mobileStaffPageRowCount;
  const staffPageRowCount = 1;
  const showPracticeKeyboard = answerPitchMode !== "microphone" &&
    (!isMobileViewport || answerPitchMode === "note-name");
  const isMobileStaffPage = isMobileViewport && promptDisplayMode === "staff-page";
  const mobileStaffPageStartIndex =
    Math.floor(Math.max(0, staffPageIndex) / mobileStaffPageNoteCount) * mobileStaffPageNoteCount;
  const mobileStaffPageNotes = useMemo(
    () =>
      isMobileStaffPage
        ? staffPageNotes.slice(mobileStaffPageStartIndex, mobileStaffPageStartIndex + mobileStaffPageNoteCount)
        : staffPageNotes,
    [isMobileStaffPage, mobileStaffPageNoteCount, mobileStaffPageStartIndex, staffPageNotes],
  );
  const mobileStaffPageView = useMemo(
    () =>
      isMobileStaffPage
        ? buildMobileStaffPageView({
            completedCount: staffPageCompletedCount,
            currentIndex: staffPageIndex,
            firstNoteOffset: staffPageFirstNoteOffset,
            fixedSessionCount: mode === "fixed-count" ? fixedCount : undefined,
            notes: staffPageNotes,
            pageNoteCount: mobileStaffPageNoteCount,
          })
        : null,
    [
      fixedCount,
      isMobileStaffPage,
      mobileStaffPageNoteCount,
      mode,
      staffPageCompletedCount,
      staffPageFirstNoteOffset,
      staffPageIndex,
      staffPageNotes,
    ],
  );
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

  if (phase === "setup" && practiceExperienceMode === "game") {
    return (
      <StaffGameView
        key={initialStaffGameMode}
        microphone={practiceMicrophone}
        midi={midi}
        initialMode={initialStaffGameMode}
        initialSongSelectionStep={initialSongSelectionStep}
        initialSongId={initialSongId}
        isSongPlayRoute={isStaffGameSongPlayRoute}
        onModeChange={onStaffGameModeChange}
        onSongStart={onStaffGameSongStart}
        onSongSelectionExit={onStaffGameSongSelectionExit}
        onExit={exitStaffGame}
        onRegisterAnswerHandler={registerStaffGameAnswerHandler}
        onSessionActiveChange={setStaffGameSessionActive}
      />
    );
  }

  if (phase === "setup") {
    return (
      <PracticeSetupView
        actions={{
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
          onStartPausedReadingChange: (enabled) => setStaffPageUiPreferences((current) => ({ ...current, startPausedReading: enabled })),
          onStartSession: () => void startSession(),
          onToggleDrillNoteName: toggleDrillNoteName,
        }}
        fixedCountPresets={fixedCountPresets}
        isBusy={showStartingSessionStatus}
        microphoneError={practiceMicrophone.error}
        midi={midi}
        preferences={practiceSetupPreferences}
        setupDisabledReason={setupDisabledReason}
        startPausedReading={startPausedReading}
        settings={setupSettings}
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
        onOpenStats={onOpenStats}
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
        isMobileViewport ? "practice-running-mobile" : "",
        isMobileViewport && answerPitchMode !== "note-name" ? "practice-without-touch-keyboard" : "",
        `practice-${promptDisplayMode}`,
        promptDisplayMode === "staff-page"
          ? `practice-staff-page-rows-${isMobileStaffPage ? mobileStaffPageRowCount : staffPageRowCount}`
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="practice-topline">
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
            aria-label="返回首页"
            className="practice-return-home"
            title="返回首页"
            onClick={() => onRequestNavigationExit("home")}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            返回
          </button>
          {answerPitchMode !== "microphone" ? (
            <button title="重播目标音" onClick={() => void replayTarget()}>
              <Volume2 size={18} />
              重播
            </button>
          ) : null}
          <button
            aria-keyshortcuts="Space"
            title={answerPitchMode === "microphone"
              ? isPaused ? "重新连接麦克风并继续 空格" : "暂停 空格"
              : isPaused ? "继续 空格" : "暂停 空格"}
            onClick={togglePause}
          >
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? "继续" : "暂停"}<kbd>空格</kbd>
          </button>
          <button
            aria-keyshortcuts="Escape"
            title="结束 Esc"
            onClick={() => void completeSession("manual-stop", "manual-stop")}
          >
            <Square fill="currentColor" size={14} strokeWidth={0} />
            结束<kbd>Esc</kbd>
          </button>
        </div>
      </div>

      {answerPitchMode === "microphone" ? (
        <div className="practice-microphone-status">
          <span
            className={`practice-microphone-indicator ${practiceMicrophone.error ? "error" : practiceMicrophone.status}`}
            aria-hidden="true"
          />
          <span role="status">
            {practiceMicrophone.status === "listening"
              ? `正在监听麦克风 · ${practiceMicrophoneAlgorithmLabel(practiceMicrophonePreferences.algorithm)}`
              : practiceMicrophone.status === "requesting"
                ? `正在连接麦克风并加载 ${practiceMicrophoneAlgorithmLabel(practiceMicrophonePreferences.algorithm)}`
                : practiceMicrophone.error ?? (isPaused ? "已暂停，麦克风已释放" : "麦克风未连接")}
          </span>
          {practiceMicrophonePreferences.debugMode && practiceMicrophone.detectedNote
            ? <strong>听到 {practiceMicrophone.detectedNote}</strong>
            : null}
          {practiceMicrophonePreferences.debugMode ? (
            <progress aria-label="麦克风输入电平" max={1} value={practiceMicrophone.inputLevel} />
          ) : null}
          {practiceMicrophonePreferences.debugMode ? (
            <button
              className="practice-microphone-debug-trigger"
              disabled={practiceMicrophone.status === "requesting"}
              title="查看诊断并调整详细识别参数"
              type="button"
              onClick={() => setIsMicrophoneDebugDialogOpen(true)}
            >
              <SlidersHorizontal size={15} />
              调试设置
            </button>
          ) : null}
          {practiceMicrophonePreferences.debugMode ? (
          <div className="practice-microphone-capture">
            <button
              type="button"
              disabled={!practiceMicrophone.isListening ||
                (practiceMicrophone.captureAnalysisPending && !practiceMicrophone.captureRecording)}
              onClick={() => {
                if (practiceMicrophone.captureRecording) {
                  void (async () => {
                    const stopped = await practiceMicrophone.stopCapture();
                    if (stopped.frameCount === 0) {
                      const captureDiagnostics = [
                        `算法 ${practiceMicrophoneAlgorithmLabel(practiceMicrophonePreferences.algorithm)}`,
                        `采集循环 ${stopped.audioLoopFrameCount} 帧`,
                        `输入 RMS ${stopped.inputRms.toFixed(6)}`,
                        `音频上下文 ${stopped.audioContextState}`,
                        `麦克风轨道 ${stopped.trackReadyState}${stopped.trackMuted === null
                          ? ""
                          : stopped.trackMuted ? "（静音）" : "（未静音）"}`,
                      ].join("；");
                      toast.error(stopped.error ? "麦克风采集失败" : "没有采集到音频", {
                        description: `${stopped.error ?? "采集期间没有写入音频帧。"} ${captureDiagnostics}`,
                      });
                      return;
                    }
                    const analysis = practiceMicrophone.analyzeCapture(expectedMicrophoneSequence);
                    if (!analysis) {
                      toast.error("采样分析失败", {
                        description: stopped.error ?? stopped.finalFrameIssue ?? "采样暂时无法分析，请重新采集后再试。",
                      });
                      return;
                    }
                      setMicrophoneCaptureNotice(stopped.error || stopped.finalFrameIssue
                      ? `采样已保留；${stopped.error ?? stopped.finalFrameIssue}。以下分析基于已采集的数据。`
                      : null);
                    setMicrophoneCaptureAnalysis(analysis);
                    setIsMicrophoneAnalysisDialogOpen(true);
                  })();
                } else {
                  setMicrophoneCaptureAnalysis(null);
                  setMicrophoneCaptureNotice(null);
                  setIsMicrophoneAnalysisDialogOpen(false);
                  practiceMicrophone.startCapture();
                }
              }}
            >
              {practiceMicrophone.captureRecording ? <Square fill="currentColor" size={13} /> : <Play size={14} />}
              {practiceMicrophone.captureRecording ? "结束采集" : practiceMicrophone.captureFrameCount > 0 ? "重新采集" : "开始采集"}
            </button>
            <button
              className="primary practice-microphone-analysis-trigger"
              type="button"
              disabled={practiceMicrophone.captureFrameCount === 0 || practiceMicrophone.captureRecording ||
                practiceMicrophone.captureAnalysisPending ||
                expectedMicrophoneSequence === null}
              onClick={() => {
                if (microphoneCaptureAnalysis) {
                  setIsMicrophoneAnalysisDialogOpen(true);
                  return;
                }
                const analysis = practiceMicrophone.analyzeCapture(expectedMicrophoneSequence);
                if (analysis) {
                  setMicrophoneCaptureNotice(null);
                  setMicrophoneCaptureAnalysis(analysis);
                  setIsMicrophoneAnalysisDialogOpen(true);
                }
              }}
            >
              <BarChart3 size={14} />
              {microphoneCaptureAnalysis ? "查看分析" : "分析采样"}
            </button>
              <button
                type="button"
                disabled={practiceMicrophone.captureFrameCount === 0 || practiceMicrophone.captureRecording ||
                  practiceMicrophone.captureAnalysisPending}
              onClick={() => void practiceMicrophone.saveRecentCapture(microphoneCaptureAnalysis ?? undefined)}
            >
              <Download size={14} />
              分享采样和分析
            </button>
            {practiceMicrophone.captureRecording || practiceMicrophone.captureFrameCount > 0 ? (
              <span>
                {practiceMicrophone.captureRecording
                  ? `正在采集 ${Math.ceil(practiceMicrophone.captureDurationMs / 1000)} 秒 · ${microphoneConfiguration.analysisGain}× · 最长 30 秒`
                  : `已采集 ${Math.ceil(practiceMicrophone.captureDurationMs / 1000)} 秒 · ${microphoneConfiguration.analysisGain}× · ${practiceMicrophone.captureFrameCount} 帧`}
              </span>
            ) : null}
            <div className="practice-microphone-capture-guidance">
              <p>
                <strong>当前详细配置：</strong>
                {practiceMicrophoneAlgorithmLabel(microphoneConfiguration.algorithm)} · {microphoneConfiguration.debugMode
                  ? "调试参数"
                  : practiceMicrophoneSensitivityLevelLabel(microphoneConfiguration.sensitivityLevel)} ·
                {" "}{microphoneConfiguration.analysisGain}× · {microphoneConfiguration.requiredStableFrames} 帧 /
                {" "}{microphoneConfiguration.requiredStableMs} ms · 分析间隔 {microphoneAnalysisIntervalMs} ms ·
                {" "}置信度 {microphoneConfiguration.confidenceThreshold.toFixed(3)} ·
                {" "}RMS {microphoneConfiguration.inputRmsThreshold.toFixed(5)}
              </p>
              <div className="practice-microphone-diagnostic-flow">
                <strong>诊断流程：</strong>
                <ol>
                  <li>点击“开始采集”按钮。</li>
                  <li>依次从左往右弹奏中央 C 的七个白键（可快可慢，可轻可重）。</li>
                  <li>点击“分析采样”，查看识别结果是否符合预期。</li>
                  <li>结果不符合预期时，点击“分享采样和分析”，把数据发给 AI 分析问题。</li>
                </ol>
              </div>
            </div>
            {practiceMicrophone.captureStatus ? <span role="status">{practiceMicrophone.captureStatus}</span> : null}
          </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={promptDisplayMode === "staff-page" ? "prompt-stage staff-page-stage" : "prompt-stage"}
      >
        {promptDisplayMode === "staff-page" ? (
          <div className={isMobileStaffPage ? "staff-page-mobile-view" : undefined}>
            <StaffPagePrompt
              notes={mobileStaffPageNotes}
              completedCount={mobileStaffPageView?.completedCount ?? staffPageCompletedCount}
              diagnosticSampleId={feedback?.diagnosticSampleId}
              isScrolling={isMobileStaffPage ? false : isStaffPageScrolling}
              layout={isMobileStaffPage ? MOBILE_PRACTICE_PAGE_STAFF_LAYOUT : undefined}
              noteDuration={effectivePromptNoteDuration}
              scrollDurationMs={staffPageScrollDurationMs}
              staffNotationMode={staffNotationMode}
              useLedgerGap={useLedgerGap}
              distributeNotesEvenly={isMobileStaffPage}
              notesPerRow={isMobileStaffPage ? MOBILE_STAFF_PAGE_NOTE_COUNT : undefined}
              maxRowCount={isMobileStaffPage ? mobileStaffPageRowCount : undefined}
              minDisplayWidthPx={isMobileStaffPage ? 0 : undefined}
              visibleRowCount={isMobileStaffPage ? mobileStaffPageRowCount : staffPageRowCount}
              wrongIndex={
                feedback?.type === "wrong"
                  ? mobileStaffPageView?.noteIndexInPage ?? staffPageIndex
                  : undefined
              }
            />
            {mobileStaffPageView ? (
              <div aria-live="polite" className="staff-page-counter">
                第 {mobileStaffPageView.currentPage} / {mobileStaffPageView.totalPages} 页
              </div>
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

      {showPracticeKeyboard ? (
        <PianoKeyboard
          ariaLabel="答案琴键"
          className="practice-piano-keyboard"
          enabledKeys={answerPitchMode === "note-name" ? NATURAL_PIANO_KEYS : new Set<PianoKeyName>()}
          feedback={feedback?.noteName ? { keyName: feedback.noteName, type: feedback.type } : undefined}
          keyOctave={currentNote?.octave}
          onKeyPress={(key) => {
            if (answerPitchMode === "note-name" && isNaturalPianoKey(key.keyName)) {
              void submitAnswer({ noteName: key.keyName, source: "screen-keyboard" });
            }
          }}
          onFeedbackTransitionEnd={
            MIDI_LATENCY_DIAGNOSTICS_ENABLED
              ? (keyName, type, propertyName) => {
                  if (
                    type === feedback?.type &&
                    feedback?.noteName === keyName &&
                    propertyName.startsWith("border-") &&
                    propertyName.endsWith("-color")
                  ) {
                    markMidiLatencyStage(feedback.diagnosticSampleId, "transitionEnd");
                  }
                }
              : undefined
          }
          pressedKeys={pressedAnswerKeys}
          touchLabels={isMobileViewport}
          scale={effectiveAnswerKeyboardScale}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {tick} {wrongAnswerCount}
      </span>
      {isPaused ? (
        <PauseOverlay
          bpm={pausedPlaybackBpm}
          onBpmChange={setPausedPlaybackBpm}
          onResume={resumePractice}
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
                    ? isMobileViewport
                      ? `麦克风重连失败：${practiceMicrophone.error} 点击空白处重试`
                      : `麦克风重连失败：${practiceMicrophone.error} 点击空白处或按空格重试；按 Esc 退出练习`
                    : isMobileViewport
                      ? "暂停期间麦克风已释放；点击空白处重新连接"
                      : "暂停期间麦克风已释放；点击空白处或按空格重新连接"
              : undefined
          }
          onToggleRemainingPlayback={toggleRemainingPlayback}
          playbackState={remainingPlaybackState}
          showKeyboardShortcuts={!isMobileViewport}
          showRemainingPlayback={promptDisplayMode === "staff-page" && answerPitchMode !== "microphone"}
        />
      ) : null}
      <PracticeMicrophoneDebugDialog
        analysis={microphoneCaptureAnalysis}
        configuration={microphoneConfiguration}
        debugMode={practiceMicrophonePreferences.debugMode}
        error={microphoneAlgorithmError}
        frameIntervalMs={microphoneAnalysisIntervalMs}
        isLoadingAlgorithm={isLoadingMicrophoneAlgorithm}
        isOpen={isMicrophoneDebugDialogOpen}
        microphone={practiceMicrophone}
        onClose={() => setIsMicrophoneDebugDialogOpen(false)}
        onRestoreDefaults={restoreMicrophoneDebugDefaults}
        onSelectAlgorithm={selectMicrophoneAlgorithm}
        onUpdateParameters={updateMicrophoneDebugParameters}
        preferences={practiceMicrophonePreferences}
      />
      <PracticeMicrophoneAnalysisDialog
        analysis={microphoneCaptureAnalysis}
        debugMode={practiceMicrophonePreferences.debugMode}
        expandedCandidateSegmentKey={expandedCandidateSegmentKey}
        isOpen={isMicrophoneAnalysisDialogOpen}
        notice={microphoneCaptureNotice}
        onClose={() => setIsMicrophoneAnalysisDialogOpen(false)}
        onExpandedCandidateSegmentKeyChange={setExpandedCandidateSegmentKey}
      />

    </section>
  );
}
