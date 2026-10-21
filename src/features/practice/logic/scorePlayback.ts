import type { Staff } from "../../../domain/types";

export interface ScorePlaybackStaffCursor {
  currentEventIndices: readonly number[];
  endAudioTime: number | null;
  nextEventIndices: readonly number[] | null;
  rowIndex: number;
  staff: Staff;
  startAudioTime: number;
}

export interface ScorePlaybackCursor {
  staffCursors: Partial<Record<Staff, ScorePlaybackStaffCursor>>;
}
