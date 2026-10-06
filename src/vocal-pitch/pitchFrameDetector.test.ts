import { describe, expect, it } from "vitest";
import { getPitchFrameSize } from "./pitchFrameDetector";
import { PRACTICE_NOTE_MIN_FREQUENCY_HZ } from "./practiceNoteRecognizer";

describe("pitch frame sizing", () => {
  it("keeps the existing voice-analysis default and provides enough low-note periods for piano practice", () => {
    expect(getPitchFrameSize(44_100)).toBe(2048);
    expect(getPitchFrameSize(44_100, PRACTICE_NOTE_MIN_FREQUENCY_HZ, 6)).toBe(8192);
  });
});
