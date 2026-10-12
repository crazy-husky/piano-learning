import type { NoteName } from "../../../domain/types";

export type SongPracticeInputMode = "virtual" | "midi" | "microphone";
export type SongPracticeTrackMode = "treble" | "bass" | "mixed";
export type SongPracticeStaff = "treble" | "bass";
export type SongPracticeDuration =
  | "whole"
  | "dotted-whole"
  | "half"
  | "dotted-half"
  | "quarter"
  | "dotted-quarter"
  | "eighth"
  | "dotted-eighth"
  | "sixteenth"
  | "dotted-sixteenth";

export interface SongPracticeNote {
  noteName: NoteName;
  octave: number;
  duration: SongPracticeDuration;
  measure: number;
  /** Approximate attack position within the measure, normalized to 0–1. */
  onset: number;
  staff: SongPracticeStaff;
  lyrics?: readonly string[];
}

export interface SongPracticePart {
  id: SongPracticeStaff;
  name: string;
  notes: readonly SongPracticeNote[];
}

export interface SongPracticeScore {
  title: string;
  parts: readonly SongPracticePart[];
}

export interface SongPracticeSelection {
  inputMode: SongPracticeInputMode;
  notes: readonly SongPracticeNote[];
  partName: string;
  scoreTitle: string;
  songId: "ye-qu";
  trackMode: SongPracticeTrackMode;
  skippedBassNoteCount: number;
}

export interface ResolvedSongPracticeTrack {
  notes: readonly SongPracticeNote[];
  partName: string;
  skippedBassNoteCount: number;
}

const SIMULTANEOUS_ONSET_TOLERANCE = 0.04;

function isSameOnset(left: SongPracticeNote, right: SongPracticeNote): boolean {
  return (
    left.measure === right.measure &&
    Math.abs(left.onset - right.onset) <= SIMULTANEOUS_ONSET_TOLERANCE
  );
}

export function resolveSongPracticeTrack(
  score: SongPracticeScore,
  trackMode: SongPracticeTrackMode
): ResolvedSongPracticeTrack {
  const treble = score.parts.find((part) => part.id === "treble");
  const bass = score.parts.find((part) => part.id === "bass");
  if (!treble || !bass) {
    return { notes: [], partName: "", skippedBassNoteCount: 0 };
  }

  if (trackMode === "treble") {
    return { notes: treble.notes, partName: treble.name, skippedBassNoteCount: 0 };
  }
  if (trackMode === "bass") {
    return { notes: bass.notes, partName: bass.name, skippedBassNoteCount: 0 };
  }

  const skippedBassNotes = bass.notes.filter((bassNote) =>
    treble.notes.some((trebleNote) => isSameOnset(trebleNote, bassNote))
  );
  const notes = [
    ...treble.notes,
    ...bass.notes.filter(
      (bassNote) => !treble.notes.some((trebleNote) => isSameOnset(trebleNote, bassNote))
    ),
  ].sort(
    (left, right) =>
      left.measure - right.measure ||
      left.onset - right.onset ||
      (left.staff === right.staff ? 0 : left.staff === "treble" ? -1 : 1)
  );

  return {
    notes,
    partName: "高低音混合（同位时保留高音）",
    skippedBassNoteCount: skippedBassNotes.length,
  };
}
