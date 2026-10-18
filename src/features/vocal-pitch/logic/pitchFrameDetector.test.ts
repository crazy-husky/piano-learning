import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, midiToFrequency } from "../../../domain/vocalPitch";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import { createPitchFrameDetector, getPitchFrameSize } from "./pitchFrameDetector";
import {
  frequencyToChromaticPracticeNote,
  frequencyToNaturalPracticeNote,
  PRACTICE_NOTE_FREQUENCY_RANGE,
  PRACTICE_NOTE_MIN_FREQUENCY_HZ,
} from "./practiceNoteRecognizer";
import { harmonicTone, PRACTICE_BLACK_KEY_MIDI_NOTES } from "./practiceBlackKeyTestFixtures";

describe("pitch frame sizing", () => {
  it("keeps the existing voice-analysis default and provides enough low-note periods for piano practice", () => {
    expect(getPitchFrameSize(44_100)).toBe(2048);
    expect(getPitchFrameSize(44_100, PRACTICE_NOTE_MIN_FREQUENCY_HZ, 6)).toBe(8192);
  });

  it("keeps MPM-C candidates across the C6-B6 practice register", () => {
    const sampleRate = 48_000;
    const frameSize = getPitchFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      6
    );
    const detector = createPitchFrameDetector(frameSize, {
      fallbackPeakThreshold: Number.EPSILON,
      primaryPeakThreshold: 0.8,
    });

    for (const midiNoteNumber of [84, 86, 88, 89, 91, 93, 95]) {
      const expectedFrequencyHz = midiToFrequency(midiNoteNumber);
      const detection = detector.detect(
        harmonicTone(expectedFrequencyHz, sampleRate, frameSize),
        sampleRate
      );

      expect(detection.fallback.clarity).toBeGreaterThan(0.8);
      expect(frequencyToNaturalPracticeNote(detection.fallback.frequencyHz)).toMatchObject({
        midiNoteNumber,
      });
    }
  });

  it("detects and maps all 25 black keys in the game register", () => {
    expect(PRACTICE_BLACK_KEY_MIDI_NOTES).toHaveLength(25);
    const sampleRate = 48_000;
    const frameSize = getPitchFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      6
    );
    const detector = createPitchFrameDetector(frameSize, {
      fallbackPeakThreshold: Number.EPSILON,
      primaryPeakThreshold: 0.8,
    });

    for (const expected of PRACTICE_BLACK_KEY_MIDI_NOTES) {
      const samples = harmonicTone(midiToFrequency(expected.midiNoteNumber), sampleRate, frameSize);
      const classified = classifyPitchFrame(
        detector,
        samples,
        sampleRate,
        DEFAULT_VOCAL_PITCH_CONFIG,
        0,
        PRACTICE_NOTE_FREQUENCY_RANGE
      );

      expect(
        classified.frame.frequencyHz,
        `MIDI ${expected.midiNoteNumber} stayed in range`
      ).not.toBeNull();
      expect(
        classified.candidate.clarity,
        `MIDI ${expected.midiNoteNumber} clarity`
      ).toBeGreaterThan(0.85);
      expect(
        frequencyToChromaticPracticeNote(classified.frame.frequencyHz!),
        `expected MIDI ${expected.midiNoteNumber}, got ${classified.candidate.frequencyHz} Hz`
      ).toMatchObject(expected);
    }
  });
});
