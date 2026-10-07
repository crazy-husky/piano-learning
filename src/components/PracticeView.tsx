import { BarChart3, CircleHelp, Copy, Download, Pause, Play, RotateCcw, SlidersHorizontal, Square, Volume2, X } from "lucide-react";
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
import { playPianoNote, playTargetNote, setPianoVolume, unlockAudio } from "../audio/piano";
import { db, deletePracticeSessionWithReviews, resolveDrillNoteNames, resolveQueueStrategy, saveReview } from "../data/db";
import { writeBackupIfSafe, writeBackupNow } from "../data/backup";
import { createUuid } from "../domain/id";
import {
  completeMidiLatencySample,
  markMidiLatencyStage,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
  setMidiLatencyCondition,
  type MidiLatencyStage,
} from "../diagnostics/midiLatencyDiagnostics";
import {
  isPracticeAnswerSourceAllowed,
  isPracticeAnswerCorrect,
  normalizeAnswerPitchMode,
  resolveAvailableAnswerPitchMode,
  type PracticeAnswerInput,
} from "../domain/answerInput";
import { createMelodyGenerationState } from "../domain/melody";
import {
  ANSWER_BUTTONS,
  formatTargetNoteLabel,
  getNoteById,
  getNotesForGroups,
  PRACTICE_GROUPS,
} from "../domain/notes";
import { shouldIgnoreReviewForSession, shouldKeepPracticeSession } from "../domain/practiceSession";
import { getEffectivePracticeNotes } from "../domain/practiceComparison";
import {
  buildPracticeSessionRecordV5,
  buildPracticeSessionStartSnapshot,
} from "../domain/practiceSessionStartSnapshot";
import { isCompletedReview } from "../domain/reviews";
import { selectNextNote, selectNotePage } from "../domain/scheduler";
import {
  buildSessionProgressBenchmark,
  buildSessionProgressSeries,
  type SessionProgressMode,
} from "../domain/sessionProgress";
import {
  buildNoteStats,
  filterLongTermReviews,
  formatMs,
  getLongTermStatsEligibility,
  percentile,
} from "../domain/stats";
import type {
  AppSettings,
  AnswerPitchMode,
  FocusLoss,
  InterruptReason,
  NoteName,
  Octave,
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
  WrongAnswer,
} from "../domain/types";
import { MIDI_START_NOTE_NUMBER } from "../midi/midiInput";
import type { MidiInputController } from "../midi/useMidiInput";
import { formatMidiNote } from "../domain/vocalPitch";
import { GlobalRangeControls } from "./GlobalRangeControls";
import { resolveHistoryLimit } from "./HistoryLimitControl";
import { isInteractiveShortcutTarget, shouldHandleGlobalEnter } from "./keyboardShortcuts";
import {
  SessionProgressChart,
  SessionProgressControls,
  SessionProgressLegend,
} from "./SessionProgressChart";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "./sessionProgressPreferences";
import { PauseOverlay } from "./PauseOverlay";
import type { PracticePagePreferences } from "./practicePagePreferences";
import { isNaturalPianoKey, NATURAL_PIANO_KEYS, PianoKeyboard } from "./PianoKeyboard";
import { getPausedKeyboardAction } from "./practiceKeyboard";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffPrompt } from "./StaffPrompt";
import { ResponsiveDataTable, type ResponsiveDataTableColumn } from "./ui/ResponsiveDataTable";
import {
  MOBILE_PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_PAGE_STAFF_LAYOUT,
} from "./staffLayoutProfiles";
import {
  buildMobileStaffPageView,
  getStaffPageRefillCount,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "./staffPageFlow";
import { PROMPT_NOTE_DURATIONS } from "./staffPageNotation";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  normalizePausedPlaybackBpm,
  parseStaffPageUiPreferences,
  STAFF_PAGE_UI_PREFERENCES_KEY,
} from "./staffPageUiPreferences";
import { useLocalStorageState } from "./useLocalStorageState";
import { useDelayedBusy } from "./useDelayedBusy";
import { useRemainingNotePlayback } from "./useRemainingNotePlayback";
import { usePracticeMicrophoneInput } from "../vocal-pitch/usePracticeMicrophoneInput";
import { PRACTICE_NOTE_CONTINUITY_CONFIDENCE } from "../vocal-pitch/practiceNoteRecognizer";
import {
  parseExpectedPracticeNoteSequence,
  type PracticeMicrophoneCandidateSegment,
  type PracticeMicrophoneAnalysisEvent,
  type PracticeMicrophoneAnalysis,
} from "../vocal-pitch/practiceMicrophoneAnalysis";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  PRACTICE_MICROPHONE_ANALYSIS_GAINS,
  PRACTICE_MICROPHONE_FRAME_INTERVALS,
  PRACTICE_MICROPHONE_STABLE_DURATIONS,
  PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS,
  normalizePracticeMicrophoneDebugParameters,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
  resolvePracticeMicrophoneConfiguration,
  resolvePracticeMicrophoneFrameIntervalMs,
  withPracticeMicrophoneAlgorithm,
  type PracticeMicrophoneAlgorithm,
  type PracticeMicrophoneDebugParameters,
  type PracticeMicrophonePreferences,
} from "../vocal-pitch/practiceMicrophonePreferences";
import {
  ensureSwiftF0PracticeRuntimeReady,
  isSwiftF0PracticeRuntimeReady,
  releaseSwiftF0PracticeRuntime,
} from "../vocal-pitch/swiftF0PracticeClient";
import { ensurePracticeMicrophoneForResume, releasePracticeMicrophoneOnPause } from "./practiceInputLifecycle";

interface StableResultDisplayRow {
  event: PracticeMicrophoneAnalysisEvent | null;
  expectedMidiNoteNumber: number;
  isMissing: boolean;
  rowNumber: number | string;
}

const MICROPHONE_CANDIDATE_TABLE_MIN_WIDTH = "1300px";
const MICROPHONE_CANDIDATE_COLUMN_WIDTHS = {
  note: "44px",
  time: "116px",
  status: "76px",
  confidence: "130px",
  inputRms: "120px",
  analysisRms: "160px",
  eligibleFrames: "100px",
  gateReasons: "150px",
  frames: "80px",
} as const;

function buildStableResultDisplayRows(analysis: PracticeMicrophoneAnalysis): StableResultDisplayRow[] {
  if (!analysis.expectedSequence) {
    return analysis.events.map((event, index) => ({
      event,
      expectedMidiNoteNumber: event.midiNoteNumber,
      isMissing: false,
      rowNumber: index + 1,
    }));
  }

  const missedSequenceIndexes = new Set(analysis.missedNotes.map((note) => note.sequenceIndex));
  const expectedEvents = analysis.events.filter((event) => event.expectedMidiNoteNumber !== null);
  const extraEvents = analysis.events.filter((event) => event.expectedMidiNoteNumber === null);
  let expectedEventIndex = 0;
  const expectedRows = analysis.expectedSequence.map((expectedMidiNoteNumber, index) => {
    const isMissing = missedSequenceIndexes.has(index);
    const event = isMissing ? null : expectedEvents[expectedEventIndex++] ?? null;
    return {
      event,
      expectedMidiNoteNumber,
      isMissing: isMissing || event === null,
      rowNumber: index + 1,
    };
  });

  return [
    ...expectedRows,
    ...extraEvents.map((event, index) => ({
      event,
      expectedMidiNoteNumber: event.midiNoteNumber,
      isMissing: false,
      rowNumber: `+${index + 1}`,
    })),
  ];
}

interface CandidateSegmentDisplayInfo {
  durationMs: number;
  failureReasons: string[];
  isDurationBelowThreshold: boolean;
  isFrameCountBelowThreshold: boolean;
  isMissedNote: boolean;
}

function getCandidateSegmentDisplayInfo(
  segment: PracticeMicrophoneCandidateSegment,
  analysis: PracticeMicrophoneAnalysis,
): CandidateSegmentDisplayInfo {
  const durationMs = segment.longestEligibleDurationMs;
  const { confidenceThreshold, inputRmsThreshold, requiredStableFrames, requiredStableMs } = analysis.parameters;
  const isDurationBelowThreshold = durationMs < requiredStableMs;
  const isFrameCountBelowThreshold = segment.maxConsecutiveEligibleFrameCount < requiredStableFrames;
  const ambiguousFrameCount = segment.frames.filter((frame) => frame.ambiguous).length;
  return {
    durationMs,
    failureReasons: [
      ...(segment.lowConfidenceFrameCount > 0
        ? [`置信度低于 ${confidenceThreshold.toFixed(3)}：${segment.lowConfidenceFrameCount} 帧`]
        : []),
      ...(segment.lowRmsFrameCount > 0
        ? [`处理后 RMS 低于 ${inputRmsThreshold.toFixed(6)}：${segment.lowRmsFrameCount} 帧`]
        : []),
      ...(isFrameCountBelowThreshold
        ? [`连续有效帧 ${segment.maxConsecutiveEligibleFrameCount}/${requiredStableFrames} 帧，未达到设置门槛`]
        : []),
      ...(isDurationBelowThreshold
        ? [`连续有效时长 ${durationMs}/${requiredStableMs} ms，未达到设置门槛`]
        : []),
      ...(ambiguousFrameCount > 0
        ? [`存在歧义帧 ${ambiguousFrameCount} 帧，未计入有效帧`]
        : []),
    ],
    isDurationBelowThreshold,
    isFrameCountBelowThreshold,
    isMissedNote: analysis.missedNotes.some((missedNote) =>
      missedNote.midiNoteNumber === segment.midiNoteNumber,
    ),
  };
}

function sortCandidateSegmentsMissedFirst(
  segments: readonly PracticeMicrophoneCandidateSegment[],
  analysis: PracticeMicrophoneAnalysis,
): PracticeMicrophoneCandidateSegment[] {
  return segments
    .map((segment, originalIndex) => ({
      isMissedNote: getCandidateSegmentDisplayInfo(segment, analysis).isMissedNote,
      originalIndex,
      segment,
    }))
    .sort((left, right) => Number(right.isMissedNote) - Number(left.isMissedNote) || left.originalIndex - right.originalIndex)
    .map(({ segment }) => segment);
}

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
  onSettingsSaved: (settings: AppSettings, options?: { feedback?: boolean }) => void | Promise<void>;
  onDataChanged: () => Promise<void>;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onBeforePracticeStart: () => Promise<PracticeStartPreflightResult>;
  onPracticeFinished: () => void;
  onRunningChange: (running: boolean) => void;
}

export type PracticeNavigationExitTarget = "practice" | "stats" | "settings" | "study" | "vocal";

export interface PracticeStartPreflightResult {
  proceed: boolean;
  reviews?: ReviewRecord[];
  settings?: AppSettings;
}

export interface PracticeNavigationExitRequest {
  id: number;
  targetView: PracticeNavigationExitTarget;
}

interface PromptRuntime {
  note: TargetNote;
  startedAt: string;
  activeBaseMs: number;
  activeStartedAt: number | null;
  lastInputAt: number;
  wrongAnswers: WrongAnswer[];
  replayCount: number;
  focusLosses: FocusLoss[];
  interrupted: boolean;
  interruptReason?: InterruptReason;
}

type Phase = "setup" | "running" | "summary";

interface SessionSummary {
  session: PracticeSessionRecord;
  reviews: ReviewRecord[];
}

interface StaffPageRuntime {
  notes: TargetNote[];
  index: number;
  completedCount: number;
}

interface CompleteSessionOptions {
  showSummary?: boolean;
  updateUi?: boolean;
}

interface PracticeSetupUiPreferences {
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

function newSessionId(): string {
  return createUuid();
}

function markMidiLatencyAfterPaint(diagnosticSampleId: number, stage: MidiLatencyStage): () => void {
  let secondFrame: number | undefined;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      markMidiLatencyStage(diagnosticSampleId, stage);
    });
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) {
      window.cancelAnimationFrame(secondFrame);
    }
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function durationSecondsToInputMinutes(seconds: number): string {
  return Number((seconds / 60).toFixed(2)).toString();
}

function inputMinutesToDurationSeconds(value: string): number {
  return Math.max(60, Math.round(Number(value) * 60));
}

const ALL_GROUP_IDS: PracticeGroupId[] = PRACTICE_GROUPS.map((group) => group.id);
const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
const STAFF_PAGE_SCROLL_DURATION_MS = 200;
const MELODY_BUFFER_SIZE = 16;
const PRACTICE_SETUP_UI_PREFERENCES_KEY = "anki-note.practiceSetupUiPreferences";
const PRACTICE_MODES: readonly PracticeMode[] = ["open-ended", "fixed-count", "fixed-duration"];
const PROMPT_DISPLAY_MODES: readonly PromptDisplayMode[] = ["single-note", "staff-page"];

function DebugParameterHelp({ label, description, recommendation }: {
  label: string;
  description: string;
  recommendation: string;
}): JSX.Element {
  return (
    <details className="debug-parameter-help">
      <summary aria-label={`${label}说明和推荐默认值`} title={`${label}说明和推荐默认值`}>
        <CircleHelp aria-hidden="true" size={16} />
      </summary>
      <div className="debug-parameter-help-popover" role="note">
        <strong>{label}</strong>
        <span>{description}</span>
        <span><b>推荐默认值：</b>{recommendation}</span>
      </div>
    </details>
  );
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
const PRACTICE_QUEUE_STRATEGIES: readonly PracticeQueueStrategy[] = ["adaptive", "focused", "melody", "note-drill"];
const PRACTICE_QUEUE_OPTIONS: Array<{ strategy: PracticeQueueStrategy; label: string; description: string }> = [
  {
    strategy: "adaptive",
    label: "自适应队列",
    description: "根据近期识别速度优先练习薄弱音，同时保持全音域复习。",
  },
  {
    strategy: "melody",
    label: "旋律生成",
    description: "在启用组音域内生成级进为主的练习",
  },
  {
    strategy: "note-drill",
    label: "单音强化",
    description: "只抽所选音名；仅选择一个音名时不写入统计",
  },
];

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
  onSettingsSaved,
  onDataChanged,
  onOpenStats,
  onOpenSettings,
  onBeforePracticeStart,
  onPracticeFinished,
  onRunningChange,
}: PracticeViewProps): JSX.Element {
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
  const [phase, setPhase] = useState<Phase>("setup");
  const [session, setSession] = useState<PracticeSessionRecord | null>(null);
  const [currentNote, setCurrentNote] = useState<TargetNote | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [microphoneCaptureAnalysis, setMicrophoneCaptureAnalysis] = useState<PracticeMicrophoneAnalysis | null>(null);
  const [microphoneCaptureNotice, setMicrophoneCaptureNotice] = useState<string | null>(null);
  const [microphoneDebugFeedback, setMicrophoneDebugFeedback] = useState<string | null>(null);
  const [expandedCandidateSegmentKey, setExpandedCandidateSegmentKey] = useState<string | null>(null);
  const [isMicrophoneAnalysisDialogOpen, setIsMicrophoneAnalysisDialogOpen] = useState(false);
  const [isMicrophoneDebugDialogOpen, setIsMicrophoneDebugDialogOpen] = useState(false);
  const [isLoadingMicrophoneAlgorithm, setIsLoadingMicrophoneAlgorithm] = useState(false);
  const [microphoneAlgorithmError, setMicrophoneAlgorithmError] = useState<string | null>(null);
  const microphoneAnalysisDialogRef = useRef<HTMLDialogElement | null>(null);
  const microphoneAnalysisDialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const microphoneDebugDialogRef = useRef<HTMLDialogElement | null>(null);
  const microphoneDebugDialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const [feedback, setFeedback] = useState<{
    diagnosticSampleId?: number;
    type: "wrong" | "correct";
    noteName?: NoteName;
  } | null>(null);
  const [heldComputerAnswerKeys, setHeldComputerAnswerKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const [heldMidiAnswerKeys, setHeldMidiAnswerKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const [tick, setTick] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
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
  const melodyQueueRef = useRef<TargetNote[]>([]);
  const melodyGenerationStateRef = useRef(createMelodyGenerationState());
  const staffPageRef = useRef<StaffPageRuntime | null>(null);
  const staffPageScrollFrameRef = useRef<number | null>(null);
  const staffPageScrollTimeoutRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const sessionActiveBaseMsRef = useRef(0);
  const sessionActiveStartedAtRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const pendingAfterPauseRef = useRef<(() => void) | null>(null);
  const answerInputLockedRef = useRef(false);
  const lastBackupCompletedRef = useRef(0);
  const lastBackupAtRef = useRef<number>(performance.now());
  const handledNavigationExitRequestIdRef = useRef<number | null>(null);
  const microphoneResumeInFlightRef = useRef(false);
  const heldMidiInputsRef = useRef(new Map<string, PianoKeyName>());
  const pendingMidiPressDiagnosticSampleIdRef = useRef<number | undefined>(undefined);
  const startSessionRef = useRef<() => void>(() => undefined);
  const submitAnswerRef = useRef<(answer: PracticeAnswerInput) => void>(() => undefined);
  const practiceMicrophone = usePracticeMicrophoneInput(
    (answer) => submitAnswerRef.current(answer),
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
    setMicrophoneDebugFeedback("设置已保存并生效");
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
    setMicrophoneDebugFeedback("设置已保存并生效");
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
    setMicrophoneDebugFeedback("设置已保存并生效");
  }

  useLayoutEffect(() => {
    const diagnosticSampleId = feedback?.diagnosticSampleId;
    if (diagnosticSampleId === undefined) {
      return undefined;
    }
    markMidiLatencyStage(diagnosticSampleId, "reactCommit");
    return markMidiLatencyAfterPaint(diagnosticSampleId, "paintApprox");
  }, [feedback]);

  useLayoutEffect(() => {
    const diagnosticSampleId = pendingMidiPressDiagnosticSampleIdRef.current;
    pendingMidiPressDiagnosticSampleIdRef.current = undefined;
    if (diagnosticSampleId === undefined) {
      return undefined;
    }
    markMidiLatencyStage(diagnosticSampleId, "pressedReactCommit");
    return markMidiLatencyAfterPaint(diagnosticSampleId, "pressedPaintApprox");
  }, [heldMidiAnswerKeys]);

  const pressedAnswerKeys = useMemo(
    () => new Set<PianoKeyName>([...heldComputerAnswerKeys, ...heldMidiAnswerKeys]),
    [heldComputerAnswerKeys, heldMidiAnswerKeys],
  );

  function blurQueueStrategyAfterPointerClick(input: HTMLInputElement, clickCount: number): void {
    if (clickCount === 0) {
      return;
    }
    window.setTimeout(() => {
      if (document.activeElement === input) {
        input.blur();
      }
    }, 0);
  }

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
    onRunningChange(phase === "running");
    return () => onRunningChange(false);
  }, [onRunningChange, phase]);

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

  const getPromptActiveMs = useCallback((): number => {
    const prompt = promptRef.current;
    if (!prompt) {
      return 0;
    }
    const running = prompt.activeStartedAt === null ? 0 : performance.now() - prompt.activeStartedAt;
    return Math.round(prompt.activeBaseMs + running);
  }, []);

  const getSessionActiveMs = useCallback((): number => {
    const running =
      sessionActiveStartedAtRef.current === null ? 0 : performance.now() - sessionActiveStartedAtRef.current;
    return Math.round(sessionActiveBaseMsRef.current + running);
  }, []);

  const markInterrupted = useCallback((reason: InterruptReason): void => {
    const prompt = promptRef.current;
    if (!prompt || prompt.interrupted) {
      return;
    }
    prompt.interrupted = true;
    prompt.interruptReason = reason;
  }, []);

  const pauseActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt?.activeStartedAt !== null && prompt?.activeStartedAt !== undefined) {
      prompt.activeBaseMs += now - prompt.activeStartedAt;
      prompt.activeStartedAt = null;
    }
    if (sessionActiveStartedAtRef.current !== null) {
      sessionActiveBaseMsRef.current += now - sessionActiveStartedAtRef.current;
      sessionActiveStartedAtRef.current = null;
    }
  }, []);

  const clearStaffPageScrollSchedule = useCallback((): void => {
    if (staffPageScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(staffPageScrollFrameRef.current);
      staffPageScrollFrameRef.current = null;
    }
    if (staffPageScrollTimeoutRef.current !== null) {
      window.clearTimeout(staffPageScrollTimeoutRef.current);
      staffPageScrollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearStaffPageScrollSchedule(), [clearStaffPageScrollSchedule]);

  const resumeActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt && prompt.activeStartedAt === null) {
      const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
      if (lastLoss && !lastLoss.regainedFocusAt) {
        lastLoss.regainedFocusAt = new Date().toISOString();
      }
      prompt.activeStartedAt = now;
      prompt.lastInputAt = now;
    }
    if (sessionActiveStartedAtRef.current === null) {
      sessionActiveStartedAtRef.current = now;
    }
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

  const syncStaffPage = useCallback((page: StaffPageRuntime | null): void => {
    staffPageRef.current = page;
    setStaffPageNotes(page?.notes ?? []);
    setStaffPageIndex(page?.index ?? 0);
    setStaffPageCompletedCount(page?.completedCount ?? 0);
    if (!page) {
      setStaffPageFirstNoteOffset(0);
    }
  }, []);

  const getNextStaffPageCount = useCallback(
    (nextCompletedCount: number): number => {
      if (mode !== "fixed-count") {
        return STAFF_PAGE_SIZE;
      }
      return Math.min(STAFF_PAGE_SIZE, Math.max(0, fixedCount - nextCompletedCount));
    },
    [fixedCount, mode],
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

  const markCurrentStaffPageNoteComplete = useCallback((): void => {
    const page = staffPageRef.current;
    if (!page) {
      return;
    }
    syncStaffPage({
      ...page,
      completedCount: Math.max(page.completedCount, page.index + 1),
    });
  }, [syncStaffPage]);

  const startStaffPageIndex = useCallback(
    (index: number): boolean => {
      const page = staffPageRef.current;
      if (!page || index >= page.notes.length) {
        return false;
      }
      const nextPage = {
        ...page,
        index,
      };
      syncStaffPage(nextPage);
      startPrompt(nextPage.notes[index]);
      return true;
    },
    [startPrompt, syncStaffPage],
  );

  const startStaffPage = useCallback(
    ({
      sourceNotes,
      sourceReviews,
      sourceQueueStrategy,
      sourceDrillNoteNames,
      nextCompletedCount,
    }: {
      sourceNotes: TargetNote[];
      sourceReviews: ReviewRecord[];
      sourceQueueStrategy: PracticeQueueStrategy;
      sourceDrillNoteNames: NoteName[];
      nextCompletedCount: number;
    }): void => {
      const count = getNextStaffPageCount(nextCompletedCount);
      if (count <= 0) {
        return;
      }
      const notes = selectNotePage({
        notes: sourceNotes,
        reviews: sourceReviews,
        sessions,
        currentSessionId: sessionRef.current?.id,
        queueStrategy: sourceQueueStrategy,
        drillNoteNames: sourceDrillNoteNames,
        lastTargetNoteId: lastTargetNoteIdRef.current,
        melodyState: melodyGenerationStateRef.current,
        count,
      });
      const page = {
        notes,
        index: 0,
        completedCount: 0,
      };
      syncStaffPage(page);
      startPrompt(notes[0]);
    },
    [getNextStaffPageCount, sessions, startPrompt, syncStaffPage],
  );

  const startStaffPageScroll = useCallback(
    (nextCompletedCount: number, nextIndex: number): boolean => {
      const page = staffPageRef.current;
      if (!page) {
        return false;
      }

      const remainingVisibleNotes = page.notes.slice(nextIndex);
      const nextRowCount = getStaffPageRefillCount({
        completedSessionCount: nextCompletedCount,
        fixedSessionCount: mode === "fixed-count" ? fixedCount : undefined,
        nextIndex,
        plannedNoteCount: page.notes.length,
      });
      if (nextRowCount === 0) {
        return false;
      }

      const nextRow = selectNotePage({
        notes: enabledNotes,
        reviews: [...schedulerReviews, ...sessionReviewsRef.current],
        sessions,
        currentSessionId: sessionRef.current?.id,
        queueStrategy,
        drillNoteNames,
        lastTargetNoteId: page.notes[page.notes.length - 1]?.id,
        plannedTargetNoteIds: remainingVisibleNotes.map((note) => note.id),
        melodyState: melodyGenerationStateRef.current,
        count: nextRowCount,
      });
      const sessionId = sessionRef.current?.id;
      syncStaffPage({
        ...page,
        index: nextIndex,
        notes: [...page.notes, ...nextRow],
      });
      const finishScroll = (): void => {
        staffPageScrollTimeoutRef.current = null;
        if (!sessionId || sessionRef.current?.id !== sessionId || sessionRef.current.endedAt) {
          return;
        }
        const scrolledPage = staffPageRef.current;
        if (!scrolledPage || scrolledPage.notes.length <= STAFF_PAGE_SIZE) {
          setIsStaffPageScrolling(false);
          return;
        }
        const rebasedPage = {
          notes: scrolledPage.notes.slice(PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow),
          index: scrolledPage.index - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          completedCount:
            scrolledPage.completedCount - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
        };
        setStaffPageFirstNoteOffset((offset) => offset + PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow);
        syncStaffPage(rebasedPage);
        setIsStaffPageScrolling(false);
        const startNextPrompt = (): void => {
          resumeActiveTimers();
          startPrompt(rebasedPage.notes[rebasedPage.index]);
        };
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = startNextPrompt;
          return;
        }
        startNextPrompt();
      };
      clearStaffPageScrollSchedule();
      staffPageScrollFrameRef.current = window.requestAnimationFrame(() => {
        staffPageScrollFrameRef.current = null;
        setIsStaffPageScrolling(true);
        staffPageScrollTimeoutRef.current = window.setTimeout(finishScroll, staffPageScrollDurationMs);
      });
      return true;
    },
    [
      clearStaffPageScrollSchedule,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      mode,
      queueStrategy,
      resumeActiveTimers,
      schedulerReviews,
      sessions,
      staffPageScrollDurationMs,
      startPrompt,
      syncStaffPage,
    ],
  );

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
      const nextReviews = [...schedulerReviews, ...sessionReviewsRef.current];
      const remainingCount = mode === "fixed-count" ? fixedCount - nextCompletedCount : undefined;
      const note =
        queueStrategy === "melody"
          ? drawMelodyNote(enabledNotes, remainingCount)
          : selectNextNote({
              notes: enabledNotes,
              reviews: nextReviews,
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

  const finishCurrentReview = useCallback(
    async (answeredCorrectly: boolean, interruptReason?: InterruptReason): Promise<ReviewRecord | null> => {
      const prompt = promptRef.current;
      const activeMs = getPromptActiveMs();
      if (!prompt || !sessionRef.current) {
        return null;
      }
      if (!answeredCorrectly) {
        prompt.interrupted = true;
        prompt.interruptReason = interruptReason ?? prompt.interruptReason ?? "manual-stop";
      }
      pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const ignored = shouldIgnoreReviewForSession(sessionRef.current);
      const review: ReviewRecord = {
        id: createUuid(),
        schemaVersion: 1,
        sessionId: sessionRef.current.id,
        targetNoteId: prompt.note.id,
        groupId: prompt.note.groupId,
        noteName: prompt.note.noteName,
        octave: prompt.note.octave,
        startedAt: prompt.startedAt,
        endedAt,
        answeredAt: answeredCorrectly ? endedAt : undefined,
        answeredCorrectly,
        interrupted: prompt.interrupted,
        interruptReason: prompt.interruptReason,
        activeMs,
        wrongAnswers: prompt.wrongAnswers,
        replayCount: prompt.replayCount,
        focusLosses: prompt.focusLosses,
        ignored,
      };
      promptRef.current = null;
      lastTargetNoteIdRef.current = prompt.note.id;
      if (!ignored) {
        await saveReview(review);
      }
      sessionReviewsRef.current = [...sessionReviewsRef.current, review];
      return review;
    },
    [getPromptActiveMs, pauseActiveTimers],
  );

  const completeSession = useCallback(
    async (
      endReason: PracticeSessionRecord["endReason"],
      unfinishedReason?: InterruptReason,
      options: CompleteSessionOptions = {},
    ): Promise<void> => {
      if (endingRef.current || !sessionRef.current) {
        return;
      }
      const showSummary = options.showSummary ?? true;
      const updateUi = options.updateUi ?? true;
      endingRef.current = true;
      practiceMicrophone.stop();
      cancelRemainingPlayback();
      clearStaffPageScrollSchedule();
      const unfinishedReview = promptRef.current ? await finishCurrentReview(false, unfinishedReason) : null;
      pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const finalReviews = unfinishedReview
        ? sessionReviewsRef.current
        : [...sessionReviewsRef.current];
      const finalSession: PracticeSessionRecord = {
        ...sessionRef.current,
        activePracticeMs: getSessionActiveMs(),
        endedAt,
        endReason,
        completedCount: finalReviews.filter(isCompletedReview).length,
        interruptedCount: finalReviews.filter((review) => review.interrupted).length,
      };
      const shouldKeepSession = shouldKeepPracticeSession(finalSession, finalReviews);
      if (shouldKeepSession) {
        await db.practiceSessions.put(finalSession);
        sessionRef.current = finalSession;
        if (updateUi) {
          setSession(finalSession);
          setSummary(showSummary ? { session: finalSession, reviews: finalReviews } : null);
        }
      } else {
        await deletePracticeSessionWithReviews(finalSession.id, finalReviews);
        sessionRef.current = null;
        if (updateUi) {
          setSession(null);
          setSummary(null);
        }
      }
      if (updateUi) {
        setCurrentNote(null);
        syncStaffPage(null);
        setIsStaffPageScrolling(false);
      } else {
        staffPageRef.current = null;
      }
      isPausedRef.current = false;
      pendingAfterPauseRef.current = null;
      if (updateUi) {
        setIsPaused(false);
        setPhase(showSummary && shouldKeepSession ? "summary" : "setup");
      }
      if (shouldKeepSession) {
        await writeBackupNow().catch(() => undefined);
      }
      await onDataChanged();
      if (shouldKeepSession && updateUi) {
        onPracticeFinished();
      }
      endingRef.current = false;
    },
    [
      cancelRemainingPlayback,
      clearStaffPageScrollSchedule,
      finishCurrentReview,
      getSessionActiveMs,
      onDataChanged,
      onPracticeFinished,
      pauseActiveTimers,
      practiceMicrophone.stop,
      syncStaffPage,
    ],
  );

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

  const startSession = useCallback(async (): Promise<void> => {
    if (queueNotes.length === 0 || (answerPitchMode === "exact-pitch" && !midi.isConnected)) {
      return;
    }
    let microphoneStarted = false;
    let sessionStarted = false;
    try {
      await runSessionStart(async () => {
        void unlockAudio().catch(() => undefined);
        const preflightResult = await onBeforePracticeStart();
        if (!preflightResult.proceed) {
          return;
        }
        if (preflightResult.settings) {
          applySettingsSnapshot(preflightResult.settings);
        }
        const loadedPreflightSettings = preflightResult.settings ?? (await persistConfig());
        const preflightSettings = answerPitchMode === "microphone" &&
            loadedPreflightSettings.answerPitchMode !== "microphone"
          ? { ...loadedPreflightSettings, answerPitchMode: "microphone" as const }
          : loadedPreflightSettings;
        const availablePreflightAnswerPitchMode = resolveAvailableAnswerPitchMode(
          preflightSettings.answerPitchMode,
          midi.isConnected,
        );
        const nextSettings = preflightSettings.answerPitchMode === availablePreflightAnswerPitchMode
          ? preflightSettings
          : { ...preflightSettings, answerPitchMode: availablePreflightAnswerPitchMode };
        if (nextSettings !== preflightSettings) {
          await onSettingsSaved(nextSettings, { feedback: false });
        }
        const nextMode = nextSettings.defaultMode;
        const nextQueueStrategy = resolveQueueStrategy(nextSettings);
        const nextSchedulerReviews = preflightResult.reviews
          ? filterLongTermReviews(preflightResult.reviews)
          : schedulerReviews;
        const microphoneSettings = availablePreflightAnswerPitchMode === "microphone"
          ? { ...nextSettings, playAnswerNote: false }
          : nextSettings;
        const builtStartSnapshot = buildPracticeSessionStartSnapshot({
          autoPlayTarget:
            availablePreflightAnswerPitchMode === "microphone" ? false : nextSettings.autoPlayTarget,
          mode: nextMode,
          prefersReducedMotion,
          settings: { ...microphoneSettings, queueStrategy: nextQueueStrategy },
          smoothStaffPageScroll: staffPageUiPreferences.smoothStaffPageScroll,
          startPausedReading,
        });
        if (!builtStartSnapshot) {
          return;
        }
        const { snapshot: startSnapshot } = builtStartSnapshot;
        const { practiceConfig, presentationConfig } = startSnapshot;
        const nextEnabledNotes = builtStartSnapshot.notes;
        const shouldStartPaused =
          presentationConfig.promptDisplayMode === "staff-page" && presentationConfig.startPausedReading;
        if (availablePreflightAnswerPitchMode === "microphone") {
          if (shouldStartPaused) {
            practiceMicrophone.stop();
          } else {
            microphoneStarted = await practiceMicrophone.start();
            if (!microphoneStarted) {
              return;
            }
          }
        }
        setPianoVolume(startSnapshot.interactionConfig.pianoVolume);
        const startedAt = new Date().toISOString();
        const nextSession: PracticeSessionRecord = buildPracticeSessionRecordV5({
          id: newSessionId(),
          snapshot: startSnapshot,
          startedAt,
        });
        await db.practiceSessions.put(nextSession);
        practiceMicrophone.resetCapture();
        setMicrophoneCaptureAnalysis(null);
        setMicrophoneCaptureNotice(null);
        setExpandedCandidateSegmentKey(null);
        setIsMicrophoneAnalysisDialogOpen(false);
        sessionRef.current = nextSession;
        sessionStartSnapshotRef.current = startSnapshot;
        sessionReviewsRef.current = [];
        lastTargetNoteIdRef.current = undefined;
        melodyQueueRef.current = [];
        melodyGenerationStateRef.current = createMelodyGenerationState();
        syncStaffPage(null);
        setIsStaffPageScrolling(false);
        endingRef.current = false;
        lastBackupAtRef.current = performance.now();
        lastBackupCompletedRef.current = 0;
        sessionActiveBaseMsRef.current = 0;
        sessionActiveStartedAtRef.current = shouldStartPaused ? null : performance.now();
        isPausedRef.current = shouldStartPaused;
        pendingAfterPauseRef.current = null;
        setSession(nextSession);
        setCompletedCount(0);
        setWrongAnswerCount(0);
        setSummary(null);
        setIsPaused(shouldStartPaused);
        setPhase("running");
        sessionStarted = true;
        if (presentationConfig.promptDisplayMode === "staff-page") {
          startStaffPage({
            sourceNotes: nextEnabledNotes,
            sourceReviews: nextSchedulerReviews,
            sourceQueueStrategy: practiceConfig.queueStrategy,
            sourceDrillNoteNames: practiceConfig.drillNoteNames,
            nextCompletedCount: 0,
          });
        } else {
          const firstNote =
            practiceConfig.queueStrategy === "melody"
              ? drawMelodyNote(nextEnabledNotes, practiceConfig.fixedCount)
              : selectNextNote({
                  notes: nextEnabledNotes,
                  reviews: nextSchedulerReviews,
                  sessions,
                  currentSessionId: nextSession.id,
                  queueStrategy: practiceConfig.queueStrategy,
                  drillNoteNames: practiceConfig.drillNoteNames,
                });
          startPrompt(firstNote);
        }
      });
    } finally {
      if (microphoneStarted && !sessionStarted) {
        practiceMicrophone.stop();
      }
    }
  }, [
    answerPitchMode,
    applySettingsSnapshot,
    drawMelodyNote,
    midi.isConnected,
    practiceMicrophone.start,
    practiceMicrophone.resetCapture,
    practiceMicrophone.stop,
    onBeforePracticeStart,
    onSettingsSaved,
    persistConfig,
    queueNotes.length,
    runSessionStart,
    prefersReducedMotion,
    schedulerReviews,
    sessions,
    startPausedReading,
    staffPageUiPreferences.smoothStaffPageScroll,
    staffNotationMode,
    startPrompt,
    startStaffPage,
    syncStaffPage,
  ]);
  startSessionRef.current = () => void startSession();

  const replayTarget = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt || isPausedRef.current || answerPitchMode === "microphone") {
      return;
    }
    prompt.lastInputAt = performance.now();
    prompt.replayCount += 1;
    await playTargetNote(prompt.note).catch(() => undefined);
  }, [answerPitchMode]);

  const submitAnswer = useCallback(
    async (answer: PracticeAnswerInput): Promise<void> => {
      if (!isPracticeAnswerSourceAllowed(answer, answerPitchMode)) {
        return;
      }
      const prompt = promptRef.current;
      if (!prompt || isPausedRef.current || answerInputLockedRef.current) {
        return;
      }
      const diagnosticSampleId = answer.diagnosticSampleId;
      const correctDelayMs = sessionStartSnapshotRef.current?.interactionConfig.correctDelayMs ?? settings.correctDelayMs;
      markMidiLatencyStage(diagnosticSampleId, "submitStarted");
      if (MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
        setMidiLatencyCondition(diagnosticSampleId, {
          answerPitchMode,
          correctDelayMs,
          playAnswerNote,
          promptDisplayMode,
        });
      }
      prompt.lastInputAt = performance.now();
      if (playAnswerNote) {
        const answerOctave = answer.octave;
        if (answerOctave === undefined || (answerOctave >= 1 && answerOctave <= 6)) {
          const playbackOctave = answerOctave === undefined ? prompt.note.octave : answerOctave as Octave;
          markMidiLatencyStage(diagnosticSampleId, "audioRequested");
          void playPianoNote(answer.noteName, playbackOctave).then(
            () => markMidiLatencyStage(diagnosticSampleId, "audioReady"),
            () => markMidiLatencyStage(diagnosticSampleId, "audioReady"),
          );
        }
      }
      const answeredCorrectly = isPracticeAnswerCorrect(answer, prompt.note, answerPitchMode);
      markMidiLatencyStage(diagnosticSampleId, "verdict");
      if (!answeredCorrectly) {
        completeMidiLatencySample(diagnosticSampleId, "wrong");
        prompt.wrongAnswers.push({
          noteName: answer.noteName,
          atActiveMs: getPromptActiveMs(),
          midiNoteNumber: answer.midiNoteNumber,
        });
        setWrongAnswerCount((count) => count + 1);
        markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
        setFeedback({ diagnosticSampleId, type: "wrong", noteName: answer.noteName });
        window.setTimeout(() => setFeedback((current) => (current?.type === "wrong" ? null : current)), 450);
        return;
      }

      answerInputLockedRef.current = true;
      completeMidiLatencySample(diagnosticSampleId, "correct");
      markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
      setFeedback({ diagnosticSampleId, type: "correct", noteName: answer.noteName });
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeStarted");
      const review = await finishCurrentReview(true);
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeEnded");
      if (!review) {
        return;
      }
      const nextCompletedCount = completedCount + 1;
      setCompletedCount(nextCompletedCount);
      if (promptDisplayMode === "staff-page") {
        markCurrentStaffPageNoteComplete();
      }
      await maybeBackupDuringOpenEnded(nextCompletedCount);
      const reviewSessionId = review.sessionId;

      const continueAfterCorrectDelay = (): void => {
        if (sessionRef.current?.id !== reviewSessionId || sessionRef.current.endedAt) {
          return;
        }
        if (mode === "fixed-count" && nextCompletedCount >= fixedCount) {
          void completeSession("completed-count");
          return;
        }
        if (promptDisplayMode === "staff-page") {
          const page = staffPageRef.current;
          const nextIndex = page ? page.index + 1 : 0;
          if (page && startStaffPageScroll(nextCompletedCount, nextIndex)) {
            return;
          }
          resumeActiveTimers();
          if (page && startStaffPageIndex(nextIndex)) {
            return;
          }
          startStaffPage({
            sourceNotes: enabledNotes,
            sourceReviews: [...schedulerReviews, ...sessionReviewsRef.current],
            sourceQueueStrategy: queueStrategy,
            sourceDrillNoteNames: drillNoteNames,
            nextCompletedCount,
          });
          return;
        }
        resumeActiveTimers();
        selectAndStartNext(nextCompletedCount);
      };

      window.setTimeout(() => {
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = continueAfterCorrectDelay;
          return;
        }
        continueAfterCorrectDelay();
      }, correctDelayMs);
    },
    [
      answerPitchMode,
      completeSession,
      completedCount,
      drillNoteNames,
      enabledNotes,
      finishCurrentReview,
      fixedCount,
      getPromptActiveMs,
      markCurrentStaffPageNoteComplete,
      maybeBackupDuringOpenEnded,
      mode,
      playAnswerNote,
      promptDisplayMode,
      queueStrategy,
      resumeActiveTimers,
      schedulerReviews,
      selectAndStartNext,
      settings.correctDelayMs,
      startStaffPage,
      startStaffPageScroll,
      startStaffPageIndex,
    ],
  );
  submitAnswerRef.current = (answer) => void submitAnswer(answer);

  useEffect(() => {
    function syncHeldMidiKeys(): void {
      setHeldMidiAnswerKeys(new Set(heldMidiInputsRef.current.values()));
    }

    const unsubscribe = midi.subscribe((event) => {
      if (event.type === "reset") {
        pendingMidiPressDiagnosticSampleIdRef.current = undefined;
        heldMidiInputsRef.current.clear();
        syncHeldMidiKeys();
        return;
      }
      if (!isNaturalPianoKey(event.note.keyName)) {
        return;
      }
      if (event.type === "release") {
        pendingMidiPressDiagnosticSampleIdRef.current = undefined;
        heldMidiInputsRef.current.delete(event.note.keyId);
        syncHeldMidiKeys();
        return;
      }
      heldMidiInputsRef.current.set(event.note.keyId, event.note.keyName);
      pendingMidiPressDiagnosticSampleIdRef.current = event.note.diagnosticSampleId;
      syncHeldMidiKeys();
      if (phase === "running" && answerPitchMode !== "microphone") {
        markMidiLatencyStage(event.note.diagnosticSampleId, "practiceSubscriber");
        submitAnswerRef.current({
          diagnosticSampleId: event.note.diagnosticSampleId,
          midiNoteNumber: event.note.midiNoteNumber,
          noteName: event.note.keyName,
          octave: event.note.octave,
          source: "midi",
        });
        return;
      }
      if (event.note.midiNoteNumber === MIDI_START_NOTE_NUMBER && answerPitchMode !== "microphone") {
        startSessionRef.current();
      }
    });
    return () => {
      unsubscribe();
      pendingMidiPressDiagnosticSampleIdRef.current = undefined;
      heldMidiInputsRef.current.clear();
      setHeldMidiAnswerKeys(new Set());
    };
  }, [answerPitchMode, midi.subscribe, phase]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) {
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        if (isMicrophoneDebugDialogOpen) {
          setIsMicrophoneDebugDialogOpen(false);
          return;
        }
        if (isMicrophoneAnalysisDialogOpen) {
          setIsMicrophoneAnalysisDialogOpen(false);
          return;
        }
        void completeSession("manual-stop", "manual-stop");
        return;
      }
      if (event.code === "Space") {
        if (isInteractiveShortcutTarget(event.target)) {
          return;
        }
        event.preventDefault();
        if (isPausedRef.current) {
          void resumePractice();
        } else {
          togglePause();
        }
        return;
      }
      if (isPausedRef.current) {
        const pausedAction = getPausedKeyboardAction({
          isEditableTarget:
            event.target instanceof Element &&
            Boolean(event.target.closest("input, select, textarea, [contenteditable='true']")),
        });
        if (pausedAction === "allow-edit") {
          return;
        }
        event.preventDefault();
        return;
      }
      const answer = ANSWER_BUTTONS.find((button) => event.key === button.key);
      if (answer && answerPitchMode === "note-name") {
        event.preventDefault();
        setHeldComputerAnswerKeys((current) => new Set(current).add(answer.noteName));
        void submitAnswer({ noteName: answer.noteName, source: "computer-keyboard" });
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      const answer = ANSWER_BUTTONS.find((button) => event.key === button.key);
      if (!answer) {
        return;
      }
      setHeldComputerAnswerKeys((current) => {
        const next = new Set(current);
        next.delete(answer.noteName);
        return next;
      });
    }

    function releaseHeldComputerKeys(): void {
      setHeldComputerAnswerKeys(new Set());
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseHeldComputerKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseHeldComputerKeys);
      releaseHeldComputerKeys();
    };
  }, [answerPitchMode, completeSession, isMicrophoneAnalysisDialogOpen, isMicrophoneDebugDialogOpen, phase, resumePractice, submitAnswer, togglePause]);

  useLayoutEffect(() => {
    if (!isMicrophoneAnalysisDialogOpen) {
      return;
    }
    const dialog = microphoneAnalysisDialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    microphoneAnalysisDialogCloseRef.current?.focus();
    const outerScroller = dialog.querySelector<HTMLElement>(".practice-microphone-analysis-dialog-body");
    const tableRegions = Array.from(dialog.querySelectorAll<HTMLElement>(".practice-microphone-analysis-table-scroll"));
    const onTableWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || (!event.deltaX && !event.deltaY) || !outerScroller) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? outerScroller.clientHeight : 1;
      const deltaX = event.deltaX * multiplier;
      const deltaY = event.deltaY * multiplier;
      const previousLeft = event.currentTarget instanceof HTMLElement ? event.currentTarget.scrollLeft : 0;
      const previousTop = outerScroller.scrollTop;
      if (event.currentTarget instanceof HTMLElement && deltaX) {
        const region = event.currentTarget;
        region.scrollLeft = Math.max(0, Math.min(region.scrollWidth - region.clientWidth, region.scrollLeft + deltaX));
      }
      if (deltaY) {
        outerScroller.scrollTop = Math.max(
          0,
          Math.min(outerScroller.scrollHeight - outerScroller.clientHeight, outerScroller.scrollTop + deltaY),
        );
      }
      const currentLeft = event.currentTarget instanceof HTMLElement ? event.currentTarget.scrollLeft : previousLeft;
      if (currentLeft !== previousLeft || outerScroller.scrollTop !== previousTop) event.preventDefault();
    };
    const onTableKeyDown = (event: KeyboardEvent): void => {
      if (!outerScroller) return;
      const step = Math.max(40, Math.round(outerScroller.clientHeight * 0.8));
      const delta = event.key === "ArrowDown" ? 40
        : event.key === "ArrowUp" ? -40
          : event.key === "PageDown" ? step
            : event.key === "PageUp" ? -step
              : event.key === "Home" ? -outerScroller.scrollTop
                : event.key === "End" ? outerScroller.scrollHeight
                  : 0;
      if (!delta) return;
      const previousTop = outerScroller.scrollTop;
      outerScroller.scrollTop = event.key === "End"
        ? outerScroller.scrollHeight
        : Math.max(0, Math.min(outerScroller.scrollHeight - outerScroller.clientHeight, previousTop + delta));
      if (outerScroller.scrollTop !== previousTop) event.preventDefault();
    };
    for (const region of tableRegions) {
      region.addEventListener("wheel", onTableWheel, { passive: false });
      region.addEventListener("keydown", onTableKeyDown);
    }
    return () => {
      for (const region of tableRegions) {
        region.removeEventListener("wheel", onTableWheel);
        region.removeEventListener("keydown", onTableKeyDown);
      }
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isMicrophoneAnalysisDialogOpen]);

  useLayoutEffect(() => {
    if (!isMicrophoneDebugDialogOpen) {
      return;
    }
    const dialog = microphoneDebugDialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    microphoneDebugDialogCloseRef.current?.focus();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isMicrophoneDebugDialogOpen]);

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
        const inactiveMs = performance.now() - prompt.lastInputAt;
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
    if (phase === "running") {
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
  }, [phase, setupDisabled, startSession]);

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
  const sessionQualifiedTimes = (summary?.reviews ?? [])
    .filter(isCompletedReview)
    .map((review) => review.activeMs);
  const summaryStatsEligibility = summary ? getLongTermStatsEligibility(summary.reviews) : undefined;
  const summaryHasTooManyErrors =
    summaryStatsEligibility?.reason === "too-many-heavy-error-reviews" ||
    summaryStatsEligibility?.reason === "too-many-error-reviews";
  const weakestNotes = summary
    ? buildNoteStats(summary.reviews)
        .filter((stat) => stat.reviewCount > 0)
        .sort((a, b) => b.weaknessScore - a.weaknessScore)
        .slice(0, 4)
    : [];
  const summaryProgressSeries = useMemo(
    () =>
      summary
        ? buildSessionProgressSeries({
            currentSession: summary.session,
            currentReviews: summary.reviews,
            sessions,
            reviews,
            historyLimit: summaryEffectiveHistoryLimit,
            mode: summaryProgressMode,
          })
        : [],
    [reviews, sessions, summary, summaryEffectiveHistoryLimit, summaryProgressMode],
  );
  const summaryAllHistoryCount = summaryProgressSeries.filter((series) => !series.isCurrent).length;
  const summaryProgressBenchmark = useMemo(
    () =>
      summary
        ? buildSessionProgressBenchmark({
            currentSession: summary.session,
            currentReviews: summary.reviews,
            sessions,
            reviews,
          })
        : undefined,
    [reviews, sessions, summary],
  );

  if (phase === "setup") {
    return (
      <section className="practice-shell practice-setup-shell">
        <GlobalRangeControls settings={setupSettings} onSettingsSaved={onSettingsSaved} />
        <div className="setup-grid">
          <div className="panel setup-panel">
            <div className="panel-heading">
              <h1>单音识谱</h1>
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
                    onChange={(event) =>
                      setStaffPageUiPreferences((current) => ({
                        ...current,
                        startPausedReading: event.target.checked,
                      }))
                    }
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
              {answerPitchMode === "microphone" && practiceMicrophone.error ? (
                <span className="practice-microphone-error" role="status">{practiceMicrophone.error}</span>
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

  if (phase === "summary" && summary) {
    return (
      <section className="practice-shell">
        <div className="panel summary-panel">
          <div className="panel-heading summary-result-heading">
            <h1>本次结果</h1>
            <p>{summary.session.endReason === "manual-stop" ? "手动结束" : "已完成"}</p>
            {summaryHasTooManyErrors ? (
              <p className="summary-quality-warning">
                错音有点多{'>_<'} 这次先不算~ <br />或许从更少的音区开始练习，或者先去学习页学习/默写一下吧~
              </p>
            ) : null}
          </div>
          <div className="metric-grid">
            <div className="metric">
              <span>答对</span>
              <strong>{summary.reviews.filter(isCompletedReview).length}</strong>
            </div>
            <div className="metric">
              <span>错误</span>
              <strong>{summary.reviews.reduce((sum, review) => sum + review.wrongAnswers.length, 0)}</strong>
            </div>
            <div className="metric">
              <span>中位时长</span>
              <strong>{formatMs(percentile(sessionQualifiedTimes, 0.5))}</strong>
            </div>
            <div className="metric">
              <span>P90</span>
              <strong>{formatMs(percentile(sessionQualifiedTimes, 0.9))}</strong>
            </div>
          </div>
          <section className="summary-section">
            <div className="summary-section-heading">
              <h2>薄弱音</h2>
            </div>
            <div className="note-list">
              <div className="note-row note-row-header">
                <span>目标音</span>
                <span>中位时长</span>
                <span>错音率</span>
                <span>常错音</span>
              </div>
              {weakestNotes.map((note) => (
                <div className="note-row" key={note.targetNoteId}>
                  <span>{formatTargetNoteLabel(getNoteById(note.targetNoteId))}</span>
                  <span>{formatMs(note.medianMs)}</span>
                  <span>{Math.round(note.errorRate * 100)}%</span>
                  <span>{note.commonConfusion ?? "无"}</span>
                </div>
              ))}
            </div>
          </section>
          {!summaryHasTooManyErrors && summaryProgressSeries.length > 0 ? (
            <section className="summary-section">
              <div className="summary-section-heading session-progress-heading">
                <h2>答对进度</h2>
                <SessionProgressControls
                  allHistory={summaryAllHistory}
                  allHistoryCount={summaryAllHistoryCount}
                  benchmark={summaryProgressBenchmark}
                  historyLimit={summaryHistoryLimit}
                  mode={summaryProgressMode}
                  onAllHistoryChange={setSummaryAllHistory}
                  onHistoryLimitChange={setSummaryHistoryLimit}
                  onModeChange={setSummaryProgressMode}
                />
              </div>
              <SessionProgressChart series={summaryProgressSeries} />
              <SessionProgressLegend series={summaryProgressSeries} />
            </section>
          ) : null}
          <div className="action-row">
            <button
              aria-keyshortcuts="Enter"
              className="primary"
              disabled={showStartingSessionStatus}
              onClick={() => void startSession()}
            >
              {showStartingSessionStatus ? (
                "检查中"
              ) : (
                <>
                  <RotateCcw size={18} />
                  再来一次<kbd>Enter</kbd>{midi.isConnected ? <kbd>C4</kbd> : null}
                </>
              )}
            </button>
            <button onClick={() => setPhase("setup")}>
              <SlidersHorizontal size={18} />
              调整设置
            </button>
            <button onClick={onOpenStats}>
              <BarChart3 size={18} />
              查看统计
            </button>
          </div>
        </div>
      </section>
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
                    setExpandedCandidateSegmentKey(null);
                    setMicrophoneCaptureNotice(stopped.error || stopped.finalFrameIssue
                      ? `采样已保留；${stopped.error ?? stopped.finalFrameIssue}。以下分析基于已采集的数据。`
                      : null);
                    setMicrophoneCaptureAnalysis(analysis);
                    setIsMicrophoneAnalysisDialogOpen(true);
                  })();
                } else {
                  setMicrophoneCaptureAnalysis(null);
                  setMicrophoneCaptureNotice(null);
                  setExpandedCandidateSegmentKey(null);
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
                  setExpandedCandidateSegmentKey(null);
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
      {isMicrophoneDebugDialogOpen && practiceMicrophonePreferences.debugMode ? (
        <dialog
          aria-labelledby="practice-microphone-debug-title"
          className="practice-microphone-debug-dialog"
          onClickCapture={(event) => {
            const clickTarget = event.target;
            if (!(clickTarget instanceof Element)) return;
            const clickedHelp = clickTarget.closest(".debug-parameter-help");
            microphoneDebugDialogRef.current
              ?.querySelectorAll<HTMLDetailsElement>("details.debug-parameter-help[open]")
              .forEach((openHelp) => {
                if (openHelp !== clickedHelp && !openHelp.contains(clickTarget)) {
                  openHelp.open = false;
                }
              });
          }}
          onCancel={(event) => {
            event.preventDefault();
            setIsMicrophoneDebugDialogOpen(false);
          }}
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              setIsMicrophoneDebugDialogOpen(false);
            }
          }}
          ref={microphoneDebugDialogRef}
        >
          <div className="practice-microphone-analysis-dialog-header">
            <div>
              <h2 id="practice-microphone-debug-title">麦克风调试</h2>
              {microphoneDebugFeedback ? (
                <div aria-live="polite" className="practice-microphone-feedback-banner is-success" role="status">
                  {microphoneDebugFeedback}
                </div>
              ) : null}
            </div>
            <button
              aria-label="关闭麦克风调试"
              className="practice-microphone-analysis-dialog-close"
              onClick={() => setIsMicrophoneDebugDialogOpen(false)}
              ref={microphoneDebugDialogCloseRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="practice-microphone-debug-dialog-body">
            <fieldset
              className="practice-microphone-debug-fields"
                disabled={practiceMicrophone.captureRecording}
            >
              <legend>详细参数（调试专用）</legend>
              <label>
                <span className="debug-parameter-label">识别算法
                  <DebugParameterHelp
                    label="识别算法"
                    description="选择从麦克风声音估算音高的算法。不同算法对设备、琴声和环境的表现可能不同。"
                    recommendation="先使用设置页当前选择的算法；手机和平板不推荐 Pitchy。"
                  />
                </span>
                <select
                  aria-label="麦克风调试识别算法"
                  disabled={isLoadingMicrophoneAlgorithm || practiceMicrophone.status === "listening" ||
                    practiceMicrophone.status === "requesting"}
                  value={practiceMicrophonePreferences.algorithm}
                  onChange={(event) => void selectMicrophoneAlgorithm(event.target.value as PracticeMicrophoneAlgorithm)}
                >
                  <option value="mpm-c">{practiceMicrophoneAlgorithmLabel("mpm-c")}</option>
                  <option value="swiftf0">{practiceMicrophoneAlgorithmLabel("swiftf0")}</option>
                  <option value="yin">{practiceMicrophoneAlgorithmLabel("yin")}</option>
                </select>
                {practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting"
                  ? <small>请先暂停练习并释放麦克风，再切换算法或恢复默认配置。</small>
                  : null}
              </label>
              <label>
                <span className="debug-parameter-label">输入放大
                  <DebugParameterHelp label="输入放大" description="在软件分析前放大麦克风信号；琴声和环境噪声都会一起变大。" recommendation="1×。只有调试采样较弱时再尝试提高。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.analysisGain}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    analysisGain: Number(event.target.value) as PracticeMicrophoneDebugParameters["analysisGain"],
                  })}
                >
                  {PRACTICE_MICROPHONE_ANALYSIS_GAINS.map((gain) => (
                    <option key={gain} value={gain}>{gain}×</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">识别分析间隔
                  <DebugParameterHelp label="识别分析间隔" description="两次音高分析之间的时间。间隔越短，反应可能更快，但设备计算量更大。" recommendation="自动；MPM-C/SwiftF0 为 30 ms，YIN 为 50 ms。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.frameIntervalMs}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    frameIntervalMs: event.target.value === "auto"
                      ? "auto"
                      : Number(event.target.value) as PracticeMicrophoneDebugParameters["frameIntervalMs"],
                  })}
                >
                  <option value="auto">自动</option>
                  {PRACTICE_MICROPHONE_FRAME_INTERVALS.map((interval) => (
                    <option key={interval} value={interval}>{interval} ms</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">连续稳定帧数
                  <DebugParameterHelp label="连续稳定帧数" description="候选音高需要连续出现多少次才作为一次答题。要求更多帧可减少短暂误识别，也会增加延迟。" recommendation="默认 4 帧；1 级敏感档使用 2 帧。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.requiredStableFrames}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    requiredStableFrames: Number(event.target.value) as PracticeMicrophoneDebugParameters["requiredStableFrames"],
                  })}
                >
                  {PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS.map((count) => (
                    <option key={count} value={count}>{count} 帧</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">最短稳定时长
                  <DebugParameterHelp label="最短稳定时长" description="候选音高至少持续多久才确认。时间越短，短音更容易识别，但误触发风险会增加。" recommendation="默认 80 ms；1 级敏感档使用 50 ms。" />
                </span>
                <select
                  value={practiceMicrophonePreferences.debugParameters.requiredStableMs}
                  onChange={(event) => updateMicrophoneDebugParameters({
                    requiredStableMs: Number(event.target.value) as PracticeMicrophoneDebugParameters["requiredStableMs"],
                  })}
                >
                  {PRACTICE_MICROPHONE_STABLE_DURATIONS.map((duration) => (
                    <option key={duration} value={duration}>{duration} ms</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="debug-parameter-label">置信度门槛
                  <DebugParameterHelp label="置信度门槛" description="音高算法对候选结果的把握程度要求；提高门槛会更谨慎，也更容易漏掉弱音。" recommendation="标准档为 0.75（SwiftF0 为 0.60）；实际值随算法和敏感度档位变化。" />
                </span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => {
                    if (event.target.value !== "") {
                      updateMicrophoneDebugParameters({ confidenceThreshold: Number(event.target.value) });
                    }
                  }}
                  step={0.001}
                  type="number"
                  value={practiceMicrophonePreferences.debugParameters.confidenceThreshold}
                />
              </label>
              <label>
                <span className="debug-parameter-label">输入 RMS 门槛
                  <DebugParameterHelp label="输入 RMS 门槛" description="声音强度下限。低于此值的帧不参与答题；调低能接收更轻的声音，也可能接收更多噪声。" recommendation="标准档为 0.0018，1 级敏感档为 0.0009。" />
                </span>
                <input
                  max={0.01}
                  min={0}
                  onChange={(event) => {
                    if (event.target.value !== "") {
                      updateMicrophoneDebugParameters({ inputRmsThreshold: Number(event.target.value) });
                    }
                  }}
                  step={0.00001}
                  type="number"
                  value={practiceMicrophonePreferences.debugParameters.inputRmsThreshold}
                />
              </label>
              {microphoneConfiguration.algorithm === "mpm-c" ? (
                <label>
                  <span className="debug-parameter-label">主候选清晰度门槛
                    <DebugParameterHelp label="主候选清晰度门槛" description="Pitchy 主候选相对其他音高候选需要有多清晰；提高门槛会减少模糊候选，也可能漏掉弱音。" recommendation="0.80。" />
                  </span>
                  <input
                    max={1}
                    min={0}
                    onChange={(event) => {
                      if (event.target.value !== "") {
                        updateMicrophoneDebugParameters({ primaryClarityThreshold: Number(event.target.value) });
                      }
                    }}
                    step={0.001}
                    type="number"
                    value={practiceMicrophonePreferences.debugParameters.primaryClarityThreshold}
                  />
                </label>
              ) : null}
              {microphoneConfiguration.algorithm === "yin" ? (
                <label>
                  <span className="debug-parameter-label">YIN 阈值
                    <DebugParameterHelp label="YIN 阈值" description="YIN 用波形周期寻找基频。阈值决定接受周期候选的宽松程度；值越高越容易接受候选，值越低越严格。" recommendation="标准档为 0.15；1 级敏感档为 0.25，5 级不敏感档为 0.10。" />
                  </span>
                  <input
                    max={1}
                    min={0.01}
                    onChange={(event) => {
                      if (event.target.value !== "") {
                        updateMicrophoneDebugParameters({ yinThreshold: Number(event.target.value) });
                      }
                    }}
                    step={0.001}
                    type="number"
                    value={practiceMicrophonePreferences.debugParameters.yinThreshold}
                  />
                </label>
              ) : null}
            </fieldset>
            {isLoadingMicrophoneAlgorithm ? <span role="status">正在加载 SwiftF0 算法资源…</span> : null}
            {microphoneAlgorithmError ? <span role="alert">{microphoneAlgorithmError}</span> : null}
            <div aria-live="polite" className="practice-microphone-diagnostics-values">
              {practiceMicrophone.diagnostics ? (
                <>
                  <span>
                    Web Audio：{practiceMicrophone.diagnostics.audioContextState}
                    {" · "}{practiceMicrophone.diagnostics.audioContextSampleRate} Hz
                    {practiceMicrophone.diagnostics.trackSampleRate === null
                      ? " · 音轨未报告"
                      : ` · 音轨 ${practiceMicrophone.diagnostics.trackSampleRate} Hz`}
                  </span>
                  <span>
                    浏览器报告：{practiceMicrophone.diagnostics.channelCount ?? "声道未报告"} 声道
                    {" · AGC "}{practiceMicrophone.diagnostics.autoGainControl === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.autoGainControl ? "开" : "关"}
                    {" · 回声消除 "}{practiceMicrophone.diagnostics.echoCancellation === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.echoCancellation ? "开" : "关"}
                    {" · 降噪 "}{practiceMicrophone.diagnostics.noiseSuppression === null
                      ? "未报告"
                      : practiceMicrophone.diagnostics.noiseSuppression ? "开" : "关"}
                  </span>
                  <span>
                    原始 RMS：{practiceMicrophone.diagnostics.inputRms.toFixed(5)}
                    {microphoneConfiguration.analysisGain > 1
                      ? ` · 算法 RMS ${practiceMicrophone.diagnostics.analysisRms.toFixed(5)} (${microphoneConfiguration.analysisGain}×)`
                      : ""}
                    {" · 门槛 "}{practiceMicrophone.diagnostics.inputRmsThreshold.toFixed(5)}
                  </span>
                  <span>
                    算法候选：{practiceMicrophone.diagnostics.candidateNote ?? "无标准音名"}
                    {practiceMicrophone.diagnostics.candidateFrequencyHz === null
                      ? ""
                      : ` (${practiceMicrophone.diagnostics.candidateFrequencyHz.toFixed(1)} Hz)`}
                    {" · 置信度 "}{practiceMicrophone.diagnostics.candidateConfidence === null
                      ? "--"
                      : practiceMicrophone.diagnostics.candidateConfidence.toFixed(3)}
                    {` / ${practiceMicrophone.diagnostics.confidenceThreshold.toFixed(2)}`}
                  </span>
                  <strong>{practiceMicrophone.diagnostics.outcome}</strong>
                </>
              ) : (
                <span>连接麦克风后显示实时诊断。</span>
              )}
            </div>
            {practiceMicrophone.captureStatus ? <p role="status">{practiceMicrophone.captureStatus}</p> : null}
            <div className="practice-microphone-debug-actions">
              <button
                disabled={practiceMicrophone.captureRecording || isLoadingMicrophoneAlgorithm ||
                  practiceMicrophone.status === "listening" || practiceMicrophone.status === "requesting"}
                onClick={restoreMicrophoneDebugDefaults}
                type="button"
              >
                <RotateCcw size={14} />
                恢复默认配置
              </button>
              <button
                className="practice-microphone-copy-summary"
                disabled={practiceMicrophone.status !== "listening"}
                onClick={() => void practiceMicrophone.copyDiagnosticSummary(microphoneCaptureAnalysis ?? undefined)}
                type="button"
              >
                <Copy size={14} />
                复制诊断摘要
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
      {isMicrophoneAnalysisDialogOpen && practiceMicrophonePreferences.debugMode && microphoneCaptureAnalysis ? (
        <dialog
          aria-labelledby="practice-microphone-analysis-title"
          className="practice-microphone-analysis-dialog"
          onCancel={(event) => {
            event.preventDefault();
            setIsMicrophoneAnalysisDialogOpen(false);
          }}
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              setIsMicrophoneAnalysisDialogOpen(false);
            }
          }}
          ref={microphoneAnalysisDialogRef}
        >
          <div className="practice-microphone-analysis-dialog-header">
            <div>
              <h2 id="practice-microphone-analysis-title">采样分析结果</h2>
              <span>逐音列出稳定识别结果，并统计错音、漏音和多报。</span>
              {microphoneCaptureNotice ? (
                <div aria-live="polite" className="practice-microphone-feedback-banner" role="status">
                  {microphoneCaptureNotice}
                </div>
              ) : null}
            </div>
            <button
              aria-label="关闭采样分析"
              className="practice-microphone-analysis-dialog-close"
              onClick={() => setIsMicrophoneAnalysisDialogOpen(false)}
              ref={microphoneAnalysisDialogCloseRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="practice-microphone-analysis-dialog-body">
            <div className="practice-microphone-analysis-result">
              <section className="practice-microphone-analysis-conclusion">
                <h3>结论</h3>
                <p className={microphoneCaptureAnalysis.counts.extra || microphoneCaptureAnalysis.counts.wrong ||
                  microphoneCaptureAnalysis.counts.missed ? "is-attention" : "is-clear"}>
                  {microphoneCaptureAnalysis.counts.expected === null
                    ? `检测到 ${microphoneCaptureAnalysis.counts.detected} 个稳定音符，未与预期音序比较。`
                    : `预期 ${microphoneCaptureAnalysis.counts.expected} 音，识别 ${microphoneCaptureAnalysis.counts.detected} 音；` +
                      `正确 ${microphoneCaptureAnalysis.counts.correct}，错音 ${microphoneCaptureAnalysis.counts.wrong}，` +
                      `漏音 ${microphoneCaptureAnalysis.counts.missed}，多报 ${microphoneCaptureAnalysis.counts.extra}。` +
                      (microphoneCaptureAnalysis.counts.extra
                        ? `多报 ${microphoneCaptureAnalysis.counts.extra} 音可能造成额外误答。`
                        : "")}
                </p>
                {microphoneCaptureAnalysis.missedNotes.length > 0 ? (
                  <p className="practice-microphone-missed-notes">
                    漏音位置：{microphoneCaptureAnalysis.missedNotes.map((item) =>
                      `第 ${item.sequenceIndex + 1} 个白键 ${formatMidiNote(item.midiNoteNumber)}`
                    ).join("、")}。
                  </p>
                ) : null}
                <div className="practice-microphone-analysis-counts">
                  <span>
                    配置 {microphoneCaptureAnalysis.parameters.frameIntervalSelection === "auto"
                      ? "自动"
                      : `${microphoneCaptureAnalysis.parameters.frameIntervalSelection} ms`}
                    {" · 实测帧间隔 "}{microphoneCaptureAnalysis.medianFrameIntervalMs === null
                      ? "--"
                      : `${microphoneCaptureAnalysis.medianFrameIntervalMs.toFixed(0)} ms`}
                  </span>
                  <span>
                    稳定条件 {microphoneCaptureAnalysis.parameters.requiredStableFrames} 帧 /
                    {microphoneCaptureAnalysis.parameters.requiredStableMs} ms
                  </span>
                  <span>
                    {practiceMicrophoneAlgorithmLabel(microphoneCaptureAnalysis.parameters.algorithm)} ·
                    {microphoneCaptureAnalysis.parameters.debugMode
                      ? "调试参数"
                      : practiceMicrophoneSensitivityLevelLabel(microphoneCaptureAnalysis.parameters.sensitivityLevel)} ·
                    {microphoneCaptureAnalysis.parameters.analysisGain}× · RMS ≥
                    {microphoneCaptureAnalysis.parameters.inputRmsThreshold.toFixed(6)} · 置信度 ≥
                    {microphoneCaptureAnalysis.parameters.confidenceThreshold.toFixed(3)}
                    {microphoneCaptureAnalysis.parameters.algorithm === "mpm-c"
                      ? ` · 相邻音衔接 ≥${PRACTICE_NOTE_CONTINUITY_CONFIDENCE.toFixed(3)}（±2 半音、500 ms）`
                      : ""}
                    {microphoneCaptureAnalysis.parameters.algorithm === "mpm-c"
                      ? ` · 清晰度 ≥${microphoneCaptureAnalysis.parameters.primaryClarityThreshold.toFixed(3)}`
                      : ""}
                    {microphoneCaptureAnalysis.parameters.algorithm === "yin"
                      ? ` · YIN 阈值 ${microphoneCaptureAnalysis.parameters.yinThreshold.toFixed(3)}`
                      : ""}
                  </span>
                </div>
              </section>

              <section className="practice-microphone-analysis-section">
                <div className="practice-microphone-analysis-section-heading">
                  <h3>稳定识别结果</h3>
                  <span aria-label={`稳定识别 ${microphoneCaptureAnalysis.counts.detected} / ${microphoneCaptureAnalysis.expectedSequence?.length ?? 7}`}>
                    {microphoneCaptureAnalysis.counts.detected}/{microphoneCaptureAnalysis.expectedSequence?.length ?? 7}
                  </span>
                </div>
                {microphoneCaptureAnalysis.expectedSequence !== null || microphoneCaptureAnalysis.events.length > 0 ? (
                  <ResponsiveDataTable
                    ariaLabel="稳定识别结果表格"
                    className="practice-microphone-analysis-table"
                    columns={[
                      {
                        header: "#",
                        id: "row-number",
                        renderCell: (row) => row.rowNumber,
                        width: "44px",
                      },
                      {
                        header: "音符",
                        id: "note",
                        renderCell: (row) => row.event?.note ?? formatMidiNote(row.expectedMidiNoteNumber),
                        rowHeader: true,
                        width: "90px",
                      },
                      {
                        header: "判定",
                        id: "classification",
                        renderCell: (row) => {
                          const event = row.event;
                          if (!event) return "缺失";
                          if (event.classification === "correct") return "正确";
                          if (event.classification === "wrong") {
                            return `错音 · 预期 ${formatMidiNote(event.expectedMidiNoteNumber ?? 0)}`;
                          }
                          return event.classification === "extra" ? "多报" : "未对照";
                        },
                        width: "140px",
                      },
                      {
                        header: "时间 / 间隔",
                        id: "time",
                        renderCell: (row) => row.event
                          ? <>{(row.event.offsetMs / 1000).toFixed(2)} 秒
                            {row.event.intervalFromPreviousMs === null
                              ? " · 首音"
                              : ` · 间隔 ${(row.event.intervalFromPreviousMs / 1000).toFixed(2)} 秒`}</>
                          : "-",
                        width: "200px",
                      },
                      {
                        header: "置信度",
                        id: "confidence",
                        renderCell: (row) => row.event?.confidence.toFixed(3) ?? "-",
                        width: "90px",
                      },
                      {
                        header: "原始 RMS",
                        id: "input-rms",
                        renderCell: (row) => row.event?.rms.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "处理后 RMS",
                        id: "analysis-rms",
                        renderCell: (row) => row.event?.analysisRms.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "原始峰值",
                        id: "input-peak",
                        renderCell: (row) => row.event?.peak.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "处理后峰值",
                        id: "analysis-peak",
                        renderCell: (row) => row.event?.analysisPeak.toFixed(6) ?? "-",
                        width: "110px",
                      },
                      {
                        header: "频率",
                        id: "frequency",
                        renderCell: (row) => row.event ? `${row.event.frequencyHz.toFixed(1)} Hz` : "-",
                        width: "100px",
                      },
                    ] satisfies readonly ResponsiveDataTableColumn<StableResultDisplayRow>[]}
                    getRowKey={(row, index) => row.event
                      ? `${row.event.offsetMs}-${index}`
                      : `missing-${row.expectedMidiNoteNumber}-${index}`}
                    minWidth="1120px"
                    rows={buildStableResultDisplayRows(microphoneCaptureAnalysis)}
                    rowClassName={(row) => row.isMissing
                      ? "is-missed-note"
                      : row.event ? `is-${row.event.classification}` : undefined}
                    tableLayout="fixed"
                    viewportClassName="practice-microphone-analysis-table-scroll"
                  />
                ) : (
                  <p className="practice-microphone-analysis-empty">没有形成稳定识别事件。</p>
                )}
              </section>

              <section className="practice-microphone-analysis-section">
                <h3>
                  未触发答题的候选片段 · {microphoneCaptureAnalysis.candidateSegments.filter((segment) =>
                    segment.stableEventCount === 0
                  ).length}
                </h3>
                {microphoneCaptureAnalysis.candidateSegments.some((segment) => segment.stableEventCount === 0) ? (
                  <ResponsiveDataTable
                    ariaLabel="未触发答题的候选片段表格"
                    className="practice-microphone-analysis-table practice-microphone-candidate-table"
                    columns={[
                      {
                        header: "音符",
                        id: "note",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.note,
                        renderCell: (segment) => segment.note,
                        rowHeader: true,
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.note,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && displayInfo.isDurationBelowThreshold
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "时间范围 / 连续时长门槛",
                        id: "time",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.time,
                        renderCell: (segment) => {
                          const { durationMs } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return (
                            <>
                              {(segment.startOffsetMs / 1000).toFixed(2)}–{(segment.endOffsetMs / 1000).toFixed(2)} 秒
                              <span className="practice-microphone-threshold-comparison">
                                连续有效 {durationMs}/{microphoneCaptureAnalysis.parameters.requiredStableMs} ms
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.time,
                      },
                      {
                        header: "状态",
                        id: "status",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.status,
                        renderCell: (segment) => segment.stableThresholdMet ? "达到门槛，未触发" : "未达到门槛",
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.status,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && segment.lowConfidenceFrameCount > 0
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "置信度 均值 / 峰值",
                        id: "confidence",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.confidence,
                        renderCell: (segment) => {
                          const threshold = microphoneCaptureAnalysis.parameters.confidenceThreshold;
                          return (
                            <>
                              <span className="practice-microphone-threshold-comparison">
                                均值 {segment.confidenceAverage === null ? "--" : segment.confidenceAverage.toFixed(3)} / {threshold.toFixed(3)}
                              </span>
                              <span className="practice-microphone-threshold-comparison">
                                峰值 {segment.confidenceMaximum === null ? "--" : segment.confidenceMaximum.toFixed(3)} / {threshold.toFixed(3)}
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.confidence,
                      },
                      {
                        header: "原始 RMS（参考）均值 / 峰值",
                        id: "input-rms",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.inputRms,
                        renderCell: (segment) => (
                          <>
                            <span className="practice-microphone-threshold-comparison">均值 {segment.inputRmsAverage.toFixed(6)}</span>
                            <span className="practice-microphone-threshold-comparison">峰值 {segment.inputRmsMaximum.toFixed(6)}</span>
                          </>
                        ),
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.inputRms,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && segment.lowRmsFrameCount > 0
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "处理后 RMS 均值 / 峰值",
                        id: "analysis-rms",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.analysisRms,
                        renderCell: (segment) => {
                          const threshold = microphoneCaptureAnalysis.parameters.inputRmsThreshold;
                          return (
                            <>
                              <span className="practice-microphone-threshold-comparison">
                                均值 {segment.analysisRmsAverage.toFixed(6)} / {threshold.toFixed(6)}
                              </span>
                              <span className="practice-microphone-threshold-comparison">
                                峰值 {segment.analysisRmsMaximum.toFixed(6)} / {threshold.toFixed(6)}
                              </span>
                            </>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.analysisRms,
                      },
                      {
                        getCellClassName: (segment) => {
                          const displayInfo = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return displayInfo.isMissedNote && displayInfo.isFrameCountBelowThreshold
                            ? "is-below-threshold"
                            : undefined;
                        },
                        header: "连续有效帧 / 门槛",
                        id: "eligible-frames",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.eligibleFrames,
                        renderCell: (segment) => `${segment.maxConsecutiveEligibleFrameCount}/${microphoneCaptureAnalysis.parameters.requiredStableFrames}`,
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.eligibleFrames,
                      },
                      {
                        header: "门槛说明",
                        id: "gate-reasons",
                        maxWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                        renderCell: (segment) => {
                          const { failureReasons } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                          return failureReasons.length > 0 ? (
                            <ul className="practice-microphone-gate-reasons">
                              {failureReasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          ) : "稳定门槛已满足";
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.gateReasons,
                      },
                      {
                        header: "逐帧数据",
                        id: "frames",
                        minWidth: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.frames,
                        renderCell: (segment, index) => {
                          const segmentKey = `${segment.startOffsetMs}-${index}`;
                          const isExpanded = expandedCandidateSegmentKey === segmentKey;
                          return (
                            <button
                              aria-controls={`microphone-candidate-frames-${segment.startOffsetMs}-${index}`}
                              aria-expanded={isExpanded}
                              className="practice-microphone-frame-toggle"
                              onClick={() => setExpandedCandidateSegmentKey((current) =>
                                current === segmentKey ? null : segmentKey)}
                              type="button"
                            >
                              {isExpanded ? "收起" : `查看 ${segment.frames.length} 帧`}
                            </button>
                          );
                        },
                        width: MICROPHONE_CANDIDATE_COLUMN_WIDTHS.frames,
                      },
                    ] satisfies readonly ResponsiveDataTableColumn<PracticeMicrophoneCandidateSegment>[]}
                    getRowKey={(segment, index) => `${segment.startOffsetMs}-${index}`}
                    minWidth={MICROPHONE_CANDIDATE_TABLE_MIN_WIDTH}
                    rows={sortCandidateSegmentsMissedFirst(
                      microphoneCaptureAnalysis.candidateSegments.filter((segment) => segment.stableEventCount === 0),
                      microphoneCaptureAnalysis,
                    )}
                    renderRowDetails={(segment, index) => {
                      const segmentKey = `${segment.startOffsetMs}-${index}`;
                      if (expandedCandidateSegmentKey !== segmentKey) return null;
                      const detailsId = `microphone-candidate-frames-${segment.startOffsetMs}-${index}`;
                      return (
                        <ResponsiveDataTable
                          ariaLabel="候选音符逐帧数据"
                          className="practice-microphone-analysis-table practice-microphone-frame-table"
                          columns={[
                            {
                              header: "时间",
                              id: "time",
                              renderCell: (frame) => `${(frame.offsetMs / 1000).toFixed(3)} 秒`,
                              width: "100px",
                            },
                            {
                              header: "频率",
                              id: "frequency",
                              renderCell: (frame) => frame.frequencyHz === null ? "--" : `${frame.frequencyHz.toFixed(1)} Hz`,
                              width: "90px",
                            },
                            {
                              header: "置信度",
                              id: "confidence",
                              renderCell: (frame) => frame.confidence === null ? "--" : frame.confidence.toFixed(3),
                              width: "90px",
                            },
                            {
                              header: "原始 RMS",
                              id: "input-rms",
                              renderCell: (frame) => frame.rms.toFixed(6),
                              width: "100px",
                            },
                            {
                              header: "处理后 RMS",
                              id: "analysis-rms",
                              renderCell: (frame) => frame.analysisRms.toFixed(6),
                              width: "110px",
                            },
                            {
                              header: "原始峰值",
                              id: "input-peak",
                              renderCell: (frame) => frame.peak.toFixed(6),
                              width: "100px",
                            },
                            {
                              header: "处理后峰值",
                              id: "analysis-peak",
                              renderCell: (frame) => frame.analysisPeak.toFixed(6),
                              width: "110px",
                            },
                            {
                              header: "原始削波",
                              id: "input-clipping",
                              renderCell: (frame) => `${(frame.clippedSampleRatio * 100).toFixed(2)}%`,
                              width: "100px",
                            },
                            {
                              header: "处理后削波",
                              id: "analysis-clipping",
                              renderCell: (frame) => `${(frame.analysisClippedSampleRatio * 100).toFixed(2)}%`,
                              width: "110px",
                            },
                            {
                              header: "判定",
                              id: "eligibility",
                              renderCell: (frame) => frame.eligible ? "达标" : frame.ambiguous ? "歧义" : "未达标",
                              width: "100px",
                            },
                          ] satisfies readonly ResponsiveDataTableColumn<typeof segment.frames[number]>[]}
                          getRowKey={(frame, frameIndex) => `${frame.offsetMs}-${frameIndex}`}
                          id={detailsId}
                          minWidth="1060px"
                          rows={segment.frames}
                          rowClassName={(frame) => frame.eligible ? "is-eligible" : "is-ineligible"}
                          tableLayout="fixed"
                          viewportClassName="practice-microphone-analysis-frame-scroll"
                        />
                      );
                    }}
                    rowClassName={(segment) => {
                      const { isMissedNote } = getCandidateSegmentDisplayInfo(segment, microphoneCaptureAnalysis);
                      return [
                        isMissedNote ? "is-missed-note" : "",
                        segment.stableThresholdMet ? "is-threshold-met" : "",
                      ].filter(Boolean).join(" ") || undefined;
                    }}
                    detailsRowClassName="practice-microphone-frame-details-row"
                    tableLayout="fixed"
                    viewportClassName="practice-microphone-analysis-table-scroll"
                  />
                ) : (
                  <p className="practice-microphone-analysis-empty">没有未触发答题的音高候选片段。</p>
                )}
              </section>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
