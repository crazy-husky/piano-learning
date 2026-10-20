import { describe, expect, it } from "vitest";
import {
  ALL_NOTES,
  AVAILABLE_PITCH_IDS,
  ANSWER_BUTTONS,
  DEFAULT_ENABLED_GROUPS,
  formatTargetNoteLabel,
  getCurrentTargetNoteIdsForGroups,
  getNoteById,
  getNotesForGroups,
  normalizeCurrentPracticeGroupIds,
  normalizePracticeGroupIds,
  PRACTICE_GROUPS,
} from "./notes";

describe("notes", () => {
  it("builds the active natural-note pool from C2 through B6 with inter-staff spellings", () => {
    expect(ALL_NOTES).toHaveLength(70);
    expect(ALL_NOTES[0].id).toBe("C2");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C2");
    expect(ALL_NOTES.map((note) => note.id)).toContain("B6");
    expect(ALL_NOTES.map((note) => note.id)).toContain("E3-treble");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C4-bass");
    expect(ALL_NOTES.map((note) => note.id)).toContain("A4-bass");
    expect(ALL_NOTES.map((note) => note.id)).toContain("A6");
    expect(ALL_NOTES.map((note) => note.id)).toContain("B6");
    expect(ALL_NOTES.map((note) => note.id)).toContain("D3-treble");
    expect(ALL_NOTES.map((note) => note.id)).toContain("B4-bass");
    expect(AVAILABLE_PITCH_IDS).toHaveLength(35);
    expect(AVAILABLE_PITCH_IDS[0]).toBe("C2");
    expect(AVAILABLE_PITCH_IDS.at(-1)).toBe("B6");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("F1");
    expect(getNoteById("F1").id).toBe("F1");
  });

  it("orders practice groups from low to high while defaulting to the middle group", () => {
    expect(PRACTICE_GROUPS.map((group) => group.id)).toEqual([
      "C2-B2",
      "C3-B3",
      "C4-B4",
      "C5-B5",
      "C6-B6",
    ]);
    expect(DEFAULT_ENABLED_GROUPS).toEqual(["C4-B4"]);
  });

  it("keeps five complete octave groups with seven natural pitches each", () => {
    expect(
      PRACTICE_GROUPS.map((group) => new Set(group.notes.map((note) => note.pitchId)).size)
    ).toEqual([7, 7, 7, 7, 7]);
    expect(PRACTICE_GROUPS.map((group) => group.notes)).toHaveLength(5);
  });

  it("can exclude the added inter-staff ledger spellings from enabled practice groups", () => {
    expect(getNotesForGroups(["C5-B5"])).toHaveLength(7);
    expect(getNotesForGroups(["C5-B5"], false).map((note) => note.id)).toEqual([
      "C5",
      "D5",
      "E5",
      "F5",
      "G5",
      "A5",
      "B5",
    ]);
  });

  it("labels inter-staff ledger spellings by pitch and staff", () => {
    expect(formatTargetNoteLabel(getNoteById("E3"))).toBe("E3 · 低音谱号");
    expect(formatTargetNoteLabel(getNoteById("E3-treble"))).toBe("E3 · 高音谱号");
    expect(formatTargetNoteLabel(getNoteById("C2"))).toBe("C2 · 低音谱号");
    expect(formatTargetNoteLabel(getNoteById("C2"), new Set(["C2"]))).toBe("C2");
    expect(formatTargetNoteLabel(getNoteById("C4"), new Set(["C4", "C4-bass"]))).toBe(
      "C4 · 高音谱号"
    );
  });

  it("keeps single-clef core ranges on the correct side of middle C", () => {
    const groups = PRACTICE_GROUPS.map((group) => group.id);
    const trebleNotes = getNotesForGroups(groups, true, "treble-only");
    const bassNotes = getNotesForGroups(groups, true, "bass-only");

    expect(trebleNotes).toHaveLength(21);
    expect(trebleNotes.every((note) => note.staff === "treble")).toBe(true);
    expect(trebleNotes.map((note) => note.pitchId)).toContain("C4");
    expect(trebleNotes.map((note) => note.pitchId)).not.toContain("B3");
    expect(bassNotes).toHaveLength(14);
    expect(bassNotes.every((note) => note.staff === "bass")).toBe(true);
    expect(bassNotes.map((note) => note.pitchId)).toContain("B3");
    expect(bassNotes.map((note) => note.pitchId)).not.toContain("C4");
  });

  it("normalizes persisted group ids to the current low-to-high groups", () => {
    expect(normalizePracticeGroupIds(["C2-B2", "C4-B4", "C6-B6"])).toEqual([
      "C2-B2",
      "C4-B4",
      "C6-B6",
    ]);
    expect(normalizePracticeGroupIds(["G4-F5", "F1-F2"])).toEqual(["C2-B2", "C5-B5"]);
    expect(normalizePracticeGroupIds([])).toEqual(["C4-B4"]);
    expect(normalizePracticeGroupIds(["unknown"])).toEqual(["C4-B4"]);
    expect(normalizeCurrentPracticeGroupIds([])).toEqual([]);
  });

  it("can collect current target note ids for group filtering", () => {
    const noteIds = getCurrentTargetNoteIdsForGroups(["C4-B4"]);
    expect(noteIds.has("C4")).toBe(true);
    expect(noteIds.has("C4-bass")).toBe(true);
    expect(noteIds.has("A6")).toBe(false);
  });

  it("maps numeric answer buttons to absolute natural note names", () => {
    expect(ANSWER_BUTTONS.map((button) => `${button.key}:${button.noteName}`)).toEqual([
      "1:C",
      "2:D",
      "3:E",
      "4:F",
      "5:G",
      "6:A",
      "7:B",
    ]);
  });
});
