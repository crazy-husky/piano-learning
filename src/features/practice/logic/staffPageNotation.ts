import type { PromptNoteDuration, TargetNote } from "../../../domain/types";

export const PROMPT_NOTE_DURATIONS: readonly PromptNoteDuration[] = [
  "whole",
  "quarter",
  "eighth",
  "sixteenth",
];

export type StaffPageNoteDuration =
  | PromptNoteDuration
  | "half"
  | "dotted-whole"
  | "dotted-half"
  | "dotted-quarter"
  | "double-dotted-quarter"
  | "quarter-plus-sixteenth"
  | "dotted-eighth"
  | "dotted-sixteenth"
  | "triplet-eighth"
  | "triplet-half"
  | "thirty-second"
  | "sixty-fourth";

const PROMPT_NOTE_DURATION_BEATS: Record<PromptNoteDuration, number> = {
  whole: 4,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

const PROMPT_NOTE_DURATION_WEIGHTS: Record<PromptNoteDuration, number> = {
  whole: 0.35,
  quarter: 4,
  eighth: 3,
  sixteenth: 2,
};

export interface GeneratedStaffPageRhythm {
  durations: StaffPageNoteDuration[];
  endBeat: number;
  measures: number[];
  noteBeamGroups: number[];
  onsets: number[];
  staffNoteDurations?: Array<{ treble?: StaffPageNoteDuration; bass?: StaffPageNoteDuration }>;
}

export function getMeasureAlignedEndBeat(
  onsets: readonly (number | undefined)[],
  beatsPerMeasure: number
): number | undefined {
  if (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0) return undefined;
  const lastOnset = [...onsets].reverse().find((onset) => onset !== undefined);
  if (lastOnset === undefined || !Number.isFinite(lastOnset)) return undefined;
  return (Math.floor((lastOnset + 0.001) / beatsPerMeasure) + 1) * beatsPerMeasure;
}

export function generateStaffPageRhythm(
  selectedDurations: readonly PromptNoteDuration[],
  noteCount: number,
  startBeat = 0,
  random: () => number = Math.random
): GeneratedStaffPageRhythm {
  const selected = new Set(selectedDurations.length > 0 ? selectedDurations : ["quarter"]);
  const choices = PROMPT_NOTE_DURATIONS.filter((duration) => selected.has(duration));
  const durations: PromptNoteDuration[] = [];
  const onsets: number[] = [];
  let beat = Math.max(0, startBeat);

  while (durations.length < noteCount) {
    const measureStart = Math.floor((beat + 0.001) / 4) * 4;
    const beatInMeasure = beat - measureStart;
    const remainingMeasureBeats = 4 - beatInMeasure;
    const available = choices.filter(
      (duration) => PROMPT_NOTE_DURATION_BEATS[duration] <= remainingMeasureBeats + 0.001
    );
    const useWholeMeasure =
      beatInMeasure < 0.001 &&
      available.includes("whole") &&
      (choices.length === 1 || random() < 0.08);
    if (useWholeMeasure) {
      durations.push("whole");
      onsets.push(beat);
      beat += 4;
      continue;
    }

    const noteChoices = available.filter((duration) => duration !== "whole");
    const weightedChoices = noteChoices.length > 0 ? noteChoices : available;
    const totalWeight = weightedChoices.reduce(
      (sum, duration) => sum + PROMPT_NOTE_DURATION_WEIGHTS[duration],
      0
    );
    let remainingWeight = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
    let duration = weightedChoices[weightedChoices.length - 1] ?? "quarter";
    for (const candidate of weightedChoices) {
      remainingWeight -= PROMPT_NOTE_DURATION_WEIGHTS[candidate];
      if (remainingWeight < 0) {
        duration = candidate;
        break;
      }
    }
    durations.push(duration);
    onsets.push(beat);
    beat += PROMPT_NOTE_DURATION_BEATS[duration];
  }

  return {
    durations,
    endBeat: beat,
    measures: onsets.map((onset) => Math.floor((onset + 0.001) / 4)),
    noteBeamGroups: onsets.map((onset) => Math.floor(onset + 0.001)),
    onsets,
  };
}

interface PromptNoteDurationConfig {
  barlineInterval: number;
  beamGroupSize?: number;
  quarterNoteBeats: number;
  vexDuration: "w" | "q" | "8" | "16";
}

const PROMPT_NOTE_DURATION_CONFIG: Record<PromptNoteDuration, PromptNoteDurationConfig> = {
  whole: { barlineInterval: 4, quarterNoteBeats: 4, vexDuration: "w" },
  quarter: { barlineInterval: 4, quarterNoteBeats: 1, vexDuration: "q" },
  eighth: { barlineInterval: 8, beamGroupSize: 2, quarterNoteBeats: 0.5, vexDuration: "8" },
  sixteenth: { barlineInterval: 8, beamGroupSize: 4, quarterNoteBeats: 0.25, vexDuration: "16" },
};

export interface StaffPageBeamRun {
  size: number;
  startIndex: number;
}

export type StaffPageStemDirection = "down" | "up";

export interface StaffPageVisibleYBounds {
  bottomY: number;
  topY: number;
}

function getNoteYRange(notes: readonly { y: number }[]): {
  bottomY: number;
  topY: number;
  ys: number[];
} {
  const ys = notes.map((note) => note.y);
  return { bottomY: Math.max(...ys), topY: Math.min(...ys), ys };
}

export function getVexNoteDuration(
  noteDuration: PromptNoteDuration
): PromptNoteDurationConfig["vexDuration"] {
  return PROMPT_NOTE_DURATION_CONFIG[noteDuration].vexDuration;
}

const STAFF_PAGE_NOTE_DURATION_BEATS: Record<StaffPageNoteDuration, number> = {
  whole: 4,
  "dotted-whole": 6,
  half: 2,
  "dotted-half": 3,
  quarter: 1,
  "dotted-quarter": 1.5,
  "double-dotted-quarter": 1.75,
  "quarter-plus-sixteenth": 1.25,
  eighth: 0.5,
  "dotted-eighth": 0.75,
  "triplet-eighth": 1 / 3,
  "triplet-half": 4 / 3,
  sixteenth: 0.25,
  "dotted-sixteenth": 0.375,
  "thirty-second": 0.125,
  "sixty-fourth": 0.0625,
};

export function getQuarterNoteBeats(noteDuration: StaffPageNoteDuration): number {
  return STAFF_PAGE_NOTE_DURATION_BEATS[noteDuration];
}

export function getStaffPageBarlineInterval(noteDuration: PromptNoteDuration): number {
  return PROMPT_NOTE_DURATION_CONFIG[noteDuration].barlineInterval;
}

export function getBarlineGapCenter(previousRight: number, nextLeft: number): number | undefined {
  return previousRight < nextLeft ? (previousRight + nextLeft) / 2 : undefined;
}

export function getStaffPageBeamRuns(
  notes: readonly (Pick<TargetNote, "staff"> | undefined)[],
  noteDuration: PromptNoteDuration
): StaffPageBeamRun[] {
  const config = PROMPT_NOTE_DURATION_CONFIG[noteDuration];
  const groupSize = config.beamGroupSize;
  if (groupSize === undefined) {
    return [];
  }

  const runs: StaffPageBeamRun[] = [];
  for (let groupStart = 0; groupStart < notes.length; groupStart += groupSize) {
    const groupEnd = Math.min(notes.length, groupStart + groupSize);
    let runStart: number | undefined;
    for (let index = groupStart; index <= groupEnd; index += 1) {
      if (index < groupEnd && notes[index] !== undefined) {
        runStart ??= index;
        continue;
      }
      if (runStart !== undefined && index - runStart >= 2) {
        runs.push({ size: index - runStart, startIndex: runStart });
      }
      runStart = undefined;
    }
  }
  return runs;
}

export function getCrossStaffOuterStemDirection(
  notes: readonly { y: number }[]
): StaffPageStemDirection {
  const { bottomY, topY, ys } = getNoteYRange(notes);
  const upwardStemCost = ys.reduce((sum, y) => sum + y - topY, 0);
  const downwardStemCost = ys.reduce((sum, y) => sum + bottomY - y, 0);
  return upwardStemCost <= downwardStemCost ? "up" : "down";
}

export function getVisibleBeamStemDirection(
  notes: readonly { y: number }[],
  visibleBounds: StaffPageVisibleYBounds,
  minimumClearance: number
): StaffPageStemDirection | undefined {
  const { bottomY, topY } = getNoteYRange(notes);
  const upwardSpace = topY - visibleBounds.topY;
  const downwardSpace = visibleBounds.bottomY - bottomY;
  const upwardFits = upwardSpace >= minimumClearance;
  const downwardFits = downwardSpace >= minimumClearance;
  if (upwardFits !== downwardFits) {
    return upwardFits ? "up" : "down";
  }
  if (!upwardFits && upwardSpace !== downwardSpace) {
    return upwardSpace > downwardSpace ? "up" : "down";
  }
  return undefined;
}
