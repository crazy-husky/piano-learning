export type MetronomeBeatSound = "woodfish1" | "woodfish2" | "woodfish3" | "mute";

export interface MetronomePreferences {
  bpm: number;
  beatsPerBar: 2 | 3 | 4 | 6;
  beatSounds: MetronomeBeatSound[];
  volume: number;
}

export const METRONOME_PREFERENCES_KEY = "anki-note.metronomePreferences";

export const DEFAULT_METRONOME_PREFERENCES: MetronomePreferences = {
  bpm: 80,
  beatsPerBar: 4,
  beatSounds: ["woodfish3", "woodfish1", "woodfish1", "woodfish1"],
  volume: 0.72,
};

const BEAT_SOUNDS = new Set<MetronomeBeatSound>(["woodfish1", "woodfish2", "woodfish3", "mute"]);
const LEGACY_BEAT_SOUNDS: Record<string, MetronomeBeatSound> = {
  strong: "woodfish1",
  weak: "woodfish2",
  high: "woodfish3",
};

export function defaultBeatSounds(
  beatsPerBar: MetronomePreferences["beatsPerBar"]
): MetronomeBeatSound[] {
  return Array.from({ length: beatsPerBar }, (_, index) =>
    index === 0 ? "woodfish3" : "woodfish1"
  );
}

function isPreviousDefaultBeatPattern(
  value: unknown,
  beatsPerBar: MetronomePreferences["beatsPerBar"]
): boolean {
  if (!Array.isArray(value) || value.length !== beatsPerBar) return false;
  return value.every((sound, index) => sound === (index === 0 ? "woodfish1" : "woodfish2"));
}

export function normalizeBeatSounds(
  value: unknown,
  beatsPerBar: MetronomePreferences["beatsPerBar"],
  fallback: readonly MetronomeBeatSound[] = []
): MetronomeBeatSound[] {
  const candidate = Array.isArray(value) ? value : fallback;
  return Array.from({ length: beatsPerBar }, (_, index) => {
    const sound = candidate[index];
    if (typeof sound === "string") {
      if (BEAT_SOUNDS.has(sound as MetronomeBeatSound)) return sound as MetronomeBeatSound;
      const migrated = LEGACY_BEAT_SOUNDS[sound];
      if (migrated) return migrated;
    }
    return index === 0 ? "woodfish3" : "woodfish1";
  });
}

export function parseMetronomePreferences(
  value: unknown,
  fallback: MetronomePreferences = DEFAULT_METRONOME_PREFERENCES
): MetronomePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const bpm = Number(candidate.bpm);
  const volume = Number(candidate.volume);
  const beatsPerBar = Number(candidate.beatsPerBar);
  const normalizedBeatsPerBar =
    beatsPerBar === 2 || beatsPerBar === 3 || beatsPerBar === 4 || beatsPerBar === 6
      ? beatsPerBar
      : fallback.beatsPerBar;

  return {
    bpm: Number.isFinite(bpm) ? Math.round(Math.min(240, Math.max(30, bpm))) : fallback.bpm,
    beatsPerBar: normalizedBeatsPerBar,
    beatSounds: isPreviousDefaultBeatPattern(candidate.beatSounds, normalizedBeatsPerBar)
      ? defaultBeatSounds(normalizedBeatsPerBar)
      : normalizeBeatSounds(candidate.beatSounds, normalizedBeatsPerBar, fallback.beatSounds),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback.volume,
  };
}
