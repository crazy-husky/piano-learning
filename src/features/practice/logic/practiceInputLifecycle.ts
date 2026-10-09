import type { AnswerPitchMode } from "../../../domain/types";

export function releasePracticeMicrophoneOnPause(
  answerPitchMode: AnswerPitchMode,
  stopMicrophone: () => void,
): void {
  if (answerPitchMode === "microphone") {
    stopMicrophone();
  }
}

export async function ensurePracticeMicrophoneForResume({
  answerPitchMode,
  isListening,
  startMicrophone,
}: {
  answerPitchMode: AnswerPitchMode;
  isListening: boolean;
  startMicrophone: () => Promise<boolean>;
}): Promise<boolean> {
  if (answerPitchMode !== "microphone" || isListening) {
    return true;
  }
  return startMicrophone();
}
