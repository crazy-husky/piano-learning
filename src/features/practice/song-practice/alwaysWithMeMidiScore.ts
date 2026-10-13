import type { NoteName } from "../../../domain/types";
import {
  assertValidSongPracticeScore,
  type SongPracticeDuration,
  type SongPracticeKeyVersion,
  type SongPracticeNote,
  type SongPracticeScore,
} from "./songPracticeMaterials";
import { ALWAYS_WITH_ME_SIMPLE_MIDI_SOURCE } from "./alwaysWithMeSimpleSource";
import { ALWAYS_WITH_ME_ORIGINAL_MIDI_SOURCE } from "./alwaysWithMeOriginalSource";

interface CompactMidiPart {
  id: "bass" | "treble";
  name: string;
  midiTrackIndex: number;
  events: readonly (readonly [number, number, number, number, number])[];
}

interface CompactMidiSource {
  fileFormat: number;
  keySignatureFifths: number;
  keySignatureIsMinor: boolean;
  lastNoteOffTick: number;
  parts: readonly CompactMidiPart[];
  sourceFileSha256: string;
  tempoEvents: readonly (readonly [number, number, number])[];
  tempoMicrosPerQuarter: number;
  ticksPerQuarter: number;
  timeSignature: readonly [number, number];
}

interface PitchSpelling {
  noteName: NoteName;
  accidental?: "sharp" | "flat";
}

const SIMPLE_SOURCE = ALWAYS_WITH_ME_SIMPLE_MIDI_SOURCE as unknown as CompactMidiSource;
const ORIGINAL_SOURCE = ALWAYS_WITH_ME_ORIGINAL_MIDI_SOURCE as unknown as CompactMidiSource;

const C_SPELLING_BY_PITCH_CLASS: readonly PitchSpelling[] = [
  { noteName: "C" },
  { noteName: "C", accidental: "sharp" },
  { noteName: "D" },
  { noteName: "D", accidental: "sharp" },
  { noteName: "E" },
  { noteName: "F" },
  { noteName: "F", accidental: "sharp" },
  { noteName: "G" },
  { noteName: "G", accidental: "sharp" },
  { noteName: "A" },
  { noteName: "A", accidental: "sharp" },
  { noteName: "B" },
];

const FLAT_SPELLING_BY_PITCH_CLASS: readonly PitchSpelling[] = [
  { noteName: "C" },
  { noteName: "D", accidental: "flat" },
  { noteName: "D" },
  { noteName: "E", accidental: "flat" },
  { noteName: "E" },
  { noteName: "F" },
  { noteName: "G", accidental: "flat" },
  { noteName: "G" },
  { noteName: "A", accidental: "flat" },
  { noteName: "A" },
  { noteName: "B", accidental: "flat" },
  { noteName: "B" },
];

const DURATION_OPTIONS: readonly { beats: number; duration: SongPracticeDuration }[] = [
  { beats: 1 / 16, duration: "sixty-fourth" },
  { beats: 1 / 8, duration: "thirty-second" },
  { beats: 1 / 4, duration: "sixteenth" },
  { beats: 3 / 8, duration: "dotted-sixteenth" },
  { beats: 1 / 3, duration: "triplet-eighth" },
  { beats: 1 / 2, duration: "eighth" },
  { beats: 3 / 4, duration: "dotted-eighth" },
  { beats: 1, duration: "quarter" },
  { beats: 3 / 2, duration: "dotted-quarter" },
  { beats: 2, duration: "half" },
  { beats: 3, duration: "dotted-half" },
  { beats: 4, duration: "whole" },
  { beats: 6, duration: "dotted-whole" },
];

function resolveDuration(durationBeats: number): SongPracticeDuration {
  return DURATION_OPTIONS.reduce((nearest, option) =>
    Math.abs(option.beats - durationBeats) < Math.abs(nearest.beats - durationBeats)
      ? option
      : nearest
  ).duration;
}

function decodePart(
  source: CompactMidiSource,
  part: CompactMidiPart,
  spellingByPitchClass: readonly PitchSpelling[]
): SongPracticeNote[] {
  const [meterNumerator, meterDenominator] = source.timeSignature;
  const beatsPerMeasure = meterNumerator * (4 / meterDenominator);
  return part.events.map(([onsetTick, durationTicks, midiPitch, eventIndex, channel]) => {
    const absoluteBeat = onsetTick / source.ticksPerQuarter;
    const measure = Math.floor(absoluteBeat / beatsPerMeasure) + 1;
    const onsetBeat = absoluteBeat - (measure - 1) * beatsPerMeasure;
    const spelling = spellingByPitchClass[((midiPitch % 12) + 12) % 12];
    const octave = Math.floor(midiPitch / 12) - 1;
    const durationBeats = durationTicks / source.ticksPerQuarter;
    return {
      ...spelling,
      octave,
      midiPitch,
      sourceMidiPitch: midiPitch,
      duration: resolveDuration(durationBeats),
      durationBeats,
      measure,
      onsetBeat,
      staff: part.id,
      sourceSymbol: `${spelling.noteName}${spelling.accidental === "flat" ? "♭" : spelling.accidental === "sharp" ? "♯" : ""}${octave}`,
      sourceMidiLocation: {
        channel,
        durationTicks,
        eventIndex,
        midiTrackIndex: part.midiTrackIndex,
        onsetTick,
      },
    };
  });
}

function createAlwaysWithMeScore(
  source: CompactMidiSource,
  keyVersion: Exclude<SongPracticeKeyVersion, "source">,
  sourceFileName: string,
  sourcePdfFileName: string,
  originalKey: string,
  pageCount: number,
  spellingByPitchClass: readonly PitchSpelling[]
): SongPracticeScore {
  const [numerator, denominator] = source.timeSignature;
  const beatsPerMeasure = numerator * (4 / denominator);
  return assertValidSongPracticeScore({
    id: keyVersion === "c" ? "always-with-me" : "always-with-me-original",
    title: "Always with Me（千与千寻片尾曲）",
    source: {
      notationFormat: "standard-midi",
      originalKey,
      keyVersion,
      sourceFileName,
      sourcePdfFileName,
      sourceFileSha256: source.sourceFileSha256,
      ticksPerQuarter: source.ticksPerQuarter,
      sourceTempoEvents: source.tempoEvents.map(([tick, microsecondsPerQuarter, trackIndex]) => ({
        tick,
        microsecondsPerQuarter,
        trackIndex,
      })),
      pageCount,
    },
    practiceKey: originalKey.replace(/ major| minor/, ""),
    meter: {
      numerator,
      denominator,
      quarterBeatsPerMeasure: beatsPerMeasure,
    },
    tempoBpm: Math.round(60_000_000 / source.tempoMicrosPerQuarter),
    sections: [],
    parts: source.parts.map((part) => ({
      id: part.id,
      name: part.name,
      notes: decodePart(source, part, spellingByPitchClass),
    })),
  });
}

export const BUILT_IN_ALWAYS_WITH_ME_C_MIDI_SCORE = createAlwaysWithMeScore(
  SIMPLE_SOURCE,
  "c",
  "Always with Me-简单C调.mid",
  "Always with Me-简单C调.pdf",
  "C major",
  2,
  C_SPELLING_BY_PITCH_CLASS
);

export const BUILT_IN_ALWAYS_WITH_ME_ORIGINAL_MIDI_SCORE = createAlwaysWithMeScore(
  ORIGINAL_SOURCE,
  "original",
  "Always with Me-原谱.mid",
  "Always with Me-原谱.pdf",
  "F major",
  6,
  FLAT_SPELLING_BY_PITCH_CLASS
);
