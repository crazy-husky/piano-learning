import { describe, expect, it } from "vitest";
import {
  chooseNameToKeyTarget,
  createNameToKeyTargetPool,
  formatMidiName,
  getNameToKeyTarget,
  midiForOctaveKey,
  midiToKeyName,
  midiToOctave,
} from "./nameToKeyPractice";

describe("name-to-key practice", () => {
  it("uses only central C white keys by default", () => {
    expect(
      createNameToKeyTargetPool({
        includeOctaveNumbers: false,
        includeBlackKeys: false,
        randomEnharmonics: false,
      })
    ).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });

  it("keeps the advanced question range within F1 through B6", () => {
    const pool = createNameToKeyTargetPool({
      includeOctaveNumbers: true,
      includeBlackKeys: true,
      randomEnharmonics: false,
    });

    expect(pool).toHaveLength(67);
    expect(pool[0]).toBe(29);
    expect(pool.at(-1)).toBe(95);
  });

  it("shows octave numbers only when configured and uses MIDI as the answer identity", () => {
    expect(getNameToKeyTarget(61, false, false).displayName).toBe("C#");
    expect(getNameToKeyTarget(61, false, true).displayName).toBe("C#4");
    expect(formatMidiName(61)).toBe("C#4");
  });

  it("avoids immediate repeats when another note is available", () => {
    expect(chooseNameToKeyTarget([60, 62], 60)).toBe(62);
    expect(chooseNameToKeyTarget([60], 60)).toBe(60);
  });

  it("maps the advanced keyboard boundaries to F1 and B6", () => {
    expect(midiForOctaveKey(1, 5)).toBe(29);
    expect(midiForOctaveKey(6, 11)).toBe(95);
    expect(midiToKeyName(29)).toBe("F");
    expect(midiToOctave(95)).toBe(6);
  });
});
