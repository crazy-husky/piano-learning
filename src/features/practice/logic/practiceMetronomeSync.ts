export interface PracticeTempoAnchor {
  audioTime: number;
  beat: number;
  bpm: number;
}

export const PRACTICE_PROGRESS_MARKER_LEAD_SECONDS = 0.09;
export const PRACTICE_TEMPO_ANCHOR_HISTORY_LIMIT = 512;

export type PracticeTimingGrade = "early" | "on-time" | "late";

function findLastAnchorAtOrBefore(
  value: number,
  anchors: readonly PracticeTempoAnchor[],
  getValue: (anchor: PracticeTempoAnchor) => number
): number {
  let low = 0;
  let high = anchors.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (getValue(anchors[middle]!) <= value) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function getPracticeAudioTimeAtBeat(
  beat: number,
  anchors: readonly PracticeTempoAnchor[],
  fallbackBpm: number
): number | undefined {
  if (!Number.isFinite(beat) || anchors.length === 0) return undefined;
  const previousIndex = findLastAnchorAtOrBefore(beat, anchors, (anchor) => anchor.beat);
  if (previousIndex < 0) return undefined;
  const previous = anchors[previousIndex]!;
  const next = anchors[previousIndex + 1];
  if (Math.abs(previous.beat - beat) < 0.000001) return previous.audioTime;
  if (next) {
    const progress = (beat - previous.beat) / (next.beat - previous.beat);
    return previous.audioTime + (next.audioTime - previous.audioTime) * progress;
  }
  const bpm = Number.isFinite(previous.bpm) && previous.bpm > 0 ? previous.bpm : fallbackBpm;
  return bpm > 0 ? previous.audioTime + ((beat - previous.beat) * 60) / bpm : undefined;
}

export function getPracticeBeatAtAudioTime(
  audioTime: number,
  anchors: readonly PracticeTempoAnchor[],
  fallbackBpm: number
): number | undefined {
  if (!Number.isFinite(audioTime) || anchors.length === 0) return undefined;
  const previousIndex = findLastAnchorAtOrBefore(audioTime, anchors, (anchor) => anchor.audioTime);
  const previous = previousIndex >= 0 ? anchors[previousIndex] : undefined;
  const next = previousIndex >= 0 ? anchors[previousIndex + 1] : anchors[0];
  const anchor = previous ?? anchors[0];
  if (!anchor) return undefined;
  if (previous && next) {
    const progress = (audioTime - previous.audioTime) / (next.audioTime - previous.audioTime);
    return previous.beat + (next.beat - previous.beat) * progress;
  }
  const bpm = Number.isFinite(anchor.bpm) && anchor.bpm > 0 ? anchor.bpm : fallbackBpm;
  return bpm > 0 ? anchor.beat + ((audioTime - anchor.audioTime) * bpm) / 60 : undefined;
}

export function getPracticeTimingWindowMs(bpm: number, nearestOnsetGapBeats: number): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 80;
  const beatMs = 60_000 / safeBpm;
  const gapBeats = Number.isFinite(nearestOnsetGapBeats)
    ? Math.max(0.0625, nearestOnsetGapBeats)
    : 1;
  return Math.min(150, beatMs * 0.2, beatMs * gapBeats * 0.35);
}

export function getPracticeTimingGrade(
  deltaMs: number,
  timingWindowMs: number
): PracticeTimingGrade {
  if (Math.abs(deltaMs) <= timingWindowMs) return "on-time";
  return deltaMs < 0 ? "early" : "late";
}
