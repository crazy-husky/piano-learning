import { Keyboard, Mic, Music2, Play, RotateCcw, SkipForward, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { playPianoNote, preloadPianoSamples, unlockAudio } from "../audio/piano";
import { playStaffGameSound, playStaffGameStarReveal, preloadStaffGameSounds, setStaffGameSoundsEnabled } from "../audio/staffGameSounds";
import type { PracticeAnswerInput } from "../domain/answerInput";
import type { NoteName, PianoKeyName } from "../domain/types";
import type { MidiInputController } from "../midi/useMidiInput";
import type { MidiAccessStatus } from "../midi/midiInput";
import type { usePracticeMicrophoneInput } from "../vocal-pitch/usePracticeMicrophoneInput";
import { readStaffGameSongProgress, saveStaffGameSongProgress, STAFF_GAME_SONGS, type StaffGameSongProgress } from "../data/staffGameSongs";
import gameBackgroundDesktop from "../assets/staff-game/backgrounds/meadow-desktop.webp";
import gameBackgroundMobile from "../assets/staff-game/backgrounds/meadow-mobile.webp";
import gameBackgroundMusic from "../assets/staff-game/audio/relaxed-game-bgm.mp3";
import mascotCelebrationFrames from "../assets/staff-game/characters/mascot-celebration-frames.webp";
import mascotCheerFrames from "../assets/staff-game/characters/mascot-cheer-frames.webp";
import mascotPauseFrames from "../assets/staff-game/characters/mascot-pause-frames.webp";
import mascotSadFrames from "../assets/staff-game/characters/mascot-sad-frames.webp";
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
import helpTitleArt from "../assets/staff-game/ui/help-title-tip.webp";
import hudFrameArt from "../assets/staff-game/ui/hud-frame.webp";
import modalFrameArt from "../assets/staff-game/ui/modal-frame.webp";
import starParticleArt from "../assets/staff-game/ui/star-particle.webp";
import settingsPawArt from "../assets/staff-game/ui/settings-paw.webp";
import levelJumpDecorationArt from "../assets/staff-game/ui/level-jump-decoration.webp";
import summaryLevelBannerArt from "../assets/staff-game/ui/summary-level-banner.webp";
import summaryFireworksArt from "../assets/staff-game/ui/summary-fireworks.webp";
import { StaffGameFireworks } from "./StaffGameFireworks";

const STAFF_GAME_IMAGE_ASSETS = [
  gameBackgroundDesktop,
  gameBackgroundMobile,
  mascotCelebrationFrames,
  mascotCheerFrames,
  mascotPauseFrames,
  mascotSadFrames,
  bubbleShell,
  cloudDecorationOne,
  cloudDecorationTwo,
  cloudDecorationThree,
  notationC4Preview,
  buttonPrimaryArt,
  buttonSecondaryArt,
  actionHelpArt,
  helpTitleArt,
  actionPauseArt,
  actionResumeArt,
  actionReturnArt,
  actionSettingsArt,
  hudFrameArt,
  modalFrameArt,
  starParticleArt,
  settingsPawArt,
  levelJumpDecorationArt,
  summaryLevelBannerArt,
  summaryFireworksArt,
];
const STAFF_GAME_RESOURCE_MAX_RETRIES = 3;
const STAFF_GAME_RESOURCE_RETRY_DELAY_MS = 500;
const STAFF_GAME_BACKGROUND_AUDIO_TIMEOUT_MS = 15_000;
// Keep decoded images alive across route re-entry; failed loads are removed so retries can fetch them again.
const staffGameImageCache = new Map<string, HTMLImageElement>();
const pendingStaffGameImageLoads = new Map<string, Promise<void>>();

const GAME_PROGRESS_KEY = "anki-note.staffGameProgress.v2";
const GAME_SETTINGS_KEY = "anki-note.staffGameSettings.v1";
const LOW_FPS_PROMPT_SESSION_KEY = "anki-note.staffGameLowFpsPrompted.v1";
const PHYSICAL_INPUT_NOTICE_ID = "staff-game-physical-input-notice";
const PHYSICAL_INPUT_NOTICE = "实体钢琴模式通过麦克风识别音高，背景音乐会自动关闭；答题反馈音效仍由「音效」设置控制。请确保乐器音准正常。";
let lowFpsPromptShownThisPage = false;
const BURST_STAR_COUNT = 14;
const GAME_LEVEL_COUNT = 60;
const SONG_STAR_THRESHOLDS = [60, 80, 95] as const;
const RUSH_MODE_COMBO_THRESHOLD = 5;
const RUSH_FALL_SPEED_MULTIPLIER = 0.92;
const STAR_CREDIT_PER_CORRECT_ANSWER = 10;
const ERROR_FLASH_THRESHOLD = 4;
const ERROR_FLASH_DURATION_MS = 1_400;
const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const PITCH_NAMES: PianoKeyName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEY_NOTES: Array<{ pitch: PianoKeyName; className: string }> = [
  { pitch: "C#", className: "key-cs" },
  { pitch: "D#", className: "key-ds" },
  { pitch: "F#", className: "key-fs" },
  { pitch: "G#", className: "key-gs" },
  { pitch: "A#", className: "key-as" },
];
const COMPUTER_KEY_PITCHES: Record<string, PianoKeyName> = {
  KeyA: "C", KeyS: "D", KeyD: "E", KeyF: "F", KeyG: "G", KeyH: "A", KeyJ: "B",
  KeyW: "C#", KeyE: "D#", KeyT: "F#", KeyY: "G#", KeyU: "A#",
};
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

function gameDurationMsForLevel(level: number): number {
  if (level === 1) return 15_000;
  if (level === 2) return 20_000;
  if (level <= 3) return 30_000;
  if (level <= 6) return 60_000;
  if (level <= 9) return 120_000;
  return 140_000;
}
const SOLFEGE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"] as const;
const DISPLAY_MODES: Array<{ id: GameDisplayMode; label: string }> = [
  { id: "note", label: "音名" },
  { id: "solfege", label: "唱名" },
  { id: "number", label: "简谱" },
  { id: "none", label: "无" },
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
const STAR_BASE_DURATION_MS = 30_000;

type GameInputMode = "physical" | "virtual" | "midi";
type GameDisplayMode = "note" | "solfege" | "number" | "none";
type GameDifficulty = "easy" | "normal" | "hard" | "nightmare";
type StaffGameMode = "levels" | "songs";
type SongSelectionStep = "list" | "detail" | null;
type GameDialog = "help" | "settings" | "levels" | null;

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

interface RushScoreFlight {
  token: number;
  points: number;
  left: number;
  top: number;
  deltaX: number;
  deltaY: number;
  ready: boolean;
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
  };
}

interface FireflyParticle {
  id: number;
  left: string;
  top: string;
  size: string;
  opacity: string;
  duration: string;
  delay: string;
  driftX: string;
  driftY: string;
  midX: string;
  midY: string;
  moving: boolean;
}

type StaffGameMascotAction = "idle" | "cheer" | "sad" | "summarySad" | "pause" | "celebration";

interface MascotAnimationLayer {
  id: number;
  action: StaffGameMascotAction;
  token: number;
}

const MASCOT_FRAME_SHEETS: Record<StaffGameMascotAction, string> = {
  idle: mascotSadFrames,
  cheer: mascotCheerFrames,
  sad: mascotSadFrames,
  summarySad: mascotSadFrames,
  pause: mascotPauseFrames,
  celebration: mascotCelebrationFrames,
};

const MASCOT_ANIMATIONS: Record<StaffGameMascotAction, {
  frames: number[];
  frameDurationMs: number;
  loop?: boolean;
  holdFrame?: number;
  holdMs?: number;
}> = {
  // The idle pose is the same neutral end frame used by the sad recovery animation.
  idle: { frames: [6], frameDurationMs: 100, loop: true },
  // Keep the brief takeoff anticipation, then move through the peak and descent without a repeated midair frame.
  cheer: { frames: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8], frameDurationMs: 80, holdFrame: 8, holdMs: 140 },
  // Finish on the shared neutral frame so the face recovers during the animation, not after a pause.
  sad: { frames: [6, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], frameDurationMs: 95, holdFrame: 6, holdMs: 250 },
  // Settlement starts from the shared neutral frame and ends on the sad pose without the smile frame.
  summarySad: { frames: [6, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5], frameDurationMs: 95, holdFrame: 5 },
  pause: { frames: [0, 1, 2, 3, 4, 5], frameDurationMs: 100, holdFrame: 5 },
  celebration: { frames: [0, 1, 2, 3, 4, 5, 6, 7, 8], frameDurationMs: 90, holdFrame: 8 },
};

const MASCOT_STATIC_FRAMES: Record<StaffGameMascotAction, number> = {
  idle: 6,
  cheer: 4,
  sad: 5,
  summarySad: 5,
  pause: 5,
  celebration: 8,
};

// The original 3x3 atlases have 2px gutters around each 256px frame.
const MASCOT_FRAME_BACKGROUND_POSITIONS = ["0.381679%", "50%", "99.618321%"] as const;

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (): void => setPrefersReducedMotion(query.matches);
    updatePreference();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", updatePreference);
      return () => query.removeEventListener("change", updatePreference);
    }
    query.addListener(updatePreference);
    return () => query.removeListener(updatePreference);
  }, []);

  return prefersReducedMotion;
}

interface MascotAnimationLayerProps {
  action: StaffGameMascotAction;
  token: number;
  active: boolean;
  animate: boolean;
  holdFrameOverride?: number;
  onComplete?: (token: number) => void;
}

function MascotAnimationLayer({ action, token, active, animate, holdFrameOverride, onComplete }: MascotAnimationLayerProps): JSX.Element {
  const [frame, setFrame] = useState(MASCOT_ANIMATIONS[action].frames[0]);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animate && !prefersReducedMotion;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const animation = MASCOT_ANIMATIONS[action];
    const frames = shouldAnimate ? animation.frames : [MASCOT_STATIC_FRAMES[action]];
    let frameIndex = 0;
    let completionTimeout: number | null = null;
    if (!active) return undefined;
    setFrame(frames[0]);
    if (!shouldAnimate) {
      if (animation.loop || !onComplete) return undefined;
      const staticPoseDurationMs = animation.frames.length * animation.frameDurationMs + (animation.holdMs ?? 0);
      completionTimeout = window.setTimeout(() => {
        if (activeRef.current) onComplete(token);
      }, staticPoseDurationMs);
      return () => {
        if (completionTimeout !== null) window.clearTimeout(completionTimeout);
      };
    }
    if (frames.length === 1) return undefined;

    const interval = window.setInterval(() => {
      if (animation.loop) {
        frameIndex = (frameIndex + 1) % frames.length;
        setFrame(frames[frameIndex]);
        return;
      }

      if (frameIndex < frames.length - 1) {
        frameIndex += 1;
        setFrame(frames[frameIndex]);
        return;
      }

      window.clearInterval(interval);
      const heldFrame = holdFrameOverride ?? animation.holdFrame;
      if (heldFrame !== undefined) setFrame(heldFrame);
      if (activeRef.current && onComplete && animation.holdMs) {
        completionTimeout = window.setTimeout(() => onComplete(token), animation.holdMs);
      } else if (activeRef.current && onComplete) {
        onComplete(token);
      }
    }, animation.frameDurationMs);

    return () => {
      window.clearInterval(interval);
      if (completionTimeout !== null) window.clearTimeout(completionTimeout);
    };
  }, [action, active, holdFrameOverride, onComplete, shouldAnimate, token]);

  // Derive the static pose during render so disabling effects cannot paint one more
  // stale animation frame while the interval cleanup runs.
  const animationFrames = MASCOT_ANIMATIONS[action].frames;
  const currentFrame = shouldAnimate ? frame : MASCOT_STATIC_FRAMES[action];
  const displayedFrame = shouldAnimate && !animationFrames.includes(currentFrame)
    ? animationFrames[0]
    : currentFrame;
  const visualAction = action === "summarySad" ? "sad" : action;
  const column = displayedFrame % 3;
  const row = Math.floor(displayedFrame / 3);
  const style: CSSProperties = {
    backgroundImage: `url("${MASCOT_FRAME_SHEETS[action]}")`,
    backgroundSize: "304.6875% 304.6875%",
    backgroundPosition: `${MASCOT_FRAME_BACKGROUND_POSITIONS[column]} ${MASCOT_FRAME_BACKGROUND_POSITIONS[row]}`,
  };

  return (
    <div
      aria-hidden="true"
      className={`staff-game-mascot-sprite${active ? " is-current" : " is-leaving"} is-${visualAction}`}
      data-action={action}
      data-frame={displayedFrame}
      draggable={false}
      style={style}
    />
  );
}

interface StaffGameMascotProps {
  action: StaffGameMascotAction;
  token: number;
  animate: boolean;
  holdFrame?: number;
  className?: string;
  onComplete?: (token: number) => void;
}

function StaffGameMascot({ action, token, animate, holdFrame, className = "", onComplete }: StaffGameMascotProps): JSX.Element {
  const nextLayerIdRef = useRef(0);
  const currentIdentityRef = useRef({ action, token });
  const [layers, setLayers] = useState<MascotAnimationLayer[]>(() => [{ id: 0, action, token }]);

  useLayoutEffect(() => {
    if (currentIdentityRef.current.action === action && currentIdentityRef.current.token === token) return undefined;
    const previousAction = currentIdentityRef.current.action;
    currentIdentityRef.current = { action, token };

    const nextLayer: MascotAnimationLayer = { id: ++nextLayerIdRef.current, action, token };
    if (!animate) {
      setLayers([nextLayer]);
      return undefined;
    }

    // Idle and sad share one atlas; reuse the layer in either direction to avoid a translucent crossfade dip.
    if ((previousAction === "sad" && action === "idle") || (previousAction === "idle" && action === "sad")) {
      setLayers((currentLayers) => {
        const activeLayer = currentLayers.at(-1);
        return activeLayer ? [{ ...activeLayer, action, token }] : [nextLayer];
      });
      return undefined;
    }

    setLayers((currentLayers) => [...currentLayers.slice(-1), nextLayer]);
    const transitionTimeout = window.setTimeout(() => {
      setLayers((currentLayers) => currentLayers.filter((layer) => layer.id === nextLayer.id));
    }, 170);
    return () => window.clearTimeout(transitionTimeout);
  }, [action, animate, token]);

  return (
    <div aria-hidden="true" className={`staff-game-mascot${animate ? "" : " effects-disabled"}${className ? ` ${className}` : ""}`}>
      {layers.map((layer, index) => (
        <MascotAnimationLayer
          action={layer.action}
          active={index === layers.length - 1}
          animate={animate}
          holdFrameOverride={holdFrame}
          key={layer.id}
          onComplete={onComplete}
          token={layer.token}
        />
      ))}
    </div>
  );
}

function StaffGameParticles(): JSX.Element {
  const [particles] = useState<FireflyParticle[]>(() => {
    const clusters = Array.from({ length: 14 }, () => ({
      x: 2 + Math.random() * 96,
      y: 2 + Math.random() * 96,
      radiusX: 8 + Math.random() * 20,
      radiusY: 8 + Math.random() * 18,
    }));
    const pickCluster = (): (typeof clusters)[number] => {
      return clusters[Math.floor(Math.random() * clusters.length)];
    };
    const spreadAround = (center: number, radius: number): number => center + ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * radius * 2;
    const clampPercent = (value: number): number => Math.max(1, Math.min(99, value));

    return Array.from({ length: 112 }, (_, id) => {
      const clustered = Math.random() < 0.68;
      const cluster = clustered ? pickCluster() : null;
      const left = cluster ? clampPercent(spreadAround(cluster.x, cluster.radiusX)) : 2 + Math.random() * 96;
      const top = cluster ? clampPercent(spreadAround(cluster.y, cluster.radiusY)) : 2 + Math.random() * 96;
      const driftX = (Math.random() - 0.5) * 54;
      const driftY = (Math.random() - 0.5) * 42;
      return {
        id,
        left: `${left}%`,
        top: `${top}%`,
        size: `${id % 13 === 0 ? 3.8 + Math.random() * 1.8 : 1.5 + Math.random() * 3.2}px`,
        opacity: `${id % 13 === 0 ? 0.46 + Math.random() * 0.24 : 0.28 + Math.random() * 0.32}`,
        duration: `${11 + Math.random() * 13}s`,
        delay: `${-Math.random() * 22}s`,
        driftX: `${driftX}vw`,
        driftY: `${driftY}vh`,
        midX: `${driftX * 0.52}vw`,
        midY: `${driftY * 0.52}vh`,
        moving: Math.random() > 0.28,
      };
    });
  });

  return (
    <div aria-hidden="true" className="staff-game-fireflies">
      {particles.map((particle) => (
        <i
          className={`staff-game-firefly${particle.moving ? " is-moving" : ""}`}
          key={particle.id}
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            opacity: particle.moving ? undefined : particle.opacity,
            "--firefly-opacity": particle.opacity,
            "--firefly-duration": particle.duration,
            "--firefly-delay": particle.delay,
            "--firefly-drift-x": particle.driftX,
            "--firefly-drift-y": particle.driftY,
            "--firefly-mid-x": particle.midX,
            "--firefly-mid-y": particle.midY,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

interface RushSpeedLine {
  id: number;
  left: string;
  width: string;
  height: string;
  opacity: string;
  duration: string;
  delay: string;
}

function StaffGameRushSpeedLines(): JSX.Element {
  const [lines] = useState<RushSpeedLine[]>(() => Array.from({ length: 60 }, (_, id) => {
    const durationSeconds = 0.2 + Math.random() * 0.4;
    return {
      id,
      left: `${Math.random() * 100}%`,
      width: `${1 + Math.random() * 2}px`,
      height: `${30 + Math.random() * 150}px`,
      opacity: `${0.2 + Math.random() * 0.6}`,
      duration: `${durationSeconds}s`,
      delay: `${-Math.random() * durationSeconds}s`,
    };
  }));

  return (
    <div aria-hidden="true" className="staff-game-speed-lines">
      {lines.map((line) => (
        <div
          className="staff-game-speed-line"
          key={line.id}
          style={{
            left: line.left,
            width: line.width,
            height: line.height,
            opacity: line.opacity,
            animationDuration: line.duration,
            animationDelay: line.delay,
          }}
        />
      ))}
    </div>
  );
}

interface ShootingStar {
  id: number;
  left: string;
  top: string;
  width: string;
  angle: string;
  travelX: string;
  travelY: string;
  duration: string;
}

function StaffGameShootingStar(): JSX.Element {
  const [meteor, setMeteor] = useState<ShootingStar | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const launch = (): void => {
      const travelX = (Math.random() < 0.5 ? -1 : 1) * window.innerWidth * (0.22 + Math.random() * 0.3);
      const travelY = (Math.random() < 0.5 ? -1 : 1) * window.innerHeight * (0.04 + Math.random() * 0.08);
      const angle = Math.atan2(travelY, travelX) * (180 / Math.PI);
      setMeteor({
        id: nextIdRef.current++,
        left: `${Math.random() * 100}%`,
        top: `${3 + Math.random() * 34}%`,
        width: `${130 + Math.random() * 110}px`,
        angle: `${angle}deg`,
        travelX: `${travelX}px`,
        travelY: `${travelY}px`,
        duration: `${2800 + Math.random() * 900}ms`,
      });
    };

    const intervalId = window.setInterval(launch, 4_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div aria-hidden="true" className="staff-game-shooting-star-layer">
      {meteor ? (
        <i
          className="staff-game-shooting-star"
          key={meteor.id}
          onAnimationEnd={() => setMeteor((current) => current?.id === meteor.id ? null : current)}
          style={{
            left: meteor.left,
            top: meteor.top,
            width: meteor.width,
            animationDuration: meteor.duration,
            "--meteor-angle": meteor.angle,
            "--meteor-travel-x": meteor.travelX,
            "--meteor-travel-y": meteor.travelY,
          } as CSSProperties}
        />
      ) : null}
    </div>
  );
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

function loadGameImage(source: string): Promise<void> {
  if (staffGameImageCache.has(source)) return Promise.resolve();
  const pendingLoad = pendingStaffGameImageLoads.get(source);
  if (pendingLoad) return pendingLoad;

  const image = new Image();
  const loadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        staffGameImageCache.set(source, image);
        resolve();
      }
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
  pendingStaffGameImageLoads.set(source, loadPromise);
  void loadPromise.then(
    () => pendingStaffGameImageLoads.delete(source),
    () => pendingStaffGameImageLoads.delete(source),
  );
  return loadPromise;
}

function playGameMusic(audio: HTMLAudioElement): void {
  try {
    // Older iOS WebKit implementations return undefined from play() instead of a Promise.
    const result = audio.play() as Promise<void> | undefined;
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // Audio playback is optional; a blocked or unsupported player must not stop the game.
  }
}

async function preloadStaffGameImages(): Promise<number> {
  const results = await Promise.allSettled(STAFF_GAME_IMAGE_ASSETS.map(loadGameImage));
  return results.filter((result) => result.status === "rejected").length;
}

function preloadGameBackgroundMusic(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
      window.clearTimeout(timeout);
    };
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handleCanPlay = (): void => settle();
    const handleError = (): void => settle(new Error("Failed to load game background music"));
    const handleAbort = (): void => settle();
    const timeout = window.setTimeout(
      () => settle(new Error("Timed out while loading game background music")),
      STAFF_GAME_BACKGROUND_AUDIO_TIMEOUT_MS,
    );

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    audio.preload = "auto";
    audio.volume = 0.06;
    audio.src = gameBackgroundMusic;
    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) settle();
  });
}

async function preloadStaffGameResources(): Promise<number> {
  const [imageFailures, soundFailures] = await Promise.all([
    preloadStaffGameImages(),
    preloadStaffGameSounds(),
  ]);
  return imageFailures + soundFailures;
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

function starsForStarCredit(starCredit: number, level: number): number {
  const durationScale = gameDurationMsForLevel(level) / STAR_BASE_DURATION_MS;
  return STAR_THRESHOLDS.filter((threshold) => starCredit >= Math.ceil(threshold * durationScale)).length;
}

function starsForSongAccuracy(accuracy: number): number {
  return SONG_STAR_THRESHOLDS.filter((threshold) => accuracy >= threshold).length;
}

function gameNoteFromMidi(midi: number): Pick<GameNote, "midi" | "name" | "octave"> {
  return {
    midi,
    name: PITCH_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  };
}

function shuffledItems<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function canFollowRecentNotes(midi: number, recentNoteMidis: number[]): boolean {
  const lastTwo = recentNoteMidis.slice(-2);
  if (lastTwo.length === 2 && lastTwo[0] === midi && lastTwo[1] === midi) return false;

  const lastThree = recentNoteMidis.slice(-3);
  if (lastThree.length === 3 && lastThree[0] === lastThree[2] && lastThree[1] === midi) return false;
  return true;
}

function shuffledNoteBag(level: number): Array<{ midi: number; name: PianoKeyName; octave: number }> {
  const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, level);
  const focusNote = unlockedNotes[unlockedNotes.length - 1];
  if (!focusNote) return [];

  const bag: typeof GAME_NOTE_PROGRESSION = [];
  const addCopies = (note: (typeof GAME_NOTE_PROGRESSION)[number], count: number): void => {
    for (let index = 0; index < count; index += 1) bag.push({ ...note });
  };
  const addReviewNotes = (pool: typeof GAME_NOTE_PROGRESSION, count: number): void => {
    let remaining = count;
    while (pool.length > 0 && remaining > 0) {
      const cycle = shuffledItems(pool);
      const selected = cycle.slice(0, remaining);
      bag.push(...selected.map((note) => ({ ...note })));
      remaining -= selected.length;
    }
  };

  if (level === 1) {
    addCopies(focusNote, 1);
  } else if (level <= 5) {
    // A 20-note bag keeps the new focus note at 40%, with the rest reviewing earlier notes.
    addCopies(focusNote, 8);
    addReviewNotes(unlockedNotes.slice(0, -1), 12);
  } else {
    // Keep the focus note at 30%; distribute review slots across the newest five and older notes.
    addCopies(focusNote, 6);
    const earlierNotes = unlockedNotes.slice(0, -1);
    const recentNotes = earlierNotes.slice(-5);
    const olderNotes = earlierNotes.slice(0, -5);
    if (olderNotes.length === 0) {
      addReviewNotes(recentNotes, 14);
    } else {
      // Let the older-note share grow with its pool so one very old note is not overrepresented early on.
      const olderSlots = Math.min(7, olderNotes.length);
      addReviewNotes(recentNotes, 14 - olderSlots);
      addReviewNotes(olderNotes, olderSlots);
    }
  }

  return shuffledItems(bag);
}

function drawNextNote(
  level: number,
  notePool: Array<{ midi: number; name: PianoKeyName; octave: number }>,
  recentNoteMidis: number[],
): { midi: number; name: PianoKeyName; octave: number } | null {
  if (level === 1) {
    if (notePool.length === 0) notePool.push(...shuffledNoteBag(level));
    return notePool.pop() ?? null;
  }

  if (notePool.length === 0) notePool.push(...shuffledNoteBag(level));
  let eligibleIndices = notePool.flatMap((note, index) => canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []);
  if (eligibleIndices.length === 0) {
    // Keep blocked notes in the pool; add a fresh weighted draw so a legal note is always available.
    notePool.push(...shuffledNoteBag(level));
    eligibleIndices = notePool.flatMap((note, index) => canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []);
  }
  if (eligibleIndices.length === 0) return null;
  const chosenIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
  return notePool.splice(chosenIndex, 1)[0] ?? null;
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
  const [level, setLevel] = useState(() => readProgress().unlockedLevel);
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
  const targetRef = useRef<GameNote | null>(null);
  const playfieldRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const targetElementRef = useRef<HTMLDivElement>(null);
  const scoreValueRef = useRef<HTMLElement>(null);
  const targetPoppedRef = useRef(false);
  const comboRef = useRef(0);
  const comboResetTimeoutRef = useRef<number | null>(null);
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

  const finishMascotReaction = useCallback((token: number): void => {
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
    const getGameButton = (target: EventTarget | null): HTMLButtonElement | null => {
      if (!(target instanceof Element)) return null;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled || button.classList.contains("staff-game-virtual-key")) return null;
      return button.closest(".staff-game-shell, .staff-game-summary-backdrop, .staff-game-dialog-backdrop, .staff-game-mic-dialog-backdrop, .staff-game-low-fps-backdrop, .staff-game-pause-backdrop") ? button : null;
    };
    const playMenuClick = (button: HTMLButtonElement | null): void => {
      if (button) playStaffGameSound("menuClick");
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
    // Background music is optional; a slow or unavailable track must not block game entry.
    void preloadGameBackgroundMusic(backgroundMusic, backgroundMusicPreloadController.signal).catch(() => undefined);
    // Piano samples are optional too; the synth remains available until they finish loading.
    void preloadPianoSamples().catch(() => false);
    setResourceLoadState("loading");
    setResourceLoadRetryCount(0);
    const loadResources = async (): Promise<void> => {
      const failureCount = await preloadStaffGameResources();
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
  const draftAudioSettings = settingsDraft.audioByMode[gameMode];
  const difficulty = GAME_DIFFICULTIES.find((item) => item.id === settings.difficulty) ?? GAME_DIFFICULTIES[1];
  const bubbleDurationMs = difficulty.bubbleDurationMs;
  const gameDurationMs = gameDurationMsForLevel(level);
  const draftDifficulty = GAME_DIFFICULTIES.find((item) => item.id === settingsDraft.difficulty) ?? GAME_DIFFICULTIES[1];
  const currentRoundStars = starsForStarCredit(starCredit, level);
  const threeStarCredit = Math.ceil(STAR_THRESHOLDS[STAR_THRESHOLDS.length - 1] * gameDurationMs / STAR_BASE_DURATION_MS);
  const levelProgress = threeStarCredit > 0 ? Math.min(1, starCredit / threeStarCredit) : 0;
  const rushModeActive = combo >= RUSH_MODE_COMBO_THRESHOLD && phase === "running";
  const rushVisualsActive = rushModeActive && settings.gameEffectsEnabled;
  const activeBubbleDurationMs = rushModeActive ? Math.round(bubbleDurationMs * RUSH_FALL_SPEED_MULTIPLIER) : bubbleDurationMs;

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

  const spawnTarget = useCallback((atGameMs: number): void => {
    if (phaseRef.current !== "running") return;
    const drawnNote = gameModeRef.current === "songs"
      ? (() => {
        const song = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
        const midi = song?.noteMidis[songTargetIndexRef.current];
        return midi === undefined ? null : gameNoteFromMidi(midi);
      })()
      : drawNextNote(levelRef.current, noteBagRef.current, recentNoteMidisRef.current);
    if (!drawnNote) return;
    targetTokenRef.current += 1;
    const next = {
      ...drawnNote,
      token: targetTokenRef.current,
      centerX: randomBubbleCenterX(playfieldRef.current),
    };
    if (gameModeRef.current === "levels") {
      recentNoteMidisRef.current = [...recentNoteMidisRef.current, next.midi].slice(-3);
    }
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

  const finishRound = useCallback((): void => {
    if (roundFinishedRef.current) return;
    roundFinishedRef.current = true;
    flushScorePresentation(scoreRef.current);
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    errorFlashTimeoutRef.current = null;
    setErrorFlashActive(false);
    consecutiveWrongAnswersRef.current = 0;
    const isSongMode = gameModeRef.current === "songs";
    const activeSong = STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current);
    const accuracy = activeSong
      ? Math.round(songFirstTryHitsRef.current * 100 / activeSong.noteMidis.length)
      : 0;
    const finalStars = isSongMode ? starsForSongAccuracy(accuracy) : starsForStarCredit(starCreditRef.current, levelRef.current);
    if (finalStars > 0 && settingsRef.current.audioByMode[gameModeRef.current].soundEffectsEnabled) {
      playStaffGameSound("levelClear");
    }
    setEarnedStars(finalStars);
    setSummaryAccuracy(accuracy);
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
    setFeedback(isSongMode ? "歌曲演奏完成" : "本局结束 · 可重试或进入下一关");
    if (isSongMode) persistSongResult(finalStars, accuracy);
    else persistRoundResult(finalStars);
    microphone.stop();
    onSessionActiveChange(false);
  }, [flushScorePresentation, microphone.stop, onSessionActiveChange, persistRoundResult, persistSongResult, resetComboDisplay]);

  const handleRecognizedAnswer = useCallback((answer: PracticeAnswerInput): void => {
    if (phaseRef.current !== "running" || !targetRef.current) return;
    if (settingsRef.current.inputMode === "virtual" && answer.source !== "screen-keyboard" && answer.source !== "computer-keyboard") return;
    if (settingsRef.current.inputMode === "physical" && answer.source !== "microphone") return;
    if (settingsRef.current.inputMode === "midi" && answer.source !== "midi") return;
    const currentTarget = targetRef.current;
    const midi = answer.midiNoteNumber;
    if (midi === undefined) return;
    const isCorrect = settingsRef.current.inputMode === "virtual"
      ? ((midi % 12) + 12) % 12 === ((currentTarget.midi % 12) + 12) % 12
      : midi === currentTarget.midi;
    if (isCorrect) {
      if (targetPoppedRef.current) return;
      const isSongMode = gameModeRef.current === "songs";
      const activeSong = isSongMode ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current) : undefined;
      if (isSongMode && activeSong) {
        if (songWrongTargetTokenRef.current !== currentTarget.token) {
          songFirstTryHitsRef.current += 1;
          setSongFirstTryHits(songFirstTryHitsRef.current);
        }
        songWrongTargetTokenRef.current = null;
        songTargetIndexRef.current += 1;
        setSongNotesCompleted(songTargetIndexRef.current);
      }
      consecutiveWrongAnswersRef.current = 0;
      triggerMascotReaction("cheer");
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
      const nextCombo = comboRef.current + 1;
      const fieldWidth = fieldBounds?.width ?? window.innerWidth;
      const fieldHeight = fieldBounds?.height ?? window.innerHeight;
      const desiredLeft = fieldBounds && bubbleBounds
        ? bubbleBounds.left - fieldBounds.left - 96
        : currentTarget.centerX - 96;
      const desiredTop = fieldBounds && bubbleBounds
        ? bubbleBounds.top - fieldBounds.top - 94
        : 10;
      setComboIndicator({
        token: currentTarget.token,
        count: nextCombo,
        durationMs: GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty)?.comboWindowMs ?? 2_200,
        left: Math.max(8, Math.min(Math.max(8, fieldWidth - 108), desiredLeft)),
        top: Math.max(8, Math.min(Math.max(8, fieldHeight - 108), desiredTop)),
      });
      restartComboTimer();
      if (fieldBounds && bubbleBounds) {
        if (burstTimeoutRef.current !== null) window.clearTimeout(burstTimeoutRef.current);
        burstTimeoutRef.current = window.setTimeout(() => {
          setBubbleBurst(null);
          burstTimeoutRef.current = null;
        }, 760);
      }
      if (nextCombo >= 3 && nextCombo % 3 === 0) playStaffGameSound("comboStreak");
      if (nextCombo === 10) {
        playStaffGameSound("comboExcellent");
      } else if (nextCombo === 25) {
        playStaffGameSound("comboAmazing");
      } else if (nextCombo >= 50 && (nextCombo - 50) % 20 === 0) {
        playStaffGameSound("comboUnbelievable");
      }
      comboRef.current = nextCombo;
      maxComboRef.current = Math.max(maxComboRef.current, nextCombo);
      const scorePreset = GAME_DIFFICULTIES.find((item) => item.id === settingsRef.current.difficulty) ?? GAME_DIFFICULTIES[1];
      const basePoints = scorePreset.correctPoints + Math.min(5, nextCombo - 1) * scorePreset.comboBonusPoints;
      const rushScoringActive = nextCombo >= RUSH_MODE_COMBO_THRESHOLD;
      const points = basePoints * (rushScoringActive ? 2 : 1);
      scoreRef.current += points;
      const totalScore = scoreRef.current;
      starCreditRef.current += STAR_CREDIT_PER_CORRECT_ANSWER;
      setCombo(nextCombo);
      setMaxCombo(maxComboRef.current);
      setScore(totalScore);
      if (rushScoringActive) {
        const sceneBounds = sceneRef.current?.getBoundingClientRect();
        if (sceneBounds && bubbleBounds) {
          rushScoreFlightTokenRef.current += 1;
          const flight: RushScoreFlight = {
            token: rushScoreFlightTokenRef.current,
            points,
            left: bubbleBounds.left + bubbleBounds.width / 2 - sceneBounds.left,
            top: bubbleBounds.bottom - sceneBounds.top + 42,
            deltaX: 0,
            deltaY: 0,
            ready: false,
          };
          const nextFlights = [...rushScoreFlightsRef.current, flight];
          rushScoreFlightsRef.current = nextFlights;
          setRushScoreFlights(nextFlights);
        } else {
          queueRushScore(points);
        }
      } else if (
        rushScoreFlightsRef.current.length > 0
        || scoreAnimationTimerRef.current !== null
        || scoreAnimationTargetRef.current > displayedScoreRef.current
      ) {
        queueRushScore(points);
      } else {
        setDisplayedScoreImmediately(totalScore);
      }
      setStarCredit(starCreditRef.current);
      setFeedback(`+${points} · ${noteLabel(currentTarget)}`);
      const accuracy = activeSong
        ? Math.round(songFirstTryHitsRef.current * 100 / activeSong.noteMidis.length)
        : 0;
      const nextStars = isSongMode ? starsForSongAccuracy(accuracy) : starsForStarCredit(starCreditRef.current, levelRef.current);
      setEarnedStars(nextStars);
      if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
      nextTargetTimeoutRef.current = window.setTimeout(() => {
        nextTargetTimeoutRef.current = null;
        if (phaseRef.current !== "running") {
          waitingForNextTargetRef.current = true;
          return;
        }
        if (isSongMode && activeSong && songTargetIndexRef.current >= activeSong.noteMidis.length) {
          finishRound();
          return;
        }
        const gameNow = elapsedBeforeRunRef.current + (performance.now() - runSegmentStartedAtRef.current);
        spawnTarget(gameNow);
      }, 350);
      return;
    }

    if (targetWrong) return;
    triggerMascotReaction("sad");
    if (gameModeRef.current === "songs" && songWrongTargetTokenRef.current !== currentTarget.token) {
      songWrongTargetTokenRef.current = currentTarget.token;
    }
    const errorFlashInProgress = errorFlashTimeoutRef.current !== null;
    if (!errorFlashInProgress) consecutiveWrongAnswersRef.current += 1;
    resetComboDisplay();
    setTargetWrong(true);
    playStaffGameSound("noteMissed");
    const heardPitch = PITCH_NAMES[((midi % 12) + 12) % 12];
    setFeedback(`听到 ${heardPitch}${answer.octave ?? ""}，再试一次`);
    if (wrongClearTimeoutRef.current !== null) window.clearTimeout(wrongClearTimeoutRef.current);
    wrongClearTimeoutRef.current = window.setTimeout(() => setTargetWrong(false), 460);
    if (!errorFlashInProgress && consecutiveWrongAnswersRef.current >= ERROR_FLASH_THRESHOLD) {
      consecutiveWrongAnswersRef.current = 0;
      setErrorFlashActive(true);
      errorFlashTimeoutRef.current = window.setTimeout(() => {
        errorFlashTimeoutRef.current = null;
        consecutiveWrongAnswersRef.current = 0;
        setErrorFlashActive(false);
      }, ERROR_FLASH_DURATION_MS);
    }
  }, [finishRound, queueRushScore, resetComboDisplay, restartComboTimer, setDisplayedScoreImmediately, spawnTarget, targetWrong, triggerMascotReaction]);

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
    const revealTimeouts = [260, 760, 1260].map((delay, index) => window.setTimeout(() => {
      void playStaffGameStarReveal(index, activeAudioSettings.soundEffectsEnabled).then(() => {
        if (!cancelled) setRevealedSummaryStars(index + 1);
      });
    }, delay));

    return () => {
      cancelled = true;
      revealTimeouts.forEach(window.clearTimeout);
    };
  }, [activeAudioSettings.soundEffectsEnabled, phase, settings.inputMode]);

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
    setStaffGameSoundsEnabled(activeAudioSettings.soundEffectsEnabled);
    saveGameSettings(settings);
  }, [activeAudioSettings.soundEffectsEnabled, settings]);

  useEffect(() => {
    const audio = backgroundMusicRef.current;
    if (!audio) return undefined;
    audio.volume = 0.06;
    const shouldPlay = resourceLoadState === "ready" && phase === "running" && activeAudioSettings.backgroundMusicEnabled && settings.inputMode !== "physical";

    const removeUnlockListeners = (): void => {
      document.removeEventListener("pointerdown", unlockMusic);
      document.removeEventListener("keydown", unlockMusic);
    };
    const unlockMusic = (): void => {
      if (!shouldPlay || !audio.paused) return;
      playGameMusic(audio);
    };

    if (shouldPlay) {
      audio.addEventListener("play", removeUnlockListeners, { once: true });
      document.addEventListener("pointerdown", unlockMusic);
      document.addEventListener("keydown", unlockMusic);
      playGameMusic(audio);
    } else {
      audio.pause();
    }

    return () => {
      removeUnlockListeners();
      audio.removeEventListener("play", removeUnlockListeners);
      audio.pause();
    };
  }, [activeAudioSettings.backgroundMusicEnabled, phase, resourceLoadState, settings.inputMode]);

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

    if (phase !== "running" || !comboIndicator || comboResetTimeoutRef.current !== null) return;
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
    if (errorFlashTimeoutRef.current !== null) window.clearTimeout(errorFlashTimeoutRef.current);
    if (scoreAnimationTimerRef.current !== null) window.clearTimeout(scoreAnimationTimerRef.current);
  }, [microphone.stop, onSessionActiveChange]);

  useEffect(() => {
    if (phase !== "running") return undefined;
    let frame = 0;
    let lastUiUpdateAt = 0;
    const tick = (now: number): void => {
      const gameTime = elapsedBeforeRunRef.current + now - runSegmentStartedAtRef.current;
      if (now - lastUiUpdateAt >= 100) {
        lastUiUpdateAt = now;
        setElapsedMs(gameModeRef.current === "songs" ? gameTime : Math.min(gameDurationMs, gameTime));
      }
      if (gameModeRef.current === "levels" && gameTime >= gameDurationMs) {
        setElapsedMs(gameDurationMs);
        finishRound();
        return;
      }
      if (targetRef.current && !targetPoppedRef.current && gameTime - targetSpawnGameMsRef.current >= activeBubbleDurationMs) {
        const missedTarget = targetRef.current;
        targetRef.current = null;
        setTarget(null);
        if (missedTarget) triggerMascotReaction("sad");
        playStaffGameSound("noteMissed");
        resetComboDisplay();
        const isSongMode = gameModeRef.current === "songs";
        const activeSong = isSongMode ? STAFF_GAME_SONGS.find((item) => item.id === selectedSongIdRef.current) : undefined;
        if (isSongMode && activeSong && missedTarget) {
          songTargetIndexRef.current += 1;
          setSongNotesCompleted(songTargetIndexRef.current);
          songWrongTargetTokenRef.current = null;
          setFeedback(`漏掉 ${noteLabel(missedTarget)} · 继续下一音`);
        } else {
          setFeedback("气泡飘走了，连击中断");
        }
        if (nextTargetTimeoutRef.current !== null) window.clearTimeout(nextTargetTimeoutRef.current);
        nextTargetTimeoutRef.current = window.setTimeout(() => {
          nextTargetTimeoutRef.current = null;
          if (phaseRef.current !== "running") {
            waitingForNextTargetRef.current = true;
            return;
          }
          if (isSongMode && activeSong && songTargetIndexRef.current >= activeSong.noteMidis.length) {
            finishRound();
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
  }, [activeBubbleDurationMs, finishRound, gameDurationMs, phase, resetComboDisplay, spawnTarget, triggerMascotReaction]);

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
    resetComboDisplay();
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
  }, [flushScorePresentation, resetComboDisplay]);

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
    if (isStartingRef.current) return false;
    const attemptId = startAttemptRef.current + 1;
    startAttemptRef.current = attemptId;
    const isCancelled = (): boolean => attemptId !== startAttemptRef.current;
    isStartingRef.current = true;
    setIsStarting(true);
    setGameError("");
    try {
      await unlockAudio().catch(() => undefined);
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
        playStaffGameSound("microphoneReady");
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
      runSegmentStartedAtRef.current = performance.now();
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
  }, [connectMidiForRound, microphone.error, microphone.start, microphone.stop, resetRoundState, spawnTarget]);

  const cancelPendingStart = useCallback((): void => {
    if (!isStartingRef.current) return;
    startAttemptRef.current += 1;
    isStartingRef.current = false;
    setIsStarting(false);
    microphone.stop();
  }, [microphone.stop]);

  const pauseRound = useCallback((): void => {
    if (phaseRef.current !== "running") return;
    const elapsedAtPause = elapsedBeforeRunRef.current + performance.now() - runSegmentStartedAtRef.current;
    elapsedBeforeRunRef.current = gameModeRef.current === "songs" ? elapsedAtPause : Math.min(gameDurationMs, elapsedAtPause);
    setElapsedMs(elapsedBeforeRunRef.current);
    setMascotReaction((current) => ({ action: "idle", token: current.token + 1, queuedAction: null }));
    phaseRef.current = "paused";
    setPhase("paused");
    setFeedback(gameModeRef.current === "songs" ? "演奏已暂停" : "闯关已暂停");
    microphone.stop();
  }, [gameDurationMs, microphone.stop]);

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
        playStaffGameSound("microphoneReady");
      } else if (settingsRef.current.inputMode === "midi") {
        if (!await connectMidiForRound(isCancelled)) return;
        if (isCancelled()) return;
        microphone.stop();
      } else {
        microphone.stop();
      }
      if (isCancelled() || phaseRef.current !== "paused") return;
      runSegmentStartedAtRef.current = performance.now();
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
  }, [connectMidiForRound, finishRound, microphone.error, microphone.start, microphone.stop, spawnTarget]);

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
    setStaffGameSoundsEnabled(nextSettings.audioByMode[gameMode].soundEffectsEnabled);
    if (nextSettings.inputMode === "virtual") microphone.stop();
    closeGameDialog();
  }, [closeGameDialog, gameMode, microphone.stop, midi.status, settingsDraft, virtualKeyboardAvailable]);

  const handleVirtualKey = useCallback((pitch: PianoKeyName, source: "screen-keyboard" | "computer-keyboard" = "screen-keyboard"): void => {
    if (phaseRef.current !== "running") return;
    if (
      settingsRef.current.inputMode === "virtual" &&
      settingsRef.current.audioByMode[gameModeRef.current].pianoSoundEnabled
    ) {
      void playPianoNote(pitch, 4).catch(() => undefined);
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
  const showVirtualKeyboard = virtualKeyboardAvailable && settings.inputMode === "virtual" && (phase === "running" || phase === "paused");
  const mascotAction: StaffGameMascotAction = phase === "paused" ? "pause" : phase === "running" ? mascotReaction.action : "idle";
  const pauseControlDisabled = (phase !== "running" && phase !== "paused") || isStarting;

  if (resourceLoadState !== "ready") {
    return (
      <section aria-busy={resourceLoadState === "loading"} className="practice-shell staff-game-shell staff-game-loading-shell" aria-label="正在准备五线谱闯关">
        <div className="staff-game-loading-card" role={resourceLoadState === "loading" ? "status" : undefined} aria-live="polite">
          {resourceLoadState === "loading" ? <span aria-hidden="true" className="staff-game-loading-spinner" /> : null}
          <strong>{resourceLoadState === "loading" ? "正在加载游戏素材" : "部分游戏图片或声音没有加载成功"}</strong>
          <span>{resourceLoadState === "loading"
            ? resourceLoadRetryCount > 0
              ? `部分素材未就绪，正在自动重试（${resourceLoadRetryCount}/${STAFF_GAME_RESOURCE_MAX_RETRIES}）`
              : "正在准备图片、音效和背景音乐；钢琴采样未就绪时会使用合成音色"
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
        {errorFlashActive ? <div aria-hidden="true" className="staff-game-error-flash" /> : null}
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-a" draggable="false" src={cloudDecorationOne} />
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-b" draggable="false" src={cloudDecorationTwo} />
        <img alt="" aria-hidden="true" className="staff-game-cloud-drift cloud-drift-c" draggable="false" src={cloudDecorationThree} />
        {settings.gameEffectsEnabled ? <StaffGameRushSpeedLines /> : null}
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
        {songSelectionStep ? (
          <header className="staff-game-song-hud">
            <span aria-hidden="true" />
            <div><strong>游戏歌曲模式</strong><span>{songSelectionStep === "detail" ? selectedSong.title : "选择一首歌曲"}</span></div>
            <span aria-hidden="true" />
          </header>
        ) : (
          <header className={`staff-game-hud${isSongMode ? " is-song-mode" : ""}${rushModeActive ? " is-rush-mode" : ""}`}>
            <div aria-hidden={rushModeActive} className="staff-game-hud-card staff-game-display-card">
              <span>{isSongMode ? "歌曲最佳" : "历史最高"}</span>
              <strong aria-label={`${isSongMode ? selectedSongRecord.bestStars : progress.bestStars[level - 1]} 颗星`} className="staff-game-history-stars">
                {[1, 2, 3].map((star) => <img alt="" className={(isSongMode ? selectedSongRecord.bestStars : progress.bestStars[level - 1]) >= star ? "earned" : ""} key={star} src={starParticleArt} />)}
              </strong>
            </div>
            <div aria-hidden={rushModeActive} aria-label={isSongMode ? `${selectedSong.title}，已完成 ${songNotesCompleted} 音，共 ${selectedSong.noteMidis.length} 音` : `第 ${level} 关，当前获得 ${currentRoundStars} 颗星`} className={`staff-game-level-medal${isSongMode ? " is-song-progress" : ""}`}>
            <svg aria-hidden="true" className="staff-game-level-progress" viewBox="0 0 120 120">
              <path className="staff-game-level-progress-track" d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06" pathLength="1000" />
              <path
                className="staff-game-level-progress-fill"
                d="M 26.06 26.06 A 48 48 0 1 0 93.94 26.06"
                pathLength="1000"
                strokeDashoffset={1000 * (1 - activeProgress)}
              />
              {!isSongMode ? [
                { x: 15, y: 93.94 },
                { x: 105, y: 93.94 },
                { x: 93.94, y: 26.06 },
              ].map((position, index) => (
                <text
                  className={`staff-game-level-progress-star${currentRoundStars > index ? " earned" : ""}`}
                  dominantBaseline="central"
                  key={index}
                  textAnchor="middle"
                  x={position.x}
                  y={position.y}
                >★</text>
              )) : null}
            </svg>
              <span>{isSongMode ? "歌曲" : "LEVEL"}</span>
              <strong className={isSongMode ? "staff-game-song-progress-value" : undefined}>{isSongMode ? `${Math.floor(songProgressRatio * 100)}%` : level}</strong>
            </div>
            <div className="staff-game-score-group">
            <div className="staff-game-hud-card staff-game-score-card">
              <span>{isSongMode ? "本曲得分" : phase === "summary" ? "本局得分" : "本关得分"}</span>
              <strong aria-label={`当前得分 ${displayedScore}`} className={rushModeActive ? "is-rush-score" : undefined} ref={scoreValueRef}>{displayedScore}</strong>
              <small>{isSongMode
                ? `最佳 ${selectedSongRecord.bestScore}　·　${songNotesCompleted}/${selectedSong.noteMidis.length} 音　·　${songAccuracy}%`
                : `最高 ${progress.bestScores[level - 1]}${phase === "ready" ? "" : `　·　${remainingSeconds} 秒`}`}</small>
            </div>
              {isSongMode || rushModeActive ? null : <button aria-label="选择关卡跳级" className="staff-game-jump-button" onClick={() => openGameDialog("levels")} type="button">
                <SkipForward aria-hidden="true" size={14} />跳级
              </button>}
            </div>
          </header>
        )}

        <div className={`staff-game-playfield${phase === "paused" ? " is-paused" : ""}`} ref={playfieldRef}>
          <div aria-hidden="true" className="staff-game-scene-glow" />
          {(!songSelectionStep && (phase === "ready" || phase === "running" || phase === "paused")) ? (
            <div className={`staff-game-mascot-anchor${settings.gameEffectsEnabled ? " effects-enabled" : ""}${phase === "ready" && !isSongMode ? " has-greeting" : ""}`}>
              {phase === "ready" && !isSongMode ? <span aria-hidden="true" className={`staff-game-mascot-greeting${settings.gameEffectsEnabled ? " is-animated" : ""}`}>Hi~</span> : null}
              <StaffGameMascot
                action={mascotAction}
                animate={settings.gameEffectsEnabled}
                onComplete={finishMascotReaction}
                token={mascotReaction.token}
              />
            </div>
          ) : null}
          {target ? (
            <div
              aria-label={`落下的音符 ${noteLabel(target)}`}
              className={`staff-game-bubble${rushVisualsActive ? " is-rush" : ""}${targetPopped ? " is-popped" : ""}${phase === "paused" ? " is-paused" : ""}`}
              key={target.token}
              ref={targetElementRef}
              style={{ animationDuration: `${activeBubbleDurationMs}ms`, left: `${target.centerX}px` }}
            >
              <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={bubbleShell} />
              <div className="staff-game-bubble-content">
                <NoteStaff note={target} />
                <span className="staff-game-bubble-a11y">请弹奏 {noteLabel(target)}</span>
              </div>
            </div>
          ) : null}

          {rushModeActive && combo > 0 ? (
            <div
              aria-label={`${combo} 连击`}
              aria-live="polite"
              className="staff-game-combo-cloud"
              key={`combo-cloud-${combo}`}
              role="status"
            >
              <span><strong>{combo}</strong><small>连击</small></span>
            </div>
          ) : null}

          {comboIndicator && combo < RUSH_MODE_COMBO_THRESHOLD ? (
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
            <section aria-label="选择游戏歌曲" className="staff-game-card staff-game-song-card">
              <span aria-hidden="true" className="staff-game-song-card-ornament"><Sparkles size={22} strokeWidth={2.4} /></span>
              <div className="staff-game-song-list-heading">
                <div><h1>选择歌曲</h1><p>自然音单旋律 · 可以自由选歌</p></div>
                <span>{STAFF_GAME_SONGS.length} 首</span>
              </div>
              <div className="staff-game-song-list">
                {STAFF_GAME_SONGS.map((song) => {
                  const record = songProgress[song.id];
                  return (
                    <button className="staff-game-song-choice" key={song.id} onClick={() => selectSong(song.id)} type="button">
                      <span className="staff-game-song-choice-note" aria-hidden="true">♪</span>
                      <span className="staff-game-song-choice-copy">
                        <strong>{song.title}</strong>
                        <small>{song.englishTitle}</small>
                        <span>{song.difficulty} · {song.noteMidis.length} 个音 · 最佳 {record?.bestScore ?? 0} 分</span>
                      </span>
                      <strong aria-label={`${record?.bestStars ?? 0} 颗星`} className="staff-game-history-stars">
                        {[1, 2, 3].map((star) => <img alt="" className={(record?.bestStars ?? 0) >= star ? "earned" : ""} key={star} src={starParticleArt} />)}
                      </strong>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {phase === "ready" && songSelectionStep === "detail" ? (
            <section aria-label={`${selectedSong.title} 歌曲详情`} className="staff-game-card staff-game-song-card staff-game-song-detail-card">
              <span aria-hidden="true" className="staff-game-song-card-ornament"><Sparkles size={22} strokeWidth={2.4} /></span>
              <div className="staff-game-song-detail-hero">
                <div className="staff-game-preview-bubble">
                  <img alt="" aria-hidden="true" className="staff-game-bubble-shell" draggable="false" src={bubbleShell} />
                  <NoteStaff note={selectedSongPreviewNote} />
                </div>
                <div>
                  <h1>{selectedSong.title}</h1>
                  <p>{selectedSong.englishTitle}</p>
                </div>
              </div>
              <p className="staff-game-song-description">{selectedSong.description}</p>
              <div className="staff-game-song-facts">
                <span>{selectedSong.difficulty}</span><span>自然音</span><span>{selectedSong.noteMidis.length} 个音</span>
              </div>
              <div className="staff-game-song-record">
                <span>历史最佳</span>
                <strong className="staff-game-history-stars">
                  {[1, 2, 3].map((star) => <img alt="" className={selectedSongRecord.bestStars >= star ? "earned" : ""} key={star} src={starParticleArt} />)}
                </strong>
                <small>{selectedSongRecord.bestScore} 分 · 首次准确率 {selectedSongRecord.bestAccuracy}% · 最高连击 {selectedSongRecord.maxCombo}</small>
              </div>
              <p className="staff-game-song-howto">泡泡按旋律顺序出现，答错可重试；漏音后继续下一音。完成歌曲后按首次作答准确率评星。</p>
              <button className="staff-game-primary" disabled={isStarting} onClick={startSelectedSong} type="button">
                <Play fill="currentColor" size={20} />{isStarting ? "正在准备…" : "开始演奏"}
              </button>
              <button className="staff-game-song-inline-back" onClick={handleSongSelectionBack} type="button">‹ 返回歌曲列表</button>
            </section>
          ) : null}

          {phase === "ready" && songSelectionStep === null && gameMode === "levels" ? (
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

          {phase === "summary" && typeof document !== "undefined" ? createPortal(
            <div aria-label={isSongMode ? `${selectedSong.title} 演奏结算` : `第 ${level} 关结算`} aria-modal="true" className={`staff-game-summary-backdrop${settings.gameEffectsEnabled ? "" : " effects-disabled"}`} role="dialog" style={gameArtStyle}>
              <div aria-label={`${revealedSummaryStars} 颗星依次出现，获得 ${earnedStars} 颗星`} className={`staff-game-summary-stars has-star-halo${earnedStars === 0 ? " is-white-star-halo" : ""}${settings.gameEffectsEnabled ? " is-animated" : ""}`} role="img">
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
                <div aria-label={isSongMode ? selectedSong.title : `第 ${level} 关`} className="staff-game-summary-level-badge" role="img">
                  <img alt="" aria-hidden="true" draggable="false" src={summaryLevelBannerArt} />
                  <strong className={isSongMode ? "is-song-title" : undefined}>{isSongMode ? selectedSong.title : `LEVEL ${level}`}</strong>
                </div>
                <div className="staff-game-summary-content">
                  <div aria-hidden="true" className="staff-game-summary-celebration">
                    {settings.gameEffectsEnabled ? <StaffGameFireworks image={summaryFireworksArt} /> : null}
                    <StaffGameMascot
                      action={shouldCelebrateSummary ? "celebration" : "summarySad"}
                      animate={settings.gameEffectsEnabled}
                      className="staff-game-summary-mascot"
                      token={0}
                    />
                  </div>
                  {isSongMode || earnedStars > 0 ? <h2>{isSongMode ? "演奏完成！" : "闯关成功！"}</h2> : null}
                  <div className="staff-game-result-stats">
                    <div>
                      <span>最大连击数</span>
                      <strong>
                        <span>{summaryComboCount} 次</span>
                        {roundRecordsAtStartRef.current.maxCombo > 0 && maxCombo > roundRecordsAtStartRef.current.maxCombo ? <em>新纪录</em> : null}
                      </strong>
                    </div>
                    <div className="is-score">
                      <span>获得的分数</span>
                      <strong>
                        <span>{summaryScoreCount} 分</span>
                        {roundRecordsAtStartRef.current.score > 0 && score > roundRecordsAtStartRef.current.score ? <em>新纪录</em> : null}
                      </strong>
                    </div>
                    {isSongMode ? <div><span>首次准确率</span><strong>{summaryAccuracy}%</strong></div> : null}
                  </div>
                  <div className="staff-game-summary-actions">
                    <button className="staff-game-primary" onClick={retryLevel} type="button"><RotateCcw size={16} />{isSongMode ? "再弹一次" : "再试一次"}</button>
                    {isSongMode ? (
                      <>
                        <button className="staff-game-secondary" onClick={playNextSong} type="button"><SkipForward size={16} />{STAFF_GAME_SONGS[STAFF_GAME_SONGS.length - 1]?.id === selectedSong.id ? "回到歌曲列表" : "下一首"}</button>
                        {STAFF_GAME_SONGS[STAFF_GAME_SONGS.length - 1]?.id !== selectedSong.id ? <button className="staff-game-summary-list-button" onClick={returnToSongList} type="button">歌曲列表</button> : null}
                      </>
                    ) : (
                      <button className="staff-game-secondary" disabled={level >= GAME_LEVEL_COUNT} onClick={() => advanceLevel(level + 1)} type="button">
                        <SkipForward size={16} />{level >= GAME_LEVEL_COUNT ? "已通关" : "下一级"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>,
            document.body,
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
        {dialog && typeof document !== "undefined" ? createPortal(
          <div className="staff-game-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeGameDialog(); }} style={gameArtStyle}>
            <section
              aria-labelledby="staff-game-dialog-title"
              aria-modal="true"
              className={`staff-game-dialog staff-game-${dialog}-dialog${dialog === "settings" && isSettingsDialogShaking ? " is-wobbling" : ""}`}
              onAnimationEnd={(event) => {
                if (event.animationName !== "staff-game-settings-dialog-wobble") return;
                settingsDialogShakeLockRef.current = false;
                setIsSettingsDialogShaking(false);
              }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              {dialog === "help" ? (
                <>
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <h2 aria-label="提示" className="staff-game-help-title" id="staff-game-dialog-title">
                    <img alt="" aria-hidden="true" draggable="false" src={helpTitleArt} />
                  </h2>
                  <div className="staff-game-help-copy">
                    <h3>{isSongMode ? "歌曲模式说明" : "闯关模式说明"}</h3>
                    {isSongMode ? (
                      <>
                        <p>选择歌曲后，气泡会按旋律顺序出现。答错可重试当前音符；气泡飘走后会记为漏音并继续下一音。全曲完成后，按首次作答准确率评星：达到 60%、80%、95% 分别获得 1、2、3 星。</p>
                        <p>可用麦克风、MIDI 键盘或虚拟琴键输入。虚拟琴键可点击；电脑端也可用 A、S、D、F、G、H、J 弹奏 C4 到 B4。</p>
                        <p>答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。歌曲成绩会记录最佳分、准确率、星级和最高连击。</p>
                      </>
                    ) : (
                      <>
                        <p>共有 60 关：第 1–35 关逐步加入白键，第 36–60 关加入黑键。可通过「跳级」直接选择任意关卡。</p>
                        <p>观察气泡里的五线谱音符，用麦克风（实体乐器）、MIDI 键盘或虚拟琴键作答。虚拟琴键可点击，也可在电脑端用键盘输入。</p>
                        <p>答对可得分并增加连击；难度会影响基础分、气泡下落速度和连击时限，连击另有加分。星级按答对数量计算，目标随关卡时长调整，不受难度加分影响；结算页可重试或直接开始下一关，也可通过跳级选择任意关卡。</p>
                        <p>虚拟琴键输入时，电脑端可用 A、S、D、F、G、H、J 弹奏 C4 到 B4；W、E、T、Y、U 对应五个黑键。</p>
                      </>
                    )}
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
                  <button
                    aria-label="熊掌，悬停或点击可让弹窗颤动"
                    className="staff-game-settings-decoration"
                    onClick={triggerSettingsDialogShake}
                    onPointerEnter={triggerSettingsDialogShake}
                    type="button"
                  ><img alt="" aria-hidden="true" draggable="false" src={settingsPawArt} /></button>
                  <button aria-label="关闭弹窗" className="staff-game-dialog-close" onClick={closeGameDialog} type="button"><X size={23} /></button>
                  <div className="staff-game-settings-content">
                    <h2 id="staff-game-dialog-title">游戏设置</h2>
                    <section className="staff-game-settings-section">
                      <h3>输入方式</h3>
                      <div className="staff-game-input-options">
                        <button aria-pressed={settingsDraft.inputMode === "virtual"} className={`staff-game-input-option${settingsDraft.inputMode === "virtual" ? " is-selected" : ""}`} disabled={!virtualKeyboardAvailable} onClick={() => selectInputMode("virtual")} type="button">
                          <Keyboard aria-hidden="true" size={29} /><strong>虚拟琴键</strong><small>{virtualKeyboardAvailable ? "点击屏幕琴键作答，电脑也可用" : "虚拟琴键暂不可用"}</small>
                        </button>
                        <button aria-pressed={settingsDraft.inputMode === "physical"} className={`staff-game-input-option${settingsDraft.inputMode === "physical" ? " is-selected" : ""}`} onClick={() => selectInputMode("physical")} type="button">
                          <Mic aria-hidden="true" size={29} /><strong>实体钢琴</strong><small>麦克风识别，关闭背景音乐，游戏音效单独控制</small>
                        </button>
                        {midiOptionAvailable ? (
                          <button aria-pressed={settingsDraft.inputMode === "midi"} className={`staff-game-input-option${settingsDraft.inputMode === "midi" ? " is-selected" : ""}`} onClick={() => selectInputMode("midi")} type="button">
                            <Music2 aria-hidden="true" size={29} /><strong>MIDI 键盘</strong><small>{midi.isConnected ? `已连接：${midi.selectedInput?.name ?? "设备"}` : midi.status === "denied" ? "浏览器 MIDI 权限未开启" : "电脑端连接 MIDI 键盘"}</small>
                          </button>
                        ) : null}
                      </div>
                    </section>
                    <div className="staff-game-settings-pair-grid staff-game-audio-settings-grid">
                      <section className="staff-game-settings-section staff-game-settings-row">
                        <div><h3>音效</h3><p>答对、连击和关卡反馈</p></div>
                        <button aria-label={draftAudioSettings.soundEffectsEnabled ? "关闭音效" : "开启音效"} aria-pressed={draftAudioSettings.soundEffectsEnabled} className={`staff-game-sound-switch${draftAudioSettings.soundEffectsEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { soundEffectsEnabled: !current.audioByMode[gameMode].soundEffectsEnabled }))} type="button">
                          {draftAudioSettings.soundEffectsEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}<span>{draftAudioSettings.soundEffectsEnabled ? "开启" : "关闭"}</span>
                        </button>
                      </section>
                      {settingsDraft.inputMode !== "physical" ? (
                        <section className="staff-game-settings-section staff-game-settings-row staff-game-background-music-setting">
                          <div><h3>背景音乐</h3><p>轻快旋律循环播放</p></div>
                          <button aria-label={draftAudioSettings.backgroundMusicEnabled ? "关闭背景音乐" : "开启背景音乐"} aria-pressed={draftAudioSettings.backgroundMusicEnabled} className={`staff-game-sound-switch${draftAudioSettings.backgroundMusicEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { backgroundMusicEnabled: !current.audioByMode[gameMode].backgroundMusicEnabled }))} type="button">
                            {draftAudioSettings.backgroundMusicEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}<span>{draftAudioSettings.backgroundMusicEnabled ? "开启" : "关闭"}</span>
                          </button>
                        </section>
                      ) : null}
                      {settingsDraft.inputMode === "virtual" ? (
                        <section className="staff-game-settings-section staff-game-settings-row staff-game-piano-sound-setting">
                          <div><h3>钢琴声</h3><p>弹奏虚拟琴键时播放琴音</p></div>
                          <button aria-label={draftAudioSettings.pianoSoundEnabled ? "关闭钢琴声" : "开启钢琴声"} aria-pressed={draftAudioSettings.pianoSoundEnabled} className={`staff-game-sound-switch${draftAudioSettings.pianoSoundEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => updateModeAudioSettings(current, gameMode, { pianoSoundEnabled: !current.audioByMode[gameMode].pianoSoundEnabled }))} type="button">
                            {draftAudioSettings.pianoSoundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}<span>{draftAudioSettings.pianoSoundEnabled ? "开启" : "关闭"}</span>
                          </button>
                        </section>
                      ) : null}
                    </div>
                    {settingsDraft.inputMode === "virtual" ? (
                      <div className="staff-game-settings-pair-grid staff-game-virtual-effects-grid">
                        <section className="staff-game-settings-section staff-game-display-setting">
                          <label htmlFor="staff-game-display-mode">显示</label>
                          <select
                            id="staff-game-display-mode"
                            onChange={(event) => setSettingsDraft((current) => ({ ...current, displayMode: event.currentTarget.value as GameDisplayMode }))}
                            value={settingsDraft.displayMode}
                          >
                            {DISPLAY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                          </select>
                        </section>
                        <section className="staff-game-settings-section staff-game-settings-row">
                          <div><h3>游戏特效</h3><p>萤火粒子、流星、泡泡星光与烟花</p></div>
                          <button aria-label={settingsDraft.gameEffectsEnabled ? "关闭游戏特效" : "开启游戏特效"} aria-pressed={settingsDraft.gameEffectsEnabled} className={`staff-game-sound-switch staff-game-effects-switch${settingsDraft.gameEffectsEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => ({ ...current, gameEffectsEnabled: !current.gameEffectsEnabled }))} type="button">
                            <Sparkles size={19} /><span>{settingsDraft.gameEffectsEnabled ? "开启" : "关闭"}</span>
                          </button>
                        </section>
                      </div>
                    ) : (
                      <section className="staff-game-settings-section staff-game-settings-row">
                        <div><h3>游戏特效</h3><p>萤火粒子、流星、泡泡星光与烟花</p></div>
                        <button aria-label={settingsDraft.gameEffectsEnabled ? "关闭游戏特效" : "开启游戏特效"} aria-pressed={settingsDraft.gameEffectsEnabled} className={`staff-game-sound-switch staff-game-effects-switch${settingsDraft.gameEffectsEnabled ? " is-on" : ""}`} onClick={() => setSettingsDraft((current) => ({ ...current, gameEffectsEnabled: !current.gameEffectsEnabled }))} type="button">
                          <Sparkles size={19} /><span>{settingsDraft.gameEffectsEnabled ? "开启" : "关闭"}</span>
                        </button>
                      </section>
                    )}
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
          </div>,
          document.body,
        ) : null}
        {gameError && typeof document !== "undefined" ? createPortal(
          <div className="staff-game-mic-dialog-backdrop" style={gameArtStyle}>
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
          </div>,
          document.body,
        ) : null}
      </div>
      {showLowFpsPrompt && typeof document !== "undefined" ? createPortal(
        <div className="staff-game-low-fps-backdrop">
          <section aria-labelledby="staff-game-low-fps-title" aria-modal="true" className="staff-game-low-fps-dialog" role="alertdialog">
            <Sparkles aria-hidden="true" className="staff-game-low-fps-icon" size={34} />
            <h2 id="staff-game-low-fps-title">检测到页面有些卡顿</h2>
            <p>最近几秒帧率低于 28 FPS。关闭粒子、流星和烟花等特效，可能会让游戏更流畅。</p>
            <div className="staff-game-low-fps-actions">
              <button className="staff-game-secondary" onClick={() => { setShowLowFpsPrompt(false); void resumeRound(); }} type="button">保持特效</button>
              <button className="staff-game-primary" onClick={() => {
                const nextSettings = { ...settingsRef.current, gameEffectsEnabled: false };
                settingsRef.current = nextSettings;
                setSettings(nextSettings);
                setSettingsDraft(nextSettings);
                setShowLowFpsPrompt(false);
                void resumeRound();
              }} type="button">关闭特效</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
      {phase === "paused" && dialog === null && !gameError && typeof document !== "undefined" ? createPortal(
        <div className="staff-game-pause-backdrop" style={gameArtStyle}>
          <section aria-labelledby="staff-game-pause-title" aria-modal="true" className="staff-game-pause-dialog" role="dialog">
            <div aria-hidden="true" className={`staff-game-pause-clock${settings.gameEffectsEnabled ? " is-animated" : ""}`}>
              <div className="staff-game-pause-clock-face">
                <span className="staff-game-pause-clock-hand is-hour" />
                <span className="staff-game-pause-clock-hand is-minute" />
                <span className="staff-game-pause-clock-pin" />
              </div>
            </div>
            <div aria-live="polite" className={`staff-game-pause-label${settings.gameEffectsEnabled ? " is-animated" : ""}`}>
              <strong id="staff-game-pause-title">{touchGameLayout ? "暂停中.." : "暂停中，点击按钮或者按空格键继续。"}</strong>
            </div>
            <div className="staff-game-pause-actions">
              <button className="staff-game-primary" disabled={isStarting} onClick={() => void resumeRound()} type="button">
                <Play aria-hidden="true" fill="currentColor" size={20} />继续
              </button>
              <button className="staff-game-secondary" disabled={isStarting} onClick={retryLevel} type="button">
                <RotateCcw aria-hidden="true" size={20} />重新开始
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
