import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnswerAttempt,
  AnswerEvent,
  PracticeSessionRecord,
  StaffDistanceFingerBatch,
  StaffDistanceFingerHand,
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
import { createStaffDistanceFingerCards } from "../../../domain/staffDistanceFinger";
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

const FINGER_CARD_COUNT = 28;
const FINGER_CARD_TIME_LIMIT_MS = 5_000;
const WRONG_FEEDBACK_DURATION_MS = 450;
const FINGER_NOTE_DURATIONS = ["quarter", "quarter"] as const;
const FINGER_NOTE_MEASURES = [0, 0] as const;
const FINGER_NOTE_ONSETS = [0, 1] as const;
const FINGER_NOTE_BEAM_GROUPS = [0, 1] as const;

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
  fingerHand: StaffDistanceFingerHand;
  fingerNumber: StaffDistanceFingerNumber;
  inputMethod: "midi" | "microphone";
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
  onRestart?: () => Promise<void>;
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
  attempts: AnswerAttempt[];
  batch: StaffDistanceFingerBatch;
  cardIndex: number;
  elapsedMs: number;
  fingerHand: StaffDistanceFingerHand;
  fingerNumber: StaffDistanceFingerNumber;
  inputMethod: "midi" | "microphone";
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
  fingerHand,
  fingerNumber,
  inputMethod,
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
  const [deck] = useState(() => createStaffDistanceFingerCards(notes, fingerHand, fingerNumber));
  const [cardIndex, setCardIndex] = useState(0);
  const [step, setStep] = useState<FingerStep>("reference");
  const [completedNoteIndices, setCompletedNoteIndices] = useState<number[]>([]);
  const [wrongIndex, setWrongIndex] = useState<number | undefined>();
  const [wrongFeedback, setWrongFeedback] = useState(false);
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
  const stopMicrophoneRef = useRef(microphone.stop);
  stopMicrophoneRef.current = microphone.stop;
  const currentCard = deck.cards[cardIndex];
  const scoreNotes = useMemo(
    () => (currentCard ? [currentCard.reference, currentCard.target] : []),
    [currentCard]
  );
  const scoreNoteLabels = useMemo(() => [`${fingerNumber}指`, "目标"], [fingerNumber]);
  const details = session.staffDistance!;
  const fingerClefLabel = fingerHand === "right" ? "高音谱" : "低音谱";
  const midiSubscribe = midi.subscribe;
  const enqueueAnswerEvent = useCallback((event: AnswerEvent): void => {
    answerEventSaveQueueRef.current = answerEventSaveQueueRef.current
      .then(() => saveAnswerEvents([event]))
      .catch((error: unknown) => {
        console.error("Failed to save single-finger staff-distance answer event", error);
      });
  }, []);

  const finish = useCallback(
    async (endReason: PracticeSessionRecord["endReason"], showSummary: boolean): Promise<void> => {
      if (endingRef.current) return;
      endingRef.current = true;
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
      deadlineRef.current = isPausedRef.current ? 0 : performance.now() + FINGER_CARD_TIME_LIMIT_MS;
      stepStartedRemainingMsRef.current = FINGER_CARD_TIME_LIMIT_MS;
      referencePromptStartedAtRef.current = new Date().toISOString();
      stepPromptStartedAtRef.current = referencePromptStartedAtRef.current;
      referencePromptEndedAtRef.current = undefined;
    },
    [deck.cards.length]
  );

  const timeoutCard = useCallback((): void => {
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
    advanceCard(nextResults);
  }, [advanceCard, deck.cards, enqueueAnswerEvent, fingerHand, fingerNumber, inputMethod, session]);
  const timeoutCardRef = useRef(timeoutCard);
  timeoutCardRef.current = timeoutCard;

  const answerPitch = useCallback(
    (answer: PracticeAnswerInput): void => {
      const activeCardIndex = cardIndexRef.current;
      const card = deck.cards[activeCardIndex];
      if (!card || isPausedRef.current || endingRef.current || deck.error) return;
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
      const answerMode = inputMethod === "midi" ? "exact-pitch" : "microphone";
      const isCorrect = isPracticeAnswerCorrect(answer, expected, answerMode);
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
        setFeedback("参考音正确，请继续弹奏目标音。");
        referencePromptEndedAtRef.current = promptEndedAt;
        stepStartedRemainingMsRef.current = remainingMs;
        stepPromptStartedAtRef.current = promptEndedAt;
        return;
      }

      state.targetFirstTryCorrect = state.target.length === 1;
      state.targetCompleted = true;
      enqueueAnswerEvent(
        makeFingerAnswerEvent({
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
      advanceCard(nextResults);
    },
    [
      advanceCard,
      deck.cards,
      deck.error,
      enqueueAnswerEvent,
      fingerHand,
      fingerNumber,
      inputMethod,
      session,
    ]
  );

  const togglePause = useCallback(async (): Promise<void> => {
    if (endingRef.current || deck.error || resumeInProgressRef.current) return;
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
    if (deck.error || isPaused) return undefined;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, deadlineRef.current - performance.now());
      setRemainingMs(remaining);
      if (remaining <= 0) timeoutCardRef.current();
    }, 100);
    return () => window.clearInterval(timer);
  }, [cardIndex, deck.error, isPaused]);

  useEffect(() => {
    if (inputMethod !== "midi") return undefined;
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
  }, [answerPitch, inputMethod, midiSubscribe]);

  useEffect(() => {
    if (inputMethod !== "microphone") {
      onMicrophoneAnswerHandlerChange(null);
      return undefined;
    }
    onMicrophoneAnswerHandlerChange(answerPitch);
    return () => onMicrophoneAnswerHandlerChange(null);
  }, [answerPitch, inputMethod, onMicrophoneAnswerHandlerChange]);

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
      if (document.visibilityState === "hidden" && !isPausedRef.current) {
        void togglePauseRef.current();
      }
    };
    const pauseOnWindowBlur = (): void => {
      if (!isPausedRef.current) void togglePauseRef.current();
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
    if (isPausedRef.current) return;
    if (inputMethod === "midi" && !midi.isConnected) {
      setInputError("MIDI 连接已断开；练习已暂停，请重新连接后继续。");
      void togglePauseRef.current();
    } else if (inputMethod === "microphone" && microphone.status === "error") {
      setInputError(microphone.error ?? "麦克风连接已中断；练习已暂停。");
      void togglePauseRef.current();
    }
  }, [inputMethod, microphone.error, microphone.status, midi.isConnected]);

  const restart = async (): Promise<void> => {
    if (!onRestart || endingRef.current || isRestarting) return;
    endingRef.current = true;
    setIsRestarting(true);
    deadlineRef.current = 0;
    isPausedRef.current = true;
    setIsPaused(true);
    if (inputMethod === "microphone") microphone.stop();
    try {
      await answerEventSaveQueueRef.current;
      await onRestart();
    } catch (error) {
      endingRef.current = false;
      setInputError(error instanceof Error ? error.message : "重置练习失败，请重试。");
    } finally {
      setIsRestarting(false);
    }
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
  const activeNoteIndex = step === "reference" ? 0 : 1;
  const progressValue = Math.max(0, Math.min(FINGER_CARD_TIME_LIMIT_MS, remainingMs));
  const progressText = `${(progressValue / 1000).toFixed(1)} 秒`;
  const handLabel = fingerHand === "right" ? "右手" : "左手";
  const batchLabel = currentCard.batch === "line" ? "线上参考音" : "间上参考音";
  const inputPrompt = step === "reference" ? "参考音" : "目标音";

  return (
    <section
      aria-label="音距速推单指专项"
      className="staff-distance-run-shell staff-distance-finger-run"
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
            <button disabled={isPaused} onClick={() => void togglePause()} type="button">
              {isPaused ? <Play size={16} /> : <Pause size={16} />}
              {isPaused ? "继续" : "暂停"}
            </button>
            {onRestart ? (
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
          </div>
          {inputMethod === "midi" ? (
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
          <span aria-live="polite">本卡剩余 {progressText}</span>
        </div>
        <progress
          aria-label="本卡剩余时间"
          className="staff-distance-finger-timer"
          max={FINGER_CARD_TIME_LIMIT_MS}
          value={progressValue}
        />
        <div
          aria-label={`${handLabel}${fingerNumber}指专项卡片 ${cardNumber}/${FINGER_CARD_COUNT}`}
          className="staff-distance-score-wrap staff-distance-finger-score"
          role="group"
        >
          <StaffPagePrompt
            completedCount={activeNoteIndex}
            completedNoteIndices={completedNoteIndices}
            notes={scoreNotes}
            noteLabelsAbove={scoreNoteLabels}
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

      <p aria-live="polite" className="staff-distance-question-copy">
        {feedback ??
          (step === "reference"
            ? `请先弹奏标注 ${fingerNumber} 指的参考音，再弹目标音。`
            : "参考音已弹对，请弹奏第二个目标音。")}
      </p>
      {wrongFeedback ? (
        <p aria-live="assertive" className="staff-distance-finger-error">
          音高不对，请再试一次；计时继续。
        </p>
      ) : null}
      <div aria-live="polite" className="staff-distance-play-input-status">
        {inputError ? (
          inputError
        ) : inputMethod === "midi" ? (
          `请弹奏 MIDI 键盘上的${inputPrompt}${midi.selectedInput?.name ? ` · ${midi.selectedInput.name}` : ""}`
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
      {isPaused ? (
        <div className="staff-distance-pause-overlay" role="status">
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
          {onRestart ? (
            <button
              className="practice-pause-restart-button"
              disabled={isRestarting}
              onClick={() => void restart()}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={16} />
              重新开始
            </button>
          ) : null}
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
      ) : null}
    </section>
  );
}
