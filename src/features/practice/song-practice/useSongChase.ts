import { useMemo } from "react";
import type { Staff } from "../../../domain/types";
import type { ScoreChaseCursor, ScoreChaseEvent } from "../logic/scoreChase";
import { useScoreChase } from "../hooks/useScoreChase";
import type { SongPracticeHandMode, SongPracticeTarget } from "./songPracticeMaterials";

export type SongChaseStaffCursor = NonNullable<ScoreChaseCursor["staffCursors"][Staff]>;
export type SongChaseCursor = ScoreChaseCursor;

interface SongChaseOptions {
  enabled: boolean;
  beatsPerMeasure: number;
  getAudioTime: () => number;
  handMode: SongPracticeHandMode;
  paused: boolean;
  speedMultiplier: number;
  startCount: number;
  tempoEvents?: readonly {
    microsecondsPerQuarter: number;
    tick: number;
    trackIndex: number;
  }[];
  ticksPerQuarter?: number;
  targets: readonly SongPracticeTarget[];
  tempoBpm: number;
}

function selectedStaves(handMode: SongPracticeHandMode): readonly Staff[] {
  if (handMode === "left") return ["bass"];
  if (handMode === "right") return ["treble"];
  return ["treble", "bass"];
}

function secondsForTickRange(
  startTick: number,
  endTick: number,
  tempoBpm: number,
  ticksPerQuarter: number,
  tempoEvents: SongChaseOptions["tempoEvents"]
): number {
  if (endTick <= startTick || ticksPerQuarter <= 0) return 0;
  const events = [...(tempoEvents ?? [])]
    .filter(
      (event) =>
        Number.isFinite(event.tick) &&
        Number.isFinite(event.microsecondsPerQuarter) &&
        event.microsecondsPerQuarter > 0
    )
    .sort((left, right) => left.tick - right.tick || left.trackIndex - right.trackIndex);
  let currentMicrosPerQuarter = 60_000_000 / Math.max(1, tempoBpm);
  let cursorTick = startTick;
  let elapsedSeconds = 0;

  for (const event of events) {
    if (event.tick <= startTick) {
      currentMicrosPerQuarter = event.microsecondsPerQuarter;
      continue;
    }
    if (event.tick >= endTick) break;
    elapsedSeconds +=
      ((event.tick - cursorTick) * currentMicrosPerQuarter) / ticksPerQuarter / 1_000_000;
    cursorTick = event.tick;
    currentMicrosPerQuarter = event.microsecondsPerQuarter;
  }

  elapsedSeconds +=
    ((endTick - cursorTick) * currentMicrosPerQuarter) / ticksPerQuarter / 1_000_000;
  return elapsedSeconds;
}

export function useSongChase({
  enabled,
  beatsPerMeasure,
  getAudioTime,
  handMode,
  paused,
  speedMultiplier,
  startCount,
  tempoEvents,
  ticksPerQuarter,
  targets,
  tempoBpm,
}: SongChaseOptions): {
  cursor: SongChaseCursor | null;
  recordCorrectTarget: (targetIndex: number) => void;
  reset: () => void;
} {
  const events = useMemo<ScoreChaseEvent[]>(
    () =>
      targets.map((target, eventIndex) => {
        const tick = target.notes[0]?.sourceMidiLocation?.onsetTick;
        return {
          eventIndex,
          beatPosition: (target.measure - 1) * beatsPerMeasure + target.onsetBeat,
          staves: [...new Set(target.notes.map((note) => note.staff))],
          ...(Number.isFinite(tick) ? { tickPosition: tick } : {}),
        };
      }),
    [beatsPerMeasure, targets]
  );
  const activeStaves = useMemo(() => selectedStaves(handMode), [handMode]);

  return useScoreChase({
    activeStaves,
    enabled,
    events,
    getAudioTime,
    paused,
    segmentDurationSeconds: (fromEvent, toEvent, speed) => {
      if (
        fromEvent.tickPosition !== undefined &&
        toEvent.tickPosition !== undefined &&
        ticksPerQuarter &&
        ticksPerQuarter > 0
      ) {
        const seconds = secondsForTickRange(
          fromEvent.tickPosition,
          toEvent.tickPosition,
          tempoBpm,
          ticksPerQuarter,
          tempoEvents
        );
        return Math.max(0.08, seconds / Math.max(0.1, speed));
      }
      const beatDistance = Math.max(0.05, toEvent.beatPosition - fromEvent.beatPosition);
      return Math.max(0.08, (beatDistance * 60) / (Math.max(1, tempoBpm) * Math.max(0.1, speed)));
    },
    speedMultiplier,
    startCount,
    tempoBpm,
  });
}
