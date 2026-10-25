import type { Octave, PianoKeyName } from "../../../domain/types";

export const NAME_TO_KEY_MIDI_RANGE = { min: 29, max: 95 } as const;
export const NAME_TO_KEY_NATURAL_MIDI_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

const SHARP_NAMES: readonly PianoKeyName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const FLAT_NAMES: Partial<Record<PianoKeyName, string>> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

export interface NameToKeyConfig {
  includeOctaveNumbers: boolean;
  includeBlackKeys: boolean;
  randomEnharmonics: boolean;
}

export interface NameToKeyTarget {
  displayName: string;
  keyName: PianoKeyName;
  midi: number;
  octave: Octave;
}

export function getNameToKeyTarget(
  midi: number,
  randomEnharmonics: boolean,
  includeOctaveNumbers = true
): NameToKeyTarget {
  const keyName = SHARP_NAMES[midi % 12];
  const octave = (Math.floor(midi / 12) - 1) as Octave;
  const flatName = FLAT_NAMES[keyName];
  const displayKey = flatName && randomEnharmonics && Math.random() >= 0.5 ? flatName : keyName;
  return {
    displayName: `${displayKey}${includeOctaveNumbers ? octave : ""}`,
    keyName,
    midi,
    octave,
  };
}

export function createNameToKeyTargetPool(config: NameToKeyConfig): number[] {
  const min = config.includeOctaveNumbers ? NAME_TO_KEY_MIDI_RANGE.min : 60;
  const max = config.includeOctaveNumbers ? NAME_TO_KEY_MIDI_RANGE.max : 71;
  const pool: number[] = [];
  for (let midi = min; midi <= max; midi += 1) {
    if (!config.includeBlackKeys && !NAME_TO_KEY_NATURAL_MIDI_CLASSES.has(midi % 12)) continue;
    pool.push(midi);
  }
  return pool;
}

export function chooseNameToKeyTarget(
  pool: readonly number[],
  previousMidi?: number
): number | null {
  if (pool.length === 0) return null;
  const withoutRepeat = pool.length > 1 ? pool.filter((midi) => midi !== previousMidi) : [...pool];
  const candidates = withoutRepeat.length > 0 ? withoutRepeat : [...pool];
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export function midiToKeyName(midi: number): PianoKeyName | null {
  if (!Number.isInteger(midi) || midi < 0) return null;
  return SHARP_NAMES[midi % 12] ?? null;
}

export function midiToOctave(midi: number): Octave | null {
  const octave = Math.floor(midi / 12) - 1;
  return octave >= 1 && octave <= 7 ? (octave as Octave) : null;
}

export function midiForOctaveKey(octave: number, semitone: number): number {
  return (octave + 1) * 12 + semitone;
}

export function formatMidiName(midi: number, includeOctave = true): string {
  const name = midiToKeyName(midi);
  if (!name) return `MIDI ${midi}`;
  return `${name}${includeOctave ? (midiToOctave(midi) ?? "") : ""}`;
}
