import type { Staff } from "../../../domain/types";

export type ChaseHandMode = "left" | "right" | "both";

export interface ScoreChaseEvent {
  /** Stable index in the score stream, including when the visible note window advances. */
  eventIndex: number;
  beatPosition: number;
  staves: readonly Staff[];
  tickPosition?: number;
}

export interface ScoreChaseStaffCursor {
  caught: boolean;
  currentEventIndices: readonly number[];
  endAudioTime: number | null;
  nextEventIndices: readonly number[] | null;
  staff: Staff;
  startAudioTime: number;
}

export interface ScoreChaseCursor {
  speedMultiplier: number;
  staffCursors: Partial<Record<Staff, ScoreChaseStaffCursor>>;
}

export type ScoreChaseSegmentDuration = (
  fromEvent: ScoreChaseEvent,
  toEvent: ScoreChaseEvent,
  speedMultiplier: number
) => number;

export const SCORE_CHASE_SPEED_OPTIONS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const uniformFreePracticeChaseSegmentDuration: ScoreChaseSegmentDuration = (
  _fromEvent,
  _toEvent,
  speedMultiplier
) => 0.5 / Math.max(0.1, speedMultiplier);

export interface ScoreChasePreferences {
  enabled: boolean;
  speedMultiplier: (typeof SCORE_CHASE_SPEED_OPTIONS)[number];
  startCount: number;
}

export const DEFAULT_SCORE_CHASE_PREFERENCES: ScoreChasePreferences = {
  enabled: true,
  speedMultiplier: 0.5,
  startCount: 5,
};
