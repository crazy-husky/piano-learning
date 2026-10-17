import { describe, expect, it } from "vitest";
import { resolveStaffGameInputMode } from "./staffGameSettings";

describe("resolveStaffGameInputMode", () => {
  it("defaults to the virtual piano when no input mode is saved", () => {
    expect(
      resolveStaffGameInputMode(undefined, { midiAvailable: true, virtualAvailable: true })
    ).toBe("virtual");
  });

  it("keeps a saved input mode when it is available", () => {
    expect(
      resolveStaffGameInputMode("physical", { midiAvailable: true, virtualAvailable: true })
    ).toBe("physical");
    expect(resolveStaffGameInputMode("midi", { midiAvailable: true, virtualAvailable: true })).toBe(
      "midi"
    );
    expect(
      resolveStaffGameInputMode("virtual", { midiAvailable: true, virtualAvailable: true })
    ).toBe("virtual");
  });

  it("falls back to the virtual piano when a saved MIDI mode is unavailable", () => {
    expect(
      resolveStaffGameInputMode("midi", { midiAvailable: false, virtualAvailable: true })
    ).toBe("virtual");
  });

  it("uses the physical piano only when the virtual piano is unavailable", () => {
    expect(
      resolveStaffGameInputMode(undefined, { midiAvailable: false, virtualAvailable: false })
    ).toBe("physical");
  });
});
