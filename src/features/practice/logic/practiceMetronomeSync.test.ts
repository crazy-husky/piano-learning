import { describe, expect, it } from "vitest";
import {
  getPracticeAudioTimeAtBeat,
  getPracticeTimingGrade,
  getPracticeTimingWindowMs,
} from "./practiceMetronomeSync";

describe("practice metronome sync timing", () => {
  it("uses audio-clock anchors and interpolates subdivisions", () => {
    expect(
      getPracticeAudioTimeAtBeat(
        0.5,
        [
          { beat: 0, audioTime: 10, bpm: 120 },
          { beat: 1, audioTime: 10.5, bpm: 120 },
        ],
        120
      )
    ).toBe(10.25);
  });

  it("follows a tempo change after its next clock anchor", () => {
    expect(
      getPracticeAudioTimeAtBeat(
        3,
        [
          { beat: 0, audioTime: 4, bpm: 60 },
          { beat: 2, audioTime: 6, bpm: 120 },
        ],
        120
      )
    ).toBe(6.5);
    expect(getPracticeAudioTimeAtBeat(4, [{ beat: 2, audioTime: 6, bpm: 120 }], 120)).toBe(7);
  });

  it("keeps timing windows inside the gap between adjacent notes", () => {
    expect(getPracticeTimingWindowMs(120, 1)).toBe(100);
    expect(getPracticeTimingWindowMs(120, 0.25)).toBeCloseTo(43.75);
  });

  it("grades correct pitches outside the window as early or late", () => {
    expect(getPracticeTimingGrade(-120, 100)).toBe("early");
    expect(getPracticeTimingGrade(100, 100)).toBe("on-time");
    expect(getPracticeTimingGrade(120, 100)).toBe("late");
  });
});
