import type { StaffGameWrongNoteArchive } from "../../../domain/types";
import { localDateKey } from "../../../domain/stats";
import { shuffledItems, type StaffGamePitch } from "./staffGameRules";

export const WRONG_NOTE_REVIEW_MASTERY_WINDOW_DAYS = 14;
export const WRONG_NOTE_REVIEW_MIN_DURATION_MS = 60_000;
export const WRONG_NOTE_REVIEW_MAX_DURATION_MS = 180_000;

export interface StaffGameWrongNoteReviewPlan {
  notes: StaffGamePitch[];
  weakNoteCount: number;
  weightedRepeatCount: number;
  familiarNoteCount: number;
  totalQuestionCount: number;
}

export interface StaffGameWrongNoteReviewQuestionCounts {
  weakNoteCount: number;
  weightedRepeatCount: number;
  familiarNoteCount: number;
  totalQuestionCount: number;
}

export function staffGameWrongNoteReviewDurationMs(
  totalQuestionCount: number,
  bubbleDurationMs: number
): number {
  const questionCount = Math.max(0, Math.floor(totalQuestionCount));
  const fallDuration = Math.max(0, bubbleDurationMs);
  const estimatedDuration = Math.ceil(questionCount * fallDuration * 0.5);
  return Math.min(
    WRONG_NOTE_REVIEW_MAX_DURATION_MS,
    Math.max(WRONG_NOTE_REVIEW_MIN_DURATION_MS, estimatedDuration)
  );
}

export function formatStaffGameWrongNoteReviewDuration(durationMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, durationMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds > 0 ? `${seconds}秒` : ""}` : `${seconds}秒`;
}

function pickWithoutReplacement(notes: readonly StaffGamePitch[], count: number): StaffGamePitch[] {
  return shuffledItems([...notes])
    .slice(0, Math.max(0, count))
    .map((note) => ({ ...note }));
}

export function staffGameWrongNoteReviewFamiliarTargetCount(weakNoteCount: number): number {
  if (weakNoteCount <= 0) return 0;
  if (weakNoteCount < 5) return weakNoteCount * 2;
  return 10 + Math.round((weakNoteCount - 5) * 0.2);
}

export function staffGameWrongNoteReviewQuestionCounts(
  weakNoteCount: number,
  availableFamiliarNoteCount: number
): StaffGameWrongNoteReviewQuestionCounts {
  const normalizedWeakCount = Math.max(0, Math.floor(weakNoteCount));
  const weightedRepeatCount = Math.ceil(normalizedWeakCount / 2);
  const familiarNoteCount = Math.min(
    staffGameWrongNoteReviewFamiliarTargetCount(normalizedWeakCount),
    Math.max(0, Math.floor(availableFamiliarNoteCount))
  );
  return {
    weakNoteCount: normalizedWeakCount,
    weightedRepeatCount,
    familiarNoteCount,
    totalQuestionCount: normalizedWeakCount + weightedRepeatCount + familiarNoteCount,
  };
}

/**
 * Select pitches with stable recent accuracy from the last 14 local calendar days.
 * Accuracy follows the archive diagnostic convention: first-try correct / appearances.
 */
export function getStaffGameWrongNoteMasteredMidis(
  archives: readonly StaffGameWrongNoteArchive[],
  today = new Date()
): Set<number> {
  const endDateKey = localDateKey(today.toISOString());
  const firstDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  firstDate.setDate(firstDate.getDate() - (WRONG_NOTE_REVIEW_MASTERY_WINDOW_DAYS - 1));
  const firstDateKey = localDateKey(firstDate.toISOString());
  const totals = new Map<number, { appearances: number; correct: number }>();

  for (const archive of archives) {
    if (archive.date < firstDateKey || archive.date > endDateKey) continue;
    for (const run of archive.runs) {
      if (run.trendOnly) continue;
      for (const note of Object.values(run.notes)) {
        const aggregate = totals.get(note.midi) ?? { appearances: 0, correct: 0 };
        aggregate.appearances += Math.max(0, note.appear);
        aggregate.correct += Math.max(0, note.correct);
        totals.set(note.midi, aggregate);
      }
    }
  }

  return new Set(
    [...totals.entries()]
      .filter(([, total]) => total.appearances >= 3 && total.correct / total.appearances >= 0.8)
      .map(([midi]) => midi)
  );
}

function drawWeightedWeakNotes(
  weakNotes: readonly StaffGamePitch[],
  count: number,
  weights: ReadonlyMap<number, number>
): StaffGamePitch[] {
  if (weakNotes.length === 0 || count <= 0) return [];
  const weightedPool = weakNotes.map((note) => ({
    note,
    weight: Math.max(0, weights.get(note.midi) ?? 0),
  }));
  const totalWeight = weightedPool.reduce((total, item) => total + item.weight, 0);
  if (totalWeight <= 0) return pickWithoutReplacement(weakNotes, count);

  return Array.from({ length: count }, () => {
    let point = Math.random() * totalWeight;
    const selected = weightedPool.find((item) => {
      point -= item.weight;
      return point < 0;
    });
    return { ...(selected?.note ?? weightedPool[weightedPool.length - 1]!.note) };
  });
}

export function buildStaffGameWrongNoteReviewPlan(
  unlockedNotes: readonly StaffGamePitch[],
  weakNoteWeights: ReadonlyMap<number, number>,
  masteredMidis: ReadonlySet<number>
): StaffGameWrongNoteReviewPlan {
  const weakNotes = unlockedNotes.filter((note) => (weakNoteWeights.get(note.midi) ?? 0) > 0);
  const weakMidis = new Set(weakNotes.map((note) => note.midi));
  const familiarCandidates = unlockedNotes.filter((note) => !weakMidis.has(note.midi));
  const counts = staffGameWrongNoteReviewQuestionCounts(
    weakNotes.length,
    familiarCandidates.length
  );
  const stableCandidates = familiarCandidates.filter((note) => masteredMidis.has(note.midi));
  const stableSelection = pickWithoutReplacement(
    stableCandidates,
    Math.min(counts.familiarNoteCount, stableCandidates.length)
  );
  const stableMidis = new Set(stableSelection.map((note) => note.midi));
  const remainingFamiliarCandidates = familiarCandidates.filter(
    (note) => !stableMidis.has(note.midi)
  );
  const familiarFallback = pickWithoutReplacement(
    remainingFamiliarCandidates,
    counts.familiarNoteCount - stableSelection.length
  );
  const weightedRepeats = drawWeightedWeakNotes(
    weakNotes,
    counts.weightedRepeatCount,
    weakNoteWeights
  );
  const notes = shuffledItems([
    ...pickWithoutReplacement(weakNotes, weakNotes.length),
    ...weightedRepeats,
    ...stableSelection,
    ...familiarFallback,
  ]);

  return { ...counts, notes };
}
