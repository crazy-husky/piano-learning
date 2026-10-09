import { useEffect, type MutableRefObject } from "react";
import { playPianoNote, unlockAudio } from "../../../audio/piano";
import { playStaffGameSound, playStaffGameStarReveal, setStaffGameSoundsEnabled } from "../audio/staffGameSounds";
import type { PianoKeyName } from "../../../domain/types";

export type StaffGameSoundName = Parameters<typeof playStaffGameSound>[0];

interface StaffGameAudioOptions {
  settings: object;
  backgroundMusicRef: MutableRefObject<HTMLAudioElement | null>;
  phase: "ready" | "running" | "paused" | "summary";
  resourceLoadState: "loading" | "ready" | "error";
  inputMode: "physical" | "virtual" | "midi";
  soundEffectsEnabled: boolean;
  backgroundMusicEnabled: boolean;
}

function playGameMusic(audio: HTMLAudioElement): void {
  try {
    // Older iOS WebKit implementations return undefined from play() instead of a Promise.
    const result = audio.play() as Promise<void> | undefined;
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // Autoplay may wait for a user gesture even after the track has loaded.
  }
}

export function useStaffGameAudio({
  settings,
  backgroundMusicRef,
  phase,
  resourceLoadState,
  inputMode,
  soundEffectsEnabled,
  backgroundMusicEnabled,
}: StaffGameAudioOptions) {
  useEffect(() => {
    setStaffGameSoundsEnabled(soundEffectsEnabled);
  }, [settings, soundEffectsEnabled]);

  useEffect(() => {
    const audio = backgroundMusicRef.current;
    if (!audio) return undefined;
    audio.volume = 0.06;
    const shouldPlay = resourceLoadState === "ready" && phase === "running" && backgroundMusicEnabled && inputMode !== "physical";

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
  }, [backgroundMusicEnabled, backgroundMusicRef, inputMode, phase, resourceLoadState]);

  return {
    playGameSound: playStaffGameSound,
    playStarReveal: playStaffGameStarReveal,
    playVirtualPianoNote: playPianoNote as (pitch: PianoKeyName, octave: number) => Promise<void>,
    setGameSoundsEnabled: setStaffGameSoundsEnabled,
    unlockGameAudio: unlockAudio,
  };
}
