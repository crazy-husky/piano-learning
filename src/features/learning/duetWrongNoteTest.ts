import { ALL_NOTES } from "../../domain/notes";
import { getTargetMidiNoteNumber } from "../../domain/answerInput";
import type { AnswerEvent, DuetPracticeLevel, Staff, TargetNote } from "../../domain/types";
import type { DuetTargetPair } from "../practice/logic/duetPractice";
import {
  DUET_PRACTICE_RANGE_GROUPS,
  type DuetPracticeRangeGroupId,
} from "../practice/logic/duetPractice";
import type { WeakPracticeItem } from "./components/learningStatsData";

const SUPPORTED_DUET_RANGE_GROUP_IDS = new Set(DUET_PRACTICE_RANGE_GROUPS.map(({ id }) => id));

export interface DuetWrongNoteTestPlan {
  level: DuetPracticeLevel;
  rangePreset: "standard" | "extended";
  rangeGroupIds: DuetPracticeRangeGroupId[];
  /** Null questions use the selected level's normal generated notes as controls. */
  questions: Array<DuetTargetPair | null>;
  /** Level 1 variant used when the saved strict hand alternation option is enabled. */
  strictHandAlternationQuestions: Array<DuetTargetPair | null>;
  strictHandAlternationStart: Staff;
  weakTargetCount: number;
}

function targetPairFromEvent(
  event: AnswerEvent | undefined,
  pitchGroups: readonly string[]
): DuetTargetPair | null {
  if (!event) return null;

  const byStaff = (staff: TargetNote["staff"]): TargetNote[] => {
    const recordedMidis = event.duetTargetMidis?.[staff];
    const legacyMidi = staff === "treble" ? event.targetMidiHigh : event.targetMidiLow;
    const midiValues = recordedMidis?.length
      ? recordedMidis
      : typeof legacyMidi === "number"
        ? [legacyMidi]
        : [];
    if (midiValues.length) {
      return midiValues
        .map((midi) =>
          ALL_NOTES.find((note) => note.staff === staff && getTargetMidiNoteNumber(note) === midi)
        )
        .filter((note): note is TargetNote => note !== undefined);
    }

    return (event.duetTargetNoteIds ?? [event.targetNoteId].filter(Boolean))
      .map((id) => ALL_NOTES.find((note) => note.id === id))
      .filter((note): note is TargetNote => note !== undefined && note.staff === staff);
  };

  const pair = { high: byStaff("treble"), low: byStaff("bass") };
  const selected = (note: TargetNote): boolean =>
    SUPPORTED_DUET_RANGE_GROUP_IDS.has(note.groupId as DuetPracticeRangeGroupId) &&
    (pitchGroups.length === 0 ||
      pitchGroups.includes("all") ||
      pitchGroups.includes(String(note.octave)));
  pair.high = pair.high.filter(selected);
  pair.low = pair.low.filter(selected);
  return pair.high.length || pair.low.length ? pair : null;
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function chooseExtendedRange(questions: readonly (DuetTargetPair | null)[]): boolean {
  return questions.some((pair) =>
    [...(pair?.high ?? []), ...(pair?.low ?? [])].some(
      (note) => note.groupId === "C2-B2" || note.groupId === "C5-B5"
    )
  );
}

function getSelectedRangeGroupIds(pitchGroups: readonly string[]): DuetPracticeRangeGroupId[] {
  const allGroupIds = DUET_PRACTICE_RANGE_GROUPS.map(({ id }) => id);
  if (pitchGroups.length === 0 || pitchGroups.includes("all")) return allGroupIds;

  const selectedOctaves = new Set(pitchGroups.filter((group) => /^[2-5]$/.test(group)));
  const selectedGroupIds = DUET_PRACTICE_RANGE_GROUPS.filter(({ id }) =>
    selectedOctaves.has(id.slice(1, 2))
  ).map(({ id }) => id);
  return selectedGroupIds;
}

function splitTargetPairByStaff(pair: DuetTargetPair): DuetTargetPair[] {
  const targets: DuetTargetPair[] = [];
  if (pair.high.length) targets.push({ high: pair.high, low: [] });
  if (pair.low.length) targets.push({ high: [], low: pair.low });
  return targets;
}

function buildStrictAlternationQuestions(
  weakTargets: readonly DuetTargetPair[],
  controlCount: number
): { questions: Array<DuetTargetPair | null>; startingStaff: Staff } {
  const targetsByStaff: Record<Staff, DuetTargetPair[]> = {
    treble: [],
    bass: [],
  };
  weakTargets.forEach((target) => {
    splitTargetPairByStaff(target).forEach((singleStaffTarget) => {
      const staff = singleStaffTarget.high.length ? "treble" : "bass";
      targetsByStaff[staff].push(singleStaffTarget, singleStaffTarget);
    });
  });
  targetsByStaff.treble = shuffle(targetsByStaff.treble);
  targetsByStaff.bass = shuffle(targetsByStaff.bass);

  const startingStaff: Staff =
    targetsByStaff.treble.length >= targetsByStaff.bass.length ? "treble" : "bass";
  const questions: Array<DuetTargetPair | null> = [];
  let staff = startingStaff;
  while (targetsByStaff.treble.length || targetsByStaff.bass.length) {
    questions.push(targetsByStaff[staff].shift() ?? null);
    staff = staff === "treble" ? "bass" : "treble";
  }

  // Keep the usual one generated control per two weak attempts. Extra nulls above
  // are generated notes needed to bridge gaps when weak targets use one hand more.
  for (let index = 0; index < controlCount; index += 1) {
    questions.push(null);
  }

  return { questions, startingStaff };
}

export function buildDuetWrongNoteTestPlan(
  level: DuetPracticeLevel,
  weakItems: readonly WeakPracticeItem[],
  controls: readonly AnswerEvent[],
  pitchGroups: readonly string[]
): DuetWrongNoteTestPlan | null {
  const rangeGroupIds = getSelectedRangeGroupIds(pitchGroups);
  const weakQuestions = weakItems
    .map((item) => ({ id: item.id, target: targetPairFromEvent(item.event, pitchGroups) }))
    .filter((item): item is { id: string; target: DuetTargetPair } => item.target !== null);
  if (weakQuestions.length === 0) return null;

  const shuffledWeak = shuffle(weakQuestions.flatMap((item) => [item, item]));
  const controlPairs = controls
    .map((event) => targetPairFromEvent(event, pitchGroups))
    .filter((pair) => pair !== null);
  const questions: Array<DuetTargetPair | null> = [];

  for (let index = 0; index < shuffledWeak.length; index += 2) {
    const first = shuffledWeak[index]!;
    const second = shuffledWeak[index + 1]!;
    const controlIndex = Math.floor(index / 2);
    const control = controlPairs.length ? controlPairs[controlIndex % controlPairs.length]! : null;

    questions.push(first.target);
    if (first.id === second.id) questions.push(control, second.target);
    else questions.push(second.target, control);
  }

  const strictAlternation = buildStrictAlternationQuestions(
    weakQuestions.map((item) => item.target),
    weakQuestions.length
  );

  return {
    level,
    rangePreset: chooseExtendedRange(questions) ? "extended" : "standard",
    rangeGroupIds,
    questions,
    strictHandAlternationQuestions: strictAlternation.questions,
    strictHandAlternationStart: strictAlternation.startingStaff,
    weakTargetCount: weakQuestions.length,
  };
}
