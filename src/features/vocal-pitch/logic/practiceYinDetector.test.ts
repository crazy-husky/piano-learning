import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../../../domain/vocalPitch";
import {
  frequencyToChromaticPracticeNote,
  frequencyToNaturalPracticeNote,
  PRACTICE_NOTE_FREQUENCY_RANGE,
} from "./practiceNoteRecognizer";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";
import { harmonicTone, PRACTICE_BLACK_KEY_MIDI_NOTES } from "./practiceBlackKeyTestFixtures";

function createDetector(sampleRate: number, frameSize: number) {
  return createPracticeYinDetector(frameSize, sampleRate, {
    ...PRACTICE_NOTE_FREQUENCY_RANGE,
    threshold: 0.15,
  });
}

describe("practice YIN detector", () => {
  it("detects a harmonic-rich A4 frame after downsampling 48 kHz input", () => {
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detection = createDetector(sampleRate, frameSize).detect(
      harmonicTone(440, sampleRate, frameSize),
      sampleRate
    );

    expect(frameSize).toBe(8192);
    expect(detection.fallback.frequencyHz).toBeCloseTo(440, 0);
    expect(detection.fallback.clarity).toBeGreaterThan(0.75);
  });

  it("detects B6 within the configured upper range despite small pitch estimation error", () => {
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detection = createDetector(sampleRate, frameSize).detect(
      harmonicTone(midiToFrequency(95), sampleRate, frameSize),
      sampleRate
    );

    expect(detection.fallback.clarity).toBeGreaterThan(0.75);
    expect(frequencyToNaturalPracticeNote(detection.fallback.frequencyHz)).toMatchObject({
      midiNoteNumber: 95,
      noteName: "B",
      octave: 6,
    });
  });

  it("detects and maps all 25 black keys in the game register", () => {
    expect(PRACTICE_BLACK_KEY_MIDI_NOTES).toHaveLength(25);
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detector = createDetector(sampleRate, frameSize);

    for (const expected of PRACTICE_BLACK_KEY_MIDI_NOTES) {
      const detection = detector.detect(
        harmonicTone(midiToFrequency(expected.midiNoteNumber), sampleRate, frameSize),
        sampleRate
      );

      expect(detection.fallback.clarity, `MIDI ${expected.midiNoteNumber} clarity`).toBeGreaterThan(
        0.75
      );
      expect(
        frequencyToChromaticPracticeNote(detection.fallback.frequencyHz),
        `expected MIDI ${expected.midiNoteNumber}, got ${detection.fallback.frequencyHz} Hz`
      ).toMatchObject(expected);
    }
  });

  it("keeps the lowest practice register in range", () => {
    const sampleRate = 44_100;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detection = createDetector(sampleRate, frameSize).detect(
      harmonicTone(PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz, sampleRate, frameSize),
      sampleRate
    );

    expect(detection.fallback.frequencyHz).toBeCloseTo(
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      0
    );
    expect(detection.fallback.clarity).toBeGreaterThan(0.75);
  });

  it("returns no voiced candidate for silence", () => {
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detection = createDetector(sampleRate, frameSize).detect(
      new Float32Array(frameSize),
      sampleRate
    );

    expect(detection.fallback).toEqual({ clarity: 0, frequencyHz: 0 });
  });
});
