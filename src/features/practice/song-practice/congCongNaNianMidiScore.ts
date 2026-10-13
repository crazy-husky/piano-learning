import type { NoteName } from "../../../domain/types";
import {
  assertValidSongPracticeScore,
  type SongPracticeDuration,
  type SongPracticeKeyVersion,
  type SongPracticeNote,
  type SongPracticeScore,
} from "./songPracticeMaterials";
import { CONG_CONG_NA_NIAN_C_MIDI_SOURCE } from "./congCongNaNianCSource";
import { CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SOURCE } from "./congCongNaNianOriginalSource";

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
  tempoMicrosPerQuarter: number;
  ticksPerQuarter: number;
  timeSignature: readonly [number, number];
}

const C_SOURCE = CONG_CONG_NA_NIAN_C_MIDI_SOURCE as unknown as CompactMidiSource;
const ORIGINAL_SOURCE = CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SOURCE as unknown as CompactMidiSource;

interface PitchSpelling {
  noteName: NoteName;
  accidental?: "sharp" | "flat";
}

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

const D_FLAT_SPELLING_BY_PITCH_CLASS: readonly PitchSpelling[] = [
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
  const quarterBeatsPerMeasure = meterNumerator * (4 / meterDenominator);
  return part.events.map(([onsetTick, durationTicks, midiPitch, eventIndex, channel]) => {
    const absoluteBeat = onsetTick / source.ticksPerQuarter;
    const measure = Math.floor(absoluteBeat / quarterBeatsPerMeasure) + 1;
    const onsetBeat = absoluteBeat - (measure - 1) * quarterBeatsPerMeasure;
    const pitchClass = ((midiPitch % 12) + 12) % 12;
    const spelling = spellingByPitchClass[pitchClass];
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

function createCongCongNaNianScore(
  source: CompactMidiSource,
  keyVersion: Exclude<SongPracticeKeyVersion, "source">,
  sourceFileName: string,
  sourcePdfFileName: string,
  pageCount: number,
  originalKey: string,
  keySpelling: readonly PitchSpelling[]
): SongPracticeScore {
  const [numerator, denominator] = source.timeSignature;
  const metadata = {
    source: {
      notationFormat: "standard-midi",
      originalKey,
      keyVersion,
      sourceFileName,
      sourcePdfFileName,
      sourceFileSha256: source.sourceFileSha256,
      ticksPerQuarter: source.ticksPerQuarter,
      pageCount,
    },
    practiceKey: originalKey.replace(/ major| minor/, ""),
    meter: {
      numerator,
      denominator,
      quarterBeatsPerMeasure: numerator * (4 / denominator),
    },
    tempoBpm: Math.round(60_000_000 / source.tempoMicrosPerQuarter),
    sections: [],
    parts: source.parts.map((part) => ({
      id: part.id,
      name: part.name,
      notes: decodePart(source, part, keySpelling),
    })),
  };
  return assertValidSongPracticeScore({
    id: keyVersion === "c" ? "cong-cong-na-nian" : "cong-cong-na-nian-original",
    title: "匆匆那年",
    ...metadata,
  });
}

export const BUILT_IN_CONG_CONG_NA_NIAN_C_MIDI_SCORE = createCongCongNaNianScore(
  C_SOURCE,
  "c",
  "匆匆那年-简单C调.mid",
  "匆匆那年-简单C调.pdf",
  3,
  "C major",
  C_SPELLING_BY_PITCH_CLASS
);

export const BUILT_IN_CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SCORE = createCongCongNaNianScore(
  ORIGINAL_SOURCE,
  "original",
  "匆匆那年-原谱.mid",
  "匆匆那年-原谱.pdf",
  6,
  "D♭ major",
  D_FLAT_SPELLING_BY_PITCH_CLASS
);
