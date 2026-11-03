import { describe, expect, it } from "vitest";
import type { Octave, StaffDistanceComputerKeyboardBindings } from "../../../domain/types";
import {
  DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS,
  getStaffDistanceComputerKeyboardPitch,
  getStaffDistanceComputerKeyboardRange,
  normalizeStaffDistanceComputerKeyboardBindings,
  requiresExternalKeyboardNotice,
} from "./staffDistanceComputerKeyboard";

function notesAt(...octaves: number[]): Array<{ octave: Octave }> {
  return octaves.map((octave) => ({ octave: octave as Octave }));
}

describe("staff distance computer keyboard", () => {
  it("allows at most one selected octave group per hand, including ledger extensions", () => {
    expect(getStaffDistanceComputerKeyboardRange(notesAt(2, 4))).toEqual({
      isEligible: true,
      leftOctave: 2,
      rightOctave: 4,
    });
    expect(getStaffDistanceComputerKeyboardRange(notesAt(3))).toEqual({
      isEligible: true,
      leftOctave: 3,
    });
    expect(getStaffDistanceComputerKeyboardRange(notesAt(4, 3))).toEqual({
      isEligible: true,
      leftOctave: 3,
      rightOctave: 4,
    });
    expect(getStaffDistanceComputerKeyboardRange(notesAt(2, 3))).toMatchObject({
      isEligible: false,
      reason: "too-many-low-groups",
    });
    expect(getStaffDistanceComputerKeyboardRange(notesAt(4, 5))).toMatchObject({
      isEligible: false,
      reason: "too-many-high-groups",
    });
  });

  it("maps physical key codes to the selected hand octave and uses the approved defaults", () => {
    expect(DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.left).toEqual({
      C: "Backquote",
      D: "Digit1",
      E: "Digit2",
      F: "Digit3",
      G: "Digit4",
      A: "Digit5",
      B: "Digit6",
    });
    expect(DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.right).toEqual({
      C: "KeyG",
      D: "KeyH",
      E: "KeyJ",
      F: "KeyK",
      G: "KeyL",
      A: "Semicolon",
      B: "Quote",
    });
    expect(
      getStaffDistanceComputerKeyboardPitch(
        "Backquote",
        DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS,
        {
          leftOctave: 2,
          rightOctave: 5,
        }
      )
    ).toEqual({ noteName: "C", octave: 2 });
    expect(
      getStaffDistanceComputerKeyboardPitch(
        "Quote",
        DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS,
        {
          rightOctave: 5,
        }
      )
    ).toEqual({ noteName: "B", octave: 5 });
  });

  it("rejects invalid or duplicate saved keys and accepts unique editable maps", () => {
    const duplicated = {
      left: { ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.left, C: "KeyZ" },
      right: { ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.right, B: "KeyZ" },
    };
    expect(normalizeStaffDistanceComputerKeyboardBindings(duplicated)).toBe(
      DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS
    );
    expect(
      normalizeStaffDistanceComputerKeyboardBindings({
        ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS,
        left: { ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.left, C: "Space" },
      })
    ).toBe(DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS);

    const custom: StaffDistanceComputerKeyboardBindings = {
      left: { ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.left, C: "KeyZ" },
      right: { ...DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS.right },
    };
    expect(normalizeStaffDistanceComputerKeyboardBindings(custom)).toEqual(custom);
  });

  it("requires an external-keyboard notice on phones, tablets, and touch iPads", () => {
    expect(
      requiresExternalKeyboardNotice({
        maxTouchPoints: 0,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      })
    ).toBe(false);
    expect(
      requiresExternalKeyboardNotice({
        maxTouchPoints: 5,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      })
    ).toBe(true);
    expect(
      requiresExternalKeyboardNotice({
        maxTouchPoints: 1,
        platform: "Linux armv8l",
        userAgent: "Mozilla/5.0 (Linux; Android 13; Tablet)",
      })
    ).toBe(true);
  });
});
