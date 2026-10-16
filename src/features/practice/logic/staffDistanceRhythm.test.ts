import { describe, expect, it } from "vitest";
import { appendStaffDistanceRhythm, createStaffDistanceRhythm } from "./staffDistanceRhythm";

const DURATION_BEATS = {
  whole: 4,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
} as const;

describe("staff distance rhythm", () => {
  it("continues a partial beat without placing a note across a barline", () => {
    const initial = createStaffDistanceRhythm(["quarter", "eighth"], 1, 3.5, () => 0);
    const continuation = createStaffDistanceRhythm(
      ["quarter", "eighth"],
      8,
      initial.endBeat,
      () => 0
    );
    const combined = appendStaffDistanceRhythm(initial, continuation);

    expect(initial.endBeat).toBe(4);
    expect(combined.onsets[1]).toBe(4);
    combined.onsets.forEach((onset, index) => {
      const measureEnd = (Math.floor(onset / 4) + 1) * 4;
      expect(onset + DURATION_BEATS[combined.durations[index]!]).toBeLessThanOrEqual(
        measureEnd + 0.001
      );
    });
  });
});
