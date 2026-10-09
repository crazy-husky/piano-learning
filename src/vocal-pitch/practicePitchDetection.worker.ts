/// <reference lib="webworker" />

import { DEFAULT_VOCAL_PITCH_CONFIG } from "../domain/vocalPitch";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import { createPitchFrameDetector, getPitchFrameSize } from "./pitchFrameDetector";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "./practiceNoteRecognizer";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";

interface AnalyzeMessage {
  algorithm: "mpm-c" | "yin";
  confidenceThreshold: number;
  generation: number;
  id: number;
  inputRmsThreshold: number;
  primaryClarityThreshold: number;
  sampleRate: number;
  samples: ArrayBuffer;
  timeMs: number;
  yinThreshold: number;
  type: "analyze";
}

interface CachedDetector {
  detector: ReturnType<typeof createPitchFrameDetector> | ReturnType<typeof createPracticeYinDetector>;
  key: string;
}

let cached: CachedDetector | null = null;

function getDetector(message: AnalyzeMessage): CachedDetector["detector"] {
  const frameSize = message.algorithm === "yin"
    ? getPracticeYinInputFrameSize(message.sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz)
    : getPitchFrameSize(message.sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz, 6);
  const key = [
    message.algorithm,
    frameSize,
    message.sampleRate,
    message.primaryClarityThreshold,
    message.yinThreshold,
  ].join(":");
  if (cached?.key === key) return cached.detector;

  const detector = message.algorithm === "yin"
    ? createPracticeYinDetector(frameSize, message.sampleRate, {
        maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
        minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
        threshold: message.yinThreshold,
      })
    : createPitchFrameDetector(frameSize, {
        fallbackPeakThreshold: Number.EPSILON,
        primaryPeakThreshold: message.primaryClarityThreshold,
      });
  cached = { detector, key };
  return detector;
}

self.addEventListener("message", (event: MessageEvent<AnalyzeMessage>) => {
  const message = event.data;
  try {
    const detector = getDetector(message);
    const detection = classifyPitchFrame(
      detector,
      new Float32Array(message.samples),
      message.sampleRate,
      { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: message.confidenceThreshold },
      message.timeMs / 1000,
      PRACTICE_NOTE_FREQUENCY_RANGE,
      message.inputRmsThreshold,
    );
    self.postMessage({
      alternativeClarity: detection.alternativeCandidate?.clarity ?? null,
      alternativeFrequencyHz: detection.alternativeCandidate?.frequencyHz ?? null,
      candidateClarity: detection.candidate.clarity,
      candidateFrequencyHz: detection.candidate.frequencyHz,
      generation: message.generation,
      id: message.id,
      type: "result",
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      generation: message.generation,
      id: message.id,
      type: "error",
    });
  }
});
