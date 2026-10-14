import { describe, expect, it } from "vitest";
import { BUBBLE_FADE_IN_MS, staffGameReactionMs } from "./staffGameRules";

describe("staffGameReactionMs", () => {
  it("excludes answers during the bubble fade-in", () => {
    expect(staffGameReactionMs(1_000 + BUBBLE_FADE_IN_MS, 1_000)).toBe(0);
    expect(staffGameReactionMs(1_000 + BUBBLE_FADE_IN_MS - 1, 1_000)).toBe(-1);
  });

  it("starts measuring after the bubble fade-in completes", () => {
    expect(staffGameReactionMs(1_000 + BUBBLE_FADE_IN_MS + 350, 1_000)).toBe(350);
  });
});
