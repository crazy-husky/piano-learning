import { ALL_NOTES } from "../../domain/notes";
import { getTargetMidiNoteNumber } from "../../domain/answerInput";
import type { AnswerEvent, DuetPracticeLevel, TargetNote } from "../../domain/types";
import type { DuetTargetPair } from "../practice/logic/duetPractice";
import type { WeakPracticeItem } from "./components/learningStatsData";

export interface DuetWrongNoteTestPlan {
  level: DuetPracticeLevel;
  rangePreset: "standard" | "extended";
  /** Null questions use the selected level's normal generated notes as controls. */
  questions: Array<DuetTargetPair | null>;
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
    pitchGroups.length === 0 ||
    pitchGroups.includes("all") ||
    pitchGroups.includes(String(note.octave));
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

export function buildDuetWrongNoteTestPlan(
  level: DuetPracticeLevel,
  weakItems: readonly WeakPracticeItem[],
  controls: readonly AnswerEvent[],
  pitchGroups: readonly string[]
): DuetWrongNoteTestPlan | null {
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

  return {
    level,
    rangePreset: chooseExtendedRange(questions) ? "extended" : "standard",
    questions,
    weakTargetCount: weakQuestions.length,
  };
}
