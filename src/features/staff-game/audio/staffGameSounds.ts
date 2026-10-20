import * as Tone from "tone";
import comboAmazingUrl from "../assets/audio/combo-amazing.mp3";
import comboExcellentUrl from "../assets/audio/combo-excellent.mp3";
import bubblePopUrl from "../assets/audio/bubble-pop.wav";
import comboStreakUrl from "../assets/audio/combo-streak.wav";
import comboUnbelievableUrl from "../assets/audio/combo-unbelievable.mp3";
import levelClearUrl from "../assets/audio/level-clear.wav";
import menuClickUrl from "../assets/audio/menu-click.mp3";
import noteMissedRubberyUrl from "../assets/audio/note-missed-rubbery.wav";
import {
  STAFF_GAME_AUDIO_LIMITER_CEILING_DB,
  STAFF_GAME_AUDIO_LIMITER_LOOKAHEAD_MS,
  STAFF_GAME_AUDIO_LIMITER_RELEASE_MS,
  STAFF_GAME_AUDIO_MASTER_GAIN_LINEAR,
} from "./staffGameAudioConfig";

export type StaffGameSound =
  | "bubblePop"
  | "comboAmazing"
  | "comboExcellent"
  | "comboStreak"
  | "comboUnbelievable"
  | "levelClear"
  | "menuClick"
  | "noteMissed"
  | "noteMissedUnpitched";
type SampledStaffGameSound = StaffGameSound;
const STAFF_GAME_SOUND_LOAD_TIMEOUT_MS = 8_000;

interface SoundPlayer {
  player: Tone.Player;
  ready: Promise<void>;
}

export interface StaffGameSoundPlaybackTiming {
  startAtMs: number;
  durationMs: number;
}

const soundSources: Record<
  SampledStaffGameSound,
  { url: string; volumeDb: number; label: string }
> = {
  // Gains use measured source RMS to keep answer, combo, and level-clear cues close;
  // the short bubble/menu sounds and Streak cue remain intentionally quieter.
  bubblePop: { url: bubblePopUrl, volumeDb: -7, label: "泡泡破裂音效" },
  comboAmazing: { url: comboAmazingUrl, volumeDb: -13, label: "连击 Amazing 音效" },
  comboExcellent: { url: comboExcellentUrl, volumeDb: -14, label: "连击 Excellent 音效" },
  comboStreak: { url: comboStreakUrl, volumeDb: -31, label: "连击 Streak 音效" },
  comboUnbelievable: { url: comboUnbelievableUrl, volumeDb: -12, label: "连击 Unbelievable 音效" },
  levelClear: { url: levelClearUrl, volumeDb: -22, label: "关卡完成音效" },
  menuClick: { url: menuClickUrl, volumeDb: -28, label: "菜单点击音效" },
  noteMissed: { url: noteMissedRubberyUrl, volumeDb: -8, label: "答错音效" },
  noteMissedUnpitched: { url: noteMissedRubberyUrl, volumeDb: -8, label: "答错音效（无音高）" },
};

export const STAFF_GAME_SOUND_RESOURCES = (
  Object.entries(soundSources) as Array<
    [SampledStaffGameSound, (typeof soundSources)[SampledStaffGameSound]]
  >
).map(([sound, source]) => ({
  id: `sound:${sound}`,
  label: source.label,
  sound,
  source: source.url,
}));

export interface StaffGameSoundLoadUpdate {
  sound: SampledStaffGameSound;
  status: "loading" | "loaded" | "failed";
  error?: string;
}

const soundPlayers = new Map<SampledStaffGameSound, SoundPlayer>();
let soundEffectsEnabled = true;
let starRevealSynth: Tone.Synth | null = null;
let soundMasterGain: Tone.Gain | null = null;
let soundOutputLimiter: AudioNode | null = null;
let soundOutputLimiterModuleReady: Promise<void> | null = null;
let soundOutputLimiterReady: Promise<void> | null = null;
let soundOutputLatencyMs = STAFF_GAME_AUDIO_LIMITER_LOOKAHEAD_MS;

function getSoundMasterGain(): Tone.Gain {
  if (!soundMasterGain) {
    soundMasterGain = new Tone.Gain(STAFF_GAME_AUDIO_MASTER_GAIN_LINEAR);
    if (soundOutputLimiter) soundMasterGain.connect(soundOutputLimiter);
  }
  return soundMasterGain;
}

function limitSampleMagnitude(value: number, ceiling: number): number {
  const magnitude = Math.abs(value);
  const knee = Math.min(0.6, ceiling * 0.7);
  if (magnitude <= knee) return value;
  const kneeWidth = 1 - knee;
  const t = Math.min(1, (magnitude - knee) / kneeWidth);
  const tSquared = t * t;
  const tCubed = tSquared * t;
  const limitedMagnitude =
    (2 * tCubed - 3 * tSquared + 1) * knee +
    (tCubed - 2 * tSquared + t) * kneeWidth +
    (-2 * tCubed + 3 * tSquared) * ceiling;
  return Math.sign(value) * limitedMagnitude;
}

function createFallbackCeilingLimiter(): WaveShaperNode {
  // Leave margin for the oversampled waveshaper's reconstruction between curve points.
  const ceiling = 10 ** ((STAFF_GAME_AUDIO_LIMITER_CEILING_DB - 0.2) / 20);
  const rawContext = Tone.getContext().rawContext;
  const limiter = rawContext.createWaveShaper();
  const curve = new Float32Array(4096);
  for (let index = 0; index < curve.length; index += 1) {
    const value = (index * 2) / (curve.length - 1) - 1;
    curve[index] = limitSampleMagnitude(value, ceiling);
  }
  limiter.curve = curve;
  limiter.oversample = "4x";
  return limiter;
}

function installFallbackCeilingLimiter(): void {
  const limiter = createFallbackCeilingLimiter();
  limiter.connect(Tone.getContext().rawContext.destination);
  soundMasterGain?.connect(limiter);
  soundOutputLatencyMs = 0;
  soundOutputLimiter = limiter;
}

function connectSoundOutputLimiter(): Promise<void> {
  if (soundOutputLimiter) return Promise.resolve();
  if (soundOutputLimiterReady) return soundOutputLimiterReady;

  const toneContext = Tone.getContext();
  if (!toneContext.rawContext.audioWorklet) {
    installFallbackCeilingLimiter();
    return Promise.resolve();
  }

  const workletUrl = new URL(
    `${import.meta.env.BASE_URL}staff-game-lookahead-limiter.js`,
    window.location.origin
  );
  soundOutputLimiterModuleReady ??= toneContext
    .addAudioWorkletModule(workletUrl.href)
    .catch((error: unknown) => {
      soundOutputLimiterModuleReady = null;
      throw error;
    });
  soundOutputLimiterReady = soundOutputLimiterModuleReady
    .then(() => {
      if (soundOutputLimiter) return;
      const limiter = toneContext.createAudioWorkletNode("staff-game-lookahead-limiter", {
        channelCount: 2,
        channelCountMode: "max",
        channelInterpretation: "speakers",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          ceilingDb: STAFF_GAME_AUDIO_LIMITER_CEILING_DB,
          lookAheadMs: STAFF_GAME_AUDIO_LIMITER_LOOKAHEAD_MS,
          releaseMs: STAFF_GAME_AUDIO_LIMITER_RELEASE_MS,
        },
      });
      limiter.connect(toneContext.rawContext.destination);
      soundMasterGain?.connect(limiter);
      soundOutputLimiter = limiter;
    })
    .catch(() => {
      soundOutputLimiterReady = null;
      installFallbackCeilingLimiter();
    });
  return soundOutputLimiterReady;
}

/** Connect game background audio before Tone's destination limiter once it is ready. */
export async function connectStaffGameAudioOutputSource(source: AudioNode): Promise<boolean> {
  try {
    await connectSoundOutputLimiter();
    if (!soundOutputLimiter) return false;
    source.connect(soundOutputLimiter);
    return true;
  } catch {
    return false;
  }
}

/** Prepare the same boosted, limited bus used by Staff Game sound effects. */
export async function prepareStaffGameAudioMasterGain(): Promise<Tone.Gain> {
  await connectSoundOutputLimiter();
  return getSoundMasterGain();
}

function canPlayAudio(sound?: StaffGameSound): boolean {
  // Menu clicks are interface feedback, independent of the in-game effects setting.
  return sound === "menuClick" || soundEffectsEnabled;
}

function stopPlayingAudio(): void {
  soundPlayers.forEach(({ player }, sound) => {
    if (sound === "menuClick") return;
    try {
      player.stop();
    } catch {
      // Stopping an idle player is best-effort.
    }
  });
  try {
    starRevealSynth?.triggerRelease();
  } catch {
    // Synths may have no active voice when a mute setting changes.
  }
}

export function setStaffGameSoundsEnabled(enabled: boolean): void {
  soundEffectsEnabled = enabled;
  if (!enabled) stopPlayingAudio();
}

function getSoundPlayer(sound: SampledStaffGameSound): SoundPlayer {
  const cached = soundPlayers.get(sound);
  if (cached) return cached;

  let markReady: (() => void) | undefined;
  let markFailed: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: number | undefined;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined && typeof window !== "undefined") window.clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    markReady = () => settle();
    markFailed = (error) => settle(error);
    if (typeof window !== "undefined") {
      timeout = window.setTimeout(
        () => settle(new Error(`Timed out while loading staff game sound: ${sound}`)),
        STAFF_GAME_SOUND_LOAD_TIMEOUT_MS
      );
    }
  });
  void ready.catch(() => undefined);

  const source = soundSources[sound];
  const player = new Tone.Player({
    url: source.url,
    volume: source.volumeDb,
    onload: () => markReady?.(),
    onerror: (error) => markFailed?.(error),
  }).connect(getSoundMasterGain());
  if (player.loaded) markReady?.();

  const result = { player, ready };
  soundPlayers.set(sound, result);
  void ready.catch(() => {
    if (soundPlayers.get(sound) !== result) return;
    soundPlayers.delete(sound);
    player.dispose();
  });
  return result;
}

export async function preloadStaffGameSounds(
  onProgress?: (update: StaffGameSoundLoadUpdate) => void
): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    await connectSoundOutputLimiter();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (Object.keys(soundSources) as SampledStaffGameSound[]).forEach((sound) => {
      onProgress?.({ sound, status: "failed", error: message });
    });
    return Object.keys(soundSources).length;
  }

  const results = await Promise.allSettled(
    (Object.keys(soundSources) as SampledStaffGameSound[]).map(async (sound) => {
      onProgress?.({ sound, status: "loading" });
      try {
        await getSoundPlayer(sound).ready;
        onProgress?.({ sound, status: "loaded" });
      } catch (error) {
        onProgress?.({
          sound,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })
  );
  return results.filter((result) => result.status === "rejected").length;
}

export function playStaffGameSound(
  sound: StaffGameSound,
  onPlaybackStart?: (timing: StaffGameSoundPlaybackTiming) => void
): void {
  if (typeof window === "undefined" || !canPlayAudio(sound)) return;
  const { player, ready } = getSoundPlayer(sound);
  void Tone.start()
    .then(() => Promise.all([ready, connectSoundOutputLimiter()]))
    .then(() => {
      if (!canPlayAudio(sound)) return;
      const startAtMs = performance.now() + soundOutputLatencyMs;
      player.start();
      onPlaybackStart?.({
        startAtMs,
        durationMs: Math.max(0, player.buffer.duration * 1_000),
      });
    })
    .catch(() => undefined);
}

export function playStaffGameStarReveal(
  starIndex: number,
  enabled = soundEffectsEnabled
): Promise<void> {
  if (typeof window === "undefined" || !enabled || !canPlayAudio()) return Promise.resolve();
  const notes = ["C6", "E6", "G6"] as const;
  const note = notes[Math.max(0, Math.min(notes.length - 1, Math.floor(starIndex)))];

  return Tone.start()
    .then(() => connectSoundOutputLimiter())
    .then(() => {
      if (!canPlayAudio()) return;
      starRevealSynth ??= new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.22, sustain: 0, release: 0.12 },
      }).connect(getSoundMasterGain());
      starRevealSynth.volume.value = -14;
      starRevealSynth.triggerAttackRelease(note, "16n");
      return new Promise<void>((resolve) => window.setTimeout(resolve, 260));
    })
    .catch(() => undefined);
}
