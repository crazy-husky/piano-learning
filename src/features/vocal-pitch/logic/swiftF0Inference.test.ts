import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../../../domain/vocalPitch";
import {
  frequencyToChromaticPracticeNote,
  frequencyToNaturalPracticeNote,
} from "./practiceNoteRecognizer";
import { analyzeSwiftF0, createSwiftF0Session } from "./swiftF0Inference";
import { harmonicTone, PRACTICE_BLACK_KEY_MIDI_NOTES } from "./practiceBlackKeyTestFixtures";

const SWIFTF0_PATH = resolve("public/models/vocal-pitch/swift-f0-v0.3.0.onnx");

function sine(frequencyHz: number): Float32Array {
  return Float32Array.from(
    { length: 16_000 },
    (_, index) => 0.2 * Math.sin((2 * Math.PI * frequencyHz * index) / 16_000)
  );
}

describe("SwiftF0 live inference", () => {
  it("creates a WASM session and recognizes a reference tone", async () => {
    const modelBytes = await readFile(SWIFTF0_PATH);
    const model = modelBytes.buffer.slice(
      modelBytes.byteOffset,
      modelBytes.byteOffset + modelBytes.byteLength
    );
    const session = await createSwiftF0Session(model);

    try {
      const result = await analyzeSwiftF0(session, sine(220), 16_000);
      expect(result.frequencyHz).toBeCloseTo(220, 0);
      expect(result.confidence).toBeGreaterThan(0);
    } finally {
      await session.release();
    }
  }, 30_000);

  it("recognizes a synthetic B6 tone within the practice register", async () => {
    const modelBytes = await readFile(SWIFTF0_PATH);
    const model = modelBytes.buffer.slice(
      modelBytes.byteOffset,
      modelBytes.byteOffset + modelBytes.byteLength
    );
    const session = await createSwiftF0Session(model);

    try {
      const result = await analyzeSwiftF0(session, sine(midiToFrequency(95)), 16_000);
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(frequencyToNaturalPracticeNote(result.frequencyHz)).toMatchObject({
        midiNoteNumber: 95,
        noteName: "B",
        octave: 6,
      });
    } finally {
      await session.release();
    }
  }, 30_000);

  it("recognizes all 25 black keys in the game register", async () => {
    expect(PRACTICE_BLACK_KEY_MIDI_NOTES).toHaveLength(25);
    const modelBytes = await readFile(SWIFTF0_PATH);
    const model = modelBytes.buffer.slice(
      modelBytes.byteOffset,
      modelBytes.byteOffset + modelBytes.byteLength
    );
    const session = await createSwiftF0Session(model);

    try {
      for (const expected of PRACTICE_BLACK_KEY_MIDI_NOTES) {
        const result = await analyzeSwiftF0(
          session,
          harmonicTone(midiToFrequency(expected.midiNoteNumber), 16_000, 16_000),
          16_000
        );

        expect(result.confidence, `MIDI ${expected.midiNoteNumber} confidence`).toBeGreaterThan(
          0.6
        );
        expect(
          frequencyToChromaticPracticeNote(result.frequencyHz),
          `expected MIDI ${expected.midiNoteNumber}, got ${result.frequencyHz} Hz`
        ).toMatchObject(expected);
      }
    } finally {
      await session.release();
    }
  }, 60_000);
});
