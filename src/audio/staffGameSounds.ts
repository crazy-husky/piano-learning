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

interface SoundPlayer {
  player: Tone.Player;
  ready: Promise<void>;
}

const soundSources: Record<SampledStaffGameSound, { url: string; volumeDb: number }> = {
  bubblePop: { url: bubblePopUrl, volumeDb: -13 },
  comboAmazing: { url: comboAmazingUrl, volumeDb: -8 },
  comboExcellent: { url: comboExcellentUrl, volumeDb: -8 },
  comboStreak: { url: comboStreakUrl, volumeDb: -17 },
  comboUnbelievable: { url: comboUnbelievableUrl, volumeDb: -8 },
  levelClear: { url: levelClearUrl, volumeDb: -13 },
  menuClick: { url: menuClickUrl, volumeDb: -14 },
  microphoneReady: { url: microphoneReadyUrl, volumeDb: -18 },
  noteMissed: { url: noteMissedUrl, volumeDb: -18 },
};

const soundPlayers = new Map<SampledStaffGameSound, SoundPlayer>();
let soundEffectsEnabled = true;
let audioSuppressed = false;
let starRevealSynth: Tone.Synth | null = null;

function canPlayAudio(): boolean {
  return soundEffectsEnabled && !audioSuppressed;
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

export function setStaffGameAudioSuppressed(suppressed: boolean): void {
  audioSuppressed = suppressed;
  if (suppressed) stopPlayingAudio();
}

function getSoundPlayer(sound: SampledStaffGameSound): SoundPlayer {
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
  (Object.keys(soundSources) as SampledStaffGameSound[]).forEach(getSoundPlayer);
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
