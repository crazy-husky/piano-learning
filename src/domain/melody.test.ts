import { describe, expect, it } from "vitest";
import { createMelodyGenerationState, selectMelodyNotes } from "./melody";
import { getNotesForGroups, PRACTICE_GROUPS } from "./notes";

function rngFrom(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0;
}

describe("melody generator", () => {
  it("generates the requested count inside the enabled practice range", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const selected = selectMelodyNotes({
      notes,
      count: 12,
      rng: rngFrom([0.2, 0.4, 0.7, 0.1, 0.9, 0.3]),
    });

    expect(selected).toHaveLength(12);
    expect(selected.every((note) => note.groupId === "G3-F4")).toBe(true);
  });

  it("cadences phrase endings on stable notes", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const selected = selectMelodyNotes({
      notes,
      count: 8,
      rng: rngFrom([0.1]),
    });

    expect(["C", "G"]).toContain(selected[7].noteName);
  });

  it("covers every register once before revisiting one when every phrase transfers", () => {
    const notes = getNotesForGroups(
      PRACTICE_GROUPS.map((group) => group.id),
      false,
      "treble-only"
    );
    const state = createMelodyGenerationState();
    const selected = selectMelodyNotes({ notes, count: 40, state, rng: () => 0 });

    expect(state.registerVisitCounts).toHaveLength(3);
    expect(state.registerVisitCounts.every((count) => count > 0)).toBe(true);
    expect(Math.min(...selected.map((note) => note.octave))).toBe(4);
    expect(Math.max(...selected.map((note) => note.octave))).toBeGreaterThanOrEqual(5);
  });

  it("can keep consecutive phrases in the same register", () => {
    const notes = getNotesForGroups(
      PRACTICE_GROUPS.map((group) => group.id),
      false,
      "treble-only"
    );
    const state = createMelodyGenerationState();
    selectMelodyNotes({ notes, count: 24, state, rng: () => 0.99 });

    expect(state.registerVisitCounts).toEqual([0, 0, 3]);
  });

  it("alternates grand-staff phrases between treble and bass when both are selected", () => {
    const notes = getNotesForGroups(["G3-F4", "G4-F5"], false);
    const selected = selectMelodyNotes({ notes, count: 32, rng: () => 0.5 });

    expect(new Set(selected.map((note) => note.staff))).toEqual(new Set(["treble", "bass"]));
  });

  it("softly prefers the less-practiced pitch when both melodic directions are available", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const state = createMelodyGenerationState();
    state.currentRegisterIndex = 0;
    state.phrasePosition = 1;
    state.pitchVisitCounts = { B3: 100, D4: 0 };
    state.registerVisitCounts = [1];

    const selected = selectMelodyNotes({
      notes,
      count: 1,
      lastTargetNoteId: "C4",
      state,
      rng: rngFrom([0, 0.5, 0]),
    });

    expect(selected[0].pitchId).toBe("D4");
  });

  it("carries a short transition into the opposite grand staff at the next phrase", () => {
    const notes = getNotesForGroups(
      PRACTICE_GROUPS.map((group) => group.id),
      false
    );
    const previousNote = notes.find((note) => note.pitchId === "F1");
    const state = createMelodyGenerationState();
    state.currentRegisterIndex = 0;
    state.registerVisitCounts = [1, 0, 0, 0, 0];

    const selected = selectMelodyNotes({
      notes,
      count: 1,
      lastTargetNoteId: previousNote?.id,
      state,
      rng: rngFrom([0, 0, 0, 0, 0.8, 0, 0, 0]),
    });

    expect(state.currentRegisterIndex).toBe(2);
    expect(selected[0].staff).toBe("treble");
  });
});
