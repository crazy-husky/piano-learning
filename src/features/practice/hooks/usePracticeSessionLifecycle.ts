import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { db, deletePracticeSessionWithReviews, saveAnswerEvents } from "../../../data/db";
import {
  answerDeviceInfo,
  answerInputMode,
  currentMicrophoneContext,
} from "../../../data/answerEvents";
import { writeBackupNow } from "../../../data/backup";
import { createUuid } from "../../../domain/id";
import {
  shouldIgnoreReviewForSession,
  shouldKeepPracticeSession,
} from "../../../domain/practiceSession";
import { isCompletedReview } from "../../../domain/reviews";
import type { AdaptiveNoteScheduler } from "../../../domain/scheduler";
import type {
  AnswerEvent,
  AnswerAttempt,
  FocusLoss,
  InterruptReason,
  PracticeSessionRecord,
  ReviewRecord,
  Staff,
  TargetNote,
  WrongAnswer,
} from "../../../domain/types";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import { estimateStaffGameSystemDelayMs } from "../../staff-game/logic/staffGameProficiency";
import { practiceMicrophoneDebugParametersForSensitivityLevel } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import type { GeneratedStaffPageRhythm } from "../logic/staffPageNotation";
import { getDuetTargetMidis, type DuetTargetPair } from "../logic/duetPractice";
import type { PracticePromptTimerState, PracticeTimers } from "./usePracticeTimers";

export interface PracticePromptRuntime extends PracticePromptTimerState {
  note: TargetNote;
  duetTargets?: DuetTargetPair;
  completedDuetStaves: Staff[];
  completedDuetMidis: number[];
  completedDuetTargetNoteIds: TargetNote["id"][];
  startedAt: string;
  answerAttempts: AnswerAttempt[];
  wrongAnswers: WrongAnswer[];
  replayCount: number;
  focusLosses: FocusLoss[];
  interrupted: boolean;
  interruptReason?: InterruptReason;
}

export interface PracticeStaffPageRuntime {
  notes: TargetNote[];
  noteGroups?: TargetNote[][];
  measureRowStartIndices?: number[];
  completedStaffNoteIndices?: Partial<Record<Staff, number[]>>;
  index: number;
  completedCount: number;
  rhythm?: GeneratedStaffPageRhythm;
}

export interface CompletePracticeSessionOptions {
  showSummary?: boolean;
  updateUi?: boolean;
}

export interface FinishPracticeReviewOptions {
  wasMissed?: boolean;
}

interface PracticeSessionLifecycleRuntime {
  promptRef: MutableRefObject<PracticePromptRuntime | null>;
  sessionRef: MutableRefObject<PracticeSessionRecord | null>;
  sessionReviewsRef: MutableRefObject<ReviewRecord[]>;
  lastTargetNoteIdRef: MutableRefObject<TargetNote["id"] | undefined>;
  adaptiveSchedulerRef: MutableRefObject<AdaptiveNoteScheduler | null>;
  endingRef: MutableRefObject<boolean>;
  staffPageRef: MutableRefObject<PracticeStaffPageRuntime | null>;
  isPausedRef: MutableRefObject<boolean>;
  pendingAfterPauseRef: MutableRefObject<(() => void) | null>;
}

interface PracticeSessionLifecycleServices {
  stopMicrophone: () => void;
  clearStaffPageScrollSchedule: () => void;
  onDataChanged: () => Promise<void>;
  onPracticeFinished: () => void;
}

interface PracticeSessionLifecycleUi {
  finishSessionState: (input: {
    finalSession: PracticeSessionRecord;
    reviews: ReviewRecord[];
    shouldKeepSession: boolean;
    showSummary: boolean;
  }) => void;
  syncStaffPage: (page: PracticeStaffPageRuntime | null) => void;
  setIsStaffPageScrolling: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
}

interface UsePracticeSessionLifecycleOptions {
  runtime: PracticeSessionLifecycleRuntime;
  timers: Pick<PracticeTimers, "getPromptActiveMs" | "getSessionActiveMs" | "pauseActiveTimers">;
  services: PracticeSessionLifecycleServices;
  ui: PracticeSessionLifecycleUi;
}

export function usePracticeSessionLifecycle({
  runtime,
  timers,
  services,
  ui,
}: UsePracticeSessionLifecycleOptions) {
  const pendingReviewPersistenceRef = useRef<Promise<void>[]>([]);
  const finishCurrentReview = useCallback(
    async (
      answeredCorrectly: boolean,
      interruptReason?: InterruptReason,
      options: FinishPracticeReviewOptions = {}
    ): Promise<ReviewRecord | null> => {
      const prompt = runtime.promptRef.current;
      const activeMs = timers.getPromptActiveMs();
      const session = runtime.sessionRef.current;
      if (!prompt || !session) {
        return null;
      }
      if (!answeredCorrectly && !options.wasMissed) {
        prompt.interrupted = true;
        prompt.interruptReason = interruptReason ?? prompt.interruptReason ?? "manual-stop";
      }
      timers.pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const ignored = shouldIgnoreReviewForSession(session);
      const review: ReviewRecord = {
        id: createUuid(),
        schemaVersion: 1,
        sessionId: session.id,
        targetNoteId: prompt.note.id,
        groupId: prompt.note.groupId,
        noteName: prompt.note.noteName,
        octave: prompt.note.octave,
        startedAt: prompt.startedAt,
        endedAt,
        answeredAt: answeredCorrectly ? endedAt : undefined,
        answeredCorrectly,
        interrupted: prompt.interrupted,
        interruptReason: prompt.interruptReason,
        activeMs,
        wrongAnswers: prompt.wrongAnswers,
        ...(options.wasMissed ? { wasMissed: true } : {}),
        ...(prompt.duetTargets
          ? {
              duetTargetNoteIds: [...prompt.duetTargets.high, ...prompt.duetTargets.low].map(
                (note) => note.id
              ),
              duetCompletedTargetNoteIds: [...prompt.completedDuetTargetNoteIds],
            }
          : {}),
        replayCount: prompt.replayCount,
        focusLosses: prompt.focusLosses,
        ignored,
      };
      runtime.promptRef.current = null;
      runtime.lastTargetNoteIdRef.current = prompt.note.id;
      if (!ignored) {
        const sessionAnswerMode =
          "answerPitchMode" in session ? session.answerPitchMode : undefined;
        const inputMode =
          prompt.answerAttempts.at(-1)?.inputMode ?? answerInputMode(sessionAnswerMode);
        const microphoneContext = currentMicrophoneContext();
        const microphoneAlgorithm =
          prompt.answerAttempts.at(-1)?.microphoneAlgorithm ??
          microphoneContext.microphoneAlgorithm;
        const estimatedSystemDelayMs =
          inputMode === "microphone"
            ? estimateStaffGameSystemDelayMs(
                "microphone",
                practiceMicrophoneDebugParametersForSensitivityLevel(
                  microphoneAlgorithm ?? "swiftf0",
                  microphoneContext.sensitivityLevel ?? 3
                ),
                microphoneAlgorithm ?? "swiftf0"
              )
            : 0;
        const attempts: AnswerAttempt[] = prompt.answerAttempts;
        const finalAttempt = attempts.at(-1);
        const event: AnswerEvent = {
          id: review.id,
          dataSetId: "",
          sessionId: session.id,
          eventIndex: runtime.sessionReviewsRef.current.length,
          occurredAt: review.endedAt,
          promptStartedAt: review.startedAt,
          promptEndedAt: review.endedAt,
          mode:
            "startSnapshot" in session &&
            session.startSnapshot.practiceConfig.preReadingBufferSize !== undefined
              ? "pre-reading"
              : "free-practice",
          inputMode,
          deviceInfo: answerDeviceInfo(),
          ...(inputMode === "microphone" ? { ...microphoneContext, microphoneAlgorithm } : {}),
          targetMidi: getTargetMidiNoteNumber(prompt.note),
          ...(prompt.duetTargets
            ? {
                duetDifficulty:
                  "startSnapshot" in session
                    ? session.startSnapshot.practiceConfig.duetDifficulty
                    : undefined,
                duetLevel:
                  "startSnapshot" in session
                    ? session.startSnapshot.practiceConfig.duetLevel
                    : undefined,
                targetMidiHigh:
                  prompt.duetTargets.high[0] === undefined
                    ? undefined
                    : getTargetMidiNoteNumber(prompt.duetTargets.high[0]),
                targetMidiLow:
                  prompt.duetTargets.low[0] === undefined
                    ? undefined
                    : getTargetMidiNoteNumber(prompt.duetTargets.low[0]),
                duetTargetNoteIds: [...prompt.duetTargets.high, ...prompt.duetTargets.low].map(
                  (note) => note.id
                ),
                duetCompletedTargetNoteIds: [...prompt.completedDuetTargetNoteIds],
                duetTargetMidis: getDuetTargetMidis(prompt.duetTargets),
                ...(prompt.duetTargets.high[0]
                  ? {
                      targetNoteId: prompt.duetTargets.high[0].id,
                      targetGroupId: prompt.duetTargets.high[0].groupId,
                      targetNoteName: prompt.duetTargets.high[0].noteName,
                      targetOctave: prompt.duetTargets.high[0].octave,
                    }
                  : {}),
              }
            : {}),
          targetNoteId: prompt.note.id,
          targetGroupId: prompt.note.groupId,
          targetNoteName: prompt.note.noteName,
          targetOctave: prompt.note.octave,
          recognizedMidi: finalAttempt?.midi,
          confidence: finalAttempt?.confidence,
          attempts,
          isCorrectFirstTry: prompt.duetTargets
            ? review.answeredCorrectly &&
              prompt.completedDuetMidis.length ===
                prompt.duetTargets.high.length + prompt.duetTargets.low.length &&
              attempts.length >= prompt.duetTargets.high.length + prompt.duetTargets.low.length &&
              attempts.every((attempt) => attempt.isCorrect)
            : (attempts[0]?.isCorrect ?? null),
          isCorrectFinal: review.answeredCorrectly ? true : attempts.length > 0 ? false : null,
          rawResponseTimeMs: review.answeredCorrectly ? activeMs : null,
          estimatedSystemDelayMs,
          responseTimeMs: review.answeredCorrectly
            ? Math.max(0, activeMs - estimatedSystemDelayMs)
            : null,
          activeMs,
          wrongAttempts: review.wrongAnswers.length,
          isExtraNote: false,
          isMissed: review.wasMissed === true,
          wasInterrupted: review.interrupted,
        };
        const persistence = saveAnswerEvents([event]).then(() =>
          db.transaction("rw", db.settings, async () => {
            const settings = await db.settings.get("default");
            if (settings && !settings.firstReviewAt) {
              await db.settings.put({ ...settings, firstReviewAt: review.startedAt });
            }
          })
        );
        pendingReviewPersistenceRef.current.push(persistence);
        // Avoid an unhandled rejection while the metronome-driven UI continues;
        // completeSession still awaits the original promise before saving.
        void persistence.catch(() => undefined);
      }
      runtime.adaptiveSchedulerRef.current?.appendReview(review);
      runtime.sessionReviewsRef.current = [...runtime.sessionReviewsRef.current, review];
      return review;
    },
    [runtime, timers]
  );

  const completeSession = useCallback(
    async (
      endReason: PracticeSessionRecord["endReason"],
      unfinishedReason?: InterruptReason,
      options: CompletePracticeSessionOptions = {}
    ): Promise<void> => {
      if (runtime.endingRef.current || !runtime.sessionRef.current) {
        return;
      }
      const showSummary = options.showSummary ?? true;
      const updateUi = options.updateUi ?? true;
      runtime.endingRef.current = true;
      services.stopMicrophone();
      services.clearStaffPageScrollSchedule();
      const unfinishedReview = runtime.promptRef.current
        ? await finishCurrentReview(false, unfinishedReason)
        : null;
      timers.pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const finalReviews = unfinishedReview
        ? runtime.sessionReviewsRef.current
        : [...runtime.sessionReviewsRef.current];
      const finalSession: PracticeSessionRecord = {
        ...runtime.sessionRef.current,
        activePracticeMs: timers.getSessionActiveMs(),
        endedAt,
        endReason,
        completedCount: finalReviews.filter(isCompletedReview).length,
        interruptedCount: finalReviews.filter((review) => review.interrupted).length,
      };
      const pendingReviewPersistence = pendingReviewPersistenceRef.current;
      pendingReviewPersistenceRef.current = [];
      await Promise.all(pendingReviewPersistence);
      const shouldKeepSession = shouldKeepPracticeSession(finalSession, finalReviews);
      if (shouldKeepSession) {
        await db.practiceSessions.put(finalSession);
        runtime.sessionRef.current = finalSession;
      } else {
        await deletePracticeSessionWithReviews(finalSession.id, finalReviews);
        runtime.sessionRef.current = null;
      }
      if (updateUi) {
        ui.finishSessionState({
          finalSession,
          reviews: finalReviews,
          shouldKeepSession,
          showSummary,
        });
        ui.syncStaffPage(null);
        ui.setIsStaffPageScrolling(false);
      } else {
        runtime.staffPageRef.current = null;
      }
      runtime.isPausedRef.current = false;
      runtime.pendingAfterPauseRef.current = null;
      if (updateUi) {
        ui.setIsPaused(false);
      }
      if (shouldKeepSession) {
        await writeBackupNow().catch(() => undefined);
      }
      await services.onDataChanged();
      runtime.adaptiveSchedulerRef.current = null;
      if (shouldKeepSession && updateUi) {
        services.onPracticeFinished();
      }
      runtime.endingRef.current = false;
    },
    [finishCurrentReview, runtime, services, timers, ui]
  );

  return { completeSession, finishCurrentReview };
}
