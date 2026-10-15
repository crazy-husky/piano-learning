import { ALL_NOTES } from "../../../domain/notes";
import {
  calculateStaffGameWrongNoteErrorCounts,
  type StaffGameWrongNoteRange,
} from "../../../domain/staffGameWrongNoteArchives";
import type {
  Octave,
  NoteName,
  PianoKeyName,
  StaffGameWrongNoteArchive,
  TargetNote,
} from "../../../domain/types";
import { gameNoteFromMidi, PITCH_NAMES } from "./staffGameRules";

export interface StaffGameWrongNoteStudyItem {
  midi: number;
  label: string;
  errorCount: number;
  target: TargetNote;
}

export interface StaffGameWrongNoteSelfTestProgress {
  index: number;
  isAnswerRevealed: boolean;
  completedMidis: number[];
  rememberedMidis: number[];
  forgottenMidis: number[];
}

export function targetNoteFromStaffGameMidi(midi: number): TargetNote | null {
  const pitch = gameNoteFromMidi(midi);
  if (pitch.octave < 1 || pitch.octave > 6) return null;
  const noteName = pitch.name[0] as NoteName;
  const octave = pitch.octave as Octave;
  const pitchId = `${noteName}${octave}`;
  const naturalTarget = ALL_NOTES.find(
    (candidate) => candidate.pitchId === pitchId && candidate.id === candidate.pitchId
  );
  if (!naturalTarget) return null;

  return pitch.name.endsWith("#") ? { ...naturalTarget, accidental: "sharp" } : naturalTarget;
}

export function getStaffGameWrongNoteStudyItems(
  archives: readonly StaffGameWrongNoteArchive[],
  range: StaffGameWrongNoteRange,
  today = new Date()
): StaffGameWrongNoteStudyItem[] {
  return calculateStaffGameWrongNoteErrorCounts(archives, range, today).flatMap(
    ({ midi, errorCount }) => {
      const target = targetNoteFromStaffGameMidi(midi);
      if (!target) return [];
      const pitch = gameNoteFromMidi(midi);
      return [{ midi, label: `${pitch.name}${pitch.octave}`, errorCount, target }];
    }
  );
}

export function createStaffGameWrongNoteSelfTestProgress(): StaffGameWrongNoteSelfTestProgress {
  return {
    index: 0,
    isAnswerRevealed: false,
    completedMidis: [],
    rememberedMidis: [],
    forgottenMidis: [],
  };
}

export function revealStaffGameWrongNoteSelfTestAnswer(
  progress: StaffGameWrongNoteSelfTestProgress,
  itemCount: number,
  currentMidi?: number
): StaffGameWrongNoteSelfTestProgress {
  if (progress.index >= itemCount || progress.isAnswerRevealed) return progress;
  if (currentMidi === undefined) return { ...progress, isAnswerRevealed: true };

  return {
    ...progress,
    isAnswerRevealed: true,
    rememberedMidis: progress.rememberedMidis.filter((midi) => midi !== currentMidi),
    forgottenMidis: [...new Set([...progress.forgottenMidis, currentMidi])],
  };
}

export function submitStaffGameWrongNoteSelfTestAnswer(
  progress: StaffGameWrongNoteSelfTestProgress,
  items: readonly StaffGameWrongNoteStudyItem[],
  pitch: PianoKeyName
): { progress: StaffGameWrongNoteSelfTestProgress; isCorrect: boolean } {
  const current = items[progress.index];
  if (!current) return { progress, isCorrect: false };

  const isCorrect = current.midi % 12 === PITCH_NAMES.indexOf(pitch);
  if (!isCorrect) {
    return {
      isCorrect: false,
      progress: {
        ...progress,
        rememberedMidis: progress.rememberedMidis.filter((midi) => midi !== current.midi),
        forgottenMidis: [...new Set([...progress.forgottenMidis, current.midi])],
      },
    };
  }

  const wasForgotten = progress.forgottenMidis.includes(current.midi);
  const rememberedMidis = wasForgotten
    ? progress.rememberedMidis.filter((midi) => midi !== current.midi)
    : [...new Set([...progress.rememberedMidis, current.midi])];
  const completedMidis = [...new Set([...progress.completedMidis, current.midi])];
  let nextIndex = items.length;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidateIndex = (progress.index + offset) % items.length;
    if (!completedMidis.includes(items[candidateIndex].midi)) {
      nextIndex = candidateIndex;
      break;
    }
  }

  return {
    isCorrect: true,
    progress: {
      index: nextIndex,
      isAnswerRevealed: false,
      completedMidis,
      rememberedMidis,
      forgottenMidis: progress.forgottenMidis,
    },
  };
}

export function navigateStaffGameWrongNoteSelfTest(
  progress: StaffGameWrongNoteSelfTestProgress,
  itemCount: number,
  direction: "previous" | "next"
): StaffGameWrongNoteSelfTestProgress {
  if (progress.index >= itemCount) return progress;
  const nextIndex = progress.index + (direction === "next" ? 1 : -1);
  if (nextIndex < 0 || nextIndex >= itemCount) return progress;
  return { ...progress, index: nextIndex, isAnswerRevealed: false };
}

export function rateStaffGameWrongNoteSelfTestItem(
  progress: StaffGameWrongNoteSelfTestProgress,
  items: readonly StaffGameWrongNoteStudyItem[],
  remembered: boolean
): StaffGameWrongNoteSelfTestProgress {
  const current = items[progress.index];
  if (!current || !progress.isAnswerRevealed) return progress;

  const rememberedMidis = progress.rememberedMidis.filter((midi) => midi !== current.midi);
  const forgottenMidis = progress.forgottenMidis.filter((midi) => midi !== current.midi);
  if (remembered) rememberedMidis.push(current.midi);
  else forgottenMidis.push(current.midi);

  const completedMidis = [...new Set([...progress.completedMidis, current.midi])];
  let nextIndex = items.length;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidateIndex = (progress.index + offset) % items.length;
    if (!completedMidis.includes(items[candidateIndex].midi)) {
      nextIndex = candidateIndex;
      break;
    }
  }

  return {
    index: nextIndex,
    isAnswerRevealed: false,
    completedMidis,
    rememberedMidis,
    forgottenMidis,
  };
}

export function isStaffGameWrongNoteSelfTestComplete(
  progress: StaffGameWrongNoteSelfTestProgress,
  itemCount: number
): boolean {
  return itemCount > 0 && progress.index >= itemCount;
}
