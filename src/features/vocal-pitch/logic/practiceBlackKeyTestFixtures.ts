import type { PianoKeyName } from "../../../domain/types";

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const PITCH_NAMES: readonly PianoKeyName[] = [
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

export const PRACTICE_BLACK_KEY_MIDI_NOTES = Array.from({ length: 60 }, (_, index) => index + 36)
  .filter((midiNoteNumber) => BLACK_PITCH_CLASSES.has(midiNoteNumber % 12))
  .map((midiNoteNumber) => ({
    midiNoteNumber,
    noteName: PITCH_NAMES[midiNoteNumber % 12],
    octave: Math.floor(midiNoteNumber / 12) - 1,
  }));

export function harmonicTone(
  frequencyHz: number,
  sampleRate: number,
  length: number
): Float32Array {
  return Float32Array.from({ length }, (_, index) => {
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    return 0.4 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase);
  });
}
