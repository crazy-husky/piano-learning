import { describe, expect, it } from "vitest";
import { getPausedKeyboardAction } from "./practiceKeyboard";

describe("paused practice keyboard handling", () => {
  it("allows editing keys inside form controls", () => {
    expect(getPausedKeyboardAction({ isEditableTarget: true })).toBe("allow-edit");
  });

  it("blocks non-editing keys while paused", () => {
    expect(getPausedKeyboardAction({ isEditableTarget: false })).toBe("block");
  });
});
