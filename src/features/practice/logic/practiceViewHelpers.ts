import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import type { Staff, TargetNote, TargetNoteId } from "../../../domain/types";
import type { PracticePromptRuntime } from "../hooks/usePracticeSessionLifecycle";

type PromptRuntime = PracticePromptRuntime;

export interface DuetHintContent {
  key: string;
  message: string;
}

export function pickRangeExtensionNote(
  notes: readonly TargetNote[],
  lastTargetNoteId?: TargetNoteId
): TargetNote | undefined {
  const eligible = notes.filter((note) => note.id !== lastTargetNoteId);
  const pool = eligible.length > 0 ? eligible : notes;
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

export function getDuetFeedbackStaff(
  answerMidi: number | undefined,
  prompt: PromptRuntime
): Staff | null {
  const targets = [...(prompt.duetTargets?.high ?? []), ...(prompt.duetTargets?.low ?? [])].filter(
    (target) => !prompt.completedDuetTargetNoteIds.includes(target.id)
  );
  if (targets.length === 0) return null;
  if (answerMidi === undefined) {
    return targets.length === 1 ? targets[0]!.staff : null;
  }
  return targets.reduce((closest, target) =>
    Math.abs(getTargetMidiNoteNumber(target) - answerMidi) <
    Math.abs(getTargetMidiNoteNumber(closest) - answerMidi)
      ? target
      : closest
  ).staff;
}

export function getDuetPairHint(firstStaff: Staff, lateStaff?: Staff): DuetHintContent {
  if (lateStaff && lateStaff !== firstStaff) {
    return lateStaff === "bass"
      ? { key: "late:bass", message: "左手按晚了，请左右手同时下键" }
      : { key: "late:treble", message: "右手按晚了，请左右手同时下键" };
  }
  const missingStaff = firstStaff === "bass" ? "treble" : "bass";
  return missingStaff === "bass"
    ? { key: "missed:bass", message: "左手漏弹，请与右手同时下键" }
    : { key: "missed:treble", message: "右手漏弹，请与左手同时下键" };
}

export function getDuetWrongHint(
  staves: readonly Staff[],
  hasUnknownWrong: boolean
): DuetHintContent | null {
  if (hasUnknownWrong) {
    return { key: "wrong:unknown", message: "音符不对，请检查当前谱面目标" };
  }
  const hands = [...new Set(staves)].sort();
  if (hands.length === 0) return null;
  const handKey = hands.join("-");
  const message =
    hands.length > 1
      ? "左右手音符不对，请检查两手"
      : hands[0] === "bass"
        ? "左手音符不对，请检查左手"
        : "右手音符不对，请检查右手";
  return { key: `wrong:${handKey}`, message };
}

export function combineDuetPairHint(
  pairHint: DuetHintContent,
  wrongStaves: readonly Staff[],
  hasUnknownWrong: boolean
): DuetHintContent {
  const wrongHint = getDuetWrongHint(wrongStaves, hasUnknownWrong);
  if (!wrongHint) return pairHint;
  return {
    key: `combined:${wrongHint.key}:${pairHint.key}`,
    message: `${wrongHint.message.split("，")[0]}；${pairHint.message}`,
  };
}
