import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import type {
  DuetPracticeLevel,
  NoteName,
  PracticeGroupId,
  Staff,
  TargetNote,
} from "../../../domain/types";
import type { GeneratedStaffPageRhythm, StaffPageNoteDuration } from "./staffPageNotation";

export const DUET_PROMPT_TIMEOUT_MS = 3_500;
export const DUET_PRACTICE_CURRICULUM_VERSION = 2;

export type DuetPracticeRangePreset = "standard" | "extended";

export const DEFAULT_DUET_PRACTICE_RANGE_PRESET: DuetPracticeRangePreset = "standard";

export function normalizeDuetPracticeRangePreset(value: unknown): DuetPracticeRangePreset {
  return value === "extended" ? "extended" : DEFAULT_DUET_PRACTICE_RANGE_PRESET;
}

export function getDuetPracticeGroupIds(preset: DuetPracticeRangePreset): PracticeGroupId[] {
  return preset === "extended" ? ["C2-B2", "C3-B3", "C4-B4", "C5-B5"] : ["C3-B3", "C4-B4"];
}

export function getDuetPracticeRangeSummary(preset: DuetPracticeRangePreset): string {
  return preset === "extended" ? "C2–B5（左右手各两个八度）" : "C3–B4（左右手各一个八度）";
}

export interface DuetTargetPair {
  /** Notes in the treble staff for this onset. An empty array means a rest. */
  high: TargetNote[];
  /** Notes in the bass staff for this onset. An empty array means a rest. */
  low: TargetNote[];
}

export interface DuetPracticeGenerationOptions {
  allowDottedRhythms?: boolean;
  startBeat?: number;
  exactCount?: boolean;
  /** Cap generation to this many complete measures, relative to startBeat. */
  measureCount?: number;
  /** Stable for one practice session so appended score buffers continue the same score. */
  seed?: number | string;
}

export interface GeneratedDuetPracticePage {
  events: DuetTargetPair[];
  notes: TargetNote[];
  noteGroups: TargetNote[][];
  rhythm: GeneratedStaffPageRhythm;
}

interface MeasureEvent {
  beat: number;
  high: NoteName[];
  highDuration?: StaffPageNoteDuration;
  low: NoteName[];
  lowDuration?: StaffPageNoteDuration;
}

interface ChordTemplate {
  bassRoot: NoteName;
  bassFifth: NoteName;
  chordNotes: readonly NoteName[];
}

interface LevelOneRhythmEvent {
  beat: number;
  duration: StaffPageNoteDuration;
}

interface LevelOneRhythmTemplate {
  events: readonly LevelOneRhythmEvent[];
  weight: number;
}

type LevelOneNoteOffsets = Record<Staff, number>;
type LevelOneNotePools = Record<Staff, readonly NoteName[]>;

const NOTE_NAME_ORDER: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];

// Quarter-note motion is the common case. Three templates use a half note,
// so a half rest appears in only a minority of measures instead of every bar.
const LEVEL_ONE_RHYTHM_TEMPLATES: readonly LevelOneRhythmTemplate[] = [
  {
    events: [0, 1, 2, 3].map((beat) => ({ beat, duration: "quarter" })),
    weight: 8,
  },
  {
    events: [
      { beat: 0, duration: "quarter" },
      { beat: 1, duration: "half" },
      { beat: 3, duration: "quarter" },
    ],
    weight: 1,
  },
  {
    events: [
      { beat: 0, duration: "half" },
      { beat: 2, duration: "quarter" },
      { beat: 3, duration: "quarter" },
    ],
    weight: 1,
  },
  {
    events: [
      { beat: 0, duration: "quarter" },
      { beat: 1, duration: "quarter" },
      { beat: 2, duration: "half" },
    ],
    weight: 1,
  },
  {
    events: [
      { beat: 0, duration: "half" },
      { beat: 2, duration: "half" },
    ],
    weight: 1,
  },
];

const DEFAULT_DUET_SEED = 0x51a7c0de;

function hashSeed(seed: number | string | undefined): number {
  if (typeof seed === "number") return seed >>> 0;
  if (typeof seed !== "string") return DEFAULT_DUET_SEED;

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getMeasureRandom(seed: number, measureIndex: number, channel: number): number {
  let value = (seed ^ Math.imul(measureIndex + 1, 0x9e3779b1) ^ channel) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function getLevelOneRhythmTemplate(measureIndex: number, seed: number): LevelOneRhythmTemplate {
  const totalWeight = LEVEL_ONE_RHYTHM_TEMPLATES.reduce(
    (total, template) => total + template.weight,
    0
  );
  const selection = getMeasureRandom(seed, measureIndex, 0x72687974) * totalWeight;
  let remainingWeight = selection;
  for (const template of LEVEL_ONE_RHYTHM_TEMPLATES) {
    remainingWeight -= template.weight;
    if (remainingWeight < 0) return template;
  }
  return LEVEL_ONE_RHYTHM_TEMPLATES[0]!;
}

function shuffleLevelOneNoteBag(
  noteNames: readonly NoteName[],
  bagIndex: number,
  seed: number,
  channel: number
): NoteName[] {
  const bag = [...noteNames];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      getMeasureRandom(seed, bagIndex, channel + index * 0x101) * (index + 1)
    );
    [bag[index], bag[swapIndex]] = [bag[swapIndex]!, bag[index]!];
  }
  return bag;
}

function getBalancedLevelOneNoteName(
  noteNames: readonly NoteName[],
  noteIndex: number,
  seed: number,
  channel: number
): NoteName {
  if (noteNames.length === 0) return "C";
  if (noteNames.length === 1) return noteNames[0]!;

  const bagIndex = Math.floor(noteIndex / noteNames.length);
  const bagOffset = noteIndex % noteNames.length;
  const bag = shuffleLevelOneNoteBag(noteNames, bagIndex, seed, channel);

  // Only the previous bag's last note affects this bag's first note. Avoid
  // walking every earlier bag when an appended score buffer resumes a long run.
  if (bagIndex > 0) {
    const previousBagLastNote = shuffleLevelOneNoteBag(noteNames, bagIndex - 1, seed, channel).at(
      -1
    );
    if (previousBagLastNote && bag[0] === previousBagLastNote) {
      const swapIndex = bag.findIndex(
        (noteName, index) => index > 0 && noteName !== previousBagLastNote
      );
      if (swapIndex > 0) [bag[0], bag[swapIndex]] = [bag[swapIndex]!, bag[0]!];
    }
  }

  return bag[bagOffset] ?? noteNames[0]!;
}

function getSynchronizedEventCount(
  level: "level-2" | "level-3",
  measureIndex: number,
  seed: number
): number {
  const selection = getMeasureRandom(seed, measureIndex, 0x73796e63);
  if (level === "level-2") return selection < 0.8 ? 1 : 2;
  if (selection < 0.2) return 1;
  if (selection < 0.7) return 2;
  if (selection < 0.9) return 3;
  // The requested Level 3 percentages total 90%; use the remaining 10% for four syncs.
  return 4;
}

function getSynchronizedBeats(
  candidateBeats: readonly number[],
  count: number,
  measureIndex: number,
  seed: number
): number[] {
  const beats = [...candidateBeats];
  for (let index = beats.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      getMeasureRandom(seed, measureIndex, 0x62656174 + index * 0x101) * (index + 1)
    );
    [beats[index], beats[swapIndex]] = [beats[swapIndex]!, beats[index]!];
  }
  return beats.slice(0, count).sort((left, right) => left - right);
}

function getDurationForBeatSpan(beatSpan: number): StaffPageNoteDuration {
  const normalizedSpan = Number(beatSpan.toFixed(2));
  const durationByBeatSpan: Record<number, StaffPageNoteDuration> = {
    0.5: "eighth",
    1: "quarter",
    1.5: "dotted-quarter",
    2: "half",
    3: "dotted-half",
    4: "whole",
  };
  return durationByBeatSpan[normalizedSpan] ?? "quarter";
}

function getInitialAlternatingStaff(seed: number): Staff {
  return getMeasureRandom(seed, 0, 0x68616e64) < 0.5 ? "treble" : "bass";
}

const CHORD_PROGRESSION: readonly ChordTemplate[] = [
  { bassRoot: "C", bassFifth: "G", chordNotes: ["C", "E", "G"] },
  { bassRoot: "F", bassFifth: "C", chordNotes: ["C", "F", "A"] },
  { bassRoot: "G", bassFifth: "D", chordNotes: ["D", "G", "B"] },
  { bassRoot: "C", bassFifth: "G", chordNotes: ["C", "E", "G"] },
];

const QUARTER_MELODY_PHRASES: readonly (readonly (readonly NoteName[])[])[] = [
  [
    ["C", "D", "E", "G"],
    ["A", "G", "F", "E"],
    ["D", "E", "F", "G"],
    ["E", "D", "C", "C"],
  ],
  [
    ["E", "F", "G", "A"],
    ["G", "F", "E", "D"],
    ["C", "E", "G", "E"],
    ["D", "C", "B", "C"],
  ],
];

const EIGHTH_MELODY_PHRASES: readonly (readonly (readonly NoteName[])[])[] = [
  [
    ["C", "D", "E", "F", "G", "F", "E", "D"],
    ["E", "F", "G", "A", "G", "F", "E", "D"],
    ["D", "E", "F", "G", "A", "G", "F", "E"],
    ["G", "F", "E", "D", "C", "D", "C", "C"],
  ],
  [
    ["E", "G", "A", "G", "F", "E", "D", "C"],
    ["D", "E", "F", "G", "E", "F", "G", "A"],
    ["G", "A", "G", "F", "E", "D", "E", "F"],
    ["G", "F", "E", "D", "C", "D", "C", "C"],
  ],
];

function getPhraseMeasure(
  phrases: readonly (readonly (readonly NoteName[])[])[],
  measureIndex: number
): readonly NoteName[] {
  const phraseIndex = Math.floor(measureIndex / 4) % phrases.length;
  return phrases[phraseIndex]![measureIndex % 4]!;
}

function getMeasureChord(measureIndex: number): ChordTemplate {
  return CHORD_PROGRESSION[measureIndex % CHORD_PROGRESSION.length]!;
}

function makeEvent(
  beat: number,
  high: NoteName[] = [],
  low: NoteName[] = [],
  duration: StaffPageNoteDuration = "quarter",
  highDuration: StaffPageNoteDuration = duration,
  lowDuration: StaffPageNoteDuration = duration
): MeasureEvent {
  return {
    beat,
    high,
    ...(high.length > 0 ? { highDuration } : {}),
    low,
    ...(low.length > 0 ? { lowDuration } : {}),
  };
}

function makeAlternatingEvent(
  staff: Staff,
  beat: number,
  noteName: NoteName,
  duration: StaffPageNoteDuration
): MeasureEvent {
  return staff === "treble"
    ? makeEvent(beat, [noteName], [], duration)
    : makeEvent(beat, [], [noteName], duration);
}

function getMeasureEvents(
  level: DuetPracticeLevel,
  measureIndex: number,
  alternatingFirstStaff: Staff,
  useDottedTemplate: boolean,
  seed: number,
  levelOneNotePools?: LevelOneNotePools,
  levelOneNoteOffsets: LevelOneNoteOffsets = { treble: 0, bass: 0 }
): MeasureEvent[] {
  const chord = getMeasureChord(measureIndex);
  const quarterMelody = getPhraseMeasure(QUARTER_MELODY_PHRASES, measureIndex);
  const eighthMelody = getPhraseMeasure(EIGHTH_MELODY_PHRASES, measureIndex);

  if (level === "level-1") {
    const otherStaff: Staff = alternatingFirstStaff === "bass" ? "treble" : "bass";
    const events: readonly LevelOneRhythmEvent[] = useDottedTemplate
      ? [
          { beat: 0, duration: "dotted-quarter" },
          { beat: 1.5, duration: "eighth" },
          { beat: 2, duration: "quarter" },
          { beat: 3, duration: "quarter" },
        ]
      : getLevelOneRhythmTemplate(measureIndex, seed).events;
    const nextNoteOffsets = { ...levelOneNoteOffsets };

    return events.map(({ beat, duration }, index) => {
      const staff = index % 2 === 0 ? alternatingFirstStaff : otherStaff;
      const notePool = levelOneNotePools?.[staff] ?? NOTE_NAME_ORDER;
      const noteName = getBalancedLevelOneNoteName(
        notePool,
        nextNoteOffsets[staff],
        seed,
        staff === "treble" ? 0x74726562 : 0x62617373
      );
      nextNoteOffsets[staff] += 1;
      return makeAlternatingEvent(staff, beat, noteName, duration);
    });
  }

  if (level === "level-2") {
    const rhythmEvents: readonly LevelOneRhythmEvent[] = useDottedTemplate
      ? [
          { beat: 0, duration: "dotted-quarter" },
          { beat: 1.5, duration: "eighth" },
          { beat: 2, duration: "quarter" },
          { beat: 3, duration: "quarter" },
        ]
      : [0, 1, 2, 3].map((beat) => ({ beat, duration: "quarter" as const }));
    const synchronizedBeats = getSynchronizedBeats(
      rhythmEvents.map((event) => event.beat),
      getSynchronizedEventCount(level, measureIndex, seed),
      measureIndex,
      seed
    );
    let bassSyncIndex = 0;

    return rhythmEvents.map(({ beat, duration }, index) => {
      const hasBassSync = synchronizedBeats.includes(beat);
      const bassNote = hasBassSync
        ? [chord.bassRoot, chord.bassFifth][bassSyncIndex++ % 2]!
        : undefined;
      return makeEvent(
        beat,
        [quarterMelody[index]!],
        bassNote ? [bassNote] : [],
        duration,
        duration,
        duration
      );
    });
  }

  if (level === "level-3") {
    const synchronizedBeats = getSynchronizedBeats(
      [0, 1, 2, 3],
      getSynchronizedEventCount(level, measureIndex, seed),
      measureIndex,
      seed
    );
    const bassScaleNotes = [
      ...new Set([
        ...chord.chordNotes,
        ...quarterMelody.filter((noteName) => !chord.chordNotes.includes(noteName)),
      ]),
    ].slice(0, 4);
    let bassSyncIndex = 0;

    return quarterMelody.map((noteName, beat) => {
      const hasBassSync = synchronizedBeats.includes(beat);
      const nextSyncBeat = synchronizedBeats.find((syncBeat) => syncBeat > beat) ?? 4;
      const bassNote = hasBassSync
        ? [bassScaleNotes[bassSyncIndex++ % bassScaleNotes.length] ?? chord.bassRoot]
        : [];
      const bassBeatSpan = nextSyncBeat - beat;
      const bassDuration = hasBassSync
        ? useDottedTemplate && bassBeatSpan === 4
          ? "dotted-half"
          : getDurationForBeatSpan(bassBeatSpan)
        : "quarter";
      return makeEvent(beat, [noteName], bassNote, "quarter", "quarter", bassDuration);
    });
  }

  if (level === "level-4") {
    return quarterMelody.map((noteName, index) =>
      makeEvent(
        index,
        [noteName],
        index === 0 ? [...chord.chordNotes] : [],
        "quarter",
        "quarter",
        useDottedTemplate ? "dotted-half" : "whole"
      )
    );
  }

  if (level === "level-5") {
    const dottedBeats = [0, 1.5, 2, 3.5] as const;
    const dottedDurations: readonly StaffPageNoteDuration[] = [
      "dotted-quarter",
      "eighth",
      "dotted-quarter",
      "eighth",
    ];
    const melodyEvents = useDottedTemplate
      ? dottedBeats.map((beat, index) =>
          makeEvent(
            beat,
            [eighthMelody[index * 2]!],
            index === 0 ? [...chord.chordNotes] : [],
            "eighth",
            dottedDurations[index]!,
            "whole"
          )
        )
      : eighthMelody.map((noteName, index) =>
          makeEvent(
            index * 0.5,
            [noteName],
            index === 0 ? [...chord.chordNotes] : [],
            "eighth",
            "eighth",
            "whole"
          )
        );
    return melodyEvents;
  }

  if (useDottedTemplate) {
    const dottedBeats = [0, 1.5, 2] as const;
    const dottedDurations: readonly StaffPageNoteDuration[] = [
      "dotted-quarter",
      "eighth",
      "dotted-quarter",
    ];
    const mergedEvents = new Map<number, MeasureEvent>();
    dottedBeats.forEach((beat, index) => {
      mergedEvents.set(
        beat,
        makeEvent(beat, [eighthMelody[index * 2]!], [], "eighth", dottedDurations[index]!)
      );
    });
    [0, 1, 2, 3].forEach((beat, index) => {
      const noteName = [
        chord.chordNotes[0]!,
        chord.bassFifth,
        chord.chordNotes[1]!,
        chord.bassFifth,
      ][index]!;
      const existing = mergedEvents.get(beat);
      if (existing) {
        existing.low = [noteName];
        existing.lowDuration = "quarter";
      } else {
        mergedEvents.set(beat, makeEvent(beat, [], [noteName]));
      }
    });
    return [...mergedEvents.values()].sort((left, right) => left.beat - right.beat);
  }

  const mergedEvents = new Map<number, MeasureEvent>();
  eighthMelody.slice(0, 7).forEach((noteName, index) => {
    const beat = index * 0.5;
    mergedEvents.set(beat, makeEvent(beat, [noteName], [], "eighth"));
  });
  [chord.chordNotes[0]!, chord.bassFifth, chord.chordNotes[1]!, chord.bassFifth].forEach(
    (noteName, index) => {
      const beat = index;
      const existing = mergedEvents.get(beat);
      if (existing) {
        existing.low = [noteName];
        existing.lowDuration = "quarter";
      } else {
        mergedEvents.set(beat, makeEvent(beat, [], [noteName]));
      }
    }
  );
  return [...mergedEvents.values()].sort((left, right) => left.beat - right.beat);
}

function createNoteLookup(notes: readonly TargetNote[]): Map<Staff, Map<NoteName, TargetNote[]>> {
  const lookup = new Map<Staff, Map<NoteName, TargetNote[]>>([
    ["treble", new Map()],
    ["bass", new Map()],
  ]);
  notes.forEach((note) => {
    const staffNotes = lookup.get(note.staff);
    if (!staffNotes) return;
    const matchingNotes = staffNotes.get(note.noteName) ?? [];
    matchingNotes.push(note);
    matchingNotes.sort((left, right) => left.octave - right.octave);
    staffNotes.set(note.noteName, matchingNotes);
  });
  return lookup;
}

function getMeasureNote(
  lookup: Map<Staff, Map<NoteName, TargetNote[]>>,
  staff: Staff,
  noteName: NoteName,
  measureIndex: number
): TargetNote | undefined {
  const candidates = lookup.get(staff)?.get(noteName);
  if (!candidates?.length) return undefined;
  return candidates[Math.floor(measureIndex / 2) % candidates.length];
}

/** Builds complete four-beat measures from authored 4-bar phrases and rhythm templates. */
export function createDuetPracticePage(
  poolNotes: readonly TargetNote[],
  level: DuetPracticeLevel,
  requestedCount: number,
  options: DuetPracticeGenerationOptions = {}
): GeneratedDuetPracticePage {
  const lookup = createNoteLookup(poolNotes);
  const bassNotes = poolNotes.filter((note) => note.staff === "bass");
  const trebleNotes = poolNotes.filter((note) => note.staff === "treble");
  if (bassNotes.length === 0 || trebleNotes.length === 0 || requestedCount <= 0) {
    return {
      events: [],
      notes: [],
      noteGroups: [],
      rhythm: {
        durations: [],
        endBeat: options.startBeat ?? 0,
        measures: [],
        noteBeamGroups: [],
        onsets: [],
      },
    };
  }

  const startBeat = Math.ceil(Math.max(0, options.startBeat ?? 0) / 4) * 4;
  const events: DuetTargetPair[] = [];
  const notes: TargetNote[] = [];
  const noteGroups: TargetNote[][] = [];
  const durations: StaffPageNoteDuration[] = [];
  const staffNoteDurations: NonNullable<GeneratedStaffPageRhythm["staffNoteDurations"]> = [];
  const measures: number[] = [];
  const noteBeamGroups: number[] = [];
  const onsets: number[] = [];
  let measureIndex = Math.floor(startBeat / 4);
  const measureLimit =
    options.measureCount === undefined
      ? Number.POSITIVE_INFINITY
      : measureIndex + Math.max(0, Math.floor(options.measureCount));
  let endBeat = startBeat;
  const seed = hashSeed(options.seed);
  const levelOneNotePools: LevelOneNotePools = {
    treble: NOTE_NAME_ORDER.filter((noteName) => lookup.get("treble")?.has(noteName) ?? false),
    bass: NOTE_NAME_ORDER.filter((noteName) => lookup.get("bass")?.has(noteName) ?? false),
  };
  const levelOneNoteOffsets: LevelOneNoteOffsets = { treble: 0, bass: 0 };
  // Keep one continuous left/right alternation across measure boundaries and
  // appended score buffers. The first hand and each bar's rhythm are session-seeded.
  let nextAlternatingStaff: Staff = getInitialAlternatingStaff(seed);
  const allowDottedRhythms = options.allowDottedRhythms ?? false;
  if (level === "level-1") {
    for (let previousMeasure = 0; previousMeasure < measureIndex; previousMeasure += 1) {
      const previousEvents = getMeasureEvents(
        level,
        previousMeasure,
        nextAlternatingStaff,
        allowDottedRhythms && previousMeasure % 4 === 3,
        seed,
        levelOneNotePools,
        levelOneNoteOffsets
      );
      previousEvents.forEach((event) => {
        levelOneNoteOffsets.treble += event.high.length;
        levelOneNoteOffsets.bass += event.low.length;
      });
      if (previousEvents.length % 2 === 1) {
        nextAlternatingStaff = nextAlternatingStaff === "treble" ? "bass" : "treble";
      }
    }
  }

  while (events.length < requestedCount && measureIndex < measureLimit) {
    const measureStart = measureIndex * 4;
    const useDottedTemplate = allowDottedRhythms && measureIndex % 4 === 3;
    const measureEvents = getMeasureEvents(
      level,
      measureIndex,
      nextAlternatingStaff,
      useDottedTemplate,
      seed,
      levelOneNotePools,
      levelOneNoteOffsets
    );
    for (const measureEvent of measureEvents) {
      const high = measureEvent.high
        .map((name) => getMeasureNote(lookup, "treble", name, measureIndex))
        .filter((note): note is TargetNote => note !== undefined);
      const low = measureEvent.low
        .map((name) => getMeasureNote(lookup, "bass", name, measureIndex))
        .filter((note): note is TargetNote => note !== undefined);
      const group = [...high, ...low];
      if (group.length === 0) continue;
      const onset = measureStart + measureEvent.beat;
      const genericDuration = measureEvent.highDuration ?? measureEvent.lowDuration ?? "quarter";
      events.push({ high, low });
      notes.push(high[0] ?? low[0]!);
      noteGroups.push(group);
      durations.push(genericDuration);
      staffNoteDurations.push({
        ...(high.length > 0 && measureEvent.highDuration
          ? { treble: measureEvent.highDuration }
          : {}),
        ...(low.length > 0 && measureEvent.lowDuration ? { bass: measureEvent.lowDuration } : {}),
      });
      measures.push(measureIndex);
      noteBeamGroups.push(Math.floor(onset + 0.001));
      onsets.push(onset);
      if (level === "level-1") {
        levelOneNoteOffsets.treble += measureEvent.high.length;
        levelOneNoteOffsets.bass += measureEvent.low.length;
      }
      if (level === "level-1") {
        const lastStaff = high.length > 0 ? "treble" : "bass";
        nextAlternatingStaff = lastStaff === "treble" ? "bass" : "treble";
      }
      if (events.length >= requestedCount && options.exactCount) break;
    }
    measureIndex += 1;
    endBeat = measureIndex * 4;
    if (options.exactCount && events.length >= requestedCount) break;
  }

  return {
    events,
    notes,
    noteGroups,
    rhythm: {
      durations,
      endBeat,
      measures,
      noteBeamGroups,
      onsets,
      staffNoteDurations,
    },
  };
}

export function getDuetTargetMidis(targets: DuetTargetPair): { treble: number[]; bass: number[] } {
  return {
    treble: targets.high.map(getTargetMidiNoteNumber),
    bass: targets.low.map(getTargetMidiNoteNumber),
  };
}

const LEGACY_LEVEL_MIGRATION: Record<string, DuetPracticeLevel> = {
  "level-1": "level-1",
  "level-2": "level-2",
  "level-3": "level-5",
  "level-4": "level-6",
  "level-5": "level-4",
  sync: "level-2",
  parallel: "level-3",
  independent: "level-4",
};

export function normalizeDuetPracticeLevel(
  value: unknown,
  curriculumVersion?: number
): DuetPracticeLevel {
  if (
    curriculumVersion === DUET_PRACTICE_CURRICULUM_VERSION &&
    (value === "level-1" ||
      value === "level-2" ||
      value === "level-3" ||
      value === "level-4" ||
      value === "level-5" ||
      value === "level-6")
  ) {
    return value;
  }
  return LEGACY_LEVEL_MIGRATION[String(value)] ?? "level-1";
}

export function getDuetPracticeLevelLabel(level: DuetPracticeLevel): string {
  const labels: Record<DuetPracticeLevel, string> = {
    "level-1": "Level 1 · 左右手交替",
    "level-2": "Level 2 · 少量同步",
    "level-3": "Level 3 · 大量同步",
    "level-4": "Level 4 · 柱式和弦",
    "level-5": "Level 5 · 八分音符",
    "level-6": "Level 6 · 分解和弦",
  };
  return labels[level];
}

export function getDuetPracticeLevelDescription(level: DuetPracticeLevel): string {
  const descriptions: Record<DuetPracticeLevel, string> = {
    "level-1": "左右手轮流弹单音，音符在各自音域内均衡轮换，不同时起音。",
    "level-2": "每小节同奏 1 次的概率为 80%，同奏 2 次为 20%。",
    "level-3": "每小节同奏 1/2/3/4 次的概率依次为 20%/50%/20%/10%。",
    "level-4": "左手在强拍弹柱式三和弦，右手继续弹简单旋律。",
    "level-5": "右手弹均匀八分音符旋律，左手柱式和弦保持。",
    "level-6": "左手按四分音符弹分解和弦，右手继续旋律。",
  };
  return descriptions[level];
}

export function getDuetPracticeEventCountPerMeasure(level: DuetPracticeLevel): number | undefined {
  const counts: Partial<Record<DuetPracticeLevel, number>> = {
    "level-2": 4,
    "level-3": 4,
    "level-4": 4,
    "level-5": 8,
    "level-6": 7,
  };
  return counts[level];
}
