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
