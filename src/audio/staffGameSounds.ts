import * as Tone from "tone";
import comboAmazingUrl from "../assets/staff-game/audio/combo-amazing.mp3";
import comboExcellentUrl from "../assets/staff-game/audio/combo-excellent.mp3";
import bubblePopUrl from "../assets/staff-game/audio/bubble-pop.wav";
import comboStreakUrl from "../assets/staff-game/audio/combo-streak.wav";
import comboUnbelievableUrl from "../assets/staff-game/audio/combo-unbelievable.mp3";
import levelClearUrl from "../assets/staff-game/audio/level-clear.wav";
import menuClickUrl from "../assets/staff-game/audio/menu-click.mp3";
import microphoneReadyUrl from "../assets/staff-game/audio/microphone-ready.wav";
import noteMissedUrl from "../assets/staff-game/audio/note-missed-soft.wav";

export type StaffGameSound =
  | "bubblePop"
  | "comboAmazing"
  | "comboExcellent"
  | "comboStreak"
  | "comboUnbelievable"
  | "levelClear"
  | "menuClick"
  | "microphoneReady"
  | "noteMissed";
type SampledStaffGameSound = StaffGameSound;
const STAFF_GAME_SOUND_LOAD_TIMEOUT_MS = 8_000;

interface SoundPlayer {
  player: Tone.Player;
  ready: Promise<void>;
}

const soundSources: Record<SampledStaffGameSound, { url: string; volumeDb: number }> = {
  bubblePop: { url: bubblePopUrl, volumeDb: -13 },
  comboAmazing: { url: comboAmazingUrl, volumeDb: -8 },
  comboExcellent: { url: comboExcellentUrl, volumeDb: -8 },
  comboStreak: { url: comboStreakUrl, volumeDb: -20 },
  comboUnbelievable: { url: comboUnbelievableUrl, volumeDb: -8 },
  levelClear: { url: levelClearUrl, volumeDb: -13 },
  menuClick: { url: menuClickUrl, volumeDb: -14 },
  microphoneReady: { url: microphoneReadyUrl, volumeDb: -18 },
  noteMissed: { url: noteMissedUrl, volumeDb: -18 },
};

const soundPlayers = new Map<SampledStaffGameSound, SoundPlayer>();
let soundEffectsEnabled = true;
let starRevealSynth: Tone.Synth | null = null;

function canPlayAudio(): boolean {
  return soundEffectsEnabled;
}

function stopPlayingAudio(): void {
  soundPlayers.forEach(({ player }) => {
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
        STAFF_GAME_SOUND_LOAD_TIMEOUT_MS,
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

export async function preloadStaffGameSounds(): Promise<number> {
  if (typeof window === "undefined") return 0;
  const results = await Promise.allSettled(
    (Object.keys(soundSources) as SampledStaffGameSound[]).map((sound) => getSoundPlayer(sound).ready),
  );
  return results.filter((result) => result.status === "rejected").length;
}

export function playStaffGameSound(sound: StaffGameSound): void {
  if (typeof window === "undefined" || !canPlayAudio()) return;
  const { player, ready } = getSoundPlayer(sound);
  void Tone.start()
    .then(() => ready)
    .then(() => {
      if (canPlayAudio()) player.start();
    })
    .catch(() => undefined);
}

export function playStaffGameStarReveal(starIndex: number, enabled = soundEffectsEnabled): Promise<void> {
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
