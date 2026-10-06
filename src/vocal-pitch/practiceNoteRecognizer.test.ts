import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../domain/vocalPitch";
import {
  createPracticeNoteRecognizer,
  frequencyToNaturalPracticeNote,
  PRACTICE_NOTE_MAX_FREQUENCY_HZ,
  PRACTICE_NOTE_MIN_FREQUENCY_HZ,
} from "./practiceNoteRecognizer";

function observation(
  timeMs: number,
  midiNoteNumber = 69,
  rms = 0.006,
  options: { ambiguous?: boolean; confidence?: number; frequencyHz?: number | null } = {},
) {
  return {
    ambiguous: options.ambiguous,
    confidence: options.confidence ?? 0.98,
    frequencyHz: "frequencyHz" in options ? options.frequencyHz! : midiToFrequency(midiNoteNumber),
    rms,
    timeMs,
  };
}

describe("practice single-note recognition", () => {
  it("maps the configured F1-G6 range to natural note pitches", () => {
    expect(frequencyToNaturalPracticeNote(PRACTICE_NOTE_MIN_FREQUENCY_HZ)).toMatchObject({
      midiNoteNumber: 29,
      noteName: "F",
      octave: 1,
    });
    expect(frequencyToNaturalPracticeNote(PRACTICE_NOTE_MAX_FREQUENCY_HZ)).toMatchObject({
      midiNoteNumber: 91,
      noteName: "G",
      octave: 6,
    });
    expect(frequencyToNaturalPracticeNote(midiToFrequency(28))).toBeNull();
    expect(frequencyToNaturalPracticeNote(midiToFrequency(61))).toBeNull();
  });

  it("submits only after the same confident pitch stays stable", () => {
    const recognizer = createPracticeNoteRecognizer();
    expect(recognizer.process(observation(0))).toBeNull();
    expect(recognizer.process(observation(30))).toBeNull();
    expect(recognizer.process(observation(60))).toBeNull();
    expect(recognizer.process(observation(90))).toMatchObject({
      midiNoteNumber: 69,
      noteName: "A",
      octave: 4,
    });
  });

  it("ignores silence, low-confidence frames, detector disagreement, and unstable pitches", () => {
    const recognizer = createPracticeNoteRecognizer();
    expect(recognizer.process(observation(0, 60, 0.006, { confidence: 0.7 }))).toBeNull();
    expect(recognizer.process(observation(30, 60, 0.006, { ambiguous: true }))).toBeNull();
    expect(recognizer.process(observation(60, 60, 0.006, { frequencyHz: null }))).toBeNull();
    expect(recognizer.process(observation(90, 60))).toBeNull();
    expect(recognizer.process(observation(120, 64))).toBeNull();
    expect(recognizer.process(observation(150, 67))).toBeNull();
  });

  it("can recognize a repeated strike on the same key after its new onset", () => {
    const recognizer = createPracticeNoteRecognizer();
    const firstStrikeTimes = [0, 30, 60, 90];
    const firstStrikeLevels = [0.003, 0.006, 0.008, 0.007];
    const firstStrikeResults = firstStrikeTimes.map((timeMs, index) =>
      recognizer.process(observation(timeMs, 69, firstStrikeLevels[index])),
    );
    expect(firstStrikeResults.slice(0, 3)).toEqual([null, null, null]);
    expect(firstStrikeResults[3]).toMatchObject({ midiNoteNumber: 69 });
    [120, 150, 180].forEach((timeMs) => {
      expect(recognizer.process(observation(timeMs, 69, 0.004))).toBeNull();
    });
    expect(recognizer.process(observation(300, 69, 0.008))).toBeNull();
    expect(recognizer.process(observation(330, 69, 0.009))).toBeNull();
    expect(recognizer.process(observation(360, 69, 0.009))).toBeNull();
    expect(recognizer.process(observation(390, 69, 0.009))).toMatchObject({ midiNoteNumber: 69 });
  });

  it("restarts its stability window after an uncertain frame", () => {
    const recognizer = createPracticeNoteRecognizer();
    expect(recognizer.process(observation(0))).toBeNull();
    expect(recognizer.process(observation(30))).toBeNull();
    expect(recognizer.process(observation(60, 69, 0.006, { ambiguous: true }))).toBeNull();
    expect(recognizer.process(observation(90))).toBeNull();
    expect(recognizer.process(observation(120))).toBeNull();
    expect(recognizer.process(observation(150))).toBeNull();
    expect(recognizer.process(observation(180))).toMatchObject({ midiNoteNumber: 69 });
  });
});
