import { describe, expect, it } from "vitest";
import {
  getTargetMidiNoteNumber,
  isPracticeAnswerCorrect,
  isPracticeAnswerSourceAllowed,
  normalizeAnswerPitchMode,
  resolveAvailableAnswerPitchMode,
} from "./answerInput";

const TARGET = { noteName: "C" as const, octave: 4 as const };

describe("practice answer pitch modes", () => {
  it("falls back to note-name matching while MIDI is unavailable", () => {
    expect(resolveAvailableAnswerPitchMode("exact-pitch", false)).toBe("note-name");
    expect(resolveAvailableAnswerPitchMode("exact-pitch", true)).toBe("exact-pitch");
    expect(resolveAvailableAnswerPitchMode("microphone", false)).toBe("microphone");
  });

  it("reads the legacy absolute-pitch value as exact-pitch", () => {
    expect(normalizeAnswerPitchMode("absolute-pitch")).toBe("exact-pitch");
    expect(normalizeAnswerPitchMode("exact-pitch")).toBe("exact-pitch");
    expect(normalizeAnswerPitchMode("microphone")).toBe("microphone");
  });

  it("accepts the same note name from every input source in note-name mode", () => {
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 2, source: "midi", midiNoteNumber: 36 }, TARGET, "note-name"))
      .toBe(true);
    expect(isPracticeAnswerCorrect({ noteName: "C", source: "computer-keyboard" }, TARGET, "note-name")).toBe(true);
  });

  it("requires the exact MIDI note in exact-pitch mode", () => {
    expect(getTargetMidiNoteNumber(TARGET)).toBe(60);
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 4, source: "midi", midiNoteNumber: 60 }, TARGET, "exact-pitch"))
      .toBe(true);
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 3, source: "midi", midiNoteNumber: 48 }, TARGET, "exact-pitch"))
      .toBe(false);
    expect(isPracticeAnswerCorrect({ noteName: "C", source: "screen-keyboard" }, TARGET, "exact-pitch"))
      .toBe(false);
  });

  it("accepts only exact microphone pitches in microphone mode", () => {
    const microphoneAnswer = {
      midiNoteNumber: 60,
      noteName: "C" as const,
      octave: 4,
      source: "microphone" as const,
    };
    expect(isPracticeAnswerSourceAllowed(microphoneAnswer, "microphone")).toBe(true);
    expect(isPracticeAnswerCorrect(microphoneAnswer, TARGET, "microphone")).toBe(true);
    expect(isPracticeAnswerCorrect({ ...microphoneAnswer, midiNoteNumber: 48, octave: 3 }, TARGET, "microphone"))
      .toBe(false);
    expect(isPracticeAnswerSourceAllowed({ ...microphoneAnswer, source: "midi" }, "microphone")).toBe(false);
    expect(isPracticeAnswerSourceAllowed({ ...microphoneAnswer, source: "screen-keyboard" }, "microphone"))
      .toBe(false);
  });
});
