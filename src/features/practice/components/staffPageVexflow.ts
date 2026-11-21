import {
  Accidental,
  Beam,
  GhostNote,
  Stave,
  StaveNote,
  StaveTie,
  Stem,
  Tuplet,
  Voice,
} from "vexflow";
import { noteToVexKey } from "../../../domain/notes";
import type { PromptNoteDuration, Staff, TargetNote } from "../../../domain/types";
import { getPracticeStaffMeasureEdgeInsetPx } from "../../../shared/staff/staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  getEvenlySpacedCenters,
  getLedgerStemDirection,
  logicalPx,
  staveNoteCenterX,
} from "../../../shared/staff/staffGeometry";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
  type StaffPageNoteDuration,
} from "../logic/staffPageNotation";
import {
  STAFF_PAGE_CURRENT_NOTE_INDICATOR_HEIGHT_PX,
  STAFF_PAGE_CURRENT_NOTE_INDICATOR_TIP_OFFSET_PX,
} from "./staffPageLayout";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const STAFF_VEX_DURATIONS: Record<StaffPageNoteDuration, string> = {
  whole: "w",
  "dotted-whole": "wd",
  half: "h",
  "dotted-half": "hd",
  quarter: "q",
  "dotted-quarter": "qd",
  "double-dotted-quarter": "qdd",
  "quarter-plus-sixteenth": "q",
  eighth: "8",
  "dotted-eighth": "8d",
  "triplet-eighth": "8",
  "triplet-half": "h",
  sixteenth: "16",
  "dotted-sixteenth": "16d",
  "thirty-second": "32",
  "sixty-fourth": "64",
};

export type StaffPageTickable = GhostNote | StaveNote;

export interface TimedStaveNote {
  endBeat: number;
  left: number;
  markerX: number;
  right: number;
  startBeat: number;
}

export interface StaffPagePalette {
  active: string;
  complete: string;
  error: string;
  ink: string;
  warning: string;
}

export interface RenderedStaffPageNote {
  color: string;
  element: SVGElement;
  index: number;
  midi: number;
  staff?: Staff;
}

export interface RenderedStaffPageStem {
  color: string;
  element: SVGElement;
  index: number;
  midis: number[];
  staff: Staff;
  stem: Stem;
}

export function makeStaveNote(
  noteOrNotes: TargetNote | readonly TargetNote[],
  color: string,
  noteDuration: StaffPageNoteDuration,
  getKeyColor?: (note: TargetNote) => string
): StaveNote {
  const notes = Array.isArray(noteOrNotes) ? noteOrNotes : [noteOrNotes];
  const note = notes[0];
  if (!note) throw new Error("A staff note needs at least one pitch");
  const vexDuration = STAFF_VEX_DURATIONS[noteDuration];
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: vexDuration,
    keys: notes.map(noteToVexKey),
    autoStem: stemDirection === undefined,
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  notes.forEach((chordNote, index) => {
    const keyColor = getKeyColor?.(chordNote) ?? color;
    staveNote.setKeyStyle(index, { fillStyle: keyColor, strokeStyle: keyColor });
    if (chordNote.accidental) {
      staveNote.addModifier(new Accidental(chordNote.accidental === "sharp" ? "#" : "b"), index);
    }
  });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

export function makeStaffGhostNote(noteDuration: StaffPageNoteDuration): GhostNote {
  const ghostNote = new GhostNote(STAFF_VEX_DURATIONS[noteDuration]);
  if (noteDuration === "triplet-eighth" || noteDuration === "triplet-half") {
    ghostNote.applyTickMultiplier(2, 3);
  }
  return ghostNote;
}

export const STAFF_REST_DURATIONS: readonly {
  beats: number;
  duration: StaffPageNoteDuration;
  tuplet?: readonly [number, number];
}[] = [
  { beats: 4, duration: "whole" },
  { beats: 3, duration: "dotted-half" },
  { beats: 2, duration: "half" },
  { beats: 1.5, duration: "dotted-quarter" },
  { beats: 1, duration: "quarter" },
  { beats: 0.75, duration: "dotted-eighth" },
  { beats: 2 / 3, duration: "quarter", tuplet: [2, 3] },
  { beats: 0.5, duration: "eighth" },
  { beats: 0.375, duration: "dotted-sixteenth" },
  { beats: 1 / 3, duration: "eighth", tuplet: [2, 3] },
  { beats: 0.25, duration: "sixteenth" },
  { beats: 0.125, duration: "thirty-second" },
  { beats: 0.0625, duration: "sixty-fourth" },
];

export function makeStaveRest(
  duration: StaffPageNoteDuration,
  staff: "treble" | "bass",
  stave: Stave,
  tuplet?: readonly [number, number],
  color?: string
): StaveNote {
  const rest = new StaveNote({
    clef: staff,
    duration: `${STAFF_VEX_DURATIONS[duration]}r`,
    keys: [staff === "treble" ? "b/4" : "d/3"],
  }).setStave(stave);
  if (duration === "quarter") {
    rest.noteHeads.forEach((noteHead) => noteHead.setFontSize(noteHead.fontSizeInPoints * 0.82));
  }
  if (tuplet) rest.applyTickMultiplier(tuplet[0], tuplet[1]);
  if (color) rest.setStyle({ fillStyle: color, strokeStyle: color });
  return rest;
}

export function makeStaveRestsForGap(
  gapBeats: number,
  startBeat: number,
  beatsPerMeasure: number | undefined,
  staff: "treble" | "bass",
  stave: Stave
): StaveNote[] {
  const rests: StaveNote[] = [];
  const epsilon = 0.001;
  let cursor = startBeat;
  let remaining = gapBeats;
  while (remaining > epsilon) {
    const nextBarline =
      beatsPerMeasure && beatsPerMeasure > 0
        ? (Math.floor(cursor / beatsPerMeasure) + 1) * beatsPerMeasure
        : Number.POSITIVE_INFINITY;
    const segmentBeats = Math.min(remaining, nextBarline - cursor);
    let segmentRemaining = segmentBeats;
    while (segmentRemaining > epsilon) {
      const restDuration = STAFF_REST_DURATIONS.find(
        (candidate) => candidate.beats <= segmentRemaining + epsilon
      );
      if (!restDuration) break;
      rests.push(makeStaveRest(restDuration.duration, staff, stave, restDuration.tuplet));
      segmentRemaining -= restDuration.beats;
    }
    const consumed = segmentBeats - segmentRemaining;
    if (consumed <= epsilon) break;
    cursor += consumed;
    remaining -= consumed;
  }
  return rests;
}

export function makeStaffGhostsForGap(
  gapBeats: number,
  startBeat: number,
  beatsPerMeasure: number | undefined,
  stave: Stave
): GhostNote[] {
  const ghosts: GhostNote[] = [];
  const epsilon = 0.001;
  let cursor = startBeat;
  let remaining = gapBeats;
  while (remaining > epsilon) {
    const nextBarline =
      beatsPerMeasure && beatsPerMeasure > 0
        ? (Math.floor(cursor / beatsPerMeasure) + 1) * beatsPerMeasure
        : Number.POSITIVE_INFINITY;
    const segmentBeats = Math.min(remaining, nextBarline - cursor);
    let segmentRemaining = segmentBeats;
    while (segmentRemaining > epsilon) {
      const duration = STAFF_REST_DURATIONS.find(
        (candidate) => candidate.beats <= segmentRemaining + epsilon
      );
      if (!duration) break;
      const ghost = makeStaffGhostNote(duration.duration).setStave(stave);
      if (duration.tuplet) ghost.applyTickMultiplier(duration.tuplet[0], duration.tuplet[1]);
      ghosts.push(ghost);
      segmentRemaining -= duration.beats;
    }
    const consumed = segmentBeats - segmentRemaining;
    if (consumed <= epsilon) break;
    cursor += consumed;
    remaining -= consumed;
  }
  return ghosts;
}

export function padStaffTickablesToDuration(
  tickables: readonly StaffPageTickable[],
  targetTicks: number,
  staff: "treble" | "bass",
  stave: Stave,
  rowOnsets?: readonly (number | undefined)[],
  beatsPerMeasure?: number,
  useInvisiblePadding = false,
  showRestPadding = false
): StaffPageTickable[] {
  const usedTicks = tickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0);
  const ticksPerQuarter = new Voice({ numBeats: 1, beatValue: 4 }).getTotalTicks().value();
  const missingBeats = (targetTicks - usedTicks) / ticksPerQuarter;
  if (missingBeats <= 0.001) return [...tickables];

  const firstOnset = rowOnsets?.find((onset): onset is number => onset !== undefined) ?? 0;
  const rowStartBeat =
    beatsPerMeasure && beatsPerMeasure > 0
      ? Math.floor(firstOnset / beatsPerMeasure) * beatsPerMeasure
      : firstOnset;
  return [
    ...tickables,
    ...(useInvisiblePadding && !showRestPadding
      ? makeStaffGhostsForGap(
          missingBeats,
          rowStartBeat + usedTicks / ticksPerQuarter,
          beatsPerMeasure,
          stave
        )
      : makeStaveRestsForGap(
          missingBeats,
          rowStartBeat + usedTicks / ticksPerQuarter,
          beatsPerMeasure,
          staff,
          stave
        )),
  ];
}

export function assignStaffVoiceLanes(
  rowGroups: readonly (readonly TargetNote[])[],
  noteDurations: readonly StaffPageNoteDuration[],
  noteOnsets?: readonly (number | undefined)[]
): number[][] {
  const laneEndBeats: number[] = [];
  const lanes: number[][] = [];

  rowGroups.forEach((group, slotIndex) => {
    if (group.length === 0) return;
    const onset = noteOnsets?.[slotIndex];
    let laneIndex =
      noteOnsets && onset !== undefined
        ? laneEndBeats.findIndex((endBeat) => endBeat <= onset + 0.001)
        : 0;
    if (laneIndex < 0) laneIndex = laneEndBeats.length;
    if (!lanes[laneIndex]) lanes[laneIndex] = [];
    lanes[laneIndex]!.push(slotIndex);
    laneEndBeats[laneIndex] =
      (onset ?? laneEndBeats[laneIndex] ?? 0) + quarterBeatsForDuration(noteDurations[slotIndex]!);
  });

  return lanes;
}

export function getLaneBeamOptions(
  options:
    | {
        barlineAfterNoteIndices?: readonly number[];
        breakBeamsAtStaffChange?: boolean;
        measures: readonly (number | undefined)[];
        noteDurations: readonly StaffPageNoteDuration[];
        noteOnsets: readonly (number | undefined)[];
        noteBeamGroups?: readonly (number | undefined)[];
        rowStartIndex: number;
      }
    | undefined,
  laneIndices: readonly number[]
): Parameters<typeof makeStaffPageBeams>[5] {
  if (!options) return undefined;
  return {
    barlineAfterNoteIndices: laneIndices.flatMap((slotIndex, laneIndex) =>
      laneIndex < laneIndices.length - 1 &&
      options.barlineAfterNoteIndices?.includes(options.rowStartIndex + slotIndex)
        ? [laneIndex]
        : []
    ),
    breakBeamsAtStaffChange: false,
    measures: laneIndices.map((slotIndex) => options.measures[slotIndex]),
    noteBeamGroups: options.noteBeamGroups
      ? laneIndices.map((slotIndex) => options.noteBeamGroups![slotIndex])
      : undefined,
    noteDurations: laneIndices.map((slotIndex) => options.noteDurations[slotIndex]!),
    noteOnsets: laneIndices.map((slotIndex) => options.noteOnsets[slotIndex]),
    rowStartIndex: 0,
  };
}

export function expandTiedDurations(
  rowGroups: readonly (readonly TargetNote[])[],
  primaryTickables: readonly StaffPageTickable[],
  noteDurations: readonly StaffPageNoteDuration[],
  getColor: (slotIndex: number, staff?: Staff) => string,
  noteOnsets?: readonly number[],
  beatsPerMeasure?: number,
  staff: Staff = "treble",
  monophonicGrandStaff = false,
  useInvisibleGapRests = false,
  showGrandStaffRests = false
): { ties: StaveTie[]; tickables: StaffPageTickable[] } {
  const tickables: StaffPageTickable[] = [];
  const ties: StaveTie[] = [];
  let cursorBeat =
    noteOnsets?.[0] !== undefined && beatsPerMeasure && beatsPerMeasure > 0
      ? Math.floor(noteOnsets[0] / beatsPerMeasure) * beatsPerMeasure
      : (noteOnsets?.[0] ?? 0);
  rowGroups.forEach((noteGroup, slotIndex) => {
    const primary = primaryTickables[slotIndex];
    const noteOnset = noteOnsets?.[slotIndex];
    if (
      noteOnsets &&
      noteGroup.length === 0 &&
      (showGrandStaffRests ||
        !monophonicGrandStaff ||
        (noteOnset !== undefined && noteOnset < cursorBeat - 0.001))
    ) {
      // Let the next real note create a rest for the full elapsed gap. Per-event
      // placeholders can use the other staff's duration and shift this voice.
      return;
    }
    if (noteOnsets && noteOnset !== undefined && noteOnset > cursorBeat + 0.001) {
      const useInvisibleGaps =
        (monophonicGrandStaff || useInvisibleGapRests) && !showGrandStaffRests;
      const gapFillers = useInvisibleGaps
        ? makeStaffGhostsForGap(
            noteOnset - cursorBeat,
            cursorBeat,
            beatsPerMeasure,
            primary.getStave()!
          )
        : makeStaveRestsForGap(
            noteOnset - cursorBeat,
            cursorBeat,
            beatsPerMeasure,
            staff,
            primary.getStave()!
          );
      tickables.push(...gapFillers);
    }
    tickables.push(primary);
    if (noteDurations[slotIndex] === "quarter-plus-sixteenth") {
      if (noteGroup.length > 0 && primary instanceof StaveNote) {
        const continuation = makeStaveNote(
          noteGroup,
          getColor(slotIndex, staff),
          "sixteenth"
        ).setStave(primary.getStave()!);
        tickables.push(continuation);
        ties.push(
          new StaveTie({
            firstIndexes: noteGroup.map((_, index) => index),
            firstNote: primary,
            lastIndexes: noteGroup.map((_, index) => index),
            lastNote: continuation,
          })
        );
      } else if (primary instanceof GhostNote) {
        tickables.push(new GhostNote("16").setStave(primary.getStave()!));
      }
    }
    if (noteOnsets && noteOnset !== undefined) {
      cursorBeat = Math.max(
        cursorBeat,
        noteOnset + quarterBeatsForDuration(noteDurations[slotIndex])
      );
    }
  });
  return { ties, tickables };
}

export function colorForIndex(
  index: number,
  completedCount: number,
  completedNoteIndices: readonly number[] | undefined,
  wrongIndex: number | undefined,
  activePairStartIndex: number | undefined,
  palette: StaffPagePalette,
  staff?: Staff,
  completedStaffNoteIndices?: Partial<Record<Staff, readonly number[]>>,
  wrongStaffIndex?: number,
  wrongStaff?: Staff,
  midi?: number,
  syncNoteStatuses?: readonly {
    index: number;
    staff: Staff;
    midi?: number;
    result: "matched" | "missed" | "offbeat";
  }[],
  preReadingAnswerOutcomes?: readonly (boolean | null)[]
): string {
  const matchingStatuses = syncNoteStatuses?.filter(
    (entry) => entry.index === index && (!staff || entry.staff === staff)
  );
  const syncStatus =
    matchingStatuses?.find((entry) => midi !== undefined && entry.midi === midi) ??
    matchingStatuses?.find((entry) => entry.midi === undefined);
  if (syncStatus?.result === "missed") return palette.error;
  if (syncStatus?.result === "offbeat") return palette.warning;
  if (syncStatus?.result === "matched") return palette.complete;
  const preReadingAnswerOutcome = preReadingAnswerOutcomes?.[index];
  if (preReadingAnswerOutcome === false) return palette.error;
  if (preReadingAnswerOutcome === true) return palette.complete;
  if (staff && completedStaffNoteIndices) {
    if (index === wrongStaffIndex && (!wrongStaff || wrongStaff === staff)) {
      return palette.error;
    }
    if (completedStaffNoteIndices[staff]?.includes(index)) {
      return palette.complete;
    }
    if (activePairStartIndex !== undefined && index === activePairStartIndex) {
      return palette.active;
    }
    return palette.ink;
  }
  if (index === wrongIndex) {
    return palette.error;
  }
  if (completedNoteIndices ? completedNoteIndices.includes(index) : index < completedCount) {
    return palette.complete;
  }
  if (activePairStartIndex !== undefined && index === activePairStartIndex) {
    return palette.active;
  }
  return palette.ink;
}

export function updateRenderedNoteColor(
  renderedNote: Pick<RenderedStaffPageNote, "color" | "element">,
  color: string
): void {
  if (renderedNote.color === color) {
    return;
  }
  const elements = [
    renderedNote.element,
    ...renderedNote.element.querySelectorAll<SVGElement>("*"),
  ];
  for (const element of elements) {
    for (const attribute of ["fill", "stroke"] as const) {
      const value = element.getAttribute(attribute);
      if (value?.toLowerCase() === renderedNote.color.toLowerCase()) {
        element.setAttribute(attribute, color);
      }
    }
  }
  renderedNote.element.setAttribute("fill", color);
  renderedNote.element.setAttribute("stroke", color);
  renderedNote.color = color;
}

export function updateRenderedStemColor(renderedStem: RenderedStaffPageStem, color: string): void {
  if (renderedStem.color === color) {
    return;
  }

  renderedStem.stem.setStyle({ fillStyle: color, strokeStyle: color });
  const elements = [
    renderedStem.element,
    ...renderedStem.element.querySelectorAll<SVGElement>("*"),
  ];
  for (const element of elements) {
    element.setAttribute("stroke", color);
    element.style.setProperty("stroke", color);
  }
  renderedStem.color = color;
}

export function addStaffProgressMarker(
  parent: SVGElement,
  noteIndex: number,
  x: number,
  topY: number,
  bottomY: number,
  type: "practice" | "playback",
  width: number,
  beatRange?: { endBeat: number; startBeat: number },
  alignPracticeProgressMarkerToNote = false,
  centerPracticeMarkerOnAnchor = false
): void {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const offset =
    type === "playback"
      ? width * 0.22
      : alignPracticeProgressMarkerToNote || centerPracticeMarkerOnAnchor
        ? 0
        : -width * 0.22;
  marker.setAttribute("class", `staff-page-progress-marker is-${type}`);
  marker.setAttribute("data-staff-progress-marker", "");
  marker.setAttribute("data-progress-type", type);
  marker.setAttribute("data-note-index", String(noteIndex));
  if (beatRange) {
    marker.setAttribute("data-start-beat", beatRange.startBeat.toFixed(4));
    marker.setAttribute("data-end-beat", beatRange.endBeat.toFixed(4));
  }
  marker.setAttribute("x", (x - width / 2 + offset).toFixed(2));
  marker.setAttribute("y", topY.toFixed(2));
  marker.setAttribute("width", width.toFixed(2));
  marker.setAttribute("height", Math.max(0, bottomY - topY).toFixed(2));
  marker.setAttribute("opacity", "0");
  marker.setAttribute("aria-hidden", "true");
  parent.appendChild(marker);
}

export function updateStaffProgressMarkers(
  rendererTarget: HTMLDivElement | null,
  practiceIndex: number,
  playbackIndex: number | null,
  practiceMarkerEnabled: boolean,
  practiceBeat?: number
): void {
  if (!rendererTarget) return;
  const activePracticeNoteIndices = new Set<number>();
  rendererTarget
    .querySelectorAll<SVGRectElement>("[data-staff-progress-marker]")
    .forEach((marker) => {
      const noteIndex = Number(marker.getAttribute("data-note-index"));
      const type = marker.getAttribute("data-progress-type");
      const startBeat = Number(marker.getAttribute("data-start-beat"));
      const endBeat = Number(marker.getAttribute("data-end-beat"));
      const isBeatMarker = Number.isFinite(startBeat) && Number.isFinite(endBeat);
      const active =
        type === "practice"
          ? practiceMarkerEnabled &&
            (practiceBeat !== undefined && isBeatMarker
              ? practiceBeat >= startBeat - 0.0001 && practiceBeat < endBeat - 0.0001
              : noteIndex === practiceIndex)
          : type === "playback" && playbackIndex !== null && noteIndex === playbackIndex;
      marker.setAttribute("opacity", active ? (type === "practice" ? "0.32" : "0.34") : "0");
      if (active && type === "practice" && Number.isInteger(noteIndex)) {
        activePracticeNoteIndices.add(noteIndex);
      }
    });
  rendererTarget
    .querySelectorAll<SVGPolygonElement>("[data-staff-current-note-indicator]")
    .forEach((indicator) => {
      const noteIndex = Number(indicator.getAttribute("data-note-index"));
      indicator.style.opacity =
        practiceMarkerEnabled && activePracticeNoteIndices.has(noteIndex) ? "1" : "0";
    });
}

export function staveNoteHorizontalBounds(note: StaveNote): {
  left: number;
  markerX: number;
  right: number;
} {
  const glyphBounds = note.getBoundingBox();
  const glyphLeft = glyphBounds.getX();
  const glyphRight = glyphLeft + glyphBounds.getW();
  const noteHeadBounds = note.noteHeads.map((noteHead) => ({
    left: noteHead.getAbsoluteX(),
    right: noteHead.getAbsoluteX() + noteHead.getWidth(),
  }));
  if (noteHeadBounds.length > 0) {
    const headLeft = Math.min(...noteHeadBounds.map((bounds) => bounds.left));
    const headRight = Math.max(...noteHeadBounds.map((bounds) => bounds.right));
    const stemX = note.hasStem() ? note.getStemX() : undefined;
    const stemLeft = stemX === undefined ? Number.POSITIVE_INFINITY : stemX - Stem.WIDTH / 2;
    const stemRight = stemX === undefined ? Number.NEGATIVE_INFINITY : stemX + Stem.WIDTH / 2;
    return {
      left: Math.min(headLeft, glyphLeft, stemLeft),
      markerX: (headLeft + headRight) / 2,
      right: Math.max(headRight, glyphRight, stemRight),
    };
  }
  return { left: glyphLeft, markerX: (glyphLeft + glyphRight) / 2, right: glyphRight };
}

export function isBarlineClearOfNotes(
  x: number,
  notes: readonly TimedStaveNote[],
  horizontalClearance: number
): boolean {
  return notes.every(
    (note) => x <= note.left - horizontalClearance || x >= note.right + horizontalClearance
  );
}

export function getTimedStaveNotes(
  tickableGroups: readonly (readonly StaffPageTickable[])[],
  rowStartBeat: number,
  ticksPerQuarter: number
): TimedStaveNote[] {
  return tickableGroups.flatMap((tickables) => {
    let beat = rowStartBeat;
    const timedNotes: TimedStaveNote[] = [];
    tickables.forEach((tickable) => {
      const durationBeats = tickable.getTicks().value() / ticksPerQuarter;
      if (tickable instanceof StaveNote && durationBeats > 0) {
        const bounds = staveNoteHorizontalBounds(tickable);
        timedNotes.push({
          endBeat: beat + durationBeats,
          left: bounds.left,
          markerX: bounds.markerX,
          right: bounds.right,
          startBeat: beat,
        });
      }
      beat += durationBeats;
    });
    return timedNotes;
  });
}

export function getBarlineXAtBeat(
  boundaryBeat: number,
  timedNotes: readonly TimedStaveNote[]
): number | undefined {
  const epsilon = 0.001;
  const previous = timedNotes.filter((note) => Math.abs(note.endBeat - boundaryBeat) <= epsilon);
  const next = timedNotes.filter((note) => Math.abs(note.startBeat - boundaryBeat) <= epsilon);
  if (previous.length === 0 || next.length === 0) return undefined;
  const previousRight = Math.max(...previous.map((note) => note.right));
  const nextLeft = Math.min(...next.map((note) => note.left));
  const minimumGap = 4;
  return nextLeft - previousRight >= minimumGap
    ? getBarlineGapCenter(previousRight, nextLeft)
    : undefined;
}

export function makeStaffPageBeams(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDuration: PromptNoteDuration,
  visibleYBounds: { bottomY: number; topY: number },
  neutralColor: string,
  options?: {
    barlineAfterNoteIndices?: readonly number[];
    breakBeamsAtStaffChange?: boolean;
    noteBeamGroups?: readonly (number | undefined)[];
    measures: readonly (number | undefined)[];
    noteDurations: readonly StaffPageNoteDuration[];
    noteOnsets: readonly (number | undefined)[];
    rowStartIndex: number;
  }
): Beam[] {
  let beamRuns = getStaffPageBeamRuns(rowSlots, noteDuration);
  if (options) {
    beamRuns = [];
    let runStart: number | undefined;
    const closeRun = (endIndex: number): void => {
      if (runStart !== undefined && endIndex - runStart >= 2) {
        beamRuns.push({ size: endIndex - runStart, startIndex: runStart });
      }
      runStart = undefined;
    };

    for (let index = 0; index <= rowSlots.length; index += 1) {
      const duration = options.noteDurations[index];
      const isBeamable =
        index < rowSlots.length &&
        rowSlots[index] !== undefined &&
        (duration === "eighth" ||
          duration === "dotted-eighth" ||
          duration === "triplet-eighth" ||
          duration === "sixteenth" ||
          duration === "dotted-sixteenth" ||
          duration === "thirty-second" ||
          duration === "sixty-fourth");
      if (!isBeamable) {
        closeRun(index);
        continue;
      }

      if (runStart !== undefined) {
        const previousIndex = index - 1;
        const sameMeasure = options.measures[index] === options.measures[previousIndex];
        const sameBeamGroup =
          options.noteBeamGroups === undefined ||
          options.noteBeamGroups[index] === options.noteBeamGroups[previousIndex];
        const previousBarline = options.barlineAfterNoteIndices?.includes(
          options.rowStartIndex + previousIndex
        );
        const staffChanged =
          options.breakBeamsAtStaffChange &&
          rowSlots[index]?.staff !== rowSlots[previousIndex]?.staff;
        const onsetGap =
          (options.noteOnsets[index] ?? 0) - (options.noteOnsets[previousIndex] ?? 0);
        const expectedGap = quarterBeatsForDuration(options.noteDurations[previousIndex]);
        if (
          !sameMeasure ||
          !sameBeamGroup ||
          previousBarline ||
          // Single-note mixed passages must begin a new beam when they move between staves.
          staffChanged ||
          onsetGap <= 0 ||
          onsetGap > expectedGap + 0.03
        ) {
          closeRun(index);
        }
      }
      runStart ??= index;
    }
  }

  return beamRuns.flatMap(({ size, startIndex }) => {
    const groupNotes = rowSlots.slice(startIndex, startIndex + size);
    const tickables = rowTickables.slice(startIndex, startIndex + size);
    if (
      !groupNotes.every((note): note is TargetNote => note !== undefined) ||
      !tickables.every((tickable) => tickable instanceof StaveNote)
    ) {
      return [];
    }
    const staveNotes = tickables as StaveNote[];
    const isCrossStaff = groupNotes.some((note) => note.staff !== groupNotes[0].staff);
    const noteYs = staveNotes.map((staveNote) => ({ y: staveNote.getYs()[0] }));
    const preferredDirection =
      getVisibleBeamStemDirection(noteYs, visibleYBounds, Stem.HEIGHT) ??
      (isCrossStaff ? getCrossStaffOuterStemDirection(noteYs) : undefined);
    const stemDirection =
      preferredDirection === undefined
        ? undefined
        : preferredDirection === "up"
          ? Stem.UP
          : Stem.DOWN;
    const beams = Beam.generateBeams(
      staveNotes,
      stemDirection === undefined ? {} : { stemDirection }
    );
    return beams.map((beam) =>
      beam.setStyle({ fillStyle: neutralColor, strokeStyle: neutralColor })
    );
  });
}

export function makeStaffPageTuplets(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDurations: readonly StaffPageNoteDuration[],
  measures: readonly (number | undefined)[]
): Tuplet[] {
  const tuplets: Tuplet[] = [];
  const isTripletDuration = (duration: StaffPageNoteDuration): boolean =>
    duration === "triplet-eighth" || duration === "triplet-half";

  for (let index = 0; index < rowSlots.length;) {
    const firstNote = rowSlots[index];
    const firstTickable = rowTickables[index];
    if (
      !firstNote ||
      !(firstTickable instanceof StaveNote) ||
      !isTripletDuration(noteDurations[index])
    ) {
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (
      runEnd < rowSlots.length &&
      rowSlots[runEnd]?.staff === firstNote.staff &&
      measures[runEnd] === measures[index] &&
      isTripletDuration(noteDurations[runEnd]) &&
      rowTickables[runEnd] instanceof StaveNote
    ) {
      runEnd += 1;
    }

    const runLength = runEnd - index;
    let groupedCount = 0;
    if (runLength >= 3) {
      groupedCount = Math.floor(runLength / 3) * 3;
      for (let groupStart = index; groupStart < index + groupedCount; groupStart += 3) {
        const group = rowTickables.slice(groupStart, groupStart + 3);
        if (group.every((tickable): tickable is StaveNote => tickable instanceof StaveNote)) {
          tuplets.push(
            new Tuplet(group, {
              bracketed: true,
              notesOccupied: 2,
              numNotes: 3,
              ratioed: false,
            })
          );
        }
      }
    }

    for (let ungroupedIndex = index + groupedCount; ungroupedIndex < runEnd; ungroupedIndex += 1) {
      const tickable = rowTickables[ungroupedIndex];
      if (tickable instanceof StaveNote) tickable.applyTickMultiplier(2, 3);
    }
    index = runEnd;
  }

  return tuplets;
}

export function addBarline(
  parent: SVGElement,
  x: number,
  y1: number,
  y2: number,
  color: string
): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "staff-page-barline");
  line.setAttribute("x1", x.toFixed(2));
  line.setAttribute("x2", x.toFixed(2));
  line.setAttribute("y1", y1.toFixed(2));
  line.setAttribute("y2", y2.toFixed(2));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("shape-rendering", "crispEdges");
  parent.appendChild(line);
}

export function addStaffPageLyric(
  parent: SVGElement,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string
): void {
  const lyric = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lyric.setAttribute("class", "staff-page-lyric");
  lyric.setAttribute("x", x.toFixed(2));
  lyric.setAttribute("y", y.toFixed(2));
  lyric.setAttribute("font-size", fontSize.toFixed(2));
  lyric.setAttribute("fill", color);
  lyric.setAttribute("text-anchor", "middle");
  lyric.setAttribute("dominant-baseline", "middle");
  lyric.textContent = text;
  parent.appendChild(lyric);
}

export function addStaffPageNoteLabel(
  parent: SVGElement,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string
): void {
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("class", "staff-page-note-label");
  label.setAttribute("x", x.toFixed(2));
  label.setAttribute("y", y.toFixed(2));
  label.setAttribute("font-size", fontSize.toFixed(2));
  label.setAttribute("font-weight", "700");
  label.setAttribute("fill", color);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.textContent = text;
  parent.appendChild(label);
}

export function addStaffPageCurrentNoteIndicator(
  parent: SVGElement,
  noteIndex: number,
  x: number,
  anchorY: number,
  scale: number
): SVGPolygonElement {
  const indicator = document.createElementNS(SVG_NAMESPACE, "polygon");
  const tipY = anchorY - logicalPx(STAFF_PAGE_CURRENT_NOTE_INDICATOR_TIP_OFFSET_PX, scale);
  const baseY = tipY - logicalPx(STAFF_PAGE_CURRENT_NOTE_INDICATOR_HEIGHT_PX, scale);
  const halfWidth = logicalPx(5, scale);
  indicator.setAttribute("class", "staff-page-current-note-indicator");
  indicator.setAttribute("data-note-index", String(noteIndex));
  indicator.setAttribute(
    "points",
    `${(x - halfWidth).toFixed(2)},${baseY.toFixed(2)} ` +
      `${(x + halfWidth).toFixed(2)},${baseY.toFixed(2)} ` +
      `${x.toFixed(2)},${tipY.toFixed(2)}`
  );
  indicator.setAttribute("data-staff-current-note-indicator", "");
  indicator.setAttribute("aria-hidden", "true");
  indicator.style.opacity = "0";
  parent.appendChild(indicator);
  return indicator;
}

export function getHighestStaffPageNoteHeadPosition(
  tickablesBySlot: readonly Partial<Record<Staff, StaveNote>>[],
  staff?: Staff
): { x: number; y: number } | undefined {
  const noteHeads = tickablesBySlot.flatMap((tickables) => {
    const staveNotes = staff ? [tickables[staff]] : Object.values(tickables);
    return staveNotes.flatMap((staveNote) => {
      if (!staveNote) return [];
      const noteYs = staveNote.getYs();
      return staveNote.noteHeads.flatMap((noteHead, index) => {
        const y = noteYs[index];
        return typeof y === "number" && Number.isFinite(y)
          ? [{ x: noteHead.getAbsoluteX() + noteHead.getWidth() / 2, y }]
          : [];
      });
    });
  });

  return noteHeads.reduce<{ x: number; y: number } | undefined>(
    (highest, current) => (!highest || current.y < highest.y ? current : highest),
    undefined
  );
}

export function getBarlineX(
  nextTickable: StaffPageTickable | undefined,
  previousNote: StaveNote | undefined,
  nextNote: StaveNote | undefined
): number | undefined {
  if (!previousNote || (!nextNote && !nextTickable)) {
    return undefined;
  }
  const previousBounds = previousNote.getBoundingBox();
  const nextBounds = nextNote?.getBoundingBox();
  const nextX = nextBounds?.getX() ?? nextTickable?.getAbsoluteX();
  if (nextX === undefined) return undefined;
  return getBarlineGapCenter(previousBounds.getX() + previousBounds.getW(), nextX);
}

export function alignRowNotesEvenly(
  tickables: readonly StaffPageTickable[],
  noteCount: number,
  noteArea: { left: number; right: number }
): void {
  const notesToAlign = tickables
    .slice(0, noteCount)
    .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote);
  alignStaveNotesToCenters(
    notesToAlign,
    getEvenlySpacedCenters(notesToAlign.length, noteArea.left, noteArea.right)
  );
}

export function alignRowNotesWithGap(
  tickables: readonly StaffPageTickable[],
  noteCount: number,
  noteArea: { left: number; right: number },
  centerGap: number
): void {
  const notesToAlign = tickables
    .slice(0, noteCount)
    .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote);
  if (notesToAlign.length === 0) return;
  if (notesToAlign.length === 1) {
    alignStaveNotesToCenters(notesToAlign, [(noteArea.left + noteArea.right) / 2]);
    return;
  }

  const maxGap = (noteArea.right - noteArea.left) / (notesToAlign.length - 1);
  const fittedGap = Math.min(Math.max(1, centerGap), maxGap);
  const groupWidth = fittedGap * (notesToAlign.length - 1);
  const firstCenter = (noteArea.left + noteArea.right - groupWidth) / 2;
  alignStaveNotesToCenters(
    notesToAlign,
    notesToAlign.map((_, index) => firstCenter + fittedGap * index)
  );
}

export function getMeasureAlignedBeatX(
  beat: number,
  rowStartBeat: number,
  beatsPerMeasure: number,
  measureCount: number,
  noteArea: { left: number; right: number },
  measureWidthsPx?: readonly number[],
  effectiveDisplayScale = 1
): number | undefined {
  if (
    !Number.isFinite(beat) ||
    !Number.isFinite(rowStartBeat) ||
    !Number.isFinite(beatsPerMeasure) ||
    beatsPerMeasure <= 0 ||
    measureCount <= 0
  ) {
    return undefined;
  }

  const equalMeasureWidth = (noteArea.right - noteArea.left) / measureCount;
  const relativeBeat = Math.max(0, beat - rowStartBeat);
  const measureOffset = Math.min(
    measureCount - 1,
    Math.floor((relativeBeat + 0.000001) / beatsPerMeasure)
  );
  const measureWidth = measureWidthsPx?.[measureOffset] ?? equalMeasureWidth;
  const measureLeft =
    noteArea.left +
    (measureWidthsPx
      ? measureWidthsPx.slice(0, measureOffset).reduce((total, width) => total + width, 0)
      : measureOffset * equalMeasureWidth);
  const beatWithinMeasure = relativeBeat - measureOffset * beatsPerMeasure;
  const inset = getPracticeStaffMeasureEdgeInsetPx(measureWidth, effectiveDisplayScale);

  return (
    measureLeft +
    inset +
    (beatWithinMeasure / beatsPerMeasure) * Math.max(1, measureWidth - inset * 2)
  );
}

export function alignTickablesToMeasureColumns(
  tickableGroups: readonly (readonly StaffPageTickable[])[],
  rowStartBeat: number,
  ticksPerQuarter: number,
  beatsPerMeasure: number,
  measureCount: number,
  noteArea: { left: number; right: number },
  measureWidthsPx?: readonly number[],
  effectiveDisplayScale = 1
): void {
  if (measureCount <= 0 || beatsPerMeasure <= 0) return;
  const contexts = new Map<ReturnType<StaveNote["checkTickContext"]>, { beat: number }>();

  tickableGroups.forEach((tickables) => {
    let beat = rowStartBeat;
    tickables.forEach((tickable) => {
      const tickContext = tickable.checkTickContext();
      const entry = contexts.get(tickContext) ?? { beat };
      contexts.set(tickContext, entry);
      beat += tickable.getTicks().value() / ticksPerQuarter;
    });
  });

  contexts.forEach(({ beat }, tickContext) => {
    const targetCenter = getMeasureAlignedBeatX(
      beat,
      rowStartBeat,
      beatsPerMeasure,
      measureCount,
      noteArea,
      measureWidthsPx,
      effectiveDisplayScale
    );
    if (targetCenter === undefined) return;
    // Notes and rests need the same absolute SVG coordinate basis. TickContext
    // X alone is relative to the stave start and shifts rest-only contexts.
    const representative = [...tickContext.getTickables()].find(
      (tickable): tickable is StaveNote => tickable instanceof StaveNote
    );
    const currentCenter = representative ? staveNoteCenterX(representative) : tickContext.getX();
    tickContext.setX(tickContext.getX() + targetCenter - currentCenter);
  });
}

export function quarterBeatsForDuration(duration: StaffPageNoteDuration): number {
  if (duration === "whole") return 4;
  if (duration === "dotted-whole") return 6;
  if (duration === "half") return 2;
  if (duration === "dotted-half") return 3;
  if (duration === "quarter") return 1;
  if (duration === "quarter-plus-sixteenth") return 1.25;
  if (duration === "dotted-quarter") return 1.5;
  if (duration === "double-dotted-quarter") return 1.75;
  if (duration === "triplet-half") return 4 / 3;
  if (duration === "eighth") return 0.5;
  if (duration === "dotted-eighth") return 0.75;
  if (duration === "triplet-eighth") return 1 / 3;
  if (duration === "dotted-sixteenth") return 0.375;
  if (duration === "thirty-second") return 0.125;
  if (duration === "sixty-fourth") return 0.0625;
  return 0.25;
}

export function createVoiceOptions(tickableGroups: readonly (readonly StaffPageTickable[])[]): {
  beatValue: number;
  numBeats: number;
} {
  const ticksPerQuarter = new Voice({ numBeats: 1, beatValue: 4 }).getTotalTicks().value();
  const maxTicks = Math.max(
    0,
    ...tickableGroups.map((tickables) =>
      tickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0)
    )
  );
  // Size the strict Voice from the actual VexFlow tickables (after tuplets and
  // tied-note continuations have been applied), with a small rounding margin.
  const numBeats = Math.ceil((maxTicks / ticksPerQuarter) * 1024) / 1024;
  return { beatValue: 4, numBeats };
}
