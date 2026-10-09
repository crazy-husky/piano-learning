import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { setPianoVolume, unlockAudio } from "../../../audio/piano";
import { db, resolveQueueStrategy } from "../../../data/db";
import { createUuid } from "../../../domain/id";
import { createMelodyGenerationState, type MelodyGenerationState } from "../../../domain/melody";
import { resolveAvailableAnswerPitchMode } from "../../../domain/answerInput";
import {
  buildPracticeSessionRecordV5,
  buildPracticeSessionStartSnapshot,
} from "../../../domain/practiceSessionStartSnapshot";
import { createAdaptiveNoteScheduler, selectNextNote, selectNotePage, type AdaptiveNoteScheduler } from "../../../domain/scheduler";
import { filterLongTermReviews } from "../../../domain/stats";
import type {
  AppSettings,
  AnswerPitchMode,
  NoteName,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PracticeSessionStartSnapshot,
  ReviewRecord,
  StaffNotationMode,
  TargetNote,
} from "../../../domain/types";
import type { MidiInputController } from "../../../midi/useMidiInput";
import type { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import type { PracticeStaffPageRuntime } from "./usePracticeSessionLifecycle";
import type { PracticeTimers } from "./usePracticeTimers";
import type { PracticeMicrophoneAnalysis } from "../../vocal-pitch/logic/practiceMicrophoneAnalysis";

interface PracticeStaffPageStartInput {
  nextCompletedCount: number;
  sourceDrillNoteNames: NoteName[];
  sourceNotes: TargetNote[];
  sourceQueueStrategy: PracticeQueueStrategy;
  sourceReviews: ReviewRecord[];
}

interface PracticeSessionStartValues {
  answerPitchMode: AnswerPitchMode;
  midi: Pick<MidiInputController, "isConnected">;
  prefersReducedMotion: boolean;
  queueNotes: TargetNote[];
  schedulerReviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  staffNotationMode: StaffNotationMode;
  staffPageUiPreferences: { smoothStaffPageScroll: boolean };
  startPausedReading: boolean;
}

interface PracticeSessionStartRuntime {
  adaptiveSchedulerRef: MutableRefObject<AdaptiveNoteScheduler | null>;
  endingRef: MutableRefObject<boolean>;
  isPausedRef: MutableRefObject<boolean>;
  lastBackupAtRef: MutableRefObject<number>;
  lastBackupCompletedRef: MutableRefObject<number>;
  lastTargetNoteIdRef: MutableRefObject<TargetNote["id"] | undefined>;
  melodyGenerationStateRef: MutableRefObject<MelodyGenerationState>;
  melodyQueueRef: MutableRefObject<TargetNote[]>;
  pendingAfterPauseRef: MutableRefObject<(() => void) | null>;
  sessionRef: MutableRefObject<PracticeSessionRecord | null>;
  sessionReviewsRef: MutableRefObject<ReviewRecord[]>;
  sessionStartSnapshotRef: MutableRefObject<PracticeSessionStartSnapshot | null>;
}

interface PracticeSessionStartServices {
  onBeforePracticeStart: () => Promise<{
    proceed: boolean;
    reviews?: ReviewRecord[];
    settings?: AppSettings;
  }>;
  onSettingsSaved: (settings: AppSettings, options?: { feedback?: boolean }) => void | Promise<void>;
  persistConfig: () => Promise<AppSettings>;
  practiceMicrophone: Pick<ReturnType<typeof usePracticeMicrophoneInput>, "start" | "stop" | "resetCapture">;
  runSessionStart: (action: () => Promise<void>) => Promise<void>;
}

interface PracticeSessionStartUi {
  applySettingsSnapshot: (settings: AppSettings) => void;
  beginSessionState: (session: PracticeSessionRecord) => void;
  drawMelodyNote: (sourceNotes: TargetNote[], remainingCount?: number) => TargetNote;
  resetSessionActiveTimer: PracticeTimers["resetSessionActiveTimer"];
  setExpandedCandidateSegmentKey: Dispatch<SetStateAction<string | null>>;
  setIsMicrophoneAnalysisDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setIsStaffPageScrolling: Dispatch<SetStateAction<boolean>>;
  setMicrophoneCaptureAnalysis: Dispatch<SetStateAction<PracticeMicrophoneAnalysis | null>>;
  setMicrophoneCaptureNotice: Dispatch<SetStateAction<string | null>>;
  startPrompt: (note: TargetNote) => void;
  startStaffPage: (input: PracticeStaffPageStartInput) => void;
  syncStaffPage: (page: PracticeStaffPageRuntime | null) => void;
}

interface UsePracticeSessionStartOptions {
  runtime: PracticeSessionStartRuntime;
  services: PracticeSessionStartServices;
  ui: PracticeSessionStartUi;
  values: PracticeSessionStartValues;
}

function newSessionId(): string {
  return createUuid();
}

export function usePracticeSessionStart({ runtime, services, ui, values }: UsePracticeSessionStartOptions) {
  const {
    answerPitchMode,
    midi,
    prefersReducedMotion,
    queueNotes,
    schedulerReviews,
    sessions,
    staffNotationMode,
    staffPageUiPreferences,
    startPausedReading,
  } = values;
  const {
    adaptiveSchedulerRef,
    endingRef,
    isPausedRef,
    lastBackupAtRef,
    lastBackupCompletedRef,
    lastTargetNoteIdRef,
    melodyGenerationStateRef,
    melodyQueueRef,
    pendingAfterPauseRef,
    sessionRef,
    sessionReviewsRef,
    sessionStartSnapshotRef,
  } = runtime;
  const {
    onBeforePracticeStart,
    onSettingsSaved,
    persistConfig,
    practiceMicrophone,
    runSessionStart,
  } = services;
  const {
    applySettingsSnapshot,
    beginSessionState,
    drawMelodyNote,
    resetSessionActiveTimer,
    setExpandedCandidateSegmentKey,
    setIsMicrophoneAnalysisDialogOpen,
    setIsPaused,
    setIsStaffPageScrolling,
    setMicrophoneCaptureAnalysis,
    setMicrophoneCaptureNotice,
    startPrompt,
    startStaffPage,
    syncStaffPage,
  } = ui;

  const startSession = useCallback(async (): Promise<void> => {
    if (queueNotes.length === 0 || (answerPitchMode === "exact-pitch" && !midi.isConnected)) {
      return;
    }
    let microphoneStarted = false;
    let sessionStarted = false;
    try {
      await runSessionStart(async () => {
        void unlockAudio().catch(() => undefined);
        const preflightResult = await onBeforePracticeStart();
        if (!preflightResult.proceed) {
          return;
        }
        if (preflightResult.settings) {
          applySettingsSnapshot(preflightResult.settings);
        }
        const loadedPreflightSettings = preflightResult.settings ?? (await persistConfig());
        const preflightSettings = answerPitchMode === "microphone" &&
            loadedPreflightSettings.answerPitchMode !== "microphone"
          ? { ...loadedPreflightSettings, answerPitchMode: "microphone" as const }
          : loadedPreflightSettings;
        const availablePreflightAnswerPitchMode = resolveAvailableAnswerPitchMode(
          preflightSettings.answerPitchMode,
          midi.isConnected,
        );
        const nextSettings = preflightSettings.answerPitchMode === availablePreflightAnswerPitchMode
          ? preflightSettings
          : { ...preflightSettings, answerPitchMode: availablePreflightAnswerPitchMode };
        if (nextSettings !== preflightSettings) {
          await onSettingsSaved(nextSettings, { feedback: false });
        }
        const nextMode = nextSettings.defaultMode;
        const nextQueueStrategy = resolveQueueStrategy(nextSettings);
        const nextSchedulerReviews = preflightResult.reviews
          ? filterLongTermReviews(preflightResult.reviews)
          : schedulerReviews;
        const microphoneSettings = availablePreflightAnswerPitchMode === "microphone"
          ? { ...nextSettings, playAnswerNote: false }
          : nextSettings;
        const builtStartSnapshot = buildPracticeSessionStartSnapshot({
          autoPlayTarget:
            availablePreflightAnswerPitchMode === "microphone" ? false : nextSettings.autoPlayTarget,
          mode: nextMode,
          prefersReducedMotion,
          settings: { ...microphoneSettings, queueStrategy: nextQueueStrategy },
          smoothStaffPageScroll: staffPageUiPreferences.smoothStaffPageScroll,
          startPausedReading,
        });
        if (!builtStartSnapshot) {
          return;
        }
        const { snapshot: startSnapshot } = builtStartSnapshot;
        const { practiceConfig, presentationConfig } = startSnapshot;
        const nextEnabledNotes = builtStartSnapshot.notes;
        const shouldStartPaused =
          presentationConfig.promptDisplayMode === "staff-page" && presentationConfig.startPausedReading;
        if (availablePreflightAnswerPitchMode === "microphone") {
          if (shouldStartPaused) {
            practiceMicrophone.stop();
          } else {
            microphoneStarted = await practiceMicrophone.start();
            if (!microphoneStarted) {
              return;
            }
          }
        }
        setPianoVolume(startSnapshot.interactionConfig.pianoVolume);
        const startedAt = new Date().toISOString();
        const nextSession: PracticeSessionRecord = buildPracticeSessionRecordV5({
          id: newSessionId(),
          snapshot: startSnapshot,
          startedAt,
        });
        await db.practiceSessions.put(nextSession);
        practiceMicrophone.resetCapture();
        setMicrophoneCaptureAnalysis(null);
        setMicrophoneCaptureNotice(null);
        setExpandedCandidateSegmentKey(null);
        setIsMicrophoneAnalysisDialogOpen(false);
        sessionRef.current = nextSession;
        sessionStartSnapshotRef.current = startSnapshot;
        sessionReviewsRef.current = [];
        lastTargetNoteIdRef.current = undefined;
        melodyQueueRef.current = [];
        melodyGenerationStateRef.current = createMelodyGenerationState();
        adaptiveSchedulerRef.current = practiceConfig.queueStrategy === "melody"
          ? null
          : createAdaptiveNoteScheduler({
              notes: nextEnabledNotes,
              reviews: nextSchedulerReviews,
              sessions,
              currentSessionId: nextSession.id,
              queueStrategy: practiceConfig.queueStrategy,
              drillNoteNames: practiceConfig.drillNoteNames,
            });
        syncStaffPage(null);
        setIsStaffPageScrolling(false);
        endingRef.current = false;
        lastBackupAtRef.current = performance.now();
        lastBackupCompletedRef.current = 0;
        resetSessionActiveTimer(shouldStartPaused);
        isPausedRef.current = shouldStartPaused;
        pendingAfterPauseRef.current = null;
        beginSessionState(nextSession);
        setIsPaused(shouldStartPaused);
        sessionStarted = true;
        if (presentationConfig.promptDisplayMode === "staff-page") {
          startStaffPage({
            sourceNotes: nextEnabledNotes,
            sourceReviews: nextSchedulerReviews,
            sourceQueueStrategy: practiceConfig.queueStrategy,
            sourceDrillNoteNames: practiceConfig.drillNoteNames,
            nextCompletedCount: 0,
          });
        } else {
          const firstNote =
            practiceConfig.queueStrategy === "melody"
              ? drawMelodyNote(nextEnabledNotes, practiceConfig.fixedCount)
              : adaptiveSchedulerRef.current?.select() ??
                selectNextNote({
                    notes: nextEnabledNotes,
                    reviews: nextSchedulerReviews,
                    sessions,
                    currentSessionId: nextSession.id,
                    queueStrategy: practiceConfig.queueStrategy,
                    drillNoteNames: practiceConfig.drillNoteNames,
                  });
          startPrompt(firstNote);
        }
      });
    } finally {
      if (microphoneStarted && !sessionStarted) {
        practiceMicrophone.stop();
      }
    }
  }, [
    answerPitchMode,
    applySettingsSnapshot,
    beginSessionState,
    drawMelodyNote,
    midi.isConnected,
    practiceMicrophone.start,
    practiceMicrophone.resetCapture,
    practiceMicrophone.stop,
    onBeforePracticeStart,
    onSettingsSaved,
    persistConfig,
    queueNotes.length,
    runSessionStart,
    prefersReducedMotion,
    schedulerReviews,
    sessions,
    resetSessionActiveTimer,
    startPausedReading,
    staffPageUiPreferences.smoothStaffPageScroll,
    staffNotationMode,
    startPrompt,
    startStaffPage,
    syncStaffPage,
  ]);
  return { startSession };
}
