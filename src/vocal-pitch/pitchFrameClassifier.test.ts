import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, midiToFrequency } from "../domain/vocalPitch";
import type { PitchFrameDetector } from "./pitchFrameDetector";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "./practiceNoteRecognizer";

describe("pitch frame classification ranges", () => {
  it("accepts F1 for practice while preserving the existing vocal-analysis lower bound", () => {
    const f1FrequencyHz = midiToFrequency(29);
    const detector: PitchFrameDetector = {
      detect: () => {
        const candidate = { clarity: 0.98, frequencyHz: f1FrequencyHz };
        return { fallback: candidate, primary: candidate };
      },
    };
    const samples = new Float32Array(2048).fill(0.01);

    expect(classifyPitchFrame(detector, samples, 44_100, DEFAULT_VOCAL_PITCH_CONFIG, 0).frame.frequencyHz)
      .toBeNull();
    expect(
      classifyPitchFrame(
        detector,
        samples,
        44_100,
        DEFAULT_VOCAL_PITCH_CONFIG,
        0,
        PRACTICE_NOTE_FREQUENCY_RANGE,
      ).frame.frequencyHz,
    ).toBe(f1FrequencyHz);
  });

  it("applies a caller-provided RMS floor for microphone sensitivity", () => {
    const frequencyHz = midiToFrequency(69);
    const detector: PitchFrameDetector = {
      detect: () => {
        const candidate = { clarity: 0.8, frequencyHz };
        return { fallback: candidate, primary: candidate };
      },
    };
    const samples = new Float32Array(2048).fill(0.001);
    const config = { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: 0.75 };

    expect(classifyPitchFrame(
      detector,
      samples,
      44_100,
      config,
      0,
      PRACTICE_NOTE_FREQUENCY_RANGE,
    ).frame.frequencyHz).toBeNull();
    expect(classifyPitchFrame(
      detector,
      samples,
      44_100,
      config,
      0,
      PRACTICE_NOTE_FREQUENCY_RANGE,
      0.0009,
    ).frame.frequencyHz).toBe(frequencyHz);
  });
});
