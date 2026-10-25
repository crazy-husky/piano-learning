import { describe, expect, it } from "vitest";
import type { PracticeGroupId, TargetNote } from "./types";
import {
  createStaffDistanceSequence,
  staffDistance,
  summarizeStaffDistancePair,
  validateStaffDistancePractice,
} from "./staffDistancePractice";

function makeNotes(): TargetNote[] {
  const names = ["C", "D", "E", "F", "G", "A", "B"] as const;
  return Array.from({ length: 14 }, (_, index) => {
    const noteName = names[index % 7]!;
    const octave = (4 + Math.floor(index / 7)) as 4 | 5;
    return {
      id: `${noteName}${octave}` as TargetNote["id"],
      pitchId: `${noteName}${octave}` as TargetNote["pitchId"],
      noteName,
      octave,
      groupId: index < 7 ? "G3-F4" : "G4-F5",
      staff: "treble",
      isInterStaffLedgerSpelling: false,
    };
  });
}

describe("staff distance practice", () => {
  it("counts adjacent staff positions and octave spans", () => {
    const c4 = makeNotes()[0]!;
    const e4 = makeNotes()[2]!;
    const c5 = makeNotes()[7]!;

    expect(staffDistance(c4, e4)).toBe(2);
    expect(staffDistance(c4, c5)).toBe(7);
    expect(summarizeStaffDistancePair(e4, c4)).toEqual({ distance: 2, direction: "down" });
  });

  it("allows repeated-note sequences when no long leap is available", () => {
    const c4 = makeNotes()[0]!;

    expect(staffDistance(c4, c4)).toBe(0);
    expect(summarizeStaffDistancePair(c4, c4)).toEqual({ distance: 0, direction: "same" });
    expect(createStaffDistanceSequence([c4], { includeUnison: true, maxDistance: 7 }, 2)).toEqual([
      c4,
      c4,
      c4,
    ]);
    expect(createStaffDistanceSequence([c4], { includeUnison: false, maxDistance: 7 }, 2)).toEqual(
      []
    );
  });

  it("requires two selected note groups for a seven-step maximum", () => {
    const notes = makeNotes();
    const settings = { includeUnison: true, maxDistance: 7 };

    expect(validateStaffDistancePractice(notes, ["G3-F4"], settings)).toEqual({
      ok: false,
      reason: "need-two-groups",
    });
    expect(validateStaffDistancePractice(notes, ["G3-F4", "G4-F5"], settings)).toEqual({
      ok: true,
    });
  });

  it("keeps a continuous sequence within the selected distance range", () => {
    const notes = makeNotes().slice(0, 8);
    const sequence = createStaffDistanceSequence(
      notes,
      { includeUnison: true, maxDistance: 2 },
      20,
      () => 0
    );

    expect(sequence).toHaveLength(21);
    for (let index = 1; index < sequence.length; index += 1) {
      expect(staffDistance(sequence[index - 1]!, sequence[index]!)).toBeLessThanOrEqual(2);
    }
  });

  it("avoids runs of three identical intervals when alternatives are available", () => {
    const notes = makeNotes();
    let seed = 987654321;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const sequence = createStaffDistanceSequence(
      notes,
      { includeUnison: false, maxDistance: 7 },
      2_000,
      random
    );

    let previousDistance: number | undefined;
    let consecutiveCount = 0;
    for (let index = 1; index < sequence.length; index += 1) {
      const distance = staffDistance(sequence[index - 1]!, sequence[index]!);
      consecutiveCount = distance === previousDistance ? consecutiveCount + 1 : 1;
      expect(consecutiveCount).toBeLessThanOrEqual(2);
      previousDistance = distance;
    }
  });

  it("covers both long-leap directions in a complete window when the range allows it", () => {
    const notes = makeNotes();
    for (let initialSeed = 1; initialSeed <= 12; initialSeed += 1) {
      let seed = initialSeed;
      const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
      };
      const sequence = createStaffDistanceSequence(
        notes,
        { includeUnison: false, maxDistance: 7 },
        20,
        random
      );
      const longLeapDirections = sequence.slice(1).flatMap((note, index) => {
        const previous = sequence[index]!;
        const distance = staffDistance(previous, note);
        if (distance < 5) return [];
        return [summarizeStaffDistancePair(previous, note).direction];
      });

      expect(longLeapDirections).toContain("up");
      expect(longLeapDirections).toContain("down");
    }
  });

  it("uses the configured treble distance weights", () => {
    const notes = makeNotes().slice(0, 8);
    const distanceAtQuantile = (quantile: number): number => {
      let call = 0;
      const random = (): number => {
        call += 1;
        if (call === 1) return 0; // Select the only starting note, C4.
        if (call === 2) return 0.9; // Keep the first transition out of the forced-leap route.
        if (call === 3) return quantile; // Select a distance from the weighted distribution.
        return 0;
      };
      const sequence = createStaffDistanceSequence(
        notes,
        { includeUnison: false, maxDistance: 7 },
        1,
        random,
        notes[0]
      );
      return staffDistance(sequence[0]!, sequence[1]!);
    };

    expect(distanceAtQuantile(0.15)).toBe(1);
    expect(distanceAtQuantile(0.45)).toBe(2);
    expect(distanceAtQuantile(0.7)).toBe(3);
    expect(distanceAtQuantile(0.85)).toBe(4);
    expect(distanceAtQuantile(0.91)).toBe(5);
    expect(distanceAtQuantile(0.95)).toBe(6);
    expect(distanceAtQuantile(0.99)).toBe(7);
  });

  it("keeps enabled unison answers near five percent when only short distances are available", () => {
    const notes = makeNotes().slice(0, 3);
    let seed = 123456789;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const sequence = createStaffDistanceSequence(
      notes,
      { includeUnison: true, maxDistance: 2 },
      20_000,
      random
    );
    const unisonRate =
      sequence.slice(1).filter((note, index) => staffDistance(sequence[index]!, note) === 0)
        .length / 20_000;

    expect(unisonRate).toBeGreaterThan(0.04);
    expect(unisonRate).toBeLessThan(0.06);
  });

  it("reports unavailable distances and a one-answer setup", () => {
    const notes = makeNotes().filter((note) => note.noteName === "C" || note.noteName === "E");

    expect(
      validateStaffDistancePractice(notes, ["G3-F4" as PracticeGroupId], {
        includeUnison: true,
        maxDistance: 2,
      })
    ).toEqual({ ok: false, reason: "missing-distances", missing: [1] });
    expect(
      validateStaffDistancePractice(notes, ["G3-F4"], {
        includeUnison: false,
        maxDistance: 1,
      })
    ).toEqual({ ok: false, reason: "only-one-answer" });
  });
});
