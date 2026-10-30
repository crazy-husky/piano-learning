import { useCallback, useRef, useState } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type { PreReadingBufferSize } from "../../../domain/types";
import type { MetronomeBeatEvent } from "../../metronome/useMetronomeController";
import { usePreReadingScoreWindow } from "./usePreReadingScoreWindow";

interface UsePreReadingPracticeControllerOptions {
  bufferSize: PreReadingBufferSize;
  clearPendingAnswers: () => void;
  currentNoteIndex: number;
  enabled: boolean;
  isMetronomeSyncActive: boolean;
  isPaused: boolean;
  notesReady: boolean;
  phaseRunning: boolean;
  replaceTempoAnchor: (audioTime: number, beat: number, bpm: number) => void;
  scheduleAtAudioTime: (callback: () => void, audioTime: number) => void;
  sessionId?: string;
  setProgressMarkerLeadEnabled: Dispatch<SetStateAction<boolean>>;
  syncCountInBeat: number | null;
  syncSessionRef: MutableRefObject<boolean>;
  getCurrentScoreBeat: () => number;
  appendTempoAnchor: (audioTime: number, bpm: number) => void;
}

export function usePreReadingPracticeController({
  bufferSize,
  clearPendingAnswers,
  currentNoteIndex,
  enabled,
  isMetronomeSyncActive,
  isPaused,
  notesReady,
  phaseRunning,
  replaceTempoAnchor,
  scheduleAtAudioTime,
  sessionId,
  setProgressMarkerLeadEnabled,
  syncCountInBeat,
  syncSessionRef,
  getCurrentScoreBeat,
  appendTempoAnchor,
}: UsePreReadingPracticeControllerOptions) {
  const [countdownComplete, setCountdownComplete] = useState(false);
  const countdownCompleteRef = useRef(false);
  const countdownGenerationRef = useRef(0);

  const resetCountdown = useCallback((): void => {
    countdownCompleteRef.current = false;
    countdownGenerationRef.current += 1;
    setCountdownComplete(false);
    setProgressMarkerLeadEnabled(false);
  }, [setProgressMarkerLeadEnabled]);

  const scoreWindow = usePreReadingScoreWindow({
    bufferSize,
    canStartTraining:
      !isMetronomeSyncActive || (syncCountInBeat === null && (!enabled || countdownComplete)),
    currentNoteIndex,
    enabled: enabled && phaseRunning,
    isPaused,
    notesReady,
    sessionId,
  });

  const handleBeat = useCallback(
    (event: MetronomeBeatEvent): void => {
      if (
        !enabled ||
        !phaseRunning ||
        !isMetronomeSyncActive ||
        !syncSessionRef.current ||
        !notesReady
      ) {
        return;
      }

      if (!countdownCompleteRef.current) {
        // The metronome clock restarts at beat zero. Use that first tick to
        // place the current score note directly on the downbeat.
        if (event.beatIndex !== 0) return;
        clearPendingAnswers();
        countdownGenerationRef.current += 1;
        const generation = countdownGenerationRef.current;
        countdownCompleteRef.current = true;
        replaceTempoAnchor(event.audioTime, getCurrentScoreBeat(), event.bpm);
        scheduleAtAudioTime(() => {
          if (!syncSessionRef.current || countdownGenerationRef.current !== generation) {
            return;
          }
          setCountdownComplete(true);
          setProgressMarkerLeadEnabled(true);
        }, event.audioTime);
        return;
      }

      appendTempoAnchor(event.audioTime, event.bpm);
    },
    [
      appendTempoAnchor,
      clearPendingAnswers,
      enabled,
      getCurrentScoreBeat,
      isMetronomeSyncActive,
      notesReady,
      phaseRunning,
      replaceTempoAnchor,
      scheduleAtAudioTime,
      setProgressMarkerLeadEnabled,
      syncSessionRef,
    ]
  );

  return { countdownComplete, handleBeat, resetCountdown, scoreWindow };
}
