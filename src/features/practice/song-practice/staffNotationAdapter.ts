import type { NoteName } from "../../../domain/types";
import type {
  SongPracticeDuration,
  SongPracticeNotationAdapter,
  SongPracticePart,
  SongPracticeStaff,
} from "./songPracticeMaterials";

/** Compact source event emitted by scripts/practice-scores/musicxml_to_staff_events.py. */
export type StaffNotationSourceEvent = readonly [
  page: number,
  measure: number,
  onsetBeat: number,
  durationBeats: number,
  midiPitch: number,
  sourceSymbol: string,
  eventIndex: number,
];

export interface StaffNotationSourcePart {
  id: SongPracticeStaff;
  name: string;
  events: readonly StaffNotationSourceEvent[];
}

export interface StaffNotationSource {
  transposeSemitones: number;
  parts: readonly StaffNotationSourcePart[];
}

const C_MAJOR_NOTES: readonly { midiPitchClass: number; noteName: NoteName }[] = [
  { midiPitchClass: 0, noteName: "C" },
  { midiPitchClass: 2, noteName: "D" },
  { midiPitchClass: 4, noteName: "E" },
  { midiPitchClass: 5, noteName: "F" },
  { midiPitchClass: 7, noteName: "G" },
  { midiPitchClass: 9, noteName: "A" },
  { midiPitchClass: 11, noteName: "B" },
];

const DURATIONS: readonly { beats: number; duration: SongPracticeDuration }[] = [
  { beats: 0.0625, duration: "sixty-fourth" },
  { beats: 0.125, duration: "thirty-second" },
  { beats: 0.25, duration: "sixteenth" },
  { beats: 0.375, duration: "dotted-sixteenth" },
  { beats: 1 / 3, duration: "triplet-eighth" },
  { beats: 0.5, duration: "eighth" },
  { beats: 0.75, duration: "dotted-eighth" },
  { beats: 1, duration: "quarter" },
  { beats: 1.25, duration: "quarter-plus-sixteenth" },
  { beats: 4 / 3, duration: "triplet-half" },
  { beats: 1.5, duration: "dotted-quarter" },
  { beats: 1.75, duration: "double-dotted-quarter" },
  { beats: 2, duration: "half" },
  { beats: 3, duration: "dotted-half" },
  { beats: 4, duration: "whole" },
  { beats: 6, duration: "dotted-whole" },
];

function resolveCNote(
  sourceMidiPitch: number,
  transposeSemitones: number
): {
  midiPitch: number;
  noteName: NoteName;
  octave: number;
} {
  const transposedMidiPitch = sourceMidiPitch + transposeSemitones;
  const midiPitch =
    [transposedMidiPitch - 1, transposedMidiPitch, transposedMidiPitch + 1]
      .filter((candidate) =>
        C_MAJOR_NOTES.some((note) => note.midiPitchClass === ((candidate % 12) + 12) % 12)
      )
      .sort(
        (left, right) =>
          Math.abs(left - transposedMidiPitch) - Math.abs(right - transposedMidiPitch) ||
          left - right
      )[0] ?? transposedMidiPitch;
  const pitchClass = ((midiPitch % 12) + 12) % 12;
  const noteName = C_MAJOR_NOTES.find((note) => note.midiPitchClass === pitchClass)?.noteName;
  if (noteName === undefined) throw new Error(`Unsupported practice pitch: ${midiPitch}`);
  return { midiPitch, noteName, octave: Math.floor(midiPitch / 12) - 1 };
}

function resolveDuration(durationBeats: number): SongPracticeDuration {
  const exactDuration = DURATIONS.find(
    (candidate) => Math.abs(candidate.beats - durationBeats) < 0.00001
  );
  // Ties can span measures or combine note values not represented by one glyph.
  // Keep exact timing in durationBeats while choosing the nearest supported
  // notehead glyph for visual display.
  if (!exactDuration && Number.isFinite(durationBeats) && durationBeats > 0) {
    return DURATIONS.reduce((nearest, candidate) =>
      Math.abs(candidate.beats - durationBeats) < Math.abs(nearest.beats - durationBeats)
        ? candidate
        : nearest
    ).duration;
  }
  if (!exactDuration) {
    throw new Error(`Unsupported exact staff-note duration: ${durationBeats} quarter beats`);
  }
  return exactDuration.duration;
}

export const STAFF_NOTATION_ADAPTER: SongPracticeNotationAdapter<StaffNotationSource> = {
  notationFormat: "staff-notation",
  decode: (source): readonly SongPracticePart[] =>
    source.parts.map(({ id, name, events }) => ({
      id,
      name,
      notes: events.map((event) => {
        const [page, measure, onsetBeat, durationBeats, sourceMidiPitch, sourceSymbol, eventIndex] =
          event;
        const { midiPitch, noteName, octave } = resolveCNote(
          sourceMidiPitch,
          source.transposeSemitones
        );
        return {
          noteName,
          octave,
          midiPitch,
          sourceMidiPitch,
          duration: resolveDuration(durationBeats),
          durationBeats,
          measure,
          onsetBeat,
          staff: id,
          sourceSymbol,
          sourceAnchor: { page, measure, eventIndex },
        };
      }),
    })),
};
