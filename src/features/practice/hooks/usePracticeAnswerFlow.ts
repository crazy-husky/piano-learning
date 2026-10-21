import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { playPianoNote } from "../../../audio/piano";
import {
  completeMidiLatencySample,
  markMidiLatencyStage,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
  setMidiLatencyCondition,
} from "../../../diagnostics/midiLatencyDiagnostics";
import {
  isPracticeAnswerCorrect,
  isPracticeAnswerSourceAllowed,
  getTargetMidiNoteNumber,
  type PracticeAnswerInput,
} from "../../../domain/answerInput";
import type {
  AnswerAttempt,
  InterruptReason,
  NoteName,
  Octave,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PracticeSessionStartSnapshot,
  ReviewRecord,
  TargetNote,
} from "../../../domain/types";
import type {
  CompletePracticeSessionOptions,
  PracticePromptRuntime,
  PracticeStaffPageRuntime,
} from "./usePracticeSessionLifecycle";
import type { PracticeTimers } from "./usePracticeTimers";

interface PracticeAnswerFeedback {
  diagnosticSampleId?: number;
  type: "wrong" | "correct";
  noteName?: NoteName;
}

interface PracticeStaffPageStartInput {
  nextCompletedCount: number;
  sourceDrillNoteNames: NoteName[];
  sourceNotes: TargetNote[];
  sourceQueueStrategy: PracticeQueueStrategy;
  sourceReviews: ReviewRecord[];
}

interface PracticeAnswerFlowValues {
  answerPitchMode: "microphone" | "exact-pitch" | "note-name";
  completedCount: number;
  correctDelayMs: number;
  drillNoteNames: NoteName[];
  enabledNotes: TargetNote[];
  fixedCount: number;
  mode: PracticeMode;
  playAnswerNote: boolean;
  promptDisplayMode: "single-note" | "staff-page";
  queueStrategy: PracticeQueueStrategy;
  schedulerReviews: ReviewRecord[];
}

interface PracticeAnswerFlowRuntime {
  answerInputLockedRef: MutableRefObject<boolean>;
  isPausedRef: MutableRefObject<boolean>;
  pendingAfterPauseRef: MutableRefObject<(() => void) | null>;
  promptRef: MutableRefObject<PracticePromptRuntime | null>;
  sessionRef: MutableRefObject<PracticeSessionRecord | null>;
  sessionReviewsRef: MutableRefObject<ReviewRecord[]>;
  sessionStartSnapshotRef: MutableRefObject<PracticeSessionStartSnapshot | null>;
  staffPageRef: MutableRefObject<PracticeStaffPageRuntime | null>;
}

type CompleteSession = (
  endReason: PracticeSessionRecord["endReason"],
  unfinishedReason?: InterruptReason,
  options?: CompletePracticeSessionOptions
) => Promise<void>;

interface PracticeAnswerFlowServices {
  completeSession: CompleteSession;
  finishCurrentReview: (
    answeredCorrectly: boolean,
    interruptReason?: InterruptReason
  ) => Promise<ReviewRecord | null>;
  getPromptActiveMs: PracticeTimers["getPromptActiveMs"];
  markCurrentStaffPageNoteComplete: () => void;
  markPromptInput: () => void;
  maybeBackupDuringOpenEnded: (nextCompletedCount: number) => Promise<void>;
  recordStaffPageChaseTarget: () => void;
  resumeActiveTimers: () => void;
  selectAndStartNext: (nextCompletedCount: number) => void;
  startStaffPage: (input: PracticeStaffPageStartInput) => void;
  startStaffPageIndex: (index: number) => boolean;
  startStaffPageScroll: (nextCompletedCount: number, nextIndex: number) => boolean;
}

interface PracticeAnswerFlowUi {
  setCompletedCount: Dispatch<SetStateAction<number>>;
  setFeedback: Dispatch<SetStateAction<PracticeAnswerFeedback | null>>;
  setWrongAnswerCount: Dispatch<SetStateAction<number>>;
}

interface UsePracticeAnswerFlowOptions {
  runtime: PracticeAnswerFlowRuntime;
  services: PracticeAnswerFlowServices;
  ui: PracticeAnswerFlowUi;
  values: PracticeAnswerFlowValues;
}

export function usePracticeAnswerFlow({
  runtime,
  services,
  ui,
  values,
}: UsePracticeAnswerFlowOptions) {
  const {
    answerPitchMode,
    completedCount,
    correctDelayMs,
    drillNoteNames,
    enabledNotes,
    fixedCount,
    mode,
    playAnswerNote,
    promptDisplayMode,
    queueStrategy,
    schedulerReviews,
  } = values;
  const {
    answerInputLockedRef,
    isPausedRef,
    pendingAfterPauseRef,
    promptRef,
    sessionRef,
    sessionReviewsRef,
    sessionStartSnapshotRef,
    staffPageRef,
  } = runtime;
  const {
    completeSession,
    finishCurrentReview,
    getPromptActiveMs,
    markCurrentStaffPageNoteComplete,
    markPromptInput,
    maybeBackupDuringOpenEnded,
    recordStaffPageChaseTarget,
    resumeActiveTimers,
    selectAndStartNext,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
  } = services;
  const { setCompletedCount, setFeedback, setWrongAnswerCount } = ui;
  const settings = { correctDelayMs };

  const submitAnswer = useCallback(
    async (answer: PracticeAnswerInput): Promise<void> => {
      if (!isPracticeAnswerSourceAllowed(answer, answerPitchMode)) {
        return;
      }
      const prompt = promptRef.current;
      if (!prompt || isPausedRef.current || answerInputLockedRef.current) {
        return;
      }
      const diagnosticSampleId = answer.diagnosticSampleId;
      const correctDelayMs =
        sessionStartSnapshotRef.current?.interactionConfig.correctDelayMs ??
        settings.correctDelayMs;
      markMidiLatencyStage(diagnosticSampleId, "submitStarted");
      if (MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
        setMidiLatencyCondition(diagnosticSampleId, {
          answerPitchMode,
          correctDelayMs,
          playAnswerNote,
          promptDisplayMode,
        });
      }
      markPromptInput();
      if (playAnswerNote) {
        const answerOctave = answer.octave;
        if (answerOctave === undefined || (answerOctave >= 1 && answerOctave <= 6)) {
          const playbackOctave =
            answerOctave === undefined ? prompt.note.octave : (answerOctave as Octave);
          markMidiLatencyStage(diagnosticSampleId, "audioRequested");
          void playPianoNote(answer.noteName, playbackOctave).then(
            () => markMidiLatencyStage(diagnosticSampleId, "audioReady"),
            () => markMidiLatencyStage(diagnosticSampleId, "audioReady")
          );
        }
      }
      const answeredCorrectly = isPracticeAnswerCorrect(answer, prompt.note, answerPitchMode);
      markMidiLatencyStage(diagnosticSampleId, "verdict");
      const inputMode: AnswerAttempt["inputMode"] =
        answer.source === "microphone"
          ? "microphone"
          : answer.source === "midi"
            ? "midi"
            : answer.source === "screen-keyboard"
              ? "virtual-keyboard"
              : "computer-keyboard";
      const atActiveMs = getPromptActiveMs();
      const answerOctave = answer.octave;
      const answerMidi =
        answer.midiNoteNumber ??
        (answerOctave !== undefined &&
        Number.isInteger(answerOctave) &&
        answerOctave >= 1 &&
        answerOctave <= 6
          ? getTargetMidiNoteNumber({
              noteName: answer.noteName,
              octave: answerOctave as 1 | 2 | 3 | 4 | 5 | 6,
            })
          : undefined);
      prompt.answerAttempts.push({
        midi: answerMidi,
        noteName: answer.noteName,
        atMs: atActiveMs,
        confidence: answer.confidence,
        inputMode,
        microphoneAlgorithm: answer.microphoneAlgorithm,
        isCorrect: answeredCorrectly,
        clipping: answer.clipping ?? false,
      });
      if (!answeredCorrectly) {
        completeMidiLatencySample(diagnosticSampleId, "wrong");
        prompt.wrongAnswers.push({
          noteName: answer.noteName,
          atActiveMs,
          confidence: answer.confidence,
          clipping: answer.clipping,
          inputMode,
          microphoneAlgorithm: answer.microphoneAlgorithm,
          midiNoteNumber: answer.midiNoteNumber,
        });
        setWrongAnswerCount((count) => count + 1);
        markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
        setFeedback({ diagnosticSampleId, type: "wrong", noteName: answer.noteName });
        window.setTimeout(
          () => setFeedback((current) => (current?.type === "wrong" ? null : current)),
          450
        );
        return;
      }

      answerInputLockedRef.current = true;
      completeMidiLatencySample(diagnosticSampleId, "correct");
      markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
      setFeedback({ diagnosticSampleId, type: "correct", noteName: answer.noteName });
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeStarted");
      const review = await finishCurrentReview(true);
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeEnded");
      if (!review) {
        return;
      }
      const nextCompletedCount = completedCount + 1;
      setCompletedCount(nextCompletedCount);
      if (promptDisplayMode === "staff-page") {
        markCurrentStaffPageNoteComplete();
        recordStaffPageChaseTarget();
      }
      await maybeBackupDuringOpenEnded(nextCompletedCount);
      const reviewSessionId = review.sessionId;

      const continueAfterCorrectDelay = (): void => {
        if (sessionRef.current?.id !== reviewSessionId || sessionRef.current.endedAt) {
          return;
        }
        if (mode === "fixed-count" && nextCompletedCount >= fixedCount) {
          void completeSession("completed-count");
          return;
        }
        if (promptDisplayMode === "staff-page") {
          const page = staffPageRef.current;
          const nextIndex = page ? page.index + 1 : 0;
          if (page && startStaffPageScroll(nextCompletedCount, nextIndex)) {
            return;
          }
          resumeActiveTimers();
          if (page && startStaffPageIndex(nextIndex)) {
            return;
          }
          startStaffPage({
            sourceNotes: enabledNotes,
            sourceReviews: [...schedulerReviews, ...sessionReviewsRef.current],
            sourceQueueStrategy: queueStrategy,
            sourceDrillNoteNames: drillNoteNames,
            nextCompletedCount,
          });
          return;
        }
        resumeActiveTimers();
        selectAndStartNext(nextCompletedCount);
      };

      window.setTimeout(() => {
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = continueAfterCorrectDelay;
          return;
        }
        continueAfterCorrectDelay();
      }, correctDelayMs);
    },
    [
      answerPitchMode,
      answerInputLockedRef,
      completeSession,
      completedCount,
      drillNoteNames,
      enabledNotes,
      finishCurrentReview,
      fixedCount,
      getPromptActiveMs,
      isPausedRef,
      markCurrentStaffPageNoteComplete,
      markPromptInput,
      maybeBackupDuringOpenEnded,
      mode,
      pendingAfterPauseRef,
      playAnswerNote,
      promptDisplayMode,
      recordStaffPageChaseTarget,
      promptRef,
      queueStrategy,
      resumeActiveTimers,
      schedulerReviews,
      selectAndStartNext,
      sessionRef,
      sessionReviewsRef,
      sessionStartSnapshotRef,
      setCompletedCount,
      setFeedback,
      setWrongAnswerCount,
      settings.correctDelayMs,
      staffPageRef,
      startStaffPage,
      startStaffPageScroll,
      startStaffPageIndex,
    ]
  );

  return { submitAnswer };
}
