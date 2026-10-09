import { Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { NoteName, PianoKeyName } from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type { MidiAccessStatus } from "../../../midi/midiInput";
import type { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { readStaffGameSongProgress, saveStaffGameSongProgress, STAFF_GAME_SONGS, type StaffGameSongProgress } from "../data/staffGameSongs";
import { StaffGameFireworks } from "./StaffGameFireworks";
import { StaffGameDialogs } from "./StaffGameDialogs";
import { StaffGameErrorFlash, StaffGameStatusOverlays } from "./StaffGameStatusOverlays";
import { useStaffGameRoundClock } from "../hooks/useStaffGameRoundClock";
import { useStaffGameScoring } from "../hooks/useStaffGameScoring";
import { useStaffGameAudio } from "../hooks/useStaffGameAudio";
import type { StaffGameComboIndicator as ComboIndicator, StaffGameRushScoreFlight as RushScoreFlight } from "../hooks/useStaffGameScoring";
import type { StaffGameTarget as GameNote } from "../hooks/useStaffGameRoundClock";
import type { StaffGameDialogKind as GameDialog } from "./StaffGameDialogs";
import { StaffGameHud } from "./StaffGameHud";
import { StaffGameReadyPanel } from "./StaffGameReadyPanel";
import { StaffGameSummaryDialog } from "./StaffGameSummaryDialog";
import {
  StaffGameMascot,
  StaffGameParticles,
  StaffGameRushSpeedLines,
  StaffGameShootingStar,
} from "./StaffGameEffects";
import type { StaffGameMascotAction } from "./StaffGameEffects";
import {
  preloadStaffGameResources,
  STAFF_GAME_ART,
  STAFF_GAME_RESOURCE_MAX_RETRIES,
  STAFF_GAME_RESOURCE_RETRY_DELAY_MS,
} from "../logic/staffGameResources";
import {
  BLACK_KEY_NOTES,
  COMBO_INDICATOR_FADE_DURATION_MS,
  COMPUTER_KEY_PITCHES,
  GAME_DIFFICULTIES,
  GAME_LEVEL_COUNT,
  GAME_NOTE_PROGRESSION,
  NOTE_NAMES,
  PITCH_NAMES,
  RUSH_FALL_SPEED_MULTIPLIER,
  RUSH_MODE_COMBO_THRESHOLD,
  STAR_BASE_DURATION_MS,
  STAR_THRESHOLDS,
  gameDurationMsForLevel,
  gameNoteFromMidi,
  starsForStarCredit,
} from "../logic/staffGameRules";
import type { GameDifficulty } from "../logic/staffGameRules";

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
  hudFrameArt,
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

function isComboVoiceMilestone(comboCount: number): boolean {
  return comboCount === COMBO_EXCELLENT_MILESTONE
    || comboCount === COMBO_AMAZING_MILESTONE
    || (comboCount >= COMBO_UNBELIEVABLE_MILESTONE
      && (comboCount - COMBO_UNBELIEVABLE_MILESTONE) % COMBO_UNBELIEVABLE_INTERVAL === 0);
}

function isNearComboVoiceMilestone(comboCount: number): boolean {
  if (comboCount <= COMBO_UNBELIEVABLE_MILESTONE) {
    return [COMBO_EXCELLENT_MILESTONE, COMBO_AMAZING_MILESTONE, COMBO_UNBELIEVABLE_MILESTONE]
      .some((milestone) => Math.abs(comboCount - milestone) <= COMBO_VOICE_MILESTONE_BUFFER);
  }
  const offset = (comboCount - COMBO_UNBELIEVABLE_MILESTONE) % COMBO_UNBELIEVABLE_INTERVAL;
  return Math.min(offset, COMBO_UNBELIEVABLE_INTERVAL - offset) <= COMBO_VOICE_MILESTONE_BUFFER;
}

const GAME_PROGRESS_KEY = "anki-note.staffGameProgress.v2";
const GAME_SETTINGS_KEY = "anki-note.staffGameSettings.v1";
const LOW_FPS_PROMPT_SESSION_KEY = "anki-note.staffGameLowFpsPrompted.v1";
const PHYSICAL_INPUT_NOTICE_ID = "staff-game-physical-input-notice";
const PHYSICAL_INPUT_NOTICE = "实体钢琴模式通过麦克风识别音高，背景音乐会自动关闭；答题反馈音效仍由「音效」设置控制。请确保乐器音准正常。";
let lowFpsPromptShownThisPage = false;
const BURST_STAR_COUNT = 14;
const SOLFEGE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"] as const;
type GameInputMode = "physical" | "virtual" | "midi";
type GameDisplayMode = "note" | "solfege" | "number" | "none";
type StaffGameMode = "levels" | "songs";
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
  audioByMode: Record<StaffGameMode, StaffGameAudioSettings>;
  gameEffectsEnabled: boolean;
}

interface StaffGameProgress {
  bestScores: number[];
  bestStars: number[];
  maxCombos: number[];
  unlockedLevel: number;
  selectedLevel: number;
}

interface BubbleBurst {
  token: number;
  x: number;
  y: number;
}

type MicrophoneController = Pick<
  ReturnType<typeof usePracticeMicrophoneInput>,
  "detectedNote" | "error" | "inputLevel" | "isListening" | "start" | "status" | "stop"
>;

interface StaffGameViewProps {
  initialMode?: StaffGameMode;
  initialSongSelectionStep?: Exclude<SongSelectionStep, null>;
  initialSongId?: string;
  isSongPlayRoute: boolean;
  microphone: MicrophoneController;
  midi: MidiInputController;
  onModeChange: (mode: StaffGameMode) => void;
  onSongStart: (songId: string) => void;
  onSongSelectionExit: () => void;
  onExit: () => void;
  onSessionActiveChange: (active: boolean) => void;
  onRegisterAnswerHandler: (handler: ((answer: PracticeAnswerInput) => void) | null) => void;
}

function defaultProgress(): StaffGameProgress {
  return {
    bestScores: Array(GAME_LEVEL_COUNT).fill(0),
    bestStars: Array(GAME_LEVEL_COUNT).fill(0),
    maxCombos: Array(GAME_LEVEL_COUNT).fill(0),
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

function supportsMidi(status: MidiAccessStatus): boolean {
  return status !== "unsupported" && status !== "insecure-context";
}

function defaultGameSettings(): StaffGameSettings {
  return {
    inputMode: "physical",
    displayMode: "note",
    difficulty: "normal",
    audioByMode: {
      levels: { soundEffectsEnabled: true, backgroundMusicEnabled: true, pianoSoundEnabled: false },
      songs: { soundEffectsEnabled: false, backgroundMusicEnabled: false, pianoSoundEnabled: true },
    },
    gameEffectsEnabled: true,
  };
}

function readGameSettings(virtualAvailable: boolean, midiAvailable: boolean): StaffGameSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_SETTINGS_KEY) ?? "null") as (Partial<Omit<StaffGameSettings, "audioByMode">> & {
      audioByMode?: Partial<Record<StaffGameMode, Partial<StaffGameAudioSettings>>>;
      soundEffectsEnabled?: unknown;
      backgroundMusicEnabled?: unknown;
      speed?: unknown;
    }) | null;
    const base = defaultGameSettings();
    const inputMode: GameInputMode = parsed?.inputMode === "virtual" && virtualAvailable
      ? "virtual"
      : parsed?.inputMode === "midi" && midiAvailable
        ? "midi"
        : "physical";
    const displayMode: GameDisplayMode = parsed?.displayMode === "solfege" || parsed?.displayMode === "number" || parsed?.displayMode === "none"
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
        soundEffectsEnabled: typeof saved?.soundEffectsEnabled === "boolean"
          ? saved.soundEffectsEnabled
          : canMigrateLegacyAudio && typeof parsed?.soundEffectsEnabled === "boolean"
            ? parsed.soundEffectsEnabled
            : defaults.soundEffectsEnabled,
        backgroundMusicEnabled: typeof saved?.backgroundMusicEnabled === "boolean"
          ? saved.backgroundMusicEnabled
          : canMigrateLegacyAudio && typeof parsed?.backgroundMusicEnabled === "boolean"
            ? parsed.backgroundMusicEnabled
            : defaults.backgroundMusicEnabled,
        pianoSoundEnabled: typeof saved?.pianoSoundEnabled === "boolean"
          ? saved.pianoSoundEnabled
          : defaults.pianoSoundEnabled,
      };
    };
    return {
      inputMode,
      displayMode,
      difficulty: validDifficulty ? parsed!.difficulty as GameDifficulty : legacyDifficulty,
      audioByMode: { levels: readModeAudio("levels"), songs: readModeAudio("songs") },
      gameEffectsEnabled: typeof parsed?.gameEffectsEnabled === "boolean" ? parsed.gameEffectsEnabled : base.gameEffectsEnabled,
    };
  } catch {
    return defaultGameSettings();
  }
}

function saveGameSettings(settings: StaffGameSettings): void {
  try {
    localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify({
      ...settings,
      // Retain the old fields so older app versions can still read level-mode audio preferences.
      soundEffectsEnabled: settings.audioByMode.levels.soundEffectsEnabled,
      backgroundMusicEnabled: settings.audioByMode.levels.backgroundMusicEnabled,
    }));
  } catch {
    // Settings still apply for this visit if storage is unavailable.
  }
}

function updateModeAudioSettings(
  settings: StaffGameSettings,
  mode: StaffGameMode,
  update: Partial<StaffGameAudioSettings>,
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
    const parsed = JSON.parse(localStorage.getItem(GAME_PROGRESS_KEY) ?? "null") as Partial<StaffGameProgress> | null;
    if (!parsed) return defaultProgress();
    const base = defaultProgress();
    const readArray = (value: unknown): number[] => Array.from({ length: GAME_LEVEL_COUNT }, (_, index) => {
      const item = Array.isArray(value) ? Number(value[index]) : 0;
      return Number.isFinite(item) ? Math.max(0, Math.floor(item)) : 0;
    });
    const bestScores = readArray(parsed.bestScores);
    return {
      bestScores,
      bestStars: readArray(parsed.bestStars),
      maxCombos: readArray(parsed.maxCombos),
      unlockedLevel: Math.max(1, Math.min(GAME_LEVEL_COUNT, Math.floor(Number(parsed.unlockedLevel) || base.unlockedLevel))),
      selectedLevel: Math.max(
        1,
        Math.min(
          GAME_LEVEL_COUNT,
          Math.floor(Number(parsed.selectedLevel) || Number(parsed.unlockedLevel) || base.selectedLevel),
        ),
      ),
    };
  } catch {
    return defaultProgress();
  }
}

function saveProgress(progress: StaffGameProgress): void {
  try {
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // The current game remains playable if browser storage is unavailable.
  }
}

function noteLabel(note: GameNote): string {
  return `${note.name}${note.octave}`;
}

function virtualKeyLabel(pitch: PianoKeyName, mode: GameDisplayMode): string {
  if (mode === "none") return "";
  const noteIndex = NOTE_NAMES.indexOf(pitch[0] as NoteName);
  const isSharp = pitch.includes("#");
  if (mode === "solfege") return `${SOLFEGE_NAMES[noteIndex]}${isSharp ? "♯" : ""}`;
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
  let displayStep = diatonicStep;
  if (clef === "treble") {
    while (displayStep < 0) displayStep += 7;
    while (displayStep > 12) displayStep -= 7;
  }
  const octaveShift = Math.round((diatonicStep - displayStep) / 7);
  const octaveLabel = clef === "bass" || octaveShift === 0
    ? null
    : Math.abs(octaveShift) === 1
      ? octaveShift > 0 ? "8va" : "8vb"
      : `${Math.abs(octaveShift) * 7 + 1}${octaveShift > 0 ? "ma" : "mb"}`;
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
  const clefFontSize = stepSpacing * 6.5;
  const clefY = (clef === "bass" ? 100 : yForStep(staffBottomStep) + clefFontSize * 0.22) - 5;
  const staffLines = Array.from({ length: 5 }, (_, index) => staffBottomStep + index * 2);
  const clefGlyph = clef === "bass" ? "𝄢" : "𝄞";
  return (
    <svg aria-label={`${noteLabel(note)} 音符`} className="staff-game-note-staff" role="img" viewBox="0 0 190 200">
      {staffLines.map((step) => {
        const lineY = yForStep(step);
        return <line key={step} x1="18" x2="172" y1={lineY} y2={lineY} />;
      })}
      <line x1="18" x2="18" y1={yForStep(staffTopStep)} y2={yForStep(staffBottomStep)} />
      <line x1="172" x2="172" y1={yForStep(staffTopStep)} y2={yForStep(staffBottomStep)} />
      <text
        className="staff-game-clef"
        dominantBaseline={clef === "bass" ? "central" : undefined}
        style={{ fontSize: clefFontSize }}
        x="18"
        y={clefY}
      >
        {clefGlyph}
      </text>
      {ledgerSteps.map((step) => {
        const ledgerY = yForStep(step);
        return <line className="staff-game-ledger" key={step} x1="108" x2="156" y1={ledgerY} y2={ledgerY} />;
      })}
      {accidental ? <text className="staff-game-accidental" dominantBaseline="central" x="92" y={noteY} style={{ fontSize: stepSpacing * 3.4 }}>{accidental}</text> : null}
      {octaveLabel ? <text className="staff-game-octave-mark" dominantBaseline="central" x="126" y={displayStep > staffCenterStep ? 28 : 176}>{octaveLabel}</text> : null}
      <ellipse className="staff-game-note-head" cx={noteX} cy={noteY} rx="11" ry={Math.max(5.5, stepSpacing * 0.92)} transform={`rotate(-18 ${noteX} ${noteY})`} />
      <line className="staff-game-note-stem" x1={stemX} x2={stemX} y1={noteY + (stemGoesUp ? -1 : 1)} y2={stemEndY} />
    </svg>
  );
}

export function StaffGameView({ initialMode = "levels", initialSongSelectionStep = "list", initialSongId, isSongPlayRoute, microphone, midi, onModeChange, onSongStart, onSongSelectionExit, onExit, onSessionActiveChange, onRegisterAnswerHandler }: StaffGameViewProps): JSX.Element {
  const [resourceLoadState, setResourceLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [resourceLoadAttempt, setResourceLoadAttempt] = useState(0);
  const [resourceLoadRetryCount, setResourceLoadRetryCount] = useState(0);
  const [progress, setProgress] = useState<StaffGameProgress>(readProgress);
  const [level, setLevel] = useState(() => readProgress().selectedLevel);
  const [gameMode, setGameMode] = useState<StaffGameMode>(initialMode);
  const [songSelectionStep, setSongSelectionStep] = useState<SongSelectionStep>(initialMode === "songs" ? initialSongSelectionStep : null);
  const [selectedSongId, setSelectedSongId] = useState(() => STAFF_GAME_SONGS.find((song) => song.id === initialSongId)?.id ?? STAFF_GAME_SONGS[0].id);
  const previousSongPlayRouteRef = useRef(isSongPlayRoute);
  const [songProgress, setSongProgress] = useState<StaffGameSongProgress>(readStaffGameSongProgress);
  const [phase, setPhase] = useState<"ready" | "running" | "paused" | "summary">("ready");
  const [virtualKeyboardAvailable, setVirtualKeyboardAvailable] = useState(canUseVirtualKeyboard);
  const [touchGameLayout, setTouchGameLayout] = useState(prefersTouchGameLayout);
  const [showLowFpsPrompt, setShowLowFpsPrompt] = useState(false);
  const [settings, setSettings] = useState<StaffGameSettings>(() => readGameSettings(
    canUseVirtualKeyboard(),
    supportsMidi(midi.status),
  ));
  const [settingsDraft, setSettingsDraft] = useState<StaffGameSettings>(settings);
  const [isSettingsDialogShaking, setIsSettingsDialogShaking] = useState(false);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const backgroundMusicRef = useRef<HTMLAudioElement | null>(null);
  const settingsDialogShakeLockRef = useRef(false);
  const [target, setTarget] = useState<GameNote | null>(null);
  const [rushBubbleSpeedLineLane, setRushBubbleSpeedLineLane] = useState<{ centerPercent: number; halfWidthPercent: number } | null>(null);
  const [rushBubbleScreenTopStart, setRushBubbleScreenTopStart] = useState<{ token: number; top: number } | null>(null);
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
  const [starCredit, setStarCredit] = useState(0);
  const [errorFlashActive, setErrorFlashActive] = useState(false);
  const [mascotReaction, setMascotReaction] = useState<{
    action: "idle" | "cheer" | "sad";
    token: number;
    queuedAction: "cheer" | "sad" | null;
  }>({ action: "idle", token: 0, queuedAction: null });
  const readyMascotCheerLockRef = useRef(false);
  const [summaryScoreCount, setSummaryScoreCount] = useState(0);
  const [summaryComboCount, setSummaryComboCount] = useState(0);
  const [summaryAccuracy, setSummaryAccuracy] = useState(0);
  const [songNotesCompleted, setSongNotesCompleted] = useState(0);
  const [songFirstTryHits, setSongFirstTryHits] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [earnedStars, setEarnedStars] = useState(0);
  const [revealedSummaryStars, setRevealedSummaryStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [gameError, setGameError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(false);
  const startAttemptRef = useRef(0);
  const comboIndicatorRef = useRef<ComboIndicator | null>(null);
  const targetRef = useRef<GameNote | null>(null);
  const spawnTargetRef = useRef<(atGameMs: number) => void>(() => undefined);
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
  const starCreditRef = useRef(0);
  const maxComboRef = useRef(0);
  const consecutiveWrongAnswersRef = useRef(0);
  const errorFlashTimeoutRef = useRef<number | null>(null);
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
  const phaseRef = useRef(phase);
  const progressRef = useRef(progress);
  const settingsRef = useRef(settings);
  const midiRef = useRef(midi);
  const recentNoteMidisRef = useRef<number[]>([]);
  const noteBagRef = useRef<Array<{ midi: number; name: PianoKeyName; octave: number }>>([]);
  const targetTokenRef = useRef(0);
  const elapsedBeforeRunRef = useRef(0);
  const runSegmentStartedAtRef = useRef(0);
  const targetSpawnGameMsRef = useRef(0);
  const wrongClearTimeoutRef = useRef<number | null>(null);
  const burstTimeoutRef = useRef<number | null>(null);
  const nextTargetTimeoutRef = useRef<number | null>(null);
  const roundFinishedRef = useRef(false);
  const waitingForNextTargetRef = useRef(false);

  const triggerMascotReaction = useCallback((action: "cheer" | "sad"): void => {
    // Keep the current one-shot animation intact and coalesce a burst into one follow-up.
    setMascotReaction((current) => current.action === "idle"
      ? { action, token: current.token + 1, queuedAction: null }
      : { ...current, queuedAction: action });
  }, []);

  const triggerReadyMascotCheer = useCallback((): void => {
    if (phaseRef.current !== "ready" || gameModeRef.current !== "levels" || readyMascotCheerLockRef.current) return;
    readyMascotCheerLockRef.current = true;
    setMascotReaction((current) => ({ action: "cheer", token: current.token + 1, queuedAction: null }));
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
    const getGameButton = (target: EventTarget | null): HTMLButtonElement | null => {
      if (!(target instanceof Element)) return null;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled || button.classList.contains("staff-game-virtual-key")) return null;
      return button.closest(".staff-game-shell, .staff-game-summary-backdrop, .staff-game-dialog-backdrop, .staff-game-mic-dialog-backdrop, .staff-game-low-fps-backdrop, .staff-game-pause-backdrop") ? button : null;
    };
    const playMenuClick = (button: HTMLButtonElement | null): void => {
      if (button) playGameSound("menuClick");
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      playMenuClick(getGameButton(event.target));
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      playMenuClick(getGameButton(event.target));
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

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
    const loadResources = async (): Promise<void> => {
      const failureCount = await preloadStaffGameResources(
        backgroundMusic,
        backgroundMusicPreloadController.signal,
        retryCount > 0,
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
      backgroundMusic.removeAttribute("src");
      backgroundMusic.load();
      if (backgroundMusicRef.current === backgroundMusic) backgroundMusicRef.current = null;
    };
  }, [resourceLoadAttempt]);

  phaseRef.current = phase;
  targetRef.current = target;
  targetPoppedRef.current = targetPopped;
  levelRef.current = level;
  progressRef.current = progress;
  gameModeRef.current = gameMode;
  selectedSongIdRef.current = selectedSongId;
  songProgressRef.current = songProgress;
  settingsRef.current = settings;
  midiRef.current = midi;

  const activeAudioSettings = settings.audioByMode[gameMode];
  const { playGameSound, playStarReveal, playVirtualPianoNote, setGameSoundsEnabled, unlockGameAudio } = useStaffGameAudio({
    settings,
    backgroundMusicRef,
    backgroundMusicEnabled: activeAudioSettings.backgroundMusicEnabled,
    inputMode: settings.inputMode,
    phase,
    resourceLoadState,
    soundEffectsEnabled: activeAudioSettings.soundEffectsEnabled,
  });
  const draftAudioSettings = settingsDraft.audioByMode[gameMode];
  const difficulty = GAME_DIFFICULTIES.find((item) => item.id === settings.difficulty) ?? GAME_DIFFICULTIES[1];
  const bubbleDurationMs = difficulty.bubbleDurationMs;
  const gameDurationMs = gameDurationMsForLevel(level);
  const draftDifficulty = GAME_DIFFICULTIES.find((item) => item.id === settingsDraft.difficulty) ?? GAME_DIFFICULTIES[1];
  const currentRoundStars = starsForStarCredit(starCredit, level);
  const threeStarCredit = Math.ceil(STAR_THRESHOLDS[STAR_THRESHOLDS.length - 1] * gameDurationMs / STAR_BASE_DURATION_MS);
  const levelProgress = threeStarCredit > 0 ? Math.min(1, starCredit / threeStarCredit) : 0;
  const rushModeActive = combo >= RUSH_MODE_COMBO_THRESHOLD && phase === "running";
  // Keep the rush playfield geometry fixed while paused so a frozen bubble cannot jump.
  const preserveRushBubbleScreenTop = combo >= RUSH_MODE_COMBO_THRESHOLD && (phase === "running" || phase === "paused");
  const comboIndicatorIsRush = (comboIndicator?.count ?? 0) >= RUSH_MODE_COMBO_THRESHOLD;
  const rushVisualsActive = rushModeActive && settings.gameEffectsEnabled;
  const activeBubbleDurationMs = rushModeActive ? Math.round(bubbleDurationMs * RUSH_FALL_SPEED_MULTIPLIER) : bubbleDurationMs;

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
      centerPercent: ((bubbleBounds.left + bubbleBounds.width / 2 - sceneBounds.left) / sceneBounds.width) * 100,
      halfWidthPercent: ((bubbleBounds.width / 2 + 8) / sceneBounds.width) * 100,
    });
  }, [rushVisualsActive, target?.token]);

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
  }, [preserveRushBubbleScreenTop, target?.token]);

  useLayoutEffect(() => {
    if (!rushScoreFlights.some((flight) => !flight.ready)) return;
    const sceneBounds = sceneRef.current?.getBoundingClientRect();
    if (!sceneBounds) return;
    const scoreBounds = scoreValueRef.current?.getBoundingClientRect();
    const destinationX = scoreBounds
      ? scoreBounds.left + scoreBounds.width / 2 - sceneBounds.left
      : sceneBounds.width - 56;
    const destinationY = scoreBounds
      ? scoreBounds.bottom - sceneBounds.top + 12
      : 52;
    const readyFlights = rushScoreFlightsRef.current.map((flight) => flight.ready ? flight : {
      ...flight,
      deltaX: destinationX - flight.left,
      deltaY: destinationY - flight.top,
      ready: true,
    });
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
    const comboWindowMs = GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty)?.comboWindowMs ?? 2_200;
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
    const increment = phaseIndex === 0
      ? Math.max(1, Math.floor(remaining * 0.2))
      : phaseIndex === 1
        ? Math.max(1, Math.floor(remaining * 0.375))
        : remaining;
    const nextScore = Math.min(scoreAnimationTargetRef.current, displayedScoreRef.current + increment);
    displayedScoreRef.current = nextScore;
    setDisplayedScore(nextScore);
    scoreAnimationPhaseRef.current = (phaseIndex + 1) % 3;

    if (nextScore < scoreAnimationTargetRef.current) {
      scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
    }
  }, []);

  const queueRushScore = useCallback((points: number): void => {
    if (points <= 0) return;
    scoreAnimationTargetRef.current += points;
    if (scoreAnimationTimerRef.current !== null) return;
    scoreAnimationPhaseRef.current = 0;
    scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
  }, [advanceRushScore]);

  const setDisplayedScoreImmediately = useCallback((nextScore: number): void => {
    if (scoreAnimationTimerRef.current !== null) window.clearTimeout(scoreAnimationTimerRef.current);
    scoreAnimationTimerRef.current = null;
    scoreAnimationTargetRef.current = nextScore;
    displayedScoreRef.current = nextScore;
    scoreAnimationPhaseRef.current = 0;
    setDisplayedScore(nextScore);
  }, []);

  const flushScorePresentation = useCallback((nextScore: number): void => {
    setDisplayedScoreImmediately(nextScore);
    rushScoreFlightsRef.current = [];
    setRushScoreFlights([]);
  }, [setDisplayedScoreImmediately]);

  const completeRushScoreFlight = useCallback((token: number, points: number): void => {
    if (!rushScoreFlightsRef.current.some((flight) => flight.token === token)) return;
    const remainingFlights = rushScoreFlightsRef.current.filter((flight) => flight.token !== token);
    rushScoreFlightsRef.current = remainingFlights;
    setRushScoreFlights(remainingFlights);
    queueRushScore(points);
  }, [queueRushScore]);

  const persistRoundResult = useCallback((finalStars: number): void => {
    const index = levelRef.current - 1;
    const current = progressRef.current;
    const next: StaffGameProgress = {
      bestScores: current.bestScores.map((best, itemIndex) => itemIndex === index ? Math.max(best, scoreRef.current) : best),
      bestStars: current.bestStars.map((best, itemIndex) => itemIndex === index ? Math.max(best, finalStars) : best),
      maxCombos: current.maxCombos.map((best, itemIndex) => itemIndex === index ? Math.max(best, maxComboRef.current) : best),
      unlockedLevel: finalStars > 0 ? Math.max(current.unlockedLevel, Math.min(GAME_LEVEL_COUNT, levelRef.current + 1)) : current.unlockedLevel,
      selectedLevel: current.selectedLevel,
    };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const persistSongResult = useCallback((finalStars: number, accuracy: number): void => {
    const songId = selectedSongIdRef.current;
    const current = songProgressRef.current;
    const previous = current[songId] ?? { bestScore: 0, bestAccuracy: 0, bestStars: 0, maxCombo: 0, plays: 0 };
    const next = {
      ...current,
      [songId]: {
        bestScore: Math.max(previous.bestScore, scoreRef.current),
        bestAccuracy: Math.max(previous.bestAccuracy, accuracy),
        bestStars: Math.max(previous.bestStars, finalStars),
        maxCombo: Math.max(previous.maxCombo, maxComboRef.current),
        plays: previous.plays + 1,
      },
    };
    songProgressRef.current = next;
    setSongProgress(next);
    saveStaffGameSongProgress(next);
  }, []);

  const playComboFeedback = useCallback((nextCombo: number): void => {
    if (nextCombo === COMBO_EXCELLENT_MILESTONE) {
      playGameSound("comboExcellent");
    } else if (nextCombo === COMBO_AMAZING_MILESTONE) {
      playGameSound("comboAmazing");
    } else if (isComboVoiceMilestone(nextCombo)) {
      playGameSound("comboUnbelievable");
    }
    if (nextCombo >= 3 && nextCombo % 3 === 0 && !isNearComboVoiceMilestone(nextCombo)) {
      playGameSound("comboStreak");
    }
  }, [playGameSound]);

  const { finishRound, handleRecognizedAnswer } = useStaffGameScoring({
    burstTimeoutRef,
    comboIndicatorFadeTimeoutRef,
    comboIndicatorRef,
    comboRef,
    consecutiveWrongAnswersRef,
    displayedScoreRef,
    elapsedBeforeRunRef,
    errorFlashTimeoutRef,
    flushScorePresentation,
    gameModeRef,
    levelRef,
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
    setStarCredit,
    setSummaryAccuracy,
    setTarget,
    setTargetPopped,
    setTargetWrong,
    settingsRef,
    songFirstTryHitsRef,
    songTargetIndexRef,
    songWrongTargetTokenRef,
    spawnTargetRef,
    starCreditRef,
    targetElementRef,
    targetPoppedRef,
    targetRef,
    targetWrong,
    triggerMascotReaction,
    waitingForNextTargetRef,
    wrongClearTimeoutRef,
    setDisplayedScoreImmediately,
  });

  useEffect(() => {
    onRegisterAnswerHandler(handleRecognizedAnswer);
    return () => onRegisterAnswerHandler(null);
  }, [handleRecognizedAnswer, onRegisterAnswerHandler]);

  useEffect(() => midi.subscribe((event) => {
    if (event.type !== "press") return;
    const noteName = event.note.keyName[0] as NoteName;
    handleRecognizedAnswer({
      diagnosticSampleId: event.note.diagnosticSampleId,
      midiNoteNumber: event.note.midiNoteNumber,
      noteName,
      octave: event.note.octave,
      source: "midi",
    });
  }), [handleRecognizedAnswer, midi.subscribe]);

  useEffect(() => {
    if (phase !== "summary") {
      setRevealedSummaryStars(0);
      return undefined;
    }

    setRevealedSummaryStars(0);
    let cancelled = false;
    const revealTimeouts = [700, 1200, 1700].map((delay, index) => window.setTimeout(() => {
      if (cancelled) return;
      setRevealedSummaryStars(index + 1);
      void playStarReveal(index, activeAudioSettings.soundEffectsEnabled);
    }, delay));

    return () => {
      cancelled = true;
      revealTimeouts.forEach(window.clearTimeout);
    };
  }, [activeAudioSettings.soundEffectsEnabled, phase, playStarReveal, settings.inputMode]);

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
        comboTimerRemainingRef.current - (performance.now() - comboTimerStartedAtRef.current),
      );
      clearComboTimer();
      return;
    }

    if (phase !== "running" || !comboIndicator || comboIndicator.isFadingOut || comboResetTimeoutRef.current !== null) return;
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
      phase === "running"
      && scoreAnimationTimerRef.current === null
      && scoreAnimationTargetRef.current > displayedScoreRef.current
    ) {
      scoreAnimationTimerRef.current = window.setTimeout(advanceRushScore, 48);
    }
  }, [advanceRushScore, phase]);

  useEffect(() => () => {
    startAttemptRef.current += 1;
    isStartingRef.current = false;
    microphone.stop();
    onSessionActiveChange(false);
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    if (comboResetTimeoutRef.current !== null) window.clearTimeout(comboResetTimeoutRef.current);
    if (comboIndicatorFadeTimeoutRef.current !== null) window.clearTimeout(comboIndicatorFadeTimeoutRef.current);
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    if (scoreAnimationTimerRef.current !== null) window.clearTimeout(scoreAnimationTimerRef.current);
  }, [microphone.stop, onSessionActiveChange]);

  const { pauseRunSegment, spawnTarget, startRunSegment } = useStaffGameRoundClock({
    activeBubbleDurationMs,
    elapsedBeforeRunRef,
    finishRound,
    gameDurationMs,
    gameModeRef,
    levelRef,
    noteBagRef,
    noteLabel,
    nextTargetTimeoutRef,
    phase,
    phaseRef,
    playGameSound,
    playfieldRef,
    recentNoteMidisRef,
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
    targetSpawnGameMsRef,
    targetTokenRef,
    triggerMascotReaction,
    waitingForNextTargetRef,
  });
  spawnTargetRef.current = spawnTarget;

  const resetRoundState = useCallback((): void => {
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    nextTargetTimeoutRef.current = null;
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    wrongClearTimeoutRef.current = null;
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = null;
    waitingForNextTargetRef.current = false;
    consecutiveWrongAnswersRef.current = 0;
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    errorFlashTimeoutRef.current = null;
    setErrorFlashActive(false);
    setMascotReaction((current) => ({ action: "idle", token: current.token + 1, queuedAction: null }));
    targetRef.current = null;
    targetPoppedRef.current = false;
    noteBagRef.current = [];
    recentNoteMidisRef.current = [];
    roundFinishedRef.current = false;
    setTarget(null);
    setBubbleBurst(null);
    setTargetPopped(false);
    setTargetWrong(false);
    setScore(0);
    scoreRef.current = 0;
    flushScorePresentation(0);
    setStarCredit(0);
    starCreditRef.current = 0;
    setEarnedStars(0);
    setSummaryScoreCount(0);
    setSummaryComboCount(0);
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

  const beginRound = useCallback(async (): Promise<boolean> => {
    if (resourceLoadState !== "ready") return false;
    if (isStartingRef.current) return false;
    const attemptId = startAttemptRef.current + 1;
    startAttemptRef.current = attemptId;
    const isCancelled = (): boolean => attemptId !== startAttemptRef.current;
    isStartingRef.current = true;
    setIsStarting(true);
    setGameError("");
    try {
      await unlockGameAudio().catch(() => undefined);
      if (isCancelled()) return false;
      if (settingsRef.current.inputMode === "physical") {
        let started = false;
        try {
          started = await microphone.start({ includeAccidentals: true });
        } catch (error) {
          if (isCancelled()) return false;
          const reason = error instanceof Error ? `（${error.message}）` : "";
          setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
          return false;
        }
        if (isCancelled()) {
          microphone.stop();
          return false;
        }
        if (!started) {
          const reason = microphone.error ? `（${microphone.error}）` : "";
          setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
          return false;
        }
        playGameSound("microphoneReady");
      } else if (settingsRef.current.inputMode === "midi") {
        if (!await connectMidiForRound(isCancelled)) return false;
        if (isCancelled()) return false;
        microphone.stop();
      } else {
        microphone.stop();
      }
      if (isCancelled()) return false;
      const records = progressRef.current;
      const levelIndex = levelRef.current - 1;
      if (gameModeRef.current === "songs") {
        const record = songProgressRef.current[selectedSongIdRef.current];
        roundRecordsAtStartRef.current = { score: record?.bestScore ?? 0, maxCombo: record?.maxCombo ?? 0 };
      } else {
        roundRecordsAtStartRef.current = {
          score: records.bestScores[levelIndex] ?? 0,
          maxCombo: records.maxCombos[levelIndex] ?? 0,
        };
      }
      resetRoundState();
      startRunSegment();
      setFeedback(gameModeRef.current === "songs"
        ? "按旋律顺序弹奏；答错可重试，漏音后会继续"
        : settingsRef.current.inputMode === "virtual" ? "点击琴键，弹出对应音符" : settingsRef.current.inputMode === "midi" ? "弹奏 MIDI 键盘，弹出对应音符" : "聆听麦克风，弹出对应音符");
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
  }, [connectMidiForRound, microphone.error, microphone.start, microphone.stop, resetRoundState, resourceLoadState, spawnTarget, startRunSegment]);

  const cancelPendingStart = useCallback((): void => {
    if (!isStartingRef.current) return;
    startAttemptRef.current += 1;
    isStartingRef.current = false;
    setIsStarting(false);
    microphone.stop();
  }, [microphone.stop]);

  const pauseRound = useCallback((): void => {
    if (phaseRef.current !== "running") return;
    setElapsedMs(pauseRunSegment());
    setMascotReaction((current) => ({ action: "idle", token: current.token + 1, queuedAction: null }));
    phaseRef.current = "paused";
    setPhase("paused");
    setFeedback(gameModeRef.current === "songs" ? "演奏已暂停" : "闯关已暂停");
    microphone.stop();
  }, [microphone.stop, pauseRunSegment]);

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
        const fps = sampledFrames * 1000 / sampleDuration;
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
    const unavailableMode = settings.inputMode === "virtual" && !virtualKeyboardAvailable
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
    setSettingsDraft((current) => current.inputMode === unavailableMode ? { ...current, inputMode: "physical" } : current);
    if (wasRunning) pauseRound();
    if (wasRunning || wasPaused) {
      setGameError(unavailableMode === "virtual"
        ? "虚拟琴键已不可用，闯关已暂停并切换为麦克风输入。点击继续后重新连接麦克风。"
        : "MIDI 输入已不可用，闯关已暂停并切换为麦克风输入。点击继续后重新连接麦克风。");
    }
  }, [midi.status, pauseRound, settings.inputMode, virtualKeyboardAvailable]);

  useEffect(() => {
    if (phase === "running" && settings.inputMode === "physical" && microphone.status === "error") {
      setGameError(microphone.error ?? "麦克风连接中断，闯关已暂停。");
      pauseRound();
    }
  }, [microphone.error, microphone.status, pauseRound, phase, settings.inputMode]);

  useEffect(() => {
    if (phase === "running" && settings.inputMode === "midi" && (!supportsMidi(midi.status) || !midi.isConnected)) {
      setGameError(midi.errorMessage ?? "MIDI 键盘连接中断，闯关已暂停。");
      pauseRound();
    }
  }, [midi.errorMessage, midi.isConnected, midi.status, pauseRound, phase, settings.inputMode, virtualKeyboardAvailable]);

  useEffect(() => {
    if (phase !== "running") return undefined;
    const pauseWhenHidden = (): void => {
      if (document.hidden) pauseRound();
    };
    const pauseWhenWindowLosesFocus = (): void => pauseRound();
    document.addEventListener("visibilitychange", pauseWhenHidden);
    window.addEventListener("blur", pauseWhenWindowLosesFocus);
    window.addEventListener("pagehide", pauseWhenWindowLosesFocus);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      window.removeEventListener("blur", pauseWhenWindowLosesFocus);
      window.removeEventListener("pagehide", pauseWhenWindowLosesFocus);
    };
  }, [pauseRound, phase]);

  const resumeRound = useCallback(async (): Promise<void> => {
    if (isStartingRef.current || phaseRef.current !== "paused") return;
    const attemptId = startAttemptRef.current + 1;
    startAttemptRef.current = attemptId;
    const isCancelled = (): boolean => attemptId !== startAttemptRef.current;
    isStartingRef.current = true;
    setIsStarting(true);
    setGameError("");
    try {
      if (settingsRef.current.inputMode === "physical") {
        let started = false;
        try {
          started = await microphone.start({ includeAccidentals: true });
        } catch (error) {
          if (isCancelled()) return;
          const reason = error instanceof Error ? `（${error.message}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
        if (isCancelled()) {
          microphone.stop();
          return;
        }
        if (!started) {
          const reason = microphone.error ? `（${microphone.error}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
        playGameSound("microphoneReady");
      } else if (settingsRef.current.inputMode === "midi") {
        if (!await connectMidiForRound(isCancelled)) return;
        if (isCancelled()) return;
        microphone.stop();
      } else {
        microphone.stop();
      }
      if (isCancelled() || phaseRef.current !== "paused") return;
      startRunSegment();
      phaseRef.current = "running";
      setPhase("running");
      setFeedback(gameModeRef.current === "songs"
        ? "继续按旋律顺序弹奏"
        : settingsRef.current.inputMode === "midi" ? "继续弹奏 MIDI 键盘" : "继续识别，弹奏气泡音符");
      if (waitingForNextTargetRef.current && !targetRef.current) {
        waitingForNextTargetRef.current = false;
        const activeSong = gameModeRef.current === "songs"
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
  }, [connectMidiForRound, finishRound, microphone.error, microphone.start, microphone.stop, spawnTarget, startRunSegment]);

  const exitGame = useCallback((): void => {
    cancelPendingStart();
    microphone.stop();
    onSessionActiveChange(false);
    onExit();
  }, [cancelPendingStart, microphone.stop, onExit, onSessionActiveChange]);

  const retryLevel = useCallback((): void => {
    void beginRound();
  }, [beginRound]);

  const advanceLevel = useCallback((nextLevel: number): void => {
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
  }, [beginRound]);

  const jumpToLevel = useCallback((selectedLevel: number): void => {
    setDialog(null);
    const clamped = Math.max(1, Math.min(GAME_LEVEL_COUNT, selectedLevel));
    const nextProgress = { ...progressRef.current, selectedLevel: clamped };
    progressRef.current = nextProgress;
    setProgress(nextProgress);
    saveProgress(nextProgress);
    setLevel(clamped);
    levelRef.current = clamped;
    void beginRound();
  }, [beginRound]);

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
    microphone.stop();
    onSessionActiveChange(false);
    resetRoundState();
    phaseRef.current = "ready";
    setPhase("ready");
    setSongSelectionStep("list");
    onModeChange("songs");
  }, [cancelPendingStart, microphone.stop, onModeChange, onSessionActiveChange, resetRoundState]);

  const handleSongSelectionBack = useCallback((): void => {
    cancelPendingStart();
    if (gameMode !== "songs") {
      exitGame();
    } else if (isSongPlayRoute) {
      returnToSongList();
    } else if (songSelectionStep === "detail") {
      setSongSelectionStep("list");
    } else {
      onSongSelectionExit();
    }
  }, [cancelPendingStart, exitGame, gameMode, isSongPlayRoute, onSongSelectionExit, returnToSongList, songSelectionStep]);

  useEffect(() => {
    const wasSongPlayRoute = previousSongPlayRouteRef.current;
    previousSongPlayRouteRef.current = isSongPlayRoute;
    if (gameMode !== "songs") return;

    if (wasSongPlayRoute && !isSongPlayRoute) {
      if (phaseRef.current === "running" || phaseRef.current === "paused" || phaseRef.current === "summary") {
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
      if (phaseRef.current !== "running" && phaseRef.current !== "paused" && phaseRef.current !== "summary") {
        phaseRef.current = "ready";
        setPhase("ready");
        setSongSelectionStep("detail");
      }
    }
  }, [gameMode, initialSongId, isSongPlayRoute, returnToSongList]);

  const playNextSong = useCallback((): void => {
    const currentIndex = STAFF_GAME_SONGS.findIndex((song) => song.id === selectedSongIdRef.current);
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

  const openGameDialog = useCallback((nextDialog: Exclude<GameDialog, null>): void => {
    if (phaseRef.current === "running") pauseRound();
    setSettingsDraft(settingsRef.current);
    setDialog(nextDialog);
  }, [pauseRound]);

  const closeGameDialog = useCallback((): void => {
    toast.dismiss(PHYSICAL_INPUT_NOTICE_ID);
    setDialog(null);
  }, []);

  const selectInputMode = useCallback((inputMode: StaffGameSettings["inputMode"]): void => {
    setSettingsDraft((current) => ({ ...current, inputMode }));
    if (inputMode === "physical") {
      toast.error(PHYSICAL_INPUT_NOTICE, { id: PHYSICAL_INPUT_NOTICE_ID, duration: 6_000 });
    } else {
      toast.dismiss(PHYSICAL_INPUT_NOTICE_ID);
    }
  }, []);

  const applyGameSettings = useCallback((): void => {
    const midiAvailable = supportsMidi(midi.status);
    const nextSettings: StaffGameSettings = {
      ...settingsDraft,
      inputMode: settingsDraft.inputMode === "virtual" && virtualKeyboardAvailable
        ? "virtual"
        : settingsDraft.inputMode === "midi" && midiAvailable
          ? "midi"
          : "physical",
      difficulty: GAME_DIFFICULTIES.some((item) => item.id === settingsDraft.difficulty) ? settingsDraft.difficulty : "normal",
    };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setGameSoundsEnabled(nextSettings.audioByMode[gameMode].soundEffectsEnabled);
    if (nextSettings.inputMode === "virtual") microphone.stop();
    closeGameDialog();
  }, [closeGameDialog, gameMode, microphone.stop, midi.status, settingsDraft, virtualKeyboardAvailable]);

  const handleVirtualKey = useCallback((pitch: PianoKeyName, source: "screen-keyboard" | "computer-keyboard" = "screen-keyboard"): void => {
    if (phaseRef.current !== "running") return;
    if (
      settingsRef.current.inputMode === "virtual" &&
      settingsRef.current.audioByMode[gameModeRef.current].pianoSoundEnabled
    ) {
      void playVirtualPianoNote(pitch, 4).catch(() => undefined);
    }
    const pitchClass = PITCH_NAMES.indexOf(pitch);
    handleRecognizedAnswer({ noteName: pitch[0] as NoteName, octave: 4, midiNoteNumber: 60 + pitchClass, source });
  }, [handleRecognizedAnswer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isEditableTarget = target instanceof Element && Boolean(target.closest("input, select, textarea, [contenteditable='true'], [role='dialog']"));
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
      } else if (event.code === "Space" && !event.repeat && !dialog && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        if (target instanceof Element && target.closest("input, select, textarea, [contenteditable='true']")) return;
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
  const selectedSong = STAFF_GAME_SONGS.find((song) => song.id === selectedSongId) ?? STAFF_GAME_SONGS[0];
  const selectedSongPreviewNote = { ...gameNoteFromMidi(selectedSong.noteMidis[0]), token: 0, centerX: 0 };
  const selectedSongRecord = songProgress[selectedSong.id] ?? { bestScore: 0, bestAccuracy: 0, bestStars: 0, maxCombo: 0, plays: 0 };
  const isSongMode = gameMode === "songs";
  const shouldCelebrateSummary = score > 0 && (isSongMode || earnedStars > 0);
  const songProgressRatio = selectedSong.noteMidis.length > 0 ? songNotesCompleted / selectedSong.noteMidis.length : 0;
  const songAccuracy = selectedSong.noteMidis.length > 0 ? Math.round(songFirstTryHits * 100 / selectedSong.noteMidis.length) : 0;
  const activeProgress = isSongMode ? songProgressRatio : levelProgress;
  const midiOptionAvailable = supportsMidi(midi.status);
  const remainingSeconds = Math.max(0, Math.ceil((gameDurationMs - elapsedMs) / 1000));
  const gameArtStyle = {
    "--staff-game-bg-desktop": `url("${gameBackgroundDesktop}")`,
    "--staff-game-bg-mobile": `url("${gameBackgroundMobile}")`,
    "--staff-game-hud-frame": `url("${hudFrameArt}")`,
    "--staff-game-modal-frame": `url("${modalFrameArt}")`,
    "--staff-game-primary-button": `url("${buttonPrimaryArt}")`,
    "--staff-game-secondary-button": `url("${buttonSecondaryArt}")`,
  } as CSSProperties;
  const microphoneReadyText = microphone.isListening
    ? "麦克风已连接，可以开始听音"
    : microphone.status === "requesting"
      ? "正在连接麦克风…"
      : microphone.error
        ? "麦克风权限或设备需要处理"
        : "点击开始后请求麦克风权限";
  const inputStatusText = settings.inputMode === "virtual" ? "已选择虚拟琴键" : microphoneReadyText;
  const gameInputStatusText = settings.inputMode === "virtual"
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
  const showVirtualKeyboard = virtualKeyboardAvailable && settings.inputMode === "virtual" && (phase === "running" || phase === "paused");
  const mascotAction: StaffGameMascotAction = phase === "paused"
    ? "pause"
    : phase === "running" || (phase === "ready" && !isSongMode && mascotReaction.action === "cheer")
      ? mascotReaction.action
      : "idle";
  const pauseControlDisabled = (phase !== "running" && phase !== "paused") || isStarting;

  if (resourceLoadState !== "ready") {
    return (
      <section aria-busy={resourceLoadState === "loading"} className="practice-shell staff-game-shell staff-game-loading-shell" aria-label="正在准备五线谱闯关">
        <div className="staff-game-loading-card" role={resourceLoadState === "loading" ? "status" : undefined} aria-live="polite">
          {resourceLoadState === "loading" ? <span aria-hidden="true" className="staff-game-loading-spinner" /> : null}
          <strong>{resourceLoadState === "loading" ? "正在加载游戏素材" : "部分游戏素材未能加载"}</strong>
          <span>{resourceLoadState === "loading"
            ? resourceLoadRetryCount > 0
              ? `部分素材未就绪，正在自动重试（${resourceLoadRetryCount}/${STAFF_GAME_RESOURCE_MAX_RETRIES}）`
              : "素材加载完成后即可开始"
            : `已自动重试 ${STAFF_GAME_RESOURCE_MAX_RETRIES} 次，请检查网络连接后重试`}</span>
          {resourceLoadState === "error" ? (
            <button className="staff-game-loading-retry" onClick={() => setResourceLoadAttempt((attempt) => attempt + 1)} type="button">重新加载</button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="practice-shell staff-game-shell" aria-label="五线谱闯关游戏">
        <div className="staff-game-scene" ref={sceneRef} style={gameArtStyle}>
          <StaffGameErrorFlash active={errorFlashActive} />
          <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-a" draggable="false" src={cloudDecorationOne} />
          <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-b" draggable="false" src={cloudDecorationTwo} />
          <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-c" draggable="false" src={cloudDecorationThree} />
          {phase === "ready" && !isSongMode && settings.gameEffectsEnabled ? (
            <div aria-hidden="true" className="staff-game-waiting-cloud-layer">
              <img className="staff-game-waiting-cloud cloud-a" draggable="false" src={cloudDecorationOne} />
              <img className="staff-game-waiting-cloud cloud-b is-reversed" draggable="false" src={cloudDecorationTwo} />
              <img className="staff-game-waiting-cloud cloud-c" draggable="false" src={cloudDecorationThree} />
              <img className="staff-game-waiting-cloud cloud-d is-reversed" draggable="false" src={cloudDecorationOne} />
              <img className="staff-game-waiting-cloud cloud-e" draggable="false" src={cloudDecorationTwo} />
            </div>
          ) : null}
          {settings.gameEffectsEnabled ? <StaffGameRushSpeedLines bubbleLane={rushBubbleSpeedLineLane} /> : null}
        {settings.gameEffectsEnabled ? <div aria-hidden="true" className="staff-game-rush-vignette" /> : null}
        {settings.gameEffectsEnabled ? <StaffGameParticles /> : null}
        {settings.gameEffectsEnabled ? <StaffGameShootingStar /> : null}
        {rushScoreFlights.map((flight) => (
          <span
            aria-hidden="true"
            className={`staff-game-rush-score-flight${flight.ready ? " is-ready" : ""}${phase === "paused" ? " is-paused" : ""}`}
            key={`rush-score-${flight.token}`}
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target) completeRushScoreFlight(flight.token, flight.points);
            }}
            style={{
              left: flight.left,
              top: flight.top,
              "--rush-score-dx": `${flight.deltaX}px`,
              "--rush-score-dy": `${flight.deltaY}px`,
            } as CSSProperties}
          >+{flight.points}</span>
        ))}
        <StaffGameHud
          activeProgress={activeProgress}
          currentRoundStars={currentRoundStars}
          displayedScore={displayedScore}
          historyLabel={isSongMode ? "歌曲最佳" : "历史最高"}
          historyStars={isSongMode ? selectedSongRecord.bestStars : progress.bestStars[level - 1]}
          isSongMode={isSongMode}
          medalLabel={isSongMode
            ? `${selectedSong.title}，已完成 ${songNotesCompleted} 音，共 ${selectedSong.noteMidis.length} 音`
            : `第 ${level} 关，当前获得 ${currentRoundStars} 颗星`}
          onOpenLevels={() => openGameDialog("levels")}
          progressLabel={isSongMode ? "歌曲" : "LEVEL"}
          progressValue={isSongMode ? `${Math.floor(songProgressRatio * 100)}%` : level}
          rushModeActive={rushModeActive}
          scoreDetail={isSongMode
            ? `最佳 ${selectedSongRecord.bestScore}　·　${songNotesCompleted}/${selectedSong.noteMidis.length} 音　·　${songAccuracy}%`
            : `最高 ${progress.bestScores[level - 1]}${phase === "ready" ? "" : `　·　${remainingSeconds} 秒`}`}
          scoreLabel={isSongMode ? "本曲得分" : phase === "summary" ? "本局得分" : "本关得分"}
          scoreValueRef={scoreValueRef}
          showLevelJump={!isSongMode && !rushModeActive}
          songSelectionHeaderTitle={songSelectionStep
            ? songSelectionStep === "detail" ? selectedSong.title : "选择一首歌曲"
            : null}
          starImage={starParticleArt}
        />

        <div className={`staff-game-playfield${phase === "paused" ? " is-paused" : ""}${preserveRushBubbleScreenTop ? " is-rush-mode" : ""}${rushBubbleScreenTopStart?.token === target?.token ? " has-screen-top-rush-bubble" : ""}`} ref={playfieldRef}>
          <div aria-hidden="true" className="staff-game-scene-glow" />
          {(!songSelectionStep && (phase === "ready" || phase === "running" || phase === "paused")) ? (
            <div className={`staff-game-mascot-anchor${settings.gameEffectsEnabled ? " effects-enabled" : ""}${phase === "ready" && !isSongMode ? " has-greeting" : ""}`}>
              {phase === "ready" && !isSongMode ? <span aria-hidden="true" className={`staff-game-mascot-greeting${settings.gameEffectsEnabled ? " is-animated" : ""}`}>Hi~</span> : null}
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
              style={{
                animationDuration: `${activeBubbleDurationMs}ms`,
                left: `${target.centerX}px`,
                ...(rushBubbleScreenTopStart?.token === target.token
                  ? { "--staff-game-bubble-start-top": `${rushBubbleScreenTopStart.top}px` }
                  : {}),
              } as CSSProperties}
            >
              <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={bubbleShell} />
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
              <span><strong>{comboIndicator.count}</strong><small>连击</small></span>
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
              {settings.gameEffectsEnabled ? Array.from({ length: BURST_STAR_COUNT }, (_, index) => {
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
                  <img alt="" className="staff-game-burst-star" draggable="false" key={index} src={starParticleArt} style={style} />
                );
              }) : null}
            </div>
          ) : null}

          {phase === "ready" && songSelectionStep === "list" ? (
            <StaffGameReadyPanel
              bubbleImage={bubbleShell}
              onSelectSong={selectSong}
              songProgress={songProgress}
              songs={STAFF_GAME_SONGS}
              starImage={starParticleArt}
              variant="song-list"
            />
          ) : null}

          {phase === "ready" && songSelectionStep === "detail" ? (
            <StaffGameReadyPanel
              bubbleImage={bubbleShell}
              isStarting={isStarting}
              onBackToSongList={handleSongSelectionBack}
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
              bestStars={progress.bestStars[level - 1]}
              bubbleImage={bubbleShell}
              focusNote={focusNote}
              inputMode={settings.inputMode}
              inputStatusState={gameInputStatusState}
              inputStatusText={gameInputStatusText}
              isStarting={isStarting}
              maxCombo={progress.maxCombos[level - 1]}
              onStartLevel={() => void beginRound()}
              starImage={starParticleArt}
              variant="level"
            />
          ) : null}

          {phase === "summary" && typeof document !== "undefined" ? (
            <StaffGameSummaryDialog
              accuracy={summaryAccuracy}
              ariaLabel={isSongMode ? `${selectedSong.title} 演奏结算` : `第 ${level} 关结算`}
              comboCount={summaryComboCount}
              earnedStars={earnedStars}
              fireworks={settings.gameEffectsEnabled ? <StaffGameFireworks image={summaryFireworksArt} /> : null}
              gameArtStyle={gameArtStyle}
              gameEffectsEnabled={settings.gameEffectsEnabled}
              isFinalLevel={level >= GAME_LEVEL_COUNT}
              isNewComboRecord={roundRecordsAtStartRef.current.maxCombo > 0 && maxCombo > roundRecordsAtStartRef.current.maxCombo}
              isNewScoreRecord={roundRecordsAtStartRef.current.score > 0 && score > roundRecordsAtStartRef.current.score}
              isSongMode={isSongMode}
              level={level}
              levelBannerImage={summaryLevelBannerArt}
              mascot={(
                <StaffGameMascot
                  action={shouldCelebrateSummary ? "celebration" : "summarySad"}
                  animate={settings.gameEffectsEnabled}
                  className="staff-game-summary-mascot"
                  token={0}
                />
              )}
              onAdvanceLevel={() => advanceLevel(level + 1)}
              onPlayNextSong={playNextSong}
              onReturnToSongList={returnToSongList}
              onRetry={retryLevel}
              revealedStars={revealedSummaryStars}
              score={summaryScoreCount}
              songTitle={selectedSong.title}
              starImage={starParticleArt}
              hasNextSong={STAFF_GAME_SONGS[STAFF_GAME_SONGS.length - 1]?.id !== selectedSong.id}
            />
          ) : null}
        </div>

        {showVirtualKeyboard ? (
          <div aria-label="虚拟钢琴键盘 C 到 B，八度不限" className={`staff-game-virtual-keyboard${phase === "paused" ? " is-paused" : ""}`} role="group">
            <div className="staff-game-keybed">
              {NOTE_NAMES.map((note) => (
                <button
                  aria-label={`${note} 音键，不限八度`}
                  className="staff-game-virtual-key"
                  disabled={phase === "paused"}
                  key={note}
                  onClick={() => handleVirtualKey(note)}
                  type="button"
                >
                  {settings.displayMode === "none" ? null : <span>{virtualKeyLabel(note, settings.displayMode)}</span>}
                </button>
              ))}
              {/* Product choice: black keys have no visible labels; their note names remain available to assistive technology. */}
              {BLACK_KEY_NOTES.map(({ pitch, className }) => (
                <button
                  aria-label={`${pitch.replace("#", "♯")} 音键，不限八度`}
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
        <footer className={`staff-game-controls${touchGameLayout ? " is-touch-layout" : ""}${isSongMode ? " is-song-mode" : ""}`}>
          {!(isSongMode && songSelectionStep === "detail") ? (
            <button
              aria-label={!isSongMode ? "返回首页" : isSongPlayRoute ? "返回歌曲选择" : "返回上一页"}
              title={!isSongMode ? "返回首页" : isSongPlayRoute ? "返回歌曲选择" : "返回上一页"}
              className="staff-game-action-button staff-game-back-button is-desktop-control"
              onClick={handleSongSelectionBack}
              type="button"
            ><img alt="" aria-hidden="true" src={actionReturnArt} /></button>
          ) : null}
          <div aria-live="polite" className="staff-game-feedback is-desktop-control">
            {phase === "ready" || showVirtualKeyboard ? null : settings.inputMode === "physical" && microphone.isListening ? <><Volume2 aria-hidden="true" size={16} /><span>{feedback || microphone.detectedNote || "麦克风已连接"}</span></> : <span>{feedback}</span>}
          </div>
          <div aria-label="游戏操作" className="staff-game-toolbar is-desktop-control">
            <button aria-label="游戏提示" title="游戏提示" className="staff-game-action-button" onClick={() => openGameDialog("help")} type="button"><img alt="" aria-hidden="true" src={actionHelpArt} /></button>
            <button aria-label="游戏设置" title="游戏设置" className="staff-game-action-button" onClick={() => openGameDialog("settings")} type="button"><img alt="" aria-hidden="true" src={actionSettingsArt} /></button>
            <button
              aria-label={phase === "paused" ? isSongMode ? "继续演奏" : "继续闯关" : isSongMode ? "暂停演奏" : "暂停闯关"}
              title={phase === "paused" ? isSongMode ? "继续演奏" : "继续闯关" : isSongMode ? "暂停演奏" : "暂停闯关"}
              className="staff-game-action-button"
              disabled={pauseControlDisabled}
              onClick={() => phase === "running" ? pauseRound() : void resumeRound()}
              type="button"
            ><img alt="" aria-hidden="true" src={phase === "paused" ? actionResumeArt : actionPauseArt} /></button>
          </div>
          <div aria-label="游戏操作" className="staff-game-toolbar is-mobile-control">
            {!(isSongMode && songSelectionStep === "detail") ? (
              <button
                aria-label={!isSongMode ? "返回首页" : isSongPlayRoute ? "返回歌曲选择" : "返回上一页"}
                title={!isSongMode ? "返回首页" : isSongPlayRoute ? "返回歌曲选择" : "返回上一页"}
                className="staff-game-action-button"
                onClick={handleSongSelectionBack}
                type="button"
              ><img alt="" aria-hidden="true" src={actionReturnArt} /></button>
            ) : null}
            <button aria-label="游戏提示" title="游戏提示" className="staff-game-action-button" onClick={() => openGameDialog("help")} type="button"><img alt="" aria-hidden="true" src={actionHelpArt} /></button>
            <button aria-label="游戏设置" title="游戏设置" className="staff-game-action-button" onClick={() => openGameDialog("settings")} type="button"><img alt="" aria-hidden="true" src={actionSettingsArt} /></button>
            <button
              aria-label={phase === "paused" ? isSongMode ? "继续演奏" : "继续闯关" : isSongMode ? "暂停演奏" : "暂停闯关"}
              title={phase === "paused" ? isSongMode ? "继续演奏" : "继续闯关" : isSongMode ? "暂停演奏" : "暂停闯关"}
              className="staff-game-action-button"
              disabled={pauseControlDisabled}
              onClick={() => phase === "running" ? pauseRound() : void resumeRound()}
              type="button"
            ><img alt="" aria-hidden="true" src={phase === "paused" ? actionResumeArt : actionPauseArt} /></button>
          </div>
        </footer>
        <StaffGameDialogs
          applyGameSettings={applyGameSettings}
          bestStars={progress.bestStars}
          closeGameDialog={closeGameDialog}
          dialog={dialog}
          draftAudioSettings={draftAudioSettings}
          draftDifficulty={draftDifficulty}
          gameArtStyle={gameArtStyle}
          isSettingsDialogShaking={isSettingsDialogShaking}
          isSongMode={isSongMode}
          jumpToLevel={jumpToLevel}
          level={level}
          midi={midi}
          midiOptionAvailable={midiOptionAvailable}
          onDifficultyChange={(difficulty) => setSettingsDraft((current) => ({ ...current, difficulty }))}
          onDisplayModeChange={(displayMode) => setSettingsDraft((current) => ({ ...current, displayMode }))}
          onSettingsDialogAnimationEnd={(event) => {
            if (event.animationName !== "staff-game-settings-dialog-wobble") return;
            settingsDialogShakeLockRef.current = false;
            setIsSettingsDialogShaking(false);
          }}
          onToggleBackgroundMusic={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { backgroundMusicEnabled: !current.audioByMode[gameMode].backgroundMusicEnabled }))}
          onToggleGameEffects={() => setSettingsDraft((current) => ({ ...current, gameEffectsEnabled: !current.gameEffectsEnabled }))}
          onTogglePianoSound={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { pianoSoundEnabled: !current.audioByMode[gameMode].pianoSoundEnabled }))}
          onToggleSoundEffects={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { soundEffectsEnabled: !current.audioByMode[gameMode].soundEffectsEnabled }))}
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
        isStarting={isStarting}
        onDisableEffects={() => {
          const nextSettings = { ...settingsRef.current, gameEffectsEnabled: false };
          settingsRef.current = nextSettings;
          setSettings(nextSettings);
          setSettingsDraft(nextSettings);
          setShowLowFpsPrompt(false);
          void resumeRound();
        }}
        onDismissInputError={() => setGameError("")}
        onKeepEffects={() => { setShowLowFpsPrompt(false); void resumeRound(); }}
        onResume={() => void resumeRound()}
        onRetryInput={() => void (phase === "paused" ? resumeRound() : beginRound())}
        onRetryLevel={retryLevel}
        showLowFpsPrompt={showLowFpsPrompt}
        showPauseDialog={phase === "paused" && dialog === null && !gameError}
        touchGameLayout={touchGameLayout}
      />
    </section>
  );
}
