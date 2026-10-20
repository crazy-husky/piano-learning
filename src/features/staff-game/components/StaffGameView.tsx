// ⚠️ [归档规则]。详见 docs/product-decisions.md
import { Square, Volume2 } from "lucide-react";
import "vexflow/bravura";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type {
  NoteName,
  PianoKeyName,
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  StaffGameProficiencySample,
  StaffGameProficiencySampleDraft,
  StaffGameChallengeMode,
} from "../../../domain/types";
import { createUuid } from "../../../domain/id";
import {
  calculateStaffGameWrongNoteNoteDiagnostics,
  calculateStaffGameWrongNoteErrorCounts,
  calculateStaffGameWrongNoteWeights,
  compareStaffGameWrongNoteRun,
  filterStaffGameWrongNoteArchivesByRange,
  getStaffGameWrongNoteArchiveDateCount,
  getStaffGameWrongNotePriorityPreview,
  getStaffGameWrongNoteRunErrorCount,
  filterStaffGameWrongNoteLearningChallengeArchivesWithErrors,
  mergeStaffGameWrongNoteArchives,
  type StaffGameWrongNoteComparison,
  type StaffGameWrongNoteRange,
} from "../../../domain/staffGameWrongNoteArchives";
import { localDateKey } from "../../../domain/stats";
import {
  archiveStaffGameWrongNoteRun,
  deleteStaffGameWrongNoteArchiveRuns,
  db,
  enqueuePendingStaffGameWrongNoteArchiveRun,
  removePendingStaffGameWrongNoteArchiveRun,
  restoreStaffGameWrongNoteArchiveResponseTimes,
  retryPendingStaffGameWrongNoteArchives,
  saveStaffGameProficiencySamples,
} from "../../../data/db";
import { answerDeviceInfo, currentMicrophoneContext } from "../../../data/answerEvents";
import { useConfirmDialog } from "../../../shared/components/ui/ConfirmDialog";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type { MidiAccessStatus } from "../../../midi/midiInput";
import type {
  PracticeMicrophoneDiagnostics,
  usePracticeMicrophoneInput,
} from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import type {
  PracticeMicrophoneAlgorithm,
  PracticeMicrophonePreferences,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { practiceMicrophoneDebugParametersForSensitivityLevel } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { B6SwiftF0ReminderDialog } from "../../vocal-pitch/components/B6SwiftF0ReminderDialog";
import {
  readStaffGameSongProgress,
  saveStaffGameSongProgress,
  STAFF_GAME_SONGS,
  type StaffGameSongProgress,
} from "../data/staffGameSongs";
import { StaffGameFireworks } from "./StaffGameFireworks";
import { StaffGameDialogs } from "./StaffGameDialogs";
import { StaffGameErrorFlash, StaffGameStatusOverlays } from "./StaffGameStatusOverlays";
import {
  useStaffGameRoundClock,
  type StaffGameLevelRoundMetrics,
  type StaffGameRoundNoteOutcome,
} from "../hooks/useStaffGameRoundClock";
import { useStaffGameScoring } from "../hooks/useStaffGameScoring";
import { triggerStaffGameHitHaptic } from "../logic/staffGameHaptics";
import { useStaffGameAudio } from "../hooks/useStaffGameAudio";
import type { StaffGameSoundPlaybackTiming } from "../audio/staffGameSounds";
import { resolveStaffGameInputMode } from "../logic/staffGameSettings";
import {
  staffGamePromptSuppressedMidiNotes,
  STAFF_GAME_PROMPT_RECOGNITION_TAIL_MS,
} from "../logic/staffGamePromptPitchSuppression";
import type {
  StaffGameComboIndicator as ComboIndicator,
  StaffGameRushScoreFlight as RushScoreFlight,
  StaffGameWrongAnswerRecord,
} from "../hooks/useStaffGameScoring";
import type { StaffGameTarget as GameNote } from "../hooks/useStaffGameRoundClock";
import type { StaffGameDialogKind as GameDialog } from "./StaffGameDialogs";
import { StaffGameHud } from "./StaffGameHud";
import { StaffGameReadyPanel } from "./StaffGameReadyPanel";
import { LoadingActivityIndicator } from "../../../shared/components/LoadingActivity";
import { StaffGameSummaryDialog } from "./StaffGameSummaryDialog";
import { StaffGameWrongNoteStudyDialog } from "./StaffGameWrongNoteStudyDialog";
import { StaffGameWrongNoteArchiveManagerDialog } from "./StaffGameWrongNoteArchiveManagerDialog";
import { disconnectStaffGameBackgroundAudio } from "../audio/staffGameBackgroundAudio";
import {
  StaffGameMascot,
  StaffGameParticles,
  StaffGameRushSpeedLines,
  StaffGameShootingStar,
} from "./StaffGameEffects";
import type { StaffGameMascotAction } from "./StaffGameEffects";
import {
  createStaffGameResourceProgress,
  preloadStaffGameResources,
  STAFF_GAME_ART,
  STAFF_GAME_RESOURCE_MAX_RETRIES,
  STAFF_GAME_RESOURCE_RETRY_DELAY_MS,
  type StaffGameResourceProgress,
  type StaffGameResourceUpdate,
} from "../logic/staffGameResources";
import {
  BLACK_KEY_NOTES,
  BUBBLE_FADE_IN_MS,
  COMBO_INDICATOR_FADE_DURATION_MS,
  COMPUTER_KEY_PITCHES,
  GAME_DIFFICULTIES,
  GAME_LEVEL_COUNT,
  GAME_NOTE_PROGRESSION,
  NOTE_NAMES,
  PITCH_NAMES,
  RUSH_FALL_SPEED_MULTIPLIER,
  RUSH_MODE_COMBO_THRESHOLD,
  learningTestNoteBag,
  gameDurationMsForLevel,
  gameLevelForNotePoolScope,
  gameDifficultyPreset,
  gameNoteFromMidi,
  notePoolCandidates,
  staffGameSolfegeLabel,
  starsForAccuracy,
  type StaffGameNotePoolScope,
  type StaffGameNoteSchedulingStrategy,
  type StaffGameArcadeDuration,
  type StaffGamePitch,
} from "../logic/staffGameRules";
import {
  buildStaffGameWrongNoteReviewPlan,
  getStaffGameWrongNoteMasteredMidis,
  staffGameWrongNoteReviewDurationMs,
  formatStaffGameWrongNoteReviewDuration,
} from "../logic/staffGameWrongNoteReview";
import {
  summarizeStaffGameWrongNoteOutcomes,
  summarizeStaffGameWrongNoteRunPerformance,
} from "../logic/staffGameWrongNoteArchive";
import {
  appendStaffGameMicrophoneDebugEvent,
  resetStaffGameMicrophoneDebug,
} from "../logic/staffGameMicrophoneDebug";
import {
  correctedStaffGameResponseTimeMs,
  estimateStaffGameSystemDelayMs,
  shouldShowFastPlayingHint,
} from "../logic/staffGameProficiency";
import type { GameDifficulty } from "../logic/staffGameRules";

function nextWrongNoteRunUpdatedAt(run: StaffGameWrongNoteArchiveRun): string {
  const previous = Date.parse(run.updatedAt ?? run.endedAt);
  const timestamp = Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0);
  return new Date(timestamp).toISOString();
}

function makeTrendOnlyWrongNoteRun(
  run: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteArchiveRun {
  const notes = Object.fromEntries(
    Object.entries(run.notes).map(([key, note]) => [
      key,
      {
        ...note,
        wrong: 0,
        missed: 0,
        confusions: {},
      },
    ])
  );

  return {
    ...run,
    updatedAt: nextWrongNoteRunUpdatedAt(run),
    trendOnly: true,
    notes,
  };
}

const {
  gameBackgroundDesktop,
  gameBackgroundMobile,
  bubbleShell,
  cloudDecorationOne,
  cloudDecorationTwo,
  cloudDecorationThree,
  buttonPrimaryArt,
  buttonSecondaryArt,
  actionHelpArt,
  actionPauseArt,
  actionResumeArt,
  actionReturnArt,
  actionSettingsArt,
  modalFrameArt,
  starParticleArt,
  summaryLevelBannerArt,
  summaryFireworksArt,
} = STAFF_GAME_ART;

const COMBO_EXCELLENT_MILESTONE = 10;
const COMBO_AMAZING_MILESTONE = 20;
const COMBO_UNBELIEVABLE_MILESTONE = 30;
const COMBO_UNBELIEVABLE_INTERVAL = 20;
const COMBO_VOICE_MILESTONE_BUFFER = 2;
const FEEDBACK_DISPLAY_DURATION_MS = 2_000;

function isComboVoiceMilestone(comboCount: number): boolean {
  return (
    comboCount === COMBO_EXCELLENT_MILESTONE ||
    comboCount === COMBO_AMAZING_MILESTONE ||
    (comboCount >= COMBO_UNBELIEVABLE_MILESTONE &&
      (comboCount - COMBO_UNBELIEVABLE_MILESTONE) % COMBO_UNBELIEVABLE_INTERVAL === 0)
  );
}

function isNearComboVoiceMilestone(comboCount: number): boolean {
  if (comboCount <= COMBO_UNBELIEVABLE_MILESTONE) {
    return [COMBO_EXCELLENT_MILESTONE, COMBO_AMAZING_MILESTONE, COMBO_UNBELIEVABLE_MILESTONE].some(
      (milestone) => Math.abs(comboCount - milestone) <= COMBO_VOICE_MILESTONE_BUFFER
    );
  }
  const offset = (comboCount - COMBO_UNBELIEVABLE_MILESTONE) % COMBO_UNBELIEVABLE_INTERVAL;
  return Math.min(offset, COMBO_UNBELIEVABLE_INTERVAL - offset) <= COMBO_VOICE_MILESTONE_BUFFER;
}

const GAME_PROGRESS_KEY = "anki-note.staffGameProgress.v6";
const GAME_SETTINGS_KEY = "anki-note.staffGameSettings.v1";
const LOW_FPS_PROMPT_SESSION_KEY = "anki-note.staffGameLowFpsPrompted.v1";
const NIGHTMARE_LANDSCAPE_PROMPT_SNOOZE_KEY =
  "anki-note.staffGameNightmareLandscapePromptSnoozedUntil.v1";
const NIGHTMARE_LANDSCAPE_PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
let lowFpsPromptShownThisPage = false;
const BURST_STAR_COUNT = 14;
type GameInputMode = "physical" | "virtual" | "midi";
type GameDisplayMode = "note" | "solfege" | "number" | "none";
type StaffGameMode = "levels" | "songs";
type StaffGameRoundPurpose = "level" | "wrong-note-review";
type WrongNoteArchiveStatus = "idle" | "manual" | "saving" | "saved" | "error";
type WrongNoteArchiveMode = "automatic" | "manual" | "trend" | null;
type SongSelectionStep = "list" | "detail" | null;

interface StaffGameAudioSettings {
  soundEffectsEnabled: boolean;
  backgroundMusicEnabled: boolean;
  pianoSoundEnabled: boolean;
}

interface StaffGameSettings {
  inputMode: GameInputMode;
  displayMode: GameDisplayMode;
  difficulty: GameDifficulty;
  notePoolScope: StaffGameNotePoolScope;
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy;
  challengeMode: StaffGameChallengeMode;
  arcadeDuration: StaffGameArcadeDuration;
  wrongNoteStatisticsEnabled: boolean;
  autoArchiveWrongNotesEnabled: boolean;
  audioByMode: Record<StaffGameMode, StaffGameAudioSettings>;
  gameEffectsEnabled: boolean;
}

interface StaffGameWrongNoteReviewCondition {
  id: string;
  level: number;
  difficulty: GameDifficulty;
  notePoolScope: StaffGameNotePoolScope;
  gameMode: StaffGameChallengeMode;
  runCount: number;
  latestEndedAt: string;
  label: string;
}

const STAFF_GAME_REVIEW_SCOPE_LABELS: Record<StaffGameNotePoolScope, string> = {
  "current-group": "当前组",
  "all-history": "全部音域",
  "all-history-current-clef": "当前谱号全部",
};

function staffGameWrongNoteReviewConditionId(
  level: number,
  difficulty: GameDifficulty,
  notePoolScope: StaffGameNotePoolScope,
  gameMode: StaffGameChallengeMode
): string {
  return `${level}|${difficulty}|${notePoolScope}|${gameMode}`;
}

function areStaffGameSettingsEqual(left: StaffGameSettings, right: StaffGameSettings): boolean {
  const sameAudioSettings = (mode: StaffGameMode): boolean =>
    left.audioByMode[mode].soundEffectsEnabled === right.audioByMode[mode].soundEffectsEnabled &&
    left.audioByMode[mode].backgroundMusicEnabled ===
      right.audioByMode[mode].backgroundMusicEnabled &&
    left.audioByMode[mode].pianoSoundEnabled === right.audioByMode[mode].pianoSoundEnabled;

  return (
    left.inputMode === right.inputMode &&
    left.displayMode === right.displayMode &&
    left.difficulty === right.difficulty &&
    left.notePoolScope === right.notePoolScope &&
    left.noteSchedulingStrategy === right.noteSchedulingStrategy &&
    left.challengeMode === right.challengeMode &&
    left.arcadeDuration === right.arcadeDuration &&
    left.wrongNoteStatisticsEnabled === right.wrongNoteStatisticsEnabled &&
    left.autoArchiveWrongNotesEnabled === right.autoArchiveWrongNotesEnabled &&
    left.gameEffectsEnabled === right.gameEffectsEnabled &&
    sameAudioSettings("levels") &&
    sameAudioSettings("songs")
  );
}

interface StaffGameModeProgress {
  bestStars: number[];
  bestAccuracy: Array<Record<GameDifficulty, number | null>>;
  bestResponseMs: Array<Record<GameDifficulty, number | null>>;
}

interface StaffGameArcadeProgress extends StaffGameModeProgress {
  bestScores: number[];
  maxCombos: number[];
}

interface StaffGameProgress {
  version: 6;
  modes: {
    learning: StaffGameModeProgress;
    arcade: StaffGameArcadeProgress;
  };
  /** 仅调试用，后续清理。 */
  _debugLastRound: StaffGameLevelRoundSummary | null;
  unlockedLevel: number;
  selectedLevel: number;
}

interface StaffGameLevelRoundSummary {
  level: number;
  difficulty: GameDifficulty;
  generatedBubbleCount: number;
  firstTryCorrectCount: number;
  correctBubbleCount: number;
  responseTotalMs: number;
  responseSampleCount: number;
  accuracy: number | null;
  averageResponseMs: number | null;
}

interface BubbleBurst {
  token: number;
  x: number;
  y: number;
}

type MicrophoneController = Pick<
  ReturnType<typeof usePracticeMicrophoneInput>,
  | "detectedNote"
  | "error"
  | "inputLevel"
  | "isListening"
  | "isPreparingSwiftF0"
  | "prepare"
  | "start"
  | "suppressRecognizedNotes"
  | "status"
  | "stop"
> & { diagnostics: PracticeMicrophoneDiagnostics | null };

interface StaffGameViewProps {
  initialMode?: StaffGameMode;
  initialSongSelectionStep?: Exclude<SongSelectionStep, null>;
  initialSongId?: string;
  isSongPlayRoute: boolean;
  microphone: MicrophoneController;
  microphoneAlgorithm: PracticeMicrophoneAlgorithm;
  microphonePreferences: PracticeMicrophonePreferences;
  midi: MidiInputController;
  onModeChange: (mode: StaffGameMode) => void;
  onSongStart: (songId: string) => void;
  onSongSelectionExit: () => void;
  onExit: () => void;
  onSessionActiveChange: (active: boolean) => void;
  onRegisterAnswerHandler: (handler: ((answer: PracticeAnswerInput) => void) | null) => void;
}

interface StaffGamePromptSuppressionWindow {
  endAtMs: number;
  midiNotes: ReadonlySet<number>;
  startAtMs: number;
}

function createDifficultyMetricSlots(): Array<Record<GameDifficulty, number | null>> {
  return Array.from(
    { length: GAME_LEVEL_COUNT },
    () =>
      Object.fromEntries(GAME_DIFFICULTIES.map(({ id }) => [id, null])) as Record<
        GameDifficulty,
        number | null
      >
  );
}

function createRoundMetrics(): StaffGameLevelRoundMetrics {
  return {
    generatedBubbleCount: 0,
    resolvedQuestionCount: 0,
    targetQuestionCount: 0,
    firstTryCorrectCount: 0,
    correctBubbleCount: 0,
    responseTotalMs: 0,
    responseSampleCount: 0,
    firstInputByToken: new Map(),
    pendingLateInputMidi: null,
    lateInputShield: null,
  };
}

function defaultProgress(): StaffGameProgress {
  const defaultModeProgress = (): StaffGameModeProgress => ({
    bestStars: Array(GAME_LEVEL_COUNT).fill(0),
    bestAccuracy: createDifficultyMetricSlots(),
    bestResponseMs: createDifficultyMetricSlots(),
  });
  return {
    version: 6,
    modes: {
      learning: defaultModeProgress(),
      arcade: {
        ...defaultModeProgress(),
        bestScores: Array(GAME_LEVEL_COUNT).fill(0),
        maxCombos: Array(GAME_LEVEL_COUNT).fill(0),
      },
    },
    _debugLastRound: null,
    unlockedLevel: 1,
    selectedLevel: 1,
  };
}

function canUseVirtualKeyboard(): boolean {
  return typeof window !== "undefined";
}

function prefersTouchGameLayout(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const isTouchIPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const narrowGameViewport = window.matchMedia("(max-width: 820px)").matches;
  return isTouchIPad || window.matchMedia("(pointer: coarse)").matches || narrowGameViewport;
}

function isIPadDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function shouldShowNightmareLandscapePrompt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const savedSnooze = window.localStorage.getItem(NIGHTMARE_LANDSCAPE_PROMPT_SNOOZE_KEY);
    if (savedSnooze === null) return true;
    const snoozedUntil = Number(savedSnooze);
    return !Number.isFinite(snoozedUntil) || snoozedUntil <= Date.now();
  } catch {
    return true;
  }
}

function snoozeNightmareLandscapePrompt(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      NIGHTMARE_LANDSCAPE_PROMPT_SNOOZE_KEY,
      String(Date.now() + NIGHTMARE_LANDSCAPE_PROMPT_SNOOZE_MS)
    );
  } catch {
    // The game should still start when browser storage is unavailable.
  }
}

function supportsMidi(status: MidiAccessStatus): boolean {
  return status !== "unsupported" && status !== "insecure-context";
}

function defaultGameSettings(): StaffGameSettings {
  return {
    inputMode: "virtual",
    displayMode: "note",
    difficulty: "normal",
    notePoolScope: "all-history",
    noteSchedulingStrategy: "system",
    challengeMode: "learning",
    arcadeDuration: "level-default",
    wrongNoteStatisticsEnabled: true,
    autoArchiveWrongNotesEnabled: true,
    audioByMode: {
      levels: { soundEffectsEnabled: true, backgroundMusicEnabled: true, pianoSoundEnabled: false },
      songs: { soundEffectsEnabled: false, backgroundMusicEnabled: false, pianoSoundEnabled: true },
    },
    gameEffectsEnabled: true,
  };
}

function readGameSettings(virtualAvailable: boolean, midiAvailable: boolean): StaffGameSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_SETTINGS_KEY) ?? "null") as
      | (Partial<Omit<StaffGameSettings, "audioByMode">> & {
          audioByMode?: Partial<Record<StaffGameMode, Partial<StaffGameAudioSettings>>>;
          soundEffectsEnabled?: unknown;
          backgroundMusicEnabled?: unknown;
          speed?: unknown;
        })
      | null;
    const base = defaultGameSettings();
    const inputMode: GameInputMode = resolveStaffGameInputMode(parsed?.inputMode, {
      midiAvailable,
      virtualAvailable,
    });
    const displayMode: GameDisplayMode =
      parsed?.displayMode === "solfege" ||
      parsed?.displayMode === "number" ||
      parsed?.displayMode === "none"
        ? parsed.displayMode
        : "note";
    const validDifficulty = GAME_DIFFICULTIES.some((item) => item.id === parsed?.difficulty);
    const legacySpeed = Number(parsed?.speed);
    const legacyDifficulty: GameDifficulty = !Number.isFinite(legacySpeed)
      ? base.difficulty
      : legacySpeed <= 1
        ? "easy"
        : legacySpeed <= 3
          ? "normal"
          : legacySpeed <= 4
            ? "hard"
            : "nightmare";
    const readModeAudio = (mode: StaffGameMode): StaffGameAudioSettings => {
      const saved = parsed?.audioByMode?.[mode];
      const defaults = base.audioByMode[mode];
      const canMigrateLegacyAudio = mode === "levels";
      return {
        soundEffectsEnabled:
          typeof saved?.soundEffectsEnabled === "boolean"
            ? saved.soundEffectsEnabled
            : canMigrateLegacyAudio && typeof parsed?.soundEffectsEnabled === "boolean"
              ? parsed.soundEffectsEnabled
              : defaults.soundEffectsEnabled,
        backgroundMusicEnabled:
          typeof saved?.backgroundMusicEnabled === "boolean"
            ? saved.backgroundMusicEnabled
            : canMigrateLegacyAudio && typeof parsed?.backgroundMusicEnabled === "boolean"
              ? parsed.backgroundMusicEnabled
              : defaults.backgroundMusicEnabled,
        pianoSoundEnabled:
          typeof saved?.pianoSoundEnabled === "boolean"
            ? saved.pianoSoundEnabled
            : defaults.pianoSoundEnabled,
      };
    };
    return {
      inputMode,
      displayMode,
      difficulty: validDifficulty ? (parsed!.difficulty as GameDifficulty) : legacyDifficulty,
      wrongNoteStatisticsEnabled:
        typeof parsed?.wrongNoteStatisticsEnabled === "boolean"
          ? parsed.wrongNoteStatisticsEnabled
          : base.wrongNoteStatisticsEnabled,
      autoArchiveWrongNotesEnabled:
        typeof parsed?.autoArchiveWrongNotesEnabled === "boolean"
          ? parsed.autoArchiveWrongNotesEnabled
          : base.autoArchiveWrongNotesEnabled,
      notePoolScope:
        parsed?.notePoolScope === "current-group"
          ? "current-group"
          : parsed?.notePoolScope === "all-history-current-clef"
            ? "all-history-current-clef"
            : base.notePoolScope,
      noteSchedulingStrategy:
        parsed?.noteSchedulingStrategy === "random" ? "random" : base.noteSchedulingStrategy,
      challengeMode: parsed?.challengeMode === "arcade" ? "arcade" : "learning",
      arcadeDuration:
        parsed?.arcadeDuration === 60_000 ||
        parsed?.arcadeDuration === 120_000 ||
        parsed?.arcadeDuration === 180_000
          ? parsed.arcadeDuration
          : "level-default",
      audioByMode: { levels: readModeAudio("levels"), songs: readModeAudio("songs") },
      gameEffectsEnabled:
        typeof parsed?.gameEffectsEnabled === "boolean"
          ? parsed.gameEffectsEnabled
          : base.gameEffectsEnabled,
    };
  } catch {
    return defaultGameSettings();
  }
}

function saveGameSettings(settings: StaffGameSettings): void {
  try {
    localStorage.setItem(
      GAME_SETTINGS_KEY,
      JSON.stringify({
        ...settings,
        // Retain the old fields so older app versions can still read level-mode audio preferences.
        soundEffectsEnabled: settings.audioByMode.levels.soundEffectsEnabled,
        backgroundMusicEnabled: settings.audioByMode.levels.backgroundMusicEnabled,
      })
    );
  } catch {
    // Settings still apply for this visit if storage is unavailable.
  }
}

function readStoredJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function updateModeAudioSettings(
  settings: StaffGameSettings,
  mode: StaffGameMode,
  update: Partial<StaffGameAudioSettings>
): StaffGameSettings {
  return {
    ...settings,
    audioByMode: {
      ...settings.audioByMode,
      [mode]: { ...settings.audioByMode[mode], ...update },
    },
  };
}

function readProgress(): StaffGameProgress {
  try {
    const stored = readStoredJson(GAME_PROGRESS_KEY);
    const base = defaultProgress();
    if (
      !stored ||
      typeof stored !== "object" ||
      Array.isArray(stored) ||
      (stored as { version?: unknown }).version !== 6
    ) {
      saveProgress(base);
      return base;
    }
    const parsed = stored as Partial<StaffGameProgress>;
    const readArray = (value: unknown, maxValue = Number.MAX_SAFE_INTEGER): number[] =>
      Array.from({ length: GAME_LEVEL_COUNT }, (_, index) => {
        const item = Array.isArray(value) ? Number(value[index]) : 0;
        return Number.isFinite(item) ? Math.max(0, Math.min(maxValue, Math.floor(item))) : 0;
      });
    const readMetricSlots = (
      value: unknown,
      maxValue: number
    ): Array<Record<GameDifficulty, number | null>> =>
      Array.from({ length: GAME_LEVEL_COUNT }, (_, index) => {
        const row = Array.isArray(value) ? value[index] : null;
        const record =
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Partial<Record<GameDifficulty, unknown>>)
            : {};
        return Object.fromEntries(
          GAME_DIFFICULTIES.map(({ id }) => {
            const raw = record[id];
            if (raw === null || raw === undefined) return [id, null];
            const metric = Number(raw);
            return [id, Number.isFinite(metric) ? Math.max(0, Math.min(maxValue, metric)) : null];
          })
        ) as Record<GameDifficulty, number | null>;
      });
    const normalizeModeProgress = (
      value: unknown,
      includeArcadeRecords: boolean
    ): StaffGameModeProgress | StaffGameArcadeProgress => {
      const record =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Partial<StaffGameModeProgress & StaffGameArcadeProgress>)
          : {};
      return {
        bestStars: readArray(record.bestStars, 3),
        bestAccuracy: readMetricSlots(record.bestAccuracy, 1),
        bestResponseMs: readMetricSlots(record.bestResponseMs, Number.MAX_SAFE_INTEGER),
        ...(includeArcadeRecords
          ? {
              bestScores: readArray(record.bestScores),
              maxCombos: readArray(record.maxCombos),
            }
          : {}),
      };
    };
    const readLastRound = (value: unknown): StaffGameLevelRoundSummary | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const record = value as Record<string, unknown>;
      const difficulty = GAME_DIFFICULTIES.find(({ id }) => id === record.difficulty)?.id;
      const level = Math.floor(Number(record.level));
      if (!difficulty || level < 1 || level > GAME_LEVEL_COUNT) return null;
      const readCount = (key: string): number => Math.max(0, Math.floor(Number(record[key]) || 0));
      const readDuration = (key: string): number => Math.max(0, Number(record[key]) || 0);
      const readOptionalMetric = (key: string): number | null => {
        if (record[key] === null || record[key] === undefined) return null;
        const metric = Number(record[key]);
        return Number.isFinite(metric) ? Math.max(0, metric) : null;
      };
      return {
        level,
        difficulty,
        generatedBubbleCount: readCount("generatedBubbleCount"),
        firstTryCorrectCount: readCount("firstTryCorrectCount"),
        correctBubbleCount: readCount("correctBubbleCount"),
        responseTotalMs: readDuration("responseTotalMs"),
        responseSampleCount: readCount("responseSampleCount"),
        accuracy: readOptionalMetric("accuracy"),
        averageResponseMs: readOptionalMetric("averageResponseMs"),
      };
    };
    const lastRound = readLastRound(parsed._debugLastRound);
    const progress: StaffGameProgress = {
      version: 6,
      modes: {
        learning: normalizeModeProgress(parsed.modes?.learning, false) as StaffGameModeProgress,
        arcade: normalizeModeProgress(parsed.modes?.arcade, true) as StaffGameArcadeProgress,
      },
      _debugLastRound: lastRound,
      unlockedLevel: Math.max(
        1,
        Math.min(GAME_LEVEL_COUNT, Math.floor(Number(parsed.unlockedLevel) || base.unlockedLevel))
      ),
      selectedLevel: Math.max(
        1,
        Math.min(
          GAME_LEVEL_COUNT,
          Math.floor(
            Number(parsed.selectedLevel) || Number(parsed.unlockedLevel) || base.selectedLevel
          )
        )
      ),
    };
    saveProgress(progress);
    return progress;
  } catch {
    return defaultProgress();
  }
}

function saveProgress(progress: StaffGameProgress): boolean {
  try {
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    // The current game remains playable if browser storage is unavailable.
    return false;
  }
}

function noteLabel(note: GameNote): string {
  return `${note.name}${note.octave}`;
}

function virtualKeyLabel(pitch: PianoKeyName, mode: GameDisplayMode): string {
  if (mode === "none") return "";
  const noteIndex = NOTE_NAMES.indexOf(pitch[0] as NoteName);
  const isSharp = pitch.includes("#");
  if (mode === "solfege") return staffGameSolfegeLabel(pitch);
  if (mode === "number") return `${noteIndex + 1}${isSharp ? "♯" : ""}`;
  return pitch;
}

function NoteStaff({ note }: { note: GameNote }): JSX.Element {
  const noteLetter = note.name[0] as NoteName;
  const diatonicStep = (note.octave - 4) * 7 + NOTE_NAMES.indexOf(noteLetter);
  const clef = note.midi < 60 ? "bass" : "treble";
  const staffBottomStep = clef === "bass" ? -10 : 2;
  const staffTopStep = staffBottomStep + 8;
  const staffCenterStep = staffBottomStep + 4;
  const displayStep = diatonicStep;
  const stepSpacing = Math.min(10.5, 88 / Math.max(8, Math.abs(displayStep - staffCenterStep)));
  const yForStep = (step: number): number => 100 + (staffCenterStep - step) * stepSpacing;
  const noteY = yForStep(displayStep);
  const ledgerSteps: number[] = [];
  if (displayStep < staffBottomStep) {
    for (let step = staffBottomStep - 2; step >= displayStep; step -= 2) ledgerSteps.push(step);
  } else if (displayStep > staffTopStep) {
    for (let step = staffTopStep + 2; step <= displayStep; step += 2) ledgerSteps.push(step);
  }
  const stemGoesUp = displayStep <= staffCenterStep;
  const noteX = 132;
  const stemX = stemGoesUp ? noteX + 9 : noteX - 9;
  const stemEndY = yForStep(displayStep + (stemGoesUp ? 6 : -6));
  const accidental = note.name.includes("#") ? "♯" : note.name.includes("b") ? "♭" : null;
  const clefFontSize = stepSpacing * 8;
  const clefAnchorStep = clef === "bass" ? staffTopStep - 2 : staffBottomStep + 2;
  const staffLines = Array.from({ length: 5 }, (_, index) => staffBottomStep + index * 2);
  // SMuFL clefs use Bravura's musical font metrics; their text baseline is the
  // staff line that defines the clef (G4 for treble, F3 for bass).
  const clefGlyph = clef === "bass" ? "\uE062" : "\uE050";
  return (
    <svg
      aria-label={`${noteLabel(note)} 音符`}
      className="staff-game-note-staff"
      role="img"
      viewBox="0 0 190 200"
    >
      {staffLines.map((step) => {
        const lineY = yForStep(step);
        return <line key={step} x1="18" x2="172" y1={lineY} y2={lineY} />;
      })}
      <line x1="18" x2="18" y1={yForStep(staffTopStep)} y2={yForStep(staffBottomStep)} />
      <line x1="172" x2="172" y1={yForStep(staffTopStep)} y2={yForStep(staffBottomStep)} />
      <text
        className="staff-game-clef"
        style={{ fontSize: clefFontSize }}
        x="18"
        y={yForStep(clefAnchorStep)}
      >
        {clefGlyph}
      </text>
      {ledgerSteps.map((step) => {
        const ledgerY = yForStep(step);
        return (
          <line
            className="staff-game-ledger"
            key={step}
            x1="108"
            x2="156"
            y1={ledgerY}
            y2={ledgerY}
          />
        );
      })}
      {accidental ? (
        <text
          className="staff-game-accidental"
          dominantBaseline="central"
          x="92"
          y={noteY}
          style={{ fontSize: stepSpacing * 3.4 }}
        >
          {accidental}
        </text>
      ) : null}
      <ellipse
        className="staff-game-note-head"
        cx={noteX}
        cy={noteY}
        rx="11"
        ry={Math.max(5.5, stepSpacing * 0.92)}
        transform={`rotate(-18 ${noteX} ${noteY})`}
      />
      <line
        className="staff-game-note-stem"
        x1={stemX}
        x2={stemX}
        y1={noteY + (stemGoesUp ? -1 : 1)}
        y2={stemEndY}
      />
    </svg>
  );
}

export function StaffGameView({
  initialMode = "levels",
  initialSongSelectionStep = "list",
  initialSongId,
  isSongPlayRoute,
  microphone,
  microphoneAlgorithm,
  microphonePreferences,
  midi,
  onModeChange,
  onSongStart,
  onSongSelectionExit,
  onExit,
  onSessionActiveChange,
  onRegisterAnswerHandler,
}: StaffGameViewProps): JSX.Element {
  const confirmDialog = useConfirmDialog();
  const microphoneError = microphone.error;
  const suppressRecognizedNotes = microphone.suppressRecognizedNotes;
  const startMicrophone = microphone.start;
  const stopMicrophone = microphone.stop;
  const subscribeMidi = midi.subscribe;
  const [resourceLoadState, setResourceLoadState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [resourceProgress, setResourceProgress] = useState<StaffGameResourceProgress[]>(
    createStaffGameResourceProgress
  );
  const [resourceLoadAttempt, setResourceLoadAttempt] = useState(0);
  const [resourceLoadRetryCount, setResourceLoadRetryCount] = useState(0);
  const [progress, setProgress] = useState<StaffGameProgress>(readProgress);
  const [level, setLevel] = useState(() => readProgress().selectedLevel);
  const [gameMode, setGameMode] = useState<StaffGameMode>(initialMode);
  const [songSelectionStep, setSongSelectionStep] = useState<SongSelectionStep>(
    initialMode === "songs" ? initialSongSelectionStep : null
  );
  const [selectedSongId, setSelectedSongId] = useState(
    () => STAFF_GAME_SONGS.find((song) => song.id === initialSongId)?.id ?? STAFF_GAME_SONGS[0].id
  );
  const previousSongPlayRouteRef = useRef(isSongPlayRoute);
  const [songProgress, setSongProgress] =
    useState<StaffGameSongProgress>(readStaffGameSongProgress);
  const [phase, setPhase] = useState<"ready" | "running" | "paused" | "summary">("ready");
  const [virtualKeyboardAvailable, setVirtualKeyboardAvailable] = useState(canUseVirtualKeyboard);
  const [touchGameLayout, setTouchGameLayout] = useState(prefersTouchGameLayout);
  const [showLowFpsPrompt, setShowLowFpsPrompt] = useState(false);
  const [settings, setSettings] = useState<StaffGameSettings>(() =>
    readGameSettings(canUseVirtualKeyboard(), supportsMidi(midi.status))
  );
  const [settingsDraft, setSettingsDraft] = useState<StaffGameSettings>(settings);
  const [isSettingsDialogShaking, setIsSettingsDialogShaking] = useState(false);
  const [isWrongNoteNoticeOpen, setIsWrongNoteNoticeOpen] = useState(false);
  const [isUnsavedSettingsPromptOpen, setIsUnsavedSettingsPromptOpen] = useState(false);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const backgroundMusicRef = useRef<HTMLAudioElement | null>(null);
  const settingsDialogShakeLockRef = useRef(false);
  const [target, setTarget] = useState<GameNote | null>(null);
  const [rushBubbleSpeedLineLane, setRushBubbleSpeedLineLane] = useState<{
    centerPercent: number;
    halfWidthPercent: number;
  } | null>(null);
  const [rushBubbleScreenTopStart, setRushBubbleScreenTopStart] = useState<{
    token: number;
    top: number;
  } | null>(null);
  const rushBubbleScreenTopStartRef = useRef<{ token: number; top: number } | null>(null);
  const [targetPopped, setTargetPopped] = useState(false);
  const [targetWrong, setTargetWrong] = useState(false);
  const [bubbleBurst, setBubbleBurst] = useState<BubbleBurst | null>(null);
  const [comboIndicator, setComboIndicator] = useState<ComboIndicator | null>(null);
  const [score, setScore] = useState(0);
  const [displayedScore, setDisplayedScore] = useState(0);
  const [rushScoreFlights, setRushScoreFlights] = useState<RushScoreFlight[]>([]);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [errorFlashActive, setErrorFlashActive] = useState(false);
  const [mascotReaction, setMascotReaction] = useState<{
    action: "idle" | "cheer" | "sad";
    token: number;
    queuedAction: "cheer" | "sad" | null;
  }>({ action: "idle", token: 0, queuedAction: null });
  const readyMascotCheerLockRef = useRef(false);
  const [summaryScoreCount, setSummaryScoreCount] = useState(0);
  const [summaryComboCount, setSummaryComboCount] = useState(0);
  const [summaryChallengeMode, setSummaryChallengeMode] =
    useState<StaffGameChallengeMode>("learning");
  const [summaryAccuracy, setSummaryAccuracy] = useState(0);
  const [summaryAveragePlayerResponseMs, setSummaryAveragePlayerResponseMs] = useState<
    number | null
  >(null);
  const [summaryFastPlayingHint, setSummaryFastPlayingHint] = useState(false);
  const [summaryWrongAnswerRecords, setSummaryWrongAnswerRecords] = useState<
    StaffGameWrongAnswerRecord[]
  >([]);
  const [summaryWeakNoteOutcomes, setSummaryWeakNoteOutcomes] = useState<
    StaffGameRoundNoteOutcome[]
  >([]);
  const [summaryIsWrongNoteReview, setSummaryIsWrongNoteReview] = useState(false);
  const [summaryWrongNoteReviewTimedOut, setSummaryWrongNoteReviewTimedOut] = useState(false);
  const [wrongNoteArchives, setWrongNoteArchives] = useState<StaffGameWrongNoteArchive[]>([]);
  const [wrongNoteReviewRange, setWrongNoteReviewRange] = useState<StaffGameWrongNoteRange>(7);
  const [wrongNoteReviewConditionId, setWrongNoteReviewConditionId] = useState("all-learning");
  const [wrongNoteArchiveManagerRange, setWrongNoteArchiveManagerRange] =
    useState<StaffGameWrongNoteRange>(7);
  const [wrongNoteStudyRange, setWrongNoteStudyRange] = useState<StaffGameWrongNoteRange | null>(
    null
  );
  const [isWrongNoteStudyDialogOpen, setIsWrongNoteStudyDialogOpen] = useState(false);
  const [isWrongNoteArchiveManagerOpen, setIsWrongNoteArchiveManagerOpen] = useState(false);
  const [readyWrongNoteMode, setReadyWrongNoteMode] = useState<"level" | "review">("level");
  const [wrongNoteArchiveStatus, setWrongNoteArchiveStatus] =
    useState<WrongNoteArchiveStatus>("idle");
  const [wrongNoteArchiveRetryQueued, setWrongNoteArchiveRetryQueued] = useState(false);
  const [summaryArchiveRunId, setSummaryArchiveRunId] = useState<string | null>(null);
  const [summaryArchiveRun, setSummaryArchiveRun] = useState<StaffGameWrongNoteArchiveRun | null>(
    null
  );
  const [summaryArchiveDate, setSummaryArchiveDate] = useState<string | null>(null);
  const [summaryArchiveMode, setSummaryArchiveMode] = useState<WrongNoteArchiveMode>(null);
  const [songNotesCompleted, setSongNotesCompleted] = useState(0);
  const [songFirstTryHits, setSongFirstTryHits] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [earnedStars, setEarnedStars] = useState(0);
  const [revealedSummaryStars, setRevealedSummaryStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [gameError, setGameError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(false);
  const isNightmareLandscapePromptPendingRef = useRef(false);
  const startAttemptRef = useRef(0);
  const comboIndicatorRef = useRef<ComboIndicator | null>(null);
  const targetRef = useRef<GameNote | null>(null);
  const promptSuppressionWindowsRef = useRef<StaffGamePromptSuppressionWindow[]>([]);
  const spawnTargetRef = useRef<(atGameMs: number) => void>(() => undefined);
  const roundMetricsRef = useRef<StaffGameLevelRoundMetrics>(createRoundMetrics());
  const playfieldRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const targetElementRef = useRef<HTMLDivElement>(null);
  const scoreValueRef = useRef<HTMLElement>(null);
  const targetPoppedRef = useRef(false);
  const comboRef = useRef(0);
  const comboResetTimeoutRef = useRef<number | null>(null);
  const comboIndicatorFadeTimeoutRef = useRef<number | null>(null);
  const comboTimerStartedAtRef = useRef<number | null>(null);
  const comboTimerRemainingRef = useRef(0);
  const scoreRef = useRef(0);
  const displayedScoreRef = useRef(0);
  const scoreAnimationTargetRef = useRef(0);
  const scoreAnimationTimerRef = useRef<number | null>(null);
  const scoreAnimationPhaseRef = useRef(0);
  const rushScoreFlightsRef = useRef<RushScoreFlight[]>([]);
  const rushScoreFlightTokenRef = useRef(0);
  const maxComboRef = useRef(0);
  const errorFlashTimeoutRef = useRef<number | null>(null);
  const wrongAnswerRecordsRef = useRef<StaffGameWrongAnswerRecord[]>([]);
  const pendingWrongNoteArchiveRunsRef = useRef<StaffGameWrongNoteArchiveRun[]>([]);
  const summaryArchiveRunIdRef = useRef<string | null>(null);
  const roundStartedAtRef = useRef(new Date().toISOString());
  const roundReviewRangeRef = useRef<StaffGameWrongNoteRange | null>(null);
  const wrongNoteReviewDifficultyOverrideRef = useRef<GameDifficulty | null>(null);
  const roundNotePoolScopeRef = useRef<StaffGameWrongNoteArchiveRun["notePoolScope"]>(null);
  const roundNoteSchedulingStrategyRef =
    useRef<StaffGameWrongNoteArchiveRun["noteSchedulingStrategy"]>(undefined);
  const roundPurposeRef = useRef<StaffGameRoundPurpose>("level");
  const roundChallengeModeRef = useRef<StaffGameChallengeMode>("learning");
  const roundRecordsAtStartRef = useRef({ score: 0, maxCombo: 0 });
  const gameModeRef = useRef<StaffGameMode>(initialMode);
  const selectedSongIdRef = useRef(selectedSongId);
  const songProgressRef = useRef(songProgress);
  const songTargetIndexRef = useRef(0);
  const songFirstTryHitsRef = useRef(0);
  const songWrongTargetTokenRef = useRef<number | null>(null);
  const lowFpsPromptedRef = useRef(false);
  const triggerSettingsDialogShake = useCallback(() => {
    if (settingsDialogShakeLockRef.current) return;
    settingsDialogShakeLockRef.current = true;
    setIsSettingsDialogShaking(true);
  }, []);
  const levelRef = useRef(level);
  const unlockedLevelRef = useRef(progress.unlockedLevel);
  const phaseRef = useRef(phase);
  const progressRef = useRef(progress);
  const settingsRef = useRef(settings);
  const notePoolScopeRef = useRef<StaffGameNotePoolScope>(settings.notePoolScope);
  const noteSchedulingStrategyRef = useRef<StaffGameNoteSchedulingStrategy>(
    settings.noteSchedulingStrategy
  );
  const midiRef = useRef(midi);
  const recentNoteMidisRef = useRef<number[]>([]);
  const noteBagRef = useRef<Array<{ midi: number; name: PianoKeyName; octave: number }>>([]);
  const roundReviewQuestionCountRef = useRef(0);
  const roundReviewDurationMsRef = useRef(0);
  const targetTokenRef = useRef(0);
  const elapsedBeforeRunRef = useRef(0);
  const runSegmentStartedAtRef = useRef(0);
  const wrongClearTimeoutRef = useRef<number | null>(null);
  const burstTimeoutRef = useRef<number | null>(null);
  const nextTargetTimeoutRef = useRef<number | null>(null);
  const roundFinishedRef = useRef(false);
  const waitingForNextTargetRef = useRef(false);
  const lastLoggedMicrophoneObservationRef = useRef<string | null>(null);
  const prepareMicrophone = microphone.prepare;

  const unlockedReviewNotes = useMemo(
    () => GAME_NOTE_PROGRESSION.slice(0, progress.unlockedLevel),
    [progress.unlockedLevel]
  );
  const wrongNoteReviewConditions = useMemo(() => {
    const byId = new Map<string, Omit<StaffGameWrongNoteReviewCondition, "label">>();
    const eligibleArchives = filterStaffGameWrongNoteArchivesByRange(
      filterStaffGameWrongNoteLearningChallengeArchivesWithErrors(wrongNoteArchives),
      wrongNoteReviewRange
    );
    for (const archive of eligibleArchives) {
      for (const run of archive.runs) {
        const difficulty = GAME_DIFFICULTIES.find((item) => item.id === run.difficulty)?.id;
        const level = run.level;
        const notePoolScope = run.notePoolScope;
        const gameMode = run.gameMode;
        if (
          gameMode !== "learning" ||
          !Number.isInteger(level) ||
          level === null ||
          level < 1 ||
          level > GAME_LEVEL_COUNT ||
          !difficulty ||
          (notePoolScope !== "current-group" &&
            notePoolScope !== "all-history" &&
            notePoolScope !== "all-history-current-clef")
        ) {
          continue;
        }

        const id = staffGameWrongNoteReviewConditionId(level, difficulty, notePoolScope, gameMode);
        const current = byId.get(id);
        byId.set(id, {
          id,
          level,
          difficulty,
          notePoolScope,
          gameMode,
          runCount: (current?.runCount ?? 0) + 1,
          latestEndedAt:
            !current || run.endedAt.localeCompare(current.latestEndedAt) > 0
              ? run.endedAt
              : current.latestEndedAt,
        });
      }
    }

    return [...byId.values()]
      .sort(
        (left, right) =>
          right.latestEndedAt.localeCompare(left.latestEndedAt) || right.level - left.level
      )
      .map((condition) => ({
        ...condition,
        label: [
          `第 ${condition.level} 关`,
          GAME_DIFFICULTIES.find((item) => item.id === condition.difficulty)?.label ??
            condition.difficulty,
          STAFF_GAME_REVIEW_SCOPE_LABELS[condition.notePoolScope],
          condition.gameMode === "learning" ? "学习测试" : "娱乐模式",
          `${condition.runCount} 局`,
        ].join(" · "),
      }));
  }, [wrongNoteArchives, wrongNoteReviewRange]);
  const selectedWrongNoteReviewCondition = wrongNoteReviewConditions.find(
    (condition) => condition.id === wrongNoteReviewConditionId
  );
  const wrongNoteReviewSourceArchives = useMemo(() => {
    const eligibleArchives =
      filterStaffGameWrongNoteLearningChallengeArchivesWithErrors(wrongNoteArchives);
    if (!selectedWrongNoteReviewCondition) {
      return eligibleArchives;
    }
    return eligibleArchives.flatMap((archive) => {
      const runs = archive.runs.filter(
        (run) =>
          run.level === selectedWrongNoteReviewCondition.level &&
          run.difficulty === selectedWrongNoteReviewCondition.difficulty &&
          run.notePoolScope === selectedWrongNoteReviewCondition.notePoolScope &&
          run.gameMode === selectedWrongNoteReviewCondition.gameMode
      );
      return runs.length > 0 ? [{ ...archive, runs }] : [];
    });
  }, [selectedWrongNoteReviewCondition, wrongNoteArchives]);
  const wrongNoteReviewCandidateNotes = useMemo(
    () =>
      selectedWrongNoteReviewCondition
        ? notePoolCandidates(
            selectedWrongNoteReviewCondition.level,
            selectedWrongNoteReviewCondition.notePoolScope
          )
        : unlockedReviewNotes,
    [selectedWrongNoteReviewCondition, unlockedReviewNotes]
  );
  const wrongNoteReviewCandidateMidiSet = useMemo(
    () => new Set(wrongNoteReviewCandidateNotes.map((note) => note.midi)),
    [wrongNoteReviewCandidateNotes]
  );
  const wrongNoteReviewWeights = useMemo(
    () =>
      new Map(
        [
          ...calculateStaffGameWrongNoteWeights(
            wrongNoteReviewSourceArchives,
            wrongNoteReviewRange
          ),
        ].filter(([midi, weight]) => weight > 0 && wrongNoteReviewCandidateMidiSet.has(midi))
      ),
    [wrongNoteReviewCandidateMidiSet, wrongNoteReviewRange, wrongNoteReviewSourceArchives]
  );
  const wrongNoteReviewErrorCounts = useMemo(
    () =>
      new Map(
        calculateStaffGameWrongNoteErrorCounts(
          wrongNoteReviewSourceArchives,
          wrongNoteReviewRange
        ).map(({ midi, errorCount }) => [midi, errorCount] as const)
      ),
    [wrongNoteReviewRange, wrongNoteReviewSourceArchives]
  );
  const wrongNoteReviewAccuracies = useMemo(
    () =>
      new Map(
        calculateStaffGameWrongNoteNoteDiagnostics(
          wrongNoteReviewSourceArchives,
          wrongNoteReviewRange
        ).map(({ midi, accuracyPercent }) => [midi, accuracyPercent] as const)
      ),
    [wrongNoteReviewRange, wrongNoteReviewSourceArchives]
  );
  const wrongNoteReviewPreviewNotes = useMemo(
    () =>
      getStaffGameWrongNotePriorityPreview(
        wrongNoteReviewWeights,
        wrongNoteReviewCandidateMidiSet
      ).map(({ midi }) => ({
        ...gameNoteFromMidi(midi),
        errorCount: wrongNoteReviewErrorCounts.get(midi) ?? 0,
        accuracyPercent: wrongNoteReviewAccuracies.get(midi) ?? null,
      })),
    [
      wrongNoteReviewCandidateMidiSet,
      wrongNoteReviewAccuracies,
      wrongNoteReviewErrorCounts,
      wrongNoteReviewWeights,
    ]
  );
  const wrongNoteReviewPlan = useMemo(
    () =>
      buildStaffGameWrongNoteReviewPlan(
        wrongNoteReviewCandidateNotes,
        wrongNoteReviewWeights,
        getStaffGameWrongNoteMasteredMidis(wrongNoteReviewSourceArchives)
      ),
    [wrongNoteReviewCandidateNotes, wrongNoteReviewSourceArchives, wrongNoteReviewWeights]
  );
  const wrongNoteArchiveDateCount = useMemo(
    () => getStaffGameWrongNoteArchiveDateCount(wrongNoteReviewSourceArchives),
    [wrongNoteReviewSourceArchives]
  );
  const summaryWrongNoteComparison = useMemo<StaffGameWrongNoteComparison | null>(
    () =>
      summaryArchiveRun?.source === "review"
        ? compareStaffGameWrongNoteRun(wrongNoteArchives, summaryArchiveRun)
        : null,
    [summaryArchiveRun, wrongNoteArchives]
  );
  const summaryReviewPerformance = useMemo(
    () =>
      summaryIsWrongNoteReview && summaryArchiveRun
        ? summarizeStaffGameWrongNoteRunPerformance(summaryArchiveRun)
        : null,
    [summaryArchiveRun, summaryIsWrongNoteReview]
  );

  const deleteSelectedWrongNoteArchiveRuns = useCallback(
    async (runIds: string[]): Promise<void> => {
      if (runIds.length === 0) return;
      const confirmed = await confirmDialog({
        title: `删除选中的 ${runIds.length} 局记录？`,
        description: "将从错题集和练习统计中彻底删除这些对局，且无法恢复。",
        cancelLabel: "取消",
        confirmLabel: "确认删除",
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const remainingArchives = await deleteStaffGameWrongNoteArchiveRuns(runIds);
        setWrongNoteArchives(remainingArchives);
        toast.success(`已删除 ${runIds.length} 局记录`, { duration: 2000 });
      } catch {
        toast.error("删除失败", { description: "请稍后重试。" });
      }
    },
    [confirmDialog]
  );

  useEffect(() => {
    let active = true;
    void db.staffGameWrongNoteArchives
      .orderBy("date")
      .toArray()
      .then((archives) => {
        if (active) setWrongNoteArchives(archives);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void retryPendingStaffGameWrongNoteArchives().then((archives) => {
      if (active && archives.length > 0) {
        setWrongNoteArchives((current) => mergeStaffGameWrongNoteArchives(current, archives));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    resetStaffGameMicrophoneDebug();
  }, []);

  useEffect(() => {
    if (settings.inputMode !== "physical") return;
    void prepareMicrophone().catch(() => undefined);
  }, [prepareMicrophone, settings.inputMode]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(() => setFeedback(""), FEEDBACK_DISPLAY_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const triggerMascotReaction = useCallback((action: "cheer" | "sad"): void => {
    // Keep the current one-shot animation intact and coalesce a burst into one follow-up.
    setMascotReaction((current) =>
      current.action === "idle"
        ? { action, token: current.token + 1, queuedAction: null }
        : { ...current, queuedAction: action }
    );
  }, []);

  const triggerReadyMascotCheer = useCallback((): void => {
    if (
      phaseRef.current !== "ready" ||
      gameModeRef.current !== "levels" ||
      readyMascotCheerLockRef.current
    )
      return;
    readyMascotCheerLockRef.current = true;
    setMascotReaction((current) => ({
      action: "cheer",
      token: current.token + 1,
      queuedAction: null,
    }));
  }, []);

  const finishMascotReaction = useCallback((token: number): void => {
    readyMascotCheerLockRef.current = false;
    setMascotReaction((current) => {
      if (current.token !== token) return current;
      if (phaseRef.current !== "running") {
        return { action: "idle", token: current.token, queuedAction: null };
      }
      if (current.queuedAction) {
        return { action: current.queuedAction, token: current.token + 1, queuedAction: null };
      }
      return { action: "idle", token: current.token, queuedAction: null };
    });
  }, []);

  useEffect(() => {
    if (dialog === "settings") return;
    settingsDialogShakeLockRef.current = false;
    setIsSettingsDialogShaking(false);
  }, [dialog]);

  useEffect(() => {
    if (phase !== "ready" || gameMode !== "levels") readyMascotCheerLockRef.current = false;
  }, [gameMode, phase]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const backgroundMusicPreloadController = new AbortController();
    const backgroundMusic = new Audio();
    backgroundMusic.loop = true;
    backgroundMusic.preload = "auto";
    backgroundMusicRef.current = backgroundMusic;
    setResourceLoadState("loading");
    setResourceLoadRetryCount(0);
    setResourceProgress(createStaffGameResourceProgress());
    const updateResourceProgress = (update: StaffGameResourceUpdate): void => {
      if (!active) return;
      setResourceProgress((resources) =>
        resources.map((resource) =>
          resource.id === update.id
            ? { ...resource, status: update.status, error: update.error }
            : resource
        )
      );
    };
    const loadResources = async (): Promise<void> => {
      const failureCount = await preloadStaffGameResources(
        backgroundMusic,
        backgroundMusicPreloadController.signal,
        retryCount > 0,
        updateResourceProgress
      );
      if (!active) return;
      if (failureCount === 0) {
        setResourceLoadState("ready");
        return;
      }
      if (retryCount >= STAFF_GAME_RESOURCE_MAX_RETRIES) {
        setResourceLoadState("error");
        return;
      }

      retryCount += 1;
      setResourceLoadRetryCount(retryCount);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void loadResources();
      }, STAFF_GAME_RESOURCE_RETRY_DELAY_MS * retryCount);
    };
    void loadResources();
    return () => {
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      backgroundMusicPreloadController.abort();
      backgroundMusic.pause();
      disconnectStaffGameBackgroundAudio(backgroundMusic);
      backgroundMusic.removeAttribute("src");
      backgroundMusic.load();
      if (backgroundMusicRef.current === backgroundMusic) backgroundMusicRef.current = null;
    };
  }, [resourceLoadAttempt]);

  phaseRef.current = phase;
  targetRef.current = target;
  targetPoppedRef.current = targetPopped;
  levelRef.current = level;
  unlockedLevelRef.current = progress.unlockedLevel;
  progressRef.current = progress;
  gameModeRef.current = gameMode;
  selectedSongIdRef.current = selectedSongId;
  songProgressRef.current = songProgress;
  settingsRef.current = wrongNoteReviewDifficultyOverrideRef.current
    ? { ...settings, difficulty: wrongNoteReviewDifficultyOverrideRef.current }
    : settings;
  notePoolScopeRef.current = settings.notePoolScope;
  noteSchedulingStrategyRef.current = settings.noteSchedulingStrategy;
  midiRef.current = midi;

  const activeAudioSettings = settings.audioByMode[gameMode];
  const {
    playGameSound,
    playStarReveal,
    playVirtualPianoNote,
    setGameSoundsEnabled,
    unlockGameAudio,
  } = useStaffGameAudio({
    settings,
    backgroundMusicRef,
    backgroundMusicEnabled: activeAudioSettings.backgroundMusicEnabled,
    inputMode: settings.inputMode,
    phase,
    resourceLoadState,
    soundEffectsEnabled: activeAudioSettings.soundEffectsEnabled,
  });
  const draftAudioSettings = settingsDraft.audioByMode[gameMode];
  const readyReviewDifficulty =
    phase === "ready" && readyWrongNoteMode === "review"
      ? selectedWrongNoteReviewCondition?.difficulty
      : null;
  const difficulty = gameDifficultyPreset(
    wrongNoteReviewDifficultyOverrideRef.current ?? readyReviewDifficulty ?? settings.difficulty
  );
  const bubbleDurationMs = difficulty.bubbleDurationMs;
  const durationLevel = gameLevelForNotePoolScope(level, settings.notePoolScope);
  const levelDefaultGameDurationMs = gameDurationMsForLevel(durationLevel);
  const gameDurationMs =
    settings.arcadeDuration === "level-default"
      ? levelDefaultGameDurationMs
      : settings.arcadeDuration;
  const draftDifficulty = gameDifficultyPreset(settingsDraft.difficulty);
  const activeSongForStars =
    gameMode === "songs"
      ? STAFF_GAME_SONGS.find((song) => song.id === selectedSongIdRef.current)
      : null;
  const roundGeneratedCount = activeSongForStars
    ? activeSongForStars.noteMidis.length
    : roundMetricsRef.current.generatedBubbleCount;
  const roundFirstTryCorrectCount = activeSongForStars
    ? songFirstTryHitsRef.current
    : roundMetricsRef.current.firstTryCorrectCount;
  const currentRoundStars = starsForAccuracy(roundFirstTryCorrectCount, roundGeneratedCount);
  const levelProgress =
    roundGeneratedCount > 0 ? roundFirstTryCorrectCount / roundGeneratedCount : 0;
  const rushModeActive = combo >= RUSH_MODE_COMBO_THRESHOLD && phase === "running";
  // Keep the rush playfield geometry fixed while paused so a frozen bubble cannot jump.
  const preserveRushBubbleScreenTop =
    combo >= RUSH_MODE_COMBO_THRESHOLD && (phase === "running" || phase === "paused");
  const comboIndicatorIsRush = (comboIndicator?.count ?? 0) >= RUSH_MODE_COMBO_THRESHOLD;
  const rushVisualsActive = rushModeActive && settings.gameEffectsEnabled;
  const activeBubbleDurationMs = rushModeActive
    ? Math.round(bubbleDurationMs * RUSH_FALL_SPEED_MULTIPLIER)
    : bubbleDurationMs;

  useLayoutEffect(() => {
    if (!rushVisualsActive || !target) {
      setRushBubbleSpeedLineLane(null);
      return;
    }

    const scene = sceneRef.current;
    const bubble = targetElementRef.current;
    if (!scene || !bubble) {
      setRushBubbleSpeedLineLane(null);
      return;
    }

    const sceneBounds = scene.getBoundingClientRect();
    const bubbleBounds = bubble.getBoundingClientRect();
    if (sceneBounds.width <= 0) {
      setRushBubbleSpeedLineLane(null);
      return;
    }

    setRushBubbleSpeedLineLane({
      centerPercent:
        ((bubbleBounds.left + bubbleBounds.width / 2 - sceneBounds.left) / sceneBounds.width) * 100,
      halfWidthPercent: ((bubbleBounds.width / 2 + 8) / sceneBounds.width) * 100,
    });
  }, [rushVisualsActive, target]);

  useLayoutEffect(() => {
    if (!target) {
      if (rushBubbleScreenTopStartRef.current !== null) {
        rushBubbleScreenTopStartRef.current = null;
        setRushBubbleScreenTopStart(null);
      }
      return;
    }
    if (!preserveRushBubbleScreenTop) {
      if (rushBubbleScreenTopStartRef.current?.token !== target.token) {
        rushBubbleScreenTopStartRef.current = null;
        setRushBubbleScreenTopStart(null);
      }
      return;
    }
    const playfieldTop = playfieldRef.current?.getBoundingClientRect().top;
    if (playfieldTop === undefined) return;
    const nextStart = { token: target.token, top: Math.round(-playfieldTop) };
    const currentStart = rushBubbleScreenTopStartRef.current;
    if (currentStart?.token === nextStart.token && currentStart.top === nextStart.top) return;
    rushBubbleScreenTopStartRef.current = nextStart;
    setRushBubbleScreenTopStart(nextStart);
  }, [preserveRushBubbleScreenTop, target]);

  useLayoutEffect(() => {
    if (!rushScoreFlights.some((flight) => !flight.ready)) return;
    const sceneBounds = sceneRef.current?.getBoundingClientRect();
    if (!sceneBounds) return;
    const scoreBounds = scoreValueRef.current?.getBoundingClientRect();
    const destinationX = scoreBounds
      ? scoreBounds.left + scoreBounds.width / 2 - sceneBounds.left
      : sceneBounds.width - 56;
    const destinationY = scoreBounds ? scoreBounds.bottom - sceneBounds.top + 12 : 52;
    const readyFlights = rushScoreFlightsRef.current.map((flight) =>
      flight.ready
        ? flight
        : {
            ...flight,
            deltaX: destinationX - flight.left,
            deltaY: destinationY - flight.top,
            ready: true,
          }
    );
    rushScoreFlightsRef.current = readyFlights;
    setRushScoreFlights(readyFlights);
  }, [rushModeActive, rushScoreFlights]);

  useEffect(() => {
    document.body.classList.toggle("rush-mode", rushVisualsActive);
    return () => document.body.classList.remove("rush-mode");
  }, [rushVisualsActive]);

  const clearComboTimer = useCallback((): void => {
    if (comboResetTimeoutRef.current !== null) {
      window.clearTimeout(comboResetTimeoutRef.current);
      comboResetTimeoutRef.current = null;
    }
    comboTimerStartedAtRef.current = null;
  }, []);

  const resetComboDisplay = useCallback((): void => {
    clearComboTimer();
    comboTimerRemainingRef.current = 0;
    comboRef.current = 0;
    setCombo(0);
    const currentIndicator = comboIndicatorRef.current;
    if (!currentIndicator) return;

    if (comboIndicatorFadeTimeoutRef.current !== null) {
      window.clearTimeout(comboIndicatorFadeTimeoutRef.current);
    }
    const fadingIndicator = { ...currentIndicator, isFadingOut: true };
    comboIndicatorRef.current = fadingIndicator;
    setComboIndicator(fadingIndicator);
    comboIndicatorFadeTimeoutRef.current = window.setTimeout(() => {
      comboIndicatorFadeTimeoutRef.current = null;
      if (comboIndicatorRef.current?.token !== fadingIndicator.token) return;
      comboIndicatorRef.current = null;
      setComboIndicator(null);
    }, COMBO_INDICATOR_FADE_DURATION_MS);
  }, [clearComboTimer]);

  const clearComboIndicator = useCallback((): void => {
    if (comboIndicatorFadeTimeoutRef.current !== null) {
      window.clearTimeout(comboIndicatorFadeTimeoutRef.current);
      comboIndicatorFadeTimeoutRef.current = null;
    }
    comboIndicatorRef.current = null;
    setComboIndicator(null);
  }, []);

  const clearComboDisplay = useCallback((): void => {
    clearComboTimer();
    comboTimerRemainingRef.current = 0;
    comboRef.current = 0;
    setCombo(0);
    clearComboIndicator();
  }, [clearComboIndicator, clearComboTimer]);

  const restartComboTimer = useCallback((): void => {
    clearComboTimer();
    const comboWindowMs = gameDifficultyPreset(settingsRef.current.difficulty).comboWindowMs;
    comboTimerRemainingRef.current = comboWindowMs;
    if (phaseRef.current !== "running") return;
    comboTimerStartedAtRef.current = performance.now();
    comboResetTimeoutRef.current = window.setTimeout(resetComboDisplay, comboWindowMs);
  }, [clearComboTimer, resetComboDisplay]);

  const advanceRushScore = useCallback((): void => {
    scoreAnimationTimerRef.current = null;
    if (phaseRef.current === "paused") return;
    const remaining = scoreAnimationTargetRef.current - displayedScoreRef.current;
    if (remaining <= 0) return;

    const phaseIndex = scoreAnimationPhaseRef.current;
    const increment =
      phaseIndex === 0
        ? Math.max(1, Math.floor(remaining * 0.2))
        : phaseIndex === 1
          ? Math.max(1, Math.floor(remaining * 0.375))
          : remaining;
    const nextScore = Math.min(
      scoreAnimationTargetRef.current,
      displayedScoreRef.current + increment
    );
    displayedScoreRef.current = nextScore;
    setDisplayedScore(nextScore);
    scoreAnimationPhaseRef.current = (phaseIndex + 1) % 3;

    if (nextScore < scoreAnimationTargetRef.current) {
      scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
    }
  }, []);

  const queueRushScore = useCallback(
    (points: number): void => {
      if (points <= 0) return;
      scoreAnimationTargetRef.current += points;
      if (scoreAnimationTimerRef.current !== null) return;
      scoreAnimationPhaseRef.current = 0;
      scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
    },
    [advanceRushScore]
  );

  const setDisplayedScoreImmediately = useCallback((nextScore: number): void => {
    if (scoreAnimationTimerRef.current !== null)
      window.clearTimeout(scoreAnimationTimerRef.current);
    scoreAnimationTimerRef.current = null;
    scoreAnimationTargetRef.current = nextScore;
    displayedScoreRef.current = nextScore;
    scoreAnimationPhaseRef.current = 0;
    setDisplayedScore(nextScore);
  }, []);

  const flushScorePresentation = useCallback(
    (nextScore: number): void => {
      setDisplayedScoreImmediately(nextScore);
      rushScoreFlightsRef.current = [];
      setRushScoreFlights([]);
    },
    [setDisplayedScoreImmediately]
  );

  const completeRushScoreFlight = useCallback(
    (token: number, points: number): void => {
      if (!rushScoreFlightsRef.current.some((flight) => flight.token === token)) return;
      const remainingFlights = rushScoreFlightsRef.current.filter(
        (flight) => flight.token !== token
      );
      rushScoreFlightsRef.current = remainingFlights;
      setRushScoreFlights(remainingFlights);
      queueRushScore(points);
    },
    [queueRushScore]
  );

  const persistRoundResult = useCallback((finalStars: number): void => {
    const index = levelRef.current - 1;
    const current = progressRef.current;
    const difficulty = settingsRef.current.difficulty;
    const metrics = roundMetricsRef.current;
    const isArcadeRound = roundChallengeModeRef.current === "arcade";
    const mode = isArcadeRound ? "arcade" : "learning";
    const currentMode = current.modes[mode];
    const accuracy =
      metrics.generatedBubbleCount > 0
        ? metrics.firstTryCorrectCount / metrics.generatedBubbleCount
        : null;
    const averageResponseMs =
      metrics.responseSampleCount > 0
        ? metrics.responseTotalMs / metrics.responseSampleCount
        : null;
    const nextMode: StaffGameModeProgress | StaffGameArcadeProgress = {
      ...currentMode,
      bestStars: currentMode.bestStars.map((best, itemIndex) =>
        itemIndex === index ? Math.max(best, finalStars) : best
      ),
      bestAccuracy: currentMode.bestAccuracy.map((bestByDifficulty, itemIndex) =>
        itemIndex === index && accuracy !== null
          ? {
              ...bestByDifficulty,
              [difficulty]: Math.max(bestByDifficulty[difficulty] ?? 0, accuracy),
            }
          : bestByDifficulty
      ),
      bestResponseMs: currentMode.bestResponseMs.map((bestByDifficulty, itemIndex) =>
        itemIndex === index && averageResponseMs !== null
          ? {
              ...bestByDifficulty,
              [difficulty]: Math.min(
                bestByDifficulty[difficulty] ?? Number.POSITIVE_INFINITY,
                averageResponseMs
              ),
            }
          : bestByDifficulty
      ),
      ...(isArcadeRound
        ? {
            bestScores: (currentMode as StaffGameArcadeProgress).bestScores.map(
              (best, itemIndex) => (itemIndex === index ? Math.max(best, scoreRef.current) : best)
            ),
            maxCombos: (currentMode as StaffGameArcadeProgress).maxCombos.map((best, itemIndex) =>
              itemIndex === index ? Math.max(best, maxComboRef.current) : best
            ),
          }
        : {}),
    };
    const next: StaffGameProgress = {
      version: 6,
      modes: { ...current.modes, [mode]: nextMode } as StaffGameProgress["modes"],
      _debugLastRound: {
        level: levelRef.current,
        difficulty,
        generatedBubbleCount: metrics.generatedBubbleCount,
        firstTryCorrectCount: metrics.firstTryCorrectCount,
        correctBubbleCount: metrics.correctBubbleCount,
        responseTotalMs: metrics.responseTotalMs,
        responseSampleCount: metrics.responseSampleCount,
        accuracy,
        averageResponseMs,
      },
      unlockedLevel:
        finalStars > 0
          ? Math.max(current.unlockedLevel, Math.min(GAME_LEVEL_COUNT, levelRef.current + 1))
          : current.unlockedLevel,
      selectedLevel: current.selectedLevel,
    };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const persistSongResult = useCallback((finalStars: number, accuracy: number): void => {
    const songId = selectedSongIdRef.current;
    const difficulty = settingsRef.current.difficulty;
    const current = songProgressRef.current;
    const previous = current[songId]?.[difficulty] ?? {
      bestScore: 0,
      bestAccuracy: 0,
      bestStars: 0,
      maxCombo: 0,
      plays: 0,
    };
    const next = {
      ...current,
      [songId]: {
        ...current[songId],
        [difficulty]: {
          bestScore: Math.max(previous.bestScore, scoreRef.current),
          bestAccuracy: Math.max(previous.bestAccuracy, accuracy),
          bestStars: Math.max(previous.bestStars, finalStars),
          maxCombo: Math.max(previous.maxCombo, maxComboRef.current),
          plays: previous.plays + 1,
        },
      },
    };
    songProgressRef.current = next;
    setSongProgress(next);
    saveStaffGameSongProgress(next);
  }, []);

  const archiveWrongNoteRun = useCallback(
    async (
      runId: string | null = null,
      mode: "full" | "trend" = "full",
      keepTrendRunPendingForManualArchive = false
    ): Promise<void> => {
      const run = [...pendingWrongNoteArchiveRunsRef.current]
        .reverse()
        .find((item) => runId === null || item.runId === runId);
      if (!run) return;
      const shouldUpdateArchiveStatus =
        summaryArchiveRunIdRef.current === run.runId &&
        (mode === "full" || (mode === "trend" && !keepTrendRunPendingForManualArchive));
      const runToSave =
        mode === "trend"
          ? makeTrendOnlyWrongNoteRun(run)
          : { ...run, updatedAt: nextWrongNoteRunUpdatedAt(run), trendOnly: false };
      if (shouldUpdateArchiveStatus) {
        setWrongNoteArchiveStatus("saving");
        setWrongNoteArchiveRetryQueued(false);
      }
      try {
        const savedArchive = await archiveStaffGameWrongNoteRun(runToSave);
        if (mode === "full" || !keepTrendRunPendingForManualArchive) {
          pendingWrongNoteArchiveRunsRef.current = pendingWrongNoteArchiveRunsRef.current.filter(
            (item) => item.runId !== run.runId
          );
        }
        setWrongNoteArchives((current) => mergeStaffGameWrongNoteArchives(current, [savedArchive]));
        await removePendingStaffGameWrongNoteArchiveRun(runToSave);
        if (shouldUpdateArchiveStatus) {
          setWrongNoteArchiveStatus("saved");
          setWrongNoteArchiveRetryQueued(false);
        }
      } catch {
        const retryQueued = await enqueuePendingStaffGameWrongNoteArchiveRun(runToSave);
        if (shouldUpdateArchiveStatus) {
          setWrongNoteArchiveRetryQueued(retryQueued);
          setWrongNoteArchiveStatus("error");
        } else if (mode === "trend") {
          toast.error(
            retryQueued
              ? "本局趋势数据保存失败，已暂存并会在下次进入游戏页时自动重试。"
              : "本局趋势数据和本地暂存都失败了；如需保留错漏记录，请在结算页点“加入错题集”重试。"
          );
        }
      }
    },
    []
  );

  const recordRoundNoteOutcomes = useCallback(
    (
      outcomes: StaffGameRoundNoteOutcome[],
      wrongAnswerRecords: StaffGameWrongAnswerRecord[]
    ): void => {
      const scoredOutcomes = outcomes.filter((outcome) => !outcome.wasInterrupted);
      setSummaryWeakNoteOutcomes(scoredOutcomes);
      setSummaryArchiveRunId(null);
      setSummaryArchiveRun(null);
      summaryArchiveRunIdRef.current = null;
      setSummaryArchiveDate(null);
      setSummaryArchiveMode(null);
      setWrongNoteArchiveStatus("idle");
      setWrongNoteArchiveRetryQueued(false);

      const roundPurpose = roundPurposeRef.current;
      const source = roundPurpose === "level" ? "challenge" : "review";
      const endedAt = new Date().toISOString();
      const runId = createUuid();
      const inputMode: StaffGameProficiencySample["inputMode"] =
        settingsRef.current.inputMode === "physical"
          ? "microphone"
          : settingsRef.current.inputMode === "virtual"
            ? "virtual-keyboard"
            : "midi";
      const sensitivityLevel = microphonePreferences.sensitivityLevel;
      const microphoneAlgorithmAtAnswer = microphone.diagnostics?.algorithm ?? microphoneAlgorithm;
      const microphoneContext = currentMicrophoneContext();
      const configuredLatencyParameters = microphonePreferences.debugMode
        ? microphonePreferences.debugParameters
        : practiceMicrophoneDebugParametersForSensitivityLevel(
            microphoneAlgorithmAtAnswer,
            sensitivityLevel
          );
      const latencyParameters =
        microphoneAlgorithmAtAnswer === "yin" && microphonePreferences.algorithm !== "yin"
          ? {
              ...configuredLatencyParameters,
              frameIntervalMs: 30 as const,
              requiredStableFrames: 4 as const,
              requiredStableMs: 80 as const,
            }
          : configuredLatencyParameters;
      const estimatedSystemDelayMs = estimateStaffGameSystemDelayMs(
        inputMode,
        latencyParameters,
        microphoneAlgorithmAtAnswer
      );
      const proficiencySamples: StaffGameProficiencySampleDraft[] = outcomes.map((outcome) => {
        const rawResponseTimeMs = outcome.proficiencyResponseMs ?? null;
        const isSongRound = gameModeRef.current === "songs";
        return {
          id: `${runId}:${outcome.token}`,
          runId,
          date: localDateKey(endedAt),
          startedAt: roundStartedAtRef.current,
          endedAt,
          midi: outcome.midi,
          note: outcome.note,
          inputMode,
          deviceInfo: answerDeviceInfo(),
          inputGain: inputMode === "microphone" ? microphoneContext.inputGain : undefined,
          mode: isSongRound ? "song" : "staff-game",
          levelId:
            gameModeRef.current === "songs" || roundPurpose === "wrong-note-review"
              ? undefined
              : String(levelRef.current),
          songId: isSongRound ? selectedSongIdRef.current : undefined,
          difficulty: settingsRef.current.difficulty,
          staffGameSource: isSongRound ? undefined : source,
          gameMode: isSongRound
            ? null
            : source === "challenge"
              ? roundChallengeModeRef.current
              : null,
          attempts: outcome.attempts ?? [],
          sensitivityLevel,
          ...(inputMode === "microphone"
            ? { microphoneAlgorithm: microphoneAlgorithmAtAnswer }
            : {}),
          rawResponseTimeMs,
          estimatedSystemDelayMs,
          playerResponseTimeMs: correctedStaffGameResponseTimeMs(
            rawResponseTimeMs,
            estimatedSystemDelayMs
          ),
          firstInputCorrect: outcome.firstInputCorrect,
          missed: outcome.missed || (outcome.firstInputCorrect === null && !outcome.wasInterrupted),
          wasInterrupted: outcome.wasInterrupted,
        };
      });
      const validPlayerResponses = proficiencySamples
        .filter((sample) => sample.firstInputCorrect === true)
        .map((sample) => sample.playerResponseTimeMs)
        .filter((response): response is number => response !== null);
      setSummaryAveragePlayerResponseMs(
        validPlayerResponses.length
          ? validPlayerResponses.reduce((sum, response) => sum + response, 0) /
              validPlayerResponses.length
          : null
      );
      const isMacDesktop =
        typeof navigator !== "undefined" &&
        /Mac/i.test(navigator.platform) &&
        navigator.maxTouchPoints <= 1;
      setSummaryFastPlayingHint(
        inputMode === "microphone" && isMacDesktop && shouldShowFastPlayingHint(proficiencySamples)
      );
      void saveStaffGameProficiencySamples(proficiencySamples).catch(() => {
        toast.error("本局熟练度数据保存失败；本局判分和错题记录不受影响。");
      });
      if (gameModeRef.current === "songs") return;
      const { notes, firstTryCorrect } = summarizeStaffGameWrongNoteOutcomes(
        scoredOutcomes,
        wrongAnswerRecords,
        endedAt
      );
      const run: StaffGameWrongNoteArchiveRun = {
        runId,
        source,
        ...(source === "challenge" ? { gameMode: roundChallengeModeRef.current } : {}),
        level: roundPurpose === "level" ? levelRef.current : null,
        difficulty: settingsRef.current.difficulty,
        inputMode: settingsRef.current.inputMode,
        startedAt: roundStartedAtRef.current,
        endedAt,
        updatedAt: endedAt,
        reviewRange: source === "review" ? roundReviewRangeRef.current : null,
        notePoolScope: roundNotePoolScopeRef.current ?? null,
        noteSchedulingStrategy: roundNoteSchedulingStrategyRef.current,
        responseTimeBasis: "first-correct",
        totalTargets: scoredOutcomes.length,
        firstTryCorrect,
        lowSample: source !== "challenge" && scoredOutcomes.length < 10,
        notes,
      };
      if (source === "review") setSummaryArchiveRun(run);
      pendingWrongNoteArchiveRunsRef.current.push(run);
      const hasErrors = getStaffGameWrongNoteRunErrorCount(run) > 0;
      const shouldAutoArchive =
        source !== "challenge" || settingsRef.current.autoArchiveWrongNotesEnabled;
      if (!hasErrors) {
        summaryArchiveRunIdRef.current = run.runId;
        setSummaryArchiveRunId(run.runId);
        setSummaryArchiveMode("trend");
        setWrongNoteArchiveStatus("saving");
        setWrongNoteArchiveRetryQueued(false);
        void archiveWrongNoteRun(run.runId, "trend");
        return;
      }

      setSummaryArchiveRunId(run.runId);
      setSummaryArchiveRun(run);
      summaryArchiveRunIdRef.current = run.runId;
      setSummaryArchiveDate(localDateKey(run.endedAt));
      if (shouldAutoArchive) {
        setSummaryArchiveMode("automatic");
        void archiveWrongNoteRun(run.runId);
      } else {
        void archiveWrongNoteRun(run.runId, "trend", true);
        setSummaryArchiveMode("manual");
        setWrongNoteArchiveStatus("manual");
        setWrongNoteArchiveRetryQueued(false);
      }
    },
    [
      archiveWrongNoteRun,
      gameModeRef,
      levelRef,
      microphone.diagnostics,
      microphoneAlgorithm,
      microphonePreferences,
      roundPurposeRef,
      settingsRef,
    ]
  );

  const registerComboSoundSuppressionWindow = useCallback(
    (
      suppressedMidiNotes: readonly number[],
      { startAtMs, durationMs }: StaffGameSoundPlaybackTiming
    ): void => {
      if (suppressedMidiNotes.length === 0) return;
      const endAtMs = startAtMs + durationMs + STAFF_GAME_PROMPT_RECOGNITION_TAIL_MS;
      promptSuppressionWindowsRef.current = [
        ...promptSuppressionWindowsRef.current.filter((window) => window.endAtMs > startAtMs),
        {
          endAtMs,
          midiNotes: new Set(suppressedMidiNotes),
          startAtMs,
        },
      ];
      suppressRecognizedNotes(suppressedMidiNotes, startAtMs, endAtMs);
    },
    [suppressRecognizedNotes]
  );

  const playComboFeedback = useCallback(
    (nextCombo: number): void => {
      const promptSound =
        nextCombo === COMBO_EXCELLENT_MILESTONE
          ? "comboExcellent"
          : nextCombo === COMBO_AMAZING_MILESTONE
            ? "comboAmazing"
            : isComboVoiceMilestone(nextCombo)
              ? "comboUnbelievable"
              : null;
      const isMicrophoneInput = settingsRef.current.inputMode === "physical";
      const shouldPlayPrompt =
        promptSound !== null && !(isMicrophoneInput && gameModeRef.current === "songs");
      if (shouldPlayPrompt && promptSound) {
        const suppressedMidiNotes = isMicrophoneInput
          ? staffGamePromptSuppressedMidiNotes(promptSound, microphoneAlgorithm)
          : [];
        playGameSound(promptSound, (timing) =>
          registerComboSoundSuppressionWindow(suppressedMidiNotes, timing)
        );
      }
      if (nextCombo >= 3 && nextCombo % 3 === 0 && !isNearComboVoiceMilestone(nextCombo)) {
        const suppressedMidiNotes = isMicrophoneInput
          ? staffGamePromptSuppressedMidiNotes("comboStreak", microphoneAlgorithm)
          : [];
        playGameSound("comboStreak", (timing) =>
          registerComboSoundSuppressionWindow(suppressedMidiNotes, timing)
        );
      }
    },
    [
      gameModeRef,
      microphoneAlgorithm,
      playGameSound,
      registerComboSoundSuppressionWindow,
      settingsRef,
    ]
  );

  const getPromptSuppressionWindow = useCallback(() => {
    const now = performance.now();
    const windows = promptSuppressionWindowsRef.current.filter((window) => window.endAtMs > now);
    promptSuppressionWindowsRef.current = windows;
    const activeWindows = windows.filter((window) => window.startAtMs <= now);
    if (activeWindows.length === 0) return null;
    return {
      endAtMs: Math.min(...activeWindows.map((window) => window.endAtMs)),
      midiNotes: new Set(activeWindows.flatMap((window) => [...window.midiNotes])),
    };
  }, []);

  const { finishRound, handleRecognizedAnswer } = useStaffGameScoring({
    burstTimeoutRef,
    comboIndicatorFadeTimeoutRef,
    comboIndicatorRef,
    comboRef,
    displayedScoreRef,
    elapsedBeforeRunRef,
    errorFlashTimeoutRef,
    flushScorePresentation,
    gameModeRef,
    roundPurposeRef,
    maxComboRef,
    microphoneStop: microphone.stop,
    nextTargetTimeoutRef,
    noteLabel,
    onSessionActiveChange,
    persistRoundResult,
    persistSongResult,
    phaseRef,
    playComboFeedback,
    playGameSound,
    playfieldRef,
    queueRushScore,
    resetComboDisplay,
    restartComboTimer,
    roundMetricsRef,
    roundFinishedRef,
    rushScoreFlightTokenRef,
    rushScoreFlightsRef,
    runSegmentStartedAtRef,
    sceneRef,
    scoreAnimationTargetRef,
    scoreAnimationTimerRef,
    scoreRef,
    selectedSongIdRef,
    setBubbleBurst,
    setCombo,
    setComboIndicator,
    setEarnedStars,
    setErrorFlashActive,
    setFeedback,
    setMaxCombo,
    setPhase,
    setRushScoreFlights,
    setScore,
    setSongFirstTryHits,
    setSongNotesCompleted,
    setSummaryAccuracy,
    setSummaryWrongAnswerRecords,
    setSummaryIsWrongNoteReview,
    onRoundNoteOutcomes: recordRoundNoteOutcomes,
    setTarget,
    setTargetPopped,
    setTargetWrong,
    settingsRef,
    songFirstTryHitsRef,
    songTargetIndexRef,
    songWrongTargetTokenRef,
    spawnTargetRef,
    targetElementRef,
    targetPoppedRef,
    targetRef,
    targetWrong,
    triggerMascotReaction,
    triggerHitHaptic: triggerStaffGameHitHaptic,
    waitingForNextTargetRef,
    wrongClearTimeoutRef,
    wrongAnswerRecordsRef,
    setDisplayedScoreImmediately,
  });

  useEffect(() => {
    onRegisterAnswerHandler(handleRecognizedAnswer);
    return () => onRegisterAnswerHandler(null);
  }, [handleRecognizedAnswer, onRegisterAnswerHandler]);

  useEffect(
    () =>
      subscribeMidi((event) => {
        if (event.type !== "press") return;
        const noteName = event.note.keyName[0] as NoteName;
        handleRecognizedAnswer({
          diagnosticSampleId: event.note.diagnosticSampleId,
          midiNoteNumber: event.note.midiNoteNumber,
          noteName,
          octave: event.note.octave,
          source: "midi",
        });
      }),
    [handleRecognizedAnswer, subscribeMidi]
  );

  useEffect(() => {
    if (phase !== "summary" || summaryIsWrongNoteReview) {
      setRevealedSummaryStars(0);
      return undefined;
    }

    setRevealedSummaryStars(0);
    let cancelled = false;
    const revealTimeouts = [700, 1200, 1700].map((delay, index) =>
      window.setTimeout(() => {
        if (cancelled) return;
        setRevealedSummaryStars(index + 1);
        void playStarReveal(index, activeAudioSettings.soundEffectsEnabled);
      }, delay)
    );

    return () => {
      cancelled = true;
      revealTimeouts.forEach(window.clearTimeout);
    };
  }, [
    activeAudioSettings.soundEffectsEnabled,
    phase,
    playStarReveal,
    settings.inputMode,
    summaryIsWrongNoteReview,
  ]);

  useEffect(() => {
    if (phase !== "summary") {
      setSummaryScoreCount(0);
      setSummaryComboCount(0);
      return undefined;
    }

    const startedAt = performance.now();
    const durationMs = 900;
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setSummaryScoreCount(Math.round(score * eased));
      setSummaryComboCount(Math.round(maxCombo * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [maxCombo, phase, score]);

  useEffect(() => {
    saveGameSettings(settings);
  }, [settings]);

  useEffect(() => {
    const syncVirtualKeyboardAvailability = (): void => {
      const available = canUseVirtualKeyboard();
      setVirtualKeyboardAvailable(available);
      setTouchGameLayout(prefersTouchGameLayout());
    };
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    syncVirtualKeyboardAvailability();
    window.addEventListener("resize", syncVirtualKeyboardAvailability);
    coarsePointer.addEventListener?.("change", syncVirtualKeyboardAvailability);
    return () => {
      window.removeEventListener("resize", syncVirtualKeyboardAvailability);
      coarsePointer.removeEventListener?.("change", syncVirtualKeyboardAvailability);
    };
  }, []);

  useEffect(() => {
    onSessionActiveChange(phase === "running" || phase === "paused");
  }, [onSessionActiveChange, phase]);

  useEffect(() => {
    if (phase === "paused" && comboTimerStartedAtRef.current !== null) {
      comboTimerRemainingRef.current = Math.max(
        0,
        comboTimerRemainingRef.current - (performance.now() - comboTimerStartedAtRef.current)
      );
      clearComboTimer();
      return;
    }

    if (
      phase !== "running" ||
      !comboIndicator ||
      comboIndicator.isFadingOut ||
      comboResetTimeoutRef.current !== null
    )
      return;
    const remainingMs = comboTimerRemainingRef.current;
    if (remainingMs <= 0) {
      resetComboDisplay();
      return;
    }
    comboTimerStartedAtRef.current = performance.now();
    comboResetTimeoutRef.current = window.setTimeout(resetComboDisplay, remainingMs);
  }, [clearComboTimer, comboIndicator, phase, resetComboDisplay]);

  useEffect(() => {
    if (phase === "paused" && scoreAnimationTimerRef.current !== null) {
      window.clearTimeout(scoreAnimationTimerRef.current);
      scoreAnimationTimerRef.current = null;
      return;
    }
    if (
      phase === "running" &&
      scoreAnimationTimerRef.current === null &&
      scoreAnimationTargetRef.current > displayedScoreRef.current
    ) {
      scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
    }
  }, [advanceRushScore, phase]);

  useEffect(
    () => () => {
      startAttemptRef.current += 1;
      isStartingRef.current = false;
      stopMicrophone();
      onSessionActiveChange(false);
      if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
      if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
      if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
      if (comboResetTimeoutRef.current !== null) window.clearTimeout(comboResetTimeoutRef.current);
      if (comboIndicatorFadeTimeoutRef.current !== null)
        window.clearTimeout(comboIndicatorFadeTimeoutRef.current);
      if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
      if (scoreAnimationTimerRef.current !== null)
        window.clearTimeout(scoreAnimationTimerRef.current);
    },
    [onSessionActiveChange, stopMicrophone]
  );

  const { pauseRunSegment, spawnTarget, startRunSegment } = useStaffGameRoundClock({
    activeBubbleDurationMs,
    elapsedBeforeRunRef,
    finishRound,
    getPromptSuppressionWindow,
    gameDurationMs,
    gameModeRef,
    challengeModeRef: roundChallengeModeRef,
    roundPurposeRef,
    wrongNoteReviewDurationMsRef: roundReviewDurationMsRef,
    inputMode: settings.inputMode,
    levelRef,
    noteBagRef,
    notePoolScopeRef,
    noteSchedulingStrategyRef,
    noteLabel,
    nextTargetTimeoutRef,
    phase,
    phaseRef,
    playGameSound,
    setWrongNoteReviewTimedOut: setSummaryWrongNoteReviewTimedOut,
    playfieldRef,
    recentNoteMidisRef,
    roundMetricsRef,
    resetComboDisplay,
    runSegmentStartedAtRef,
    selectedSongIdRef,
    setElapsedMs,
    setFeedback,
    setSongNotesCompleted,
    setTarget,
    setTargetPopped,
    setTargetWrong,
    songTargetIndexRef,
    songWrongTargetTokenRef,
    targetPoppedRef,
    targetRef,
    targetTokenRef,
    triggerMascotReaction,
    waitingForNextTargetRef,
  });
  spawnTargetRef.current = spawnTarget;

  const resetRoundState = useCallback((): void => {
    promptSuppressionWindowsRef.current = [];
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    nextTargetTimeoutRef.current = null;
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    wrongClearTimeoutRef.current = null;
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = null;
    waitingForNextTargetRef.current = false;
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    errorFlashTimeoutRef.current = null;
    setErrorFlashActive(false);
    setMascotReaction((current) => ({
      action: "idle",
      token: current.token + 1,
      queuedAction: null,
    }));
    targetRef.current = null;
    targetPoppedRef.current = false;
    noteBagRef.current = [];
    roundReviewQuestionCountRef.current = 0;
    roundReviewDurationMsRef.current = 0;
    recentNoteMidisRef.current = [];
    roundFinishedRef.current = false;
    roundMetricsRef.current = createRoundMetrics();
    setTarget(null);
    setBubbleBurst(null);
    setTargetPopped(false);
    setTargetWrong(false);
    setScore(0);
    scoreRef.current = 0;
    flushScorePresentation(0);
    setEarnedStars(0);
    setSummaryScoreCount(0);
    setSummaryComboCount(0);
    setSummaryAveragePlayerResponseMs(null);
    setSummaryFastPlayingHint(false);
    setSummaryWrongAnswerRecords([]);
    setSummaryWeakNoteOutcomes([]);
    setSummaryIsWrongNoteReview(false);
    setSummaryWrongNoteReviewTimedOut(false);
    setSummaryArchiveRunId(null);
    setSummaryArchiveRun(null);
    summaryArchiveRunIdRef.current = null;
    setSummaryArchiveDate(null);
    setSummaryArchiveMode(null);
    setWrongNoteArchiveStatus("idle");
    setWrongNoteArchiveRetryQueued(false);
    roundPurposeRef.current = "level";
    roundNotePoolScopeRef.current = null;
    roundNoteSchedulingStrategyRef.current = undefined;
    wrongAnswerRecordsRef.current = [];
    clearComboDisplay();
    setMaxCombo(0);
    maxComboRef.current = 0;
    setElapsedMs(0);
    elapsedBeforeRunRef.current = 0;
    setFeedback("");
    setGameError("");
    songTargetIndexRef.current = 0;
    songFirstTryHitsRef.current = 0;
    songWrongTargetTokenRef.current = null;
    setSongNotesCompleted(0);
    setSongFirstTryHits(0);
    setSummaryAccuracy(0);
  }, [clearComboDisplay, flushScorePresentation]);

  const connectMidiForRound = useCallback(async (isCancelled: () => boolean): Promise<boolean> => {
    if (isCancelled()) return false;
    const controller = midiRef.current;
    if (!supportsMidi(controller.status)) {
      setGameError("当前环境不支持 MIDI 输入，请改用麦克风或虚拟琴键。");
      return false;
    }
    await controller.connect();
    if (isCancelled()) return false;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    if (isCancelled()) return false;
    const latest = midiRef.current;
    if (latest.status !== "ready") {
      setGameError(latest.errorMessage ?? "MIDI 连接失败，请检查浏览器权限后重试。");
      return false;
    }
    if (!latest.isConnected) {
      setGameError("没有检测到 MIDI 输入设备，请连接 MIDI 键盘后重试。");
      return false;
    }
    return true;
  }, []);

  const beginRound = useCallback(
    async (
      purpose: StaffGameRoundPurpose = "level",
      reviewNotes?: readonly StaffGamePitch[]
    ): Promise<boolean> => {
      if (resourceLoadState !== "ready") return false;
      if (isStartingRef.current) return false;
      const attemptId = startAttemptRef.current + 1;
      startAttemptRef.current = attemptId;
      const isCancelled = (): boolean => attemptId !== startAttemptRef.current;
      isStartingRef.current = true;
      setIsStarting(true);
      setGameError("");
      try {
        const inputModeAtStart = settingsRef.current.inputMode;
        const microphoneStartPromise =
          inputModeAtStart === "physical"
            ? startMicrophone({ includeAccidentals: true })
            : Promise.resolve(false);
        const audioUnlockPromise = unlockGameAudio().catch(() => undefined);
        if (inputModeAtStart === "physical") {
          let started = false;
          try {
            const [microphoneStarted] = await Promise.all([
              microphoneStartPromise,
              audioUnlockPromise,
            ]);
            started = microphoneStarted;
          } catch (error) {
            if (isCancelled()) return false;
            const reason = error instanceof Error ? `（${error.message}）` : "";
            setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
            return false;
          }
          if (isCancelled()) {
            stopMicrophone();
            return false;
          }
          if (!started) {
            const reason = microphoneError ? `（${microphoneError}）` : "";
            setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
            return false;
          }
        } else {
          await audioUnlockPromise;
          if (isCancelled()) return false;
          if (inputModeAtStart === "midi") {
            if (!(await connectMidiForRound(isCancelled))) return false;
            if (isCancelled()) return false;
            stopMicrophone();
          } else {
            stopMicrophone();
          }
        }
        if (isCancelled()) return false;
        const records = progressRef.current;
        const levelIndex = levelRef.current - 1;
        if (gameModeRef.current === "songs") {
          const record =
            songProgressRef.current[selectedSongIdRef.current]?.[settingsRef.current.difficulty];
          roundRecordsAtStartRef.current = {
            score: record?.bestScore ?? 0,
            maxCombo: record?.maxCombo ?? 0,
          };
        } else {
          const arcadeRecords = records.modes.arcade;
          const shouldCompareArcadeRecords =
            purpose === "level" && settingsRef.current.challengeMode === "arcade";
          roundRecordsAtStartRef.current = {
            score: shouldCompareArcadeRecords ? (arcadeRecords.bestScores[levelIndex] ?? 0) : 0,
            maxCombo: shouldCompareArcadeRecords ? (arcadeRecords.maxCombos[levelIndex] ?? 0) : 0,
          };
        }
        resetRoundState();
        roundStartedAtRef.current = new Date().toISOString();
        roundPurposeRef.current = purpose;
        roundChallengeModeRef.current =
          purpose === "level" && gameModeRef.current === "levels"
            ? settingsRef.current.challengeMode
            : "learning";
        setSummaryChallengeMode(roundChallengeModeRef.current);
        if (purpose === "wrong-note-review") {
          const preparedNotes = reviewNotes ?? [];
          roundReviewQuestionCountRef.current = preparedNotes.length;
          roundReviewDurationMsRef.current = staffGameWrongNoteReviewDurationMs(
            preparedNotes.length,
            gameDifficultyPreset(settingsRef.current.difficulty).bubbleDurationMs
          );
          noteBagRef.current = preparedNotes.map((note) => ({ ...note }));
        } else if (
          purpose === "level" &&
          gameModeRef.current === "levels" &&
          roundChallengeModeRef.current === "learning"
        ) {
          noteBagRef.current = learningTestNoteBag(
            levelRef.current,
            settingsRef.current.notePoolScope
          );
          roundMetricsRef.current.targetQuestionCount = noteBagRef.current.length;
        }
        roundNotePoolScopeRef.current =
          purpose === "wrong-note-review" ? null : settingsRef.current.notePoolScope;
        roundNoteSchedulingStrategyRef.current =
          purpose === "wrong-note-review"
            ? "review-weighted"
            : roundChallengeModeRef.current === "arcade"
              ? "random"
              : settingsRef.current.noteSchedulingStrategy;
        startRunSegment();
        setFeedback(
          purpose === "wrong-note-review"
            ? "错题音会更常出现，也会穿插其他已解锁音"
            : gameModeRef.current === "songs"
              ? "按旋律顺序弹奏；答错可重试，漏音后会继续"
              : settingsRef.current.inputMode === "virtual"
                ? "点击琴键，弹出对应音符"
                : settingsRef.current.inputMode === "midi"
                  ? "弹奏 MIDI 键盘，弹出对应音符"
                  : "聆听麦克风，弹出对应音符"
        );
        phaseRef.current = "running";
        setPhase("running");
        spawnTarget(0);
        return true;
      } catch (error) {
        if (isCancelled()) return false;
        const reason = error instanceof Error ? `（${error.message}）` : "";
        setGameError(`游戏准备失败${reason}。请检查设备后重试。`);
        return false;
      } finally {
        if (!isCancelled()) {
          isStartingRef.current = false;
          setIsStarting(false);
        }
      }
    },
    [
      connectMidiForRound,
      microphoneError,
      resetRoundState,
      resourceLoadState,
      roundPurposeRef,
      spawnTarget,
      startMicrophone,
      startRunSegment,
      stopMicrophone,
      unlockGameAudio,
    ]
  );

  const cancelPendingStart = useCallback((): void => {
    if (!isStartingRef.current) return;
    startAttemptRef.current += 1;
    isStartingRef.current = false;
    setIsStarting(false);
    stopMicrophone();
  }, [stopMicrophone]);

  const pauseRound = useCallback((): void => {
    if (phaseRef.current !== "running") return;
    const elapsed = pauseRunSegment();
    setElapsedMs(elapsed);
    if (
      roundPurposeRef.current === "wrong-note-review" &&
      roundReviewDurationMsRef.current > 0 &&
      elapsed >= roundReviewDurationMsRef.current
    ) {
      setElapsedMs(roundReviewDurationMsRef.current);
      setSummaryWrongNoteReviewTimedOut(true);
      finishRound();
      return;
    }
    setMascotReaction((current) => ({
      action: "idle",
      token: current.token + 1,
      queuedAction: null,
    }));
    phaseRef.current = "paused";
    setPhase("paused");
    setFeedback(gameModeRef.current === "songs" ? "演奏已暂停" : "闯关已暂停");
    stopMicrophone();
  }, [
    finishRound,
    pauseRunSegment,
    roundPurposeRef,
    setSummaryWrongNoteReviewTimedOut,
    stopMicrophone,
  ]);

  useEffect(() => {
    if (phase !== "running" || !settings.gameEffectsEnabled || showLowFpsPrompt) return undefined;
    let frame = 0;
    let sampledFrames = 0;
    let lowFpsWindows = 0;
    let sampleStartedAt = performance.now();
    const alreadyPrompted = (): boolean => {
      if (lowFpsPromptedRef.current || lowFpsPromptShownThisPage) return true;
      try {
        return window.sessionStorage.getItem(LOW_FPS_PROMPT_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    };
    const tick = (now: number): void => {
      sampledFrames += 1;
      const sampleDuration = now - sampleStartedAt;
      if (sampleDuration >= 1_500) {
        const fps = (sampledFrames * 1000) / sampleDuration;
        lowFpsWindows = fps < 28 ? lowFpsWindows + 1 : 0;
        sampledFrames = 0;
        sampleStartedAt = now;
        if (lowFpsWindows >= 2 && !alreadyPrompted()) {
          lowFpsPromptedRef.current = true;
          lowFpsPromptShownThisPage = true;
          try {
            window.sessionStorage.setItem(LOW_FPS_PROMPT_SESSION_KEY, "1");
          } catch {
            // The ref still prevents repeats until this game view unmounts.
          }
          setShowLowFpsPrompt(true);
          pauseRound();
          return;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [pauseRound, phase, settings.gameEffectsEnabled, showLowFpsPrompt]);

  useEffect(() => {
    const unavailableMode =
      settings.inputMode === "virtual" && !virtualKeyboardAvailable
        ? "virtual"
        : settings.inputMode === "midi" && !supportsMidi(midi.status)
          ? "midi"
          : null;
    if (!unavailableMode) return;

    const wasRunning = phaseRef.current === "running";
    const wasPaused = phaseRef.current === "paused";
    const fallbackSettings = { ...settingsRef.current, inputMode: "physical" as const };
    settingsRef.current = fallbackSettings;
    setSettings(fallbackSettings);
    setSettingsDraft((current) =>
      current.inputMode === unavailableMode ? { ...current, inputMode: "physical" } : current
    );
    if (wasRunning) pauseRound();
    if (wasRunning || wasPaused) {
      setGameError(
        unavailableMode === "virtual"
          ? "虚拟琴键已不可用，闯关已暂停并切换为麦克风输入。点击继续后重新连接麦克风。"
          : "MIDI 输入已不可用，闯关已暂停并切换为麦克风输入。点击继续后重新连接麦克风。"
      );
    }
  }, [midi.status, pauseRound, settings.inputMode, virtualKeyboardAvailable]);

  useEffect(() => {
    if (phase === "running" && settings.inputMode === "physical" && microphone.status === "error") {
      setGameError(microphone.error ?? "麦克风连接中断，闯关已暂停。");
      pauseRound();
    }
  }, [microphone.error, microphone.status, pauseRound, phase, settings.inputMode]);

  useEffect(() => {
    if (phase !== "running" || settings.inputMode !== "physical") return;
    const diagnostics = microphone.diagnostics;
    const currentTarget = targetRef.current;
    if (!diagnostics || !currentTarget) return;
    const alternativeCandidateMidi =
      diagnostics.alternativeCandidateFrequencyHz !== null &&
      diagnostics.alternativeCandidateFrequencyHz > 0
        ? Math.round(69 + 12 * Math.log2(diagnostics.alternativeCandidateFrequencyHz / 440))
        : null;
    const observationKey = [
      currentTarget.token,
      diagnostics.algorithm,
      diagnostics.candidateNote,
      diagnostics.outcome,
      diagnostics.ambiguous,
      alternativeCandidateMidi,
      diagnostics.lastRecognizedAtMs,
      diagnostics.lastRecognizedMidi,
    ].join("|");
    if (lastLoggedMicrophoneObservationRef.current === observationKey) return;
    lastLoggedMicrophoneObservationRef.current = observationKey;
    appendStaffGameMicrophoneDebugEvent("observation", {
      game: {
        inputMode: settings.inputMode,
        level,
        mode: gameMode,
        notePoolScope: settings.notePoolScope,
      },
      target: {
        frequencyHz: 440 * 2 ** ((currentTarget.midi - 69) / 12),
        midi: currentTarget.midi,
        note: noteLabel(currentTarget),
        token: currentTarget.token,
      },
      microphone: {
        algorithm: diagnostics.algorithm,
        ambiguous: diagnostics.ambiguous,
        alternativeCandidateConfidence: diagnostics.alternativeCandidateConfidence,
        alternativeCandidateFrequencyHz: diagnostics.alternativeCandidateFrequencyHz,
        analysisRms: diagnostics.analysisRms,
        candidateConfidence: diagnostics.candidateConfidence,
        candidateFrequencyHz: diagnostics.candidateFrequencyHz,
        candidateNote: diagnostics.candidateNote,
        detectedNote: microphone.detectedNote,
        detectorDisagreement: diagnostics.detectorDisagreement,
        includeAccidentals: diagnostics.includeAccidentals,
        inputLevel: microphone.inputLevel,
        inputRms: diagnostics.inputRms,
        inputRmsThreshold: diagnostics.inputRmsThreshold,
        lastRecognizedMidi: diagnostics.lastRecognizedMidi,
        lastRecognizedNote: diagnostics.lastRecognizedNote,
        outcome: diagnostics.outcome,
        requiredStableFrames: diagnostics.requiredStableFrames,
        requiredStableMs: diagnostics.requiredStableMs,
        confidenceThreshold: diagnostics.confidenceThreshold,
        audioContextSampleRate: diagnostics.audioContextSampleRate,
        trackSampleRate: diagnostics.trackSampleRate,
      },
    });
  }, [
    microphone.detectedNote,
    microphone.diagnostics,
    microphone.inputLevel,
    gameMode,
    level,
    phase,
    settings.inputMode,
    settings.notePoolScope,
  ]);

  useEffect(() => {
    if (
      phase === "running" &&
      settings.inputMode === "midi" &&
      (!supportsMidi(midi.status) || !midi.isConnected)
    ) {
      setGameError(midi.errorMessage ?? "MIDI 键盘连接中断，闯关已暂停。");
      pauseRound();
    }
  }, [
    midi.errorMessage,
    midi.isConnected,
    midi.status,
    pauseRound,
    phase,
    settings.inputMode,
    virtualKeyboardAvailable,
  ]);

  useEffect(() => {
    if (phase !== "running" && phase !== "paused") return undefined;
    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        if (phaseRef.current === "running") pauseRound();
        return;
      }
      // Browsers may suspend Web Audio while this page is in the background.
      // Try to resume it on return; resumeRound retries synchronously from the
      // user's gesture if the browser still requires one.
      void unlockGameAudio().catch(() => undefined);
    };
    const pauseWhenWindowLosesFocus = (): void => {
      if (phaseRef.current === "running") pauseRound();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", pauseWhenWindowLosesFocus);
    window.addEventListener("pagehide", pauseWhenWindowLosesFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", pauseWhenWindowLosesFocus);
      window.removeEventListener("pagehide", pauseWhenWindowLosesFocus);
    };
  }, [pauseRound, phase, unlockGameAudio]);

  const resumeRound = useCallback(async (): Promise<void> => {
    if (isStartingRef.current || phaseRef.current !== "paused") return;
    const attemptId = startAttemptRef.current + 1;
    startAttemptRef.current = attemptId;
    const isCancelled = (): boolean => attemptId !== startAttemptRef.current;
    isStartingRef.current = true;
    setIsStarting(true);
    setGameError("");
    try {
      // Resume the Web Audio context in the click/key gesture, before input
      // reconnection awaits can outlive the browser's activation window.
      void unlockGameAudio().catch(() => undefined);
      if (settingsRef.current.inputMode === "physical") {
        let started = false;
        try {
          started = await startMicrophone({ includeAccidentals: true });
        } catch (error) {
          if (isCancelled()) return;
          const reason = error instanceof Error ? `（${error.message}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
        if (isCancelled()) {
          stopMicrophone();
          return;
        }
        if (!started) {
          const reason = microphoneError ? `（${microphoneError}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
      } else if (settingsRef.current.inputMode === "midi") {
        if (!(await connectMidiForRound(isCancelled))) return;
        if (isCancelled()) return;
        stopMicrophone();
      } else {
        stopMicrophone();
      }
      if (isCancelled() || phaseRef.current !== "paused") return;
      startRunSegment();
      phaseRef.current = "running";
      setPhase("running");
      setFeedback(
        gameModeRef.current === "songs"
          ? "继续按旋律顺序弹奏"
          : settingsRef.current.inputMode === "midi"
            ? "继续弹奏 MIDI 键盘"
            : "继续识别，弹奏气泡音符"
      );
      if (waitingForNextTargetRef.current && !targetRef.current) {
        waitingForNextTargetRef.current = false;
        const activeSong =
          gameModeRef.current === "songs"
            ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current)
            : undefined;
        if (activeSong && songTargetIndexRef.current >= activeSong.noteMidis.length) finishRound();
        else spawnTarget(elapsedBeforeRunRef.current);
      }
    } catch (error) {
      if (isCancelled()) return;
      const reason = error instanceof Error ? `（${error.message}）` : "";
      setGameError(`输入设备恢复失败${reason}。请检查设备后重试。`);
    } finally {
      if (!isCancelled()) {
        isStartingRef.current = false;
        setIsStarting(false);
      }
    }
  }, [
    connectMidiForRound,
    finishRound,
    microphoneError,
    spawnTarget,
    startMicrophone,
    startRunSegment,
    stopMicrophone,
    unlockGameAudio,
  ]);

  const exitGame = useCallback((): void => {
    cancelPendingStart();
    stopMicrophone();
    onSessionActiveChange(false);
    wrongNoteReviewDifficultyOverrideRef.current = null;
    settingsRef.current = settings;
    onExit();
  }, [
    cancelPendingStart,
    onExit,
    onSessionActiveChange,
    settings,
    settingsRef,
    stopMicrophone,
    wrongNoteReviewDifficultyOverrideRef,
  ]);

  const returnToReady = useCallback((): void => {
    cancelPendingStart();
    stopMicrophone();
    onSessionActiveChange(false);
    resetRoundState();
    wrongNoteReviewDifficultyOverrideRef.current = null;
    settingsRef.current = settings;
    setDialog(null);
    if (gameModeRef.current === "songs") setSongSelectionStep("detail");
    phaseRef.current = "ready";
    setPhase("ready");
  }, [
    cancelPendingStart,
    onSessionActiveChange,
    resetRoundState,
    settings,
    settingsRef,
    stopMicrophone,
    wrongNoteReviewDifficultyOverrideRef,
  ]);

  const exitWrongNoteReview = useCallback((): void => {
    if (roundPurposeRef.current !== "wrong-note-review") return;
    cancelPendingStart();
    stopMicrophone();
    onSessionActiveChange(false);
    resetRoundState();
    wrongNoteReviewDifficultyOverrideRef.current = null;
    settingsRef.current = settings;
    gameModeRef.current = "levels";
    setGameMode("levels");
    setSongSelectionStep(null);
    setReadyWrongNoteMode("level");
    setDialog(null);
    phaseRef.current = "ready";
    setPhase("ready");
  }, [
    cancelPendingStart,
    onSessionActiveChange,
    resetRoundState,
    settings,
    settingsRef,
    stopMicrophone,
    wrongNoteReviewDifficultyOverrideRef,
  ]);

  const handleExitWrongNoteReview = useCallback((): void => {
    if (
      roundPurposeRef.current !== "wrong-note-review" ||
      (phaseRef.current !== "running" && phaseRef.current !== "paused")
    )
      return;
    exitWrongNoteReview();
  }, [exitWrongNoteReview, phaseRef, roundPurposeRef]);

  const retryLevel = useCallback((): void => {
    if (roundPurposeRef.current === "wrong-note-review") {
      const retryPlan = buildStaffGameWrongNoteReviewPlan(
        wrongNoteReviewCandidateNotes,
        wrongNoteReviewWeights,
        getStaffGameWrongNoteMasteredMidis(wrongNoteReviewSourceArchives)
      );
      void beginRound("wrong-note-review", retryPlan.notes);
    } else {
      void beginRound();
    }
  }, [
    beginRound,
    wrongNoteReviewCandidateNotes,
    wrongNoteReviewSourceArchives,
    wrongNoteReviewWeights,
  ]);

  const closeChallengeSummary = useCallback((): void => {
    if (phaseRef.current !== "summary" || gameModeRef.current !== "levels") return;
    if (roundPurposeRef.current !== "level") return;
    resetRoundState();
    setReadyWrongNoteMode("level");
    setDialog(null);
    phaseRef.current = "ready";
    setPhase("ready");
  }, [resetRoundState]);

  const startWrongNoteReview = useCallback((): void => {
    if (wrongNoteReviewWeights.size === 0) return;
    wrongNoteReviewDifficultyOverrideRef.current =
      selectedWrongNoteReviewCondition?.difficulty ?? null;
    settingsRef.current = wrongNoteReviewDifficultyOverrideRef.current
      ? { ...settings, difficulty: wrongNoteReviewDifficultyOverrideRef.current }
      : settings;
    setReadyWrongNoteMode("review");
    roundReviewRangeRef.current = wrongNoteReviewRange;
    void beginRound("wrong-note-review", wrongNoteReviewPlan.notes);
  }, [
    beginRound,
    selectedWrongNoteReviewCondition,
    settings,
    settingsRef,
    wrongNoteReviewDifficultyOverrideRef,
    wrongNoteReviewPlan.notes,
    wrongNoteReviewRange,
    wrongNoteReviewWeights,
  ]);

  const handleWrongNoteReviewRangeChange = useCallback((range: StaffGameWrongNoteRange): void => {
    setWrongNoteReviewRange(range);
    setWrongNoteReviewConditionId("all-learning");
  }, []);

  const startLevel = useCallback(async (): Promise<void> => {
    wrongNoteReviewDifficultyOverrideRef.current = null;
    settingsRef.current = settings;
    if (isNightmareLandscapePromptPendingRef.current) return;
    const isIPadPortrait =
      isIPadDevice() &&
      typeof window !== "undefined" &&
      window.matchMedia("(orientation: portrait)").matches;
    const shouldPrompt =
      isIPadPortrait &&
      gameModeRef.current === "levels" &&
      readyWrongNoteMode === "level" &&
      settingsRef.current.difficulty === "nightmare" &&
      shouldShowNightmareLandscapePrompt();

    if (shouldPrompt) {
      isNightmareLandscapePromptPendingRef.current = true;
      try {
        const shouldStart = await confirmDialog({
          cancelLabel: "暂不开始",
          confirmLabel: "继续开始",
          description: "噩梦模式下音符下落较快，横屏游玩更容易看清音符～",
          title: "噩梦模式提示",
        });
        if (!shouldStart) return;
      } finally {
        isNightmareLandscapePromptPendingRef.current = false;
      }
      snoozeNightmareLandscapePrompt();
    }

    await beginRound();
  }, [beginRound, confirmDialog, readyWrongNoteMode, settings]);

  const openWrongNoteStudyDialog = useCallback((): void => {
    setWrongNoteStudyRange((current) => current ?? wrongNoteReviewRange);
    setIsWrongNoteStudyDialogOpen(true);
  }, [wrongNoteReviewRange]);

  const closeWrongNoteStudyDialog = useCallback((): void => {
    setIsWrongNoteStudyDialogOpen(false);
  }, []);

  const openWrongNoteArchiveManager = useCallback((): void => {
    setWrongNoteArchiveManagerRange(wrongNoteReviewRange);
    setIsWrongNoteArchiveManagerOpen(true);
    void restoreStaffGameWrongNoteArchiveResponseTimes()
      .then((archives) => setWrongNoteArchives(archives))
      .catch(() => undefined);
  }, [wrongNoteReviewRange]);

  const closeWrongNoteArchiveManager = useCallback((): void => {
    setIsWrongNoteArchiveManagerOpen(false);
  }, []);

  const advanceLevel = useCallback(
    (nextLevel: number): void => {
      const clamped = Math.max(1, Math.min(GAME_LEVEL_COUNT, nextLevel));
      const nextProgress = {
        ...progressRef.current,
        unlockedLevel: Math.max(progressRef.current.unlockedLevel, clamped),
        selectedLevel: clamped,
      };
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      saveProgress(nextProgress);
      setLevel(clamped);
      levelRef.current = clamped;
      void beginRound();
    },
    [beginRound]
  );

  const jumpToLevel = useCallback(
    (selectedLevel: number): void => {
      if (isStartingRef.current) return;
      const clamped = Math.max(1, Math.min(GAME_LEVEL_COUNT, selectedLevel));
      const nextProgress = { ...progressRef.current, selectedLevel: clamped };
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      saveProgress(nextProgress);
      setLevel(clamped);
      levelRef.current = clamped;
      void beginRound().then((started) => {
        if (started) setDialog(null);
      });
    },
    [beginRound]
  );

  const selectSong = useCallback((songId: string): void => {
    if (!STAFF_GAME_SONGS.some((song) => song.id === songId)) return;
    selectedSongIdRef.current = songId;
    setSelectedSongId(songId);
    setSongSelectionStep("detail");
  }, []);

  const startSelectedSong = useCallback((): void => {
    const song = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
    if (!song) return;
    gameModeRef.current = "songs";
    setGameMode("songs");
    void beginRound().then((started) => {
      if (!started) return;
      setSongSelectionStep(null);
      onSongStart(song.id);
    });
  }, [beginRound, onSongStart]);

  const returnToSongList = useCallback((): void => {
    cancelPendingStart();
    stopMicrophone();
    onSessionActiveChange(false);
    resetRoundState();
    phaseRef.current = "ready";
    setPhase("ready");
    setSongSelectionStep("list");
    onModeChange("songs");
  }, [cancelPendingStart, onModeChange, onSessionActiveChange, resetRoundState, stopMicrophone]);

  const handleSongSelectionBack = useCallback((): void => {
    cancelPendingStart();
    if (gameMode !== "songs") {
      if (phase === "ready" && !isStarting) exitGame();
      else returnToReady();
    } else if (isSongPlayRoute) {
      returnToSongList();
    } else if (songSelectionStep === "detail") {
      setSongSelectionStep("list");
    } else {
      onSongSelectionExit();
    }
  }, [
    cancelPendingStart,
    exitGame,
    gameMode,
    isStarting,
    isSongPlayRoute,
    onSongSelectionExit,
    phase,
    returnToReady,
    returnToSongList,
    songSelectionStep,
  ]);

  useEffect(() => {
    const wasSongPlayRoute = previousSongPlayRouteRef.current;
    previousSongPlayRouteRef.current = isSongPlayRoute;
    if (gameMode !== "songs") return;

    if (wasSongPlayRoute && !isSongPlayRoute) {
      if (
        phaseRef.current === "running" ||
        phaseRef.current === "paused" ||
        phaseRef.current === "summary"
      ) {
        returnToSongList();
      }
      return;
    }

    if (!wasSongPlayRoute && isSongPlayRoute) {
      const routeSong = STAFF_GAME_SONGS.find((song) => song.id === initialSongId);
      if (routeSong) {
        selectedSongIdRef.current = routeSong.id;
        setSelectedSongId(routeSong.id);
      }
      if (
        phaseRef.current !== "running" &&
        phaseRef.current !== "paused" &&
        phaseRef.current !== "summary"
      ) {
        phaseRef.current = "ready";
        setPhase("ready");
        setSongSelectionStep("detail");
      }
    }
  }, [gameMode, initialSongId, isSongPlayRoute, returnToSongList]);

  const playNextSong = useCallback((): void => {
    const currentIndex = STAFF_GAME_SONGS.findIndex(
      (song) => song.id === selectedSongIdRef.current
    );
    const nextSong = STAFF_GAME_SONGS[currentIndex + 1];
    if (!nextSong) {
      returnToSongList();
      return;
    }
    selectedSongIdRef.current = nextSong.id;
    setSelectedSongId(nextSong.id);
    phaseRef.current = "ready";
    setPhase("ready");
    void beginRound().then((started) => {
      if (started) onSongStart(nextSong.id);
    });
  }, [beginRound, onSongStart, returnToSongList]);

  const openGameDialog = useCallback(
    (nextDialog: Exclude<GameDialog, null>): void => {
      if (phaseRef.current === "running") pauseRound();
      setIsWrongNoteNoticeOpen(false);
      setIsUnsavedSettingsPromptOpen(false);
      setSettingsDraft(settings);
      setDialog(nextDialog);
    },
    [pauseRound, settings]
  );

  const closeGameDialog = useCallback((): void => {
    if (isStartingRef.current) return;
    if (isUnsavedSettingsPromptOpen) {
      setIsUnsavedSettingsPromptOpen(false);
      return;
    }
    if (isWrongNoteNoticeOpen) {
      setIsWrongNoteNoticeOpen(false);
      return;
    }
    if (dialog === "settings" && !areStaffGameSettingsEqual(settingsDraft, settings)) {
      setIsUnsavedSettingsPromptOpen(true);
      return;
    }
    setDialog(null);
  }, [dialog, isUnsavedSettingsPromptOpen, isWrongNoteNoticeOpen, settings, settingsDraft]);

  const discardUnsavedGameSettings = useCallback((): void => {
    if (isStartingRef.current) return;
    setSettingsDraft(settings);
    setIsUnsavedSettingsPromptOpen(false);
    setDialog(null);
  }, [settings]);

  const selectInputMode = useCallback((inputMode: StaffGameSettings["inputMode"]): void => {
    setSettingsDraft((current) => ({ ...current, inputMode }));
  }, []);

  const updateReadyInputMode = useCallback(
    (inputMode: GameInputMode): void => {
      if (inputMode === "virtual" && !virtualKeyboardAvailable) return;
      if (inputMode === "midi" && !supportsMidi(midi.status)) return;

      const nextSettings = { ...settingsRef.current, inputMode };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsDraft((current) => ({ ...current, inputMode }));
      saveGameSettings(nextSettings);
      if (inputMode !== "physical") stopMicrophone();
    },
    [midi.status, stopMicrophone, virtualKeyboardAvailable]
  );

  const updateReadyChallengeSettings = useCallback(
    (
      patch: Partial<
        Pick<StaffGameSettings, "challengeMode" | "arcadeDuration" | "difficulty" | "notePoolScope">
      >
    ): void => {
      const current = settingsRef.current;
      const nextSettings = { ...current, ...patch };
      if (patch.notePoolScope && patch.notePoolScope !== current.notePoolScope) {
        noteBagRef.current = [];
        notePoolScopeRef.current = patch.notePoolScope;
      }
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsDraft((draft) => ({ ...draft, ...patch }));
      saveGameSettings(nextSettings);
    },
    []
  );

  const applyGameSettings = useCallback((): void => {
    const midiAvailable = supportsMidi(midi.status);
    const nextSettings: StaffGameSettings = {
      ...settingsDraft,
      inputMode:
        settingsDraft.inputMode === "virtual" && virtualKeyboardAvailable
          ? "virtual"
          : settingsDraft.inputMode === "midi" && midiAvailable
            ? "midi"
            : "physical",
      difficulty: GAME_DIFFICULTIES.some((item) => item.id === settingsDraft.difficulty)
        ? settingsDraft.difficulty
        : "normal",
    };
    if (
      nextSettings.notePoolScope !== settingsRef.current.notePoolScope ||
      nextSettings.noteSchedulingStrategy !== settingsRef.current.noteSchedulingStrategy
    ) {
      noteBagRef.current = [];
    }
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setGameSoundsEnabled(nextSettings.audioByMode[gameMode].soundEffectsEnabled);
    if (nextSettings.inputMode === "virtual") stopMicrophone();
    setSettingsDraft(nextSettings);
    setIsWrongNoteNoticeOpen(false);
    setIsUnsavedSettingsPromptOpen(false);
    setDialog(null);
  }, [
    gameMode,
    midi.status,
    noteBagRef,
    settingsDraft,
    setGameSoundsEnabled,
    stopMicrophone,
    virtualKeyboardAvailable,
  ]);

  const handleVirtualKey = useCallback(
    (
      pitch: PianoKeyName,
      source: "screen-keyboard" | "computer-keyboard" = "screen-keyboard"
    ): void => {
      if (phaseRef.current !== "running") return;
      if (
        settingsRef.current.inputMode === "virtual" &&
        settingsRef.current.audioByMode[gameModeRef.current].pianoSoundEnabled
      ) {
        void playVirtualPianoNote(pitch, 4).catch(() => undefined);
      }
      const pitchClass = PITCH_NAMES.indexOf(pitch);
      handleRecognizedAnswer({
        noteName: pitch[0] as NoteName,
        octave: 4,
        midiNoteNumber: 60 + pitchClass,
        source,
      });
    },
    [handleRecognizedAnswer, playVirtualPianoNote]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isEditableTarget =
        target instanceof Element &&
        Boolean(
          target.closest("input, select, textarea, [contenteditable='true'], [role='dialog']")
        );
      const shortcutPitch = COMPUTER_KEY_PITCHES[event.code];
      if (
        shortcutPitch &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !dialog &&
        !isEditableTarget &&
        settingsRef.current.inputMode === "virtual" &&
        phaseRef.current === "running"
      ) {
        event.preventDefault();
        handleVirtualKey(shortcutPitch, "computer-keyboard");
        return;
      }
      if (event.code === "Escape" && !event.repeat && dialog) {
        event.preventDefault();
        closeGameDialog();
      } else if (event.code === "Escape" && !event.repeat && phaseRef.current === "running") {
        event.preventDefault();
        pauseRound();
      } else if (
        event.code === "Space" &&
        !event.repeat &&
        !dialog &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        if (
          target instanceof Element &&
          target.closest("input, select, textarea, [contenteditable='true']")
        )
          return;
        if (target instanceof Element && target.closest(".staff-game-pause-actions button")) return;
        if (phaseRef.current === "running") {
          event.preventDefault();
          pauseRound();
        } else if (phaseRef.current === "paused") {
          event.preventDefault();
          void resumeRound();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeGameDialog, dialog, handleVirtualKey, pauseRound, resumeRound]);

  const focusPitch = GAME_NOTE_PROGRESSION[level - 1];
  const focusNote = `${focusPitch.name}${focusPitch.octave}`;
  const selectedSong =
    STAFF_GAME_SONGS.find((song) => song.id === selectedSongId) ?? STAFF_GAME_SONGS[0];
  const selectedSongPreviewNote = {
    ...gameNoteFromMidi(selectedSong.noteMidis[0]),
    token: 0,
    centerX: 0,
    spawnAt: 0,
  };
  const selectedSongRecord = songProgress[selectedSong.id]?.[settings.difficulty] ?? {
    bestScore: 0,
    bestAccuracy: 0,
    bestStars: 0,
    maxCombo: 0,
    plays: 0,
  };
  const isSongMode = gameMode === "songs";
  const activeChallengeMode = phase === "ready" ? settings.challengeMode : summaryChallengeMode;
  const activeChallengeProgress = progress.modes[activeChallengeMode];
  const isWrongNoteReview =
    !isSongMode &&
    (summaryIsWrongNoteReview ||
      roundPurposeRef.current === "wrong-note-review" ||
      (phase === "ready" && readyWrongNoteMode === "review"));
  const shouldCelebrateSummary =
    score > 0 && (isSongMode || earnedStars > 0 || summaryIsWrongNoteReview);
  const songProgressPercent =
    selectedSong.noteMidis.length > 0
      ? Math.round((songNotesCompleted * 100) / selectedSong.noteMidis.length)
      : 0;
  const songProgressRatio =
    selectedSong.noteMidis.length > 0 ? songNotesCompleted / selectedSong.noteMidis.length : 0;
  const songAccuracy =
    selectedSong.noteMidis.length > 0
      ? (songFirstTryHits * 100) / selectedSong.noteMidis.length
      : 0;
  const challengePoolSize = new Set(
    notePoolCandidates(level, settings.notePoolScope).map((note) => note.midi)
  ).size;
  const learningQuestionTargetCount = challengePoolSize * 2;
  const questionTargetCount =
    roundMetricsRef.current.targetQuestionCount || learningQuestionTargetCount;
  const isLearningChallenge =
    !isSongMode &&
    !isWrongNoteReview &&
    (phase === "ready" ? settings.challengeMode : roundChallengeModeRef.current) === "learning";
  const reviewQuestionProgressTarget =
    phase === "ready"
      ? wrongNoteReviewPlan.totalQuestionCount
      : roundReviewQuestionCountRef.current;
  const reviewQuestionProgressResolvedCount =
    phase === "ready" ? 0 : roundMetricsRef.current.resolvedQuestionCount;
  const activeProgress = isSongMode
    ? songProgressRatio
    : isWrongNoteReview
      ? reviewQuestionProgressTarget > 0
        ? reviewQuestionProgressResolvedCount / reviewQuestionProgressTarget
        : 0
      : levelProgress;
  const midiOptionAvailable = supportsMidi(midi.status);
  const remainingSeconds = Math.max(
    0,
    Math.ceil(
      ((isWrongNoteReview ? roundReviewDurationMsRef.current : gameDurationMs) - elapsedMs) / 1000
    )
  );
  const gameArtStyle = {
    "--staff-game-bg-desktop": `url("${gameBackgroundDesktop}")`,
    "--staff-game-bg-mobile": `url("${gameBackgroundMobile}")`,
    "--staff-game-modal-frame": `url("${modalFrameArt}")`,
    "--staff-game-primary-button": `url("${buttonPrimaryArt}")`,
    "--staff-game-secondary-button": `url("${buttonSecondaryArt}")`,
  } as CSSProperties;
  const microphoneReadyText = microphone.isListening
    ? "麦克风已连接，可以开始听音"
    : microphone.status === "requesting"
      ? microphone.isPreparingSwiftF0
        ? "正在准备识别模型"
        : "正在连接麦克风…"
      : microphone.error
        ? "麦克风权限或设备需要处理"
        : "点击开始后请求麦克风权限";
  const inputStatusText = settings.inputMode === "virtual" ? "已选择虚拟琴键" : microphoneReadyText;
  const gameInputStatusText =
    settings.inputMode === "virtual"
      ? "已选择虚拟琴键，点击琴键即可作答"
      : settings.inputMode === "midi"
        ? midi.isConnected
          ? `MIDI 已连接${midi.selectedInput?.name ? `：${midi.selectedInput.name}` : ""}`
          : midi.status === "requesting"
            ? "正在连接 MIDI 键盘…"
            : "点击开始后连接 MIDI 键盘"
        : inputStatusText;
  const gameInputStatusState =
    (settings.inputMode === "physical" && microphone.error) ||
    (settings.inputMode === "midi" && (midi.status === "denied" || midi.status === "error"))
      ? "error"
      : settings.inputMode === "virtual" ||
          (settings.inputMode === "physical" && microphone.isListening) ||
          (settings.inputMode === "midi" && midi.isConnected)
        ? "ready"
        : "pending";
  const gameInputStatusActivity =
    settings.inputMode === "physical" && microphone.status === "requesting"
      ? microphone.isPreparingSwiftF0
        ? ("dots" as const)
        : ("spinner" as const)
      : settings.inputMode === "midi" && midi.status === "requesting"
        ? ("spinner" as const)
        : null;
  const showVirtualKeyboard =
    virtualKeyboardAvailable &&
    settings.inputMode === "virtual" &&
    (phase === "running" || phase === "paused");
  const mascotAction: StaffGameMascotAction =
    phase === "paused"
      ? "pause"
      : phase === "running" ||
          (phase === "ready" && !isSongMode && mascotReaction.action === "cheer")
        ? mascotReaction.action
        : "idle";
  const pauseControlDisabled = (phase !== "running" && phase !== "paused") || isStarting;
  const loadedResourceCount = resourceProgress.filter(
    (resource) => resource.status === "loaded"
  ).length;
  const failedResourceItems = resourceProgress.filter((resource) => resource.status === "failed");
  const resourceProgressPercent =
    resourceProgress.length > 0
      ? Math.round((loadedResourceCount / resourceProgress.length) * 100)
      : 0;
  const showPauseControl = phase === "running" || phase === "paused";
  const showWrongNoteEndControl = isWrongNoteReview && showPauseControl;
  const backButtonLabel = isSongMode
    ? isSongPlayRoute
      ? "返回歌曲选择"
      : "返回上一页"
    : phase === "ready" && !isStarting
      ? "返回首页"
      : "返回等待页";

  if (resourceLoadState !== "ready") {
    return (
      <section
        aria-busy={resourceLoadState === "loading"}
        className="practice-shell staff-game-shell staff-game-loading-shell"
        aria-label="正在准备五线谱闯关"
      >
        <div
          className="staff-game-loading-card"
          role={resourceLoadState === "error" ? "alert" : undefined}
        >
          {resourceLoadState === "loading" ? (
            <LoadingActivityIndicator kind="dots" size="prominent" />
          ) : null}
          <strong>
            {resourceLoadState === "loading" ? "正在加载游戏素材" : "部分游戏素材未能加载"}
          </strong>
          <span>
            {resourceLoadState === "loading"
              ? resourceLoadRetryCount > 0
                ? `部分素材未就绪，正在自动重试（${resourceLoadRetryCount}/${STAFF_GAME_RESOURCE_MAX_RETRIES}）`
                : "素材加载完成后即可开始"
              : `已自动重试 ${STAFF_GAME_RESOURCE_MAX_RETRIES} 次，请检查网络连接后重试`}
          </span>
          <div className="staff-game-loading-progress">
            <div className="staff-game-loading-progress-label">
              <span>加载进度</span>
              <strong>
                {loadedResourceCount}/{resourceProgress.length} 项（{resourceProgressPercent}%）
              </strong>
            </div>
            <progress
              aria-label="游戏素材加载进度"
              max={resourceProgress.length || 1}
              value={loadedResourceCount}
            />
            {failedResourceItems.length > 0 ? (
              <span className="staff-game-loading-failure-count">
                {failedResourceItems.length} 项加载失败
                {resourceLoadState === "loading" ? "，正在重试" : ""}
              </span>
            ) : null}
          </div>
          {failedResourceItems.length > 0 ? (
            <details className="staff-game-loading-details">
              <summary>查看失败详情（{failedResourceItems.length}）</summary>
              <ul>
                {failedResourceItems.map((resource) => (
                  <li key={resource.id}>
                    <strong>{resource.label}</strong>
                    <small>
                      {resource.category} · {resource.source}
                    </small>
                    <span>{resource.error ?? "资源加载失败"}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {resourceLoadState === "error" ? (
            <button
              className="staff-game-loading-retry"
              onClick={() => setResourceLoadAttempt((attempt) => attempt + 1)}
              type="button"
            >
              重新加载
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`practice-shell staff-game-shell${phase === "ready" ? " is-ready" : ""}`}
      aria-label="五线谱闯关游戏"
    >
      <div className="staff-game-scene" ref={sceneRef} style={gameArtStyle}>
        <StaffGameErrorFlash active={errorFlashActive} />
        <img
          alt=""
          aria-hidden="true"
          className="staff-game-cloud-drift cloud-drift-a"
          draggable="false"
          src={cloudDecorationOne}
        />
        <img
          alt=""
          aria-hidden="true"
          className="staff-game-cloud-drift cloud-drift-b"
          draggable="false"
          src={cloudDecorationTwo}
        />
        <img
          alt=""
          aria-hidden="true"
          className="staff-game-cloud-drift cloud-drift-c"
          draggable="false"
          src={cloudDecorationThree}
        />
        {phase === "ready" && !isSongMode && settings.gameEffectsEnabled ? (
          <div aria-hidden="true" className="staff-game-waiting-cloud-layer">
            <img
              alt=""
              className="staff-game-waiting-cloud cloud-a"
              draggable="false"
              src={cloudDecorationOne}
            />
            <img
              alt=""
              className="staff-game-waiting-cloud cloud-b is-reversed"
              draggable="false"
              src={cloudDecorationTwo}
            />
            <img
              alt=""
              className="staff-game-waiting-cloud cloud-c"
              draggable="false"
              src={cloudDecorationThree}
            />
            <img
              alt=""
              className="staff-game-waiting-cloud cloud-d is-reversed"
              draggable="false"
              src={cloudDecorationOne}
            />
            <img
              alt=""
              className="staff-game-waiting-cloud cloud-e"
              draggable="false"
              src={cloudDecorationTwo}
            />
          </div>
        ) : null}
        {settings.gameEffectsEnabled ? (
          <StaffGameRushSpeedLines bubbleLane={rushBubbleSpeedLineLane} />
        ) : null}
        {settings.gameEffectsEnabled ? (
          <div aria-hidden="true" className="staff-game-rush-vignette" />
        ) : null}
        {settings.gameEffectsEnabled ? <StaffGameParticles /> : null}
        {settings.gameEffectsEnabled ? <StaffGameShootingStar /> : null}
        {rushScoreFlights.map((flight) => (
          <span
            aria-hidden="true"
            className={`staff-game-rush-score-flight${flight.ready ? " is-ready" : ""}${phase === "paused" ? " is-paused" : ""}`}
            key={`rush-score-${flight.token}`}
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target)
                completeRushScoreFlight(flight.token, flight.points);
            }}
            style={
              {
                left: flight.left,
                top: flight.top,
                "--rush-score-dx": `${flight.deltaX}px`,
                "--rush-score-dy": `${flight.deltaY}px`,
              } as CSSProperties
            }
          >
            +{flight.points}
          </span>
        ))}
        <StaffGameHud
          activeProgress={activeProgress}
          isLearningChallenge={isLearningChallenge}
          isQuestionCountProgress={isWrongNoteReview}
          isReady={phase === "ready" && gameMode === "levels"}
          currentRoundStars={currentRoundStars}
          displayedScore={displayedScore}
          historyLabel={isSongMode ? "歌曲最佳" : isLearningChallenge ? "本关星级" : "历史最高"}
          historyStars={
            isSongMode ? selectedSongRecord.bestStars : activeChallengeProgress.bestStars[level - 1]
          }
          isSongMode={isSongMode}
          isWrongNoteReview={isWrongNoteReview}
          medalLabel={
            isSongMode
              ? `${selectedSong.title}，已完成 ${songNotesCompleted} 音，共 ${selectedSong.noteMidis.length} 音`
              : isWrongNoteReview
                ? `错题复习，已完成 ${reviewQuestionProgressResolvedCount}/${reviewQuestionProgressTarget} 题`
                : isLearningChallenge
                  ? `第 ${level} 关学习测试，已完成 ${roundMetricsRef.current.resolvedQuestionCount}/${questionTargetCount} 题`
                  : `第 ${level} 关，当前获得 ${currentRoundStars} 颗星`
          }
          onOpenLevels={() => openGameDialog("levels")}
          progressLabel={isSongMode ? "歌曲" : isWrongNoteReview ? "题数" : "LEVEL"}
          progressValue={
            isSongMode
              ? `${songProgressPercent}%`
              : isWrongNoteReview
                ? `${reviewQuestionProgressResolvedCount}/${reviewQuestionProgressTarget}`
                : level
          }
          showScore={!isWrongNoteReview || phase !== "ready"}
          rushModeActive={rushModeActive}
          scoreDetail={
            isWrongNoteReview
              ? phase === "ready"
                ? `约 ${wrongNoteReviewPlan.totalQuestionCount} 题 · 限时 ${formatStaffGameWrongNoteReviewDuration(staffGameWrongNoteReviewDurationMs(wrongNoteReviewPlan.totalQuestionCount, bubbleDurationMs))}`
                : `已出题 ${Math.min(roundMetricsRef.current.generatedBubbleCount, roundReviewQuestionCountRef.current)}/${roundReviewQuestionCountRef.current} 题 · 剩余 ${remainingSeconds} 秒`
              : isSongMode
                ? `最佳 ${Math.round(selectedSongRecord.bestScore)}\u3000·\u3000${songNotesCompleted}/${selectedSong.noteMidis.length} 音\u3000·\u3000${Math.round(songAccuracy)}%`
                : isLearningChallenge
                  ? phase === "ready"
                    ? `进度 0/${questionTargetCount} 题`
                    : `已完成 ${roundMetricsRef.current.resolvedQuestionCount}/${questionTargetCount} 题 · 无倒计时`
                  : phase === "ready"
                    ? ""
                    : `最高 ${Math.round(progress.modes.arcade.bestScores[level - 1])}\u3000·\u3000${remainingSeconds} 秒`
          }
          scoreLabel={
            isSongMode
              ? "本曲得分"
              : phase === "summary" || isWrongNoteReview
                ? "本局得分"
                : "本关得分"
          }
          scoreValueRef={scoreValueRef}
          showLevelJump={!isSongMode && !rushModeActive && !isWrongNoteReview}
          songSelectionHeaderTitle={
            songSelectionStep
              ? songSelectionStep === "detail"
                ? selectedSong.title
                : "选择一首歌曲"
              : null
          }
        />

        <div
          className={`staff-game-playfield${phase === "paused" ? " is-paused" : ""}${phase === "ready" && gameMode === "levels" ? " is-ready" : ""}${preserveRushBubbleScreenTop ? " is-rush-mode" : ""}${rushBubbleScreenTopStart?.token === target?.token ? " has-screen-top-rush-bubble" : ""}`}
          ref={playfieldRef}
        >
          <div aria-hidden="true" className="staff-game-scene-glow" />
          {!songSelectionStep &&
          (phase === "ready" || phase === "running" || phase === "paused") ? (
            <div
              className={`staff-game-mascot-anchor${settings.gameEffectsEnabled ? " effects-enabled" : ""}${phase === "ready" && !isSongMode ? " has-greeting" : ""}`}
            >
              {phase === "ready" && !isSongMode ? (
                <span
                  aria-hidden="true"
                  className={`staff-game-mascot-greeting${settings.gameEffectsEnabled ? " is-animated" : ""}`}
                >
                  Hi~
                </span>
              ) : null}
              {phase === "ready" && !isSongMode ? (
                <button
                  aria-label="让小人欢呼"
                  className="staff-game-mascot-interactive"
                  onClick={triggerReadyMascotCheer}
                  onMouseEnter={triggerReadyMascotCheer}
                  type="button"
                >
                  <StaffGameMascot
                    action={mascotAction}
                    animate={settings.gameEffectsEnabled}
                    onComplete={finishMascotReaction}
                    token={mascotReaction.token}
                  />
                </button>
              ) : (
                <StaffGameMascot
                  action={mascotAction}
                  animate={settings.gameEffectsEnabled}
                  onComplete={finishMascotReaction}
                  token={mascotReaction.token}
                />
              )}
            </div>
          ) : null}
          {target ? (
            <div
              aria-label={`落下的音符 ${noteLabel(target)}`}
              className={`staff-game-bubble${rushVisualsActive ? " is-rush" : ""}${targetPopped ? " is-popped" : ""}${phase === "paused" ? " is-paused" : ""}`}
              key={target.token}
              ref={targetElementRef}
              style={
                {
                  "--staff-game-bubble-fade-duration": `${BUBBLE_FADE_IN_MS}ms`,
                  "--staff-game-bubble-fall-duration": `${activeBubbleDurationMs - BUBBLE_FADE_IN_MS}ms`,
                  left: `${target.centerX}px`,
                  ...(rushBubbleScreenTopStart?.token === target.token
                    ? { "--staff-game-bubble-start-top": `${rushBubbleScreenTopStart.top}px` }
                    : {}),
                } as CSSProperties
              }
            >
              <img
                alt=""
                aria-hidden="true"
                className="staff-game-bubble-shell"
                draggable="false"
                src={bubbleShell}
              />
              <div className="staff-game-bubble-content">
                <NoteStaff note={target} />
                <span className="staff-game-bubble-a11y">请弹奏 {noteLabel(target)}</span>
              </div>
            </div>
          ) : null}

          {comboIndicator && comboIndicatorIsRush ? (
            <div
              aria-label={`${comboIndicator.count} 连击`}
              aria-live="polite"
              className={`staff-game-combo-cloud${comboIndicator.isFadingOut ? " is-fading-out" : ""}${phase === "paused" ? " is-paused" : ""}`}
              key={`combo-cloud-${comboIndicator.token}`}
              role="status"
            >
              <span>
                <strong>{comboIndicator.count}</strong>
                <small>连击</small>
              </span>
            </div>
          ) : null}

          {comboIndicator && !comboIndicatorIsRush ? (
            <div
              aria-label={`连击 ${comboIndicator.count} 次`}
              aria-live="polite"
              className={`staff-game-combo-indicator${comboIndicator.isFadingOut ? " is-fading-out" : ""}${phase === "paused" ? " is-paused" : ""}`}
              key={`combo-${comboIndicator.token}`}
              role="status"
              style={{ "--combo-duration": `${comboIndicator.durationMs}ms` } as CSSProperties}
            >
              <span className="staff-game-combo-pulse">
                <span className="staff-game-combo-label">连击</span>
                <span className="staff-game-combo-count">
                  <svg aria-hidden="true" className="staff-game-combo-ring" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="22" />
                  </svg>
                  <strong>{comboIndicator.count}</strong>
                </span>
              </span>
            </div>
          ) : null}

          {settings.gameEffectsEnabled && bubbleBurst ? (
            <div
              aria-hidden="true"
              className="staff-game-burst"
              key={`burst-${bubbleBurst.token}`}
              style={{ left: bubbleBurst.x, top: bubbleBurst.y }}
            >
              {settings.gameEffectsEnabled ? <span className="staff-game-burst-flash" /> : null}
              {settings.gameEffectsEnabled
                ? Array.from({ length: BURST_STAR_COUNT }, (_, index) => {
                    const angle = (index / BURST_STAR_COUNT) * Math.PI * 2 - Math.PI / 2;
                    const distance = 43 + (index % 4) * 15;
                    const style = {
                      "--burst-x": `${Math.cos(angle) * distance}px`,
                      "--burst-y": `${Math.sin(angle) * distance}px`,
                      "--burst-turn": `${(index % 2 === 0 ? 1 : -1) * (65 + index * 7)}deg`,
                      "--burst-delay": `${(index % 5) * 18}ms`,
                      "--burst-size": `${9 + (index % 3) * 4}px`,
                    } as CSSProperties;
                    return (
                      <img
                        alt=""
                        className="staff-game-burst-star"
                        draggable="false"
                        key={index}
                        src={starParticleArt}
                        style={style}
                      />
                    );
                  })
                : null}
            </div>
          ) : null}

          {phase === "ready" && songSelectionStep === "list" ? (
            <StaffGameReadyPanel
              bubbleImage={bubbleShell}
              onSelectSong={selectSong}
              songProgress={songProgress}
              songs={STAFF_GAME_SONGS}
              difficulty={settings.difficulty}
              starImage={starParticleArt}
              variant="song-list"
            />
          ) : null}

          {phase === "ready" && songSelectionStep === "detail" ? (
            <StaffGameReadyPanel
              bubbleImage={bubbleShell}
              isStarting={isStarting}
              isPreparingMicrophone={microphone.isPreparingSwiftF0}
              onStartSong={startSelectedSong}
              previewNotation={<NoteStaff note={selectedSongPreviewNote} />}
              record={selectedSongRecord}
              song={selectedSong}
              starImage={starParticleArt}
              variant="song-detail"
            />
          ) : null}

          {phase === "ready" && songSelectionStep === null && gameMode === "levels" ? (
            <StaffGameReadyPanel
              bestStars={progress.modes[settings.challengeMode].bestStars[level - 1]}
              arcadeDefaultDurationMs={levelDefaultGameDurationMs}
              arcadeDuration={settings.arcadeDuration}
              bubbleImage={bubbleShell}
              challengeMode={settings.challengeMode}
              focusNote={focusNote}
              difficulty={settings.difficulty}
              inputMode={settings.inputMode}
              midiInputAvailable={midiOptionAvailable}
              virtualKeyboardAvailable={virtualKeyboardAvailable}
              inputStatusActivity={gameInputStatusActivity}
              inputStatusState={gameInputStatusState}
              inputStatusText={gameInputStatusText}
              isPreparingMicrophone={microphone.isPreparingSwiftF0}
              isStarting={isStarting}
              maxCombo={progress.modes.arcade.maxCombos[level - 1]}
              onChangeReviewRange={handleWrongNoteReviewRangeChange}
              onChangeArcadeDuration={(arcadeDuration) =>
                updateReadyChallengeSettings({ arcadeDuration })
              }
              onChangeChallengeMode={(challengeMode) =>
                updateReadyChallengeSettings({ challengeMode })
              }
              onChangeInputMode={updateReadyInputMode}
              onChangeDifficulty={(difficulty) => updateReadyChallengeSettings({ difficulty })}
              onChangeNotePoolScope={(notePoolScope) =>
                updateReadyChallengeSettings({ notePoolScope })
              }
              onChangeReviewCondition={setWrongNoteReviewConditionId}
              onOpenWrongNoteArchiveManager={openWrongNoteArchiveManager}
              onOpenWrongNoteStudy={openWrongNoteStudyDialog}
              onStartLevel={() => void startLevel()}
              onStartReview={startWrongNoteReview}
              onSelectReadyMode={setReadyWrongNoteMode}
              learningQuestionCount={learningQuestionTargetCount}
              notePoolScope={settings.notePoolScope}
              readyMode={readyWrongNoteMode}
              reviewNotes={wrongNoteReviewPreviewNotes.map((note) => ({
                label: `${note.name}${note.octave}`,
                errorCount: note.errorCount,
                accuracyPercent: note.accuracyPercent,
              }))}
              reviewQuestionCount={wrongNoteReviewPlan.totalQuestionCount}
              reviewDurationMs={staffGameWrongNoteReviewDurationMs(
                wrongNoteReviewPlan.totalQuestionCount,
                bubbleDurationMs
              )}
              reviewRange={wrongNoteReviewRange}
              reviewConditionValue={wrongNoteReviewConditionId}
              reviewConditions={wrongNoteReviewConditions.map((condition) => ({
                value: condition.id,
                label: condition.label,
              }))}
              reviewWeakNoteCount={wrongNoteReviewPlan.weakNoteCount}
              wrongNoteArchiveDateCount={wrongNoteArchiveDateCount}
              starImage={starParticleArt}
              variant="level"
            />
          ) : null}

          {phase === "ready" &&
          songSelectionStep === null &&
          gameMode === "levels" &&
          isWrongNoteArchiveManagerOpen ? (
            <StaffGameWrongNoteArchiveManagerDialog
              archives={wrongNoteArchives}
              onChangeRange={setWrongNoteArchiveManagerRange}
              onClose={closeWrongNoteArchiveManager}
              onDeleteRuns={(runIds) => void deleteSelectedWrongNoteArchiveRuns(runIds)}
              range={wrongNoteArchiveManagerRange}
            />
          ) : null}

          {phase === "ready" &&
          songSelectionStep === null &&
          gameMode === "levels" &&
          isWrongNoteStudyDialogOpen ? (
            <StaffGameWrongNoteStudyDialog
              archives={wrongNoteArchives}
              onChangeRange={setWrongNoteStudyRange}
              onClose={closeWrongNoteStudyDialog}
              range={wrongNoteStudyRange ?? wrongNoteReviewRange}
            />
          ) : null}

          {phase === "summary" && typeof document !== "undefined" ? (
            <StaffGameSummaryDialog
              accuracy={summaryAccuracy}
              averagePlayerResponseMs={summaryAveragePlayerResponseMs}
              challengeMode={summaryChallengeMode}
              mode={summaryIsWrongNoteReview ? "review" : isSongMode ? "song" : "challenge"}
              ariaLabel={
                summaryIsWrongNoteReview
                  ? "错题复习结算"
                  : isSongMode
                    ? `${selectedSong.title} 演奏结算`
                    : `第 ${level} 关结算`
              }
              comboCount={summaryComboCount}
              earnedStars={earnedStars}
              fireworks={
                settings.gameEffectsEnabled ? (
                  <StaffGameFireworks image={summaryFireworksArt} />
                ) : null
              }
              gameArtStyle={gameArtStyle}
              gameEffectsEnabled={settings.gameEffectsEnabled}
              isFinalLevel={level >= GAME_LEVEL_COUNT}
              isWrongNoteReview={summaryIsWrongNoteReview}
              wrongNoteReviewTimedOut={summaryWrongNoteReviewTimedOut}
              reviewQuestionCount={roundReviewQuestionCountRef.current}
              wrongNoteComparison={summaryWrongNoteComparison}
              reviewPerformance={summaryReviewPerformance}
              wrongNoteArchiveDate={summaryArchiveDate}
              wrongNoteArchiveMode={summaryArchiveMode}
              wrongNoteArchiveStatus={wrongNoteArchiveStatus}
              wrongNoteArchiveRetryQueued={wrongNoteArchiveRetryQueued}
              isNewComboRecord={
                !summaryIsWrongNoteReview &&
                summaryChallengeMode === "arcade" &&
                roundRecordsAtStartRef.current.maxCombo > 0 &&
                maxCombo > roundRecordsAtStartRef.current.maxCombo
              }
              isNewScoreRecord={
                !summaryIsWrongNoteReview &&
                summaryChallengeMode === "arcade" &&
                roundRecordsAtStartRef.current.score > 0 &&
                score > roundRecordsAtStartRef.current.score
              }
              isSongMode={isSongMode}
              level={level}
              levelBannerImage={summaryLevelBannerArt}
              mascot={
                <StaffGameMascot
                  action={shouldCelebrateSummary ? "celebration" : "summarySad"}
                  animate={settings.gameEffectsEnabled}
                  className="staff-game-summary-mascot"
                  token={0}
                />
              }
              onAdvanceLevel={() => advanceLevel(level + 1)}
              onPlayNextSong={playNextSong}
              onReturnToSongList={returnToSongList}
              onExitWrongNoteReview={exitWrongNoteReview}
              onCloseChallengeSummary={closeChallengeSummary}
              onArchiveWrongNotes={() => void archiveWrongNoteRun(summaryArchiveRunId)}
              onRetryArchive={() =>
                void archiveWrongNoteRun(
                  summaryArchiveRunId,
                  summaryArchiveMode === "trend" ? "trend" : "full"
                )
              }
              onRetry={retryLevel}
              revealedStars={revealedSummaryStars}
              score={summaryScoreCount}
              generatedNoteCount={
                isSongMode
                  ? selectedSong.noteMidis.length
                  : roundMetricsRef.current.generatedBubbleCount
              }
              wrongAnswerRecords={summaryWrongAnswerRecords}
              weakNoteOutcomes={summaryWeakNoteOutcomes}
              inputMode={settings.inputMode}
              showFastPlayingHint={summaryFastPlayingHint}
              wrongNoteStatisticsEnabled={
                settings.wrongNoteStatisticsEnabled && summaryChallengeMode !== "arcade"
              }
              songTitle={selectedSong.title}
              starImage={starParticleArt}
              hasNextSong={STAFF_GAME_SONGS[STAFF_GAME_SONGS.length - 1]?.id !== selectedSong.id}
            />
          ) : null}
        </div>

        {showVirtualKeyboard ? (
          <div
            aria-label="虚拟键盘按音名判定，可匹配任意八度"
            className={`staff-game-virtual-keyboard${phase === "paused" ? " is-paused" : ""}`}
            role="group"
          >
            <div className="staff-game-keybed">
              {NOTE_NAMES.map((note) => (
                <button
                  aria-label={`${note} 音键，按音名匹配任意八度`}
                  className="staff-game-virtual-key"
                  disabled={phase === "paused"}
                  key={note}
                  onClick={() => handleVirtualKey(note)}
                  type="button"
                >
                  {settings.displayMode === "none" ? null : (
                    <span>{virtualKeyLabel(note, settings.displayMode)}</span>
                  )}
                </button>
              ))}
              {/* Product choice: black keys have no visible labels; their note names remain available to assistive technology. */}
              {BLACK_KEY_NOTES.map(({ pitch, className }) => (
                <button
                  aria-label={`${pitch.replace("#", "♯")} 音键，按音名匹配任意八度`}
                  className={`staff-game-virtual-key staff-game-black-key ${className}`}
                  disabled={phase === "paused"}
                  key={pitch}
                  onClick={() => handleVirtualKey(pitch)}
                  type="button"
                />
              ))}
            </div>
          </div>
        ) : null}
        <footer
          className={`staff-game-controls${touchGameLayout ? " is-touch-layout" : ""}${isSongMode ? " is-song-mode" : ""}${showWrongNoteEndControl ? " is-wrong-note-review" : ""}`}
        >
          <button
            aria-label={backButtonLabel}
            title={backButtonLabel}
            className="staff-game-action-button staff-game-back-button is-desktop-control"
            onClick={handleSongSelectionBack}
            type="button"
          >
            <img alt="" aria-hidden="true" src={actionReturnArt} />
          </button>
          <div aria-live="polite" className="staff-game-feedback is-desktop-control">
            {phase === "ready" || showVirtualKeyboard ? null : settings.inputMode === "physical" &&
              microphone.isListening ? (
              <>
                <Volume2 aria-hidden="true" size={16} />
                <span>{feedback || microphone.detectedNote || "麦克风已连接"}</span>
              </>
            ) : (
              <span>{feedback}</span>
            )}
          </div>
          <div
            aria-label="游戏操作"
            className={`staff-game-toolbar is-desktop-control${showWrongNoteEndControl ? " is-wrong-note-review" : ""}`}
          >
            <button
              aria-label="游戏提示"
              title="游戏提示"
              className="staff-game-action-button"
              onClick={() => openGameDialog("help")}
              type="button"
            >
              <img alt="" aria-hidden="true" src={actionHelpArt} />
            </button>
            <button
              aria-label="游戏设置"
              title="游戏设置"
              className="staff-game-action-button"
              onClick={() => openGameDialog("settings")}
              type="button"
            >
              <img alt="" aria-hidden="true" src={actionSettingsArt} />
            </button>
            {showPauseControl && (!isSongMode || songSelectionStep === null) ? (
              <button
                aria-label={
                  phase === "paused"
                    ? isSongMode
                      ? "继续演奏"
                      : "继续闯关"
                    : isSongMode
                      ? "暂停演奏"
                      : "暂停闯关"
                }
                title={
                  phase === "paused"
                    ? isSongMode
                      ? "继续演奏"
                      : "继续闯关"
                    : isSongMode
                      ? "暂停演奏"
                      : "暂停闯关"
                }
                className="staff-game-action-button"
                disabled={pauseControlDisabled}
                onClick={() => (phase === "running" ? pauseRound() : void resumeRound())}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  src={phase === "paused" ? actionResumeArt : actionPauseArt}
                />
              </button>
            ) : null}
            {showWrongNoteEndControl ? (
              <button
                aria-label="退出复习"
                className="staff-game-action-button staff-game-review-end-button"
                onClick={handleExitWrongNoteReview}
                title="退出复习"
                type="button"
              >
                <Square aria-hidden="true" size={20} strokeWidth={3} />
              </button>
            ) : null}
          </div>
          <div
            aria-label="游戏操作"
            className={`staff-game-toolbar is-mobile-control${showWrongNoteEndControl ? " is-wrong-note-review" : ""}`}
          >
            <button
              aria-label={backButtonLabel}
              title={backButtonLabel}
              className="staff-game-action-button"
              onClick={handleSongSelectionBack}
              type="button"
            >
              <img alt="" aria-hidden="true" src={actionReturnArt} />
            </button>
            <button
              aria-label="游戏提示"
              title="游戏提示"
              className="staff-game-action-button"
              onClick={() => openGameDialog("help")}
              type="button"
            >
              <img alt="" aria-hidden="true" src={actionHelpArt} />
            </button>
            <button
              aria-label="游戏设置"
              title="游戏设置"
              className="staff-game-action-button"
              onClick={() => openGameDialog("settings")}
              type="button"
            >
              <img alt="" aria-hidden="true" src={actionSettingsArt} />
            </button>
            {showPauseControl && (!isSongMode || songSelectionStep === null) ? (
              <button
                aria-label={
                  phase === "paused"
                    ? isSongMode
                      ? "继续演奏"
                      : "继续闯关"
                    : isSongMode
                      ? "暂停演奏"
                      : "暂停闯关"
                }
                title={
                  phase === "paused"
                    ? isSongMode
                      ? "继续演奏"
                      : "继续闯关"
                    : isSongMode
                      ? "暂停演奏"
                      : "暂停闯关"
                }
                className="staff-game-action-button"
                disabled={pauseControlDisabled}
                onClick={() => (phase === "running" ? pauseRound() : void resumeRound())}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  src={phase === "paused" ? actionResumeArt : actionPauseArt}
                />
              </button>
            ) : null}
            {showWrongNoteEndControl ? (
              <button
                aria-label="退出复习"
                className="staff-game-action-button staff-game-review-end-button"
                onClick={handleExitWrongNoteReview}
                title="退出复习"
                type="button"
              >
                <Square aria-hidden="true" size={20} strokeWidth={3} />
              </button>
            ) : null}
          </div>
        </footer>
        <StaffGameDialogs
          applyGameSettings={applyGameSettings}
          bestStars={activeChallengeProgress.bestStars}
          closeGameDialog={closeGameDialog}
          dialog={dialog}
          draftAudioSettings={draftAudioSettings}
          draftDifficulty={draftDifficulty}
          gameArtStyle={gameArtStyle}
          isStarting={isStarting}
          isWrongNoteNoticeOpen={isWrongNoteNoticeOpen}
          isSettingsDialogShaking={isSettingsDialogShaking}
          isUnsavedSettingsPromptOpen={isUnsavedSettingsPromptOpen}
          isWrongNoteReview={isWrongNoteReview}
          isArcadeMode={
            !isWrongNoteReview &&
            gameMode === "levels" &&
            (phase === "ready" ? settingsDraft.challengeMode : roundChallengeModeRef.current) ===
              "arcade"
          }
          isSongMode={isSongMode}
          jumpToLevel={jumpToLevel}
          level={level}
          midi={midi}
          midiOptionAvailable={midiOptionAvailable}
          onDifficultyChange={(difficulty) =>
            setSettingsDraft((current) => ({ ...current, difficulty }))
          }
          onNotePoolScopeChange={(notePoolScope) =>
            setSettingsDraft((current) => ({ ...current, notePoolScope }))
          }
          onNoteSchedulingStrategyChange={(noteSchedulingStrategy) =>
            setSettingsDraft((current) => ({ ...current, noteSchedulingStrategy }))
          }
          onCloseWrongNoteNotice={() => setIsWrongNoteNoticeOpen(false)}
          onCancelUnsavedSettingsPrompt={() => setIsUnsavedSettingsPromptOpen(false)}
          onDiscardUnsavedSettings={discardUnsavedGameSettings}
          onDisplayModeChange={(displayMode) =>
            setSettingsDraft((current) => ({ ...current, displayMode }))
          }
          onSettingsDialogAnimationEnd={(event) => {
            if (event.animationName !== "staff-game-settings-dialog-wobble") return;
            settingsDialogShakeLockRef.current = false;
            setIsSettingsDialogShaking(false);
          }}
          onToggleBackgroundMusic={() =>
            setSettingsDraft((current) =>
              updateModeAudioSettings(current, gameMode, {
                backgroundMusicEnabled: !current.audioByMode[gameMode].backgroundMusicEnabled,
              })
            )
          }
          onToggleGameEffects={() =>
            setSettingsDraft((current) => ({
              ...current,
              gameEffectsEnabled: !current.gameEffectsEnabled,
            }))
          }
          onTogglePianoSound={() =>
            setSettingsDraft((current) =>
              updateModeAudioSettings(current, gameMode, {
                pianoSoundEnabled: !current.audioByMode[gameMode].pianoSoundEnabled,
              })
            )
          }
          onToggleSoundEffects={() =>
            setSettingsDraft((current) =>
              updateModeAudioSettings(current, gameMode, {
                soundEffectsEnabled: !current.audioByMode[gameMode].soundEffectsEnabled,
              })
            )
          }
          onToggleWrongNoteStatistics={() => {
            const enabling = !settingsDraft.wrongNoteStatisticsEnabled;
            setSettingsDraft((current) => ({
              ...current,
              wrongNoteStatisticsEnabled: !current.wrongNoteStatisticsEnabled,
            }));
            if (enabling) setIsWrongNoteNoticeOpen(true);
          }}
          onToggleAutoArchiveWrongNotes={() =>
            setSettingsDraft((current) => ({
              ...current,
              autoArchiveWrongNotesEnabled: !current.autoArchiveWrongNotesEnabled,
            }))
          }
          selectInputMode={selectInputMode}
          settingsDraft={settingsDraft}
          triggerSettingsDialogShake={triggerSettingsDialogShake}
          virtualKeyboardAvailable={virtualKeyboardAvailable}
        />
      </div>
      <StaffGameStatusOverlays
        gameArtStyle={gameArtStyle}
        gameEffectsEnabled={settings.gameEffectsEnabled}
        gameError={gameError}
        isMidiInput={settings.inputMode === "midi"}
        wrongNoteExitLabel={roundPurposeRef.current === "wrong-note-review" ? "退出复习" : null}
        isStarting={isStarting}
        onDisableEffects={() => {
          const nextSettings = { ...settingsRef.current, gameEffectsEnabled: false };
          settingsRef.current = nextSettings;
          setSettings(nextSettings);
          setSettingsDraft(nextSettings);
          setShowLowFpsPrompt(false);
          void resumeRound();
        }}
        onReturnToReady={returnToReady}
        onKeepEffects={() => {
          setShowLowFpsPrompt(false);
          void resumeRound();
        }}
        onResume={() => void resumeRound()}
        onExitWrongNoteReview={exitWrongNoteReview}
        onRetryInput={() => void (phase === "paused" ? resumeRound() : beginRound())}
        onRetryLevel={retryLevel}
        showLowFpsPrompt={showLowFpsPrompt}
        showPauseDialog={phase === "paused" && dialog === null && !gameError}
        touchGameLayout={touchGameLayout}
      />
      <B6SwiftF0ReminderDialog
        active={
          phase === "ready" &&
          gameMode === "levels" &&
          readyWrongNoteMode === "level" &&
          dialog === null &&
          settings.inputMode === "physical" &&
          microphoneAlgorithm !== "swiftf0" &&
          focusPitch.midi === 95
        }
      />
    </section>
  );
}
