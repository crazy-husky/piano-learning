import { useMemo } from "react";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { findNoteById } from "../../../domain/notes";
import type {
  ReviewRecord,
  Staff,
  TargetNote,
  TargetNoteId,
  WrongAnswer,
} from "../../../domain/types";
import {
  DuetStaffNotationGroup,
  type DuetStaffNotationColumn,
  type DuetStaffNotationNote,
  type DuetStaffNoteTone,
} from "./DuetStaffNotationGroup";

type NoteTone = DuetStaffNoteTone;
type ScoreNote = DuetStaffNotationNote;

interface ScoreColumn extends DuetStaffNotationColumn {
  errorCount: number;
  occurrenceCount: number;
}

interface DuetWrongNoteGroups {
  simultaneous: ScoreColumn[];
  singles: ScoreColumn[];
  totalOccurrences: number;
  unknown: Map<string, number>;
}

const MIDI_PITCHES = [
  { accidental: undefined, letter: "C" },
  { accidental: "sharp", letter: "C" },
  { accidental: undefined, letter: "D" },
  { accidental: "sharp", letter: "D" },
  { accidental: undefined, letter: "E" },
  { accidental: undefined, letter: "F" },
  { accidental: "sharp", letter: "F" },
  { accidental: undefined, letter: "G" },
  { accidental: "sharp", letter: "G" },
  { accidental: undefined, letter: "A" },
  { accidental: "sharp", letter: "A" },
  { accidental: undefined, letter: "B" },
] as const;

function isMidiPitch(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 127;
}

function noteFromMidi(midi: number, staff: Staff, tone: NoteTone, count: number): ScoreNote {
  const pitch = MIDI_PITCHES[((midi % 12) + 12) % 12] ?? MIDI_PITCHES[0];
  return {
    accidental: pitch.accidental,
    count,
    midi,
    noteName: pitch.letter,
    octave: Math.floor(midi / 12) - 1,
    staff,
    tone,
  };
}

function noteFromTarget(target: TargetNote, tone: NoteTone, count: number): ScoreNote {
  return {
    accidental: target.accidental,
    count,
    midi: getTargetMidiNoteNumber(target),
    noteName: target.noteName,
    octave: target.octave,
    staff: target.staff,
    tone,
  };
}

function targetIdsForReview(review: ReviewRecord): TargetNoteId[] {
  const performanceTargets = review.duetPerformance?.targets;
  if (performanceTargets?.length) return performanceTargets.map((target) => target.targetNoteId);
  if (review.duetTargetNoteIds?.length) return review.duetTargetNoteIds;
  return [review.targetNoteId];
}

function missedTargetIdsForReview(review: ReviewRecord): Set<TargetNoteId> {
  const performanceTargets = review.duetPerformance?.targets;
  if (performanceTargets?.length) {
    return new Set(
      performanceTargets
        .filter(
          (target) =>
            !target.completed && (review.wasMissed === true || target.missedOnset === true)
        )
        .map((target) => target.targetNoteId)
    );
  }
  if (!review.wasMissed) return new Set();
  return new Set(
    targetIdsForReview(review).filter(
      (targetId) => !(review.duetCompletedTargetNoteIds ?? []).includes(targetId)
    )
  );
}

function closestTargetIdForWrongAnswer(
  answer: WrongAnswer,
  targetIds: readonly TargetNoteId[]
): TargetNoteId | undefined {
  const explicitTarget = answer.duetTargetNoteId
    ? targetIds.find((targetId) => targetId === answer.duetTargetNoteId)
    : undefined;
  if (explicitTarget) return explicitTarget;
  if (isMidiPitch(answer.midiNoteNumber)) {
    return targetIds.reduce<TargetNoteId | undefined>((closestId, targetId) => {
      const target = findNoteById(targetId);
      if (!target) return closestId;
      if (!closestId) return targetId;
      const closestTarget = findNoteById(closestId);
      if (!closestTarget) return targetId;
      return Math.abs(getTargetMidiNoteNumber(target) - answer.midiNoteNumber!) <
        Math.abs(getTargetMidiNoteNumber(closestTarget) - answer.midiNoteNumber!)
        ? targetId
        : closestId;
    }, undefined);
  }
  return targetIds.length === 1 ? targetIds[0] : undefined;
}

function targetIdForWrongAnswer(
  answer: WrongAnswer,
  targetIds: readonly TargetNoteId[]
): TargetNoteId | undefined {
  return closestTargetIdForWrongAnswer(answer, targetIds);
}

function addSingleNote(counts: Map<string, ScoreColumn>, note: ScoreNote, errorCount = 1): void {
  const key = `${note.staff}:${note.midi}`;
  const existing = counts.get(key);
  if (existing) {
    existing.occurrenceCount += errorCount;
    existing.errorCount += errorCount;
    existing.notes[0]!.count = existing.occurrenceCount;
    return;
  }
  counts.set(key, {
    errorCount,
    key,
    notes: [{ ...note, count: errorCount }],
    occurrenceCount: errorCount,
  });
}

function getTargetFirstTryResult(
  review: ReviewRecord,
  targetId: TargetNoteId,
  wrongAnswers: readonly WrongAnswer[],
  missed: boolean
): { attempted: boolean; failed: boolean; firstTryCorrect: boolean | undefined; missed: boolean } {
  const performanceTarget = review.duetPerformance?.targets.find(
    (target) => target.targetNoteId === targetId
  );
  const firstTryCorrect = performanceTarget?.firstTryCorrect;
  const attempted = performanceTarget?.attempted ?? (wrongAnswers.length > 0 || missed);
  const failed = wrongAnswers.length > 0 || missed || (attempted && firstTryCorrect === false);
  return { attempted, failed, firstTryCorrect, missed };
}

function collectDuetWrongNoteGroups(reviews: readonly ReviewRecord[]): DuetWrongNoteGroups {
  const singles = new Map<string, ScoreColumn>();
  const simultaneous = new Map<string, ScoreColumn>();
  const unknown = new Map<string, number>();
  let totalOccurrences = 0;

  for (const review of reviews) {
    const targetIds = targetIdsForReview(review);
    const targetNotes = targetIds
      .map((targetId) => findNoteById(targetId))
      .filter((target): target is TargetNote => target !== undefined);
    const missedTargetIds = missedTargetIdsForReview(review);
    const wrongAnswersByTarget = new Map<TargetNoteId, WrongAnswer[]>();
    for (const wrongAnswer of review.wrongAnswers) {
      totalOccurrences += 1;
      const targetId = targetIdForWrongAnswer(wrongAnswer, targetIds);
      if (!targetId) {
        const unknownName = wrongAnswer.pianoKeyName ?? wrongAnswer.noteName;
        unknown.set(unknownName, (unknown.get(unknownName) ?? 0) + 1);
        continue;
      }
      const answers = wrongAnswersByTarget.get(targetId) ?? [];
      answers.push(wrongAnswer);
      wrongAnswersByTarget.set(targetId, answers);
      if (!isMidiPitch(wrongAnswer.midiNoteNumber)) {
        const unknownName = wrongAnswer.pianoKeyName ?? wrongAnswer.noteName;
        unknown.set(unknownName, (unknown.get(unknownName) ?? 0) + 1);
      }
    }

    const failedTargets = new Map<TargetNoteId, ReturnType<typeof getTargetFirstTryResult>>();
    for (const target of targetNotes) {
      const wrongAnswers = wrongAnswersByTarget.get(target.id) ?? [];
      const result = getTargetFirstTryResult(
        review,
        target.id,
        wrongAnswers,
        missedTargetIds.has(target.id)
      );
      failedTargets.set(target.id, result);
      if (result.missed) totalOccurrences += 1;

      if (targetIds.length === 1) {
        for (const wrongAnswer of wrongAnswers) {
          if (isMidiPitch(wrongAnswer.midiNoteNumber)) {
            addSingleNote(
              singles,
              noteFromMidi(wrongAnswer.midiNoteNumber, target.staff, "danger", 1)
            );
          }
        }
        if (result.missed) {
          addSingleNote(singles, noteFromTarget(target, "danger", 1));
        } else if (result.failed && review.wrongAnswers.length === 0) {
          totalOccurrences += 1;
          addSingleNote(singles, noteFromTarget(target, "danger", 1));
        }
      }
    }

    if (targetIds.length === 1) {
      continue;
    }

    const groupNotes = targetNotes.map((target) => {
      const wrongAnswers = wrongAnswersByTarget.get(target.id) ?? [];
      const result = failedTargets.get(target.id);
      const hasMiss = missedTargetIds.has(target.id);
      if (wrongAnswers.length > 0) {
        const firstWrongPitch = wrongAnswers.find((answer) => isMidiPitch(answer.midiNoteNumber));
        if (firstWrongPitch && isMidiPitch(firstWrongPitch.midiNoteNumber)) {
          return noteFromMidi(firstWrongPitch.midiNoteNumber, target.staff, "danger", 1);
        }
        return noteFromTarget(target, "danger", 1);
      }
      if (result?.failed || hasMiss) return noteFromTarget(target, "danger", 1);
      if (
        result?.firstTryCorrect === true ||
        review.duetCompletedTargetNoteIds?.includes(target.id) ||
        (review.duetPerformance === undefined && review.answeredCorrectly)
      ) {
        return noteFromTarget(target, "success", 1);
      }
      return noteFromTarget(target, "neutral", 1);
    });
    const groupErrorCount = [...failedTargets.entries()].reduce((sum, [targetId, result]) => {
      const wrongAnswerCount = wrongAnswersByTarget.get(targetId)?.length ?? 0;
      const fallbackFailure = Number(
        result.failed &&
          wrongAnswerCount === 0 &&
          !result.missed &&
          review.wrongAnswers.length === 0
      );
      return sum + wrongAnswerCount + Number(result.missed) + fallbackFailure;
    }, 0);
    const resolvedGroupErrorCount =
      groupErrorCount === 0 && review.wrongAnswers.length > 0
        ? review.wrongAnswers.length
        : groupErrorCount;
    totalOccurrences += [...failedTargets.entries()].reduce((sum, [targetId, result]) => {
      const wrongAnswerCount = wrongAnswersByTarget.get(targetId)?.length ?? 0;
      return (
        sum +
        Number(
          result.failed &&
            wrongAnswerCount === 0 &&
            !result.missed &&
            review.wrongAnswers.length === 0
        )
      );
    }, 0);

    if (resolvedGroupErrorCount === 0 || groupNotes.length === 0) continue;
    const orderedNotes = groupNotes.sort((left, right) => {
      if (left.staff !== right.staff) return left.staff === "treble" ? -1 : 1;
      return left.midi - right.midi;
    });
    const key = orderedNotes
      .map((note) => `${note.staff}:${note.midi}:${note.tone}:${note.accidental ?? "natural"}`)
      .join("|");
    const existing = simultaneous.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.errorCount += resolvedGroupErrorCount;
      existing.notes.forEach((note) => {
        note.count = existing.occurrenceCount;
      });
    } else {
      simultaneous.set(key, {
        errorCount: resolvedGroupErrorCount,
        key,
        notes: orderedNotes.map((note) => ({ ...note, count: 1 })),
        occurrenceCount: 1,
      });
    }
  }

  return {
    simultaneous: [...simultaneous.values()].sort(
      (left, right) =>
        right.errorCount - left.errorCount || right.occurrenceCount - left.occurrenceCount
    ),
    singles: [...singles.values()].sort(
      (left, right) => right.errorCount - left.errorCount || left.key.localeCompare(right.key)
    ),
    totalOccurrences,
    unknown,
  };
}

export function DuetWrongNoteSummary({
  reviews,
}: {
  reviews: readonly ReviewRecord[];
}): JSX.Element {
  const { singles, simultaneous, totalOccurrences, unknown } = useMemo(
    () => collectDuetWrongNoteGroups(reviews),
    [reviews]
  );

  return (
    <details className="summary-section practice-wrong-note-summary">
      <summary className="practice-wrong-note-summary-heading">
        <span>错漏音汇总</span>
        <small>{totalOccurrences} 次</small>
      </summary>
      {totalOccurrences === 0 ? (
        <p className="practice-wrong-note-empty">本次没有错音或漏音。</p>
      ) : (
        <div className="practice-wrong-note-content">
          {singles.length > 0 ? (
            <DuetStaffNotationGroup columns={singles} compactColumns label="单音" />
          ) : null}
          {simultaneous.length > 0 ? (
            <DuetStaffNotationGroup columns={simultaneous} label="双音合弹" />
          ) : null}
          {unknown.size > 0 ? (
            <p className="practice-wrong-note-unknown">
              这些错音没有八度信息，暂时无法定位到谱面：
              {[...unknown.entries()]
                .map(([noteName, count]) => `${noteName} ×${count}`)
                .join("、")}
            </p>
          ) : null}
        </div>
      )}
    </details>
  );
}
