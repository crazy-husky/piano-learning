import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { selectNotePage, type AdaptiveNoteScheduler } from "../domain/scheduler";
import type { MelodyGenerationState } from "../domain/melody";
import type {
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  ReviewRecord,
  TargetNote,
} from "../domain/types";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "./staffLayoutProfiles";
import { getStaffPageRefillCount } from "./staffPageFlow";
import type { PracticeStaffPageRuntime } from "./usePracticeSessionLifecycle";

const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;

interface PracticeStaffPageFlowValues {
  drillNoteNames: NoteName[];
  enabledNotes: TargetNote[];
  fixedCount: number;
  mode: PracticeMode;
  queueStrategy: PracticeQueueStrategy;
  schedulerReviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  staffPageScrollDurationMs: number;
}

interface PracticeStaffPageFlowRuntime {
  adaptiveSchedulerRef: MutableRefObject<AdaptiveNoteScheduler | null>;
  isPausedRef: MutableRefObject<boolean>;
  lastTargetNoteIdRef: MutableRefObject<TargetNote["id"] | undefined>;
  melodyGenerationStateRef: MutableRefObject<MelodyGenerationState>;
  pendingAfterPauseRef: MutableRefObject<(() => void) | null>;
  sessionRef: MutableRefObject<PracticeSessionRecord | null>;
  sessionReviewsRef: MutableRefObject<ReviewRecord[]>;
  staffPageRef: MutableRefObject<PracticeStaffPageRuntime | null>;
}

interface PracticeStaffPageFlowServices {
  resumeActiveTimers: () => void;
  startPrompt: (note: TargetNote) => void;
}

interface PracticeStaffPageFlowUi {
  setIsStaffPageScrolling: Dispatch<SetStateAction<boolean>>;
  setStaffPageCompletedCount: Dispatch<SetStateAction<number>>;
  setStaffPageFirstNoteOffset: Dispatch<SetStateAction<number>>;
  setStaffPageIndex: Dispatch<SetStateAction<number>>;
  setStaffPageNotes: Dispatch<SetStateAction<TargetNote[]>>;
}

interface UsePracticeStaffPageFlowOptions {
  runtime: PracticeStaffPageFlowRuntime;
  services: PracticeStaffPageFlowServices;
  ui: PracticeStaffPageFlowUi;
  values: PracticeStaffPageFlowValues;
}

export function usePracticeStaffPageFlow({ runtime, services, ui, values }: UsePracticeStaffPageFlowOptions) {
  const {
    drillNoteNames,
    enabledNotes,
    fixedCount,
    mode,
    queueStrategy,
    schedulerReviews,
    sessions,
    staffPageScrollDurationMs,
  } = values;
  const {
    adaptiveSchedulerRef,
    isPausedRef,
    lastTargetNoteIdRef,
    melodyGenerationStateRef,
    pendingAfterPauseRef,
    sessionRef,
    sessionReviewsRef,
    staffPageRef,
  } = runtime;
  const { resumeActiveTimers, startPrompt } = services;
  const {
    setIsStaffPageScrolling,
    setStaffPageCompletedCount,
    setStaffPageFirstNoteOffset,
    setStaffPageIndex,
    setStaffPageNotes,
  } = ui;
  const staffPageScrollFrameRef = useRef<number | null>(null);
  const staffPageScrollTimeoutRef = useRef<number | null>(null);

  const clearStaffPageScrollSchedule = useCallback((): void => {
    if (staffPageScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(staffPageScrollFrameRef.current);
      staffPageScrollFrameRef.current = null;
    }
    if (staffPageScrollTimeoutRef.current !== null) {
      window.clearTimeout(staffPageScrollTimeoutRef.current);
      staffPageScrollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearStaffPageScrollSchedule(), [clearStaffPageScrollSchedule]);

  const syncStaffPage = useCallback((page: PracticeStaffPageRuntime | null): void => {
    staffPageRef.current = page;
    setStaffPageNotes(page?.notes ?? []);
    setStaffPageIndex(page?.index ?? 0);
    setStaffPageCompletedCount(page?.completedCount ?? 0);
    if (!page) {
      setStaffPageFirstNoteOffset(0);
    }
  }, []);

  const getNextStaffPageCount = useCallback(
    (nextCompletedCount: number): number => {
      if (mode !== "fixed-count") {
        return STAFF_PAGE_SIZE;
      }
      return Math.min(STAFF_PAGE_SIZE, Math.max(0, fixedCount - nextCompletedCount));
    },
    [fixedCount, mode],
  );

  const markCurrentStaffPageNoteComplete = useCallback((): void => {
    const page = staffPageRef.current;
    if (!page) {
      return;
    }
    syncStaffPage({
      ...page,
      completedCount: Math.max(page.completedCount, page.index + 1),
    });
  }, [syncStaffPage]);

  const startStaffPageIndex = useCallback(
    (index: number): boolean => {
      const page = staffPageRef.current;
      if (!page || index >= page.notes.length) {
        return false;
      }
      const nextPage = {
        ...page,
        index,
      };
      syncStaffPage(nextPage);
      startPrompt(nextPage.notes[index]);
      return true;
    },
    [startPrompt, syncStaffPage],
  );

  const startStaffPage = useCallback(
    ({
      sourceNotes,
      sourceReviews,
      sourceQueueStrategy,
      sourceDrillNoteNames,
      nextCompletedCount,
    }: {
      sourceNotes: TargetNote[];
      sourceReviews: ReviewRecord[];
      sourceQueueStrategy: PracticeQueueStrategy;
      sourceDrillNoteNames: NoteName[];
      nextCompletedCount: number;
    }): void => {
      const count = getNextStaffPageCount(nextCompletedCount);
      if (count <= 0) {
        return;
      }
      const notes = sourceQueueStrategy !== "melody"
        ? adaptiveSchedulerRef.current?.selectPage(count, { lastTargetNoteId: lastTargetNoteIdRef.current }) ??
          selectNotePage({
            notes: sourceNotes,
            reviews: sourceReviews,
            sessions,
            currentSessionId: sessionRef.current?.id,
            queueStrategy: sourceQueueStrategy,
            drillNoteNames: sourceDrillNoteNames,
            lastTargetNoteId: lastTargetNoteIdRef.current,
            melodyState: melodyGenerationStateRef.current,
            count,
          })
        : selectNotePage({
            notes: sourceNotes,
            reviews: sourceReviews,
            sessions,
            currentSessionId: sessionRef.current?.id,
            queueStrategy: sourceQueueStrategy,
            drillNoteNames: sourceDrillNoteNames,
            lastTargetNoteId: lastTargetNoteIdRef.current,
            melodyState: melodyGenerationStateRef.current,
            count,
          });
      const page = {
        notes,
        index: 0,
        completedCount: 0,
      };
      syncStaffPage(page);
      startPrompt(notes[0]);
    },
    [getNextStaffPageCount, sessions, startPrompt, syncStaffPage],
  );

  const startStaffPageScroll = useCallback(
    (nextCompletedCount: number, nextIndex: number): boolean => {
      const page = staffPageRef.current;
      if (!page) {
        return false;
      }

      const remainingVisibleNotes = page.notes.slice(nextIndex);
      const nextRowCount = getStaffPageRefillCount({
        completedSessionCount: nextCompletedCount,
        fixedSessionCount: mode === "fixed-count" ? fixedCount : undefined,
        nextIndex,
        plannedNoteCount: page.notes.length,
      });
      if (nextRowCount === 0) {
        return false;
      }

      const pageSelectionOptions = {
        notes: enabledNotes,
        reviews: [...schedulerReviews, ...sessionReviewsRef.current],
        sessions,
        currentSessionId: sessionRef.current?.id,
        queueStrategy,
        drillNoteNames,
        lastTargetNoteId: page.notes[page.notes.length - 1]?.id,
        plannedTargetNoteIds: remainingVisibleNotes.map((note) => note.id),
        melodyState: melodyGenerationStateRef.current,
        count: nextRowCount,
      };
      const nextRow = queueStrategy !== "melody"
        ? adaptiveSchedulerRef.current?.selectPage(nextRowCount, {
            lastTargetNoteId: pageSelectionOptions.lastTargetNoteId,
            plannedTargetNoteIds: pageSelectionOptions.plannedTargetNoteIds,
          }) ?? selectNotePage(pageSelectionOptions)
        : selectNotePage(pageSelectionOptions);
      const sessionId = sessionRef.current?.id;
      syncStaffPage({
        ...page,
        index: nextIndex,
        notes: [...page.notes, ...nextRow],
      });
      const finishScroll = (): void => {
        staffPageScrollTimeoutRef.current = null;
        if (!sessionId || sessionRef.current?.id !== sessionId || sessionRef.current.endedAt) {
          return;
        }
        const scrolledPage = staffPageRef.current;
        if (!scrolledPage || scrolledPage.notes.length <= STAFF_PAGE_SIZE) {
          setIsStaffPageScrolling(false);
          return;
        }
        const rebasedPage = {
          notes: scrolledPage.notes.slice(PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow),
          index: scrolledPage.index - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          completedCount:
            scrolledPage.completedCount - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
        };
        setStaffPageFirstNoteOffset((offset) => offset + PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow);
        syncStaffPage(rebasedPage);
        setIsStaffPageScrolling(false);
        const startNextPrompt = (): void => {
          resumeActiveTimers();
          startPrompt(rebasedPage.notes[rebasedPage.index]);
        };
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = startNextPrompt;
          return;
        }
        startNextPrompt();
      };
      clearStaffPageScrollSchedule();
      staffPageScrollFrameRef.current = window.requestAnimationFrame(() => {
        staffPageScrollFrameRef.current = null;
        setIsStaffPageScrolling(true);
        staffPageScrollTimeoutRef.current = window.setTimeout(finishScroll, staffPageScrollDurationMs);
      });
      return true;
    },
    [
      clearStaffPageScrollSchedule,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      mode,
      queueStrategy,
      resumeActiveTimers,
      schedulerReviews,
      sessions,
      staffPageScrollDurationMs,
      startPrompt,
      syncStaffPage,
    ],
  );


  return {
    clearStaffPageScrollSchedule,
    markCurrentStaffPageNoteComplete,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
    syncStaffPage,
  };
}
