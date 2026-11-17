import { useMemo } from "react";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { findNoteById } from "../../../domain/notes";
import type { ReviewRecord, TargetNote } from "../../../domain/types";
import {
  DuetStaffNotationGroup,
  type DuetStaffNotationColumn,
  type DuetStaffNotationNote,
} from "./DuetStaffNotationGroup";

const MIN_RANKING_SAMPLES = 2;

interface PerformanceColumn extends DuetStaffNotationColumn {
  correctCount: number;
  sampleCount: number;
}

interface PerformanceGroups {
  multi: PerformanceColumn[];
  single: PerformanceColumn[];
}

function notationNote(target: TargetNote): DuetStaffNotationNote {
  return {
    accidental: target.accidental,
    count: 1,
    midi: getTargetMidiNoteNumber(target),
    noteName: target.noteName,
    octave: target.octave,
    staff: target.staff,
    tone: "neutral",
  };
}

function comparePitchHighToLow(left: PerformanceColumn, right: PerformanceColumn): number {
  const leftNotes = [...left.notes].sort((a, b) => {
    return b.midi - a.midi || (a.staff === b.staff ? 0 : a.staff === "treble" ? -1 : 1);
  });
  const rightNotes = [...right.notes].sort((a, b) => {
    return b.midi - a.midi || (a.staff === b.staff ? 0 : a.staff === "treble" ? -1 : 1);
  });
  for (let index = 0; index < Math.min(leftNotes.length, rightNotes.length); index += 1) {
    const leftNote = leftNotes[index]!;
    const rightNote = rightNotes[index]!;
    if (leftNote.midi !== rightNote.midi) return rightNote.midi - leftNote.midi;
    if (leftNote.staff !== rightNote.staff) return leftNote.staff === "treble" ? -1 : 1;
  }
  return rightNotes.length - leftNotes.length;
}

function comparePerformance(left: PerformanceColumn, right: PerformanceColumn): number {
  const leftAccuracy = left.correctCount / left.sampleCount;
  const rightAccuracy = right.correctCount / right.sampleCount;
  return (
    rightAccuracy - leftAccuracy ||
    right.sampleCount - left.sampleCount ||
    comparePitchHighToLow(left, right)
  );
}

function getAccuracy(column: PerformanceColumn): number {
  return column.correctCount / column.sampleCount;
}

function annotationFor(column: PerformanceColumn, rank: number): string {
  const accuracy = Math.round(getAccuracy(column) * 100);
  return `第${rank}名 · ${column.correctCount}/${column.sampleCount} · ${accuracy}%`;
}

function noteGroupKey(notes: readonly TargetNote[]): string {
  return [...notes]
    .sort((a, b) => {
      if (a.staff !== b.staff) return a.staff === "treble" ? -1 : 1;
      return getTargetMidiNoteNumber(a) - getTargetMidiNoteNumber(b);
    })
    .map((note) => `${note.staff}:${getTargetMidiNoteNumber(note)}`)
    .join("|");
}

function collectPerformanceGroups(reviews: readonly ReviewRecord[]): PerformanceGroups {
  const single = new Map<string, PerformanceColumn>();
  const multi = new Map<string, PerformanceColumn>();

  for (const review of reviews) {
    const performance = review.duetPerformance;
    if (!performance || performance.targets.length === 0) continue;
    const wasMissed = review.wasMissed === true;
    if (review.interrupted && !wasMissed) continue;

    // `attempted` is set for every target when a prompt times out, even without
    // input. Exclude only a pure no-input miss; partial/wrong input is a failed
    // sample for a simultaneous group because every target must be first-try correct.
    const hasPitchEvidence =
      performance.targets.some((target) => target.completed || target.firstTryCorrect) ||
      review.wrongAnswers.length > 0;
    if (!hasPitchEvidence) continue;

    const targets = performance.targets
      .map((performanceTarget) => {
        const target = findNoteById(performanceTarget.targetNoteId);
        return target
          ? { note: target, firstTryCorrect: performanceTarget.firstTryCorrect }
          : undefined;
      })
      .filter(
        (entry): entry is { note: TargetNote; firstTryCorrect: boolean } => entry !== undefined
      );
    if (targets.length !== performance.targets.length) continue;

    const notes = targets.map(({ note }) => notationNote(note));
    const isSingle = notes.length === 1;
    const key = isSingle
      ? `${notes[0]!.staff}:${notes[0]!.midi}`
      : noteGroupKey(targets.map(({ note }) => note));
    const groups = isSingle ? single : multi;
    const existing = groups.get(key);
    const correct = targets.every(({ firstTryCorrect }) => firstTryCorrect);
    if (existing) {
      existing.sampleCount += 1;
      existing.correctCount += Number(correct);
    } else {
      groups.set(key, {
        correctCount: Number(correct),
        key,
        notes,
        sampleCount: 1,
      });
    }
  }

  const prepare = (groups: Map<string, PerformanceColumn>): PerformanceColumn[] => {
    return [...groups.values()]
      .filter((column) => column.sampleCount >= MIN_RANKING_SAMPLES)
      .sort(comparePerformance);
  };

  return { multi: prepare(multi), single: prepare(single) };
}

function renderRankedGroups(
  label: string,
  columns: readonly PerformanceColumn[]
): JSX.Element | null {
  if (columns.length === 0) return null;
  return (
    <DuetStaffNotationGroup
      columns={columns.map((column, index) => ({
        ...column,
        annotation: annotationFor(column, index + 1),
      }))}
      compactColumnGap={160}
      compactColumns
      label={label}
    />
  );
}

export function DuetPerformanceRanking({
  reviews,
}: {
  reviews: readonly ReviewRecord[];
}): JSX.Element {
  const groups = useMemo(() => collectPerformanceGroups(reviews), [reviews]);
  const visibleSingleCount = groups.single.length;
  const visibleMultiCount = groups.multi.length;
  const hasRankedNotes = visibleSingleCount > 0 || visibleMultiCount > 0;

  return (
    <details className="summary-section practice-wrong-note-summary duet-performance-ranking">
      <summary className="practice-wrong-note-summary-heading">
        <span>本次音符表现排名</span>
        <small>
          单音 {visibleSingleCount} · 合弹 {visibleMultiCount}
        </small>
      </summary>
      <div className="practice-wrong-note-content duet-performance-ranking-content">
        <p className="duet-performance-ranking-hint">
          按首答正确率排序；音高看符头，准拍另行统计。出现至少 2 次才参与排名。
        </p>
        {hasRankedNotes ? (
          <>
            {renderRankedGroups("单音", groups.single)}
            {renderRankedGroups("双音合弹", groups.multi)}
          </>
        ) : (
          <p className="practice-wrong-note-empty">本次没有重复出现至少 2 次的音符或合弹组。</p>
        )}
      </div>
    </details>
  );
}
