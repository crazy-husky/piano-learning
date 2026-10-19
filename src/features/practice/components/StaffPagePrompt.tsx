import { Play, Square } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  Accidental,
  Beam,
  Formatter,
  GhostNote,
  Stave,
  StaveNote,
  StaveTie,
  Stem,
  Tuplet,
  Voice,
} from "vexflow";
import { markMidiLatencyStage } from "../../../diagnostics/midiLatencyDiagnostics";
import { noteToVexKey } from "../../../domain/notes";
import type {
  PromptNoteDuration,
  Staff,
  StaffNotationMode,
  TargetNote,
} from "../../../domain/types";
import {
  PRACTICE_PAGE_STAFF_LAYOUT,
  type PracticePageStaffLayoutProfile,
} from "../../../shared/staff/staffLayoutProfiles";
import { useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getLedgerStemDirection,
  logicalPx,
  staveNoteCenterX,
} from "../../../shared/staff/staffGeometry";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
  getVexNoteDuration,
} from "../logic/staffPageNotation";

interface StaffPagePromptProps {
  barlineAfterNoteIndices?: readonly number[];
  diagnosticSampleId?: number;
  notes: TargetNote[];
  noteGroups?: readonly (readonly TargetNote[])[];
  lyrics?: readonly (readonly string[])[];
  noteMeasures?: readonly number[];
  noteOnsets?: readonly number[];
  noteBeamGroups?: readonly number[];
  beatsPerMeasure?: number;
  timeSignature?: string;
  completedCount: number;
  completedNoteIndices?: readonly number[];
  activePairStartIndex?: number;
  isScrolling?: boolean;
  noteDuration: PromptNoteDuration;
  noteDurations?: readonly StaffPageNoteDuration[];
  staffNoteDurations?: readonly {
    treble?: StaffPageNoteDuration;
    bass?: StaffPageNoteDuration;
  }[];
  layout?: PracticePageStaffLayoutProfile;
  scrollDurationMs?: number;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  distributeNotesEvenly?: boolean;
  notesPerRow?: number;
  maxRowCount?: number;
  minDisplayWidthPx?: number;
  visibleRowCount?: number;
  breakBeamsAtStaffChange?: boolean;
  monophonicGrandStaff?: boolean;
  useInvisibleGapRests?: boolean;
  showGrandStaffRightConnector?: boolean;
  onToggleRowPlayback?: (rowIndex: number) => void;
  playingRowIndex?: number | null;
  playbackProgressIndex?: number | null;
  wrongIndex?: number;
}

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

const STAFF_VEX_DURATIONS: Record<StaffPageNoteDuration, string> = {
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

const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
type StaffPageTickable = GhostNote | StaveNote;
interface StaffPagePalette {
  active: string;
  complete: string;
  error: string;
  ink: string;
}
interface RenderedStaffPageNote {
  color: string;
  element: SVGElement;
}

function chunkNoteGroups(
  noteGroups: readonly (readonly TargetNote[])[],
  notesPerRow: number,
  maxRowCount: number
): TargetNote[][][] {
  const rows: TargetNote[][][] = [];
  for (let index = 0; index < noteGroups.length; index += notesPerRow) {
    rows.push(noteGroups.slice(index, index + notesPerRow).map((group) => [...group]));
  }
  return rows.slice(0, maxRowCount);
}

function makeStaveNote(
  noteOrNotes: TargetNote | readonly TargetNote[],
  color: string,
  noteDuration: StaffPageNoteDuration
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
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  notes.forEach((chordNote, index) => {
    staveNote.setKeyStyle(index, { fillStyle: color, strokeStyle: color });
    if (chordNote.accidental) {
      staveNote.addModifier(new Accidental(chordNote.accidental === "sharp" ? "#" : "b"), index);
    }
  });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

function makeStaffGhostNote(noteDuration: StaffPageNoteDuration): GhostNote {
  const ghostNote = new GhostNote(STAFF_VEX_DURATIONS[noteDuration]);
  if (noteDuration === "triplet-eighth" || noteDuration === "triplet-half") {
    ghostNote.applyTickMultiplier(2, 3);
  }
  return ghostNote;
}

const STAFF_REST_DURATIONS: readonly {
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

function makeStaveRest(
  duration: StaffPageNoteDuration,
  staff: "treble" | "bass",
  stave: Stave,
  tuplet?: readonly [number, number]
): StaveNote {
  const rest = new StaveNote({
    clef: staff,
    duration: `${STAFF_VEX_DURATIONS[duration]}r`,
    keys: [staff === "treble" ? "b/4" : "d/3"],
  }).setStave(stave);
  if (tuplet) rest.applyTickMultiplier(tuplet[0], tuplet[1]);
  return rest;
}

function makeStaveRestsForGap(
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

function makeStaffGhostsForGap(
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

function padStaffTickablesToDuration(
  tickables: readonly StaffPageTickable[],
  targetTicks: number,
  staff: "treble" | "bass",
  stave: Stave,
  rowOnsets?: readonly (number | undefined)[],
  beatsPerMeasure?: number,
  useInvisiblePadding = false
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
    ...(useInvisiblePadding
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

function assignStaffVoiceLanes(
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

function getLaneBeamOptions(
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

function expandTiedDurations(
  rowGroups: readonly (readonly TargetNote[])[],
  primaryTickables: readonly StaffPageTickable[],
  noteDurations: readonly StaffPageNoteDuration[],
  getColor: (slotIndex: number) => string,
  noteOnsets?: readonly number[],
  beatsPerMeasure?: number,
  staff: Staff = "treble",
  monophonicGrandStaff = false,
  useInvisibleGapRests = false
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
    if (noteOnsets && noteGroup.length === 0 && !monophonicGrandStaff) return;
    if (noteOnsets && noteOnset !== undefined && noteOnset > cursorBeat + 0.001) {
      const gapFillers =
        monophonicGrandStaff || useInvisibleGapRests
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
        const continuation = makeStaveNote(noteGroup, getColor(slotIndex), "sixteenth").setStave(
          primary.getStave()!
        );
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

function colorForIndex(
  index: number,
  completedCount: number,
  completedNoteIndices: readonly number[] | undefined,
  wrongIndex: number | undefined,
  activePairStartIndex: number | undefined,
  palette: StaffPagePalette
): string {
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

function updateRenderedNoteColor(renderedNote: RenderedStaffPageNote, color: string): void {
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

function addStaffProgressMarker(
  parent: SVGElement,
  noteIndex: number,
  x: number,
  topY: number,
  bottomY: number,
  type: "practice" | "playback",
  width: number
): void {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const offset = type === "practice" ? -width * 0.22 : width * 0.22;
  marker.setAttribute("class", `staff-page-progress-marker is-${type}`);
  marker.setAttribute("data-staff-progress-marker", "");
  marker.setAttribute("data-progress-type", type);
  marker.setAttribute("data-note-index", String(noteIndex));
  marker.setAttribute("x", (x - width / 2 + offset).toFixed(2));
  marker.setAttribute("y", topY.toFixed(2));
  marker.setAttribute("width", width.toFixed(2));
  marker.setAttribute("height", Math.max(0, bottomY - topY).toFixed(2));
  marker.setAttribute("opacity", "0");
  marker.setAttribute("aria-hidden", "true");
  parent.appendChild(marker);
}

function updateStaffProgressMarkers(
  rendererTarget: HTMLDivElement | null,
  practiceIndex: number,
  playbackIndex: number | null
): void {
  if (!rendererTarget) return;
  rendererTarget
    .querySelectorAll<SVGRectElement>("[data-staff-progress-marker]")
    .forEach((marker) => {
      const noteIndex = Number(marker.getAttribute("data-note-index"));
      const type = marker.getAttribute("data-progress-type");
      const active =
        type === "practice"
          ? noteIndex === practiceIndex
          : type === "playback" && playbackIndex !== null && noteIndex === playbackIndex;
      marker.setAttribute("opacity", active ? (type === "practice" ? "0.32" : "0.34") : "0");
    });
}

function makeStaffPageBeams(
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

function makeStaffPageTuplets(
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

function addBarline(parent: SVGElement, x: number, y1: number, y2: number, color: string): void {
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

function addStaffPageLyric(
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

function getBarlineX(
  nextTickable: StaffPageTickable,
  previousNote: StaveNote | undefined,
  nextNote: StaveNote | undefined
): number | undefined {
  if (!previousNote) {
    return undefined;
  }
  const previousBounds = previousNote.getBoundingBox();
  const nextBounds = nextNote?.getBoundingBox();
  return getBarlineGapCenter(
    previousBounds.getX() + previousBounds.getW(),
    nextBounds?.getX() ?? nextTickable.getAbsoluteX()
  );
}

function alignRowNotesEvenly(
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

function quarterBeatsForDuration(duration: StaffPageNoteDuration): number {
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

function createVoiceOptions(tickableGroups: readonly (readonly StaffPageTickable[])[]): {
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

export function StaffPagePrompt({
  barlineAfterNoteIndices,
  diagnosticSampleId,
  notes,
  noteGroups,
  lyrics,
  noteMeasures,
  noteOnsets,
  noteBeamGroups,
  beatsPerMeasure,
  timeSignature,
  completedCount,
  completedNoteIndices,
  activePairStartIndex,
  isScrolling = false,
  noteDuration,
  noteDurations,
  staffNoteDurations,
  layout = PRACTICE_PAGE_STAFF_LAYOUT,
  scrollDurationMs = 0,
  staffNotationMode,
  useLedgerGap,
  distributeNotesEvenly = false,
  notesPerRow = layout.multirow.notesPerRow,
  maxRowCount = layout.multirow.rows + 1,
  minDisplayWidthPx = layout.width.minPx,
  visibleRowCount = layout.multirow.rows,
  breakBeamsAtStaffChange = false,
  monophonicGrandStaff = false,
  useInvisibleGapRests = false,
  showGrandStaffRightConnector = true,
  onToggleRowPlayback,
  playingRowIndex = null,
  playbackProgressIndex = null,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const diagnosticSampleIdRef = useRef(diagnosticSampleId);
  const completedCountRef = useRef(completedCount);
  const completedNoteIndicesRef = useRef(completedNoteIndices);
  const activePairStartIndexRef = useRef(activePairStartIndex);
  const playbackProgressIndexRef = useRef(playbackProgressIndex);
  const renderedNotesRef = useRef<Array<RenderedStaffPageNote | undefined>>([]);
  const wrongIndexRef = useRef(wrongIndex);
  const isNightMode = useNightMode();
  const palette = useMemo<StaffPagePalette>(
    () => ({
      active: isNightMode ? "#77c8ba" : "#256f67",
      complete: isNightMode ? "#78c994" : COMPLETE_COLOR,
      error: isNightMode ? "#f18476" : WRONG_COLOR,
      ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
    }),
    [isNightMode]
  );
  diagnosticSampleIdRef.current = diagnosticSampleId;
  completedCountRef.current = completedCount;
  completedNoteIndicesRef.current = completedNoteIndices;
  activePairStartIndexRef.current = activePairStartIndex;
  playbackProgressIndexRef.current = playbackProgressIndex;
  wrongIndexRef.current = wrongIndex;
  const rows = useMemo(
    () => chunkNoteGroups(noteGroups ?? notes.map((note) => [note]), notesPerRow, maxRowCount),
    [maxRowCount, noteGroups, notes, notesPerRow]
  );

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!frame || !rendererTarget) {
      return;
    }

    function render(): void {
      if (!frame || !rendererTarget) {
        return;
      }

      const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
      markMidiLatencyStage(renderedDiagnosticSampleId, "staffRenderStarted");
      renderedNotesRef.current = [];
      rendererTarget.innerHTML = "";
      const rowCount = Math.max(1, rows.length);
      const containerWidth = frame.clientWidth || 920;
      const displayWidth = Math.max(
        minDisplayWidthPx,
        Math.min(layout.width.maxPx, containerWidth)
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        rowCount * layout.vertical.viewHeightPx +
          Math.max(0, rowCount - 1) * layout.multirow.rowGapPx,
        layout.notationScale
      );
      const renderedScale = Math.min(containerWidth / displayWidth, 1);
      const rowStepPx = (layout.vertical.viewHeightPx + layout.multirow.rowGapPx) * renderedScale;
      const clampedVisibleRowCount = Math.max(1, Math.min(visibleRowCount, rowCount));
      const visibleHeight =
        (clampedVisibleRowCount * layout.vertical.viewHeightPx +
          Math.max(0, clampedVisibleRowCount - 1) * layout.multirow.rowGapPx) *
        renderedScale;
      frame.style.height = `${visibleHeight}px`;
      rendererTarget.style.setProperty("--staff-page-scroll-distance", `${rowStepPx}px`);
      rendererTarget.style.setProperty("--staff-page-scroll-duration", `${scrollDurationMs}ms`);
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(surface, layout.horizontal.staffSidePaddingPx);
      rows.forEach((rowGroups, rowIndex) => {
        const rowStep = logicalPx(
          layout.vertical.viewHeightPx + layout.multirow.rowGapPx,
          surface.scale
        );
        const baseY = rowIndex * rowStep;
        const visibleYBounds = {
          bottomY: baseY + logicalPx(layout.vertical.viewHeightPx, surface.scale),
          topY: baseY,
        };
        const rowGroup = context.openGroup("staff-page-system");
        const rowStartIndex = rowIndex * notesPerRow;
        const visibleRowGroups = Array.from(
          { length: notesPerRow },
          (_, slotIndex) => rowGroups[slotIndex] ?? []
        );
        const rowSlots = visibleRowGroups.map((group) => group[0]);
        const vexDuration = getVexNoteDuration(noteDuration);
        const rowDurations = rowSlots.map(
          (_, slotIndex) => noteDurations?.[rowStartIndex + slotIndex] ?? noteDuration
        );
        const rowTrebleDurations = rowDurations.map(
          (duration, slotIndex) =>
            staffNoteDurations?.[rowStartIndex + slotIndex]?.treble ?? duration
        );
        const rowBassDurations = rowDurations.map(
          (duration, slotIndex) => staffNoteDurations?.[rowStartIndex + slotIndex]?.bass ?? duration
        );
        const rowSelectedDurations = rowSlots.map((note, slotIndex) =>
          note?.staff === "bass" ? rowBassDurations[slotIndex]! : rowTrebleDurations[slotIndex]!
        );
        const rowOnsets = noteOnsets
          ? rowSlots.map((_, slotIndex) => noteOnsets[rowStartIndex + slotIndex])
          : undefined;
        const beamOptions =
          noteDurations && noteMeasures && noteOnsets
            ? {
                barlineAfterNoteIndices,
                breakBeamsAtStaffChange,
                measures: rowSlots.map((_, slotIndex) => noteMeasures[rowStartIndex + slotIndex]),
                noteBeamGroups: noteBeamGroups
                  ? rowSlots.map((_, slotIndex) => noteBeamGroups[rowStartIndex + slotIndex])
                  : undefined,
                noteDurations: rowSelectedDurations,
                noteOnsets: rowOnsets ?? [],
                rowStartIndex,
              }
            : undefined;
        let beams: Beam[];
        let tuplets: Tuplet[];
        let ties: StaveTie[];
        let layoutTickables: StaffPageTickable[];
        let visibleTickables: Array<StaveNote | undefined>;
        let barlineTopY: number;
        let barlineBottomY: number;
        let lyricAnchorY: number;
        const system = drawStaffSystem({
          brace: true,
          columnCount: notesPerRow,
          context,
          frame: frameMetrics,
          horizontal: layout.horizontal,
          mode: staffNotationMode,
          scale: surface.scale,
          useLedgerGap,
          timeSignature,
          showGrandStaffRightConnector,
          vertical: layout.vertical,
          yOffset: baseY,
        });
        const { noteArea } = system;
        const distributionArea = distributeNotesEvenly
          ? {
              ...noteArea,
              right:
                noteArea.right +
                logicalPx(
                  layout.horizontal.noteAreaSidePaddingPx -
                    layout.horizontal.minNoteAreaSidePaddingPx,
                  surface.scale
                ),
            }
          : noteArea;
        if (system.mode === "grand") {
          const { bass, treble } = system;
          const getColor = (slotIndex: number): string =>
            colorForIndex(
              rowStartIndex + slotIndex,
              completedCountRef.current,
              completedNoteIndicesRef.current,
              wrongIndexRef.current,
              activePairStartIndexRef.current,
              palette
            );
          const trebleGroups = visibleRowGroups.map((group) =>
            group.filter((note) => note.staff === "treble")
          );
          const bassGroups = visibleRowGroups.map((group) =>
            group.filter((note) => note.staff === "bass")
          );
          const makeStaffTickables = (
            groups: readonly (readonly TargetNote[])[],
            durations: readonly StaffPageNoteDuration[],
            stave: Stave
          ): StaffPageTickable[] =>
            groups.map((group, slotIndex) =>
              group.length > 0
                ? makeStaveNote(group, getColor(slotIndex), durations[slotIndex]!).setStave(stave)
                : makeStaffGhostNote(durations[slotIndex]!).setStave(stave)
            );
          const trebleTickables = makeStaffTickables(trebleGroups, rowTrebleDurations, treble);
          const bassTickables = makeStaffTickables(bassGroups, rowBassDurations, bass);
          const monophonicLaneIndices = [visibleRowGroups.map((_, index) => index)];
          const trebleLaneIndices = monophonicGrandStaff
            ? monophonicLaneIndices
            : assignStaffVoiceLanes(trebleGroups, rowTrebleDurations, rowOnsets);
          const bassLaneIndices = monophonicGrandStaff
            ? monophonicLaneIndices
            : assignStaffVoiceLanes(bassGroups, rowBassDurations, rowOnsets);
          const tickables = rowSlots.map((note, slotIndex) =>
            note?.staff === "bass" ? bassTickables[slotIndex] : trebleTickables[slotIndex]
          );
          const measures = beamOptions?.measures ?? [];
          const buildStaffLanes = (
            groups: readonly (readonly TargetNote[])[],
            durations: readonly StaffPageNoteDuration[],
            primaryTickables: readonly StaffPageTickable[],
            laneIndices: readonly (readonly number[])[],
            stave: Stave,
            staff: Staff
          ): Array<{
            beams: Beam[];
            expandedTickables: StaffPageTickable[];
            ties: StaveTie[];
            tuplets: Tuplet[];
          }> =>
            laneIndices.map((indices) => {
              const laneSlots = new Set(indices);
              const laneGroups = groups.map((group, slotIndex) =>
                laneSlots.has(slotIndex) ? group : []
              );
              const laneTickables = primaryTickables.map((tickable, slotIndex) =>
                laneSlots.has(slotIndex)
                  ? tickable
                  : makeStaffGhostNote(durations[slotIndex]!).setStave(stave)
              );
              const expanded = expandTiedDurations(
                laneGroups,
                laneTickables,
                durations,
                getColor,
                rowOnsets,
                beatsPerMeasure,
                staff,
                monophonicGrandStaff,
                useInvisibleGapRests
              );
              const compactIndices = indices.filter(
                (slotIndex) => laneGroups[slotIndex]!.length > 0
              );
              const compactSlots = compactIndices.map((slotIndex) => laneGroups[slotIndex]![0]);
              const compactTickables = compactIndices.map((slotIndex) => laneTickables[slotIndex]!);
              return {
                beams: makeStaffPageBeams(
                  compactSlots,
                  compactTickables,
                  noteDuration,
                  visibleYBounds,
                  palette.ink,
                  getLaneBeamOptions(beamOptions, compactIndices)
                ),
                expandedTickables: expanded.tickables,
                ties: expanded.ties,
                tuplets: makeStaffPageTuplets(
                  compactSlots,
                  compactTickables,
                  compactIndices.map((slotIndex) => durations[slotIndex]!),
                  compactIndices.map((slotIndex) => measures[slotIndex])
                ),
              };
            });
          const trebleLanes = buildStaffLanes(
            trebleGroups,
            rowTrebleDurations,
            trebleTickables,
            trebleLaneIndices,
            treble,
            "treble"
          );
          const bassLanes = buildStaffLanes(
            bassGroups,
            rowBassDurations,
            bassTickables,
            bassLaneIndices,
            bass,
            "bass"
          );
          ties = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.ties);
          tuplets = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.tuplets);
          beams = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.beams);
          const allExpandedTickables = [...trebleLanes, ...bassLanes].map(
            (lane) => lane.expandedTickables
          );
          const longestVoiceTicks = Math.max(
            ...allExpandedTickables.map((laneTickables) =>
              laneTickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0)
            )
          );
          const alignedTickableGroups = allExpandedTickables.map((laneTickables, index) =>
            padStaffTickablesToDuration(
              laneTickables,
              longestVoiceTicks,
              index < trebleLanes.length ? "treble" : "bass",
              index < trebleLanes.length ? treble : bass,
              rowOnsets,
              beatsPerMeasure,
              monophonicGrandStaff || useInvisibleGapRests
            )
          );
          const voiceOptions = createVoiceOptions(alignedTickableGroups);
          const voices = alignedTickableGroups.map((alignedTickables, index) =>
            new Voice(voiceOptions)
              .setStrict(false)
              .setStave(index < trebleLanes.length ? treble : bass)
              .addTickables(alignedTickables)
          );
          treble.setNoteStartX(noteArea.left);
          bass.setNoteStartX(noteArea.left);
          treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          const formatter = new Formatter().joinVoices(voices);
          formatter.format(
            voices,
            treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding,
            { context }
          );
          formatter.postFormat();
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowGroups.length, distributionArea);
          }
          voices.forEach((voice) => voice.draw(context, voice.getStave()!));
          layoutTickables = tickables;
          visibleTickables = rowSlots.map((note, index) => {
            const tickable = note?.staff === "bass" ? bassTickables[index] : trebleTickables[index];
            return note && tickable instanceof StaveNote ? tickable : undefined;
          });
          barlineTopY = treble.getYForLine(0);
          barlineBottomY = bass.getYForLine(4);
          lyricAnchorY = treble.getYForLine(4);
        } else {
          const { stave } = system;
          const tickables = rowSlots.map((note, slotIndex) =>
            note
              ? makeStaveNote(
                  visibleRowGroups[slotIndex],
                  colorForIndex(
                    rowStartIndex + slotIndex,
                    completedCountRef.current,
                    completedNoteIndicesRef.current,
                    wrongIndexRef.current,
                    activePairStartIndexRef.current,
                    palette
                  ),
                  rowDurations[slotIndex]
                ).setStave(stave)
              : new GhostNote(vexDuration).setStave(stave)
          );
          const expanded = expandTiedDurations(
            visibleRowGroups,
            tickables,
            rowDurations,
            (slotIndex) =>
              colorForIndex(
                rowStartIndex + slotIndex,
                completedCountRef.current,
                completedNoteIndicesRef.current,
                wrongIndexRef.current,
                activePairStartIndexRef.current,
                palette
              ),
            rowOnsets,
            beatsPerMeasure,
            staffNotationMode === "bass-only" ? "bass" : "treble",
            false,
            useInvisibleGapRests
          );
          ties = expanded.ties;
          tuplets = makeStaffPageTuplets(
            rowSlots,
            tickables,
            rowDurations,
            beamOptions?.measures ?? []
          );
          const voiceOptions = createVoiceOptions([expanded.tickables]);
          const voice = new Voice(voiceOptions).addTickables(expanded.tickables);
          beams = makeStaffPageBeams(
            rowSlots,
            tickables,
            noteDuration,
            visibleYBounds,
            palette.ink,
            beamOptions
          );
          stave.setNoteStartX(noteArea.left);
          stave.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          const formatter = new Formatter().joinVoices([voice]);
          formatter.formatToStave([voice], stave, { context, stave });
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowGroups.length, distributionArea);
          }
          voice.draw(context, stave);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined
          );
          barlineTopY = stave.getYForLine(0);
          barlineBottomY = stave.getYForLine(4);
          lyricAnchorY = barlineBottomY;
        }

        visibleTickables.forEach((staveNote, slotIndex) => {
          const element = staveNote?.getSVGElement();
          if (!staveNote || !element) {
            return;
          }
          const index = rowStartIndex + slotIndex;
          renderedNotesRef.current[index] = {
            color: colorForIndex(
              index,
              completedCountRef.current,
              completedNoteIndicesRef.current,
              wrongIndexRef.current,
              activePairStartIndexRef.current,
              palette
            ),
            element,
          };
        });

        beams.forEach((beam) => beam.setContext(context).drawWithStyle());
        tuplets.forEach((tuplet) => tuplet.setContext(context).draw());
        ties.forEach((tie) => tie.setContext(context).draw());

        rowSlots.forEach((note, slotIndex) => {
          if (!note) return;
          const noteLyrics = lyrics?.[rowStartIndex + slotIndex];
          const staveNote = visibleTickables[slotIndex];
          if (!noteLyrics?.length || !staveNote) return;
          const noteBounds = staveNote.getBoundingBox();
          const lyricX = noteBounds.getX() + noteBounds.getW() / 2;
          noteLyrics.forEach((text, lineIndex) => {
            if (!text) return;
            addStaffPageLyric(
              rowGroup,
              text,
              lyricX,
              lyricAnchorY + logicalPx(20 + lineIndex * 22, surface.scale),
              logicalPx(15, surface.scale),
              isNightMode ? "#f0a184" : "#c45c38"
            );
          });
        });

        const barlineInterval = getStaffPageBarlineInterval(noteDuration);
        const explicitBarlineBoundaries = barlineAfterNoteIndices
          ?.map((noteIndex) => noteIndex + 1 - rowStartIndex)
          .filter((boundaryIndex) => boundaryIndex > 0 && boundaryIndex <= rowGroups.length);
        const barlineBoundaries =
          explicitBarlineBoundaries ??
          Array.from(
            { length: Math.floor(Math.min(rowGroups.length, notesPerRow - 1) / barlineInterval) },
            (_, index) => (index + 1) * barlineInterval
          );
        for (const boundaryIndex of barlineBoundaries) {
          if (boundaryIndex >= notesPerRow) continue;
          const nextTickable = layoutTickables[boundaryIndex];
          const barlineX = getBarlineX(
            nextTickable,
            visibleTickables[boundaryIndex - 1],
            visibleTickables[boundaryIndex]
          );
          if (barlineX !== undefined) {
            addBarline(rowGroup, barlineX, barlineTopY, barlineBottomY, palette.ink);
          }
        }
        visibleTickables.forEach((staveNote, slotIndex) => {
          if (!staveNote) return;
          const noteHead = staveNote.noteHeads[0];
          const noteHeadCenterX = noteHead
            ? noteHead.getAbsoluteX() + noteHead.getWidth() / 2
            : staveNoteCenterX(staveNote);
          const markerWidth = logicalPx(14, surface.scale);
          const noteIndex = rowStartIndex + slotIndex;
          addStaffProgressMarker(
            rowGroup,
            noteIndex,
            noteHeadCenterX,
            barlineTopY,
            barlineBottomY,
            "practice",
            markerWidth
          );
          addStaffProgressMarker(
            rowGroup,
            noteIndex,
            noteHeadCenterX,
            barlineTopY,
            barlineBottomY,
            "playback",
            markerWidth
          );
        });
        context.closeGroup();
      });
      updateStaffProgressMarkers(
        rendererTarget,
        completedCountRef.current,
        playbackProgressIndexRef.current
      );
      markMidiLatencyStage(renderedDiagnosticSampleId, "staffRenderEnded");
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    layout,
    barlineAfterNoteIndices,
    isNightMode,
    lyrics,
    noteMeasures,
    noteOnsets,
    noteBeamGroups,
    beatsPerMeasure,
    timeSignature,
    minDisplayWidthPx,
    distributeNotesEvenly,
    noteDuration,
    noteDurations,
    staffNoteDurations,
    notesPerRow,
    palette,
    rows,
    scrollDurationMs,
    staffNotationMode,
    breakBeamsAtStaffChange,
    monophonicGrandStaff,
    useInvisibleGapRests,
    showGrandStaffRightConnector,
    useLedgerGap,
    visibleRowCount,
  ]);

  useLayoutEffect(() => {
    updateStaffProgressMarkers(rendererTargetRef.current, completedCount, playbackProgressIndex);
  }, [completedCount, playbackProgressIndex]);

  useLayoutEffect(() => {
    const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorStarted");
    renderedNotesRef.current.forEach((renderedNote, index) => {
      if (renderedNote) {
        updateRenderedNoteColor(
          renderedNote,
          colorForIndex(
            index,
            completedCount,
            completedNoteIndices,
            wrongIndex,
            activePairStartIndex,
            palette
          )
        );
      }
    });
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorEnded");
  }, [
    activePairStartIndex,
    completedCount,
    completedNoteIndices,
    isNightMode,
    palette,
    wrongIndex,
  ]);

  return (
    <div
      ref={frameRef}
      className={`staff-page${onToggleRowPlayback ? " staff-page-with-row-playback" : ""}`}
      aria-label="谱页"
    >
      <div
        ref={rendererTargetRef}
        className={`staff-page-renderer${isScrolling ? " staff-page-renderer-scrolling" : ""}`}
      />
      {onToggleRowPlayback ? (
        <div
          className="staff-page-row-playback"
          style={{ gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}
        >
          {rows.map((row, rowIndex) => {
            if (row.length === 0) return null;
            const isPlaying = playingRowIndex === rowIndex;
            return (
              <button
                aria-label={`${isPlaying ? "停止" : "播放"}第 ${rowIndex + 1} 行`}
                aria-pressed={isPlaying}
                className={`staff-page-row-play-button${isPlaying ? " is-playing" : ""}`}
                key={rowIndex}
                title={`${isPlaying ? "停止" : "播放"}当前行`}
                type="button"
                onClick={() => onToggleRowPlayback(rowIndex)}
              >
                {isPlaying ? (
                  <Square aria-hidden="true" size={16} />
                ) : (
                  <Play aria-hidden="true" size={16} />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
