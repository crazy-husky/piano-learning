import { expect, it } from "vitest";
import { isStudyNoteHighlighted, isStudyNoteNameHighlighted } from "./StudyNoteMap";

it("keeps single-note playback highlighting at the exact pitch instead of the note-name column", () => {
  expect(isStudyNoteHighlighted("C4", "C4")).toBe(true);
  expect(isStudyNoteHighlighted("C5", "C4")).toBe(false);
  expect(isStudyNoteNameHighlighted("C", undefined)).toBe(false);
});

it("highlights all octaves only for note-name column playback", () => {
  const highlightedNames = new Set(["C"] as const);

  expect(isStudyNoteNameHighlighted("C", highlightedNames)).toBe(true);
  expect(isStudyNoteNameHighlighted("D", highlightedNames)).toBe(false);
});
