import { useLayoutEffect, useMemo, useRef } from "react";
import { Beam, Formatter, GhostNote, Stave, StaveNote, Stem, Voice } from "vexflow";
import { markMidiLatencyStage } from "../diagnostics/midiLatencyDiagnostics";
import { noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, StaffNotationMode, TargetNote } from "../domain/types";
import {
  PRACTICE_PAGE_STAFF_LAYOUT,
  type PracticePageStaffLayoutProfile,
} from "./staffLayoutProfiles";
import { useNightMode } from "./pageAppearance";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getLedgerStemDirection,
  logicalPx,
} from "./staffGeometry";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getQuarterNoteBeats,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
  getVexNoteDuration,
} from "./staffPageNotation";

interface StaffPagePromptProps {
  diagnosticSampleId?: number;
  notes: TargetNote[];
  completedCount: number;
  isScrolling?: boolean;
  noteDuration: PromptNoteDuration;
  layout?: PracticePageStaffLayoutProfile;
  scrollDurationMs?: number;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  distributeNotesEvenly?: boolean;
  notesPerRow?: number;
  maxRowCount?: number;
  minDisplayWidthPx?: number;
  visibleRowCount?: number;
  wrongIndex?: number;
}

const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
type StaffPageTickable = GhostNote | StaveNote;
interface StaffPagePalette {
  complete: string;
  error: string;
  ink: string;
}
interface RenderedStaffPageNote {
  color: string;
  element: SVGElement;
}

function chunkNotes(notes: TargetNote[], notesPerRow: number, maxRowCount: number): TargetNote[][] {
  const rows: TargetNote[][] = [];
  for (let index = 0; index < notes.length; index += notesPerRow) {
    rows.push(notes.slice(index, index + notesPerRow));
  }
  return rows.slice(0, maxRowCount);
}

function makeStaveNote(note: TargetNote, color: string, noteDuration: PromptNoteDuration): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: getVexNoteDuration(noteDuration),
    keys: [noteToVexKey(note)],
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setKeyStyle(0, { fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

function colorForIndex(
  index: number,
  completedCount: number,
  wrongIndex: number | undefined,
  palette: StaffPagePalette,
): string {
  if (index === wrongIndex) {
    return palette.error;
  }
  if (index < completedCount) {
    return palette.complete;
  }
  return palette.ink;
}

function updateRenderedNoteColor(renderedNote: RenderedStaffPageNote, color: string): void {
  if (renderedNote.color === color) {
    return;
  }
  const elements = [renderedNote.element, ...renderedNote.element.querySelectorAll<SVGElement>("*")];
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

function makeStaffPageBeams(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDuration: PromptNoteDuration,
  visibleYBounds: { bottomY: number; topY: number },
  neutralColor: string,
): Beam[] {
  return getStaffPageBeamRuns(rowSlots, noteDuration).flatMap(({ size, startIndex }) => {
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
      preferredDirection === undefined ? undefined : preferredDirection === "up" ? Stem.UP : Stem.DOWN;
    const beams = Beam.generateBeams(staveNotes, stemDirection === undefined ? {} : { stemDirection });
    return beams.map((beam) =>
      beam.setStyle({ fillStyle: neutralColor, strokeStyle: neutralColor }),
    );
  });
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

function getBarlineX(
  nextTickable: StaffPageTickable,
  previousNote: StaveNote | undefined,
  nextNote: StaveNote | undefined,
): number | undefined {
  if (!previousNote) {
    return undefined;
  }
  const previousBounds = previousNote.getBoundingBox();
  const nextBounds = nextNote?.getBoundingBox();
  return getBarlineGapCenter(
    previousBounds.getX() + previousBounds.getW(),
    nextBounds?.getX() ?? nextTickable.getAbsoluteX(),
  );
}

function alignRowNotesEvenly(
  tickables: readonly StaffPageTickable[],
  noteCount: number,
  noteArea: { left: number; right: number },
): void {
  const notesToAlign = tickables
    .slice(0, noteCount)
    .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote);
  alignStaveNotesToCenters(
    notesToAlign,
    getEvenlySpacedCenters(notesToAlign.length, noteArea.left, noteArea.right),
  );
}

export function StaffPagePrompt({
  diagnosticSampleId,
  notes,
  completedCount,
  isScrolling = false,
  noteDuration,
  layout = PRACTICE_PAGE_STAFF_LAYOUT,
  scrollDurationMs = 0,
  staffNotationMode,
  useLedgerGap,
  distributeNotesEvenly = false,
  notesPerRow = layout.multirow.notesPerRow,
  maxRowCount = layout.multirow.rows + 1,
  minDisplayWidthPx = layout.width.minPx,
  visibleRowCount = layout.multirow.rows,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const diagnosticSampleIdRef = useRef(diagnosticSampleId);
  const completedCountRef = useRef(completedCount);
  const renderedNotesRef = useRef<Array<RenderedStaffPageNote | undefined>>([]);
  const wrongIndexRef = useRef(wrongIndex);
  const isNightMode = useNightMode();
  const palette = useMemo<StaffPagePalette>(() => ({
    complete: isNightMode ? "#78c994" : COMPLETE_COLOR,
    error: isNightMode ? "#f18476" : WRONG_COLOR,
    ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
  }), [isNightMode]);
  diagnosticSampleIdRef.current = diagnosticSampleId;
  completedCountRef.current = completedCount;
  wrongIndexRef.current = wrongIndex;
  const rows = useMemo(
    () => chunkNotes(notes, notesPerRow, maxRowCount),
    [maxRowCount, notes, notesPerRow],
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
        Math.min(layout.width.maxPx, containerWidth),
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        rowCount * layout.vertical.viewHeightPx +
          Math.max(0, rowCount - 1) * layout.multirow.rowGapPx,
        layout.notationScale,
      );
      const renderedScale = containerWidth / displayWidth;
      const rowStepPx =
        (layout.vertical.viewHeightPx + layout.multirow.rowGapPx) * renderedScale;
      const clampedVisibleRowCount = Math.max(1, Math.min(visibleRowCount, rowCount));
      const visibleHeight =
        (clampedVisibleRowCount * layout.vertical.viewHeightPx +
          Math.max(0, clampedVisibleRowCount - 1) * layout.multirow.rowGapPx) * renderedScale;
      frame.style.height = `${visibleHeight}px`;
      rendererTarget.style.setProperty("--staff-page-scroll-distance", `${rowStepPx}px`);
      rendererTarget.style.setProperty("--staff-page-scroll-duration", `${scrollDurationMs}ms`);
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(
        surface,
        layout.horizontal.staffSidePaddingPx,
      );
      rows.forEach((rowNotes, rowIndex) => {
        const rowStep = logicalPx(
          layout.vertical.viewHeightPx + layout.multirow.rowGapPx,
          surface.scale,
        );
        const baseY = rowIndex * rowStep;
        const visibleYBounds = {
          bottomY: baseY + logicalPx(layout.vertical.viewHeightPx, surface.scale),
          topY: baseY,
        };
        const rowGroup = context.openGroup("staff-page-system");
        const rowStartIndex = rowIndex * notesPerRow;
        const rowSlots = Array.from(
          { length: notesPerRow },
          (_, slotIndex) => rowNotes[slotIndex],
        );
        const vexDuration = getVexNoteDuration(noteDuration);
        const voiceOptions = {
          beatValue: 4,
          numBeats: notesPerRow * getQuarterNoteBeats(noteDuration),
        };
        let beams: Beam[];
        let layoutTickables: StaffPageTickable[];
        let visibleTickables: Array<StaveNote | undefined>;
        let barlineTopY: number;
        let barlineBottomY: number;
        const system = drawStaffSystem({
          brace: true,
          columnCount: notesPerRow,
          context,
          frame: frameMetrics,
          horizontal: layout.horizontal,
          mode: staffNotationMode,
          scale: surface.scale,
          useLedgerGap,
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
                  surface.scale,
                ),
            }
          : noteArea;
        if (system.mode === "grand") {
          const { bass, treble } = system;
          const tickables = rowSlots.map((note, slotIndex) => {
            if (!note) {
              return new GhostNote(vexDuration).setStave(treble);
            }
            return makeStaveNote(
              note,
              colorForIndex(rowStartIndex + slotIndex, completedCountRef.current, wrongIndexRef.current, palette),
              noteDuration,
            ).setStave(note.staff === "treble" ? treble : bass);
          });
          const voice = new Voice(voiceOptions).addTickables(tickables);
          treble.setNoteStartX(noteArea.left);
          bass.setNoteStartX(noteArea.left);
          treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          beams = makeStaffPageBeams(rowSlots, tickables, noteDuration, visibleYBounds, palette.ink);
          const formatter = new Formatter().joinVoices([voice]);
          formatter.format(
            [voice],
            treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding,
            { context },
          );
          formatter.postFormat();
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowNotes.length, distributionArea);
          }
          voice.draw(context);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined,
          );
          barlineTopY = treble.getYForLine(0);
          barlineBottomY = bass.getYForLine(4);
        } else {
          const { stave } = system;
          const tickables = rowSlots.map((note, slotIndex) =>
            note
              ? makeStaveNote(
                  note,
                  colorForIndex(rowStartIndex + slotIndex, completedCountRef.current, wrongIndexRef.current, palette),
                  noteDuration,
                ).setStave(stave)
              : new GhostNote(vexDuration).setStave(stave),
          );
          const voice = new Voice(voiceOptions).addTickables(tickables);
          beams = makeStaffPageBeams(rowSlots, tickables, noteDuration, visibleYBounds, palette.ink);
          stave.setNoteStartX(noteArea.left);
          stave.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowNotes.length, distributionArea);
          }
          voice.draw(context, stave);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined,
          );
          barlineTopY = stave.getYForLine(0);
          barlineBottomY = stave.getYForLine(4);
        }

        visibleTickables.forEach((staveNote, slotIndex) => {
          const element = staveNote?.getSVGElement();
          if (!staveNote || !element) {
            return;
          }
          const index = rowStartIndex + slotIndex;
          renderedNotesRef.current[index] = {
            color: colorForIndex(index, completedCountRef.current, wrongIndexRef.current, palette),
            element,
          };
        });

        beams.forEach((beam) => beam.setContext(context).drawWithStyle());

        const barlineInterval = getStaffPageBarlineInterval(noteDuration);
        for (
          let boundaryIndex = barlineInterval;
          boundaryIndex <= rowNotes.length && boundaryIndex < notesPerRow;
          boundaryIndex += barlineInterval
        ) {
          const nextTickable = layoutTickables[boundaryIndex];
          const barlineX = getBarlineX(
            nextTickable,
            visibleTickables[boundaryIndex - 1],
            visibleTickables[boundaryIndex],
          );
          if (barlineX !== undefined) {
            addBarline(rowGroup, barlineX, barlineTopY, barlineBottomY, palette.ink);
          }
        }
        context.closeGroup();
      });
      markMidiLatencyStage(renderedDiagnosticSampleId, "staffRenderEnded");
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    layout,
    minDisplayWidthPx,
    distributeNotesEvenly,
    noteDuration,
    notesPerRow,
    palette,
    rows,
    scrollDurationMs,
    staffNotationMode,
    useLedgerGap,
    visibleRowCount,
  ]);

  useLayoutEffect(() => {
    const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorStarted");
    renderedNotesRef.current.forEach((renderedNote, index) => {
      if (renderedNote) {
        updateRenderedNoteColor(renderedNote, colorForIndex(index, completedCount, wrongIndex, palette));
      }
    });
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorEnded");
  }, [completedCount, isNightMode, palette, wrongIndex]);

  return (
    <div ref={frameRef} className="staff-page" aria-label="谱页">
      <div
        ref={rendererTargetRef}
        className={`staff-page-renderer${isScrolling ? " staff-page-renderer-scrolling" : ""}`}
      />
    </div>
  );
}
