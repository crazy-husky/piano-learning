import type { StaffGameWrongNoteArchiveRun } from "../../../domain/types";
import type { StaffGameRoundNoteOutcome } from "../hooks/useStaffGameRoundClock";

interface WrongAnswerForArchive {
  token: number;
  recognizedNote: string;
}

export interface StaffGameWrongNoteRunPerformance {
  targetCount: number;
  firstTryAccuracyPercent: number | null;
  averageResponseMs: number | null;
  weakNoteCount: number;
}

export function summarizeStaffGameWrongNoteRunPerformance(
  run: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteRunPerformance {
  const notes = Object.values(run.notes);
  const responseTotalMs = notes.reduce((total, note) => total + (note.totalResponseMs ?? 0), 0);
  const responseSampleCount = notes.reduce(
    (total, note) => total + (note.responseSampleCount ?? 0),
    0
  );

  return {
    targetCount: run.totalTargets,
    firstTryAccuracyPercent:
      run.totalTargets > 0 ? (run.firstTryCorrect / run.totalTargets) * 100 : null,
    averageResponseMs: responseSampleCount > 0 ? responseTotalMs / responseSampleCount : null,
    weakNoteCount: notes.reduce((total, note) => total + note.wrong + note.missed, 0),
  };
}

export function summarizeStaffGameWrongNoteOutcomes(
  outcomes: readonly StaffGameRoundNoteOutcome[],
  wrongAnswerRecords: readonly WrongAnswerForArchive[],
  fallbackErrorAt = new Date().toISOString()
): Pick<StaffGameWrongNoteArchiveRun, "notes" | "firstTryCorrect"> {
  const wrongByToken = new Map<number, string>();
  for (const record of wrongAnswerRecords) {
    if (!wrongByToken.has(record.token)) wrongByToken.set(record.token, record.recognizedNote);
  }

  const notes: StaffGameWrongNoteArchiveRun["notes"] = {};
  let firstTryCorrect = 0;
  for (const outcome of outcomes) {
    const key = String(outcome.midi);
    const note = notes[key] ?? {
      midi: outcome.midi,
      note: outcome.note,
      appear: 0,
      correct: 0,
      wrong: 0,
      missed: 0,
      confusions: {},
    };
    note.appear += 1;
    if (outcome.firstInputCorrect === true) {
      note.correct += 1;
      firstTryCorrect += 1;
    } else if (outcome.firstInputCorrect === false) {
      note.wrong += 1;
      const confusion = wrongByToken.get(outcome.token);
      if (confusion) note.confusions[confusion] = (note.confusions[confusion] ?? 0) + 1;
    } else {
      note.missed += 1;
    }
    if (outcome.firstInputCorrect !== true) {
      const errorAt = Number.isFinite(outcome.errorAt)
        ? outcome.errorAt!
        : Date.parse(fallbackErrorAt);
      if (Number.isFinite(errorAt)) {
        const currentErrorAt = Date.parse(note.lastErrorAt ?? "");
        note.lastErrorAt = new Date(
          Number.isFinite(currentErrorAt) ? Math.max(currentErrorAt, errorAt) : errorAt
        ).toISOString();
      }
    }
    notes[key] = note;
  }

  return { notes, firstTryCorrect };
}
