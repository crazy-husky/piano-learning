import { Play, Square } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Beam, Formatter, GhostNote, Stave, StaveNote, Stem, Voice } from "vexflow";
import { markMidiLatencyStage } from "../../../diagnostics/midiLatencyDiagnostics";
import { noteToVexKey } from "../../../domain/notes";
import type { PromptNoteDuration, StaffNotationMode, TargetNote } from "../../../domain/types";
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
  lyrics?: readonly (readonly string[])[];
  noteMeasures?: readonly number[];
  noteOnsets?: readonly number[];
  completedCount: number;
  isScrolling?: boolean;
  noteDuration: PromptNoteDuration;
  noteDurations?: readonly StaffPageNoteDuration[];
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
  onToggleRowPlayback?: (rowIndex: number) => void;
  playingRowIndex?: number | null;
  wrongIndex?: number;
}

export type StaffPageNoteDuration =
  | PromptNoteDuration
  | "half"
  | "dotted-whole"
  | "dotted-half"
  | "dotted-quarter"
  | "dotted-eighth"
  | "dotted-sixteenth";

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

function makeStaveNote(
  note: TargetNote,
  color: string,
  noteDuration: StaffPageNoteDuration
): StaveNote {
  const vexDuration =
    noteDuration === "whole"
      ? "w"
      : noteDuration === "dotted-whole"
        ? "wd"
        : noteDuration === "half"
          ? "h"
          : noteDuration === "dotted-half"
            ? "hd"
            : noteDuration === "quarter"
              ? "q"
              : noteDuration === "dotted-quarter"
                ? "qd"
                : noteDuration === "eighth"
                  ? "8"
                  : noteDuration === "dotted-eighth"
                    ? "8d"
                    : noteDuration === "dotted-sixteenth"
                      ? "16d"
                      : "16";
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: vexDuration,
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
  palette: StaffPagePalette
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

function makeStaffPageBeams(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDuration: PromptNoteDuration,
  visibleYBounds: { bottomY: number; topY: number },
  neutralColor: string,
  options?: {
    barlineAfterNoteIndices?: readonly number[];
    breakBeamsAtStaffChange?: boolean;
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
          duration === "sixteenth" ||
          duration === "dotted-sixteenth");
      if (!isBeamable) {
        closeRun(index);
        continue;
      }

      if (runStart !== undefined) {
        const previousIndex = index - 1;
        const sameMeasure = options.measures[index] === options.measures[previousIndex];
        const previousBarline = options.barlineAfterNoteIndices?.includes(
          options.rowStartIndex + previousIndex
        );
        const staffChanged =
          options.breakBeamsAtStaffChange &&
          rowSlots[index]?.staff !== rowSlots[previousIndex]?.staff;
        const onsetGap =
          (options.noteOnsets[index] ?? 0) - (options.noteOnsets[previousIndex] ?? 0);
        const expectedGap = quarterBeatsForDuration(options.noteDurations[previousIndex]) / 4;
        if (
          !sameMeasure ||
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
  if (duration === "dotted-quarter") return 1.5;
  if (duration === "eighth") return 0.5;
  if (duration === "dotted-eighth") return 0.75;
  if (duration === "dotted-sixteenth") return 0.375;
  return 0.25;
}

export function StaffPagePrompt({
  barlineAfterNoteIndices,
  diagnosticSampleId,
  notes,
  lyrics,
  noteMeasures,
  noteOnsets,
  completedCount,
  isScrolling = false,
  noteDuration,
  noteDurations,
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
  onToggleRowPlayback,
  playingRowIndex = null,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const diagnosticSampleIdRef = useRef(diagnosticSampleId);
  const completedCountRef = useRef(completedCount);
  const renderedNotesRef = useRef<Array<RenderedStaffPageNote | undefined>>([]);
  const wrongIndexRef = useRef(wrongIndex);
  const isNightMode = useNightMode();
  const palette = useMemo<StaffPagePalette>(
    () => ({
      complete: isNightMode ? "#78c994" : COMPLETE_COLOR,
      error: isNightMode ? "#f18476" : WRONG_COLOR,
      ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
    }),
    [isNightMode]
  );
  diagnosticSampleIdRef.current = diagnosticSampleId;
  completedCountRef.current = completedCount;
  wrongIndexRef.current = wrongIndex;
  const rows = useMemo(
    () => chunkNotes(notes, notesPerRow, maxRowCount),
    [maxRowCount, notes, notesPerRow]
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
      const renderedScale = containerWidth / displayWidth;
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
      rows.forEach((rowNotes, rowIndex) => {
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
        const rowSlots = Array.from({ length: notesPerRow }, (_, slotIndex) => rowNotes[slotIndex]);
        const vexDuration = getVexNoteDuration(noteDuration);
        const rowDurations = rowSlots.map(
          (_, slotIndex) => noteDurations?.[rowStartIndex + slotIndex] ?? noteDuration
        );
        const beamOptions =
          noteDurations && noteMeasures && noteOnsets
            ? {
                barlineAfterNoteIndices,
                breakBeamsAtStaffChange,
                measures: rowSlots.map((_, slotIndex) => noteMeasures[rowStartIndex + slotIndex]),
                noteDurations: rowDurations,
                noteOnsets: rowSlots.map((_, slotIndex) => noteOnsets[rowStartIndex + slotIndex]),
                rowStartIndex,
              }
            : undefined;
        const voiceOptions = {
          beatValue: 4,
          numBeats: rowDurations.reduce(
            (total, duration) => total + quarterBeatsForDuration(duration),
            0
          ),
        };
        let beams: Beam[];
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
          const tickables = rowSlots.map((note, slotIndex) => {
            if (!note) {
              return new GhostNote(vexDuration).setStave(treble);
            }
            return makeStaveNote(
              note,
              colorForIndex(
                rowStartIndex + slotIndex,
                completedCountRef.current,
                wrongIndexRef.current,
                palette
              ),
              rowDurations[slotIndex]
            ).setStave(note.staff === "treble" ? treble : bass);
          });
          const voice = new Voice(voiceOptions).addTickables(tickables);
          treble.setNoteStartX(noteArea.left);
          bass.setNoteStartX(noteArea.left);
          treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          beams = makeStaffPageBeams(
            rowSlots,
            tickables,
            noteDuration,
            visibleYBounds,
            palette.ink,
            beamOptions
          );
          const formatter = new Formatter().joinVoices([voice]);
          formatter.format(
            [voice],
            treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding,
            { context }
          );
          formatter.postFormat();
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowNotes.length, distributionArea);
          }
          voice.draw(context);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined
          );
          barlineTopY = treble.getYForLine(0);
          barlineBottomY = bass.getYForLine(4);
          lyricAnchorY = treble.getYForLine(4);
        } else {
          const { stave } = system;
          const tickables = rowSlots.map((note, slotIndex) =>
            note
              ? makeStaveNote(
                  note,
                  colorForIndex(
                    rowStartIndex + slotIndex,
                    completedCountRef.current,
                    wrongIndexRef.current,
                    palette
                  ),
                  rowDurations[slotIndex]
                ).setStave(stave)
              : new GhostNote(vexDuration).setStave(stave)
          );
          const voice = new Voice(voiceOptions).addTickables(tickables);
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
          new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
          if (distributeNotesEvenly) {
            alignRowNotesEvenly(tickables, rowNotes.length, distributionArea);
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
            color: colorForIndex(index, completedCountRef.current, wrongIndexRef.current, palette),
            element,
          };
        });

        beams.forEach((beam) => beam.setContext(context).drawWithStyle());

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
          .filter((boundaryIndex) => boundaryIndex > 0 && boundaryIndex <= rowNotes.length);
        const barlineBoundaries =
          explicitBarlineBoundaries ??
          Array.from(
            { length: Math.floor(Math.min(rowNotes.length, notesPerRow - 1) / barlineInterval) },
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
    barlineAfterNoteIndices,
    isNightMode,
    lyrics,
    noteMeasures,
    noteOnsets,
    minDisplayWidthPx,
    distributeNotesEvenly,
    noteDuration,
    noteDurations,
    notesPerRow,
    palette,
    rows,
    scrollDurationMs,
    staffNotationMode,
    breakBeamsAtStaffChange,
    useLedgerGap,
    visibleRowCount,
  ]);

  useLayoutEffect(() => {
    const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorStarted");
    renderedNotesRef.current.forEach((renderedNote, index) => {
      if (renderedNote) {
        updateRenderedNoteColor(
          renderedNote,
          colorForIndex(index, completedCount, wrongIndex, palette)
        );
      }
    });
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorEnded");
  }, [completedCount, isNightMode, palette, wrongIndex]);

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
