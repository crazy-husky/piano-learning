import { PRACTICE_NOTE_FREQUENCY_RANGE, frequencyToNaturalPracticeNote } from "./practiceNoteRecognizer";
import type { PracticeMicrophoneThresholds } from "./practiceMicrophonePreferences";

export function describePracticeMicrophoneObservation(
  confidence: number,
  frequencyHz: number | null,
  rms: number,
  ambiguous: boolean,
  thresholds: PracticeMicrophoneThresholds,
): string {
  if (rms < thresholds.inputRmsThreshold) return "输入电平低于灵敏度门槛";
  if (frequencyHz === null || !Number.isFinite(frequencyHz) || frequencyHz <= 0) return "算法没有给出音高候选";
  if (confidence < thresholds.confidenceThreshold) return "候选置信度低于门槛";
  if (
    frequencyHz < PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz ||
    frequencyHz > PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz
  ) return "候选超出练习音域";
  if (!frequencyToNaturalPracticeNote(frequencyHz)) return "候选未落在可识别的自然音上";
  if (ambiguous) return "两个音高候选存在冲突";
  return "候选有效，等待稳定判定";
}
