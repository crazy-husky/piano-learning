import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { maybeInfuseBlackKey, transposeTargetNote } from "../../../domain/blackKeyPractice";
import { createAdaptiveNoteScheduler, type AdaptiveNoteScheduler } from "../../../domain/scheduler";
import { staffDistance } from "../../../domain/staffDistancePractice";
import type {
  BlackKeyPracticeSettings,
  DuetPracticeLevel,
  NoteName,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PracticeGroupId,
  ReviewRecord,
  Staff,
  TargetNote,
} from "../../../domain/types";
import type { GeneratedStaffPageRhythm, StaffPageNoteDuration } from "./staffPageNotation";

export const DUET_PROMPT_TIMEOUT_MS = 3_500;
export const DUET_PRACTICE_CURRICULUM_VERSION = 2;

export type DuetPracticeRangePreset = "standard" | "extended";

export const DUET_PRACTICE_RANGE_GROUPS = [
  { id: "C2-B2", staff: "bass", label: "C2–B2" },
  { id: "C3-B3", staff: "bass", label: "C3–B3" },
  { id: "C4-B4", staff: "treble", label: "C4–B4" },
  { id: "C5-B5", staff: "treble", label: "C5–B5" },
  { id: "C6-B6", staff: "treble", label: "C6–B6" },
] as const satisfies readonly { id: PracticeGroupId; staff: Staff; label: string }[];

export type DuetPracticeRangeGroupId = (typeof DUET_PRACTICE_RANGE_GROUPS)[number]["id"];

export const DEFAULT_DUET_PRACTICE_RANGE_GROUP_IDS: readonly DuetPracticeRangeGroupId[] = [
  "C3-B3",
  "C4-B4",
];

export const DEFAULT_DUET_PRACTICE_RANGE_PRESET: DuetPracticeRangePreset = "standard";

export function normalizeDuetPracticeRangePreset(value: unknown): DuetPracticeRangePreset {
  return value === "extended" ? "extended" : DEFAULT_DUET_PRACTICE_RANGE_PRESET;
}

export function getDuetPracticeGroupIds(
  preset: DuetPracticeRangePreset
): DuetPracticeRangeGroupId[] {
  return preset === "extended"
    ? ["C2-B2", "C3-B3", "C4-B4", "C5-B5"]
    : [...DEFAULT_DUET_PRACTICE_RANGE_GROUP_IDS];
}

export function getDuetPracticeRangeSummary(preset: DuetPracticeRangePreset): string {
  return preset === "extended" ? "C2–B5（左右手各两个八度）" : "C3–B4（左右手各一个八度）";
}

export function getDuetPracticeRangeGroupSummary(
  groupIds: readonly DuetPracticeRangeGroupId[]
): string {
  const selected = new Set(groupIds);
  return DUET_PRACTICE_RANGE_GROUPS.filter(({ id }) => selected.has(id))
    .map(({ label }) => label)
    .join(" + ");
}

export function normalizeDuetPracticeRangeGroupIds(
  value: unknown,
  fallback: readonly DuetPracticeRangeGroupId[] = DEFAULT_DUET_PRACTICE_RANGE_GROUP_IDS
): DuetPracticeRangeGroupId[] {
  const fallbackIds = new Set(
    fallback.filter((id): id is DuetPracticeRangeGroupId =>
      DUET_PRACTICE_RANGE_GROUPS.some((group) => group.id === id)
    )
  );
  if (fallbackIds.size === 0) {
    DEFAULT_DUET_PRACTICE_RANGE_GROUP_IDS.forEach((id) => fallbackIds.add(id));
  }

  const selectedIds = new Set<DuetPracticeRangeGroupId>();
  if (Array.isArray(value)) {
    value.forEach((id: unknown) => {
      if (DUET_PRACTICE_RANGE_GROUPS.some((group) => group.id === id)) {
        selectedIds.add(id as DuetPracticeRangeGroupId);
      }
    });
  }
  if (selectedIds.size === 0) {
    fallbackIds.forEach((id) => selectedIds.add(id));
  }

  for (const staff of ["bass", "treble"] as const) {
    const hasStaffRange = DUET_PRACTICE_RANGE_GROUPS.some(
      (group) => group.staff === staff && selectedIds.has(group.id)
    );
    if (!hasStaffRange) {
      const fallbackGroup = DUET_PRACTICE_RANGE_GROUPS.find(
        (group) => group.staff === staff && fallbackIds.has(group.id)
      );
      const defaultGroup = DUET_PRACTICE_RANGE_GROUPS.find((group) => group.staff === staff);
      const group = fallbackGroup ?? defaultGroup;
      if (group) selectedIds.add(group.id);
    }
  }

  return DUET_PRACTICE_RANGE_GROUPS.filter(({ id }) => selectedIds.has(id)).map(({ id }) => id);
}

export function isDuetPracticeCustomRangeLevel(level: DuetPracticeLevel | undefined): boolean {
  return level === "level-1" || level === "level-2" || level === "level-3";
}

export interface DuetTargetPair {
  /** Notes in the treble staff for this onset. An empty array means a rest. */
  high: TargetNote[];
  /** Notes in the bass staff for this onset. An empty array means a rest. */
  low: TargetNote[];
}

export interface DuetPracticeGenerationOptions {
  allowDottedRhythms?: boolean;
  allowSingleStaff?: boolean;
  blackKeySettings?: BlackKeyPracticeSettings;
  /** Level 1 only: alternate the active hand on every onset across measure boundaries. */
  strictHandAlternation?: boolean;
  /** Optional starting hand for a strict Level 1 sequence with fixed targets. */
  strictHandAlternationStart?: Staff;
  startBeat?: number;
  exactCount?: boolean;
  /** Cap generation to this many complete measures, relative to startBeat. */
  measureCount?: number;
  /** Optional per-prompt targets used by the focused wrong-note test. */
  targetPairs?: readonly (DuetTargetPair | null)[];
  targetOffset?: number;
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: readonly NoteName[];
  reviews?: readonly ReviewRecord[];
  sessions?: readonly PracticeSessionRecord[];
  currentSessionId?: string;
  /** Targets already planned in the still-visible score page. */
  plannedTargetNoteIds?: readonly TargetNote["id"][];
  /** Level 3 only; null/undefined leaves the interval unrestricted. */
  maxStaffDistance?: number | null;
  /** Last generated pitch per staff, used when a continuous score page is appended. */
  previousStaffNotes?: Partial<Record<Staff, TargetNote>>;
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

function getLevelOneStaffSequence(
  onsetCount: number,
  measureIndex: number,
  seed: number,
  requiredPrefixCount = onsetCount,
  strictHandAlternation = false,
  startingOnsetIndex = 0,
  precedingStaffSequence: readonly Staff[] = [],
  strictHandAlternationStart?: Staff
): Staff[] {
  const channel = 0x68616e64;
  const firstStrictStaff =
    strictHandAlternationStart ?? (getMeasureRandom(seed, 0, channel) < 0.5 ? "treble" : "bass");
  if (strictHandAlternation) {
    return Array.from({ length: onsetCount }, (_, index) =>
      (startingOnsetIndex + index) % 2 === 0
        ? firstStrictStaff
        : firstStrictStaff === "treble"
          ? "bass"
          : "treble"
    );
  }

  const boundedPrefixCount = Math.min(onsetCount, Math.max(0, Math.floor(requiredPrefixCount)));
  const candidates: Staff[][] = [];
  for (let mask = 0; mask < 2 ** onsetCount; mask += 1) {
    const sequence = Array.from({ length: onsetCount }, (_, index) =>
      (mask & (1 << index)) === 0 ? "treble" : "bass"
    );
    let longestRun = 0;
    let currentRun = 0;
    sequence.forEach((staff, index) => {
      currentRun = index > 0 && sequence[index - 1] === staff ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
    });
    if (longestRun > 2) continue;
    if (onsetCount >= 2 && new Set(sequence).size < 2) continue;
    if (boundedPrefixCount >= 2 && new Set(sequence.slice(0, boundedPrefixCount)).size < 2)
      continue;
    const boundarySequence = [...precedingStaffSequence.slice(-2), ...sequence.slice(0, 2)];
    const createsThreeHandRun = boundarySequence.some(
      (staff, index) =>
        index >= 2 && staff === boundarySequence[index - 1] && staff === boundarySequence[index - 2]
    );
    if (createsThreeHandRun) continue;
    // The default pattern is staggered, with occasional repeated hand assignments;
    // strict left-right alternation is reserved for the advanced option.
    if (
      onsetCount >= 3 &&
      !sequence.some((staff, index) => index > 0 && sequence[index - 1] === staff)
    ) {
      continue;
    }
    candidates.push(sequence);
  }

  if (candidates.length === 0) {
    return Array.from({ length: onsetCount }, (_, index) =>
      getMeasureRandom(seed, measureIndex, channel + index * 0x101) < 0.5 ? "treble" : "bass"
    );
  }
  const selection = Math.floor(getMeasureRandom(seed, measureIndex, channel) * candidates.length);
  return candidates[selection] ?? candidates[0]!;
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
  if (level === "level-2") return selection < 0.7 ? 1 : 2;
  if (selection < 0.1) return 1;
  if (selection < 0.4) return 2;
  if (selection < 0.8) return 3;
  return 4;
}

function getSynchronizedBeats(
  candidateBeats: readonly number[],
  count: number,
  measureIndex: number,
  seed: number,
  avoidAdjacent = false
): number[] {
  if (avoidAdjacent && count === 2) {
    const separatedPairs = candidateBeats.flatMap((beat, index) =>
      candidateBeats
        .slice(index + 1)
        .flatMap((nextBeat) => (nextBeat - beat > 1 ? [[beat, nextBeat]] : []))
    );
    const pairIndex = Math.floor(
      getMeasureRandom(seed, measureIndex, 0x73657061) * separatedPairs.length
    );
    return separatedPairs[pairIndex] ?? candidateBeats.slice(0, count);
  }

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

function getLevel3BassScaleNotes(chord: ChordTemplate, measureIndex: number): NoteName[] {
  const quarterMelody = getPhraseMeasure(QUARTER_MELODY_PHRASES, measureIndex);
  return [
    ...new Set([
      ...chord.chordNotes,
      ...quarterMelody.filter((noteName) => !chord.chordNotes.includes(noteName)),
    ]),
  ].slice(0, 4);
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

function makeSingleHandEvent(
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
  useDottedTemplate: boolean,
  seed: number,
  levelOneNotePools?: LevelOneNotePools,
  levelOneNoteOffsets: LevelOneNoteOffsets = { treble: 0, bass: 0 },
  levelOneRequiredOnsetCount?: number,
  strictHandAlternation = false,
  levelOneStartingOnsetIndex = 0,
  precedingLevelOneStaffSequence: readonly Staff[] = [],
  strictHandAlternationStart?: Staff,
  chordOverride?: ChordTemplate
): MeasureEvent[] {
  const chord = chordOverride ?? getMeasureChord(measureIndex);
  const quarterMelody = getPhraseMeasure(QUARTER_MELODY_PHRASES, measureIndex);
  const eighthMelody = getPhraseMeasure(EIGHTH_MELODY_PHRASES, measureIndex);

  if (level === "level-1") {
    const events: readonly LevelOneRhythmEvent[] = useDottedTemplate
      ? [
          { beat: 0, duration: "dotted-quarter" },
          { beat: 1.5, duration: "eighth" },
          { beat: 2, duration: "quarter" },
          { beat: 3, duration: "quarter" },
        ]
      : getLevelOneRhythmTemplate(measureIndex, seed).events;
    const singleAvailableStaff =
      levelOneNotePools?.treble.length === 0
        ? "bass"
        : levelOneNotePools?.bass.length === 0
          ? "treble"
          : undefined;
    const staffSequence = singleAvailableStaff
      ? Array.from({ length: events.length }, () => singleAvailableStaff)
      : getLevelOneStaffSequence(
          events.length,
          measureIndex,
          seed,
          levelOneRequiredOnsetCount,
          strictHandAlternation,
          levelOneStartingOnsetIndex,
          precedingLevelOneStaffSequence,
          strictHandAlternationStart
        );
    const nextNoteOffsets = { ...levelOneNoteOffsets };

    return events.map(({ beat, duration }, index) => {
      const staff = staffSequence[index]!;
      const notePool = levelOneNotePools?.[staff] ?? NOTE_NAME_ORDER;
      const noteName = getBalancedLevelOneNoteName(
        notePool,
        nextNoteOffsets[staff],
        seed,
        staff === "treble" ? 0x74726562 : 0x62617373
      );
      nextNoteOffsets[staff] += 1;
      return makeSingleHandEvent(staff, beat, noteName, duration);
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
      seed,
      true
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
    const bassScaleNotes = getLevel3BassScaleNotes(chord, measureIndex);
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

type AdaptiveNoteSelector = (
  candidates: readonly TargetNote[],
  previous: TargetNote | undefined,
  random: number
) => TargetNote | undefined;

function compatibleChordTemplates(
  lookup: Map<Staff, Map<NoteName, TargetNote[]>>,
  strategy: PracticeQueueStrategy,
  drillNoteNames: readonly NoteName[]
): ChordTemplate[] {
  const selectedNames = new Set(drillNoteNames);
  return CHORD_PROGRESSION.filter((chord) =>
    chord.chordNotes.every(
      (name) =>
        (lookup.get("bass")?.get(name)?.length ?? 0) > 0 &&
        (strategy !== "note-drill" || selectedNames.has(name))
    )
  );
}

function getLevel3ChordTemplates(
  lookup: Map<Staff, Map<NoteName, TargetNote[]>>,
  strategy: PracticeQueueStrategy,
  drillNoteNames: readonly NoteName[],
  measureIndex: number
): ChordTemplate[] {
  const selectedNames = new Set(drillNoteNames);
  return CHORD_PROGRESSION.filter((chord) =>
    getLevel3BassScaleNotes(chord, measureIndex).some(
      (name) =>
        (lookup.get("bass")?.get(name)?.length ?? 0) > 0 &&
        (strategy !== "note-drill" || selectedNames.has(name))
    )
  );
}

function chooseMeasureChord(
  measureIndex: number,
  candidates: readonly ChordTemplate[],
  strategy: PracticeQueueStrategy,
  lookup: Map<Staff, Map<NoteName, TargetNote[]>>,
  bassCandidates: readonly TargetNote[],
  previousBassNote: TargetNote | undefined,
  seed: number,
  adaptiveSelect: AdaptiveNoteSelector,
  maxStaffDistance: number | null
): ChordTemplate {
  if (candidates.length === 0) return getMeasureChord(measureIndex);
  const random = getMeasureRandom(seed, measureIndex, 0x63686f72);
  const distanceCompatibleCandidates =
    maxStaffDistance !== null && previousBassNote
      ? candidates.filter((chord) =>
          getLevel3BassScaleNotes(chord, measureIndex).some((name) =>
            (lookup.get("bass")?.get(name) ?? []).some(
              (note) => staffDistance(previousBassNote, note) <= maxStaffDistance
            )
          )
        )
      : [...candidates];
  const availableChords =
    distanceCompatibleCandidates.length > 0 ? distanceCompatibleCandidates : [...candidates];
  if (strategy === "melody" && previousBassNote) {
    const distances = availableChords.map((chord) => {
      const nearestDistance = chord.chordNotes.reduce((sum, name) => {
        const variants = lookup.get("bass")?.get(name) ?? [];
        const nearest = variants.length
          ? Math.min(...variants.map((note) => staffDistance(previousBassNote, note)))
          : 100;
        return sum + nearest;
      }, 0);
      return { chord, distance: nearestDistance };
    });
    const minimum = Math.min(...distances.map(({ distance }) => distance));
    const nearest = distances.filter(({ distance }) => distance === minimum);
    return nearest[Math.min(nearest.length - 1, Math.floor(random * nearest.length))]!.chord;
  }
  if (strategy === "adaptive") {
    const weakAnchor = adaptiveSelect(bassCandidates, previousBassNote, random);
    const matchingChords = weakAnchor
      ? availableChords.filter((chord) => chord.chordNotes.includes(weakAnchor.noteName))
      : [];
    const pool = matchingChords.length > 0 ? matchingChords : availableChords;
    return pool[Math.min(pool.length - 1, Math.floor(random * pool.length))]!;
  }
  return availableChords[
    Math.min(availableChords.length - 1, Math.floor(random * availableChords.length))
  ]!;
}

function chooseGeneratedNote({
  candidates,
  staff,
  measureNames,
  intendedName,
  previous,
  level,
  strategy,
  maxStaffDistance,
  adaptiveSelect,
  random,
}: {
  candidates: readonly TargetNote[];
  staff: Staff;
  measureNames: ReadonlySet<NoteName>;
  intendedName: NoteName;
  previous: TargetNote | undefined;
  level: DuetPracticeLevel;
  strategy: PracticeQueueStrategy;
  maxStaffDistance: number | null;
  adaptiveSelect: AdaptiveNoteSelector;
  random: number;
}): TargetNote | undefined {
  let eligible = candidates.filter((note) => note.staff === staff);
  if (staff === "bass" && (level === "level-2" || level === "level-3" || level === "level-6")) {
    const structuralCandidates = eligible.filter((note) => measureNames.has(note.noteName));
    if (structuralCandidates.length > 0) {
      eligible = structuralCandidates;
    } else if (level === "level-3" && maxStaffDistance !== null) {
      return undefined;
    }
  }
  if (eligible.length === 0) eligible = candidates.filter((note) => note.staff === staff);
  if (level === "level-3" && maxStaffDistance !== null && previous) {
    const withinLimit = eligible.filter(
      (note) => staffDistance(previous, note) <= maxStaffDistance
    );
    if (withinLimit.length === 0) return undefined;
    eligible = withinLimit;
  }
  if (eligible.length === 0) return undefined;

  const nonRepeating =
    previous && eligible.length > 1 ? eligible.filter((note) => note.id !== previous.id) : eligible;
  const nonRepeatingDistances = new Set(
    previous ? nonRepeating.map((note) => staffDistance(previous, note)) : []
  );
  const allowRepeatForDistanceVariety = Boolean(
    level === "level-3" &&
    maxStaffDistance !== null &&
    previous &&
    eligible.some((note) => note.id === previous.id) &&
    nonRepeatingDistances.size < 2 &&
    random < 0.2
  );
  const choicePool =
    allowRepeatForDistanceVariety || nonRepeating.length === 0 ? eligible : nonRepeating;

  if (strategy === "melody") {
    if (!previous) {
      const intended = choicePool.filter((note) => note.noteName === intendedName);
      const startingNote = intended.length > 0 ? intended : choicePool;
      return startingNote[
        Math.min(startingNote.length - 1, Math.floor(random * startingNote.length))
      ];
    }
    const minimumDistance = Math.min(...choicePool.map((note) => staffDistance(previous, note)));
    const nearest = choicePool.filter((note) => staffDistance(previous, note) === minimumDistance);
    return nearest[Math.min(nearest.length - 1, Math.floor(random * nearest.length))];
  }

  if (strategy === "note-drill") {
    const intended = choicePool.filter((note) => note.noteName === intendedName);
    const preferred = intended.length > 0 ? intended : choicePool;
    return preferred[Math.min(preferred.length - 1, Math.floor(random * preferred.length))];
  }

  return adaptiveSelect(choicePool, allowRepeatForDistanceVariety ? undefined : previous, random);
}

function isTargetPairCompatible(
  pair: DuetTargetPair,
  strategy: PracticeQueueStrategy,
  drillNoteNames: readonly NoteName[],
  level: DuetPracticeLevel,
  maxStaffDistance: number | null,
  previous: Partial<Record<Staff, TargetNote>>
): boolean {
  const selectedNames = new Set(drillNoteNames);
  const allNotes = [...pair.high, ...pair.low];
  if (strategy === "note-drill" && allNotes.some((note) => !selectedNames.has(note.noteName))) {
    return false;
  }
  if (level !== "level-3" || maxStaffDistance === null) return true;
  return (["treble", "bass"] as const).every((staff) => {
    const targets = staff === "treble" ? pair.high : pair.low;
    const prior = previous[staff];
    return !prior || targets.every((note) => staffDistance(prior, note) <= maxStaffDistance);
  });
}

export function getDuetPracticeSetupIssue(
  poolNotes: readonly TargetNote[],
  level: DuetPracticeLevel,
  strategy: PracticeQueueStrategy,
  drillNoteNames: readonly NoteName[],
  maxStaffDistance: number | null
): string | undefined {
  const notes =
    strategy === "note-drill"
      ? poolNotes.filter((note) => drillNoteNames.includes(note.noteName))
      : [...poolNotes];
  if (strategy === "note-drill" && drillNoteNames.length === 0) {
    return "请选择强化音名";
  }
  for (const staff of ["treble", "bass"] as const) {
    if (!notes.some((note) => note.staff === staff)) {
      return "当前指定音名在所选音区中没有可练习音符，请选择其他音名。";
    }
  }
  if (
    strategy === "note-drill" &&
    (level === "level-4" || level === "level-5" || level === "level-6")
  ) {
    const lookup = createNoteLookup(notes);
    if (compatibleChordTemplates(lookup, strategy, drillNoteNames).length === 0) {
      return "当前指定音名无法组成完整和弦或分解和弦，请至少选择一组完整和弦所需的音名。";
    }
  }
  if (level === "level-3" && maxStaffDistance !== null) {
    for (const staff of ["treble", "bass"] as const) {
      const staffNotes = notes.filter((note) => note.staff === staff);
      const possibleDistances = new Set<number>();
      if (staffNotes.length > 0) possibleDistances.add(0);
      staffNotes.forEach((from) =>
        staffNotes.forEach((to) => {
          const distance = staffDistance(from, to);
          if (distance > 0 && distance <= maxStaffDistance) possibleDistances.add(distance);
        })
      );
      if (possibleDistances.size < 2) {
        return `当前音域和指定音名无法让${staff === "treble" ? "右手" : "左手"}形成两种可用音距，请扩大音域、选择更多音名或放宽最大音距。`;
      }
    }
  }
  return undefined;
}

/** Builds complete four-beat measures from authored 4-bar phrases and rhythm templates. */
export function createDuetPracticePage(
  poolNotes: readonly TargetNote[],
  level: DuetPracticeLevel,
  requestedCount: number,
  options: DuetPracticeGenerationOptions = {}
): GeneratedDuetPracticePage {
  const strategy: PracticeQueueStrategy =
    options.queueStrategy === "melody" || options.queueStrategy === "note-drill"
      ? options.queueStrategy
      : "adaptive";
  const drillNoteNames = options.drillNoteNames ?? [];
  const availableNotes =
    strategy === "note-drill"
      ? poolNotes.filter((note) => drillNoteNames.includes(note.noteName))
      : [...poolNotes];
  const lookup = createNoteLookup(availableNotes);
  const bassNotes = availableNotes.filter((note) => note.staff === "bass");
  const trebleNotes = availableNotes.filter((note) => note.staff === "treble");
  if (
    poolNotes.length === 0 ||
    (!options.allowSingleStaff && (bassNotes.length === 0 || trebleNotes.length === 0)) ||
    requestedCount <= 0
  ) {
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
  const adaptiveSchedulers = new Map<string, AdaptiveNoteScheduler>();
  const plannedTargetNoteIds = [...(options.plannedTargetNoteIds ?? [])];
  const adaptiveSelect: AdaptiveNoteSelector = (candidates, previous, random) => {
    if (candidates.length === 0) return undefined;
    const schedulerNotes = [...new Map(candidates.map((note) => [note.id, note])).values()];
    const key = schedulerNotes
      .map((note) => note.id)
      .sort()
      .join("|");
    let scheduler = adaptiveSchedulers.get(key);
    if (!scheduler) {
      scheduler = createAdaptiveNoteScheduler({
        notes: schedulerNotes,
        reviews: [...(options.reviews ?? [])],
        sessions: [...(options.sessions ?? [])],
        currentSessionId: options.currentSessionId,
        queueStrategy: "adaptive",
      });
      adaptiveSchedulers.set(key, scheduler);
    }
    return scheduler.select({
      lastTargetNoteId: previous?.id,
      plannedTargetNoteIds,
      rng: () => random,
    });
  };
  const baseLevelOneNotePools: LevelOneNotePools = {
    treble: NOTE_NAME_ORDER.filter((noteName) => lookup.get("treble")?.has(noteName) ?? false),
    bass: NOTE_NAME_ORDER.filter((noteName) => lookup.get("bass")?.has(noteName) ?? false),
  };
  const levelOneNotePools = baseLevelOneNotePools;
  const chordTemplates = compatibleChordTemplates(lookup, strategy, drillNoteNames);
  const maxStaffDistance = level === "level-3" ? (options.maxStaffDistance ?? null) : null;
  const previousStaffNotes: Partial<Record<Staff, TargetNote>> = {
    ...(options.previousStaffNotes ?? {}),
  };
  const levelOneNoteOffsets: LevelOneNoteOffsets = { treble: 0, bass: 0 };
  let levelOneStartingOnsetIndex = 0;
  const precedingLevelOneStaffSequence: Staff[] = [];
  const allowDottedRhythms = options.allowDottedRhythms ?? false;
  if (level === "level-1") {
    for (let previousMeasure = 0; previousMeasure < measureIndex; previousMeasure += 1) {
      const previousEvents = getMeasureEvents(
        level,
        previousMeasure,
        allowDottedRhythms && previousMeasure % 4 === 3,
        seed,
        levelOneNotePools,
        levelOneNoteOffsets,
        undefined,
        options.strictHandAlternation,
        levelOneStartingOnsetIndex,
        precedingLevelOneStaffSequence,
        options.strictHandAlternationStart
      );
      previousEvents.forEach((event) => {
        levelOneNoteOffsets.treble += event.high.length;
        levelOneNoteOffsets.bass += event.low.length;
        precedingLevelOneStaffSequence.push(event.high.length > 0 ? "treble" : "bass");
        if (precedingLevelOneStaffSequence.length > 2) precedingLevelOneStaffSequence.shift();
      });
      levelOneStartingOnsetIndex += previousEvents.length;
    }
  }

  while (events.length < requestedCount && measureIndex < measureLimit) {
    const measureStart = measureIndex * 4;
    const useDottedTemplate = allowDottedRhythms && measureIndex % 4 === 3;
    const measureChordTemplates =
      level === "level-3"
        ? getLevel3ChordTemplates(lookup, strategy, drillNoteNames, measureIndex)
        : chordTemplates;
    const selectedChord =
      level === "level-1"
        ? getMeasureChord(measureIndex)
        : chooseMeasureChord(
            measureIndex,
            measureChordTemplates,
            strategy,
            lookup,
            bassNotes,
            previousStaffNotes.bass,
            seed,
            adaptiveSelect,
            maxStaffDistance
          );
    const measureEvents = getMeasureEvents(
      level,
      measureIndex,
      useDottedTemplate,
      seed,
      levelOneNotePools,
      levelOneNoteOffsets,
      options.exactCount ? requestedCount - events.length : undefined,
      options.strictHandAlternation,
      levelOneStartingOnsetIndex,
      precedingLevelOneStaffSequence,
      options.strictHandAlternationStart,
      selectedChord
    );
    if (level === "level-1") {
      levelOneStartingOnsetIndex += measureEvents.length;
      measureEvents.forEach((event) => {
        precedingLevelOneStaffSequence.push(event.high.length > 0 ? "treble" : "bass");
        if (precedingLevelOneStaffSequence.length > 2) precedingLevelOneStaffSequence.shift();
      });
    }
    const measureNoteNames: Record<Staff, Set<NoteName>> = {
      treble: new Set(measureEvents.flatMap((event) => event.high)),
      bass:
        level === "level-3" && maxStaffDistance !== null
          ? new Set(getLevel3BassScaleNotes(selectedChord, measureIndex))
          : new Set(measureEvents.flatMap((event) => event.low)),
    };
    for (const measureEvent of measureEvents) {
      const selectGeneratedStaffNotes = (
        names: readonly NoteName[],
        staff: Staff
      ): TargetNote[] => {
        if (names.length > 1) {
          return names
            .map((name) => getMeasureNote(lookup, staff, name, measureIndex))
            .filter((note): note is TargetNote => note !== undefined);
        }
        return names
          .map((name, noteIndex) =>
            chooseGeneratedNote({
              candidates: availableNotes,
              staff,
              measureNames: measureNoteNames[staff],
              intendedName: name,
              previous: previousStaffNotes[staff],
              level,
              strategy,
              maxStaffDistance,
              adaptiveSelect,
              random: getMeasureRandom(
                seed,
                measureIndex,
                (staff === "treble" ? 0x74726562 : 0x62617373) ^
                  Math.imul(events.length + noteIndex + 1, 0x27d4eb2d)
              ),
            })
          )
          .filter((note): note is TargetNote => note !== undefined);
      };
      const generatedHigh = selectGeneratedStaffNotes(measureEvent.high, "treble");
      const generatedLow = selectGeneratedStaffNotes(measureEvent.low, "bass");
      const fixedTargetPair = options.targetPairs?.[(options.targetOffset ?? 0) + events.length];
      const targetPair =
        fixedTargetPair &&
        isTargetPairCompatible(
          fixedTargetPair,
          strategy,
          drillNoteNames,
          level,
          maxStaffDistance,
          previousStaffNotes
        )
          ? fixedTargetPair
          : undefined;
      let high = targetPair?.high ?? generatedHigh;
      let low = targetPair?.low ?? generatedLow;
      const blackKeySettings = options.blackKeySettings;
      if (blackKeySettings?.enabled && !targetPair) {
        const absoluteEventIndex = (options.targetOffset ?? 0) + events.length;
        const group = [...high, ...low];
        const usesChordPreservingTranspose =
          level === "level-4" || level === "level-5" || level === "level-6";
        if (group.length > 0 && usesChordPreservingTranspose) {
          const infusionRoll = getMeasureRandom(
            seed,
            measureIndex,
            0x626c6163 ^ Math.imul(absoluteEventIndex + 1, 0x45d9f3b)
          );
          if (infusionRoll < blackKeySettings.ratio / 100) {
            const deltaRoll = getMeasureRandom(
              seed,
              measureIndex,
              0x7472616e ^ Math.imul(absoluteEventIndex + 1, 0x119de1f3)
            );
            const deltas = deltaRoll < 0.5 ? ([-1, 1] as const) : ([1, -1] as const);
            const transposed = deltas
              .map((delta) =>
                group.map((note) => transposeTargetNote(note, delta, blackKeySettings.spelling))
              )
              .find(
                (candidate) =>
                  candidate.every(
                    (note, index) => note !== undefined && note.octave === group[index]?.octave
                  ) && candidate.some((note) => note?.accidental !== undefined)
              );
            if (transposed) {
              const transposedNotes = transposed as TargetNote[];
              high = transposedNotes.slice(0, high.length);
              low = transposedNotes.slice(high.length);
            }
          }
        } else if (group.length > 0) {
          const infuse = (note: TargetNote, noteIndex: number): TargetNote =>
            maybeInfuseBlackKey(note, blackKeySettings, () =>
              getMeasureRandom(
                seed,
                measureIndex,
                0x6e6f7465 ^
                  Math.imul(absoluteEventIndex + 1, 0x27d4eb2d) ^
                  Math.imul(noteIndex + 1, 0x165667b1)
              )
            );
          high = high.map(infuse);
          low = low.map((note, index) => infuse(note, high.length + index));
        }
      }
      const group = [...high, ...low];
      if (group.length === 0) continue;
      if (high.length > 0) previousStaffNotes.treble = high[high.length - 1];
      if (low.length > 0) previousStaffNotes.bass = low[low.length - 1];
      plannedTargetNoteIds.push(...group.map((note) => note.id));
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
    "level-1": "Level 1 · 左右手错落",
    "level-2": "Level 2 · 少量同步",
    "level-3": "Level 3 · 大量同步",
    "level-4": "Level 4 · 柱式和弦",
    "level-5": "Level 5 · 八分音符",
    "level-6": "Level 6 · 分解和弦",
  };
  return labels[level];
}

export function getDuetPracticeLevelDescription(
  level: DuetPracticeLevel,
  strictLevelOneHandAlternation = false
): string {
  const descriptions: Record<DuetPracticeLevel, string> = {
    "level-1": strictLevelOneHandAlternation
      ? "左右手按每个音符严格轮流出现，并跨小节连续轮换；音符在各自音域内均衡轮换，不同时起音。"
      : "每个完整小节左右手各至少弹一次单音，手序错落穿插、允许连续同手但不会连续三次；音符在各自音域内均衡轮换，不同时起音。",
    "level-2": "每小节低音出现 1 次的概率为 70%，出现 2 次的概率为 30%；出现两次时会尽量分开。",
    "level-3": "每小节同奏 1/2/3/4 次的概率依次为 10%/30%/40%/20%。",
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
