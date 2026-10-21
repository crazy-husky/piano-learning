import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { selectNotePage, type AdaptiveNoteScheduler } from "../../../domain/scheduler";
import type { MelodyGenerationState } from "../../../domain/melody";
import type {
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PromptNoteDuration,
  ReviewRecord,
  TargetNote,
} from "../../../domain/types";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import { getStaffPageRefillCount } from "../logic/staffPageFlow";
import { generateStaffPageRhythm } from "../logic/staffPageNotation";
import type { GeneratedStaffPageRhythm } from "../logic/staffPageNotation";
import type { PracticeStaffPageRuntime } from "./usePracticeSessionLifecycle";

const CROSS_GROUP_NOTE_RATE = 0.08;
const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
const MOBILE_STAFF_ROW_HEIGHT_PX = 220;
const MOBILE_SCORE_VIEWPORT_RESERVED_HEIGHT_PX = 260;
const MAX_MOBILE_STAFF_BUFFER_ROWS = 4;

function initialStaffPageBufferRowCount(isMobileViewport: boolean): number {
  if (!isMobileViewport || typeof window === "undefined") {
    return PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows;
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const estimatedScoreHeight = Math.max(
    MOBILE_STAFF_ROW_HEIGHT_PX * 2,
    viewportHeight - MOBILE_SCORE_VIEWPORT_RESERVED_HEIGHT_PX
  );
  return Math.max(
    PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows,
    Math.min(
      MAX_MOBILE_STAFF_BUFFER_ROWS,
      Math.ceil(estimatedScoreHeight / MOBILE_STAFF_ROW_HEIGHT_PX)
    )
  );
}

function addOccasionalRangeNotes(
  notes: readonly TargetNote[],
  rangeExtensionNotes: readonly TargetNote[]
): TargetNote[] {
  if (rangeExtensionNotes.length === 0) return [...notes];
  const result = [...notes];
  for (let index = 0; index < result.length; index += 1) {
    if (Math.random() >= CROSS_GROUP_NOTE_RATE) continue;
    const previousNote = result[index - 1];
    const eligible = rangeExtensionNotes.filter((candidate) => candidate.id !== previousNote?.id);
    const pool = eligible.length > 0 ? eligible : rangeExtensionNotes;
    result[index] = pool[Math.floor(Math.random() * pool.length)] ?? result[index]!;
  }
  return result;
}

interface PracticeStaffPageFlowValues {
  drillNoteNames: NoteName[];
  enabledNotes: TargetNote[];
  fixedCount: number;
  isMobileViewport: boolean;
  mode: PracticeMode;
  pageNoteCount: number;
  promptNoteDurations: PromptNoteDuration[];
  rangeExtensionNotes: TargetNote[];
  retainHistory: boolean;
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
  setStaffPageRhythm: Dispatch<SetStateAction<GeneratedStaffPageRhythm | undefined>>;
}

interface UsePracticeStaffPageFlowOptions {
  runtime: PracticeStaffPageFlowRuntime;
  services: PracticeStaffPageFlowServices;
  ui: PracticeStaffPageFlowUi;
  values: PracticeStaffPageFlowValues;
}

export function usePracticeStaffPageFlow({
  runtime,
  services,
  ui,
  values,
}: UsePracticeStaffPageFlowOptions) {
  const {
    drillNoteNames,
    enabledNotes,
    fixedCount,
    isMobileViewport,
    mode,
    pageNoteCount,
    promptNoteDurations,
    rangeExtensionNotes,
    retainHistory,
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
    setStaffPageRhythm,
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

  const syncStaffPage = useCallback(
    (page: PracticeStaffPageRuntime | null): void => {
      staffPageRef.current = page;
      setStaffPageNotes(page?.notes ?? []);
      setStaffPageRhythm(page?.rhythm);
      setStaffPageIndex(page?.index ?? 0);
      setStaffPageCompletedCount(page?.completedCount ?? 0);
      if (!page) {
        setStaffPageFirstNoteOffset(0);
      }
    },
    [
      setStaffPageCompletedCount,
      setStaffPageFirstNoteOffset,
      setStaffPageIndex,
      setStaffPageNotes,
      setStaffPageRhythm,
      staffPageRef,
    ]
  );

  const getNextStaffPageCount = useCallback(
    (nextCompletedCount: number): number => {
      const initialBufferCount = retainHistory
        ? pageNoteCount * initialStaffPageBufferRowCount(isMobileViewport)
        : STAFF_PAGE_SIZE;
      if (mode !== "fixed-count") {
        return initialBufferCount;
      }
      return Math.min(initialBufferCount, Math.max(0, fixedCount - nextCompletedCount));
    },
    [fixedCount, isMobileViewport, mode, pageNoteCount, retainHistory]
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
  }, [staffPageRef, syncStaffPage]);

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
    [staffPageRef, startPrompt, syncStaffPage]
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
      const lastTargetNoteId = lastTargetNoteIdRef.current;
      const isSplitStaffRange = new Set(sourceNotes.map((note) => note.staff)).size > 1;
      const generatedNotes =
        sourceQueueStrategy !== "melody" && !isSplitStaffRange
          ? (adaptiveSchedulerRef.current?.selectPage(count, {
              lastTargetNoteId,
            }) ??
            selectNotePage({
              notes: sourceNotes,
              reviews: sourceReviews,
              sessions,
              currentSessionId: sessionRef.current?.id,
              queueStrategy: sourceQueueStrategy,
              drillNoteNames: sourceDrillNoteNames,
              lastTargetNoteId,
              melodyState: melodyGenerationStateRef.current,
              count,
            }))
          : selectNotePage({
              notes: sourceNotes,
              reviews: sourceReviews,
              sessions,
              currentSessionId: sessionRef.current?.id,
              queueStrategy: sourceQueueStrategy,
              drillNoteNames: sourceDrillNoteNames,
              lastTargetNoteId,
              melodyState: melodyGenerationStateRef.current,
              count,
            });
      const notes = addOccasionalRangeNotes(generatedNotes, rangeExtensionNotes);
      const rhythm =
        promptNoteDurations.length > 1
          ? generateStaffPageRhythm(promptNoteDurations, notes.length)
          : undefined;
      const page = {
        notes,
        index: 0,
        completedCount: 0,
        ...(rhythm ? { rhythm } : {}),
      };
      syncStaffPage(page);
      startPrompt(notes[0]);
    },
    [
      adaptiveSchedulerRef,
      getNextStaffPageCount,
      lastTargetNoteIdRef,
      melodyGenerationStateRef,
      rangeExtensionNotes,
      promptNoteDurations,
      sessionRef,
      sessions,
      startPrompt,
      syncStaffPage,
    ]
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
        pageNoteCount,
        plannedNoteCount: page.notes.length,
        refillNoteCount: retainHistory ? pageNoteCount : undefined,
      });
      const hasNextPageOnDesktop =
        !isMobileViewport &&
        nextIndex > page.index &&
        nextIndex % pageNoteCount === 0 &&
        nextIndex < page.notes.length;
      if (nextRowCount === 0 && !hasNextPageOnDesktop) {
        return false;
      }

      let nextNotes = page.notes;
      let nextRhythm = page.rhythm;
      if (nextRowCount > 0) {
        const lastTargetNoteId = page.notes[page.notes.length - 1]?.id;
        const isSplitStaffRange = new Set(enabledNotes.map((note) => note.staff)).size > 1;
        const pageSelectionOptions = {
          notes: enabledNotes,
          reviews: [...schedulerReviews, ...sessionReviewsRef.current],
          sessions,
          currentSessionId: sessionRef.current?.id,
          queueStrategy,
          drillNoteNames,
          lastTargetNoteId,
          plannedTargetNoteIds: remainingVisibleNotes.map((note) => note.id),
          melodyState: melodyGenerationStateRef.current,
          count: nextRowCount,
        };
        const nextRow =
          !isSplitStaffRange && queueStrategy !== "melody"
            ? (adaptiveSchedulerRef.current?.selectPage(nextRowCount, {
                lastTargetNoteId: pageSelectionOptions.lastTargetNoteId,
                plannedTargetNoteIds: pageSelectionOptions.plannedTargetNoteIds,
              }) ?? selectNotePage(pageSelectionOptions))
            : selectNotePage(pageSelectionOptions);
        const appendedNotes = addOccasionalRangeNotes(nextRow, rangeExtensionNotes);
        nextNotes = [...page.notes, ...appendedNotes];
        if (page.rhythm) {
          const appendedRhythm = generateStaffPageRhythm(
            promptNoteDurations,
            appendedNotes.length,
            page.rhythm.endBeat
          );
          nextRhythm = {
            durations: [...page.rhythm.durations, ...appendedRhythm.durations],
            endBeat: appendedRhythm.endBeat,
            measures: [...page.rhythm.measures, ...appendedRhythm.measures],
            noteBeamGroups: [...page.rhythm.noteBeamGroups, ...appendedRhythm.noteBeamGroups],
            onsets: [...page.rhythm.onsets, ...appendedRhythm.onsets],
          };
        }
      }
      const sessionId = sessionRef.current?.id;
      syncStaffPage({
        ...page,
        index: nextIndex,
        notes: nextNotes,
        ...(nextRhythm ? { rhythm: nextRhythm } : {}),
      });
      const finishScroll = (): void => {
        staffPageScrollTimeoutRef.current = null;
        if (!sessionId || sessionRef.current?.id !== sessionId || sessionRef.current.endedAt) {
          return;
        }
        const scrolledPage = staffPageRef.current;
        if (retainHistory) {
          setIsStaffPageScrolling(false);
          if (!scrolledPage) return;
          const nextNote = scrolledPage.notes[scrolledPage.index];
          if (!nextNote) return;
          const startNextPrompt = (): void => {
            resumeActiveTimers();
            startPrompt(nextNote);
          };
          if (isPausedRef.current) {
            pendingAfterPauseRef.current = startNextPrompt;
            return;
          }
          startNextPrompt();
          return;
        }
        if (
          !scrolledPage ||
          scrolledPage.notes.length <= PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
        ) {
          setIsStaffPageScrolling(false);
          return;
        }
        const rebasedPage = {
          notes: scrolledPage.notes.slice(PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow),
          index: scrolledPage.index - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          completedCount:
            scrolledPage.completedCount - PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          ...(scrolledPage.rhythm
            ? {
                rhythm: {
                  ...scrolledPage.rhythm,
                  durations: scrolledPage.rhythm.durations.slice(
                    PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
                  ),
                  measures: scrolledPage.rhythm.measures.slice(
                    PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
                  ),
                  noteBeamGroups: scrolledPage.rhythm.noteBeamGroups.slice(
                    PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
                  ),
                  onsets: scrolledPage.rhythm.onsets.slice(
                    PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
                  ),
                },
              }
            : {}),
        };
        setStaffPageFirstNoteOffset(
          (offset) => offset + PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
        );
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
        if (!retainHistory) setIsStaffPageScrolling(true);
        staffPageScrollTimeoutRef.current = window.setTimeout(
          finishScroll,
          staffPageScrollDurationMs
        );
      });
      return true;
    },
    [
      clearStaffPageScrollSchedule,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      isMobileViewport,
      adaptiveSchedulerRef,
      isPausedRef,
      melodyGenerationStateRef,
      mode,
      pageNoteCount,
      pendingAfterPauseRef,
      queueStrategy,
      promptNoteDurations,
      rangeExtensionNotes,
      retainHistory,
      resumeActiveTimers,
      schedulerReviews,
      sessionRef,
      sessionReviewsRef,
      sessions,
      staffPageScrollDurationMs,
      setIsStaffPageScrolling,
      setStaffPageFirstNoteOffset,
      staffPageRef,
      startPrompt,
      syncStaffPage,
    ]
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
