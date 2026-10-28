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
  DuetPracticeLevel,
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PromptNoteDuration,
  ReviewRecord,
  Staff,
  TargetNote,
} from "../../../domain/types";
import {
  PRACTICE_PAGE_STAFF_LAYOUT,
  PRACTICE_STAFF_WIDTH_TUNING,
  getPracticeStaffMeasureWidthPx,
} from "../../../shared/staff/staffLayoutProfiles";
import { getStaffPageRefillCount } from "../logic/staffPageFlow";
import { generateStaffPageRhythm } from "../logic/staffPageNotation";
import type { GeneratedStaffPageRhythm } from "../logic/staffPageNotation";
import {
  DUET_DESKTOP_MEASURES_PER_ROW,
  DUET_MOBILE_MEASURES_PER_ROW,
  DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT,
  DUET_MOBILE_STAFF_PAGE_NOTE_COUNT,
  chunkStaffPageGroupsByAdaptiveMeasureWidth,
  chunkStaffPageGroupsByMeasure,
  getStaffPageRowIndex,
} from "../logic/staffPageFlow";
import { createDuetPracticePage } from "../logic/duetPractice";
import type { DuetTargetPair } from "../logic/duetPractice";
import type { PracticeStaffPageRuntime } from "./usePracticeSessionLifecycle";

const CROSS_GROUP_NOTE_RATE = 0.08;
const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
const MOBILE_STAFF_ROW_HEIGHT_PX = 220;
const MOBILE_SCORE_VIEWPORT_RESERVED_HEIGHT_PX = 260;
const MAX_MOBILE_STAFF_BUFFER_ROWS = 4;

function duetTargetsForGroup(group: readonly TargetNote[] | undefined): DuetTargetPair | undefined {
  if (!group) return undefined;
  return {
    high: group.filter((note) => note.staff === "treble"),
    low: group.filter((note) => note.staff === "bass"),
  };
}

function getDuetMeasureRowStartIndices(
  notes: readonly TargetNote[],
  measures: readonly number[],
  isMobileViewport: boolean,
  adaptiveMeasureAreaWidthPx?: number,
  adaptiveMaxMeasuresPerRow?: number,
  noteOnsets?: readonly number[]
): number[] | undefined {
  if (measures.length !== notes.length) return undefined;
  if (adaptiveMeasureAreaWidthPx !== undefined && adaptiveMaxMeasuresPerRow !== undefined) {
    return chunkStaffPageGroupsByAdaptiveMeasureWidth(
      notes,
      measures,
      adaptiveMeasureAreaWidthPx,
      adaptiveMaxMeasuresPerRow,
      undefined,
      noteOnsets,
      PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
    ).rowStartIndices;
  }
  const capacity = isMobileViewport
    ? DUET_MOBILE_STAFF_PAGE_NOTE_COUNT
    : DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const maxMeasures = isMobileViewport
    ? DUET_MOBILE_MEASURES_PER_ROW
    : DUET_DESKTOP_MEASURES_PER_ROW;
  return chunkStaffPageGroupsByMeasure(notes, measures, capacity, undefined, maxMeasures)
    .rowStartIndices;
}

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

function getDuetMeasureCountForRows(
  level: DuetPracticeLevel,
  isMobileViewport: boolean,
  rowCount: number,
  adaptiveMeasureAreaWidthPx?: number,
  adaptiveMaxMeasuresPerRow?: number
): number {
  // Use the meter-based base width until the generated onset grid is available.
  const maxEventsPerMeasure = level === "level-5" ? 8 : level === "level-6" ? 7 : 4;
  if (adaptiveMeasureAreaWidthPx !== undefined && adaptiveMaxMeasuresPerRow !== undefined) {
    const measuresByWidth = Math.floor(
      adaptiveMeasureAreaWidthPx /
        getPracticeStaffMeasureWidthPx([], PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure)
    );
    return (
      rowCount *
      Math.max(
        1,
        Math.min(
          PRACTICE_STAFF_WIDTH_TUNING.maxMeasuresPerRow,
          adaptiveMaxMeasuresPerRow,
          measuresByWidth
        )
      )
    );
  }
  const eventCapacity = isMobileViewport
    ? DUET_MOBILE_STAFF_PAGE_NOTE_COUNT
    : DUET_DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const maxMeasuresPerRow = isMobileViewport
    ? DUET_MOBILE_MEASURES_PER_ROW
    : DUET_DESKTOP_MEASURES_PER_ROW;
  const measuresPerRow = Math.max(
    1,
    Math.min(maxMeasuresPerRow, Math.floor(eventCapacity / maxEventsPerMeasure))
  );
  return rowCount * measuresPerRow;
}

function getDuetMaximumEventsPerMeasure(level: DuetPracticeLevel): number {
  return level === "level-5" ? 8 : level === "level-6" ? 7 : 4;
}

function adaptiveDuetCandidateMeasureCount(rowCount: number): number {
  return rowCount * PRACTICE_STAFF_WIDTH_TUNING.maxMeasuresPerRow;
}

function getDuetInitialMeasureCount(
  level: DuetPracticeLevel,
  isMobileViewport: boolean,
  adaptiveMeasureAreaWidthPx?: number,
  adaptiveMaxMeasuresPerRow?: number
): number {
  if (adaptiveMeasureAreaWidthPx !== undefined && adaptiveMaxMeasuresPerRow !== undefined) {
    // Generate up to the global row cap, then trim to complete rows using the
    // actual generated measure densities and measured viewport width.
    return adaptiveDuetCandidateMeasureCount(initialStaffPageBufferRowCount(isMobileViewport));
  }
  return getDuetMeasureCountForRows(
    level,
    isMobileViewport,
    initialStaffPageBufferRowCount(isMobileViewport),
    adaptiveMeasureAreaWidthPx,
    adaptiveMaxMeasuresPerRow
  );
}

function trimDuetPageToAdaptiveRows(
  page: ReturnType<typeof createDuetPracticePage>,
  rowCount: number,
  adaptiveMeasureAreaWidthPx: number,
  adaptiveMaxMeasuresPerRow: number
): ReturnType<typeof createDuetPracticePage> {
  const rowStarts = chunkStaffPageGroupsByAdaptiveMeasureWidth(
    page.notes,
    page.rhythm.measures,
    adaptiveMeasureAreaWidthPx,
    adaptiveMaxMeasuresPerRow,
    undefined,
    page.rhythm.onsets,
    PRACTICE_STAFF_WIDTH_TUNING.referenceBeatsPerMeasure
  ).rowStartIndices;
  const cutoffIndex = rowStarts[rowCount];
  if (cutoffIndex === undefined || cutoffIndex <= 0) return page;

  return {
    ...page,
    events: page.events.slice(0, cutoffIndex),
    notes: page.notes.slice(0, cutoffIndex),
    noteGroups: page.noteGroups.slice(0, cutoffIndex),
    rhythm: {
      ...page.rhythm,
      durations: page.rhythm.durations.slice(0, cutoffIndex),
      endBeat: page.rhythm.onsets[cutoffIndex] ?? page.rhythm.endBeat,
      measures: page.rhythm.measures.slice(0, cutoffIndex),
      noteBeamGroups: page.rhythm.noteBeamGroups.slice(0, cutoffIndex),
      onsets: page.rhythm.onsets.slice(0, cutoffIndex),
      ...(page.rhythm.staffNoteDurations
        ? { staffNoteDurations: page.rhythm.staffNoteDurations.slice(0, cutoffIndex) }
        : {}),
    },
  };
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
  forceRhythmGeneration: boolean;
  rangeExtensionNotes: TargetNote[];
  duetLevel?: DuetPracticeLevel;
  adaptiveMeasureAreaWidthPx?: number;
  adaptiveMaxMeasuresPerRow?: number;
  allowDottedRhythms: boolean;
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
  startPrompt: (note: TargetNote, duetTargets?: DuetTargetPair) => void;
}

interface PracticeStaffPageFlowUi {
  setIsStaffPageScrolling: Dispatch<SetStateAction<boolean>>;
  setStaffPageCompletedCount: Dispatch<SetStateAction<number>>;
  setStaffPageFirstNoteOffset: Dispatch<SetStateAction<number>>;
  setStaffPageIndex: Dispatch<SetStateAction<number>>;
  setStaffPageNotes: Dispatch<SetStateAction<TargetNote[]>>;
  setStaffPageNoteGroups: Dispatch<SetStateAction<TargetNote[][]>>;
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
    forceRhythmGeneration,
    rangeExtensionNotes,
    duetLevel,
    adaptiveMeasureAreaWidthPx,
    adaptiveMaxMeasuresPerRow,
    allowDottedRhythms,
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
    setStaffPageNoteGroups,
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
      setStaffPageNoteGroups(page?.noteGroups ? [...page.noteGroups] : []);
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
      setStaffPageNoteGroups,
      setStaffPageRhythm,
      staffPageRef,
    ]
  );

  const getNextStaffPageCount = useCallback(
    (nextCompletedCount: number): number => {
      const adaptiveDuetStream =
        duetLevel !== undefined &&
        adaptiveMeasureAreaWidthPx !== undefined &&
        adaptiveMaxMeasuresPerRow !== undefined;
      const initialRows = initialStaffPageBufferRowCount(isMobileViewport);
      const initialBufferCount = retainHistory
        ? adaptiveDuetStream
          ? adaptiveDuetCandidateMeasureCount(initialRows) *
            getDuetMaximumEventsPerMeasure(duetLevel)
          : pageNoteCount * initialRows
        : STAFF_PAGE_SIZE;
      if (mode !== "fixed-count") {
        return initialBufferCount;
      }
      return Math.min(initialBufferCount, Math.max(0, fixedCount - nextCompletedCount));
    },
    [
      adaptiveMaxMeasuresPerRow,
      adaptiveMeasureAreaWidthPx,
      duetLevel,
      fixedCount,
      isMobileViewport,
      mode,
      pageNoteCount,
      retainHistory,
    ]
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

  const markCurrentStaffPageStaffNoteComplete = useCallback(
    (staff: Staff): void => {
      const page = staffPageRef.current;
      if (!page) return;
      const completedStaffNoteIndices = {
        ...page.completedStaffNoteIndices,
        [staff]: [...new Set([...(page.completedStaffNoteIndices?.[staff] ?? []), page.index])],
      };
      syncStaffPage({ ...page, completedStaffNoteIndices });
    },
    [staffPageRef, syncStaffPage]
  );

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
      startPrompt(nextPage.notes[index]!, duetTargetsForGroup(nextPage.noteGroups?.[index]));
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
      const adaptiveDuetStream =
        duetLevel !== undefined &&
        retainHistory &&
        adaptiveMeasureAreaWidthPx !== undefined &&
        adaptiveMaxMeasuresPerRow !== undefined;
      const duetMeasureCount = duetLevel
        ? getDuetInitialMeasureCount(
            duetLevel,
            isMobileViewport,
            adaptiveDuetStream ? adaptiveMeasureAreaWidthPx : undefined,
            adaptiveDuetStream ? adaptiveMaxMeasuresPerRow : undefined
          )
        : undefined;
      const duetExactCount = mode === "fixed-count" && fixedCount - nextCompletedCount <= count;
      const duetRequestedCount =
        adaptiveDuetStream && duetLevel && duetMeasureCount
          ? duetExactCount
            ? count
            : Math.max(count, duetMeasureCount * getDuetMaximumEventsPerMeasure(duetLevel))
          : count;
      const generatedDuetPage = duetLevel
        ? createDuetPracticePage(sourceNotes, duetLevel, duetRequestedCount, {
            allowDottedRhythms,
            exactCount: duetExactCount,
            measureCount: duetMeasureCount,
            seed: sessionRef.current?.id,
          })
        : undefined;
      const duetPage =
        generatedDuetPage &&
        adaptiveDuetStream &&
        adaptiveMeasureAreaWidthPx !== undefined &&
        adaptiveMaxMeasuresPerRow !== undefined
          ? trimDuetPageToAdaptiveRows(
              generatedDuetPage,
              initialStaffPageBufferRowCount(isMobileViewport),
              adaptiveMeasureAreaWidthPx,
              adaptiveMaxMeasuresPerRow
            )
          : generatedDuetPage;
      const generatedNotes = duetLevel
        ? []
        : sourceQueueStrategy !== "melody" && !isSplitStaffRange
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
      const selectedNotes = duetLevel
        ? []
        : addOccasionalRangeNotes(generatedNotes, rangeExtensionNotes);
      const noteGroups = duetPage?.noteGroups;
      const notes = duetPage?.notes ?? selectedNotes;
      const rhythm =
        duetPage?.rhythm ??
        (forceRhythmGeneration || promptNoteDurations.length > 1
          ? generateStaffPageRhythm(promptNoteDurations, notes.length)
          : undefined);
      const measureRowStartIndices = rhythm
        ? getDuetMeasureRowStartIndices(
            notes,
            rhythm.measures,
            isMobileViewport,
            adaptiveMeasureAreaWidthPx,
            adaptiveMaxMeasuresPerRow,
            rhythm.onsets
          )
        : undefined;
      const page = {
        notes,
        ...(noteGroups ? { noteGroups } : {}),
        completedStaffNoteIndices: {},
        index: 0,
        completedCount: 0,
        ...(rhythm ? { rhythm } : {}),
        ...(measureRowStartIndices ? { measureRowStartIndices } : {}),
      };
      syncStaffPage(page);
      startPrompt(notes[0]!, duetTargetsForGroup(noteGroups?.[0]));
    },
    [
      adaptiveSchedulerRef,
      adaptiveMeasureAreaWidthPx,
      adaptiveMaxMeasuresPerRow,
      allowDottedRhythms,
      duetLevel,
      fixedCount,
      forceRhythmGeneration,
      getNextStaffPageCount,
      isMobileViewport,
      lastTargetNoteIdRef,
      melodyGenerationStateRef,
      mode,
      promptNoteDurations,
      rangeExtensionNotes,
      retainHistory,
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
      const measureRowStartIndices = duetLevel
        ? page.rhythm
          ? getDuetMeasureRowStartIndices(
              page.notes,
              page.rhythm.measures,
              isMobileViewport,
              adaptiveMeasureAreaWidthPx,
              adaptiveMaxMeasuresPerRow,
              page.rhythm.onsets
            )
          : undefined
        : undefined;
      const currentRowIndex = measureRowStartIndices
        ? getStaffPageRowIndex(measureRowStartIndices, page.index)
        : -1;
      const nextRowIndex = measureRowStartIndices
        ? getStaffPageRowIndex(measureRowStartIndices, nextIndex)
        : -1;
      const isDuetRowBoundary = Boolean(
        measureRowStartIndices &&
        nextIndex > page.index &&
        nextIndex < page.notes.length &&
        nextRowIndex > currentRowIndex &&
        measureRowStartIndices[nextRowIndex] === nextIndex
      );
      const currentRowStart = measureRowStartIndices?.[currentRowIndex] ?? page.index;
      const scrollAdvanceCount =
        duetLevel && isDuetRowBoundary ? nextIndex - currentRowStart : pageNoteCount;
      let nextRowCount = getStaffPageRefillCount({
        completedSessionCount: nextCompletedCount,
        fixedSessionCount: mode === "fixed-count" ? fixedCount : undefined,
        nextIndex,
        pageNoteCount,
        plannedNoteCount: page.notes.length,
        refillNoteCount: retainHistory ? pageNoteCount : undefined,
      });
      let hasNextPageOnDesktop =
        !isMobileViewport &&
        nextIndex > page.index &&
        nextIndex % pageNoteCount === 0 &&
        nextIndex < page.notes.length;
      if (duetLevel && measureRowStartIndices) {
        nextRowCount = 0;
        hasNextPageOnDesktop = !isMobileViewport && isDuetRowBoundary;
        if (
          retainHistory &&
          isDuetRowBoundary &&
          nextRowIndex === measureRowStartIndices.length - 1
        ) {
          const lastRowStart = measureRowStartIndices[nextRowIndex]!;
          const nextRowStart = measureRowStartIndices[nextRowIndex + 1] ?? page.notes.length;
          const lastRowEventCount = nextRowStart - lastRowStart;
          const adaptiveDuetStream =
            adaptiveMeasureAreaWidthPx !== undefined && adaptiveMaxMeasuresPerRow !== undefined;
          const adaptiveRowEventCount = adaptiveDuetStream
            ? getDuetMeasureCountForRows(
                duetLevel,
                isMobileViewport,
                1,
                adaptiveMeasureAreaWidthPx,
                adaptiveMaxMeasuresPerRow
              ) * getDuetMaximumEventsPerMeasure(duetLevel)
            : lastRowEventCount;
          const availableFutureCount =
            mode === "fixed-count"
              ? Math.max(0, fixedCount - nextCompletedCount - remainingVisibleNotes.length)
              : adaptiveRowEventCount;
          nextRowCount = Math.min(adaptiveRowEventCount, availableFutureCount);
        }
      }
      if (nextRowCount === 0 && !hasNextPageOnDesktop) {
        return false;
      }

      let nextNotes = page.notes;
      let nextNoteGroups = page.noteGroups;
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
        const adaptiveDuetStream =
          duetLevel !== undefined &&
          adaptiveMeasureAreaWidthPx !== undefined &&
          adaptiveMaxMeasuresPerRow !== undefined;
        const duetAppendMeasureCount = adaptiveDuetStream
          ? adaptiveDuetCandidateMeasureCount(1)
          : duetLevel
            ? getDuetMeasureCountForRows(duetLevel, isMobileViewport, 1)
            : undefined;
        const duetAppendExactCount =
          mode === "fixed-count" &&
          fixedCount - nextCompletedCount <= remainingVisibleNotes.length + nextRowCount;
        const duetAppendRequestedCount =
          adaptiveDuetStream && duetLevel && duetAppendMeasureCount
            ? duetAppendExactCount
              ? nextRowCount
              : Math.max(
                  nextRowCount,
                  duetAppendMeasureCount * getDuetMaximumEventsPerMeasure(duetLevel)
                )
            : nextRowCount;
        const generatedDuetAppend = duetLevel
          ? createDuetPracticePage(enabledNotes, duetLevel, duetAppendRequestedCount, {
              allowDottedRhythms,
              startBeat: page.rhythm?.endBeat ?? 0,
              measureCount: duetAppendMeasureCount,
              exactCount: duetAppendExactCount,
              seed: sessionRef.current?.id,
            })
          : undefined;
        const duetAppend =
          generatedDuetAppend &&
          adaptiveDuetStream &&
          adaptiveMeasureAreaWidthPx !== undefined &&
          adaptiveMaxMeasuresPerRow !== undefined
            ? trimDuetPageToAdaptiveRows(
                generatedDuetAppend,
                1,
                adaptiveMeasureAreaWidthPx,
                adaptiveMaxMeasuresPerRow
              )
            : generatedDuetAppend;
        const nextRow = duetLevel
          ? []
          : !isSplitStaffRange && queueStrategy !== "melody"
            ? (adaptiveSchedulerRef.current?.selectPage(nextRowCount, {
                lastTargetNoteId: pageSelectionOptions.lastTargetNoteId,
                plannedTargetNoteIds: pageSelectionOptions.plannedTargetNoteIds,
              }) ?? selectNotePage(pageSelectionOptions))
            : selectNotePage(pageSelectionOptions);
        const selectedAppendedNotes = duetLevel
          ? []
          : addOccasionalRangeNotes(nextRow, rangeExtensionNotes);
        const appendedGroups = duetAppend?.noteGroups;
        const appendedNotes = duetAppend?.notes ?? selectedAppendedNotes;
        nextNotes = [...page.notes, ...appendedNotes];
        if (appendedGroups) {
          nextNoteGroups = [...(page.noteGroups ?? []), ...appendedGroups];
        }
        if (page.rhythm) {
          const appendedRhythm =
            duetAppend?.rhythm ??
            generateStaffPageRhythm(promptNoteDurations, appendedNotes.length, page.rhythm.endBeat);
          nextRhythm = {
            durations: [...page.rhythm.durations, ...appendedRhythm.durations],
            endBeat: appendedRhythm.endBeat,
            measures: [...page.rhythm.measures, ...appendedRhythm.measures],
            noteBeamGroups: [...page.rhythm.noteBeamGroups, ...appendedRhythm.noteBeamGroups],
            onsets: [...page.rhythm.onsets, ...appendedRhythm.onsets],
            ...(page.rhythm.staffNoteDurations || appendedRhythm.staffNoteDurations
              ? {
                  staffNoteDurations: [
                    ...(page.rhythm.staffNoteDurations ?? []),
                    ...(appendedRhythm.staffNoteDurations ?? []),
                  ],
                }
              : {}),
          };
        }
      }
      const nextMeasureRowStartIndices =
        duetLevel && nextRhythm
          ? getDuetMeasureRowStartIndices(
              nextNotes,
              nextRhythm.measures,
              isMobileViewport,
              adaptiveMeasureAreaWidthPx,
              adaptiveMaxMeasuresPerRow,
              nextRhythm.onsets
            )
          : undefined;
      const sessionId = sessionRef.current?.id;
      syncStaffPage({
        ...page,
        index: nextIndex,
        notes: nextNotes,
        ...(nextNoteGroups ? { noteGroups: nextNoteGroups } : {}),
        ...(nextRhythm ? { rhythm: nextRhythm } : {}),
        ...(nextMeasureRowStartIndices
          ? { measureRowStartIndices: nextMeasureRowStartIndices }
          : {}),
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
            startPrompt(
              nextNote,
              duetTargetsForGroup(scrolledPage.noteGroups?.[scrolledPage.index])
            );
          };
          if (isPausedRef.current) {
            pendingAfterPauseRef.current = startNextPrompt;
            return;
          }
          startNextPrompt();
          return;
        }
        if (!scrolledPage || scrolledPage.notes.length <= scrollAdvanceCount) {
          setIsStaffPageScrolling(false);
          return;
        }
        const rebasedPage = {
          notes: scrolledPage.notes.slice(scrollAdvanceCount),
          ...(scrolledPage.noteGroups
            ? {
                noteGroups: scrolledPage.noteGroups.slice(scrollAdvanceCount),
              }
            : {}),
          ...(scrolledPage.completedStaffNoteIndices
            ? {
                completedStaffNoteIndices: Object.fromEntries(
                  Object.entries(scrolledPage.completedStaffNoteIndices).map(([staff, indices]) => [
                    staff,
                    indices!
                      .map((index) => index - scrollAdvanceCount)
                      .filter((index) => index >= 0),
                  ])
                ) as PracticeStaffPageRuntime["completedStaffNoteIndices"],
              }
            : {}),
          index: scrolledPage.index - scrollAdvanceCount,
          completedCount: scrolledPage.completedCount - scrollAdvanceCount,
          ...(scrolledPage.rhythm
            ? {
                rhythm: {
                  ...scrolledPage.rhythm,
                  durations: scrolledPage.rhythm.durations.slice(scrollAdvanceCount),
                  measures: scrolledPage.rhythm.measures.slice(scrollAdvanceCount),
                  noteBeamGroups: scrolledPage.rhythm.noteBeamGroups.slice(scrollAdvanceCount),
                  onsets: scrolledPage.rhythm.onsets.slice(scrollAdvanceCount),
                  ...(scrolledPage.rhythm.staffNoteDurations
                    ? {
                        staffNoteDurations:
                          scrolledPage.rhythm.staffNoteDurations.slice(scrollAdvanceCount),
                      }
                    : {}),
                },
              }
            : {}),
          ...(scrolledPage.rhythm
            ? {
                measureRowStartIndices: getDuetMeasureRowStartIndices(
                  scrolledPage.notes.slice(scrollAdvanceCount),
                  scrolledPage.rhythm.measures.slice(scrollAdvanceCount),
                  isMobileViewport,
                  adaptiveMeasureAreaWidthPx,
                  adaptiveMaxMeasuresPerRow,
                  scrolledPage.rhythm.onsets.slice(scrollAdvanceCount)
                ),
              }
            : {}),
        };
        setStaffPageFirstNoteOffset((offset) => offset + scrollAdvanceCount);
        syncStaffPage(rebasedPage);
        setIsStaffPageScrolling(false);
        const startNextPrompt = (): void => {
          resumeActiveTimers();
          startPrompt(
            rebasedPage.notes[rebasedPage.index]!,
            duetTargetsForGroup(rebasedPage.noteGroups?.[rebasedPage.index])
          );
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
      duetLevel,
      allowDottedRhythms,
      fixedCount,
      isMobileViewport,
      adaptiveMeasureAreaWidthPx,
      adaptiveMaxMeasuresPerRow,
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
    markCurrentStaffPageStaffNoteComplete,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
    syncStaffPage,
  };
}
