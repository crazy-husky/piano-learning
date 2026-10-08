import { Keyboard, Mic, Music2, Play, RotateCcw, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { unlockAudio } from "../audio/piano";
import { playStaffGameSound, playStaffGameStarReveal, preloadStaffGameSounds, setStaffGameSoundsEnabled } from "../audio/staffGameSounds";
import type { PracticeAnswerInput } from "../domain/answerInput";
import type { NoteName, PianoKeyName } from "../domain/types";
import type { MidiInputController } from "../midi/useMidiInput";
import type { MidiAccessStatus } from "../midi/midiInput";
import type { usePracticeMicrophoneInput } from "../vocal-pitch/usePracticeMicrophoneInput";
import gameBackgroundDesktop from "../assets/staff-game/backgrounds/meadow-desktop.webp";
import gameBackgroundMobile from "../assets/staff-game/backgrounds/meadow-mobile.webp";
import gameBackgroundMusic from "../assets/staff-game/audio/match-three-bgm.mp3";
import mascotCheer from "../assets/staff-game/characters/mascot-cheer.webp";
import mascotIdle from "../assets/staff-game/characters/mascot-idle.webp";
import mascotWink from "../assets/staff-game/characters/mascot-wink.webp";
import bubbleShell from "../assets/staff-game/effects/bubble-shell-empty-center.webp";
import cloudDecorationOne from "../assets/staff-game/effects/cloud-decoration-1.webp";
import cloudDecorationTwo from "../assets/staff-game/effects/cloud-decoration-2.webp";
import cloudDecorationThree from "../assets/staff-game/effects/cloud-decoration-3.webp";
import notationC4Preview from "../assets/staff-game/notation/treble-staff-c4-note.webp";
import buttonPrimaryArt from "../assets/staff-game/ui/button-primary-base.webp";
import buttonSecondaryArt from "../assets/staff-game/ui/button-secondary-base.webp";
import actionHelpArt from "../assets/staff-game/ui/action-help.webp";
import actionPauseArt from "../assets/staff-game/ui/action-pause.webp";
import actionResumeArt from "../assets/staff-game/ui/action-resume.webp";
import actionReturnArt from "../assets/staff-game/ui/action-return.webp";
import actionSettingsArt from "../assets/staff-game/ui/action-settings.webp";
import hudFrameArt from "../assets/staff-game/ui/hud-frame.webp";
import modalFrameArt from "../assets/staff-game/ui/modal-frame.webp";
import starParticleArt from "../assets/staff-game/ui/star-particle.webp";
import settingsBowArt from "../assets/staff-game/ui/settings-bow.webp";
import levelJumpDecorationArt from "../assets/staff-game/ui/level-jump-decoration.webp";
import summaryLevelBannerArt from "../assets/staff-game/ui/summary-level-banner.webp";
import summaryFireworksArt from "../assets/staff-game/ui/summary-fireworks.webp";

const STAFF_GAME_IMAGE_ASSETS = [
  gameBackgroundDesktop,
  gameBackgroundMobile,
  mascotCheer,
  mascotIdle,
  mascotWink,
  bubbleShell,
  cloudDecorationOne,
  cloudDecorationTwo,
  cloudDecorationThree,
  notationC4Preview,
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
  settingsBowArt,
  levelJumpDecorationArt,
  summaryLevelBannerArt,
  summaryFireworksArt,
];

const GAME_PROGRESS_KEY = "anki-note.staffGameProgress.v1";
const GAME_SETTINGS_KEY = "anki-note.staffGameSettings.v1";
const GAME_DURATION_MS = 25_000;
const BURST_STAR_COUNT = 14;
const GAME_LEVEL_COUNT = 60;
const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const PITCH_NAMES: PianoKeyName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WHITE_NOTE_MIDI_RANGE = { min: 29, max: 88 } as const;
const GAME_NOTE_PROGRESSION: Array<{ midi: number; name: PianoKeyName; octave: number }> = (() => {
  const pitchForMidi = (midi: number) => ({
    midi,
    name: PITCH_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  });
  const whiteNotes = Array.from({ length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 }, (_, index) =>
    pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index),
  ).filter((note) => !note.name.includes("#"));
  const blackNotes = Array.from({ length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 }, (_, index) =>
    pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index),
  ).filter((note) => note.name.includes("#"));
  return [
    ...whiteNotes.filter((note) => note.midi >= 60),
    ...whiteNotes.filter((note) => note.midi < 60).reverse(),
    ...blackNotes.filter((note) => note.midi >= 60),
    ...blackNotes.filter((note) => note.midi < 60).reverse(),
  ];
})();
const SOLFEGE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"] as const;
const DISPLAY_MODES: Array<{ id: GameDisplayMode; label: string; shortLabel: string }> = [
  { id: "note", label: "音名", shortLabel: "音" },
  { id: "solfege", label: "唱名", shortLabel: "唱" },
  { id: "number", label: "简谱", shortLabel: "简" },
  { id: "none", label: "无", shortLabel: "无" },
];
const GAME_DIFFICULTIES: Array<{
  id: GameDifficulty;
  label: string;
  bubbleDurationMs: number;
  comboWindowMs: number;
  correctPoints: number;
  comboBonusPoints: number;
}> = [
  { id: "easy", label: "简单", bubbleDurationMs: 4_900, comboWindowMs: 3_000, correctPoints: 8, comboBonusPoints: 1 },
  { id: "normal", label: "普通", bubbleDurationMs: 3_300, comboWindowMs: 2_200, correctPoints: 10, comboBonusPoints: 2 },
  { id: "hard", label: "困难", bubbleDurationMs: 2_700, comboWindowMs: 1_600, correctPoints: 12, comboBonusPoints: 3 },
  { id: "nightmare", label: "噩梦", bubbleDurationMs: 2_200, comboWindowMs: 1_000, correctPoints: 15, comboBonusPoints: 4 },
];
const STAR_THRESHOLDS = [36, 70, 110] as const;

type GameInputMode = "physical" | "virtual" | "midi";
type GameDisplayMode = "note" | "solfege" | "number" | "none";
type GameDifficulty = "easy" | "normal" | "hard" | "nightmare";
type GameDialog = "help" | "settings" | "levels" | null;

interface StaffGameSettings {
  inputMode: GameInputMode;
  displayMode: GameDisplayMode;
  difficulty: GameDifficulty;
  soundEffectsEnabled: boolean;
  backgroundMusicEnabled: boolean;
}

interface StaffGameProgress {
  bestScores: number[];
  bestStars: number[];
  maxCombos: number[];
  unlockedLevel: number;
}

interface GameNote {
  midi: number;
  name: PianoKeyName;
  octave: number;
  token: number;
  centerX: number;
}

interface BubbleBurst {
  token: number;
  x: number;
  y: number;
}

interface ComboIndicator {
  token: number;
  count: number;
  durationMs: number;
  left: number;
  top: number;
}

type MicrophoneController = Pick<
  ReturnType<typeof usePracticeMicrophoneInput>,
  "detectedNote" | "error" | "inputLevel" | "isListening" | "start" | "status" | "stop"
>;

interface StaffGameViewProps {
  microphone: MicrophoneController;
  midi: MidiInputController;
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
  };
}

function canUseVirtualKeyboard(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const isTouchIPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const narrowGameViewport = window.matchMedia("(max-width: 820px)").matches;
  return isTouchIPad || window.matchMedia("(pointer: coarse)").matches || narrowGameViewport;
}

function supportsMidi(status: MidiAccessStatus, virtualAvailable: boolean): boolean {
  return !virtualAvailable && status !== "unsupported" && status !== "insecure-context";
}

function defaultGameSettings(): StaffGameSettings {
  return { inputMode: "physical", displayMode: "note", difficulty: "normal", soundEffectsEnabled: true, backgroundMusicEnabled: true };
}

function readGameSettings(virtualAvailable: boolean, midiAvailable: boolean): StaffGameSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_SETTINGS_KEY) ?? "null") as (Partial<StaffGameSettings> & { speed?: unknown }) | null;
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
    return {
      inputMode,
      displayMode,
      difficulty: validDifficulty ? parsed!.difficulty as GameDifficulty : legacyDifficulty,
      soundEffectsEnabled: typeof parsed?.soundEffectsEnabled === "boolean" ? parsed.soundEffectsEnabled : base.soundEffectsEnabled,
      backgroundMusicEnabled: typeof parsed?.backgroundMusicEnabled === "boolean" ? parsed.backgroundMusicEnabled : base.backgroundMusicEnabled,
    };
  } catch {
    return defaultGameSettings();
  }
}

function saveGameSettings(settings: StaffGameSettings): void {
  try {
    localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this visit if storage is unavailable.
  }
}

function loadGameImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const finishLoading = (): void => {
      if (typeof image.decode !== "function") {
        settle();
        return;
      }
      void image.decode().then(
        () => settle(),
        () => settle(image.naturalWidth > 0 ? undefined : new Error(`Failed to decode ${source}`)),
      );
    };

    image.addEventListener("load", finishLoading, { once: true });
    image.addEventListener("error", () => settle(new Error(`Failed to load ${source}`)), { once: true });
    image.src = source;
    if (image.complete) {
      if (image.naturalWidth > 0) finishLoading();
      else settle(new Error(`Failed to load ${source}`));
    }
  });
}

async function preloadStaffGameImages(): Promise<number> {
  const results = await Promise.allSettled(STAFF_GAME_IMAGE_ASSETS.map(loadGameImage));
  return results.filter((result) => result.status === "rejected").length;
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
    return {
      bestScores: readArray(parsed.bestScores),
      bestStars: readArray(parsed.bestStars).map((stars) => Math.min(3, stars)),
      maxCombos: readArray(parsed.maxCombos),
      unlockedLevel: Math.max(1, Math.min(GAME_LEVEL_COUNT, Math.floor(Number(parsed.unlockedLevel) || base.unlockedLevel))),
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

function starsForScore(score: number): number {
  return STAR_THRESHOLDS.filter((threshold) => score >= threshold).length;
}

function shuffledNoteBag(level: number, previousMidi: number | null): Array<{ midi: number; name: PianoKeyName; octave: number }> {
  const bag = GAME_NOTE_PROGRESSION.slice(0, level).map((note) => ({ ...note }));
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  if (bag.length > 1 && bag[bag.length - 1].midi === previousMidi) {
    const nonRepeatingIndex = bag.findIndex((note) => note.midi !== previousMidi);
    [bag[nonRepeatingIndex], bag[bag.length - 1]] = [bag[bag.length - 1], bag[nonRepeatingIndex]];
  }
  return bag;
}

function randomBubbleCenterX(playfield: HTMLDivElement | null): number {
  if (!playfield || typeof window === "undefined" || playfield.clientWidth <= 0) return 0;
  const viewportWidth = window.innerWidth;
  const bubbleWidth = viewportWidth > 820
    ? Math.max(112, Math.min(viewportWidth * 0.11, 150))
    : Math.max(144, Math.min(viewportWidth * 0.22, 190));
  const edgePadding = viewportWidth > 820
    ? Math.max(72, Math.min(playfield.clientWidth * 0.14, 190))
    : Math.min(28, Math.max(20, playfield.clientWidth * 0.035));
  const availableWidth = Math.max(0, playfield.clientWidth - bubbleWidth - edgePadding * 2);
  return bubbleWidth / 2 + edgePadding + Math.random() * availableWidth;
}

function noteLabel(note: GameNote): string {
  return `${note.name}${note.octave}`;
}

function NoteStaff({ note }: { note: GameNote }): JSX.Element {
  const noteLetter = note.name[0] as NoteName;
  const diatonicStep = (note.octave - 4) * 7 + NOTE_NAMES.indexOf(noteLetter);
  const staffBottomStep = 2;
  const staffCenterStep = 6;
  const stepSpacing = 10.5;
  let displayStep = diatonicStep;
  while (displayStep < 0) displayStep += 7;
  while (displayStep > 12) displayStep -= 7;
  const octaveShift = Math.round((diatonicStep - displayStep) / 7);
  const octaveLabel = octaveShift === 0
    ? null
    : Math.abs(octaveShift) === 1
      ? octaveShift > 0 ? "8va" : "8vb"
      : `${Math.abs(octaveShift) * 7 + 1}${octaveShift > 0 ? "ma" : "mb"}`;
  const yForStep = (step: number): number => 100 + (staffCenterStep - step) * stepSpacing;
  const noteY = yForStep(displayStep);
  const ledgerSteps: number[] = [];
  if (displayStep <= 0) {
    for (let step = 0; step >= displayStep; step -= 2) ledgerSteps.push(step);
  } else if (displayStep > 11) {
    for (let step = 12; step <= displayStep; step += 2) ledgerSteps.push(step);
  }
  const stemGoesUp = displayStep <= staffCenterStep;
  const noteX = 132;
  const stemX = stemGoesUp ? noteX + 9 : noteX - 9;
  const stemEndY = yForStep(displayStep + (stemGoesUp ? 6 : -6));
  const accidental = note.name.includes("#") ? "♯" : note.name.includes("b") ? "♭" : null;
  const clefFontSize = stepSpacing * 8;
  const staffLines = [2, 4, 6, 8, 10];
  return (
    <svg aria-label={`${noteLabel(note)} 音符`} className="staff-game-note-staff" role="img" viewBox="0 0 190 200">
      {staffLines.map((step) => {
        const lineY = yForStep(step);
        return <line key={step} x1="18" x2="172" y1={lineY} y2={lineY} />;
      })}
      <line x1="18" x2="18" y1={yForStep(10)} y2={yForStep(2)} />
      <line x1="172" x2="172" y1={yForStep(10)} y2={yForStep(2)} />
      <text className="staff-game-clef" style={{ fontSize: clefFontSize }} x="18" y={yForStep(staffBottomStep) + clefFontSize * 0.22}>𝄞</text>
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

export function StaffGameView({ microphone, midi, onExit, onSessionActiveChange, onRegisterAnswerHandler }: StaffGameViewProps): JSX.Element {
  const [imageLoadState, setImageLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [imageLoadAttempt, setImageLoadAttempt] = useState(0);
  const [progress, setProgress] = useState<StaffGameProgress>(readProgress);
  const [level, setLevel] = useState(() => readProgress().unlockedLevel);
  const [phase, setPhase] = useState<"ready" | "running" | "paused" | "summary">("ready");
  const [virtualKeyboardAvailable, setVirtualKeyboardAvailable] = useState(canUseVirtualKeyboard);
  const [settings, setSettings] = useState<StaffGameSettings>(() => readGameSettings(
    canUseVirtualKeyboard(),
    supportsMidi(midi.status, canUseVirtualKeyboard()),
  ));
  const [settingsDraft, setSettingsDraft] = useState<StaffGameSettings>(settings);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const backgroundMusicRef = useRef<HTMLAudioElement>(null);
  const [target, setTarget] = useState<GameNote | null>(null);
  const [targetPopped, setTargetPopped] = useState(false);
  const [targetWrong, setTargetWrong] = useState(false);
  const [bubbleBurst, setBubbleBurst] = useState<BubbleBurst | null>(null);
  const [comboIndicator, setComboIndicator] = useState<ComboIndicator | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [earnedStars, setEarnedStars] = useState(0);
  const [revealedSummaryStars, setRevealedSummaryStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [gameError, setGameError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const targetRef = useRef<GameNote | null>(null);
  const playfieldRef = useRef<HTMLDivElement>(null);
  const targetElementRef = useRef<HTMLDivElement>(null);
  const targetPoppedRef = useRef(false);
  const comboRef = useRef(0);
  const comboResetTimeoutRef = useRef<number | null>(null);
  const comboTimerStartedAtRef = useRef<number | null>(null);
  const comboTimerRemainingRef = useRef(0);
  const scoreRef = useRef(0);
  const maxComboRef = useRef(0);
  const levelRef = useRef(level);
  const phaseRef = useRef(phase);
  const progressRef = useRef(progress);
  const settingsRef = useRef(settings);
  const midiRef = useRef(midi);
  const previousMidiRef = useRef<number | null>(null);
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

  useEffect(() => {
    let active = true;
    setImageLoadState("loading");
    void preloadStaffGameImages().then((failedCount) => {
      if (!active) return;
      setImageLoadState(failedCount === 0 ? "ready" : "error");
    });
    return () => {
      active = false;
    };
  }, [imageLoadAttempt]);

  phaseRef.current = phase;
  targetRef.current = target;
  targetPoppedRef.current = targetPopped;
  levelRef.current = level;
  progressRef.current = progress;
  settingsRef.current = settings;
  midiRef.current = midi;

  const difficulty = GAME_DIFFICULTIES.find((item) => item.id === settings.difficulty) ?? GAME_DIFFICULTIES[1];
  const bubbleDurationMs = difficulty.bubbleDurationMs;
  const draftDifficulty = GAME_DIFFICULTIES.find((item) => item.id === settingsDraft.difficulty) ?? GAME_DIFFICULTIES[1];

  const spawnTarget = useCallback((atGameMs: number): void => {
    if (phaseRef.current !== "running") return;
    if (noteBagRef.current.length === 0) {
      noteBagRef.current = shuffledNoteBag(levelRef.current, previousMidiRef.current);
    }
    targetTokenRef.current += 1;
    const next = {
      ...noteBagRef.current.pop()!,
      token: targetTokenRef.current,
      centerX: randomBubbleCenterX(playfieldRef.current),
    };
    previousMidiRef.current = next.midi;
    targetSpawnGameMsRef.current = atGameMs;
    targetRef.current = next;
    targetPoppedRef.current = false;
    setTarget(next);
    setTargetPopped(false);
    setTargetWrong(false);
  }, []);

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
    setComboIndicator(null);
  }, [clearComboTimer]);

  const restartComboTimer = useCallback((): void => {
    clearComboTimer();
    const comboWindowMs = GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty)?.comboWindowMs ?? 2_200;
    comboTimerRemainingRef.current = comboWindowMs;
    if (phaseRef.current !== "running") return;
    comboTimerStartedAtRef.current = performance.now();
    comboResetTimeoutRef.current = window.setTimeout(resetComboDisplay, comboWindowMs);
  }, [clearComboTimer, resetComboDisplay]);

  const persistRoundResult = useCallback((finalStars: number): void => {
    const index = levelRef.current - 1;
    const current = progressRef.current;
    const next: StaffGameProgress = {
      bestScores: current.bestScores.map((best, itemIndex) => itemIndex === index ? Math.max(best, scoreRef.current) : best),
      bestStars: current.bestStars.map((best, itemIndex) => itemIndex === index ? Math.max(best, finalStars) : best),
      maxCombos: current.maxCombos.map((best, itemIndex) => itemIndex === index ? Math.max(best, maxComboRef.current) : best),
      unlockedLevel: finalStars > 0 ? Math.max(current.unlockedLevel, Math.min(GAME_LEVEL_COUNT, levelRef.current + 1)) : current.unlockedLevel,
    };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const finishRound = useCallback((): void => {
    if (roundFinishedRef.current) return;
    roundFinishedRef.current = true;
    const finalStars = starsForScore(scoreRef.current);
    if (finalStars > 0 && settingsRef.current.soundEffectsEnabled && settingsRef.current.inputMode !== "physical") {
      playStaffGameSound("levelClear");
    }
    setEarnedStars(finalStars);
    resetComboDisplay();
    targetRef.current = null;
    setTarget(null);
    setBubbleBurst(null);
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = null;
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    waitingForNextTargetRef.current = false;
    phaseRef.current = "summary";
    setPhase("summary");
    setFeedback("本局结束 · 可重试或进入下一关");
    persistRoundResult(finalStars);
    microphone.stop();
    onSessionActiveChange(false);
  }, [microphone.stop, onSessionActiveChange, persistRoundResult, resetComboDisplay]);

  const handleRecognizedAnswer = useCallback((answer: PracticeAnswerInput): void => {
    if (phaseRef.current !== "running" || !targetRef.current) return;
    if (settingsRef.current.inputMode === "virtual" && answer.source !== "screen-keyboard") return;
    if (settingsRef.current.inputMode === "physical" && answer.source !== "microphone") return;
    if (settingsRef.current.inputMode === "midi" && answer.source !== "midi") return;
    const currentTarget = targetRef.current;
    const midi = answer.midiNoteNumber;
    if (midi === undefined) return;
    const isCorrect = settingsRef.current.inputMode === "virtual"
      ? answer.noteName === currentTarget.name[0]
      : midi === currentTarget.midi;
    if (isCorrect) {
      if (targetPoppedRef.current) return;
      playStaffGameSound("bubblePop");
      targetPoppedRef.current = true;
      targetRef.current = null;
      setTargetPopped(true);
      const fieldBounds = playfieldRef.current?.getBoundingClientRect();
      const bubbleBounds = targetElementRef.current?.getBoundingClientRect();
      if (fieldBounds && bubbleBounds) {
        setBubbleBurst({
          token: currentTarget.token,
          x: bubbleBounds.left + bubbleBounds.width / 2 - fieldBounds.left,
          y: bubbleBounds.top + bubbleBounds.height / 2 - fieldBounds.top,
        });
      }
      const fieldWidth = fieldBounds?.width ?? window.innerWidth;
      const fieldHeight = fieldBounds?.height ?? window.innerHeight;
      const desiredLeft = fieldBounds && bubbleBounds
        ? bubbleBounds.left - fieldBounds.left - 126
        : currentTarget.centerX - 126;
      const desiredTop = fieldBounds && bubbleBounds
        ? bubbleBounds.top - fieldBounds.top - 50
        : 10;
      setComboIndicator({
        token: currentTarget.token,
        count: comboRef.current + 1,
        durationMs: GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty)?.comboWindowMs ?? 2_200,
        left: Math.max(8, Math.min(Math.max(8, fieldWidth - 132), desiredLeft)),
        top: Math.max(8, Math.min(Math.max(8, fieldHeight - 52), desiredTop)),
      });
      restartComboTimer();
      if (fieldBounds && bubbleBounds) {
        if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
        burstTimeoutRef.current = window.setTimeout(() => {
          setBubbleBurst(null);
          burstTimeoutRef.current = null;
        }, 760);
      }
      const nextCombo = comboRef.current + 1;
      if (nextCombo >= 3 && nextCombo % 3 === 0) playStaffGameSound("comboStreak");
      comboRef.current = nextCombo;
      maxComboRef.current = Math.max(maxComboRef.current, nextCombo);
      const scorePreset = GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty) ?? GAME_DIFFICULTIES[1];
      const points = scorePreset.correctPoints + Math.min(5, nextCombo - 1) * scorePreset.comboBonusPoints;
      scoreRef.current += points;
      setCombo(nextCombo);
      setMaxCombo(maxComboRef.current);
      setScore(scoreRef.current);
      setFeedback(`+${points} · ${noteLabel(currentTarget)}`);
      if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
      nextTargetTimeoutRef.current = window.setTimeout(() => {
        nextTargetTimeoutRef.current = null;
        if (phaseRef.current !== "running") {
          waitingForNextTargetRef.current = true;
          return;
        }
        const gameNow = elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
        spawnTarget(gameNow);
      }, 350);
      return;
    }

    if (targetWrong) return;
    resetComboDisplay();
    setTargetWrong(true);
    playStaffGameSound("noteMissed");
    setFeedback(`听到 ${answer.noteName}${answer.octave ?? ""}，再试一次`);
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    wrongClearTimeoutRef.current = window.setTimeout(() => setTargetWrong(false), 460);
  }, [resetComboDisplay, restartComboTimer, spawnTarget, targetWrong]);

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
    preloadStaffGameSounds();
  }, []);

  useEffect(() => {
    if (phase !== "summary") {
      setRevealedSummaryStars(0);
      return undefined;
    }

    setRevealedSummaryStars(0);
    const revealTimeouts = [260, 760, 1260].map((delay, index) => window.setTimeout(() => {
      setRevealedSummaryStars(index + 1);
      playStaffGameStarReveal(index, settings.soundEffectsEnabled && settings.inputMode !== "physical");
    }, delay));

    return () => revealTimeouts.forEach(window.clearTimeout);
  }, [phase, settings.inputMode, settings.soundEffectsEnabled]);

  useEffect(() => {
    setStaffGameSoundsEnabled(settings.soundEffectsEnabled && settings.inputMode !== "physical");
    saveGameSettings(settings);
  }, [settings]);

  useEffect(() => {
    const audio = backgroundMusicRef.current;
    if (!audio) return undefined;
    audio.volume = 0.16;
    const shouldPlay = imageLoadState === "ready" && phase === "running" && settings.backgroundMusicEnabled && settings.inputMode !== "physical";

    const removeUnlockListeners = (): void => {
      document.removeEventListener("pointerdown", unlockMusic);
      document.removeEventListener("keydown", unlockMusic);
    };
    const unlockMusic = (): void => {
      if (!shouldPlay || !audio.paused) return;
      void audio.play().catch(() => undefined);
    };

    if (shouldPlay) {
      audio.addEventListener("play", removeUnlockListeners, { once: true });
      document.addEventListener("pointerdown", unlockMusic);
      document.addEventListener("keydown", unlockMusic);
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }

    return () => {
      removeUnlockListeners();
      audio.removeEventListener("play", removeUnlockListeners);
      audio.pause();
    };
  }, [imageLoadState, phase, settings.backgroundMusicEnabled, settings.inputMode]);

  useEffect(() => {
    const syncVirtualKeyboardAvailability = (): void => {
      const available = canUseVirtualKeyboard();
      setVirtualKeyboardAvailable(available);
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

    if (phase !== "running" || !comboIndicator || comboResetTimeoutRef.current !== null) return;
    const remainingMs = comboTimerRemainingRef.current;
    if (remainingMs <= 0) {
      resetComboDisplay();
      return;
    }
    comboTimerStartedAtRef.current = performance.now();
    comboResetTimeoutRef.current = window.setTimeout(resetComboDisplay, remainingMs);
  }, [clearComboTimer, comboIndicator, phase, resetComboDisplay]);

  useEffect(() => () => {
    microphone.stop();
    onSessionActiveChange(false);
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    if (comboResetTimeoutRef.current !== null) window.clearTimeout(comboResetTimeoutRef.current);
  }, [microphone.stop, onSessionActiveChange]);

  useEffect(() => {
    if (phase !== "running") return undefined;
    let frame = 0;
    let lastUiUpdateAt = 0;
    const tick = (now: number): void => {
      const gameTime = elapsedBeforeRunRef.current + now - runSegmentStartedAtRef.current;
      if (now - lastUiUpdateAt >= 100) {
        lastUiUpdateAt = now;
        setElapsedMs(Math.min(GAME_DURATION_MS, gameTime));
      }
      if (gameTime >= GAME_DURATION_MS) {
        setElapsedMs(GAME_DURATION_MS);
        finishRound();
        return;
      }
      if (targetRef.current && !targetPoppedRef.current && gameTime - targetSpawnGameMsRef.current >= bubbleDurationMs) {
        targetRef.current = null;
        setTarget(null);
        playStaffGameSound("noteMissed");
        resetComboDisplay();
        setFeedback("气泡飘走了，连击中断");
        if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
        nextTargetTimeoutRef.current = window.setTimeout(() => {
          nextTargetTimeoutRef.current = null;
          if (phaseRef.current !== "running") {
            waitingForNextTargetRef.current = true;
            return;
          }
          const nextGameTime = elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
          spawnTarget(nextGameTime);
        }, 180);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [bubbleDurationMs, finishRound, phase, resetComboDisplay, spawnTarget]);

  const resetRoundState = useCallback((): void => {
    if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
    nextTargetTimeoutRef.current = null;
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    wrongClearTimeoutRef.current = null;
    if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = null;
    waitingForNextTargetRef.current = false;
    targetRef.current = null;
    targetPoppedRef.current = false;
    noteBagRef.current = [];
    previousMidiRef.current = null;
    roundFinishedRef.current = false;
    setTarget(null);
    setBubbleBurst(null);
    setTargetPopped(false);
    setTargetWrong(false);
    setScore(0);
    scoreRef.current = 0;
    resetComboDisplay();
    setMaxCombo(0);
    maxComboRef.current = 0;
    setElapsedMs(0);
    elapsedBeforeRunRef.current = 0;
    setFeedback("");
    setGameError("");
  }, [resetComboDisplay]);

  const connectMidiForRound = useCallback(async (): Promise<boolean> => {
    const controller = midiRef.current;
    if (!supportsMidi(controller.status, virtualKeyboardAvailable)) {
      setGameError("当前环境不支持 MIDI 输入，请改用麦克风或虚拟琴键。");
      return false;
    }
    await controller.connect();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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
  }, [virtualKeyboardAvailable]);

  const beginRound = useCallback(async (): Promise<void> => {
    if (isStarting) return;
    setIsStarting(true);
    setGameError("");
    try {
      await unlockAudio().catch(() => undefined);
      if (settingsRef.current.inputMode === "physical") {
        let started = false;
        try {
          started = await microphone.start({ includeAccidentals: true });
        } catch (error) {
          const reason = error instanceof Error ? `（${error.message}）` : "";
          setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
          return;
        }
        if (!started) {
          const reason = microphone.error ? `（${microphone.error}）` : "";
          setGameError(`无法连接麦克风${reason}。请在浏览器的网站权限中允许麦克风，再重新尝试。`);
          return;
        }
        playStaffGameSound("microphoneReady");
      } else if (settingsRef.current.inputMode === "midi") {
        if (!await connectMidiForRound()) return;
        microphone.stop();
      } else {
        microphone.stop();
      }
      resetRoundState();
      runSegmentStartedAtRef.current = performance.now();
      setFeedback(settingsRef.current.inputMode === "virtual" ? "点击琴键，弹出对应音符" : settingsRef.current.inputMode === "midi" ? "弹奏 MIDI 键盘，弹出对应音符" : "聆听麦克风，弹出对应音符");
      phaseRef.current = "running";
      setPhase("running");
      spawnTarget(0);
    } catch (error) {
      const reason = error instanceof Error ? `（${error.message}）` : "";
      setGameError(`游戏准备失败${reason}。请检查设备后重试。`);
    } finally {
      setIsStarting(false);
    }
  }, [connectMidiForRound, isStarting, microphone.error, microphone.start, microphone.stop, resetRoundState, spawnTarget]);

  const pauseRound = useCallback((): void => {
    if (phaseRef.current !== "running") return;
    elapsedBeforeRunRef.current = Math.min(
      GAME_DURATION_MS,
      elapsedBeforeRunRef.current + performance.now() - runSegmentStartedAtRef.current,
    );
    setElapsedMs(elapsedBeforeRunRef.current);
    phaseRef.current = "paused";
    setPhase("paused");
    setFeedback("闯关已暂停");
    microphone.stop();
  }, [microphone.stop]);

  useEffect(() => {
    const unavailableMode = settings.inputMode === "virtual" && !virtualKeyboardAvailable
      ? "virtual"
      : settings.inputMode === "midi" && !supportsMidi(midi.status, virtualKeyboardAvailable)
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
    if (phase === "running" && settings.inputMode === "midi" && (!supportsMidi(midi.status, virtualKeyboardAvailable) || !midi.isConnected)) {
      setGameError(midi.errorMessage ?? "MIDI 键盘连接中断，闯关已暂停。");
      pauseRound();
    }
  }, [midi.errorMessage, midi.isConnected, midi.status, pauseRound, phase, settings.inputMode, virtualKeyboardAvailable]);

  useEffect(() => {
    if (phase !== "running") return undefined;
    const pauseWhenHidden = (): void => {
      if (document.hidden) pauseRound();
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [pauseRound, phase]);

  const resumeRound = useCallback(async (): Promise<void> => {
    if (isStarting || phaseRef.current !== "paused") return;
    setIsStarting(true);
    setGameError("");
    try {
      if (settingsRef.current.inputMode === "physical") {
        let started = false;
        try {
          started = await microphone.start({ includeAccidentals: true });
        } catch (error) {
          const reason = error instanceof Error ? `（${error.message}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
        if (!started) {
          const reason = microphone.error ? `（${microphone.error}）` : "";
          setGameError(`麦克风未能重新连接${reason}。请检查网站权限和输入设备后重试。`);
          return;
        }
        playStaffGameSound("microphoneReady");
      } else if (settingsRef.current.inputMode === "midi") {
        if (!await connectMidiForRound()) return;
        microphone.stop();
      } else {
        microphone.stop();
      }
      runSegmentStartedAtRef.current = performance.now();
      phaseRef.current = "running";
      setPhase("running");
      setFeedback(settingsRef.current.inputMode === "midi" ? "继续弹奏 MIDI 键盘" : "继续识别，弹奏气泡音符");
      if (waitingForNextTargetRef.current && !targetRef.current) {
        waitingForNextTargetRef.current = false;
        spawnTarget(elapsedBeforeRunRef.current);
      }
    } catch (error) {
      const reason = error instanceof Error ? `（${error.message}）` : "";
      setGameError(`输入设备恢复失败${reason}。请检查设备后重试。`);
    } finally {
      setIsStarting(false);
    }
  }, [connectMidiForRound, isStarting, microphone.error, microphone.start, microphone.stop, spawnTarget]);

  const exitGame = useCallback((): void => {
    microphone.stop();
    onSessionActiveChange(false);
    onExit();
  }, [microphone.stop, onExit, onSessionActiveChange]);

  const retryLevel = useCallback((): void => {
    void beginRound();
  }, [beginRound]);

  const advanceLevel = useCallback((nextLevel: number): void => {
    const clamped = Math.max(1, Math.min(GAME_LEVEL_COUNT, nextLevel));
    const nextProgress = { ...progressRef.current, unlockedLevel: Math.max(progressRef.current.unlockedLevel, clamped) };
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
    setLevel(clamped);
    levelRef.current = clamped;
    void beginRound();
  }, [beginRound]);

  const openGameDialog = useCallback((nextDialog: Exclude<GameDialog, null>): void => {
    if (phaseRef.current === "running") pauseRound();
    setSettingsDraft(settingsRef.current);
    setDialog(nextDialog);
  }, [pauseRound]);

  const closeGameDialog = useCallback((): void => {
    setDialog(null);
  }, []);

  const applyGameSettings = useCallback((): void => {
    const midiAvailable = supportsMidi(midi.status, virtualKeyboardAvailable);
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
    setStaffGameSoundsEnabled(nextSettings.soundEffectsEnabled && nextSettings.inputMode !== "physical");
    if (nextSettings.inputMode === "virtual") microphone.stop();
    setDialog(null);
  }, [microphone.stop, midi.status, settingsDraft, virtualKeyboardAvailable]);

  const handleVirtualKey = useCallback((note: NoteName): void => {
    if (phaseRef.current !== "running") return;
    const semitones: Record<NoteName, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    handleRecognizedAnswer({ noteName: note, octave: 4, midiNoteNumber: 60 + semitones[note], source: "screen-keyboard" });
  }, [handleRecognizedAnswer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape" && !event.repeat && dialog) {
        event.preventDefault();
        closeGameDialog();
      } else if (event.code === "Escape" && !event.repeat && phaseRef.current === "running") {
        event.preventDefault();
        pauseRound();
      } else if (event.code === "Space" && !event.repeat && !dialog && window.matchMedia("(min-width: 821px)").matches) {
        const target = event.target;
        if (target instanceof HTMLElement && target.isContentEditable) return;
        if (target instanceof Element && target.closest("button, input, select, textarea, [role='dialog']")) return;
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
  }, [closeGameDialog, dialog, pauseRound, resumeRound]);

  const focusPitch = GAME_NOTE_PROGRESSION[level - 1];
  const focusNote = `${focusPitch.name}${focusPitch.octave}`;
  const midiOptionAvailable = supportsMidi(midi.status, virtualKeyboardAvailable);
  const remainingSeconds = Math.max(0, Math.ceil((GAME_DURATION_MS - elapsedMs) / 1000));
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
  const showVirtualKeyboard = virtualKeyboardAvailable && settings.inputMode === "virtual" && (phase === "running" || phase === "paused");
  const pauseControlDisabled = (phase !== "running" && phase !== "paused") || isStarting;

  if (imageLoadState !== "ready") {
    return (
      <section aria-busy={imageLoadState === "loading"} className="practice-shell staff-game-shell staff-game-loading-shell" aria-label="正在准备五线谱闯关">
        <div className="staff-game-loading-card" role={imageLoadState === "loading" ? "status" : undefined} aria-live="polite">
          {imageLoadState === "loading" ? <span aria-hidden="true" className="staff-game-loading-spinner" /> : null}
          <strong>{imageLoadState === "loading" ? "正在加载游戏素材" : "部分游戏图片没有加载成功"}</strong>
          <span>{imageLoadState === "loading" ? "图片准备完成后即可开始" : "请检查网络连接后重试"}</span>
          {imageLoadState === "error" ? (
            <button className="staff-game-loading-retry" onClick={() => setImageLoadAttempt((attempt) => attempt + 1)} type="button">重新加载</button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="practice-shell staff-game-shell" aria-label="五线谱闯关游戏">
      <audio aria-hidden="true" loop preload="auto" ref={backgroundMusicRef} src={gameBackgroundMusic} />
      <div className="staff-game-scene" style={gameArtStyle}>
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-a" draggable="false" src={cloudDecorationOne} />
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-b" draggable="false" src={cloudDecorationTwo} />
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-c" draggable="false" src={cloudDecorationThree} />
        <header className="staff-game-hud">
          <div className="staff-game-hud-card staff-game-display-card">
            <span>显示</span>
            <div aria-label="琴键显示方式" className="staff-game-display-options" role="group">
              {DISPLAY_MODES.map((mode) => (
                <button
                  aria-label={`琴键显示${mode.label}`}
                  aria-pressed={settings.displayMode === mode.id}
                  className={settings.displayMode === mode.id ? "is-selected" : ""}
                  key={mode.id}
                  onClick={() => setSettings((current) => ({ ...current, displayMode: mode.id }))}
                  title={`琴键显示：${mode.label}`}
                  type="button"
                ><span className="is-wide-label">{mode.label}</span><span className="is-compact-label">{mode.shortLabel}</span></button>
              ))}
            </div>
            {phase === "summary" ? <small>本关结算</small> : null}
          </div>
          <div aria-label={`第 ${level} 关`} className="staff-game-level-medal">
            <span>LEVEL</span>
            <strong>{level}</strong>
            <div aria-hidden="true" className="staff-game-level-stars">
              {[1, 2, 3].map((star) => <img alt="" className={progress.bestStars[level - 1] >= star ? "earned" : ""} key={star} src={starParticleArt} />)}
            </div>
          </div>
          <div className="staff-game-score-group">
            <div className="staff-game-hud-card staff-game-score-card">
              <span>{phase === "summary" ? "本局得分" : "本关得分"}</span>
              <strong>{score}</strong>
              <small>最高 {progress.bestScores[level - 1]}{phase === "ready" ? "" : `　·　${remainingSeconds} 秒`}</small>
            </div>
            <button aria-label="选择关卡跳级" className="staff-game-jump-button" onClick={() => openGameDialog("levels")} type="button">
              <SkipForward aria-hidden="true" size={14} />跳级
            </button>
          </div>
        </header>

        <div className={`staff-game-playfield${phase === "paused" ? " is-paused" : ""}`} ref={playfieldRef}>
          <div aria-hidden="true" className="staff-game-scene-glow" />
          {phase === "ready" || phase === "running" || phase === "paused" ? (
            <img
              alt=""
              aria-hidden="true"
              className={`staff-game-mascot${combo >= 3 && phase === "running" ? " is-cheering" : phase === "paused" ? " is-winking" : ""}`}
              draggable="false"
              src={combo >= 3 && phase === "running" ? mascotCheer : phase === "paused" ? mascotWink : mascotIdle}
            />
          ) : null}
          {target ? (
            <div
              aria-label={`落下的音符 ${noteLabel(target)}`}
              className={`staff-game-bubble${targetPopped ? " is-popped" : ""}${phase === "paused" ? " is-paused" : ""}`}
              key={target.token}
              ref={targetElementRef}
              style={{ animationDuration: `${bubbleDurationMs}ms`, left: `${target.centerX}px` }}
            >
              <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={bubbleShell} />
              <div className="staff-game-bubble-content">
                <NoteStaff note={target} />
                <span className="staff-game-bubble-a11y">请弹奏 {noteLabel(target)}</span>
              </div>
            </div>
          ) : null}

          {comboIndicator ? (
            <div
              aria-label={`连击 ${comboIndicator.count} 次`}
              aria-live="polite"
              className={`staff-game-combo-indicator${phase === "paused" ? " is-paused" : ""}`}
              key={`combo-${comboIndicator.token}`}
              role="status"
              style={{
                left: comboIndicator.left,
                top: comboIndicator.top,
                "--combo-duration": `${comboIndicator.durationMs}ms`,
              } as CSSProperties}
            >
              <span className="staff-game-combo-label">连击</span>
              <span className="staff-game-combo-count">
                <svg aria-hidden="true" className="staff-game-combo-ring" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="22" />
                </svg>
                <strong>{comboIndicator.count}</strong>
              </span>
            </div>
          ) : null}

          {bubbleBurst ? (
            <div
              aria-hidden="true"
              className="staff-game-burst"
              key={`burst-${bubbleBurst.token}`}
              style={{ left: bubbleBurst.x, top: bubbleBurst.y }}
            >
              <span className="staff-game-burst-flash" />
              {Array.from({ length: BURST_STAR_COUNT }, (_, index) => {
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
              })}
            </div>
          ) : null}

          {phase === "ready" ? (
            <div className="staff-game-card staff-game-ready-card">
              <h1>五线谱闯关</h1>
              <div className="staff-game-preview-bubble">
                <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={bubbleShell} />
                <img alt="中央 C 音符位于高音谱表上的示意图" className="staff-game-preview-notation" draggable="false" src={notationC4Preview} />
              </div>
              <div className="staff-game-level-detail">
                <div className="staff-game-stat"><span>本关重点音符</span><strong>{focusNote}</strong></div>
                <div className="staff-game-stat">
                  <span>历史星级</span>
                  <strong aria-label={`${progress.bestStars[level - 1]} 星`} className="staff-game-history-stars">
                    {[1, 2, 3].map((star) => <img alt="" className={progress.bestStars[level - 1] >= star ? "earned" : ""} key={star} src={starParticleArt} />)}
                  </strong>
                </div>
                <div className="staff-game-stat"><span>最高连击</span><strong>{progress.maxCombos[level - 1]} 次</strong></div>
              </div>
              <div className={`staff-game-mic-status${(settings.inputMode === "physical" && microphone.error) || (settings.inputMode === "midi" && (midi.status === "denied" || midi.status === "error")) ? " has-error" : settings.inputMode === "virtual" || (settings.inputMode === "physical" && microphone.isListening) || (settings.inputMode === "midi" && midi.isConnected) ? " is-ready" : " is-pending"}`}>
                <span aria-hidden="true" className="staff-game-mic-indicator">
                  {settings.inputMode === "virtual" ? <Keyboard size={17} /> : settings.inputMode === "midi" ? <Music2 size={17} /> : <Mic size={17} />}
                </span>
                <span>{gameInputStatusText}</span>
              </div>
              <button className="staff-game-primary" disabled={isStarting} onClick={() => void beginRound()} type="button">
                <Play fill="currentColor" size={20} />{isStarting ? "正在准备…" : "开始闯关"}
              </button>
            </div>
          ) : null}

          {phase === "paused" ? (
            <div className="staff-game-card staff-game-message-card">
              <h2>已暂停</h2>
              <p>计时和音符都会停在当前进度。</p>
              {gameError || microphone.error ? <p className="staff-game-error" role="alert">{gameError || microphone.error}</p> : null}
            </div>
          ) : null}

          {phase === "summary" && typeof document !== "undefined" ? createPortal(
            <div aria-label={`第 ${level} 关结算`} aria-modal="true" className="staff-game-summary-backdrop" role="dialog" style={gameArtStyle}>
              <div aria-hidden="true" className="staff-game-summary-aura" />
              <div aria-label={`${revealedSummaryStars} 颗星依次出现，获得 ${earnedStars} 颗星`} className="staff-game-summary-stars" role="img">
                {[1, 2, 3].map((star) => (
                  <img
                    alt=""
                    className={`staff-game-summary-star${earnedStars >= star ? " earned" : ""}${revealedSummaryStars >= star ? " is-revealed" : ""}`}
                    key={star}
                    src={starParticleArt}
                  />
                ))}
              </div>
              <section className="staff-game-card staff-game-summary-card">
                <div aria-label={`第 ${level} 关`} className="staff-game-summary-level-badge" role="img">
                  <img alt="" aria-hidden="true" draggable="false" src={summaryLevelBannerArt} />
                  <strong>LEVEL {level}</strong>
                </div>
                <div className="staff-game-summary-content">
                  <div aria-hidden="true" className="staff-game-result-fireworks">
                    <img alt="" draggable="false" src={summaryFireworksArt} />
                  </div>
                  {earnedStars > 0 ? <h2>闯关成功！</h2> : null}
                  <div className="staff-game-result-stats">
                    <div><span>最大连击数</span><strong>{maxCombo} 次</strong></div>
                    <div className="is-score"><span>获得的分数</span><strong>{score} 分</strong></div>
                  </div>
                  <div className="staff-game-summary-actions">
                    <button className="staff-game-primary" onClick={retryLevel} type="button"><RotateCcw size={16} />再试一次</button>
                    <button className="staff-game-secondary" disabled={level >= GAME_LEVEL_COUNT} onClick={() => advanceLevel(level + 1)} type="button">
                      <SkipForward size={16} />{level >= GAME_LEVEL_COUNT ? "已通关" : "下一级"}
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          ) : null}
        </div>

        {showVirtualKeyboard ? (
          <div aria-label="虚拟钢琴键盘 C4 到 B4" className={`staff-game-virtual-keyboard${phase === "paused" ? " is-paused" : ""}`} role="group">
            <div className="staff-game-keybed">
              {NOTE_NAMES.map((note) => (
                <button
                  aria-label={`${note}4`}
                  className="staff-game-virtual-key"
                  disabled={phase === "paused"}
                  key={note}
                  onClick={() => handleVirtualKey(note)}
                  type="button"
                >
                  {settings.displayMode === "none" ? null : (
                    <><span>{settings.displayMode === "solfege" ? SOLFEGE_NAMES[NOTE_NAMES.indexOf(note)] : settings.displayMode === "number" ? String(NOTE_NAMES.indexOf(note) + 1) : note}</span>{settings.displayMode === "note" ? <small>4</small> : null}</>
                  )}
                </button>
              ))}
              {["cs", "ds", "fs", "gs", "as"].map((key) => <span aria-hidden="true" className={`staff-game-black-key key-${key}`} key={key} />)}
            </div>
          </div>
        ) : null}
        <footer className={`staff-game-controls${virtualKeyboardAvailable ? " is-touch-layout" : ""}`}>
          <button
            aria-label="返回练习"
            title="返回练习"
            className="staff-game-action-button staff-game-back-button is-desktop-control"
            onClick={exitGame}
            type="button"
          ><img alt="" aria-hidden="true" src={actionReturnArt} /></button>
          <div aria-live="polite" className="staff-game-feedback is-desktop-control">
            {phase === "ready" ? null : settings.inputMode === "physical" && microphone.isListening ? <><Volume2 aria-hidden="true" size={16} /><span>{feedback || microphone.detectedNote || "麦克风已连接"}</span></> : <span>{feedback}</span>}
          </div>
          <div aria-label="游戏操作" className="staff-game-toolbar is-desktop-control">
            <button aria-label="游戏提示" title="游戏提示" className="staff-game-action-button" onClick={() => openGameDialog("help")} type="button"><img alt="" aria-hidden="true" src={actionHelpArt} /></button>
            <button aria-label="游戏设置" title="游戏设置" className="staff-game-action-button" onClick={() => openGameDialog("settings")} type="button"><img alt="" aria-hidden="true" src={actionSettingsArt} /></button>
            <button
              aria-label={phase === "paused" ? "继续闯关" : "暂停闯关"}
              title={phase === "paused" ? "继续闯关" : "暂停闯关"}
              className="staff-game-action-button"
              disabled={pauseControlDisabled}
              onClick={() => phase === "running" ? pauseRound() : void resumeRound()}
              type="button"
            ><img alt="" aria-hidden="true" src={phase === "paused" ? actionResumeArt : actionPauseArt} /></button>
          </div>
          <div aria-label="游戏操作" className="staff-game-toolbar is-mobile-control">
            <button aria-label="返回练习" title="返回练习" className="staff-game-action-button" onClick={exitGame} type="button"><img alt="" aria-hidden="true" src={actionReturnArt} /></button>
            <button aria-label="游戏提示" title="游戏提示" className="staff-game-action-button" onClick={() => openGameDialog("help")} type="button"><img alt="" aria-hidden="true" src={actionHelpArt} /></button>
            <button aria-label="游戏设置" title="游戏设置" className="staff-game-action-button" onClick={() => openGameDialog("settings")} type="button"><img alt="" aria-hidden="true" src={actionSettingsArt} /></button>
            <button
              aria-label={phase === "paused" ? "继续闯关" : "暂停闯关"}
              title={phase === "paused" ? "继续闯关" : "暂停闯关"}
              className="staff-game-action-button"
              disabled={pauseControlDisabled}
              onClick={() => phase === "running" ? pauseRound() : void resumeRound()}
              type="button"
            ><img alt="" aria-hidden="true" src={phase === "paused" ? actionResumeArt : actionPauseArt} /></button>
          </div>
        </footer>
        {dialog ? (
          <div className="staff-game-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeGameDialog(); }}>
            <section
              aria-labelledby="staff-game-dialog-title"
              aria-modal="true"
              className={`staff-game-dialog staff-game-${dialog}-dialog`}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              {dialog === "help" ? (
                <>
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <h2 id="staff-game-dialog-title">游戏提示</h2>
                  <div className="staff-game-help-copy">
                    <h3>五线谱闯关说明</h3>
                    <p>共有 60 关：前 35 关逐步加入白键，后 25 关加入黑键。从中央 C4 开始，答对后解锁下一关。</p>
                    <p>观察气泡中的五线谱音符，用麦克风或 MIDI 键盘弹奏；手机和平板也可以点击虚拟琴键作答。</p>
                    <p>虚拟琴键的七个音名键可匹配任意八度；遇到升号时点击对应字母键。</p>
                    <p>连续答对会累积连击并提高单次得分。闯关结束后，分数会换算成星级；获得星星即可解锁下一关。</p>
                  </div>
                </>
              ) : dialog === "levels" ? (
                <>
                  <img alt="" aria-hidden="true" className="staff-game-level-decoration" draggable="false" src={levelJumpDecorationArt} />
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <div className="staff-game-level-dialog-content">
                    <h2 id="staff-game-dialog-title">选择关卡</h2>
                    <div className="staff-game-level-picker-content">
                      <p>点选关卡后会立即开始</p>
                      <section aria-label="白键关卡" className="staff-game-level-picker-group">
                        <h3>白键 · 1–35</h3>
                        <div className="staff-game-level-picker-grid">
                          {GAME_NOTE_PROGRESSION.slice(0, 35).map((note, index) => {
                            const selectedLevel = index + 1;
                            const isCurrent = level === selectedLevel;
                            return (
                              <button
                                aria-label={`第 ${selectedLevel} 关，${note.name}${note.octave}${isCurrent ? "，当前关卡" : ""}`}
                                aria-pressed={isCurrent}
                                className={`staff-game-level-choice${isCurrent ? " is-current" : ""}${progress.bestStars[index] > 0 ? " has-stars" : ""}`}
                                key={selectedLevel}
                                onClick={() => jumpToLevel(selectedLevel)}
                                type="button"
                              ><strong>{selectedLevel}</strong><span>{note.name}{note.octave}</span>{isCurrent ? <small>当前</small> : null}</button>
                            );
                          })}
                        </div>
                      </section>
                      <section aria-label="黑键关卡" className="staff-game-level-picker-group">
                        <h3>黑键 · 36–60</h3>
                        <div className="staff-game-level-picker-grid">
                          {GAME_NOTE_PROGRESSION.slice(35).map((note, index) => {
                            const selectedLevel = index + 36;
                            const progressIndex = selectedLevel - 1;
                            const isCurrent = level === selectedLevel;
                            return (
                              <button
                                aria-label={`第 ${selectedLevel} 关，${note.name}${note.octave}${isCurrent ? "，当前关卡" : ""}`}
                                aria-pressed={isCurrent}
                                className={`staff-game-level-choice is-black-key${isCurrent ? " is-current" : ""}${progress.bestStars[progressIndex] > 0 ? " has-stars" : ""}`}
                                key={selectedLevel}
                                onClick={() => jumpToLevel(selectedLevel)}
                                type="button"
                              ><strong>{selectedLevel}</strong><span>{note.name}{note.octave}</span>{isCurrent ? <small>当前</small> : null}</button>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <img alt="" aria-hidden="true" className="staff-game-settings-decoration" draggable="false" src={settingsBowArt} />
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <div className="staff-game-settings-content">
                    <h2 id="staff-game-dialog-title">游戏设置</h2>
                    <section className="staff-game-settings-section">
                      <h3>输入方式</h3>
                      <div className="staff-game-input-options">
                        <button aria-pressed={settingsDraft.inputMode === "virtual"} className={`staff-game-input-option${settingsDraft.inputMode === "virtual" ? " is-selected" : ""}`} disabled={!virtualKeyboardAvailable} onClick={() => setSettingsDraft((current) => ({ ...current, inputMode: "virtual" }))} type="button">
                          <Keyboard aria-hidden="true" size={29} /><strong>虚拟琴键</strong><small>{virtualKeyboardAvailable ? "点击屏幕琴键作答" : "仅手机和平板可用"}</small>
                        </button>
                        <button aria-pressed={settingsDraft.inputMode === "physical"} className={`staff-game-input-option${settingsDraft.inputMode === "physical" ? " is-selected" : ""}`} onClick={() => {
                          setSettingsDraft((current) => ({ ...current, inputMode: "physical" }));
                          toast.info("实体钢琴模式下暂停音效和背景音乐，避免干扰麦克风识别。", { duration: 3_500 });
                        }} type="button">
                          <Mic aria-hidden="true" size={29} /><strong>实体钢琴</strong><small>使用麦克风识别</small>
                        </button>
                        {midiOptionAvailable ? (
                          <button aria-pressed={settingsDraft.inputMode === "midi"} className={`staff-game-input-option${settingsDraft.inputMode === "midi" ? " is-selected" : ""}`} onClick={() => setSettingsDraft((current) => ({ ...current, inputMode: "midi" }))} type="button">
                            <Music2 aria-hidden="true" size={29} /><strong>MIDI 键盘</strong><small>{midi.isConnected ? `已连接：${midi.selectedInput?.name ?? "设备"}` : midi.status === "denied" ? "浏览器 MIDI 权限未开启" : "电脑端连接 MIDI 键盘"}</small>
                          </button>
                        ) : null}
                      </div>
                    </section>
                    <section className="staff-game-settings-section staff-game-settings-row">
                      <div><h3>音效</h3><p>答对、连击和关卡反馈</p></div>
                      <button aria-label={settingsDraft.soundEffectsEnabled ? "关闭音效" : "开启音效"} aria-pressed={settingsDraft.soundEffectsEnabled} className={`staff-game-sound-switch${settingsDraft.soundEffectsEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => ({ ...current, soundEffectsEnabled: !current.soundEffectsEnabled }))} type="button">
                        {settingsDraft.soundEffectsEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}<span>{settingsDraft.soundEffectsEnabled ? "开启" : "关闭"}</span>
                      </button>
                    </section>
                    <section className="staff-game-settings-section staff-game-settings-row">
                      <div><h3>背景音乐</h3><p>轻快旋律循环播放</p></div>
                      <button aria-label={settingsDraft.backgroundMusicEnabled ? "关闭背景音乐" : "开启背景音乐"} aria-pressed={settingsDraft.backgroundMusicEnabled} className={`staff-game-sound-switch${settingsDraft.backgroundMusicEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => ({ ...current, backgroundMusicEnabled: !current.backgroundMusicEnabled }))} type="button">
                        {settingsDraft.backgroundMusicEnabled ? <Music2 size={19} /> : <VolumeX size={19} />}<span>{settingsDraft.backgroundMusicEnabled ? "开启" : "关闭"}</span>
                      </button>
                    </section>
                    <section className="staff-game-settings-section staff-game-difficulty-setting">
                      <h3>难度</h3>
                      <div aria-label="游戏难度" className="staff-game-difficulty-options" role="group">
                        {GAME_DIFFICULTIES.map((option) => (
                          <button
                            aria-pressed={settingsDraft.difficulty === option.id}
                            className={`staff-game-difficulty-option${settingsDraft.difficulty === option.id ? " is-selected" : ""}`}
                            key={option.id}
                            onClick={() => setSettingsDraft((current) => ({ ...current, difficulty: option.id }))}
                            type="button"
                          >{option.label}</button>
                        ))}
                      </div>
                      <p className="staff-game-difficulty-summary" aria-live="polite">
                        <span>下落 { (draftDifficulty.bubbleDurationMs / 1000).toFixed(1) } 秒 · 连击等待 { (draftDifficulty.comboWindowMs / 1000).toFixed(1) } 秒</span>
                        <span>答对 {draftDifficulty.correctPoints} 分 · 连击每次 +{draftDifficulty.comboBonusPoints} 分</span>
                      </p>
                    </section>
                    <div className="staff-game-dialog-actions">
                      <button className="staff-game-secondary" onClick={closeGameDialog} type="button">取消</button>
                      <button className="staff-game-primary" onClick={applyGameSettings} type="button">确定</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}
        {gameError ? (
          <div className="staff-game-mic-dialog-backdrop">
            <section aria-labelledby="staff-game-mic-dialog-title" aria-modal="true" className="staff-game-mic-dialog" role="alertdialog">
              <span className="staff-game-mic-dialog-icon">{settings.inputMode === "midi" ? <Music2 aria-hidden="true" size={22} /> : <Mic aria-hidden="true" size={22} />}</span>
              <h2 id="staff-game-mic-dialog-title">{settings.inputMode === "midi" ? "需要连接 MIDI 键盘" : "需要开启麦克风"}</h2>
              <p>{gameError}</p>
              <div className="staff-game-summary-actions">
                <button className="staff-game-secondary" onClick={() => setGameError("")} type="button">稍后处理</button>
                <button className="staff-game-primary" disabled={isStarting} onClick={() => void (phase === "paused" ? resumeRound() : beginRound())} type="button">
                  {isStarting ? "正在连接…" : "重新尝试"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
