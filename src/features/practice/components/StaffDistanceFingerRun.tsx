import { ArrowLeft, CircleHelp, Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AnswerAttempt,
  AnswerEvent,
  PracticeSessionRecord,
  StaffDistanceInputMethod,
  StaffDistanceFingerBatch,
  StaffDistanceFingerHand,
  StaffDistanceFingerInteractionMode,
  StaffDistanceFingerNumber,
  StaffDistanceQuestionResult,
  StaffNotationMode,
  TargetNote,
} from "../../../domain/types";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import { getTargetMidiNoteNumber, isPracticeAnswerCorrect } from "../../../domain/answerInput";
import {
  answerDeviceInfo,
  answerInputMode,
  currentMicrophoneContext,
} from "../../../data/answerEvents";
import { saveAnswerEvents } from "../../../data/db";
import {
  createStaffDistanceFingerCards,
  formatStaffDistanceTargetFinger,
  getStaffDistanceTargetFinger,
  getStaffDistanceFingerProfile,
} from "../../../domain/staffDistanceFinger";
import { summarizeStaffDistancePair } from "../../../domain/staffDistancePractice";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { MidiInputControl } from "../../../midi/MidiInputControl";
import { isNaturalPianoKey } from "../../../shared/components/pianoKeyNames";
import { PRACTICE_STAFF_REFERENCE_NOTE_COLUMN_WIDTH_PX } from "../../../shared/staff/staffLayoutProfiles";
import { PracticeFullscreenToggle } from "./PracticeFullscreenFrame";
import { PracticeMicrophoneRetryButton } from "../../../shared/components/PracticeMicrophoneRetryButton";
import { LoadingActivityText } from "../../../shared/components/LoadingActivity";
import type { StaffDistanceMicrophoneInput } from "./StaffDistanceRun";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffDistanceFingerKeyboard } from "./StaffDistanceFingerKeyboard";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import {
  canFitPracticePianoKeyboard,
  canFitPracticePianoKeyboardInEitherOrientation,
  PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX,
  PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX,
} from "./staffDistanceFingerKeyboardLayout";
import { usePracticeViewportSize } from "./usePracticeViewportSize";

const FINGER_CARD_COUNT = 28;
const FINGER_CARD_TIME_LIMIT_MS = 5_000;
const WRONG_FEEDBACK_DURATION_MS = 1_000;
const FINGER_NOTE_DURATIONS = ["quarter", "quarter"] as const;
const FINGER_NOTE_MEASURES = [0, 0] as const;
const FINGER_NOTE_ONSETS = [0, 1] as const;
const FINGER_NOTE_BEAM_GROUPS = [0, 1] as const;
const FINGER_PRACTICE_STAFF_LAYOUT = {
  ...PRACTICE_PAGE_STAFF_LAYOUT,
  notationScale: 1.18,
  vertical: {
    ...PRACTICE_PAGE_STAFF_LAYOUT.vertical,
    trebleOnlyYPx: 0,
    bassOnlyYPx: 0,
    viewHeightPx: 132,
  },
};
const FINGER_PRACTICE_COMPACT_STAFF_LAYOUT = {
  ...PRACTICE_PAGE_STAFF_LAYOUT,
  vertical: {
    ...PRACTICE_PAGE_STAFF_LAYOUT.vertical,
    trebleOnlyYPx: 30,
    bassOnlyYPx: 30,
    viewHeightPx: 170,
  },
};

type FingerStep = "reference" | "target";

interface FingerStepAttempts {
  reference: AnswerAttempt[];
  target: AnswerAttempt[];
  referenceFirstTryCorrect?: boolean;
  targetFirstTryCorrect?: boolean;
  referenceCompleted: boolean;
  targetCompleted: boolean;
}

export interface StaffDistanceFingerRunProps {
  learningLevelId?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  fingerHand: StaffDistanceFingerHand;
  fingerNumber: StaffDistanceFingerNumber;
  inputMethod: StaffDistanceInputMethod;
  keyboardScale: number;
  midi: MidiInputController;
  microphone: StaffDistanceMicrophoneInput;
  navigationExitRequest?: {
    id: number;
    targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome";
  } | null;
  notes: TargetNote[];
  onFinish: (session: PracticeSessionRecord, showSummary: boolean) => Promise<void>;
  onMicrophoneAnswerHandlerChange: (
    handler: ((answer: PracticeAnswerInput) => void) | null
  ) => void;
  onNavigationExit?: (
    targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal" | "metronome"
  ) => void;
  onRestart?: (
    fingerInteractionMode?: StaffDistanceFingerInteractionMode,
    activePracticeMs?: number
  ) => Promise<void>;
  onRunningChange: (running: boolean) => void;
  session: PracticeSessionRecord;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
}

function makeEmptyStepAttempts(): FingerStepAttempts {
  return {
    reference: [],
    target: [],
    referenceCompleted: false,
    targetCompleted: false,
  };
}

function makeFingerAnswerEvent(args: {
  learningLevelId?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  attempts: AnswerAttempt[];
  batch: StaffDistanceFingerBatch;
  cardIndex: number;
  elapsedMs: number;
  fingerHand: StaffDistanceFingerHand;
  fingerNumber: StaffDistanceFingerNumber;
  inputMethod: StaffDistanceInputMethod;
  isMissed: boolean;
  promptEndedAt: string;
  promptStartedAt: string;
  timeLimitMs: number;
  reference: TargetNote;
  session: PracticeSessionRecord;
  step: FingerStep;
  target: TargetNote;
}): AnswerEvent {
  const {
    attempts,
    learningLevelId,
    batch,
    cardIndex,
    elapsedMs,
    fingerHand,
    fingerNumber,
    inputMethod,
    isMissed,
    promptEndedAt,
    promptStartedAt,
    reference,
    session,
    step,
    target,
    timeLimitMs,
  } = args;
  const expected = step === "reference" ? reference : target;
  const pair = summarizeStaffDistancePair(reference, expected);
  const microphoneContext = currentMicrophoneContext();
  const effectiveInputMode = attempts.at(-1)?.inputMode ?? answerInputMode(inputMethod);
  return {
    id: `${session.id}:finger:${cardIndex * 2 + (step === "reference" ? 0 : 1)}`,
    dataSetId: "",
    sessionId: session.id,
    eventIndex: cardIndex * 2 + (step === "reference" ? 0 : 1),
    occurredAt: promptEndedAt,
    promptStartedAt,
    promptEndedAt,
    mode: "staff-distance",
    ...(learningLevelId ? { learningLevelId } : {}),
    inputMode: effectiveInputMode,
    deviceInfo: answerDeviceInfo(),
    ...(effectiveInputMode === "microphone" ? microphoneContext : {}),
    targetMidi: getTargetMidiNoteNumber(expected),
    targetNoteId: expected.id,
    targetGroupId: expected.groupId,
    targetNoteName: expected.noteName,
    targetOctave: expected.octave,
    recognizedMidi: attempts.at(-1)?.midi,
    confidence: attempts.at(-1)?.confidence,
    attempts,
    isCorrectFirstTry: attempts[0]?.isCorrect ?? false,
    isCorrectFinal: !isMissed,
    rawResponseTimeMs: elapsedMs,
    estimatedSystemDelayMs: 0,
    responseTimeMs: elapsedMs,
    activeMs: elapsedMs,
    timeLimitMs,
    wrongAttempts: attempts.filter((attempt) => !attempt.isCorrect).length,
    isExtraNote: false,
    isMissed,
    staffDistance: {
      distance: pair.distance,
      direction: pair.direction,
      maxDistance: 7,
      trainingMode: "finger",
      fingerRole: step,
      fingerBatch: batch,
      fingerHand,
      fingerNumber,
    },
  };
}

export function StaffDistanceFingerRun({
  learningLevelId,
  fingerHand,
  fingerNumber,
  inputMethod,
  keyboardScale,
  midi,
  microphone,
  navigationExitRequest,
  notes,
  onFinish,
  onMicrophoneAnswerHandlerChange,
  onNavigationExit,
  onRestart,
  onRunningChange,
  session,
  staffNotationMode,
  useLedgerGap,
}: StaffDistanceFingerRunProps): JSX.Element {
  const [deck] = useState(() => {
    const fullDeck = createStaffDistanceFingerCards(notes, fingerHand, fingerNumber);
    const focusFingerBatch = session.staffDistance?.focusFingerBatch;
    if (!focusFingerBatch || fullDeck.error) return fullDeck;
    const focusedCards = fullDeck.cards.filter((card) => card.batch === focusFingerBatch);
    return focusedCards.length > 0 ? { ...fullDeck, cards: focusedCards } : fullDeck;
  });
  const isNoAnswerMode = session.staffDistance?.fingerInteractionMode === "no-answer";
  const showsFingerKeyboard = inputMethod === "virtual-keyboard" || isNoAnswerMode;
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [isNoAnswerComplete, setIsNoAnswerComplete] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const instructionsDialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = instructionsDialogRef.current;
    if (!showInstructions || !dialog || dialog.open) return undefined;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [showInstructions]);
  const viewportSize = usePracticeViewportSize();
  const readOnlyKeyboardHeightCapPx = Math.max(180, Math.min(300, viewportSize.width * 0.3));
  const runShellRef = useRef<HTMLElement | null>(null);
  const keyboardRef = useRef<HTMLDivElement | null>(null);
  const activeKeyboardTouchPointerIdsRef = useRef(new Set<number>());
  const pendingKeyboardAdvanceRef = useRef<StaffDistanceQuestionResult[] | null>(null);
  const [keyboardHeightPx, setKeyboardHeightPx] = useState(PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX);
  const keyboardFitsCurrentOrientation = canFitPracticePianoKeyboard(viewportSize, keyboardScale);
  const keyboardFitsEitherOrientation = canFitPracticePianoKeyboardInEitherOrientation(
    viewportSize,
    keyboardScale
  );
  const isViewportBlocked =
    !isNoAnswerMode && inputMethod === "virtual-keyboard" && !keyboardFitsCurrentOrientation;

  useLayoutEffect(() => {
    if (!showsFingerKeyboard || isViewportBlocked) return undefined;
    const runShell = runShellRef.current;
    const keyboard = keyboardRef.current;
    if (!runShell || !keyboard) return undefined;
    let animationFrameId = 0;

    const updateAvailableKeyboardHeight = (): void => {
      const visualViewport = window.visualViewport;
      const viewportBottom = visualViewport
        ? visualViewport.offsetTop + visualViewport.height
        : window.innerHeight;
      const keyboardTop = Math.max(
        keyboard.getBoundingClientRect().top,
        visualViewport?.offsetTop ?? 0
      );
      const keyboardStyle = window.getComputedStyle(keyboard);
      const keyboardFrameHeight =
        Number.parseFloat(keyboardStyle.paddingTop) +
        Number.parseFloat(keyboardStyle.paddingBottom) +
        Number.parseFloat(keyboardStyle.borderTopWidth) +
        Number.parseFloat(keyboardStyle.borderBottomWidth);
      const shellBottomPadding = Number.parseFloat(window.getComputedStyle(runShell).paddingBottom);
      const remainingHeight = Math.floor(
        viewportBottom - keyboardTop - keyboardFrameHeight - shellBottomPadding
      );
      const nextHeight = Math.max(
        PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX,
        Math.min(PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX, remainingHeight)
      );
      setKeyboardHeightPx((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    };

    const scheduleHeightUpdate = (): void => {
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0;
        updateAvailableKeyboardHeight();
      });
    };

    scheduleHeightUpdate();
    const observer = new ResizeObserver(scheduleHeightUpdate);
    observer.observe(runShell);
    runShell
      .querySelectorAll<HTMLElement>(
        ".staff-distance-finger-card, .staff-distance-finger-score, .staff-distance-question-copy"
      )
      .forEach((element) => observer.observe(element));
    window.addEventListener("resize", scheduleHeightUpdate);
    window.addEventListener("scroll", scheduleHeightUpdate, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", scheduleHeightUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleHeightUpdate);
    return () => {
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleHeightUpdate);
      window.removeEventListener("scroll", scheduleHeightUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleHeightUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleHeightUpdate);
    };
  }, [showsFingerKeyboard, isViewportBlocked]);

  const [cardIndex, setCardIndex] = useState(0);
  const [step, setStep] = useState<FingerStep>("reference");
  const [completedNoteIndices, setCompletedNoteIndices] = useState<number[]>([]);
  const [wrongIndex, setWrongIndex] = useState<number | undefined>();
  const [wrongFeedback, setWrongFeedback] = useState(false);
  const [wrongEdgePulse, setWrongEdgePulse] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isResumeConnecting, setIsResumeConnecting] = useState(false);
  const [showResumeConnecting, setShowResumeConnecting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(FINGER_CARD_TIME_LIMIT_MS);
  const stepRef = useRef<FingerStep>("reference");
  const cardIndexRef = useRef(0);
  const stepAttemptsRef = useRef<FingerStepAttempts>(makeEmptyStepAttempts());
  const resultsRef = useRef<StaffDistanceQuestionResult[]>([]);
  const isPausedRef = useRef(false);
  const resumeInProgressRef = useRef(false);
  const endingRef = useRef(false);
  const deadlineRef = useRef(performance.now() + FINGER_CARD_TIME_LIMIT_MS);
  const pausedRemainingMsRef = useRef(FINGER_CARD_TIME_LIMIT_MS);
  const stepStartedRemainingMsRef = useRef(FINGER_CARD_TIME_LIMIT_MS);
  const referencePromptStartedAtRef = useRef(new Date().toISOString());
  const stepPromptStartedAtRef = useRef(referencePromptStartedAtRef.current);
  const referencePromptEndedAtRef = useRef<string | undefined>();
  const activeStartedAtRef = useRef(performance.now());
  const activeElapsedMsRef = useRef(0);
  const wrongFeedbackTimerRef = useRef<number | undefined>();
  const answerEventSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const handledExitRequestRef = useRef<number | null>(null);
  const viewportBlockedRef = useRef(false);
  const resumeAfterViewportBlockRef = useRef(false);
  const noAnswerModeRef = useRef(isNoAnswerMode);
  noAnswerModeRef.current = isNoAnswerMode;
  const stopMicrophoneRef = useRef(microphone.stop);
  stopMicrophoneRef.current = microphone.stop;
  const currentCard = deck.cards[cardIndex];
  const scoreNotes = useMemo(
    () => (currentCard ? [currentCard.reference, currentCard.target] : []),
    [currentCard]
  );
  const targetFinger = useMemo(
    () =>
      currentCard
        ? getStaffDistanceTargetFinger(
            fingerHand,
            fingerNumber,
            currentCard.reference,
            currentCard.target
          )
        : undefined,
    [currentCard, fingerHand, fingerNumber]
  );
  const scoreNoteLabels = useMemo(
    () => [
      `${fingerNumber}指`,
      isNoAnswerMode && isAnswerRevealed && targetFinger
        ? formatStaffDistanceTargetFinger(targetFinger)
        : "目标",
    ],
    [fingerNumber, isAnswerRevealed, isNoAnswerMode, targetFinger]
  );
  const details = session.staffDistance!;
  const fingerProfile = getStaffDistanceFingerProfile(fingerHand, fingerNumber);
  const fingerClefLabel = fingerHand === "right" ? "高音谱" : "低音谱";
  const midiSubscribe = midi.subscribe;
  const enqueueAnswerEvent = useCallback((event: AnswerEvent): void => {
    answerEventSaveQueueRef.current = answerEventSaveQueueRef.current
      .then(() => saveAnswerEvents([event]))
      .catch((error: unknown) => {
        console.error("Failed to save single-finger staff-distance answer event", error);
      });
  }, []);

  useEffect(() => {
    if (isViewportBlocked) {
      if (viewportBlockedRef.current) return;
      viewportBlockedRef.current = true;
      resumeAfterViewportBlockRef.current = !isPausedRef.current;
      if (!isPausedRef.current) {
        const now = performance.now();
        if (activeStartedAtRef.current !== 0) {
          activeElapsedMsRef.current += Math.max(0, now - activeStartedAtRef.current);
        }
        activeStartedAtRef.current = 0;
        pausedRemainingMsRef.current = Math.max(0, deadlineRef.current - now);
        deadlineRef.current = 0;
        setRemainingMs(pausedRemainingMsRef.current);
      }
      return;
    }

    if (!viewportBlockedRef.current) return;
    viewportBlockedRef.current = false;
    if (resumeAfterViewportBlockRef.current && !isPausedRef.current && !endingRef.current) {
      const now = performance.now();
      activeStartedAtRef.current = now;
      deadlineRef.current = now + pausedRemainingMsRef.current;
    }
    resumeAfterViewportBlockRef.current = false;
  }, [isViewportBlocked]);

  const finish = useCallback(
    async (endReason: PracticeSessionRecord["endReason"], showSummary: boolean): Promise<void> => {
      if (endingRef.current) return;
      endingRef.current = true;
      if (pendingKeyboardAdvanceRef.current) {
        resultsRef.current = pendingKeyboardAdvanceRef.current;
      }
      pendingKeyboardAdvanceRef.current = null;
      activeKeyboardTouchPointerIdsRef.current.clear();
      deadlineRef.current = 0;
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
        wrongFeedbackTimerRef.current = undefined;
      }
      const now = performance.now();
      const activePracticeMs =
        activeElapsedMsRef.current +
        (activeStartedAtRef.current === 0 ? 0 : Math.max(0, now - activeStartedAtRef.current));
      activeStartedAtRef.current = 0;
      isPausedRef.current = true;
      setIsPaused(true);
      if (inputMethod === "microphone") microphone.stop();
      onRunningChange(false);
      await answerEventSaveQueueRef.current;
      const questionResults = resultsRef.current;
      await onFinish(
        {
          ...session,
          activePracticeMs,
          endedAt: new Date().toISOString(),
          endReason,
          completedCount: questionResults.length,
          interruptedCount: questionResults.filter((result) => !result.firstTryCorrect).length,
          staffDistance: { ...details, questionResults },
        },
        showSummary
      );
    },
    [details, inputMethod, microphone, onFinish, onRunningChange, session]
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const advanceCard = useCallback(
    (nextResults?: StaffDistanceQuestionResult[]): void => {
      if (nextResults) resultsRef.current = nextResults;
      pendingKeyboardAdvanceRef.current = null;
      const nextIndex = cardIndexRef.current + 1;
      if (nextIndex >= deck.cards.length) {
        void finishRef.current("completed-count", true);
        return;
      }
      cardIndexRef.current = nextIndex;
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
        wrongFeedbackTimerRef.current = undefined;
      }
      setCardIndex(nextIndex);
      setStep("reference");
      stepRef.current = "reference";
      stepAttemptsRef.current = makeEmptyStepAttempts();
      setCompletedNoteIndices([]);
      setWrongIndex(undefined);
      setWrongFeedback(false);
      setFeedback(null);
      setInputError(null);
      pausedRemainingMsRef.current = FINGER_CARD_TIME_LIMIT_MS;
      setRemainingMs(FINGER_CARD_TIME_LIMIT_MS);
      deadlineRef.current =
        isPausedRef.current || viewportBlockedRef.current
          ? 0
          : performance.now() + FINGER_CARD_TIME_LIMIT_MS;
      stepStartedRemainingMsRef.current = FINGER_CARD_TIME_LIMIT_MS;
      referencePromptStartedAtRef.current = new Date().toISOString();
      stepPromptStartedAtRef.current = referencePromptStartedAtRef.current;
      referencePromptEndedAtRef.current = undefined;
    },
    [deck.cards.length]
  );

  const advanceNoAnswerCard = useCallback((): void => {
    const nextIndex = cardIndexRef.current + 1;
    setIsAnswerRevealed(false);
    if (nextIndex >= deck.cards.length) {
      setIsNoAnswerComplete(true);
      return;
    }
    cardIndexRef.current = nextIndex;
    setCardIndex(nextIndex);
    setCompletedNoteIndices([]);
    setWrongIndex(undefined);
    setWrongFeedback(false);
    setFeedback(null);
    setInputError(null);
  }, [deck.cards.length]);

  const advanceAfterKeyboardRelease = useCallback(
    (nextResults: StaffDistanceQuestionResult[], prompt: string): void => {
      if (
        inputMethod !== "virtual-keyboard" ||
        activeKeyboardTouchPointerIdsRef.current.size === 0
      ) {
        advanceCard(nextResults);
        return;
      }

      pendingKeyboardAdvanceRef.current = nextResults;
      const now = performance.now();
      const remaining = Math.max(0, deadlineRef.current - now);
      deadlineRef.current = 0;
      pausedRemainingMsRef.current = remaining;
      setRemainingMs(remaining);
      setFeedback(prompt);
      if (activeStartedAtRef.current !== 0) {
        activeElapsedMsRef.current += Math.max(0, now - activeStartedAtRef.current);
        activeStartedAtRef.current = 0;
      }
    },
    [advanceCard, inputMethod]
  );

  const handleKeyboardTouchStart = useCallback((pointerId: number): void => {
    activeKeyboardTouchPointerIdsRef.current.add(pointerId);
  }, []);

  const handleKeyboardTouchEnd = useCallback(
    (pointerId: number): void => {
      activeKeyboardTouchPointerIdsRef.current.delete(pointerId);
      const pendingResults = pendingKeyboardAdvanceRef.current;
      if (pendingResults && activeKeyboardTouchPointerIdsRef.current.size === 0) {
        pendingKeyboardAdvanceRef.current = null;
        advanceCard(pendingResults);
        if (!endingRef.current && !isPausedRef.current && !viewportBlockedRef.current) {
          activeStartedAtRef.current = performance.now();
        }
      }
    },
    [advanceCard]
  );

  const timeoutCard = useCallback((): void => {
    if (isNoAnswerMode) return;
    const activeCardIndex = cardIndexRef.current;
    const card = deck.cards[activeCardIndex];
    if (!card || deadlineRef.current === 0 || isPausedRef.current || endingRef.current) return;
    const now = performance.now();
    const remainingMs = Math.max(0, deadlineRef.current - now);
    const stepElapsedMs = Math.max(0, stepStartedRemainingMsRef.current - remainingMs);
    const promptEndedAt = new Date().toISOString();
    deadlineRef.current = 0;
    const currentStep = stepRef.current;
    const state = stepAttemptsRef.current;
    const attempts = state[currentStep];
    const elapsedMs = FINGER_CARD_TIME_LIMIT_MS;
    if (currentStep === "target" && state.referenceCompleted) {
      enqueueAnswerEvent(
        makeFingerAnswerEvent({
          learningLevelId,
          attempts: [...state.reference],
          batch: card.batch,
          cardIndex: activeCardIndex,
          elapsedMs: state.reference.at(-1)?.atMs ?? elapsedMs,
          fingerHand,
          fingerNumber,
          inputMethod,
          isMissed: false,
          promptEndedAt: referencePromptEndedAtRef.current ?? promptEndedAt,
          promptStartedAt: referencePromptStartedAtRef.current,
          timeLimitMs: FINGER_CARD_TIME_LIMIT_MS,
          reference: card.reference,
          session,
          step: "reference",
          target: card.target,
        })
      );
    }
    enqueueAnswerEvent(
      makeFingerAnswerEvent({
        learningLevelId,
        attempts: [...attempts],
        batch: card.batch,
        cardIndex: activeCardIndex,
        elapsedMs: stepElapsedMs,
        fingerHand,
        fingerNumber,
        inputMethod,
        isMissed: true,
        promptEndedAt,
        promptStartedAt: stepPromptStartedAtRef.current,
        timeLimitMs: stepStartedRemainingMsRef.current,
        reference: card.reference,
        session,
        step: currentStep,
        target: card.target,
      })
    );
    const pair = summarizeStaffDistancePair(card.reference, card.target);
    const nextResults = [
      ...resultsRef.current,
      {
        ...pair,
        firstTryCorrect: false,
        responseMs: elapsedMs,
        wrongAttempts:
          state.reference.filter((attempt) => !attempt.isCorrect).length +
          state.target.filter((attempt) => !attempt.isCorrect).length,
        usedHint: false,
        targetPitchId: card.target.pitchId,
        fingerBatch: card.batch,
        referencePitchId: card.reference.pitchId,
        referenceFirstTryCorrect: state.referenceFirstTryCorrect ?? false,
        targetFirstTryCorrect: state.targetFirstTryCorrect ?? false,
        referenceCompleted: state.referenceCompleted,
        targetCompleted: state.targetCompleted,
        timedOut: true,
      },
    ];
    advanceAfterKeyboardRelease(nextResults, "本卡时间到，请松开所有手指进入下一张。");
  }, [
    advanceAfterKeyboardRelease,
    deck.cards,
    enqueueAnswerEvent,
    fingerHand,
    fingerNumber,
    inputMethod,
    isNoAnswerMode,
    learningLevelId,
    session,
  ]);
  const timeoutCardRef = useRef(timeoutCard);
  timeoutCardRef.current = timeoutCard;

  const answerPitch = useCallback(
    (answer: PracticeAnswerInput): void => {
      const activeCardIndex = cardIndexRef.current;
      const card = deck.cards[activeCardIndex];
      if (
        !card ||
        isPausedRef.current ||
        viewportBlockedRef.current ||
        endingRef.current ||
        isNoAnswerMode ||
        deck.error ||
        pendingKeyboardAdvanceRef.current !== null
      ) {
        return;
      }
      if (deadlineRef.current === 0 || performance.now() >= deadlineRef.current) {
        timeoutCardRef.current();
        return;
      }
      const now = performance.now();
      const remainingMs = Math.max(0, deadlineRef.current - now);
      const cardElapsedMs = Math.min(
        FINGER_CARD_TIME_LIMIT_MS,
        Math.max(0, FINGER_CARD_TIME_LIMIT_MS - remainingMs)
      );
      const stepElapsedMs = Math.min(
        stepStartedRemainingMsRef.current,
        Math.max(0, stepStartedRemainingMsRef.current - remainingMs)
      );
      const promptEndedAt = new Date().toISOString();
      const currentStep = stepRef.current;
      const expected = currentStep === "reference" ? card.reference : card.target;
      const answerMode = inputMethod === "microphone" ? "microphone" : "exact-pitch";
      const isCorrect =
        inputMethod === "virtual-keyboard"
          ? answer.source === "screen-keyboard" &&
            answer.midiNoteNumber === getTargetMidiNoteNumber(expected)
          : isPracticeAnswerCorrect(answer, expected, answerMode);
      const attempt: AnswerAttempt = {
        ...(answer.midiNoteNumber === undefined ? {} : { midi: answer.midiNoteNumber }),
        noteName: answer.noteName,
        atMs: stepElapsedMs,
        confidence: answer.confidence,
        inputMode: answerInputMode(answer.source),
        microphoneAlgorithm: answer.microphoneAlgorithm,
        isCorrect,
        clipping: answer.clipping ?? false,
      };
      const state = stepAttemptsRef.current;
      state[currentStep].push(attempt);

      if (!isCorrect) {
        setWrongFeedback(true);
        setWrongEdgePulse((pulse) => pulse + 1);
        setWrongIndex(currentStep === "reference" ? 0 : 1);
        setFeedback(null);
        if (wrongFeedbackTimerRef.current !== undefined) {
          window.clearTimeout(wrongFeedbackTimerRef.current);
        }
        wrongFeedbackTimerRef.current = window.setTimeout(() => {
          wrongFeedbackTimerRef.current = undefined;
          setWrongFeedback(false);
          setWrongIndex(undefined);
        }, WRONG_FEEDBACK_DURATION_MS);
        return;
      }

      if (currentStep === "reference") {
        state.referenceFirstTryCorrect = state.reference.length === 1;
        state.referenceCompleted = true;
        setStep("target");
        stepRef.current = "target";
        setCompletedNoteIndices([0]);
        setWrongIndex(undefined);
        setWrongFeedback(false);
        setFeedback(
          inputMethod === "virtual-keyboard"
            ? "参考音正确；可保持按住，也可先抬起，再按目标音。"
            : "参考音正确，请继续弹奏目标音。"
        );
        referencePromptEndedAtRef.current = promptEndedAt;
        stepStartedRemainingMsRef.current = remainingMs;
        stepPromptStartedAtRef.current = promptEndedAt;
        return;
      }

      state.targetFirstTryCorrect = state.target.length === 1;
      state.targetCompleted = true;
      enqueueAnswerEvent(
        makeFingerAnswerEvent({
          learningLevelId,
          attempts: [...state.reference],
          batch: card.batch,
          cardIndex: activeCardIndex,
          elapsedMs: state.reference.at(-1)?.atMs ?? stepElapsedMs,
          fingerHand,
          fingerNumber,
          inputMethod,
          isMissed: false,
          promptEndedAt: referencePromptEndedAtRef.current ?? promptEndedAt,
          promptStartedAt: referencePromptStartedAtRef.current,
          timeLimitMs: FINGER_CARD_TIME_LIMIT_MS,
          reference: card.reference,
          session,
          step: "reference",
          target: card.target,
        })
      );
      enqueueAnswerEvent(
        makeFingerAnswerEvent({
          learningLevelId,
          attempts: [...state.target],
          batch: card.batch,
          cardIndex: activeCardIndex,
          elapsedMs: stepElapsedMs,
          fingerHand,
          fingerNumber,
          inputMethod,
          isMissed: false,
          promptEndedAt,
          promptStartedAt: stepPromptStartedAtRef.current,
          timeLimitMs: stepStartedRemainingMsRef.current,
          reference: card.reference,
          session,
          step: "target",
          target: card.target,
        })
      );
      const pair = summarizeStaffDistancePair(card.reference, card.target);
      const nextResults = [
        ...resultsRef.current,
        {
          ...pair,
          firstTryCorrect:
            state.referenceFirstTryCorrect === true && state.targetFirstTryCorrect === true,
          responseMs: cardElapsedMs,
          wrongAttempts:
            state.reference.filter((item) => !item.isCorrect).length +
            state.target.filter((item) => !item.isCorrect).length,
          usedHint: false,
          targetPitchId: card.target.pitchId,
          fingerBatch: card.batch,
          referencePitchId: card.reference.pitchId,
          referenceFirstTryCorrect: state.referenceFirstTryCorrect === true,
          targetFirstTryCorrect: state.targetFirstTryCorrect === true,
          referenceCompleted: true,
          targetCompleted: true,
          timedOut: false,
        },
      ];
      setCompletedNoteIndices([0, 1]);
      setWrongIndex(undefined);
      setWrongFeedback(false);
      advanceAfterKeyboardRelease(nextResults, "本卡完成，请松开所有手指进入下一张。");
    },
    [
      advanceAfterKeyboardRelease,
      deck.cards,
      deck.error,
      enqueueAnswerEvent,
      fingerHand,
      fingerNumber,
      inputMethod,
      isNoAnswerMode,
      learningLevelId,
      session,
    ]
  );

  const togglePause = useCallback(async (): Promise<void> => {
    if (
      endingRef.current ||
      deck.error ||
      resumeInProgressRef.current ||
      viewportBlockedRef.current
    ) {
      return;
    }
    if (!isPausedRef.current) {
      const now = performance.now();
      if (activeStartedAtRef.current !== 0) {
        activeElapsedMsRef.current += Math.max(0, now - activeStartedAtRef.current);
      }
      activeStartedAtRef.current = 0;
      pausedRemainingMsRef.current = Math.max(0, deadlineRef.current - now);
      deadlineRef.current = 0;
      isPausedRef.current = true;
      setIsPaused(true);
      setIsResumeConnecting(false);
      setShowResumeConnecting(false);
      setRemainingMs(pausedRemainingMsRef.current);
      if (inputMethod === "microphone") microphone.stop();
      return;
    }
    if (inputMethod === "midi" && !midi.isConnected) {
      setInputError("MIDI 连接已断开；重新连接后可继续练习。");
      return;
    }
    if (inputMethod === "microphone") {
      resumeInProgressRef.current = true;
      setIsResumeConnecting(true);
      setShowResumeConnecting(false);
      const statusTimer = window.setTimeout(() => setShowResumeConnecting(true), 250);
      let ready = false;
      try {
        ready = await microphone.start({ includeAccidentals: false });
      } finally {
        window.clearTimeout(statusTimer);
        resumeInProgressRef.current = false;
        setIsResumeConnecting(false);
        setShowResumeConnecting(false);
      }
      if (!ready) {
        setInputError(microphone.error ?? "麦克风未能重新连接，请检查权限和输入设备。");
        return;
      }
    }
    const now = performance.now();
    activeStartedAtRef.current = now;
    deadlineRef.current = now + pausedRemainingMsRef.current;
    isPausedRef.current = false;
    setIsPaused(false);
    setInputError(null);
  }, [deck.error, inputMethod, microphone, midi.isConnected]);

  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  useEffect(() => {
    if (deck.error || isPaused || isViewportBlocked || isNoAnswerMode) return undefined;
    const timer = window.setInterval(() => {
      if (pendingKeyboardAdvanceRef.current) return;
      const remaining = Math.max(0, deadlineRef.current - performance.now());
      setRemainingMs(remaining);
      if (remaining <= 0) timeoutCardRef.current();
    }, 100);
    return () => window.clearInterval(timer);
  }, [cardIndex, deck.error, isNoAnswerMode, isPaused, isViewportBlocked]);

  useEffect(() => {
    if (isNoAnswerMode || inputMethod !== "midi") return undefined;
    return midiSubscribe((event) => {
      if (event.type !== "press" || !isNaturalPianoKey(event.note.keyName)) return;
      answerPitch({
        diagnosticSampleId: event.note.diagnosticSampleId,
        midiNoteNumber: event.note.midiNoteNumber,
        noteName: event.note.keyName,
        octave: event.note.octave,
        source: "midi",
      });
    });
  }, [answerPitch, inputMethod, isNoAnswerMode, midiSubscribe]);

  useEffect(() => {
    if (isNoAnswerMode || inputMethod !== "microphone") {
      onMicrophoneAnswerHandlerChange(null);
      return undefined;
    }
    onMicrophoneAnswerHandlerChange(answerPitch);
    return () => onMicrophoneAnswerHandlerChange(null);
  }, [answerPitch, inputMethod, isNoAnswerMode, onMicrophoneAnswerHandlerChange]);

  useEffect(() => {
    onRunningChange(true);
    return () => {
      onRunningChange(false);
      if (wrongFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(wrongFeedbackTimerRef.current);
      }
      if (inputMethod === "microphone") stopMicrophoneRef.current();
    };
  }, [inputMethod, onRunningChange]);

  useEffect(() => {
    const pauseWhenInactive = (): void => {
      if (
        !noAnswerModeRef.current &&
        document.visibilityState === "hidden" &&
        !isPausedRef.current
      ) {
        void togglePauseRef.current();
      }
    };
    const pauseOnWindowBlur = (): void => {
      if (!noAnswerModeRef.current && !isPausedRef.current) void togglePauseRef.current();
    };
    document.addEventListener("visibilitychange", pauseWhenInactive);
    window.addEventListener("blur", pauseOnWindowBlur);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenInactive);
      window.removeEventListener("blur", pauseOnWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!navigationExitRequest || handledExitRequestRef.current === navigationExitRequest.id) {
      return;
    }
    handledExitRequestRef.current = navigationExitRequest.id;
    void finish("manual-stop", false).then(() => {
      onNavigationExit?.(navigationExitRequest.targetView);
    });
  }, [finish, navigationExitRequest, onNavigationExit]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (noAnswerModeRef.current) return;
      if (
        event.code === "Space" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.isComposing &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            event.target.closest("input, textarea, select, [contenteditable='true']"))
        )
      ) {
        event.preventDefault();
        void togglePauseRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (isNoAnswerMode || isPausedRef.current) return;
    if (inputMethod === "midi" && !midi.isConnected) {
      setInputError("MIDI 连接已断开；练习已暂停，请重新连接后继续。");
      void togglePauseRef.current();
    } else if (inputMethod === "microphone" && microphone.status === "error") {
      setInputError(microphone.error ?? "麦克风连接已中断；练习已暂停。");
      void togglePauseRef.current();
    }
  }, [inputMethod, isNoAnswerMode, microphone.error, microphone.status, midi.isConnected]);

  const restart = async (
    fingerInteractionMode: StaffDistanceFingerInteractionMode = session.staffDistance
      ?.fingerInteractionMode ?? "play"
  ): Promise<void> => {
    if (!onRestart || endingRef.current || isRestarting) return;
    const now = performance.now();
    const activePracticeMs =
      activeElapsedMsRef.current +
      (activeStartedAtRef.current === 0 ? 0 : Math.max(0, now - activeStartedAtRef.current));
    endingRef.current = true;
    pendingKeyboardAdvanceRef.current = null;
    activeKeyboardTouchPointerIdsRef.current.clear();
    setIsRestarting(true);
    deadlineRef.current = 0;
    isPausedRef.current = true;
    setIsPaused(true);
    if (inputMethod === "microphone") microphone.stop();
    try {
      await answerEventSaveQueueRef.current;
      await onRestart(fingerInteractionMode, activePracticeMs);
    } catch (error) {
      endingRef.current = false;
      setInputError(error instanceof Error ? error.message : "重置练习失败，请重试。");
    } finally {
      setIsRestarting(false);
    }
  };

  const showNoAnswerAnswer = (): void => {
    setIsAnswerRevealed(true);
  };

  if (deck.error || !currentCard) {
    return (
      <section className="staff-distance-run-shell" role="alert">
        <h1>无法生成单指专项</h1>
        <p>{deck.error ?? "题目已结束，请返回设置页重新开始。"}</p>
        <button className="primary" onClick={() => void finish("manual-stop", false)} type="button">
          返回设置
        </button>
      </section>
    );
  }

  const cardNumber = cardIndex + 1;
  const activeNoteIndex = isNoAnswerMode ? 1 : step === "reference" ? 0 : 1;
  const progressValue = Math.max(0, Math.min(FINGER_CARD_TIME_LIMIT_MS, remainingMs));
  const progressText = `${(progressValue / 1000).toFixed(1)} 秒`;
  const handLabel = fingerHand === "right" ? "右手" : "左手";
  const batchLabel = currentCard.batch === "line" ? "线上参考音" : "间上参考音";
  const inputPrompt = step === "reference" ? "参考音" : "目标音";
  const lineReferenceNote =
    deck.cards.find((card) => card.batch === "line")?.reference ?? currentCard.reference;

  return (
    <section
      aria-label="音距速推单指专项"
      className={`staff-distance-run-shell staff-distance-finger-run${inputMethod === "virtual-keyboard" ? " is-virtual-keyboard" : ""}${isNoAnswerMode ? " is-no-answer-mode" : ""}`}
      ref={runShellRef}
    >
      <header className="staff-distance-run-header">
        <div>
          <h1>音距速推 · 单指专项</h1>
          <p>
            {handLabel} · {fingerNumber} 指 · {batchLabel} · 第 {cardNumber} / {FINGER_CARD_COUNT}{" "}
            张
          </p>
        </div>
        <div className="staff-distance-run-actions">
          <div className="practice-run-core-actions">
            <button
              aria-label="结束练习并返回配置"
              disabled={isPaused}
              onClick={() => void finish("manual-stop", false)}
              title="结束练习并返回配置"
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              结束返回
            </button>
            {!isNoAnswerMode ? (
              <button disabled={isPaused} onClick={() => void togglePause()} type="button">
                {isPaused ? <Play size={16} /> : <Pause size={16} />}
                {isPaused ? "继续" : "暂停"}
              </button>
            ) : null}
            {onRestart && !isPaused ? (
              <button
                aria-label="重新开始当前练习"
                disabled={isRestarting}
                onClick={() => void restart()}
                title="重新开始当前练习"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={16} />
                重新开始
              </button>
            ) : null}
            <button aria-haspopup="dialog" onClick={() => setShowInstructions(true)} type="button">
              <CircleHelp aria-hidden="true" size={16} />
              操作说明
            </button>
          </div>
          {!isNoAnswerMode && inputMethod === "midi" ? (
            <MidiInputControl
              ariaLabel="单指专项 MIDI 输入设备"
              className={`${!midi.isConnected ? "needs-attention " : ""}staff-distance-run-midi-control`}
              midi={midi}
            />
          ) : null}
          <PracticeFullscreenToggle />
        </div>
      </header>

      <div className="staff-distance-finger-card">
        <div className="staff-distance-finger-card-meta">
          <span>
            {fingerClefLabel} · {batchLabel}
          </span>
          {isNoAnswerMode ? (
            <span>免答模式 · 不限时</span>
          ) : (
            <span aria-live="polite">本卡剩余 {progressText}</span>
          )}
        </div>
        {!isNoAnswerMode ? (
          <progress
            aria-label="本卡剩余时间"
            className="staff-distance-finger-timer"
            max={FINGER_CARD_TIME_LIMIT_MS}
            value={progressValue}
          />
        ) : null}
        <div
          aria-label={`${handLabel}${fingerNumber}指专项卡片 ${cardNumber}/${FINGER_CARD_COUNT}`}
          className="staff-distance-score-wrap staff-distance-finger-score"
          role="group"
        >
          <StaffPagePrompt
            completedCount={isNoAnswerMode ? 0 : activeNoteIndex}
            completedNoteIndices={completedNoteIndices}
            notes={scoreNotes}
            layout={
              showsFingerKeyboard
                ? FINGER_PRACTICE_STAFF_LAYOUT
                : FINGER_PRACTICE_COMPACT_STAFF_LAYOUT
            }
            noteLabelsAbove={scoreNoteLabels}
            noteLabelsAboveStaffTopLinePx={50}
            currentNoteIndicatorIndex={activeNoteIndex}
            noteDuration="quarter"
            noteDurations={FINGER_NOTE_DURATIONS}
            noteMeasures={FINGER_NOTE_MEASURES}
            noteOnsets={FINGER_NOTE_ONSETS}
            noteBeamGroups={FINGER_NOTE_BEAM_GROUPS}
            beatsPerMeasure={4}
            timeSignature="4/4"
            staffNotationMode={staffNotationMode}
            useLedgerGap={useLedgerGap}
            noteCenterGapPx={PRACTICE_STAFF_REFERENCE_NOTE_COLUMN_WIDTH_PX}
            notesPerRow={2}
            maxRowCount={1}
            visibleRowCount={1}
            minDisplayWidthPx={0}
            wrongIndex={wrongIndex}
            activePairStartIndex={activeNoteIndex}
          />
        </div>
      </div>

      {!isNoAnswerMode ? (
        <p
          aria-live={wrongFeedback ? "assertive" : "polite"}
          className={`staff-distance-question-copy${inputMethod === "virtual-keyboard" ? " is-virtual-keyboard" : ""}${wrongFeedback ? " is-error" : ""}`}
        >
          {wrongFeedback
            ? "音高不对，请再试一次；计时继续。"
            : (feedback ??
              (step === "reference"
                ? `请先弹奏标注 ${fingerNumber} 指的参考音，再弹目标音。`
                : inputMethod === "virtual-keyboard"
                  ? "参考音已弹对；可保持按住或先抬起，再按目标音。"
                  : "参考音已弹对，请弹奏第二个目标音。"))}
        </p>
      ) : null}
      {showsFingerKeyboard && currentCard && !isViewportBlocked && !isNoAnswerComplete ? (
        <StaffDistanceFingerKeyboard
          containerRef={keyboardRef}
          disabled={isPaused || isViewportBlocked}
          fingerNumber={fingerNumber}
          highlightedMidi={getTargetMidiNoteNumber(currentCard.reference)}
          answerHighlightedMidi={
            isNoAnswerMode && isAnswerRevealed
              ? getTargetMidiNoteNumber(currentCard.target)
              : undefined
          }
          answerFinger={isNoAnswerMode ? targetFinger : undefined}
          keyboardHeightCapPx={isNoAnswerMode ? readOnlyKeyboardHeightCapPx : undefined}
          keyboardHeightPx={keyboardHeightPx}
          keyboardScale={keyboardScale}
          readOnlyResponsive={isNoAnswerMode}
          lowerKeyCount={fingerProfile.lower}
          onKeyPress={({ midi, noteName, octave }) =>
            answerPitch({
              midiNoteNumber: midi,
              noteName,
              octave,
              source: "screen-keyboard",
            })
          }
          onTouchPointerEnd={handleKeyboardTouchEnd}
          onTouchPointerStart={handleKeyboardTouchStart}
          rangeReferenceMidi={getTargetMidiNoteNumber(lineReferenceNote)}
        />
      ) : null}
      {isNoAnswerMode && !isNoAnswerComplete ? (
        <div
          aria-label="免答模式操作"
          className={`staff-distance-question-actions is-${fingerHand}-hand`}
        >
          {inputError ? <p role="alert">{inputError}</p> : null}
          {isAnswerRevealed ? (
            <button className="primary" onClick={advanceNoAnswerCard} type="button">
              下一个
            </button>
          ) : (
            <button onClick={showNoAnswerAnswer} type="button">
              查看答案
            </button>
          )}
        </div>
      ) : null}
      {isNoAnswerComplete ? (
        <section
          aria-label="免答练习已完成"
          aria-live="polite"
          aria-labelledby="staff-distance-no-answer-complete-title"
          className="staff-distance-no-answer-complete"
        >
          <h2 id="staff-distance-no-answer-complete-title">本轮浏览完成</h2>
          <p>已浏览全部 {FINGER_CARD_COUNT} 张卡片。免答练习不统计正确率。</p>
          <div>
            {onRestart ? (
              <button onClick={() => void restart("no-answer")} type="button">
                再看一轮
              </button>
            ) : null}
            <button
              className="primary"
              onClick={() => void finish("completed-count", false)}
              type="button"
            >
              返回设置
            </button>
          </div>
        </section>
      ) : null}
      {!isNoAnswerMode ? (
        <div
          aria-live="polite"
          className={`staff-distance-play-input-status${inputMethod === "virtual-keyboard" && !inputError ? " is-virtual-keyboard-redundant" : ""}`}
        >
          {inputError ? (
            inputError
          ) : inputMethod === "midi" ? (
            `请弹奏 MIDI 键盘上的${inputPrompt}${midi.selectedInput?.name ? ` · ${midi.selectedInput.name}` : ""}`
          ) : inputMethod === "virtual-keyboard" ? (
            `按下钢琴键盘上的${inputPrompt}作答`
          ) : microphone.status === "listening" ? (
            `麦克风已连接，请弹奏${inputPrompt}`
          ) : microphone.status === "requesting" && !isPaused ? (
            <LoadingActivityText kind={microphone.isPreparingSwiftF0 ? "dots" : "spinner"}>
              {microphone.isPreparingSwiftF0 ? "正在准备识别模型" : "正在连接麦克风"}
            </LoadingActivityText>
          ) : isPaused ? (
            "麦克风已暂停"
          ) : (
            (microphone.error ?? "麦克风未连接")
          )}
          {inputMethod === "microphone" && (microphone.error || microphone.status === "error") ? (
            <PracticeMicrophoneRetryButton
              isConnecting={false}
              onRetry={async () => {
                const ready = await microphone.start({ includeAccidentals: false });
                if (ready) setInputError(null);
                return ready;
              }}
            />
          ) : null}
        </div>
      ) : null}
      {isPaused && !isNoAnswerMode ? (
        <div className="staff-distance-pause-overlay">
          <div className="staff-distance-pause-content" role="status">
            <strong>已暂停</strong>
            <span>
              {inputError ? (
                inputError
              ) : showResumeConnecting ? (
                <LoadingActivityText kind="dots">
                  {microphone.isPreparingSwiftF0 ? "正在准备识别模型" : "正在连接麦克风"}
                </LoadingActivityText>
              ) : (
                `计时已停止，当前卡片还剩 ${progressText}`
              )}
            </span>
            <button
              className="primary practice-pause-resume-button"
              disabled={isResumeConnecting}
              onClick={() => void togglePause()}
              type="button"
            >
              <Play size={16} />
              继续
            </button>
            {inputMethod === "microphone" && (microphone.error || microphone.status === "error") ? (
              <PracticeMicrophoneRetryButton
                isConnecting={false}
                isPreparingModel={microphone.isPreparingSwiftF0}
                onRetry={async () => {
                  const ready = await microphone.start({ includeAccidentals: false });
                  if (ready) setInputError(null);
                  return ready;
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {isViewportBlocked ? (
        <div className="staff-distance-orientation-overlay" role="status">
          <div className="staff-distance-orientation-card">
            <strong>
              {keyboardFitsEitherOrientation
                ? viewportSize.height > viewportSize.width
                  ? "请旋转设备"
                  : "请调整屏幕方向"
                : "钢琴键盘宽度不足"}
            </strong>
            <span>
              {keyboardFitsEitherOrientation
                ? viewportSize.height > viewportSize.width
                  ? "当前竖屏宽度不足以展示所选尺寸的钢琴键盘，请旋转设备后继续。"
                  : "当前屏幕宽度不足以展示所选尺寸的钢琴键盘，旋转设备后可使用当前尺寸。"
                : `当前${viewportSize.width >= viewportSize.height ? "横屏" : "屏幕"}可用宽度仍不足以展示所选尺寸的钢琴键盘，请返回设置调小尺寸。`}
            </span>
            <button onClick={() => void finish("manual-stop", false)} type="button">
              返回设置
            </button>
          </div>
        </div>
      ) : null}
      {wrongEdgePulse > 0
        ? createPortal(
            <div
              key={wrongEdgePulse}
              aria-hidden="true"
              className="staff-distance-wrong-edge"
              onAnimationEnd={() => {
                setWrongEdgePulse((pulse) => (pulse === wrongEdgePulse ? 0 : pulse));
              }}
            />,
            document.body
          )
        : null}
      {showInstructions ? (
        <dialog
          aria-labelledby="staff-distance-finger-help-title"
          className="staff-distance-finger-help-dialog"
          onCancel={(event) => {
            event.preventDefault();
            setShowInstructions(false);
          }}
          onClose={() => setShowInstructions(false)}
          ref={instructionsDialogRef}
        >
          <div className="staff-distance-finger-help-heading">
            <h2 id="staff-distance-finger-help-title">单指专项操作说明</h2>
            <button
              aria-label="关闭操作说明"
              onClick={() => setShowInstructions(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          {isNoAnswerMode ? (
            <section>
              <h3>免答模式</h3>
              <p>
                先看谱面，在心里判断目标音和建议手指；点击“查看答案”后，只读琴键图会高亮目标音并标出建议指法。琴键图只供看位置，不能触键作答；再点“下一个”继续。免答模式不检测弹奏、不计时、不统计正确率，手机竖屏也可使用。
              </p>
            </section>
          ) : (
            <section>
              <h3>普通作答</h3>
              <p>
                先弹奏标注手指的参考音，再弹目标音；答错可重试。每张卡片限时 5
                秒，超时后自动进入下一张。练习方式在配置页选择；如需切换，请结束本轮并返回配置页。
              </p>
            </section>
          )}
          <button
            className="primary staff-distance-finger-help-done"
            onClick={() => setShowInstructions(false)}
            type="button"
          >
            知道了
          </button>
        </dialog>
      ) : null}
    </section>
  );
}
