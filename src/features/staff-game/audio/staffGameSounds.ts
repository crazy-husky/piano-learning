import * as Tone from "tone";
import comboAmazingUrl from "../assets/audio/combo-amazing.mp3";
import comboExcellentUrl from "../assets/audio/combo-excellent.mp3";
import bubblePopUrl from "../assets/audio/bubble-pop.wav";
import comboStreakUrl from "../assets/audio/combo-streak.wav";
import comboUnbelievableUrl from "../assets/audio/combo-unbelievable.mp3";
import levelClearUrl from "../assets/audio/level-clear.wav";
import menuClickUrl from "../assets/audio/menu-click.mp3";
import noteMissedRubberyUrl from "../assets/audio/note-missed-rubbery.wav";

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
  startedAtMs: number;
  durationMs: number;
}

const soundSources: Record<
  SampledStaffGameSound,
  { url: string; volumeDb: number; label: string }
> = {
  bubblePop: { url: bubblePopUrl, volumeDb: -13, label: "泡泡破裂音效" },
  comboAmazing: { url: comboAmazingUrl, volumeDb: -8, label: "连击 Amazing 音效" },
  comboExcellent: { url: comboExcellentUrl, volumeDb: -8, label: "连击 Excellent 音效" },
  comboStreak: { url: comboStreakUrl, volumeDb: -20, label: "连击 Streak 音效" },
  comboUnbelievable: { url: comboUnbelievableUrl, volumeDb: -8, label: "连击 Unbelievable 音效" },
  levelClear: { url: levelClearUrl, volumeDb: -13, label: "关卡完成音效" },
  menuClick: { url: menuClickUrl, volumeDb: -14, label: "菜单点击音效" },
  noteMissed: { url: noteMissedRubberyUrl, volumeDb: -6, label: "答错音效" },
  noteMissedUnpitched: { url: noteMissedRubberyUrl, volumeDb: -6, label: "答错音效（无音高）" },
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
  }).toDestination();
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
    .then(() => ready)
    .then(() => {
      if (!canPlayAudio(sound)) return;
      const startedAtMs = performance.now();
      player.start();
      onPlaybackStart?.({
        startedAtMs,
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
    .then(() => {
      if (!canPlayAudio()) return;
      starRevealSynth ??= new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.22, sustain: 0, release: 0.12 },
      }).toDestination();
      starRevealSynth.volume.value = -14;
      starRevealSynth.triggerAttackRelease(note, "16n");
      return new Promise<void>((resolve) => window.setTimeout(resolve, 260));
    })
    .catch(() => undefined);
}
