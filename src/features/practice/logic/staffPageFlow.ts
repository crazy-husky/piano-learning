import {
  getPracticeStaffMeasureWidthPx,
  PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_STAFF_WIDTH_TUNING,
} from "../../../shared/staff/staffLayoutProfiles";

export const DESKTOP_STAFF_PAGE_NOTE_COUNT = PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
export const MOBILE_STAFF_PAGE_NOTE_COUNT = 8;
export const DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT = 12;
export const DUET_MOBILE_STAFF_PAGE_NOTE_COUNT = 10;
export const DUET_DESKTOP_MEASURES_PER_ROW = 3;
export const DUET_MOBILE_MEASURES_PER_ROW = 2;

export interface StaffPageMeasureRows<T> {
  rowStartIndices: number[];
  rows: T[][];
}

export function getStaffPageMeasureWidthsPx(
  measures: readonly number[],
  noteOnsets?: readonly number[],
  beatsPerMeasure: number = PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
): ReadonlyMap<number, number> {
  const onsetColumnsByMeasure = new Map<number, Set<number>>();
  measures.forEach((measure, index) => {
    let onsetColumns = onsetColumnsByMeasure.get(measure);
    if (!onsetColumns) {
      onsetColumns = new Set<number>();
      onsetColumnsByMeasure.set(measure, onsetColumns);
    }
    const onset = noteOnsets?.[index];
    if (onset !== undefined && Number.isFinite(onset)) {
      // Generated triplets can accumulate tiny floating-point differences.
      onsetColumns.add(Math.round(onset * 1_000_000) / 1_000_000);
    }
  });

  return new Map(
    [...onsetColumnsByMeasure].map(([measure, onsetColumns]) => [
      measure,
      getPracticeStaffMeasureWidthPx([...onsetColumns], beatsPerMeasure),
    ])
  );
}

export function chunkStaffPageGroupsByMeasure<T>(
  groups: readonly T[],
  measures: readonly number[],
  maxEventsPerRow: number,
  maxRowCount = Number.POSITIVE_INFINITY,
  maxMeasuresPerRow = Number.POSITIVE_INFINITY
): StaffPageMeasureRows<T> {
  const capacity = Math.max(1, Math.floor(maxEventsPerRow));
  const rows: T[][] = [];
  const rowStartIndices: number[] = [];
  let groupIndex = 0;

  while (groupIndex < groups.length && rows.length < maxRowCount) {
    const rowStartIndex = groupIndex;
    const row: T[] = [];
    const rowMeasures = new Set<number>();

    while (groupIndex < groups.length) {
      const measure = measures[groupIndex];
      let measureEndIndex = groupIndex + 1;
      while (measureEndIndex < groups.length && measures[measureEndIndex] === measure) {
        measureEndIndex += 1;
      }

      const measureEventCount = measureEndIndex - groupIndex;
      if (
        row.length > 0 &&
        (row.length + measureEventCount > capacity || rowMeasures.size >= maxMeasuresPerRow)
      ) {
        break;
      }

      row.push(...groups.slice(groupIndex, measureEndIndex));
      rowMeasures.add(measure);
      groupIndex = measureEndIndex;
      if (measureEventCount > capacity) break;
    }

    rowStartIndices.push(rowStartIndex);
    rows.push(row);
  }

  return { rowStartIndices, rows };
}

export function chunkStaffPageGroupsByAdaptiveMeasureWidth<T>(
  groups: readonly T[],
  measures: readonly number[],
  maxMeasureAreaWidthPx: number,
  maxMeasuresPerRow: number,
  maxRowCount = Number.POSITIVE_INFINITY,
  noteOnsets?: readonly number[],
  beatsPerMeasure: number = PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
): StaffPageMeasureRows<T> {
  const widthBudget = Math.max(1, maxMeasureAreaWidthPx);
  const measureLimit = Math.max(1, Math.floor(maxMeasuresPerRow));
  const rows: T[][] = [];
  const rowStartIndices: number[] = [];
  const measureWidths = getStaffPageMeasureWidthsPx(measures, noteOnsets, beatsPerMeasure);
  let groupIndex = 0;

  while (groupIndex < groups.length && rows.length < maxRowCount) {
    const rowStartIndex = groupIndex;
    const row: T[] = [];
    let rowWidth = 0;
    let rowMeasureCount = 0;

    while (groupIndex < groups.length) {
      const measure = measures[groupIndex];
      let measureEndIndex = groupIndex + 1;
      while (measureEndIndex < groups.length && measures[measureEndIndex] === measure) {
        measureEndIndex += 1;
      }

      const measureWidth =
        measureWidths.get(measure) ?? getPracticeStaffMeasureWidthPx([], beatsPerMeasure);
      if (
        row.length > 0 &&
        (rowMeasureCount >= measureLimit || rowWidth + measureWidth > widthBudget)
      ) {
        break;
      }

      row.push(...groups.slice(groupIndex, measureEndIndex));
      rowWidth += measureWidth;
      rowMeasureCount += 1;
      groupIndex = measureEndIndex;
    }

    rowStartIndices.push(rowStartIndex);
    rows.push(row);
  }

  return { rowStartIndices, rows };
}

export function getStaffPageRowIndex(
  rowStartIndices: readonly number[],
  eventIndex: number
): number {
  let low = 0;
  let high = rowStartIndices.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rowStartIndices[middle]! <= eventIndex) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

export interface StaffPageView<T> {
  completedCount: number;
  currentPage: number;
  noteIndexInPage: number;
  notes: T[];
  totalPages: number;
}

export function buildStaffPageView<T>({
  completedCount,
  currentIndex,
  firstNoteOffset,
  fixedSessionCount,
  notes,
  pageNoteCount = MOBILE_STAFF_PAGE_NOTE_COUNT,
}: {
  completedCount: number;
  currentIndex: number;
  firstNoteOffset: number;
  fixedSessionCount?: number;
  notes: T[];
  pageNoteCount?: number;
}): StaffPageView<T> {
  const resolvedPageNoteCount = Math.max(1, Math.floor(pageNoteCount));
  const pageStartIndex =
    Math.floor(Math.max(0, currentIndex) / resolvedPageNoteCount) * resolvedPageNoteCount;
  const currentPage =
    Math.floor((firstNoteOffset + Math.max(0, currentIndex)) / resolvedPageNoteCount) + 1;
  const noteCount = fixedSessionCount ?? firstNoteOffset + notes.length;

  return {
    completedCount: Math.max(0, Math.min(resolvedPageNoteCount, completedCount - pageStartIndex)),
    currentPage,
    noteIndexInPage: Math.max(0, currentIndex - pageStartIndex),
    notes: notes.slice(pageStartIndex, pageStartIndex + resolvedPageNoteCount),
    totalPages: Math.max(1, currentPage, Math.ceil(noteCount / resolvedPageNoteCount)),
  };
}

export const buildMobileStaffPageView = buildStaffPageView;

export function getStaffPageRefillCount({
  completedSessionCount,
  fixedSessionCount,
  nextIndex,
  plannedNoteCount,
  pageNoteCount = MOBILE_STAFF_PAGE_NOTE_COUNT,
  refillNoteCount = PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
}: {
  completedSessionCount: number;
  fixedSessionCount?: number;
  nextIndex: number;
  plannedNoteCount: number;
  pageNoteCount?: number;
  refillNoteCount?: number;
}): number {
  const remainingVisibleCount = plannedNoteCount - nextIndex;
  if (remainingVisibleCount !== pageNoteCount || remainingVisibleCount <= 0) {
    return 0;
  }
  const availableFutureCount =
    fixedSessionCount === undefined
      ? refillNoteCount
      : Math.max(0, fixedSessionCount - completedSessionCount - remainingVisibleCount);
  return Math.min(refillNoteCount, availableFutureCount);
}
