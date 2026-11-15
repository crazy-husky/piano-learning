import type {
  BlackKeyPracticeSettings,
  BlackKeySpelling,
  NoteName,
  PitchId,
  TargetNote,
  TargetNoteId,
} from "./types";

const NOTE_SEMITONES: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlackKeySpelling(value: unknown): value is BlackKeySpelling {
  return value === "sharp" || value === "flat" || value === "mixed";
}

export function normalizeBlackKeyPracticeSettings(value: unknown): BlackKeyPracticeSettings {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const ratio = Number(record.ratio);
  return {
    enabled: record.enabled === true,
    ratio: ([10, 20, 30, 50] as number[]).includes(ratio) ? (ratio as 10 | 20 | 30 | 50) : 20,
    spelling: isBlackKeySpelling(record.spelling) ? record.spelling : "mixed",
  };
}

export function getTargetNoteMidi(
  note: Pick<TargetNote, "noteName" | "accidental" | "octave">
): number {
  const accidentalOffset = note.accidental === "sharp" ? 1 : note.accidental === "flat" ? -1 : 0;
  return (note.octave + 1) * 12 + NOTE_SEMITONES[note.noteName] + accidentalOffset;
}

function getPitchId(noteName: NoteName, octave: number, accidental?: "sharp" | "flat"): PitchId {
  const accidentalSymbol = accidental === "sharp" ? "#" : accidental === "flat" ? "b" : "";
  return `${noteName}${accidentalSymbol}${octave}` as PitchId;
}

function withPitch(
  note: TargetNote,
  noteName: NoteName,
  octave: number,
  accidental?: "sharp" | "flat"
): TargetNote | undefined {
  if (octave < 1 || octave > 7) return undefined;
  const pitchId = getPitchId(noteName, octave, accidental);
  const explicitStaff = note.id !== note.pitchId;
  const id = (explicitStaff ? `${pitchId}-${note.staff}` : pitchId) as TargetNoteId;
  return {
    ...note,
    id,
    pitchId,
    noteName,
    octave: octave as TargetNote["octave"],
    ...(accidental ? { accidental } : { accidental: undefined }),
  };
}

/** Adds a black-key accidental while keeping the note on its current staff position. */
export function makeBlackKeyTarget(
  note: TargetNote,
  spelling: BlackKeySpelling
): TargetNote | undefined {
  if (note.accidental) return undefined;
  const accidentalBySpelling: Record<
    BlackKeySpelling,
    Partial<Record<NoteName, "sharp" | "flat">>
  > = {
    sharp: { C: "sharp", D: "sharp", E: "flat", F: "sharp", G: "sharp", A: "sharp", B: "flat" },
    flat: { C: "sharp", D: "flat", E: "flat", F: "sharp", G: "flat", A: "flat", B: "flat" },
    mixed: { C: "sharp", D: "flat", E: "flat", F: "sharp", G: "flat", A: "flat", B: "flat" },
  };
  const accidental = accidentalBySpelling[spelling][note.noteName];
  if (!accidental) return undefined;
  const target = withPitch(note, note.noteName, note.octave, accidental);
  return target && BLACK_PITCH_CLASSES.has(((getTargetNoteMidi(target) % 12) + 12) % 12)
    ? target
    : undefined;
}

/** Maps a pitch-class key on the universal keyboard to its MIDI semitone class. */
export function pianoKeySemitone(keyName: string): number | undefined {
  const sharpKeySemitones: Record<string, number> = {
    "C#": 1,
    "D#": 3,
    "F#": 6,
    "G#": 8,
    "A#": 10,
  };
  return sharpKeySemitones[keyName] ?? NOTE_SEMITONES[keyName as NoteName];
}

/** Transposes every pitch by the same semitone count, preserving chord intervals. */
export function transposeTargetNote(
  note: TargetNote,
  semitoneDelta: number,
  spelling: BlackKeySpelling
): TargetNote | undefined {
  const midi = getTargetNoteMidi(note) + semitoneDelta;
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = ((midi % 12) + 12) % 12;
  const spellings: Record<number, Array<{ noteName: NoteName; accidental?: "sharp" | "flat" }>> = {
    0: [{ noteName: "C" }],
    1: [
      { noteName: "C", accidental: "sharp" },
      { noteName: "D", accidental: "flat" },
    ],
    2: [{ noteName: "D" }],
    3: [
      { noteName: "D", accidental: "sharp" },
      { noteName: "E", accidental: "flat" },
    ],
    4: [{ noteName: "E" }],
    5: [{ noteName: "F" }],
    6: [
      { noteName: "F", accidental: "sharp" },
      { noteName: "G", accidental: "flat" },
    ],
    7: [{ noteName: "G" }],
    8: [
      { noteName: "G", accidental: "sharp" },
      { noteName: "A", accidental: "flat" },
    ],
    9: [{ noteName: "A" }],
    10: [
      { noteName: "A", accidental: "sharp" },
      { noteName: "B", accidental: "flat" },
    ],
    11: [{ noteName: "B" }],
  };
  const options = spellings[pitchClass] ?? [];
  const mixedNoteNameByPitchClass: Partial<Record<number, NoteName>> = {
    1: "C",
    3: "E",
    6: "F",
    8: "A",
    10: "B",
  };
  const chosen =
    options.find((option) =>
      spelling === "sharp"
        ? option.accidental !== "flat"
        : spelling === "flat"
          ? option.accidental !== "sharp"
          : option.noteName === mixedNoteNameByPitchClass[pitchClass]
    ) ?? options[0];
  return chosen ? withPitch(note, chosen.noteName, octave, chosen.accidental) : undefined;
}

export function maybeInfuseBlackKey(
  note: TargetNote,
  settings: BlackKeyPracticeSettings,
  random: () => number = Math.random
): TargetNote {
  if (!settings.enabled || random() >= settings.ratio / 100) return note;
  return makeBlackKeyTarget(note, settings.spelling) ?? note;
}
