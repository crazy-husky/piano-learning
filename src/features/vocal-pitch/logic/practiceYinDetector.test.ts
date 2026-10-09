import { describe, expect, it } from "vitest";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "./practiceNoteRecognizer";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";

function harmonicTone(frequencyHz: number, sampleRate: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => {
    const phase = 2 * Math.PI * frequencyHz * index / sampleRate;
    return 0.4 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
  });
}

function createDetector(sampleRate: number, frameSize: number) {
  return createPracticeYinDetector(frameSize, sampleRate, {
    ...PRACTICE_NOTE_FREQUENCY_RANGE,
    threshold: 0.15,
  });
}

describe("practice YIN detector", () => {
  it("detects a harmonic-rich A4 frame after downsampling 48 kHz input", () => {
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz);
    const detection = createDetector(sampleRate, frameSize).detect(
      harmonicTone(440, sampleRate, frameSize),
      sampleRate,
    );

    expect(frameSize).toBe(8192);
    expect(detection.fallback.frequencyHz).toBeCloseTo(440, 0);
    expect(detection.fallback.clarity).toBeGreaterThan(0.75);
  });

  it("keeps the lowest practice register in range", () => {
    const sampleRate = 44_100;
    const frameSize = getPracticeYinInputFrameSize(sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz);
    const detection = createDetector(sampleRate, frameSize).detect(
      harmonicTone(PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz, sampleRate, frameSize),
      sampleRate,
    );

    expect(detection.fallback.frequencyHz).toBeCloseTo(PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz, 0);
    expect(detection.fallback.clarity).toBeGreaterThan(0.75);
  });

  it("returns no voiced candidate for silence", () => {
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz);
    const detection = createDetector(sampleRate, frameSize).detect(new Float32Array(frameSize), sampleRate);

    expect(detection.fallback).toEqual({ clarity: 0, frequencyHz: 0 });
  });
});
