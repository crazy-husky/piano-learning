import { describe, expect, it, vi } from "vitest";
import { triggerStaffGameHitHaptic } from "./staffGameHaptics";

describe("staff game hit haptics", () => {
  it("requests a short tactile pulse pattern when vibration is available", () => {
    const vibrate = vi.fn(() => true);

    triggerStaffGameHitHaptic(vibrate);

    expect(vibrate).toHaveBeenCalledWith([24, 16, 32]);
  });

  it("does nothing when the device has no vibration API", () => {
    expect(() => triggerStaffGameHitHaptic(null)).not.toThrow();
  });

  it("ignores vibration API failures", () => {
    const vibrate = vi.fn(() => {
      throw new Error("vibration unavailable");
    });

    expect(() => triggerStaffGameHitHaptic(vibrate)).not.toThrow();
  });
});
