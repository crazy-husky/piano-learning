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
import { MAX_PRACTICE_QUESTIONS } from "../../../domain/practiceLimits";
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
  Staff,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import { getDuetTargetMidis } from "../logic/duetPractice";
import type {
  CompletePracticeSessionOptions,
  FinishPracticeReviewOptions,
  PracticePromptRuntime,
  PracticeStaffPageRuntime,
} from "./usePracticeSessionLifecycle";
import type { PracticeTimers } from "./usePracticeTimers";

interface PracticeAnswerFeedback {
  diagnosticSampleId?: number;
  staffPageIndex?: number;
  type: "wrong" | "correct";
  noteName?: NoteName;
  staff?: Staff;
}

function getDuetWrongFeedbackStaff(
  targetNoteId: TargetNoteId | null | undefined,
  duetTargets: { high: TargetNote[]; low: TargetNote[] }
): Staff | undefined {
  if (!targetNoteId) return undefined;
  if (duetTargets.high.some((target) => target.id === targetNoteId)) return "treble";
  if (duetTargets.low.some((target) => target.id === targetNoteId)) return "bass";
  return undefined;
}

function getDuetWrongTargetNoteId(
  answerMidi: number | undefined,
  duetTargets: { high: TargetNote[]; low: TargetNote[] },
  completedTargetNoteIds: readonly TargetNoteId[]
): TargetNoteId | null {
  const completedTargetIds = new Set(completedTargetNoteIds);
  const pendingTargets = [...duetTargets.high, ...duetTargets.low].filter(
    (target) => !completedTargetIds.has(target.id)
  );
  if (pendingTargets.length === 0) return null;
  if (pendingTargets.length === 1) return pendingTargets[0]!.id;
  if (answerMidi === undefined) return null;
  return pendingTargets.reduce((closest, target) =>
    Math.abs(getTargetMidiNoteNumber(target) - answerMidi) <
    Math.abs(getTargetMidiNoteNumber(closest) - answerMidi)
      ? target
      : closest
  ).id;
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
  correctDelayMs: number;
  drillNoteNames: NoteName[];
  enabledNotes: TargetNote[];
  fixedCount: number;
  mode: PracticeMode;
  playAnswerNote: boolean;
  outcomePolicy?: PracticeAnswerOutcomePolicy;
  promptDisplayMode: "single-note" | "staff-page";
  queueStrategy: PracticeQueueStrategy;
  schedulerReviews: ReviewRecord[];
  synchronizedPractice: boolean;
}

export interface PracticeAnswerOutcomePolicy {
  advanceAfterWrong?: boolean;
  onResolvedAnswer?: (outcome: {
    answeredCorrectly: boolean;
    answerMidi?: number;
    targetNote: TargetNote;
  }) => void;
  suppressConfiguredAnswerNote?: boolean;
  wrongAnswerDelayMs?: number;
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
    interruptReason?: InterruptReason,
    options?: FinishPracticeReviewOptions
  ) => Promise<ReviewRecord | null>;
  getPromptActiveMs: PracticeTimers["getPromptActiveMs"];
  getSynchronizedAdvanceAudioTime: () => number | undefined;
  scheduleAtAudioTime: (callback: () => void, audioTime: number) => void;
  markCurrentStaffPageNoteComplete: () => void;
  markCurrentStaffPageStaffNoteComplete: (staff: Staff) => void;
  markPromptInput: () => void;
  maybeBackupDuringOpenEnded: (nextCompletedCount: number) => Promise<void>;
  onQuestionLimitReached: () => void;
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
    correctDelayMs,
    drillNoteNames,
    enabledNotes,
    fixedCount,
    mode,
    playAnswerNote,
    outcomePolicy,
    promptDisplayMode,
    queueStrategy,
    schedulerReviews,
    synchronizedPractice,
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
    getSynchronizedAdvanceAudioTime,
    markCurrentStaffPageNoteComplete,
    markCurrentStaffPageStaffNoteComplete,
    markPromptInput,
    maybeBackupDuringOpenEnded,
    onQuestionLimitReached,
    recordStaffPageChaseTarget,
    resumeActiveTimers,
    scheduleAtAudioTime,
    selectAndStartNext,
    startStaffPage,
    startStaffPageIndex,
    startStaffPageScroll,
  } = services;
  const { setCompletedCount, setFeedback, setWrongAnswerCount } = ui;
  const settings = { correctDelayMs };

  const advanceAfterResolvedPrompt = useCallback(
    async (
      review: ReviewRecord,
      nextCompletedCount: number,
      options: {
        advanceAudioTime?: number;
        recordChaseTarget: boolean;
        delayMs: number;
      }
    ): Promise<void> => {
      setCompletedCount(nextCompletedCount);
      if (promptDisplayMode === "staff-page") {
        markCurrentStaffPageNoteComplete();
        if (options.recordChaseTarget) recordStaffPageChaseTarget();
      }
      const backupPromise = maybeBackupDuringOpenEnded(nextCompletedCount);
      if (
        nextCompletedCount >= MAX_PRACTICE_QUESTIONS &&
        (mode !== "fixed-count" || fixedCount > MAX_PRACTICE_QUESTIONS)
      ) {
        onQuestionLimitReached();
        await backupPromise;
        return;
      }

      const continueAfterResolution = (): void => {
        if (sessionRef.current?.id !== review.sessionId || sessionRef.current.endedAt) {
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

      const continueAtScheduledTime = (): void => {
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = continueAfterResolution;
          return;
        }
        continueAfterResolution();
      };
      if (options.advanceAudioTime !== undefined) {
        scheduleAtAudioTime(continueAtScheduledTime, options.advanceAudioTime);
      } else if (options.delayMs > 0) {
        window.setTimeout(continueAtScheduledTime, options.delayMs);
      } else {
        continueAfterResolution();
      }
      await backupPromise;
    },
    [
      completeSession,
      drillNoteNames,
      enabledNotes,
      fixedCount,
      isPausedRef,
      markCurrentStaffPageNoteComplete,
      maybeBackupDuringOpenEnded,
      mode,
      onQuestionLimitReached,
      pendingAfterPauseRef,
      promptDisplayMode,
      queueStrategy,
      recordStaffPageChaseTarget,
      resumeActiveTimers,
      scheduleAtAudioTime,
      schedulerReviews,
      selectAndStartNext,
      sessionRef,
      sessionReviewsRef,
      setCompletedCount,
      staffPageRef,
      startStaffPage,
      startStaffPageIndex,
      startStaffPageScroll,
    ]
  );

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
      if (playAnswerNote && !outcomePolicy?.suppressConfiguredAnswerNote) {
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
      const duetTargets = prompt.duetTargets;
      let matchedDuetStaff: Staff | undefined;
      if (duetTargets && answerMidi !== undefined) {
        const targetMidis = getDuetTargetMidis(duetTargets);
        for (const staff of ["treble", "bass"] as const) {
          if (
            targetMidis[staff].includes(answerMidi) &&
            !prompt.completedDuetMidis.includes(answerMidi)
          ) {
            matchedDuetStaff = staff;
            break;
          }
        }
      }
      const answeredCorrectly = duetTargets
        ? matchedDuetStaff !== undefined
        : isPracticeAnswerCorrect(answer, prompt.note, answerPitchMode);
      outcomePolicy?.onResolvedAnswer?.({
        answeredCorrectly,
        answerMidi,
        targetNote: prompt.note,
      });
      const duetTargetNoteId =
        !answeredCorrectly && duetTargets
          ? getDuetWrongTargetNoteId(answerMidi, duetTargets, prompt.completedDuetTargetNoteIds)
          : undefined;
      prompt.answerAttempts.push({
        midi: answerMidi,
        noteName: answer.noteName,
        atMs: atActiveMs,
        ...(duetTargets ? { duetTargetNoteId: duetTargetNoteId ?? null } : {}),
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
          ...(duetTargets ? { duetTargetNoteId: duetTargetNoteId ?? null } : {}),
          confidence: answer.confidence,
          clipping: answer.clipping,
          inputMode,
          microphoneAlgorithm: answer.microphoneAlgorithm,
          midiNoteNumber: answer.midiNoteNumber,
        });
        setWrongAnswerCount((count) => count + 1);
        markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
        setFeedback({
          diagnosticSampleId,
          ...(staffPageRef.current ? { staffPageIndex: staffPageRef.current.index } : {}),
          type: "wrong",
          noteName: answer.noteName,
          ...(duetTargets
            ? { staff: getDuetWrongFeedbackStaff(duetTargetNoteId, duetTargets) }
            : {}),
        });
        window.setTimeout(
          () => setFeedback((current) => (current?.type === "wrong" ? null : current)),
          450
        );
        if (outcomePolicy?.advanceAfterWrong) {
          answerInputLockedRef.current = true;
          markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeStarted");
          const advanceAudioTime = synchronizedPractice
            ? getSynchronizedAdvanceAudioTime()
            : undefined;
          const review = await finishCurrentReview(false);
          markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeEnded");
          if (!review) return;
          await advanceAfterResolvedPrompt(review, sessionReviewsRef.current.length, {
            advanceAudioTime,
            recordChaseTarget: false,
            delayMs: synchronizedPractice ? 0 : (outcomePolicy.wrongAnswerDelayMs ?? 180),
          });
        }
        return;
      }

      if (matchedDuetStaff && duetTargets) {
        prompt.completedDuetMidis.push(answerMidi!);
        const completedTarget = (
          matchedDuetStaff === "treble" ? duetTargets.high : duetTargets.low
        ).find((target) => getTargetMidiNoteNumber(target) === answerMidi);
        if (completedTarget && !prompt.completedDuetTargetNoteIds.includes(completedTarget.id)) {
          prompt.completedDuetTargetNoteIds.push(completedTarget.id);
        }
        const staffTargets = getDuetTargetMidis(duetTargets)[matchedDuetStaff];
        if (
          staffTargets.every((midi) => prompt.completedDuetMidis.includes(midi)) &&
          !prompt.completedDuetStaves.includes(matchedDuetStaff)
        ) {
          prompt.completedDuetStaves.push(matchedDuetStaff);
          markCurrentStaffPageStaffNoteComplete(matchedDuetStaff);
        }
        completeMidiLatencySample(diagnosticSampleId, "correct");
        markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
        setFeedback({
          diagnosticSampleId,
          type: "correct",
          noteName: answer.noteName,
          staff: matchedDuetStaff,
        });
        if (prompt.completedDuetStaves.length < 2) return;
      }

      answerInputLockedRef.current = true;
      if (!matchedDuetStaff) completeMidiLatencySample(diagnosticSampleId, "correct");
      markMidiLatencyStage(diagnosticSampleId, "feedbackRequested");
      if (!matchedDuetStaff) {
        setFeedback({ diagnosticSampleId, type: "correct", noteName: answer.noteName });
      }
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeStarted");
      const advanceAudioTime = synchronizedPractice ? getSynchronizedAdvanceAudioTime() : undefined;
      const review = await finishCurrentReview(true);
      markMidiLatencyStage(diagnosticSampleId, "reviewFinalizeEnded");
      if (!review) {
        return;
      }
      const nextCompletedCount = sessionReviewsRef.current.length;
      await advanceAfterResolvedPrompt(review, nextCompletedCount, {
        advanceAudioTime,
        recordChaseTarget: promptDisplayMode === "staff-page",
        delayMs: synchronizedPractice ? 0 : correctDelayMs,
      });
    },
    [
      answerPitchMode,
      answerInputLockedRef,
      finishCurrentReview,
      getPromptActiveMs,
      getSynchronizedAdvanceAudioTime,
      isPausedRef,
      markCurrentStaffPageStaffNoteComplete,
      markPromptInput,
      playAnswerNote,
      outcomePolicy,
      promptDisplayMode,
      promptRef,
      sessionReviewsRef,
      sessionStartSnapshotRef,
      staffPageRef,
      setFeedback,
      setWrongAnswerCount,
      settings.correctDelayMs,
      synchronizedPractice,
      advanceAfterResolvedPrompt,
    ]
  );

  const handleDuetTimeout = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (
      !prompt?.duetTargets ||
      prompt.completedDuetStaves.length === 2 ||
      isPausedRef.current ||
      answerInputLockedRef.current
    ) {
      return;
    }
    answerInputLockedRef.current = true;
    setWrongAnswerCount((count) => count + 1);
    const review = await finishCurrentReview(false, undefined, { wasMissed: true });
    if (!review) return;
    const nextCompletedCount = sessionReviewsRef.current.length;
    await advanceAfterResolvedPrompt(review, nextCompletedCount, {
      recordChaseTarget: false,
      delayMs: 0,
    });
  }, [
    advanceAfterResolvedPrompt,
    answerInputLockedRef,
    finishCurrentReview,
    isPausedRef,
    promptRef,
    sessionReviewsRef,
    setWrongAnswerCount,
  ]);

  const handleSynchronizedTimeout = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt || isPausedRef.current || answerInputLockedRef.current) return;
    answerInputLockedRef.current = true;
    setWrongAnswerCount((count) => count + 1);
    const advanceAudioTime = getSynchronizedAdvanceAudioTime();
    const review = await finishCurrentReview(false, undefined, { wasMissed: true });
    if (!review) return;
    const nextCompletedCount = sessionReviewsRef.current.length;
    await advanceAfterResolvedPrompt(review, nextCompletedCount, {
      advanceAudioTime,
      recordChaseTarget: false,
      delayMs: 0,
    });
  }, [
    advanceAfterResolvedPrompt,
    answerInputLockedRef,
    finishCurrentReview,
    getSynchronizedAdvanceAudioTime,
    isPausedRef,
    promptRef,
    sessionReviewsRef,
    setWrongAnswerCount,
  ]);

  return { handleDuetTimeout, handleSynchronizedTimeout, submitAnswer };
}
