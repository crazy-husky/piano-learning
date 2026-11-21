import type { PracticeMode } from "../../../domain/types";
import type { CurrentPracticeGroupId } from "../../../domain/types";

export type ChordQuality =
  | "major-triad"
  | "minor-triad"
  | "diminished-triad"
  | "major-seventh"
  | "minor-seventh"
  | "dominant-seventh"
  | "half-diminished-seventh";
export type ChordKind = "triad" | "seventh";
export type ChordDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ChordTask = "recognize" | "block" | "arpeggio";
export type ChordRecognitionMode = "quiz" | "cards";
export type ChordRecognitionArrangement = "block" | "arpeggio" | "mixed";
export type ChordArpeggioPatternId = "ascending-return" | "broken-block-ending" | "pop-loop";
export type ChordNoteDuration = "8" | "q" | "h" | "w";
export type ChordLengthMode = PracticeMode;

export const CHORD_ARPEGGIO_PATTERN_OPTIONS: readonly {
  id: ChordArpeggioPatternId;
  label: string;
  description: string;
}[] = [
  {
    id: "ascending-return",
    label: "上行往返型",
    description: "沿当前转位由低到高展开，再顺序回落。",
  },
  {
    id: "broken-block-ending",
    label: "分解加柱式收尾",
    description: "前三拍依次分解，最后一拍合弹整组和弦。",
  },
  {
    id: "pop-loop",
    label: "流行循环型",
    description: "低音与高音交替，穿插和弦内音形成八分音符循环。",
  },
];

export const CHORD_INVERSION_OPTIONS = [
  { value: 0, label: "根音" },
  { value: 1, label: "第一转位" },
  { value: 2, label: "第二转位" },
  { value: 3, label: "第三转位" },
] as const;

export function getChordInversionLabel(inversion: number): string {
  return CHORD_INVERSION_OPTIONS.find((option) => option.value === inversion)?.label ?? "根音";
}

export interface ChordTrainingConfig {
  task: ChordTask;
  recognitionMode: ChordRecognitionMode;
  recognitionArrangement: ChordRecognitionArrangement;
  keyId: string;
  /** Octaves in which each chord's root-position reference note is placed. */
  practiceGroupIds: CurrentPracticeGroupId[];
  chordDegrees: ChordDegree[];
  qualities: ChordKind[];
  inversions: number[];
  arpeggioPatterns: ChordArpeggioPatternId[];
  requireInversionAnswer: boolean;
  highlightRoot: boolean;
  metronomeSyncEnabled: boolean;
  lengthMode: ChordLengthMode;
  fixedCount: number;
  fixedDurationSeconds: number;
}

export interface ChordMajorKey {
  id: string;
  label: string;
  tonicLetter: string;
  tonicPitchClass: number;
  vexKey: string;
}

export interface ChordNote {
  letter: string;
  accidental: -1 | 0 | 1;
  octave: number;
  midi: number;
}

export interface DiatonicChord {
  id: string;
  keyId: string;
  degree: number;
  kind: ChordKind;
  quality: ChordQuality;
  rootName: string;
  name: string;
}

export interface ChordPrompt {
  chord: DiatonicChord;
  inversion: number;
  notes: ChordNote[];
  noteEvents: {
    notes: ChordNote[];
    duration: ChordNoteDuration;
  }[];
  arpeggioPatternId?: ChordArpeggioPatternId;
}

export interface ChordRecognitionCard {
  id: string;
  chord: DiatonicChord;
  inversion: number;
  practiceGroupId: CurrentPracticeGroupId;
  blockPrompt: ChordPrompt;
  arpeggioPrompt: ChordPrompt;
}

export interface ChordTrainingAnswerEventData {
  task: ChordTask;
  keyId: string;
  chordId: string;
  chordName: string;
  degree: number;
  quality: ChordQuality;
  inversion: number;
  noteDuration?: ChordNoteDuration;
  targetMidiNotes: number[];
  noteEvents?: {
    midiNotes: number[];
    duration: ChordNoteDuration;
  }[];
  arpeggioPatternId?: ChordArpeggioPatternId;
  enteredMidiNotes?: number[];
  selectedChordId?: string;
  selectedRootName?: string;
  selectedQuality?: ChordQuality;
  selectedInversion?: number;
}

export const CHORD_MAJOR_KEYS: readonly ChordMajorKey[] = [
  { id: "C", label: "C 大调", tonicLetter: "C", tonicPitchClass: 0, vexKey: "C" },
  { id: "G", label: "G 大调", tonicLetter: "G", tonicPitchClass: 7, vexKey: "G" },
  { id: "D", label: "D 大调", tonicLetter: "D", tonicPitchClass: 2, vexKey: "D" },
  { id: "A", label: "A 大调", tonicLetter: "A", tonicPitchClass: 9, vexKey: "A" },
  { id: "E", label: "E 大调", tonicLetter: "E", tonicPitchClass: 4, vexKey: "E" },
  { id: "B", label: "B 大调", tonicLetter: "B", tonicPitchClass: 11, vexKey: "B" },
  { id: "F#", label: "F♯ 大调", tonicLetter: "F", tonicPitchClass: 6, vexKey: "F#" },
  { id: "F", label: "F 大调", tonicLetter: "F", tonicPitchClass: 5, vexKey: "F" },
  { id: "Bb", label: "B♭ 大调", tonicLetter: "B", tonicPitchClass: 10, vexKey: "Bb" },
  { id: "Eb", label: "E♭ 大调", tonicLetter: "E", tonicPitchClass: 3, vexKey: "Eb" },
  { id: "Ab", label: "A♭ 大调", tonicLetter: "A", tonicPitchClass: 8, vexKey: "Ab" },
  { id: "Db", label: "D♭ 大调", tonicLetter: "D", tonicPitchClass: 1, vexKey: "Db" },
];

export const DEFAULT_CHORD_TRAINING_CONFIG: ChordTrainingConfig = {
  task: "recognize",
  recognitionMode: "quiz",
  recognitionArrangement: "block",
  keyId: "C",
  practiceGroupIds: ["C4-B4"],
  chordDegrees: [1],
  qualities: ["triad"],
  inversions: [0],
  arpeggioPatterns: CHORD_ARPEGGIO_PATTERN_OPTIONS.map(({ id }) => id),
  requireInversionAnswer: true,
  highlightRoot: true,
  metronomeSyncEnabled: false,
  lengthMode: "fixed-count",
  fixedCount: 30,
  fixedDurationSeconds: 90,
};

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;
const NOTE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
const TRIAD_QUALITIES: readonly ChordQuality[] = [
  "major-triad",
  "minor-triad",
  "minor-triad",
  "major-triad",
  "major-triad",
  "minor-triad",
  "diminished-triad",
];
const SEVENTH_QUALITIES: readonly ChordQuality[] = [
  "major-seventh",
  "minor-seventh",
  "minor-seventh",
  "major-seventh",
  "dominant-seventh",
  "minor-seventh",
  "half-diminished-seventh",
];
const QUALITY_LABELS: Record<ChordQuality, string> = {
  "major-triad": "大三和弦",
  "minor-triad": "小三和弦",
  "diminished-triad": "减三和弦",
  "major-seventh": "大七和弦",
  "minor-seventh": "小七和弦",
  "dominant-seventh": "属七和弦",
  "half-diminished-seventh": "半减七和弦",
};

export const CHORD_DEGREE_OPTIONS: readonly {
  degree: ChordDegree;
  label: string;
  description: string;
}[] = [
  { degree: 1, label: "I", description: "主和弦" },
  { degree: 5, label: "V", description: "属和弦" },
  { degree: 6, label: "vi", description: "关系小和弦" },
  { degree: 4, label: "IV", description: "下属和弦" },
  { degree: 2, label: "ii", description: "上主和弦" },
  { degree: 3, label: "iii", description: "中音和弦" },
  { degree: 7, label: "vii°", description: "导音减和弦" },
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

function accidentalFor(letter: string, pitchClass: number): -1 | 0 | 1 {
  const letterIndex = NOTE_LETTERS.indexOf(letter as (typeof NOTE_LETTERS)[number]);
  const naturalPitch = NATURAL_PITCH_CLASSES[letterIndex]!;
  const difference = ((pitchClass - naturalPitch + 18) % 12) - 6;
  if (difference < -1 || difference > 1) {
    throw new Error(`Unsupported chord spelling for ${letter} at pitch class ${pitchClass}`);
  }
  return difference as -1 | 0 | 1;
}

function noteName(letter: string, accidental: -1 | 0 | 1): string {
  return `${letter}${accidental === 1 ? "♯" : accidental === -1 ? "♭" : ""}`;
}

export function getChordMajorKey(keyId: string): ChordMajorKey {
  return CHORD_MAJOR_KEYS.find((key) => key.id === keyId) ?? CHORD_MAJOR_KEYS[0]!;
}

export function getDiatonicChords(
  keyId: string,
  chordDegrees: readonly ChordDegree[],
  kinds: readonly ChordKind[]
): DiatonicChord[] {
  if (chordDegrees.length === 0 || kinds.length === 0) {
    throw new Error("至少选择一个和弦级数和一种和弦类型");
  }
  const key = getChordMajorKey(keyId);
  return chordDegrees.flatMap((degreeNumber) => {
    const degree = degreeNumber - 1;
    return kinds.map((kind) => {
      const rootPitchClass = (key.tonicPitchClass + MAJOR_SCALE_STEPS[degree]!) % 12;
      const rootLetter =
        NOTE_LETTERS[
          (NOTE_LETTERS.indexOf(key.tonicLetter as (typeof NOTE_LETTERS)[number]) + degree) % 7
        ]!;
      const rootAccidental = accidentalFor(rootLetter, rootPitchClass);
      const quality = (kind === "triad" ? TRIAD_QUALITIES : SEVENTH_QUALITIES)[degree]!;
      const rootName = noteName(rootLetter, rootAccidental);
      return {
        id: `${key.id}:${degree + 1}:${kind}`,
        keyId: key.id,
        degree: degree + 1,
        kind,
        quality,
        rootName,
        name: `${rootName} ${QUALITY_LABELS[quality]}`,
      };
    });
  });
}

function notesForDiatonicChord(
  key: ChordMajorKey,
  degree: number,
  kind: ChordKind,
  inversion: number,
  baseOctave: number
): ChordNote[] {
  const rootLetterIndex = NOTE_LETTERS.indexOf(key.tonicLetter as (typeof NOTE_LETTERS)[number]);
  const chordSteps = kind === "triad" ? [0, 2, 4] : [0, 2, 4, 6];
  const notes = chordSteps.map((chordStep) => {
    const absoluteScaleStep = degree + chordStep;
    const scaleIndex = absoluteScaleStep % 7;
    const octaveCarry = Math.floor(absoluteScaleStep / 7);
    const letter = NOTE_LETTERS[(rootLetterIndex + absoluteScaleStep) % 7]!;
    const pitchClass = (key.tonicPitchClass + MAJOR_SCALE_STEPS[scaleIndex]!) % 12;
    const accidental = accidentalFor(letter, pitchClass);
    const midi = (baseOctave + 1 + octaveCarry) * 12 + pitchClass;
    return { letter, accidental, octave: baseOctave + octaveCarry, midi };
  });
  const rotation = inversion % notes.length;
  return [
    ...notes.slice(rotation).map((note) => ({ ...note })),
    ...notes
      .slice(0, rotation)
      .map((note) => ({ ...note, octave: note.octave + 1, midi: note.midi + 12 })),
  ];
}

const STANDARD_PIANO_TOP_MIDI = 108; // C8

function makeChordNotes(chord: DiatonicChord, inversion: number, baseOctave: number): ChordNote[] {
  const key = getChordMajorKey(chord.keyId);
  const notes = notesForDiatonicChord(key, chord.degree - 1, chord.kind, inversion, baseOctave);
  // The selected octave anchors the chord's root position. Inversions may
  // cross octave boundaries; shift the whole voicing down only if it would
  // exceed the top C of a standard piano, preserving the inversion.
  const octaveShift =
    Math.max(...notes.map((note) => note.midi)) > STANDARD_PIANO_TOP_MIDI ? -12 : 0;
  return octaveShift === 0
    ? notes
    : notes.map((note) => ({
        ...note,
        octave: note.octave + octaveShift / 12,
        midi: note.midi + octaveShift,
      }));
}

function makeRecognitionPrompt(
  chord: DiatonicChord,
  inversion: number,
  baseOctave: number,
  arrangement: Exclude<ChordRecognitionArrangement, "mixed">,
  blockDuration: ChordNoteDuration = "q"
): ChordPrompt {
  const notes = makeChordNotes(chord, inversion, baseOctave);
  return {
    chord,
    inversion,
    notes,
    noteEvents:
      arrangement === "block"
        ? [{ notes, duration: blockDuration }]
        : notes.map((note) => ({ notes: [note], duration: "q" })),
  };
}

export function getChordRecognitionCards(config: ChordTrainingConfig): ChordRecognitionCard[] {
  const chords = getDiatonicChords(config.keyId, config.chordDegrees, config.qualities);
  const practiceGroupIds =
    config.practiceGroupIds.length > 0
      ? config.practiceGroupIds
      : DEFAULT_CHORD_TRAINING_CONFIG.practiceGroupIds;
  return practiceGroupIds.flatMap((practiceGroupId) => {
    const baseOctave = Number(practiceGroupId.slice(1, 2));
    return chords.flatMap((chord) => {
      const validInversions = config.inversions.filter(
        (inversion) => inversion < (chord.kind === "triad" ? 3 : 4)
      );
      const inversions =
        validInversions.length > 0
          ? validInversions
          : [0, 1, 2].slice(0, chord.kind === "triad" ? 3 : 4);
      return inversions.map((inversion) => ({
        id: `${practiceGroupId}:${chord.id}:${inversion}`,
        chord,
        inversion,
        practiceGroupId,
        blockPrompt: makeRecognitionPrompt(chord, inversion, baseOctave, "block"),
        arpeggioPrompt: makeRecognitionPrompt(chord, inversion, baseOctave, "arpeggio"),
      }));
    });
  });
}

export function getChordDegreeLabel(degree: number): string {
  return ["I", "ii", "iii", "IV", "V", "vi", "vii°"][degree - 1] ?? "";
}

export function getChordQualityLabel(quality: ChordQuality): string {
  return QUALITY_LABELS[quality];
}

export function getVexChordNoteKey(note: ChordNote): string {
  const accidental = note.accidental === 1 ? "#" : note.accidental === -1 ? "b" : "";
  return `${note.letter.toLowerCase()}${accidental}/${note.octave}`;
}

export function generateChordPrompt(
  config: ChordTrainingConfig,
  random: () => number = Math.random
): ChordPrompt {
  if (config.qualities.length === 0) throw new Error("至少选择一种和弦类型");
  const chords = getDiatonicChords(config.keyId, config.chordDegrees, config.qualities);
  const chord = pick(chords, random);
  const availableInversions = config.inversions.filter(
    (inversionIndex) => inversionIndex < (chord.kind === "triad" ? 3 : 4)
  );
  const selectedPracticeGroups =
    config.practiceGroupIds.length > 0
      ? config.practiceGroupIds
      : DEFAULT_CHORD_TRAINING_CONFIG.practiceGroupIds;
  const practiceGroupId =
    selectedPracticeGroups.length > 1
      ? pick(selectedPracticeGroups, random)
      : selectedPracticeGroups[0]!;
  const baseOctave = Number(practiceGroupId.slice(1, 2));
  const inversion = pick(
    availableInversions.length > 0
      ? availableInversions
      : [0, 1, 2].slice(0, chord.kind === "triad" ? 3 : 4),
    random
  );
  if (config.task === "recognize") {
    const arrangement =
      config.recognitionArrangement === "mixed"
        ? pick(["block", "arpeggio"] as const, random)
        : config.recognitionArrangement;
    if (arrangement === "arpeggio") {
      return makeRecognitionPrompt(chord, inversion, baseOctave, arrangement);
    }
    const durationRoll = random() * 12;
    const blockDuration: ChordNoteDuration =
      durationRoll < 5 ? "q" : durationRoll < 9 ? "h" : durationRoll < 11 ? "8" : "w";
    return makeRecognitionPrompt(chord, inversion, baseOctave, arrangement, blockDuration);
  }
  const promptNotes = makeChordNotes(chord, inversion, baseOctave);
  if (config.task === "arpeggio") {
    const enabledPatterns = config.arpeggioPatterns.filter((pattern) =>
      CHORD_ARPEGGIO_PATTERN_OPTIONS.some((option) => option.id === pattern)
    );
    const arpeggioPatternId = pick(
      enabledPatterns.length > 0
        ? enabledPatterns
        : CHORD_ARPEGGIO_PATTERN_OPTIONS.map(({ id }) => id),
      random
    );
    const [low, second, third, high] = promptNotes;
    const singleNoteEvent = (note: ChordNote | undefined, duration: ChordNoteDuration) => ({
      notes: [note!],
      duration,
    });
    const events: ChordPrompt["noteEvents"] =
      arpeggioPatternId === "ascending-return"
        ? chord.kind === "triad"
          ? [low, second, third, second].map((note) => singleNoteEvent(note, "q"))
          : [low, second, third, high, third, second, low, second].map((note) =>
              singleNoteEvent(note, "8")
            )
        : arpeggioPatternId === "broken-block-ending"
          ? [
              ...[low, second, third].map((note) => singleNoteEvent(note, "q")),
              { notes: promptNotes, duration: "q" },
            ]
          : (chord.kind === "triad"
              ? [low, third, second, third, low, third, second, third]
              : [low, high, third, high, second, high, third, high]
            ).map((note) => singleNoteEvent(note, "8"));

    return { chord, inversion, notes: promptNotes, noteEvents: events, arpeggioPatternId };
  }

  const durationRoll = random() * 12;
  const noteDuration: ChordNoteDuration =
    durationRoll < 5 ? "q" : durationRoll < 9 ? "h" : durationRoll < 11 ? "8" : "w";
  return {
    chord,
    inversion,
    notes: promptNotes,
    noteEvents: [{ notes: promptNotes, duration: noteDuration }],
  };
}

export function chordNotesMatch(expected: readonly number[], entered: readonly number[]): boolean {
  if (expected.length !== entered.length) return false;
  const expectedSorted = [...expected].sort((left, right) => left - right);
  const enteredSorted = [...new Set(entered)].sort((left, right) => left - right);
  return (
    expectedSorted.length === enteredSorted.length &&
    expectedSorted.every((midi, index) => midi === enteredSorted[index])
  );
}

export function getChordPromptMidiNotes(prompt: ChordPrompt): number[] {
  return prompt.notes.map((note) => note.midi);
}
