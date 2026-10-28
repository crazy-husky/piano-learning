import { Pause, Play, Settings2, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPianoAudioTime } from "../../../audio/piano";
import type {
  StaffDistanceInputMethod,
  PitchId,
  PracticeMode,
  PracticeSessionRecord,
  PromptNoteDuration,
  Staff,
  StaffDistanceTrainingMode,
  StaffDistancePracticeSettings,
  StaffNotationMode,
  TargetNote,
} from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import { isPracticeAnswerCorrect } from "../../../domain/answerInput";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { MAX_PRACTICE_QUESTIONS } from "../../../domain/practiceLimits";
import {
  answerDeviceInfo,
  answerInputMode,
  currentMicrophoneContext,
} from "../../../data/answerEvents";
import { saveAnswerEvents } from "../../../data/db";
import type { AnswerAttempt } from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import type { PracticeMicrophoneStatus } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import { isNaturalPianoKey } from "../../../shared/components/pianoKeyNames";
import {
  createStaffDistanceSequence,
  summarizeStaffDistancePair,
} from "../../../domain/staffDistancePractice";
import { appendStaffDistanceRhythm, createStaffDistanceRhythm } from "../logic/staffDistanceRhythm";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { ReturnToCurrentNoteButton } from "./ReturnToCurrentNoteButton";
import {
  DESKTOP_STAFF_PAGE_NOTE_COUNT,
  MOBILE_STAFF_PAGE_NOTE_COUNT,
} from "../logic/staffPageFlow";
import { MOBILE_PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import { estimateStaffGameSystemDelayMs } from "../../staff-game/logic/staffGameProficiency";
import { practiceMicrophoneDebugParametersForSensitivityLevel } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { LoadingActivityText } from "../../../shared/components/LoadingActivity";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { uniformFreePracticeChaseSegmentDuration, type ScoreChaseEvent } from "../logic/scoreChase";
import { useScoreChase } from "../hooks/useScoreChase";
import {
  PracticeChaseSettingsDialog,
  type PracticeChaseSettings,
} from "./PracticeChaseSettingsDialog";
import { PracticeQuestionLimitDialog } from "../../../shared/components/PracticeQuestionLimitDialog";

interface PracticeNavigationExitRequest {
  id: number;
  returnToSetup?: boolean;
  targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome";
}

interface StaffDistanceRunProps {
  chaseSettings: PracticeChaseSettings;
  fixedCount: number;
  fixedDurationSeconds: number;
  inputMethod: StaffDistanceInputMethod;
  mode: PracticeMode;
  noteDurations: readonly PromptNoteDuration[];
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  notes: TargetNote[];
  onFinish: (session: PracticeSessionRecord, showSummary: boolean) => Promise<void>;
  onSaveChaseSettings: (settings: PracticeChaseSettings) => void;
  onNavigationExit?: (targetView: PracticeNavigationExitRequest["targetView"]) => void;
  onRunningChange: (running: boolean) => void;
  onMicrophoneAnswerHandlerChange: (
    handler: ((answer: PracticeAnswerInput) => void) | null
  ) => void;
  midi: MidiInputController;
  microphone: StaffDistanceMicrophoneInput;
  session: PracticeSessionRecord;
  settings: StaffDistancePracticeSettings;
  staffNotationMode: StaffNotationMode;
  trainingMode: StaffDistanceTrainingMode;
  useLedgerGap: boolean;
}

const WRONG_FEEDBACK_DURATION_MS = 450;

export interface StaffDistanceMicrophoneInput {
  error: string | null;
  isListening: boolean;
  isPreparingSwiftF0?: boolean;
  recoveryReloadAvailable?: boolean;
  reloadAfterRecoveryFailure?: () => Promise<void>;
  start: (options?: { includeAccidentals?: boolean }) => Promise<boolean>;
  status: PracticeMicrophoneStatus;
  stop: () => void;
}

function durationLabel(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}

function intervalCountForRun(
  mode: PracticeMode,
  fixedCount: number,
  durationSeconds: number
): number {
  if (mode === "fixed-count") return fixedCount;
  if (mode === "fixed-duration") return Math.max(32, Math.ceil(durationSeconds * 4) + 8);
  return 30_000;
}

interface StaffDistanceScorePage {
  endIndex: number;
  startIndex: number;
}

const DISTANCE_SCORE_MIN_NOTE_GAP_PX = 39;
const DISTANCE_SCORE_BEAT_WIDTH_PX = 58;
const DISTANCE_SCORE_BARLINE_GAP_PX = 12;
const DISTANCE_SCORE_FIXED_WIDTH_RESERVE_PX = 220;
const GRAND_STAFF_SEGMENT_TRANSITIONS = 6;
const EMPTY_EXTRA_PITCH_IDS: readonly PitchId[] = [];

interface StaffDistanceRunSequence {
  breakIndices: number[];
  notes: TargetNote[];
}

function getRecentStaffNoteHistories(
  notes: readonly TargetNote[],
  breakIndices: readonly number[]
): Partial<Record<TargetNote["staff"], TargetNote[]>> {
  const histories: Partial<Record<TargetNote["staff"], TargetNote[]>> = {};
  let segmentStart = 0;
  const boundaries = [...breakIndices].sort((left, right) => left - right);
  for (const boundary of [...boundaries, notes.length - 1]) {
    const segment = notes.slice(segmentStart, boundary + 1);
    const staff = segment[0]?.staff;
    if (staff && segment.every((note) => note.staff === staff)) {
      histories[staff] = segment.slice(-7);
    }
    segmentStart = boundary + 1;
  }
  return histories;
}

function createStaffDistanceRunSequence(
  notes: readonly TargetNote[],
  settings: StaffDistancePracticeSettings,
  transitionCount: number,
  staffNotationMode: StaffNotationMode,
  random: () => number = Math.random,
  initialNote?: TargetNote,
  extraPitchIds: readonly PitchId[] = [],
  recentNotesByStaff: Partial<Record<TargetNote["staff"], readonly TargetNote[]>> = {}
): StaffDistanceRunSequence {
  const createSingleStaffSequence = (): StaffDistanceRunSequence => ({
    breakIndices: [],
    notes: createStaffDistanceSequence(
      notes,
      settings,
      transitionCount,
      random,
      initialNote,
      extraPitchIds,
      recentNotesByStaff[initialNote?.staff ?? notes[0]?.staff ?? "treble"]
    ),
  });
  if (staffNotationMode !== "grand" || transitionCount <= 0) {
    return createSingleStaffSequence();
  }

  const sequences = {
    bass: createStaffDistanceSequence(
      notes.filter((note) => note.staff === "bass"),
      settings,
      transitionCount,
      random,
      initialNote?.staff === "bass" ? initialNote : undefined,
      extraPitchIds,
      recentNotesByStaff.bass
    ),
    treble: createStaffDistanceSequence(
      notes.filter((note) => note.staff === "treble"),
      settings,
      transitionCount,
      random,
      initialNote?.staff === "treble" ? initialNote : undefined,
      extraPitchIds,
      recentNotesByStaff.treble
    ),
  };
  if (sequences.treble.length < 2 || sequences.bass.length < 2) {
    return createSingleStaffSequence();
  }

  const cursors = { bass: 0, treble: 0 };
  const result: StaffDistanceRunSequence = { breakIndices: [], notes: [] };
  let staff: TargetNote["staff"] = initialNote?.staff ?? (random() < 0.5 ? "treble" : "bass");
  let generatedTransitions = 0;
  while (generatedTransitions < transitionCount) {
    const source = sequences[staff];
    const cursor = cursors[staff];
    const transitions = Math.min(
      GRAND_STAFF_SEGMENT_TRANSITIONS,
      transitionCount - generatedTransitions,
      source.length - cursor - 1
    );
    if (transitions <= 0) break;

    const segment = source.slice(cursor, cursor + transitions + 1);
    if (result.notes.length === 0) {
      result.notes.push(...segment);
    } else {
      // The staff handoff is visible in the score but is not a distance question.
      result.breakIndices.push(result.notes.length - 1);
      result.notes.push(...segment);
    }
    cursors[staff] += transitions;
    generatedTransitions += transitions;
    staff = staff === "treble" ? "bass" : "treble";
  }

  return generatedTransitions === transitionCount ? result : createSingleStaffSequence();
}

function limitStaffDistanceRunSequence(
  sequence: StaffDistanceRunSequence,
  maxNoteCount: number
): StaffDistanceRunSequence {
  if (sequence.notes.length <= maxNoteCount) return sequence;
  return {
    breakIndices: sequence.breakIndices.filter((index) => index < maxNoteCount - 1),
    notes: sequence.notes.slice(0, maxNoteCount),
  };
}

function createStaffDistanceScorePages(
  onsets: readonly number[],
  measures: readonly number[],
  scoreWidth: number
): StaffDistanceScorePage[] {
  if (onsets.length === 0) return [];
  if (onsets.length === 1) return [{ endIndex: 1, startIndex: 0 }];

  const usableWidth = Math.max(
    DISTANCE_SCORE_MIN_NOTE_GAP_PX,
    scoreWidth - DISTANCE_SCORE_FIXED_WIDTH_RESERVE_PX
  );
  const pages: StaffDistanceScorePage[] = [];
  let startIndex = 0;

  while (startIndex < onsets.length - 1) {
    let endIndex = startIndex + 1;
    let usedWidth = 0;
    while (endIndex < onsets.length) {
      const beatGap = Math.max(0, onsets[endIndex]! - onsets[endIndex - 1]!);
      const barlineGap =
        measures[endIndex] !== measures[endIndex - 1] ? DISTANCE_SCORE_BARLINE_GAP_PX : 0;
      const noteGap =
        Math.max(DISTANCE_SCORE_MIN_NOTE_GAP_PX, beatGap * DISTANCE_SCORE_BEAT_WIDTH_PX) +
        barlineGap;
      if (endIndex > startIndex && usedWidth + noteGap > usableWidth) break;
      usedWidth += noteGap;
      endIndex += 1;
    }

    if (endIndex === startIndex + 1 && endIndex < onsets.length) endIndex += 1;
    pages.push({ endIndex, startIndex });
    if (endIndex >= onsets.length) break;
    // Repeat the previous page's last note to keep the boundary interval visible.
    startIndex = endIndex - 1;
  }

  return pages;
}

export function StaffDistanceRun({
  chaseSettings,
  fixedCount,
  fixedDurationSeconds,
  inputMethod,
  mode,
  noteDurations,
  navigationExitRequest,
  notes,
  onFinish,
  onSaveChaseSettings,
  onNavigationExit,
  onRunningChange,
  onMicrophoneAnswerHandlerChange,
  midi,
  microphone,
  session,
  settings,
  staffNotationMode,
  trainingMode,
  useLedgerGap,
}: StaffDistanceRunProps): JSX.Element {
  const [isChaseSettingsOpen, setIsChaseSettingsOpen] = useState(false);
  const subscribeMidi = midi.subscribe;
  const extraPitchIds = session.staffDistance?.crossGroupPitchIds ?? EMPTY_EXTRA_PITCH_IDS;
  const initialScoreNotesPerRow =
    typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches
      ? MOBILE_STAFF_PAGE_NOTE_COUNT
      : DESKTOP_STAFF_PAGE_NOTE_COUNT;
  const initialScoreNoteCapacity = initialScoreNotesPerRow * 2;
  const [initialSequence] = useState(() => {
    const transitionCount = Math.min(
      trainingMode === "play" ? initialScoreNoteCapacity - 1 : 128,
      intervalCountForRun(mode, fixedCount, fixedDurationSeconds)
    );
    const generatedSequence = createStaffDistanceRunSequence(
      notes,
      settings,
      transitionCount,
      staffNotationMode,
      Math.random,
      undefined,
      extraPitchIds
    );
    return trainingMode === "play"
      ? limitStaffDistanceRunSequence(generatedSequence, initialScoreNoteCapacity)
      : generatedSequence;
  });
  const [sequence, setSequence] = useState(initialSequence.notes);
  const sequenceRef = useRef(sequence);
  const [sequenceRhythm, setSequenceRhythm] = useState(() =>
    createStaffDistanceRhythm(noteDurations, sequence.length)
  );
  const sequenceRhythmRef = useRef(sequenceRhythm);
  const breakIndicesRef = useRef(new Set(initialSequence.breakIndices));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [completedNoteIndices, setCompletedNoteIndices] = useState<number[]>([]);
  const [hasPlayedStartingNote, setHasPlayedStartingNote] = useState(() => trainingMode !== "play");
  const hasPlayedStartingNoteRef = useRef(trainingMode !== "play");
  const [startingNoteWrong, setStartingNoteWrong] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "wrong" } | { type: "correct"; distance: number } | null
  >(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isQuestionLimitReached, setIsQuestionLimitReached] = useState(false);
  useEffect(() => {
    if (isPaused) setIsChaseSettingsOpen(false);
  }, [isPaused]);
  const chaseEvents = useMemo<ScoreChaseEvent[]>(
    () =>
      sequence.map((note, eventIndex) => ({
        eventIndex,
        beatPosition: eventIndex,
        staves: [note.staff],
      })),
    [sequence]
  );
  const chaseStaves = useMemo<readonly Staff[]>(() => {
    if (staffNotationMode === "bass-only") return ["bass"];
    if (staffNotationMode === "treble-only") return ["treble"];
    if (chaseSettings.handMode === "left") return ["bass"];
    if (chaseSettings.handMode === "right") return ["treble"];
    return ["treble", "bass"];
  }, [chaseSettings.handMode, staffNotationMode]);
  const { cursor: chaseCursor, recordCorrectTarget: recordChaseTarget } = useScoreChase({
    activeStaves: chaseStaves,
    enabled: trainingMode === "play" && chaseSettings.enabled,
    events: chaseEvents,
    getAudioTime: getPianoAudioTime,
    paused: isPaused || trainingMode !== "play",
    segmentDurationSeconds: uniformFreePracticeChaseSegmentDuration,
    speedMultiplier: chaseSettings.speedMultiplier,
    startCount: chaseSettings.startCount,
    tempoBpm: 120,
  });
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches
  );
  const [isTouchDevice, setIsTouchDevice] = useState(
    () =>
      typeof window !== "undefined" &&
      (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches)
  );
  const scoreWrapRef = useRef<HTMLDivElement | null>(null);
  const [scoreWidth, setScoreWidth] = useState(0);
  const [trackedScoreVisibility, setTrackedScoreVisibility] = useState<{
    questionIndex: number;
    visible: boolean;
  } | null>(null);
  const resultsRef = useRef(session.staffDistance?.questionResults ?? []);
  const firstResponseRef = useRef<{ correct: boolean; responseMs: number } | null>(null);
  const questionAttemptsRef = useRef<AnswerAttempt[]>([]);
  const wrongAttemptsRef = useRef(0);
  const usedHintRef = useRef(false);
  const pendingAdvanceRef = useRef<(() => void) | null>(null);
  const isPausedRef = useRef(false);
  const activeStartedAtRef = useRef(performance.now());
  const activeElapsedRef = useRef(0);
  const questionStartedAtRef = useRef(performance.now());
  const questionElapsedRef = useRef(0);
  const advanceTimerRef = useRef<number | undefined>();
  const wrongFeedbackTimerRef = useRef<number | undefined>();
  const endingRef = useRef(false);
  const questionLimitReachedRef = useRef(false);
  const handledExitRequestRef = useRef<number | null>(null);
  const finishRef = useRef<
    (reason: PracticeSessionRecord["endReason"], showSummary: boolean) => Promise<void>
  >(async () => undefined);
  const details = session.staffDistance!;
  const measuredScoreWidth = scoreWidth || (isMobile ? 360 : 980);
  const scorePages = useMemo(
    () =>
      trainingMode === "play"
        ? [{ endIndex: sequenceRhythm.onsets.length, startIndex: 0 }]
        : createStaffDistanceScorePages(
            sequenceRhythm.onsets,
            sequenceRhythm.measures,
            measuredScoreWidth
          ),
    [measuredScoreWidth, sequenceRhythm.measures, sequenceRhythm.onsets, trainingMode]
  );
  const activeScorePage =
    scorePages.find(
      (page) => questionIndex >= page.startIndex && questionIndex < page.endIndex - 1
    ) ?? scorePages[scorePages.length - 1]!;
  const pageStartIndex = activeScorePage.startIndex;
  const pageEndIndex = activeScorePage.endIndex;
  const notesOnPage = sequence.slice(pageStartIndex, pageEndIndex);
  const completedNoteIndicesOnPage = completedNoteIndices
    .filter((noteIndex) => noteIndex >= pageStartIndex && noteIndex < pageEndIndex)
    .map((noteIndex) => noteIndex - pageStartIndex);
  const pageSize = notesOnPage.length;
  const pageOnsets = sequenceRhythm.onsets
    .slice(pageStartIndex, pageEndIndex)
    .map((onset) => onset - (sequenceRhythm.onsets[pageStartIndex] ?? 0));
  const pageMeasures = sequenceRhythm.measures.slice(pageStartIndex, pageEndIndex);
  const pageBeamGroupIds = sequenceRhythm.beamGroupIds.slice(pageStartIndex, pageEndIndex);
  const isContinuousScore = trainingMode === "play";
  const scoreStartIndex = isContinuousScore ? 0 : pageStartIndex;
  const scoreNotes = isContinuousScore ? sequence : notesOnPage;
  const scoreDurations = isContinuousScore
    ? sequenceRhythm.durations
    : sequenceRhythm.durations.slice(pageStartIndex, pageEndIndex);
  const scoreMeasures = isContinuousScore ? sequenceRhythm.measures : pageMeasures;
  const scoreOnsets = isContinuousScore ? sequenceRhythm.onsets : pageOnsets;
  const scoreBeamGroupIds = isContinuousScore ? sequenceRhythm.beamGroupIds : pageBeamGroupIds;
  const scoreCompletedNoteIndices = isContinuousScore
    ? completedNoteIndices
    : completedNoteIndicesOnPage;
  const scoreNotesPerRow = isContinuousScore
    ? isMobile
      ? MOBILE_STAFF_PAGE_NOTE_COUNT
      : DESKTOP_STAFF_PAGE_NOTE_COUNT
    : pageSize;
  const scoreRowCount = Math.max(1, Math.ceil(scoreNotes.length / scoreNotesPerRow));
  const trackedScoreNoteIndex =
    isContinuousScore && trainingMode === "play"
      ? hasPlayedStartingNote
        ? questionIndex + 1
        : 0
      : undefined;
  const followScoreRowIndex =
    trackedScoreNoteIndex === undefined
      ? undefined
      : Math.floor(trackedScoreNoteIndex / scoreNotesPerRow);
  const pageBarlineAfterNoteIndices = useMemo(
    () =>
      Array.from(
        new Set([
          ...scoreMeasures.flatMap((measure, index) =>
            index < scoreMeasures.length - 1 && scoreMeasures[index + 1] !== measure ? [index] : []
          ),
          ...Array.from({ length: Math.max(0, scoreNotes.length - 1) }, (_, index) => index).filter(
            (index) => breakIndicesRef.current.has(scoreStartIndex + index)
          ),
        ])
      ),
    [scoreMeasures, scoreNotes, scoreStartIndex]
  );
  const activePairStartIndex = questionIndex - scoreStartIndex;
  const currentFrom = sequence[questionIndex];
  const currentTo = sequence[questionIndex + 1];
  const returnNoteIndex = trackedScoreNoteIndex ?? activePairStartIndex;
  const handleTrackedScoreVisibilityChange = useCallback(
    (visible: boolean): void => {
      setTrackedScoreVisibility({ questionIndex, visible });
    },
    [questionIndex]
  );
  const getCurrentScoreNoteTarget = useCallback((): SVGElement | null => {
    const note = scoreWrapRef.current?.querySelector<SVGElement>(
      `[data-staff-page-note-index="${returnNoteIndex}"]`
    );
    const rowIndex = Math.floor(returnNoteIndex / scoreNotesPerRow);
    const row = scoreWrapRef.current?.querySelector<SVGElement>(
      `[data-staff-row-index="${rowIndex}"]`
    );
    return note ?? row ?? null;
  }, [returnNoteIndex, scoreNotesPerRow]);
  const isCurrentScoreNoteVisible =
    trackedScoreVisibility?.questionIndex !== questionIndex || trackedScoreVisibility.visible;
  const answerOptions = Array.from({ length: details.maxDistance + 1 }, (_, index) => index).filter(
    (distance) => distance > 0 || details.includeUnison
  );
  const firstAnswerRowCount =
    answerOptions.length <= 3
      ? answerOptions.length
      : answerOptions.length === 4
        ? 2
        : Math.min(4, Math.ceil(answerOptions.length / 2));
  const answerRows =
    answerOptions.length > firstAnswerRowCount
      ? [answerOptions.slice(0, firstAnswerRowCount), answerOptions.slice(firstAnswerRowCount)]
      : [answerOptions];
  const [activeElapsed, setActiveElapsed] = useState(0);
  const remainingTime =
    mode === "fixed-duration"
      ? Math.max(0, fixedDurationSeconds * 1000 - activeElapsed)
      : undefined;

  const getActiveElapsed = useCallback((): number => {
    const activeNow = activeStartedAtRef.current;
    return activeElapsedRef.current + (activeNow === 0 ? 0 : performance.now() - activeNow);
  }, []);

  const finish = useCallback(
    async (endReason: PracticeSessionRecord["endReason"], showSummary: boolean): Promise<void> => {
      if (endingRef.current) return;
      endingRef.current = true;
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = undefined;
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
        wrongFeedbackTimerRef.current = undefined;
      }
      pendingAdvanceRef.current = null;
      const activeNow = activeStartedAtRef.current;
      const finalActiveMs =
        activeElapsedRef.current + (activeNow === 0 ? 0 : performance.now() - activeNow);
      activeStartedAtRef.current = 0;
      isPausedRef.current = true;
      if (trainingMode === "play" && inputMethod === "microphone") microphone.stop();
      const questionResults = resultsRef.current;
      onRunningChange(false);
      await onFinish(
        {
          ...session,
          activePracticeMs: finalActiveMs,
          endedAt: new Date().toISOString(),
          endReason,
          completedCount: questionResults.length,
          interruptedCount: questionResults.filter((result) => !result.firstTryCorrect).length,
          staffDistance: { ...details, questionResults },
        },
        showSummary
      );
    },
    [details, inputMethod, microphone, onFinish, onRunningChange, session, trainingMode]
  );
  finishRef.current = finish;

  const pauseAtQuestionLimit = useCallback((): void => {
    if (questionLimitReachedRef.current) return;
    questionLimitReachedRef.current = true;
    setIsQuestionLimitReached(true);
    if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
    if (wrongFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(wrongFeedbackTimerRef.current);
    }
    advanceTimerRef.current = undefined;
    wrongFeedbackTimerRef.current = undefined;
    pendingAdvanceRef.current = null;
    const now = performance.now();
    if (activeStartedAtRef.current !== 0) {
      activeElapsedRef.current += Math.max(0, now - activeStartedAtRef.current);
      activeStartedAtRef.current = 0;
    }
    if (questionStartedAtRef.current !== 0) {
      questionElapsedRef.current += Math.max(0, now - questionStartedAtRef.current);
      questionStartedAtRef.current = 0;
    }
    isPausedRef.current = true;
    setIsPaused(true);
    if (trainingMode === "play" && inputMethod === "microphone") microphone.stop();
    onRunningChange(false);
  }, [inputMethod, microphone, onRunningChange, trainingMode]);

  const advanceQuestion = useCallback(
    (requestedNextIndex: number): void => {
      let nextIndex = requestedNextIndex;
      while (breakIndicesRef.current.has(nextIndex)) nextIndex += 1;
      const extensionChunkSize = trainingMode === "play" ? scoreNotesPerRow : 128;
      const extensionBuffer =
        trainingMode === "play"
          ? Math.max(2, scoreNotesPerRow)
          : Math.min(32, Math.max(2, Math.ceil(sequenceRef.current.length / 3)));
      if (nextIndex >= sequenceRef.current.length - extensionBuffer) {
        const lastNote = sequenceRef.current[sequenceRef.current.length - 1];
        if (lastNote) {
          const generatedExtension = createStaffDistanceRunSequence(
            notes,
            settings,
            extensionChunkSize,
            staffNotationMode,
            Math.random,
            lastNote,
            extraPitchIds,
            getRecentStaffNoteHistories(sequenceRef.current, [...breakIndicesRef.current])
          );
          const extension =
            trainingMode === "play"
              ? limitStaffDistanceRunSequence(generatedExtension, scoreNotesPerRow + 1)
              : generatedExtension;
          const extensionStartIndex = sequenceRef.current.length - 1;
          extension.breakIndices.forEach((index) =>
            breakIndicesRef.current.add(extensionStartIndex + index)
          );
          const expandedSequence = [...sequenceRef.current, ...extension.notes.slice(1)];
          sequenceRef.current = expandedSequence;
          setSequence(expandedSequence);
          const extensionRhythm = createStaffDistanceRhythm(
            noteDurations,
            extension.notes.length - 1,
            sequenceRhythmRef.current.endBeat
          );
          const expandedRhythm = appendStaffDistanceRhythm(
            sequenceRhythmRef.current,
            extensionRhythm
          );
          sequenceRhythmRef.current = expandedRhythm;
          setSequenceRhythm(expandedRhythm);
        }
      }
      while (breakIndicesRef.current.has(nextIndex)) nextIndex += 1;
      setQuestionIndex(nextIndex);
      setAttemptCount(0);
      setShowHint(false);
      setFeedback(null);
      setStartingNoteWrong(false);
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
        wrongFeedbackTimerRef.current = undefined;
      }
      firstResponseRef.current = null;
      questionAttemptsRef.current = [];
      wrongAttemptsRef.current = 0;
      usedHintRef.current = false;
      questionElapsedRef.current = 0;
      questionStartedAtRef.current = isPausedRef.current ? 0 : performance.now();
    },
    [
      extraPitchIds,
      noteDurations,
      notes,
      scoreNotesPerRow,
      settings,
      staffNotationMode,
      trainingMode,
    ]
  );

  const schedulePendingAdvance = useCallback((): void => {
    if (
      advanceTimerRef.current !== undefined ||
      pendingAdvanceRef.current === null ||
      isPausedRef.current ||
      endingRef.current
    ) {
      return;
    }
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = undefined;
      const pendingAdvance = pendingAdvanceRef.current;
      pendingAdvanceRef.current = null;
      pendingAdvance?.();
    }, 240);
  }, []);

  const submitAnswer = useCallback(
    async (
      isCorrect: boolean,
      answer?: PracticeAnswerInput,
      selectedDistance?: number
    ): Promise<void> => {
      if (isPausedRef.current || endingRef.current || feedback?.type === "correct") return;
      if (!currentFrom || !currentTo) return;
      const { distance: targetDistance } = summarizeStaffDistancePair(currentFrom, currentTo);
      const now = performance.now();
      const questionStart = questionStartedAtRef.current;
      const responseMs =
        questionElapsedRef.current + (questionStart === 0 ? 0 : now - questionStart);
      if (!firstResponseRef.current) {
        firstResponseRef.current = { correct: isCorrect, responseMs };
      }
      questionAttemptsRef.current.push({
        ...(answer?.midiNoteNumber === undefined ? {} : { midi: answer.midiNoteNumber }),
        ...(answer ? { noteName: answer.noteName } : {}),
        atMs: responseMs,
        confidence: answer?.confidence,
        inputMode: answer ? answerInputMode(answer.source) : undefined,
        microphoneAlgorithm: answer?.microphoneAlgorithm,
        isCorrect,
        ...(selectedDistance === undefined ? {} : { staffDistanceAnswer: selectedDistance }),
        clipping: answer?.clipping ?? false,
      });
      if (!isCorrect) {
        wrongAttemptsRef.current += 1;
        setAttemptCount(wrongAttemptsRef.current);
        setFeedback({ type: "wrong" });
        if (wrongFeedbackTimerRef.current !== undefined) {
          window.clearTimeout(wrongFeedbackTimerRef.current);
        }
        wrongFeedbackTimerRef.current = window.setTimeout(() => {
          wrongFeedbackTimerRef.current = undefined;
          setFeedback((current) => (current?.type === "wrong" ? null : current));
        }, WRONG_FEEDBACK_DURATION_MS);
        if (wrongAttemptsRef.current >= 2) {
          usedHintRef.current = true;
          setShowHint(true);
        }
        return;
      }

      if (trainingMode === "play") recordChaseTarget(questionIndex + 1);

      const pair = summarizeStaffDistancePair(currentFrom, currentTo);
      const firstResponse = firstResponseRef.current;
      const nextResults = [
        ...resultsRef.current,
        {
          ...pair,
          firstTryCorrect: firstResponse.correct,
          responseMs: firstResponse.responseMs,
          wrongAttempts: wrongAttemptsRef.current,
          usedHint: usedHintRef.current,
          targetPitchId: trainingMode === "play" ? currentTo.pitchId : undefined,
        },
      ];
      const eventIndex = resultsRef.current.length;
      const microphoneContext = currentMicrophoneContext();
      const microphoneAlgorithm =
        questionAttemptsRef.current.at(-1)?.microphoneAlgorithm ??
        microphoneContext.microphoneAlgorithm;
      const effectiveInputMode = answer
        ? answerInputMode(answer.source)
        : trainingMode === "look"
          ? "computer-keyboard"
          : answerInputMode(inputMethod);
      const estimatedSystemDelayMs =
        effectiveInputMode === "microphone"
          ? estimateStaffGameSystemDelayMs(
              "microphone",
              practiceMicrophoneDebugParametersForSensitivityLevel(
                microphoneAlgorithm ?? "swiftf0",
                microphoneContext.sensitivityLevel ?? 3
              ),
              microphoneAlgorithm ?? "swiftf0"
            )
          : 0;
      void saveAnswerEvents([
        {
          id: `${session.id}:distance:${eventIndex}`,
          dataSetId: "",
          sessionId: session.id,
          eventIndex,
          occurredAt: new Date().toISOString(),
          promptStartedAt: new Date(Date.now() - responseMs).toISOString(),
          promptEndedAt: new Date().toISOString(),
          mode: "staff-distance",
          inputMode: effectiveInputMode,
          deviceInfo: answerDeviceInfo(),
          ...(effectiveInputMode === "microphone"
            ? { ...microphoneContext, microphoneAlgorithm }
            : {}),
          targetMidi: getTargetMidiNoteNumber(currentTo),
          targetNoteId: currentTo.id,
          targetGroupId: currentTo.groupId,
          targetNoteName: currentTo.noteName,
          targetOctave: currentTo.octave,
          recognizedMidi: questionAttemptsRef.current.at(-1)?.midi,
          confidence: questionAttemptsRef.current.at(-1)?.confidence,
          attempts: questionAttemptsRef.current,
          isCorrectFirstTry: firstResponse.correct,
          isCorrectFinal: true,
          rawResponseTimeMs: responseMs,
          estimatedSystemDelayMs,
          responseTimeMs: Math.max(0, responseMs - estimatedSystemDelayMs),
          activeMs: responseMs,
          wrongAttempts: wrongAttemptsRef.current,
          isExtraNote: false,
          isMissed: false,
          staffDistance: {
            distance: pair.distance,
            direction: pair.direction,
            maxDistance: details.maxDistance,
            trainingMode,
            usedHint: usedHintRef.current,
          },
        },
      ]).catch((error: unknown) => {
        console.error("Failed to save staff-distance answer event", error);
      });
      resultsRef.current = nextResults;
      const completedNoteIndex = trainingMode === "look" ? questionIndex : questionIndex + 1;
      setCompletedNoteIndices((current) =>
        current.includes(completedNoteIndex) ? current : [...current, completedNoteIndex]
      );
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
        wrongFeedbackTimerRef.current = undefined;
      }
      setFeedback({ type: "correct", distance: targetDistance });
      pendingAdvanceRef.current = () => {
        if (mode === "fixed-count" && nextResults.length >= fixedCount) {
          void finishRef.current("completed-count", true);
        } else if (nextResults.length >= MAX_PRACTICE_QUESTIONS) {
          pauseAtQuestionLimit();
        } else {
          advanceQuestion(questionIndex + 1);
        }
      };
      schedulePendingAdvance();
    },
    [
      advanceQuestion,
      currentFrom,
      currentTo,
      details.maxDistance,
      feedback?.type,
      fixedCount,
      inputMethod,
      mode,
      pauseAtQuestionLimit,
      questionIndex,
      recordChaseTarget,
      schedulePendingAdvance,
      session.id,
      trainingMode,
    ]
  );

  const answerDistance = useCallback(
    (distance: number): void => {
      if (trainingMode !== "look" || !currentFrom || !currentTo) return;
      void submitAnswer(
        distance === summarizeStaffDistancePair(currentFrom, currentTo).distance,
        undefined,
        distance
      );
    },
    [currentFrom, currentTo, submitAnswer, trainingMode]
  );

  const answerPitch = useCallback(
    (answer: PracticeAnswerInput): void => {
      if (trainingMode !== "play" || isPausedRef.current || endingRef.current || !currentTo) {
        return;
      }
      const answerMode = inputMethod === "midi" ? "exact-pitch" : "microphone";
      if (!hasPlayedStartingNoteRef.current) {
        const startingNote = sequence[0];
        if (!startingNote) return;
        const isStartingNoteCorrect = isPracticeAnswerCorrect(answer, startingNote, answerMode);
        if (!isStartingNoteCorrect) {
          setStartingNoteWrong(true);
          setInputError("音高不对，请先弹奏谱面上的第一个音。");
          if (wrongFeedbackTimerRef.current !== undefined) {
            window.clearTimeout(wrongFeedbackTimerRef.current);
          }
          wrongFeedbackTimerRef.current = window.setTimeout(() => {
            wrongFeedbackTimerRef.current = undefined;
            setStartingNoteWrong(false);
          }, WRONG_FEEDBACK_DURATION_MS);
          return;
        }

        if (wrongFeedbackTimerRef.current !== undefined) {
          window.clearTimeout(wrongFeedbackTimerRef.current);
          wrongFeedbackTimerRef.current = undefined;
        }
        hasPlayedStartingNoteRef.current = true;
        setHasPlayedStartingNote(true);
        setStartingNoteWrong(false);
        setInputError(null);
        setCompletedNoteIndices((current) => (current.includes(0) ? current : [...current, 0]));
        firstResponseRef.current = null;
        wrongAttemptsRef.current = 0;
        usedHintRef.current = false;
        questionElapsedRef.current = 0;
        questionStartedAtRef.current = performance.now();
        return;
      }
      void submitAnswer(isPracticeAnswerCorrect(answer, currentTo, answerMode), answer);
    },
    [currentTo, inputMethod, sequence, submitAnswer, trainingMode]
  );

  const togglePause = useCallback(async (): Promise<void> => {
    if (questionLimitReachedRef.current) return;
    if (!isPausedRef.current) {
      const now = performance.now();
      activeElapsedRef.current += now - activeStartedAtRef.current;
      activeStartedAtRef.current = 0;
      questionElapsedRef.current += now - questionStartedAtRef.current;
      questionStartedAtRef.current = 0;
      isPausedRef.current = true;
      if (advanceTimerRef.current !== undefined) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = undefined;
      }
      if (trainingMode === "play" && inputMethod === "microphone") microphone.stop();
      setIsPaused(true);
      return;
    }
    if (trainingMode === "play" && inputMethod === "midi" && !midi.isConnected) {
      setInputError("MIDI 连接已断开；重新连接后可继续练习。");
      return;
    }
    if (trainingMode === "play" && inputMethod === "microphone") {
      const microphoneReady = await microphone.start({ includeAccidentals: false });
      if (!microphoneReady) {
        setInputError(microphone.error ?? "麦克风未能重新连接，请检查权限和输入设备。");
        return;
      }
    }
    setInputError(null);
    const now = performance.now();
    activeStartedAtRef.current = now;
    questionStartedAtRef.current = now;
    isPausedRef.current = false;
    setIsPaused(false);
    schedulePendingAdvance();
  }, [inputMethod, microphone, midi.isConnected, schedulePendingAdvance, trainingMode]);

  const toggleHint = (): void => {
    usedHintRef.current = true;
    setShowHint((current) => !current);
  };

  useEffect(() => {
    if (trainingMode !== "play" || inputMethod !== "midi") return undefined;
    return subscribeMidi((event) => {
      if (event.type !== "press" || !isNaturalPianoKey(event.note.keyName)) return;
      answerPitch({
        diagnosticSampleId: event.note.diagnosticSampleId,
        midiNoteNumber: event.note.midiNoteNumber,
        noteName: event.note.keyName,
        octave: event.note.octave,
        source: "midi",
      });
    });
  }, [answerPitch, inputMethod, subscribeMidi, trainingMode]);

  useEffect(() => {
    if (trainingMode !== "play" || inputMethod !== "microphone") {
      onMicrophoneAnswerHandlerChange(null);
      return undefined;
    }
    onMicrophoneAnswerHandlerChange(answerPitch);
    return () => onMicrophoneAnswerHandlerChange(null);
  }, [answerPitch, inputMethod, onMicrophoneAnswerHandlerChange, trainingMode]);

  useEffect(() => {
    if (trainingMode !== "play" || isPausedRef.current) return;
    if (inputMethod === "midi" && !midi.isConnected) {
      setInputError("MIDI 连接已断开；重新连接后可继续练习。");
      void togglePause();
    } else if (inputMethod === "microphone" && microphone.status === "error") {
      setInputError(microphone.error ?? "麦克风连接已中断；重新连接后可继续练习。");
      void togglePause();
    }
  }, [
    inputMethod,
    microphone.error,
    microphone.status,
    midi.isConnected,
    togglePause,
    trainingMode,
  ]);

  useEffect(() => {
    onRunningChange(true);
    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const onViewportChange = (): void => setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", onViewportChange);
    const pointerQuery = window.matchMedia("(pointer: coarse)");
    const onPointerChange = (): void =>
      setIsTouchDevice(navigator.maxTouchPoints > 0 || pointerQuery.matches);
    pointerQuery.addEventListener("change", onPointerChange);
    return () => {
      mediaQuery.removeEventListener("change", onViewportChange);
      pointerQuery.removeEventListener("change", onPointerChange);
      onRunningChange(false);
      if (advanceTimerRef.current !== undefined) window.clearTimeout(advanceTimerRef.current);
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
      }
      pendingAdvanceRef.current = null;
    };
  }, [onRunningChange]);

  useEffect(() => {
    const element = scoreWrapRef.current;
    if (!element) return;
    const updateWidth = (): void => setScoreWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pauseWhenInactive = (): void => {
      if (document.visibilityState === "hidden" && !isPausedRef.current) void togglePause();
    };
    const pauseOnWindowBlur = (): void => {
      if (!isPausedRef.current) void togglePause();
    };
    document.addEventListener("visibilitychange", pauseWhenInactive);
    window.addEventListener("blur", pauseOnWindowBlur);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenInactive);
      window.removeEventListener("blur", pauseOnWindowBlur);
    };
  }, [togglePause]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const elapsed = getActiveElapsed();
      setActiveElapsed(elapsed);
      if (mode === "fixed-duration" && elapsed >= fixedDurationSeconds * 1000) {
        void finishRef.current("completed-duration", true);
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, [fixedDurationSeconds, getActiveElapsed, mode]);

  useEffect(() => {
    if (!navigationExitRequest || handledExitRequestRef.current === navigationExitRequest.id)
      return;
    handledExitRequestRef.current = navigationExitRequest.id;
    void finishRef.current("manual-stop", false).then(() => {
      onNavigationExit?.(navigationExitRequest.targetView);
    });
  }, [navigationExitRequest, onNavigationExit]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      if (
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.isComposing &&
        !isTextEntryTarget(event.target)
      ) {
        event.preventDefault();
        void togglePause();
        return;
      }
      if (trainingMode === "look" && !isPausedRef.current && /^[0-7]$/.test(event.key)) {
        const selectedDistance = Number(event.key);
        if (selectedDistance <= details.maxDistance && answerOptions.includes(selectedDistance)) {
          event.preventDefault();
          answerDistance(selectedDistance);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answerDistance, answerOptions, details.maxDistance, togglePause, trainingMode]);

  if (!currentFrom || !currentTo || scoreNotes.length < 2) {
    return (
      <section className="staff-distance-run-shell" role="alert">
        <h1>无法生成这段音距</h1>
        <p>返回设置页，扩大音域或缩小最大音距后重试。</p>
        <button className="primary" onClick={() => void finish("manual-stop", false)} type="button">
          返回设置
        </button>
      </section>
    );
  }

  const currentQuestionNumber = resultsRef.current.length + 1;
  const progressLabel = (() => {
    if (trainingMode === "play" && !hasPlayedStartingNote) {
      if (mode === "fixed-count") {
        return `先弹第一个音（不计题） · 0 / ${fixedCount} 题`;
      }
      if (mode === "fixed-duration") {
        return `先弹第一个音（不计题） · 剩余 ${durationLabel(remainingTime ?? 0)}`;
      }
      return "先弹第一个音（不计题）";
    }
    if (mode === "fixed-count") return `第 ${currentQuestionNumber} / ${fixedCount} 题`;
    if (mode === "fixed-duration") return `剩余 ${durationLabel(remainingTime ?? 0)}`;
    return `第 ${currentQuestionNumber} 题`;
  })();
  const liveQuestionLabel =
    trainingMode === "look"
      ? `第 ${currentQuestionNumber} 题，当前音和下一个音相隔几步？`
      : hasPlayedStartingNote
        ? `第 ${currentQuestionNumber} 题，根据当前音弹奏下一个音。`
        : "先弹奏谱面上的第一个音；这一步不计题。";

  return (
    <section aria-label="音距速推练习" className="staff-distance-run-shell">
      <header className="staff-distance-run-header">
        <div>
          <h1>{trainingMode === "look" ? "音距速推 · 看音距" : "音距速推 · 弹奏"}</h1>
          <p>{progressLabel}</p>
        </div>
        <div className="staff-distance-run-actions">
          <button disabled={isPaused} onClick={togglePause} type="button">
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
            {isPaused ? "继续" : "暂停"}
          </button>
          <button
            disabled={isPaused}
            onClick={() => void finish("manual-stop", true)}
            type="button"
          >
            <Square size={15} />
            结束
          </button>
          {trainingMode === "play" ? (
            <button
              aria-label="追逐游戏设置"
              className="song-chase-settings-button"
              disabled={isPaused}
              title="追逐游戏设置"
              type="button"
              onClick={() => setIsChaseSettingsOpen(true)}
            >
              <Settings2 aria-hidden="true" size={16} />
              追逐游戏设置
              <span aria-hidden="true" className="song-chase-new-badge">
                NEW
              </span>
            </button>
          ) : null}
          {trainingMode === "play" && inputMethod === "midi" ? (
            <MidiInputControl
              ariaLabel="音距速推 MIDI 输入设备"
              className="staff-distance-run-midi-control"
              midi={midi}
            />
          ) : null}
        </div>
      </header>

      <div
        ref={scoreWrapRef}
        aria-label={liveQuestionLabel}
        className={`staff-distance-score-wrap${isContinuousScore ? " staff-distance-score-stream" : ""}`}
        role="group"
      >
        <StaffPagePrompt
          completedCount={activePairStartIndex}
          completedNoteIndices={scoreCompletedNoteIndices}
          notes={scoreNotes}
          monophonicGrandStaff
          showGrandStaffRightConnector={false}
          layout={isMobile ? MOBILE_PRACTICE_PAGE_STAFF_LAYOUT : undefined}
          noteDuration="quarter"
          noteDurations={scoreDurations}
          noteMeasures={scoreMeasures}
          noteOnsets={scoreOnsets}
          noteBeamGroups={scoreBeamGroupIds}
          beatsPerMeasure={4}
          timeSignature="4/4"
          barlineAfterNoteIndices={pageBarlineAfterNoteIndices}
          staffNotationMode={staffNotationMode}
          useLedgerGap={useLedgerGap}
          notesPerRow={scoreNotesPerRow}
          maxRowCount={isContinuousScore ? scoreRowCount : 1}
          visibleRowCount={isContinuousScore ? scoreRowCount : 1}
          virtualizeRows={isContinuousScore}
          followRowIndex={followScoreRowIndex}
          isFiniteScore={
            isContinuousScore && mode === "fixed-count" && resultsRef.current.length >= fixedCount
          }
          trackedNoteIndex={returnNoteIndex}
          onTrackedNoteVisibilityChange={handleTrackedScoreVisibilityChange}
          getAudioTime={isContinuousScore ? getPianoAudioTime : undefined}
          chaseCursor={isContinuousScore ? chaseCursor : null}
          minDisplayWidthPx={0}
          wrongIndex={
            !hasPlayedStartingNote && startingNoteWrong
              ? 0
              : feedback?.type === "wrong"
                ? activePairStartIndex + 1
                : undefined
          }
        />
      </div>

      {!isPaused && !isCurrentScoreNoteVisible ? (
        <ReturnToCurrentNoteButton getTarget={getCurrentScoreNoteTarget} />
      ) : null}

      <p aria-live="polite" className="staff-distance-question-copy">
        {feedback?.type === "correct"
          ? trainingMode === "look"
            ? `${feedback.distance} 步，答对了`
            : "弹对了"
          : feedback?.type === "wrong"
            ? attemptCount >= 2
              ? trainingMode === "look"
                ? "再看一眼，可以用下方提示数一数"
                : "音高不对，再试一次；也可以用下方提示数一数"
              : trainingMode === "look"
                ? "再看一眼"
                : "音高不对，再试一次"
            : trainingMode === "look"
              ? "当前音和下一个音相隔几步？"
              : hasPlayedStartingNote
                ? "根据当前音，弹奏谱面上的下一个音。"
                : "请先弹奏谱面上的第一个音。"}
      </p>
      {trainingMode === "look" ? (
        <div aria-label="音距答案" className="staff-distance-answer-row" role="group">
          {answerRows.map((row, rowIndex) => (
            <div className="staff-distance-answer-line" key={rowIndex}>
              {row.map((distance) => (
                <button
                  aria-label={`${distance} 步`}
                  className={`staff-distance-answer-button${feedback?.type === "correct" && feedback.distance === distance ? " is-correct" : ""}`}
                  disabled={isPaused || feedback?.type === "correct"}
                  key={distance}
                  onClick={() => answerDistance(distance)}
                  type="button"
                >
                  {distance}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div aria-live="polite" className="staff-distance-play-input-status">
          {inputError ? (
            inputError
          ) : inputMethod === "midi" ? (
            `请弹奏 MIDI 键盘上的${hasPlayedStartingNote ? "下一个音" : "第一个音"}${midi.selectedInput?.name ? ` · ${midi.selectedInput.name}` : ""}`
          ) : microphone.status === "listening" ? (
            `麦克风已连接，请弹奏${hasPlayedStartingNote ? "下一个音" : "谱面上的第一个音"}`
          ) : microphone.status === "requesting" ? (
            <LoadingActivityText kind={microphone.isPreparingSwiftF0 ? "dots" : "spinner"}>
              {microphone.isPreparingSwiftF0 ? "正在准备识别模型" : "正在连接麦克风…"}
            </LoadingActivityText>
          ) : (
            (microphone.error ?? "麦克风未连接")
          )}
          {inputMethod === "microphone" &&
          (microphone.error ||
            microphone.status === "error" ||
            microphone.status === "requesting") ? (
            <PracticeMicrophoneRetryButton
              isConnecting={microphone.status === "requesting"}
              onRetry={async () => {
                const connected = await microphone.start({ includeAccidentals: false });
                if (connected) setInputError(null);
                return connected;
              }}
            />
          ) : null}
        </div>
      )}
      {trainingMode === "play" && microphone.recoveryReloadAvailable ? (
        !isPaused ? (
          <button
            className="practice-microphone-recovery-reload"
            type="button"
            onClick={() => void microphone.reloadAfterRecoveryFailure?.()}
          >
            刷新页面重试
          </button>
        ) : null
      ) : null}
      {trainingMode === "look" ? (
        <aside aria-label="读谱提示" className="staff-distance-question-hints">
          <strong className="staff-distance-question-hints-title">读谱提示</strong>
          <p>
            <span>举例</span>
            <span>Do 到 Mi 相隔 2 步；这里的“步数”就是五线谱上相邻线位或间位的个数。</span>
          </p>
          <p>
            <span>规律</span>
            <span>
              两个音都在线上或间内，相隔偶数步（0、2、4、6）；一个在线上、一个在间内，相隔奇数步（1、3、5、7）。
            </span>
          </p>
        </aside>
      ) : null}

      {wrongAttemptsRef.current > 0 && feedback?.type !== "correct" ? (
        <button className="staff-distance-hint-trigger" onClick={toggleHint} type="button">
          {showHint ? "收起提示" : "提示"}
        </button>
      ) : null}
      {showHint ? (
        <div aria-live="polite" className="staff-distance-hint">
          <span>当前音</span>
          <span aria-hidden="true" className="staff-distance-hint-steps">
            {Array.from(
              { length: summarizeStaffDistancePair(currentFrom, currentTo).distance },
              (_, index) => (
                <i key={index} />
              )
            )}
          </span>
          <span>下一个音</span>
          <small>每跨一个相邻线位或间位，算 1 步</small>
        </div>
      ) : null}

      {!isTouchDevice ? (
        <p className="staff-distance-run-shortcuts">
          {trainingMode === "look"
            ? `电脑键盘：${details.includeUnison ? "0" : "1"}–${details.maxDistance} 作答 · `
            : ""}
          空格暂停/继续
        </p>
      ) : null}

      {isPaused ? (
        <div className="staff-distance-pause-overlay" role="status">
          <strong>已暂停</strong>
          <span>
            {inputMethod === "microphone" && microphone.status === "requesting"
              ? "正在连接麦克风…"
              : (inputError ?? "练习计时已停止")}
          </span>
          <button className="primary" onClick={togglePause} type="button">
            <Play size={16} />
            继续
          </button>
          {trainingMode === "play" &&
          inputMethod === "microphone" &&
          (microphone.error ||
            microphone.status === "error" ||
            microphone.status === "requesting") ? (
            <PracticeMicrophoneRetryButton
              isConnecting={microphone.status === "requesting"}
              onRetry={async () => {
                const connected = await microphone.start({ includeAccidentals: false });
                if (connected) setInputError(null);
                return connected;
              }}
            />
          ) : null}
          {trainingMode === "play" && microphone.recoveryReloadAvailable ? (
            <button
              className="practice-microphone-recovery-reload"
              type="button"
              onClick={() => void microphone.reloadAfterRecoveryFailure?.()}
            >
              刷新页面重试
            </button>
          ) : null}
        </div>
      ) : null}
      {isQuestionLimitReached ? (
        <PracticeQuestionLimitDialog
          onEnd={() => void finishRef.current("completed-count", false)}
        />
      ) : null}
      {trainingMode === "play" ? (
        <PracticeChaseSettingsDialog
          hideHandMode={staffNotationMode !== "grand"}
          isMidiConnected={midi.isConnected}
          isOpen={isChaseSettingsOpen}
          mode="distance"
          settings={chaseSettings}
          onClose={() => setIsChaseSettingsOpen(false)}
          onSave={onSaveChaseSettings}
        />
      ) : null}
    </section>
  );
}
