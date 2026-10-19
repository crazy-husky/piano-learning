import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, midiToFrequency } from "../../../domain/vocalPitch";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "./practiceNoteRecognizer";
import { harmonicTone, PRACTICE_BLACK_KEY_MIDI_NOTES } from "./practiceBlackKeyTestFixtures";

describe("YIN practice detector", () => {
  it("sizes analysis frames for the lowest supported piano register", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const size = getPracticeYinInputFrameSize(
        sampleRate,
        PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
      );
      expect(size).toBeGreaterThanOrEqual(8192);
      expect(Math.log2(size) % 1).toBe(0);
    }
  });

  it("recognizes D4 at common sample rates and B6 at 48 kHz", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const frameSize = getPracticeYinInputFrameSize(
        sampleRate,
        PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
      );
      const detector = createPracticeYinDetector(frameSize, sampleRate, {
        maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
        minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
        threshold: 0.15,
      });

      const result = classifyPitchFrame(
        detector,
        harmonicTone(midiToFrequency(62), sampleRate, frameSize),
        sampleRate,
        { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: 0.9 },
        0,
        PRACTICE_NOTE_FREQUENCY_RANGE
      );
      expect(result.frame.frequencyHz, `D4 at ${sampleRate} Hz`).not.toBeNull();
      expect(result.frame.frequencyHz).toBeCloseTo(midiToFrequency(62), 0);
    }

    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detector = createPracticeYinDetector(frameSize, sampleRate, {
      maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
      minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      threshold: 0.15,
    });
    const highResult = classifyPitchFrame(
      detector,
      harmonicTone(midiToFrequency(95), sampleRate, frameSize),
      sampleRate,
      { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: 0.9 },
      0,
      PRACTICE_NOTE_FREQUENCY_RANGE
    );
    expect(highResult.frame.frequencyHz, "B6 at 48 kHz").not.toBeNull();
    const highNoteCents =
      highResult.frame.frequencyHz === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(1200 * Math.log2(highResult.frame.frequencyHz / midiToFrequency(95)));
    expect(highNoteCents).toBeLessThanOrEqual(45);
  });

  it("estimates all 25 black-key targets in the game range within 45 cents", () => {
    expect(PRACTICE_BLACK_KEY_MIDI_NOTES).toHaveLength(25);
    const sampleRate = 48_000;
    const frameSize = getPracticeYinInputFrameSize(
      sampleRate,
      PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
    );
    const detector = createPracticeYinDetector(frameSize, sampleRate, {
      maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
      minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      threshold: 0.15,
    });

    for (const expected of PRACTICE_BLACK_KEY_MIDI_NOTES) {
      const classified = classifyPitchFrame(
        detector,
        harmonicTone(midiToFrequency(expected.midiNoteNumber), sampleRate, frameSize),
        sampleRate,
        // Test the estimator's pitch accuracy independently from the production confidence gate.
        { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: 0.85 },
        0,
        PRACTICE_NOTE_FREQUENCY_RANGE
      );
      expect(
        classified.frame.frequencyHz,
        `MIDI ${expected.midiNoteNumber} should remain inside the playable range`
      ).not.toBeNull();
      const deviationCents =
        classified.frame.frequencyHz === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(
              1200 *
                Math.log2(classified.frame.frequencyHz / midiToFrequency(expected.midiNoteNumber))
            );
      expect(
        deviationCents,
        `MIDI ${expected.midiNoteNumber} should be within 45 cents, got ${deviationCents.toFixed(1)}`
      ).toBeLessThanOrEqual(45);
    }
  });
});
