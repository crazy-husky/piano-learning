import * as Tone from "tone";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorageState } from "../../shared/hooks/useLocalStorageState";
import {
  defaultBeatSounds,
  DEFAULT_METRONOME_PREFERENCES,
  normalizeBeatSounds,
  parseMetronomePreferences,
  METRONOME_PREFERENCES_KEY,
  type MetronomeBeatSound,
  type MetronomePreferences,
} from "./metronomePreferences";

const SAMPLE_URLS = {
  woodfish1: new URL("./assets/mokugyo.wav", import.meta.url).href,
  woodfish2: new URL("./assets/mokugyo-variant-a.mp3", import.meta.url).href,
  woodfish3: new URL("./assets/mokugyo-variant-b.mp3", import.meta.url).href,
} as const;
type SampledBeatSound = keyof typeof SAMPLE_URLS;
const BEAT_SOUND_CYCLE: readonly MetronomeBeatSound[] = [
  "woodfish1",
  "woodfish2",
  "woodfish3",
  "mute",
];

export interface MetronomeController {
  audioError: string | null;
  beatIndex: number;
  beatSequence: number;
  isLoading: boolean;
  isPlaying: boolean;
  isSyncLocked: boolean;
  preferences: MetronomePreferences;
  getAudioTime: () => number;
  performanceTimeToAudioTime: (timestampMs: number) => number;
  scheduleAtAudioTime: (callback: () => void, audioTime: number) => void;
  subscribeBeat: (listener: (beat: MetronomeBeatEvent) => void) => () => void;
  adjustBpm: (amount: number) => void;
  setBpm: (value: number) => void;
  setBeatsPerBar: (value: MetronomePreferences["beatsPerBar"]) => void;
  setSyncLocked: (locked: boolean) => void;
  cycleBeatSound: (beatIndex: number) => void;
  setVolume: (value: number) => void;
  start: () => Promise<boolean>;
  stop: () => void;
}

export interface MetronomeBeatEvent {
  audioTime: number;
  beatIndex: number;
  beatsPerBar: MetronomePreferences["beatsPerBar"];
  bpm: number;
  sequence: number;
}

function volumeToDecibels(volume: number): number {
  return volume <= 0 ? -Infinity : 20 * Math.log10(volume);
}

export function useMetronomeController(): MetronomeController {
  const [preferences, setPreferences] = useLocalStorageState(
    METRONOME_PREFERENCES_KEY,
    DEFAULT_METRONOME_PREFERENCES,
    { parse: parseMetronomePreferences }
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncLocked, setIsSyncLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [beatSequence, setBeatSequence] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const preferencesRef = useRef(preferences);
  const playersRef = useRef<Partial<Record<SampledBeatSound, Tone.Player>>>({});
  const sampleLoadPromiseRef = useRef<Promise<void> | null>(null);
  const clockRef = useRef<Tone.Clock | null>(null);
  const isPlayingRef = useRef(false);
  const isLoadingRef = useRef(false);
  const isSyncLockedRef = useRef(false);
  const beatIndexRef = useRef(0);
  const startTokenRef = useRef(0);
  const beatListenersRef = useRef(new Set<(beat: MetronomeBeatEvent) => void>());

  preferencesRef.current = preferences;

  const setBpm = useCallback(
    (value: number): void => {
      if (!Number.isFinite(value)) return;
      const bpm = Math.round(Math.min(240, Math.max(30, value)));
      setPreferences((current) => (current.bpm === bpm ? current : { ...current, bpm }));
    },
    [setPreferences]
  );

  const adjustBpm = useCallback(
    (amount: number): void => {
      setPreferences((current) => ({
        ...current,
        bpm: Math.min(240, Math.max(30, current.bpm + amount)),
      }));
    },
    [setPreferences]
  );

  const setBeatsPerBar = useCallback(
    (value: MetronomePreferences["beatsPerBar"]): void => {
      if (isSyncLockedRef.current) return;
      beatIndexRef.current = 0;
      setBeatIndex(0);
      setPreferences((current) => ({
        ...current,
        beatsPerBar: value,
        beatSounds: normalizeBeatSounds(current.beatSounds, value, current.beatSounds),
      }));
    },
    [setPreferences]
  );

  const setSyncLocked = useCallback((locked: boolean): void => {
    isSyncLockedRef.current = locked;
    setIsSyncLocked(locked);
  }, []);

  const cycleBeatSound = useCallback(
    (beatIndex: number): void => {
      setPreferences((current) => {
        if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex >= current.beatsPerBar) {
          return current;
        }
        const beatSounds = normalizeBeatSounds(
          current.beatSounds,
          current.beatsPerBar,
          defaultBeatSounds(current.beatsPerBar)
        );
        const currentIndex = BEAT_SOUND_CYCLE.indexOf(beatSounds[beatIndex]!);
        beatSounds[beatIndex] = BEAT_SOUND_CYCLE[(currentIndex + 1) % BEAT_SOUND_CYCLE.length]!;
        return { ...current, beatSounds };
      });
    },
    [setPreferences]
  );

  const setVolume = useCallback(
    (value: number): void => {
      if (!Number.isFinite(value)) return;
      const volume = Math.min(1, Math.max(0, value));
      setPreferences((current) => ({ ...current, volume }));
    },
    [setPreferences]
  );

  const stop = useCallback((): void => {
    startTokenRef.current += 1;
    const clock = clockRef.current;
    clockRef.current = null;
    clock?.stop();
    clock?.dispose();
    Object.values(playersRef.current).forEach((player) => player?.stop());
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const loadSamples = useCallback(async (): Promise<void> => {
    if (!sampleLoadPromiseRef.current) {
      const loading = Promise.all(
        Object.entries(SAMPLE_URLS).map(async ([sound, url]) => {
          const key = sound as SampledBeatSound;
          let player = playersRef.current[key];
          if (!player) {
            player = new Tone.Player().toDestination();
            playersRef.current[key] = player;
          }
          await player.load(url);
        })
      ).then(() => undefined);
      sampleLoadPromiseRef.current = loading;
      try {
        await loading;
      } catch (error) {
        Object.values(playersRef.current).forEach((player) => player?.dispose());
        playersRef.current = {};
        sampleLoadPromiseRef.current = null;
        throw error;
      }
    } else {
      await sampleLoadPromiseRef.current;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (isPlayingRef.current) return true;
    if (isLoadingRef.current) return false;
    const startToken = ++startTokenRef.current;
    isLoadingRef.current = true;
    setIsLoading(true);
    setAudioError(null);

    try {
      await Tone.start();
      if (startToken !== startTokenRef.current) return false;
      await loadSamples();
      if (startToken !== startTokenRef.current) return false;
      Object.values(playersRef.current).forEach((player) => {
        if (player) player.volume.value = volumeToDecibels(preferencesRef.current.volume);
      });
      beatIndexRef.current = 0;

      const clock = new Tone.Clock((time) => {
        if (!isPlayingRef.current) return;
        const currentPreferences = preferencesRef.current;
        const currentIndex = beatIndexRef.current % currentPreferences.beatsPerBar;
        const sound = currentPreferences.beatSounds[currentIndex] ?? "woodfish2";
        const currentPlayer = sound === "mute" ? undefined : playersRef.current[sound];
        if (currentPlayer && currentPreferences.volume > 0) {
          currentPlayer.start(time);
        }
        const sequence = beatSequenceRef.current + 1;
        beatSequenceRef.current = sequence;
        const beatEvent: MetronomeBeatEvent = {
          audioTime: time,
          beatIndex: currentIndex,
          beatsPerBar: currentPreferences.beatsPerBar,
          bpm: currentPreferences.bpm,
          sequence,
        };
        beatListenersRef.current.forEach((listener) => listener(beatEvent));
        const playbackToken = startTokenRef.current;
        Tone.Draw.schedule(() => {
          if (!isPlayingRef.current || playbackToken !== startTokenRef.current) return;
          setBeatSequence(sequence);
          setBeatIndex(currentIndex + 1);
        }, time);
        beatIndexRef.current = (currentIndex + 1) % currentPreferences.beatsPerBar;
      }, preferencesRef.current.bpm / 60);

      clockRef.current = clock;
      isPlayingRef.current = true;
      setIsPlaying(true);
      clock.start();
      return true;
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "木鱼音效加载失败，请重试。");
      return false;
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [loadSamples]);

  const beatSequenceRef = useRef(0);

  const getAudioTime = useCallback((): number => Tone.getContext().currentTime, []);
  const performanceTimeToAudioTime = useCallback(
    (timestampMs: number): number => {
      if (!Number.isFinite(timestampMs)) return getAudioTime();
      return getAudioTime() + (timestampMs - performance.now()) / 1000;
    },
    [getAudioTime]
  );
  const scheduleAtAudioTime = useCallback((callback: () => void, audioTime: number): void => {
    if (!Number.isFinite(audioTime) || audioTime <= Tone.getContext().currentTime) {
      callback();
      return;
    }
    Tone.Draw.schedule(callback, audioTime);
  }, []);
  const subscribeBeat = useCallback(
    (listener: (beat: MetronomeBeatEvent) => void): (() => void) => {
      beatListenersRef.current.add(listener);
      return () => beatListenersRef.current.delete(listener);
    },
    []
  );

  useEffect(() => {
    if (clockRef.current) clockRef.current.frequency.value = preferences.bpm / 60;
    Object.values(playersRef.current).forEach((player) => {
      if (player) player.volume.value = volumeToDecibels(preferences.volume);
    });
  }, [preferences.bpm, preferences.volume]);

  useEffect(() => {
    const stopWhenHidden = (): void => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [stop]);

  useEffect(
    () => () => {
      clockRef.current?.stop();
      clockRef.current?.dispose();
      Object.values(playersRef.current).forEach((player) => {
        player?.stop();
        player?.dispose();
      });
    },
    []
  );

  return {
    audioError,
    beatIndex,
    beatSequence,
    isLoading,
    isPlaying,
    isSyncLocked,
    preferences,
    getAudioTime,
    performanceTimeToAudioTime,
    scheduleAtAudioTime,
    subscribeBeat,
    adjustBpm,
    setBpm,
    setBeatsPerBar,
    setSyncLocked,
    cycleBeatSound,
    setVolume,
    start,
    stop,
  };
}
