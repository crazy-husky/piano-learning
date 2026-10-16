import type { PromptNoteDuration } from "../../../domain/types";

export interface StaffDistanceRhythm {
  beamGroupIds: number[];
  durations: PromptNoteDuration[];
  endBeat: number;
  measures: number[];
  onsets: number[];
}

interface BeatPattern {
  notes: Array<{ duration: PromptNoteDuration; offset: number }>;
  weight: number;
}

const DURATION_BEATS: Record<PromptNoteDuration, number> = {
  whole: 4,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

const DURATION_WEIGHTS: Record<PromptNoteDuration, number> = {
  whole: 0.35,
  quarter: 4,
  eighth: 3,
  sixteenth: 2,
};

function makeBeatPatterns(availableDurations: readonly PromptNoteDuration[]): BeatPattern[] {
  const available = new Set(availableDurations);
  const patterns: BeatPattern[] = [];
  if (available.has("quarter")) {
    patterns.push({ notes: [{ duration: "quarter", offset: 0 }], weight: 4 });
  }
  if (available.has("eighth")) {
    patterns.push({
      notes: [
        { duration: "eighth", offset: 0 },
        { duration: "eighth", offset: 0.5 },
      ],
      weight: 5,
    });
  }
  if (available.has("sixteenth")) {
    patterns.push({
      notes: Array.from({ length: 4 }, (_, index) => ({
        duration: "sixteenth",
        offset: index * 0.25,
      })),
      weight: 4,
    });
  }
  if (available.has("eighth") && available.has("sixteenth")) {
    patterns.push(
      {
        notes: [
          { duration: "sixteenth", offset: 0 },
          { duration: "sixteenth", offset: 0.25 },
          { duration: "eighth", offset: 0.5 },
        ],
        weight: 1,
      },
      {
        notes: [
          { duration: "eighth", offset: 0 },
          { duration: "sixteenth", offset: 0.5 },
          { duration: "sixteenth", offset: 0.75 },
        ],
        weight: 1,
      },
      {
        notes: [
          { duration: "sixteenth", offset: 0 },
          { duration: "eighth", offset: 0.25 },
          { duration: "sixteenth", offset: 0.75 },
        ],
        weight: 0.8,
      }
    );
  }
  return patterns;
}

function weightedPick<T>(
  items: readonly T[],
  weightFor: (item: T) => number,
  random: () => number
): T {
  const totalWeight = items.reduce((sum, item) => sum + weightFor(item), 0);
  let remainingWeight = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
  for (const item of items) {
    remainingWeight -= weightFor(item);
    if (remainingWeight < 0) return item;
  }
  return items[items.length - 1]!;
}

function pickBeatPattern(patterns: readonly BeatPattern[], random: () => number): BeatPattern {
  return weightedPick(patterns, (pattern) => pattern.weight, random);
}

export function createStaffDistanceRhythm(
  availableDurations: readonly PromptNoteDuration[],
  count: number,
  startBeat = 0,
  random: () => number = Math.random
): StaffDistanceRhythm {
  const choices: readonly PromptNoteDuration[] =
    availableDurations.length > 0 ? availableDurations : ["quarter"];
  const available = new Set(choices);
  const patterns = makeBeatPatterns(choices);
  const durations: PromptNoteDuration[] = [];
  const onsets: number[] = [];
  let beat = startBeat;

  while (durations.length < count) {
    const measureStart = Math.floor(beat / 4) * 4;
    const beatInMeasure = beat - measureStart;
    const fractionalBeat = beat - Math.floor(beat + 0.001);
    if (fractionalBeat > 0.001) {
      const remainingBeat = 1 - fractionalBeat;
      const fragmentDurations = choices.filter(
        (duration) => duration !== "whole" && DURATION_BEATS[duration] <= remainingBeat + 0.001
      );
      const duration = weightedPick(
        fragmentDurations,
        (candidate) => DURATION_WEIGHTS[candidate],
        random
      );
      durations.push(duration);
      onsets.push(beat);
      beat += DURATION_BEATS[duration];
      continue;
    }

    const wholeNoteOnly = patterns.length === 0 && available.has("whole");
    const useWholeMeasure =
      available.has("whole") &&
      Math.abs(beatInMeasure) < 0.001 &&
      (wholeNoteOnly || random() < 0.1);

    if (useWholeMeasure) {
      durations.push("whole");
      onsets.push(beat);
      beat += 4;
      continue;
    }

    const pattern = pickBeatPattern(patterns, random);
    for (const note of pattern.notes) {
      if (durations.length >= count) break;
      durations.push(note.duration);
      onsets.push(beat + note.offset);
    }
    beat += 1;
  }

  const measures = onsets.map((onset) => Math.floor(onset / 4));
  const beamGroupIds = onsets.map((onset) => Math.floor(onset + 0.001));
  const lastIndex = durations.length - 1;
  const endBeat =
    lastIndex >= 0 ? onsets[lastIndex]! + DURATION_BEATS[durations[lastIndex]!] : startBeat;

  return { beamGroupIds, durations, endBeat, measures, onsets };
}

export function appendStaffDistanceRhythm(
  current: StaffDistanceRhythm,
  extension: StaffDistanceRhythm
): StaffDistanceRhythm {
  const durations = [...current.durations, ...extension.durations];
  const onsets = [...current.onsets, ...extension.onsets];
  const measures = onsets.map((onset) => Math.floor(onset / 4));
  const beamGroupIds = onsets.map((onset) => Math.floor(onset + 0.001));

  return {
    beamGroupIds,
    durations,
    endBeat: extension.endBeat,
    measures,
    onsets,
  };
}
