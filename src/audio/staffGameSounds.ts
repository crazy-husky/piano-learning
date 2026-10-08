import * as Tone from "tone";
import bubblePopUrl from "../assets/staff-game/audio/bubble-pop.wav";
import comboStreakUrl from "../assets/staff-game/audio/combo-streak.wav";
import levelClearUrl from "../assets/staff-game/audio/level-clear.wav";
import microphoneReadyUrl from "../assets/staff-game/audio/microphone-ready.wav";
import noteMissedUrl from "../assets/staff-game/audio/note-missed-soft.wav";

export type StaffGameSound = "bubblePop" | "comboStreak" | "levelClear" | "microphoneReady" | "noteMissed";

interface SoundPlayer {
  player: Tone.Player;
  ready: Promise<void>;
}

const soundSources: Record<StaffGameSound, { url: string; volumeDb: number }> = {
  bubblePop: { url: bubblePopUrl, volumeDb: -13 },
  comboStreak: { url: comboStreakUrl, volumeDb: -17 },
  levelClear: { url: levelClearUrl, volumeDb: -13 },
  microphoneReady: { url: microphoneReadyUrl, volumeDb: -18 },
  noteMissed: { url: noteMissedUrl, volumeDb: -18 },
};

const soundPlayers = new Map<StaffGameSound, SoundPlayer>();
let soundEffectsEnabled = true;
let starRevealSynth: Tone.Synth | null = null;

export function setStaffGameSoundsEnabled(enabled: boolean): void {
  soundEffectsEnabled = enabled;
}

function getSoundPlayer(sound: StaffGameSound): SoundPlayer {
  const cached = soundPlayers.get(sound);
  if (cached) return cached;

  let markReady: (() => void) | undefined;
  let markFailed: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
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
  return result;
}

export function preloadStaffGameSounds(): void {
  if (typeof window === "undefined") return;
  (Object.keys(soundSources) as StaffGameSound[]).forEach(getSoundPlayer);
}

export function playStaffGameSound(sound: StaffGameSound): void {
  if (typeof window === "undefined" || !soundEffectsEnabled) return;
  const { player, ready } = getSoundPlayer(sound);
  void Tone.start()
    .then(() => ready)
    .then(() => player.start())
    .catch(() => undefined);
}

export function playStaffGameStarReveal(starIndex: number, enabled = soundEffectsEnabled): void {
  if (typeof window === "undefined" || !enabled) return;
  const notes = ["C6", "E6", "G6"] as const;
  const note = notes[Math.max(0, Math.min(notes.length - 1, Math.floor(starIndex)))];

  void Tone.start()
    .then(() => {
      starRevealSynth ??= new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.22, sustain: 0, release: 0.12 },
      }).toDestination();
      starRevealSynth.volume.value = -14;
      starRevealSynth.triggerAttackRelease(note, "16n");
    })
    .catch(() => undefined);
}
