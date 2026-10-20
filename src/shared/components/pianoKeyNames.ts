import type { NoteName, PianoKeyName } from "../../domain/types";

export const NATURAL_PIANO_KEY_NAMES: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
export const PIANO_KEY_NAMES: readonly PianoKeyName[] = [
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
export const NATURAL_PIANO_KEYS: ReadonlySet<PianoKeyName> = new Set(NATURAL_PIANO_KEY_NAMES);
export const ALL_PIANO_KEYS: ReadonlySet<PianoKeyName> = new Set(PIANO_KEY_NAMES);

export function isNaturalPianoKey(keyName: PianoKeyName): keyName is NoteName {
  return NATURAL_PIANO_KEYS.has(keyName);
}
