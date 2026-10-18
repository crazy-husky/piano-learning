import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { MidiInputController } from "../../../midi/useMidiInput";
import { usePracticeMicrophoneInput } from "../../vocal-pitch/logic/usePracticeMicrophoneInput";
import type { PracticeMicrophonePreferences } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { StaffGameView } from "./StaffGameView";

interface StaffGameRouteProps {
  midi: MidiInputController;
  microphonePreferences: PracticeMicrophonePreferences;
  initialMode: "levels" | "songs";
  initialSongSelectionStep: "list" | "detail";
  initialSongId?: string;
  isSongPlayRoute: boolean;
  onModeChange: (mode: "levels" | "songs") => void;
  onSongStart: (songId: string) => void;
  onSongSelectionExit: () => void;
  onExit: () => void;
  onRunningChange: (running: boolean) => void;
  navigationExitRequest?: {
    id: number;
    targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal";
  } | null;
  onNavigationExit?: (
    targetView: "home" | "practice" | "stats" | "settings" | "study" | "vocal"
  ) => void;
}

export function StaffGameRoute({
  midi,
  microphonePreferences,
  initialMode,
  initialSongSelectionStep,
  initialSongId,
  isSongPlayRoute,
  onModeChange,
  onSongStart,
  onSongSelectionExit,
  onExit,
  onRunningChange,
  navigationExitRequest,
  onNavigationExit,
}: StaffGameRouteProps): JSX.Element {
  const answerHandlerRef = useRef<((answer: PracticeAnswerInput) => void) | null>(null);
  const handledNavigationExitRequestIdRef = useRef<number | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const registerAnswerHandler = useCallback(
    (handler: ((answer: PracticeAnswerInput) => void) | null): void => {
      answerHandlerRef.current = handler;
    },
    []
  );
  const handleMicrophoneAnswer = useCallback((answer: PracticeAnswerInput): void => {
    answerHandlerRef.current?.(answer);
  }, []);
  const microphone = usePracticeMicrophoneInput(handleMicrophoneAnswer, microphonePreferences);
  const stopMicrophone = microphone.stop;
  const handleSessionActiveChange = useCallback(
    (active: boolean): void => {
      setSessionActive(active);
      onRunningChange(active);
    },
    [onRunningChange]
  );

  useEffect(() => () => onRunningChange(false), [onRunningChange]);

  useEffect(() => {
    if (
      !sessionActive ||
      !navigationExitRequest ||
      handledNavigationExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledNavigationExitRequestIdRef.current = navigationExitRequest.id;
    stopMicrophone();
    setSessionActive(false);
    onNavigationExit?.(navigationExitRequest.targetView);
  }, [navigationExitRequest, onNavigationExit, sessionActive, stopMicrophone]);

  return (
    <StaffGameView
      key={initialMode}
      microphone={microphone}
      microphoneAlgorithm={microphonePreferences.algorithm}
      midi={midi}
      initialMode={initialMode}
      initialSongSelectionStep={initialSongSelectionStep}
      initialSongId={initialSongId}
      isSongPlayRoute={isSongPlayRoute}
      onModeChange={onModeChange}
      onSongStart={onSongStart}
      onSongSelectionExit={onSongSelectionExit}
      onExit={onExit}
      onRegisterAnswerHandler={registerAnswerHandler}
      onSessionActiveChange={handleSessionActiveChange}
    />
  );
}
