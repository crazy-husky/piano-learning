import { ArrowLeft, Pause, Play, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { playTargetNote } from "../../../audio/piano";
import { resolveDrillNoteNames, resolveQueueStrategy } from "../../../data/db";
import { writeBackupIfSafe } from "../../../data/backup";
import {
  markMidiLatencyStage,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
} from "../../../diagnostics/midiLatencyDiagnostics";
import { markMidiLatencyAfterPaint } from "../../../diagnostics/midiLatencyPaint";
import {
  getTargetMidiNoteNumber,
  normalizeAnswerPitchMode,
  resolveAvailableAnswerPitchMode,
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
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
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
import { B6SwiftF0ReminderDialog } from "../../vocal-pitch/components/B6SwiftF0ReminderDialog";
import type { PracticePagePreferences } from "../../../shared/preferences/practicePagePreferences";
import type { PracticeDistanceMode } from "../../../routing/appRoutes";
import {
  isNaturalPianoKey,
  NATURAL_PIANO_KEYS,
  PianoKeyboard,
} from "../../../shared/components/PianoKeyboard";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffPrompt } from "./StaffPrompt";
import { MOBILE_PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import {
  buildStaffPageView,
  DESKTOP_STAFF_PAGE_NOTE_COUNT,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "../logic/staffPageFlow";
import { PROMPT_NOTE_DURATIONS, type GeneratedStaffPageRhythm } from "../logic/staffPageNotation";
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
import { PracticeSummaryView } from "./PracticeSummaryView";
import { StaffDistancePracticeView } from "./StaffDistancePracticeView";
import {
  PracticeSetupView,
  type PracticeSetupTab,
  type PracticeSetupUiPreferences,
} from "./PracticeSetupView";
import { SongPracticeView } from "../song-practice/SongPracticeView";
import type {
  SongPracticeInputMode,
  SongPracticeSelection,
} from "../song-practice/songPracticeMaterials";
import { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import {
  practiceMicrophoneAlgorithmLabel,
  type PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import {
  ensurePracticeMicrophoneForResume,
  releasePracticeMicrophoneOnPause,
} from "../logic/practiceInputLifecycle";

interface PracticeViewProps {
  midi: MidiInputController;
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
  onOpenSettings: () => void;
  onBeforePracticeStart: () => Promise<PracticeStartPreflightResult>;
  onPracticeDistanceModeChange: (mode: PracticeDistanceMode, replace?: boolean) => void;
  onPracticeTabChange: (tab: PracticeSetupTab) => void;
  onPracticeFinished: () => void;
  onPracticeStageChange: (active: boolean) => void;
  practiceTab: PracticeSetupTab;
  practiceDistanceMode?: PracticeDistanceMode;
  onRunningChange: (running: boolean) => void;
}

export type PracticeNavigationExitTarget =
  "home" | "practice" | "stats" | "settings" | "study" | "vocal";

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
    autoPlayTarget: settings.autoPlayTarget,
    playAnswerNote: settings.playAnswerNote,
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

  const promptNoteDurations = normalizePromptNoteDurations(value.promptNoteDurations, [
    isPromptNoteDuration(value.promptNoteDuration)
      ? value.promptNoteDuration
      : fallback.promptNoteDuration,
  ]);

  return {
    answerPitchMode: normalizeAnswerPitchMode(value.answerPitchMode, fallback.answerPitchMode),
    autoPlayTarget:
      typeof value.autoPlayTarget === "boolean" ? value.autoPlayTarget : fallback.autoPlayTarget,
    playAnswerNote:
      typeof value.playAnswerNote === "boolean" ? value.playAnswerNote : fallback.playAnswerNote,
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
  onOpenSettings,
  onBeforePracticeStart,
  onPracticeDistanceModeChange,
  onPracticeTabChange,
  onPracticeFinished,
  onPracticeStageChange,
  practiceTab,
  onRunningChange,
  practiceDistanceMode,
}: PracticeViewProps): JSX.Element {
  const defaultPracticeSetupUiPreferences = useMemo(
    () => makeDefaultPracticeSetupUiPreferences(settings),
    [settings]
  );
  const [practiceSetupPreferences, setPracticeSetupPreferences] = useLocalStorageState(
    PRACTICE_SETUP_UI_PREFERENCES_KEY,
    defaultPracticeSetupUiPreferences,
    { parse: parsePracticeSetupUiPreferences }
  );
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
    type: "wrong" | "correct";
    noteName?: NoteName;
  } | null>(null);
  const [songPracticeSelection, setSongPracticeSelection] = useState<SongPracticeSelection | null>(
    null
  );
  const midiConnectedRef = useRef(midi.isConnected);
  midiConnectedRef.current = midi.isConnected;
  const [isStaffDistanceRunning, setIsStaffDistanceRunning] = useState(false);
  const [isStaffDistanceStageActive, setIsStaffDistanceStageActive] = useState(false);
  const handleStaffDistanceStageChange = useCallback(
    (active: boolean): void => {
      setIsStaffDistanceStageActive(active);
      onPracticeStageChange(active);
    },
    [onPracticeStageChange]
  );
  const songPracticeMicrophoneAnswerRef = useRef<(answer: PracticeAnswerInput) => void>(() => {});
  const [tick, setTick] = useState(0);
  const [staffPageNotes, setStaffPageNotes] = useState<TargetNote[]>([]);
  const [staffPageRhythm, setStaffPageRhythm] = useState<GeneratedStaffPageRhythm | undefined>();
  const [staffPageIndex, setStaffPageIndex] = useState(0);
  const [staffPageCompletedCount, setStaffPageCompletedCount] = useState(0);
  const [staffPageFirstNoteOffset, setStaffPageFirstNoteOffset] = useState(0);
  const [isStaffPageScrolling, setIsStaffPageScrolling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
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
  const answerPitchMode = runningStartSnapshot
    ? normalizeAnswerPitchMode(runningStartSnapshot.practiceConfig.answerPitchMode)
    : resolveAvailableAnswerPitchMode(practiceSetupPreferences.answerPitchMode, midi.isConnected);
  const mode = runningStartSnapshot?.practiceConfig.mode ?? practiceSetupPreferences.mode;
  const promptDisplayMode =
    runningStartSnapshot?.presentationConfig.promptDisplayMode ??
    practiceSetupPreferences.promptDisplayMode;
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
    practiceSetupPreferences.autoPlayTarget;
  const playAnswerNote =
    runningStartSnapshot?.presentationConfig.playAnswerNote ??
    practiceSetupPreferences.playAnswerNote;
  const queueStrategy =
    runningStartSnapshot?.practiceConfig.queueStrategy ?? practiceSetupPreferences.queueStrategy;
  const drillNoteNames =
    runningStartSnapshot?.practiceConfig.drillNoteNames ?? practiceSetupPreferences.drillNoteNames;
  const pausedPlaybackBpm = staffPageUiPreferences.pausedPlaybackBpm;
  const startPausedReading = staffPageUiPreferences.startPausedReading;
  const effectivePromptNoteDuration =
    runningStartSnapshot?.presentationConfig.promptNoteDuration ?? promptNoteDuration;
  const effectiveAnswerKeyboardScale =
    runningStartSnapshot?.interactionConfig.answerKeyboardScale ?? settings.answerKeyboardScale;
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
  const setAnswerPitchMode = (nextAnswerPitchMode: AnswerPitchMode): void => {
    setPracticeSetupPreferences((current) => ({
      ...current,
      answerPitchMode: nextAnswerPitchMode,
    }));
  };
  const setPromptDisplayMode = (nextPromptDisplayMode: PromptDisplayMode): void => {
    setPracticeSetupPreferences((current) =>
      nextPromptDisplayMode === "single-note" && current.promptNoteDurations.length > 1
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
    if (answerPitchMode !== "microphone" || practiceMicrophonePreferences.algorithm !== "swiftf0") {
      return;
    }
    void preparePracticeMicrophone().catch(() => undefined);
  }, [answerPitchMode, preparePracticeMicrophone, practiceMicrophonePreferences.algorithm]);
  const registerSongPracticeMicrophoneAnswer = useCallback(
    (handler: (answer: PracticeAnswerInput) => void): void => {
      songPracticeMicrophoneAnswerRef.current = handler;
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
    onRunningChange(phase === "running" || isStaffDistanceRunning);
  }, [isStaffDistanceRunning, onRunningChange, phase]);

  useEffect(() => () => onRunningChange(false), [onRunningChange]);

  const applySettingsSnapshot = useCallback(
    (nextSettings: AppSettings): void => {
      setPracticeSetupPreferences(makeDefaultPracticeSetupUiPreferences(nextSettings));
    },
    [setPracticeSetupPreferences]
  );

  const staffNotationMode =
    runningStartSnapshot?.practiceConfig.staffNotationMode ?? settings.staffNotationMode;
  const effectiveEnabledGroupIds =
    runningStartSnapshot?.practiceConfig.enabledGroupIds ?? settings.enabledGroupIds;
  const effectiveEnabledPitchIds =
    runningStartSnapshot?.practiceConfig.enabledPitchIds ?? settings.enabledPitchIds;
  const effectiveCrossGroupPitchIds =
    runningStartSnapshot?.practiceConfig.crossGroupPitchIds ?? settings.crossGroupPitchIds;
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
      mode,
      promptDisplayMode,
      promptNoteDuration,
      promptNoteDurations,
      queueStrategy,
      settings,
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
    },
    [
      answerPitchMode,
      markInterrupted,
      pauseActiveTimers,
      practiceMicrophoneStatus,
      stopPracticeMicrophone,
    ]
  );

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
      void resumePractice();
      return;
    }
    pausePractice("manual-pause");
  }, [pausePractice, resumePractice]);

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
      pausePractice("midi-disconnected");
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
      answerPitchMode,
      defaultMode: mode,
      promptDisplayMode,
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
    (note: TargetNote): void => {
      const now = performance.now();
      const startsPaused = isPausedRef.current;
      promptRef.current = {
        note,
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
        void playTargetNote(note).catch(() => undefined);
      }
    },
    [autoPlayTarget, setCurrentNote]
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
      enabledNotes: coreEnabledNotes,
      promptNoteDurations,
      rangeExtensionNotes,
      fixedCount,
      isMobileViewport,
      mode,
      pageNoteCount: isMobileViewport
        ? MOBILE_STAFF_PAGE_NOTE_COUNT
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
      setStaffPageRhythm,
    },
  });
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
      cancelRemainingPlayback,
      clearStaffPageScrollSchedule,
      onDataChanged,
      onPracticeFinished,
    }),
    [
      cancelRemainingPlayback,
      clearStaffPageScrollSchedule,
      onDataChanged,
      onPracticeFinished,
      practiceMicrophone.stop,
    ]
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
      midi,
      prefersReducedMotion,
      queueNotes,
      schedulerReviews,
      sessions,
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
      setIsPaused,
      setIsStaffPageScrolling,
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
    void completeSession("manual-stop", "manual-stop");
  }, [completeSession]);
  const { pressedAnswerKeys } = usePracticeInput({
    answerPitchMode,
    canStartOnMidi: songPracticeSelection === null && practiceTab === "free",
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
  const showPracticeKeyboard =
    answerPitchMode !== "microphone" && (!isMobileViewport || answerPitchMode === "note-name");
  const isMobileStaffPage = isMobileViewport && promptDisplayMode === "staff-page";
  const mobileStaffPageStartIndex =
    Math.floor(Math.max(0, staffPageIndex) / mobileStaffPageNoteCount) * mobileStaffPageNoteCount;
  const mobileStaffPageNotes = useMemo(
    () =>
      isMobileStaffPage
        ? staffPageNotes.slice(
            mobileStaffPageStartIndex,
            mobileStaffPageStartIndex + mobileStaffPageNoteCount
          )
        : staffPageNotes,
    [isMobileStaffPage, mobileStaffPageNoteCount, mobileStaffPageStartIndex, staffPageNotes]
  );
  const visibleStaffPageRhythm = useMemo(() => {
    if (!staffPageRhythm) return undefined;
    if (!isMobileStaffPage) return staffPageRhythm;
    const start = mobileStaffPageStartIndex;
    const end = start + mobileStaffPageNoteCount;
    return {
      ...staffPageRhythm,
      durations: staffPageRhythm.durations.slice(start, end),
      measures: staffPageRhythm.measures.slice(start, end),
      noteBeamGroups: staffPageRhythm.noteBeamGroups.slice(start, end),
      onsets: staffPageRhythm.onsets.slice(start, end),
    };
  }, [isMobileStaffPage, mobileStaffPageNoteCount, mobileStaffPageStartIndex, staffPageRhythm]);
  const staffPageBarlineAfterNoteIndices = useMemo(() => {
    if (!visibleStaffPageRhythm) return undefined;
    return visibleStaffPageRhythm.measures.flatMap((measure, index) =>
      index < visibleStaffPageRhythm.measures.length - 1 &&
      visibleStaffPageRhythm.measures[index + 1] !== measure
        ? [index]
        : []
    );
  }, [visibleStaffPageRhythm]);
  const staffPageNoteCount = isMobileStaffPage
    ? mobileStaffPageNoteCount
    : DESKTOP_STAFF_PAGE_NOTE_COUNT;
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
        distanceContent={
          <StaffDistancePracticeView
            isActive={practiceTab === "distance"}
            midi={midi}
            microphone={{
              error: practiceMicrophone.error,
              isListening: practiceMicrophone.isListening,
              start: practiceMicrophone.start,
              status: practiceMicrophone.status,
              stop: practiceMicrophone.stop,
            }}
            onMicrophoneAnswerHandlerChange={(handler) => {
              staffDistanceMicrophoneAnswerRef.current = handler;
            }}
            navigationExitRequest={navigationExitRequest}
            onBeforePracticeStart={onBeforePracticeStart}
            onDataChanged={onDataChanged}
            onNavigationExit={onNavigationExit}
            onDistanceModeChange={onPracticeDistanceModeChange}
            onOpenSettings={onOpenSettings}
            onPracticeFinished={onPracticeFinished}
            onPracticeSingleNote={() => {
              onPracticeTabChange("free");
              setPracticeSetupPreferences((current) => ({
                ...current,
                promptDisplayMode: "single-note",
              }));
            }}
            onRunStageChange={handleStaffDistanceStageChange}
            onRunningChange={setIsStaffDistanceRunning}
            onSettingsSaved={onSettingsSaved}
            settings={setupSettings}
            distanceMode={practiceDistanceMode}
          />
        }
        distanceStageActive={isStaffDistanceStageActive}
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
          onPromptNoteDurationsChange: setPromptNoteDurations,
          onQueueStrategyChange: setQueueStrategy,
          onSettingsSaved,
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
        midi={midi}
        preferences={practiceSetupPreferences}
        setupDisabledReason={setupDisabledReason}
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
            aria-label="返回配置"
            className="practice-return-home"
            title="返回配置"
            onClick={() =>
              void completeSession("manual-stop", "manual-stop", { showSummary: false })
            }
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
            title={
              answerPitchMode === "microphone"
                ? isPaused
                  ? "重新连接麦克风并继续 空格"
                  : "暂停 空格"
                : isPaused
                  ? "继续 空格"
                  : "暂停 空格"
            }
            onClick={togglePause}
          >
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? "继续" : "暂停"}
            <kbd>空格</kbd>
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
              ? `正在监听麦克风 · ${practiceMicrophoneAlgorithmLabel(practiceMicrophone.activeAlgorithm)}`
              : practiceMicrophone.status === "requesting"
                ? practiceMicrophone.isPreparingSwiftF0
                  ? "正在准备，请稍等…"
                  : "正在连接麦克风…"
                : (practiceMicrophone.error ??
                  (isPaused ? "已暂停，麦克风已释放" : "麦克风未连接"))}
          </span>
        </div>
      ) : null}

      <div
        className={
          promptDisplayMode === "staff-page" ? "prompt-stage staff-page-stage" : "prompt-stage"
        }
      >
        {promptDisplayMode === "staff-page" ? (
          <div className={isMobileStaffPage ? "staff-page-mobile-view" : "staff-page-desktop-view"}>
            <StaffPagePrompt
              notes={mobileStaffPageNotes}
              barlineAfterNoteIndices={staffPageBarlineAfterNoteIndices}
              beatsPerMeasure={visibleStaffPageRhythm ? 4 : undefined}
              completedCount={
                isMobileStaffPage
                  ? (staffPageView?.completedCount ?? staffPageCompletedCount)
                  : staffPageCompletedCount
              }
              diagnosticSampleId={feedback?.diagnosticSampleId}
              isScrolling={isMobileStaffPage ? false : isStaffPageScrolling}
              layout={isMobileStaffPage ? MOBILE_PRACTICE_PAGE_STAFF_LAYOUT : undefined}
              noteDuration={effectivePromptNoteDuration}
              noteDurations={visibleStaffPageRhythm?.durations}
              noteMeasures={visibleStaffPageRhythm?.measures}
              noteOnsets={visibleStaffPageRhythm?.onsets}
              noteBeamGroups={visibleStaffPageRhythm?.noteBeamGroups}
              monophonicGrandStaff
              scrollDurationMs={staffPageScrollDurationMs}
              staffNotationMode={staffNotationMode}
              useLedgerGap={useLedgerGap}
              distributeNotesEvenly={isMobileStaffPage && !visibleStaffPageRhythm}
              timeSignature={visibleStaffPageRhythm ? "4/4" : undefined}
              notesPerRow={isMobileStaffPage ? MOBILE_STAFF_PAGE_NOTE_COUNT : undefined}
              maxRowCount={isMobileStaffPage ? mobileStaffPageRowCount : undefined}
              minDisplayWidthPx={isMobileStaffPage ? 0 : undefined}
              visibleRowCount={isMobileStaffPage ? mobileStaffPageRowCount : staffPageRowCount}
              wrongIndex={
                feedback?.type === "wrong"
                  ? isMobileStaffPage
                    ? (staffPageView?.noteIndexInPage ?? staffPageIndex)
                    : staffPageIndex
                  : undefined
              }
            />
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
          enabledKeys={
            answerPitchMode === "note-name" ? NATURAL_PIANO_KEYS : new Set<PianoKeyName>()
          }
          feedback={
            feedback?.noteName ? { keyName: feedback.noteName, type: feedback.type } : undefined
          }
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
          onExit={handleInputEscape}
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
          showRemainingPlayback={
            promptDisplayMode === "staff-page" && answerPitchMode !== "microphone"
          }
        />
      ) : null}
    </section>
  );
}
