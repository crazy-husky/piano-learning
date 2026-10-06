import { PRACTICE_PAGE_STAFF_LAYOUT } from "./staffLayoutProfiles";

const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
const STAFF_PAGE_SCROLL_TRIGGER_REMAINING = 8;
export const MOBILE_STAFF_PAGE_NOTE_COUNT = 8;

export interface MobileStaffPageView<T> {
  completedCount: number;
  currentPage: number;
  noteIndexInPage: number;
  notes: T[];
  totalPages: number;
}

export function buildMobileStaffPageView<T>({
  completedCount,
  currentIndex,
  firstNoteOffset,
  fixedSessionCount,
  notes,
}: {
  completedCount: number;
  currentIndex: number;
  firstNoteOffset: number;
  fixedSessionCount?: number;
  notes: T[];
}): MobileStaffPageView<T> {
  const pageStartIndex = Math.floor(Math.max(0, currentIndex) / MOBILE_STAFF_PAGE_NOTE_COUNT) *
    MOBILE_STAFF_PAGE_NOTE_COUNT;
  const currentPage = Math.floor((firstNoteOffset + Math.max(0, currentIndex)) / MOBILE_STAFF_PAGE_NOTE_COUNT) + 1;
  const noteCount = fixedSessionCount ?? firstNoteOffset + notes.length;

  return {
    completedCount: Math.max(
      0,
      Math.min(MOBILE_STAFF_PAGE_NOTE_COUNT, completedCount - pageStartIndex),
    ),
    currentPage,
    noteIndexInPage: Math.max(0, currentIndex - pageStartIndex),
    notes: notes.slice(pageStartIndex, pageStartIndex + MOBILE_STAFF_PAGE_NOTE_COUNT),
    totalPages: Math.max(1, currentPage, Math.ceil(noteCount / MOBILE_STAFF_PAGE_NOTE_COUNT)),
  };
}

export function getStaffPageRefillCount({
  completedSessionCount,
  fixedSessionCount,
  nextIndex,
  plannedNoteCount,
}: {
  completedSessionCount: number;
  fixedSessionCount?: number;
  nextIndex: number;
  plannedNoteCount: number;
}): number {
  const remainingVisibleCount = plannedNoteCount - nextIndex;
  if (plannedNoteCount !== STAFF_PAGE_SIZE || remainingVisibleCount !== STAFF_PAGE_SCROLL_TRIGGER_REMAINING) {
    return 0;
  }
  const availableFutureCount =
    fixedSessionCount === undefined
      ? PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
      : Math.max(0, fixedSessionCount - completedSessionCount - remainingVisibleCount);
  return Math.min(PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow, availableFutureCount);
}
