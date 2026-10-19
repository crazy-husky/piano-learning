import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eye } from "lucide-react";
import { Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../../../domain/notes";
import { staffForSingleClefMode } from "../../../domain/staffNotation";
import {
  compareTargetNotePitch,
  formatStaffRecallDeltaMs,
  type NoteNameColumn,
} from "../../../domain/staffRecall";
import type {
  NoteName,
  Staff,
  StaffNotationMode,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import { STAFF_RECALL_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";
import { FIXED_DO_SOLFEGE } from "../../../shared/staff/fixedDoSolfege";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getResponsiveStaffFrame,
  logicalPx,
} from "../../../shared/staff/staffGeometry";

export interface StaffRecallColumnState {
  activeMs?: number;
  correctNoteIds: TargetNoteId[];
  wrongNoteId?: TargetNoteId;
}

interface StaffRecallMapProps {
  activeNoteName?: NoteName;
  answerDisabled?: boolean;
  columnStates: Record<NoteName, StaffRecallColumnState>;
  columns: NoteNameColumn[];
  comparisonMedianMsByNoteName: Record<NoteName, number | undefined>;
  inputNotes: TargetNote[];
  onColumnSelect: (columnNoteName: NoteName) => void;
  onPlacement: (columnNoteName: NoteName, note: TargetNote) => void;
  onRevealAnswer?: () => void;
  revealedNoteName?: NoteName;
  runCompleted: boolean;
  staffNotationMode: StaffNotationMode;
}

interface PlacementGeometry {
  note: TargetNote;
  y: number;
}

interface ColumnGeometry {
  centerX: number;
  left: number;
  noteName: NoteName;
  placements: PlacementGeometry[];
  right: number;
}

interface MapGeometry {
  columns: ColumnGeometry[];
  height: number;
  placementHitRadius: number;
  width: number;
  x: number;
  y: number;
}

const NOTE_DURATION = "w";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const CORRECT_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const HOVER_COLOR = "rgba(37, 111, 103, 0.42)";
interface StaffRecallPalette {
  answer: string;
  correct: string;
  hover: string;
  ink: string;
  muted: string;
  wrong: string;
}
function getStatusLineY(lineIndex: 0 | 1 | 2, firstLineY: number, scale: number): number {
  return firstLineY + logicalPx(lineIndex * STAFF_RECALL_LAYOUT.status.lineGapPx, scale);
}

function makeChord(notes: readonly TargetNote[], staff: Staff, noteColor: string): StaveNote {
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map(noteToVexKey) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const resolvedNoteColor = hasNotes ? noteColor : TRANSPARENT;
  chord.setStyle({ fillStyle: resolvedNoteColor, strokeStyle: resolvedNoteColor });
  chord.setLedgerLineStyle({ fillStyle: resolvedNoteColor, strokeStyle: resolvedNoteColor });
  return chord;
}

function formatAndDrawLayer({
  bass,
  bassTickables,
  centers,
  context,
  noteAreaLeft,
  noteAreaRight,
  treble,
  trebleTickables,
}: {
  bass: Stave;
  bassTickables: StaveNote[];
  centers: readonly number[];
  context: ReturnType<Renderer["getContext"]>;
  noteAreaLeft: number;
  noteAreaRight: number;
  treble: Stave;
  trebleTickables: StaveNote[];
}): void {
  trebleTickables.forEach((tickable) => tickable.setStave(treble));
  bassTickables.forEach((tickable) => tickable.setStave(bass));
  const voiceOptions = { beatValue: 4, numBeats: Math.max(1, trebleTickables.length) * 4 };
  const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
  const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
  new Formatter()
    .joinVoices([trebleVoice, bassVoice])
    .format([trebleVoice, bassVoice], Math.max(1, noteAreaRight - noteAreaLeft), { context });
  alignStaveNotesToCenters(trebleTickables, centers);
  trebleVoice.draw(context, treble);
  bassVoice.draw(context, bass);
}

function formatAndDrawSingleLayer({
  centers,
  context,
  noteAreaLeft,
  noteAreaRight,
  stave,
  tickables,
}: {
  centers: readonly number[];
  context: ReturnType<Renderer["getContext"]>;
  noteAreaLeft: number;
  noteAreaRight: number;
  stave: Stave;
  tickables: StaveNote[];
}): void {
  tickables.forEach((tickable) => tickable.setStave(stave));
  const voice = new Voice({
    beatValue: 4,
    numBeats: Math.max(1, tickables.length) * 4,
  }).addTickables(tickables);
  new Formatter()
    .joinVoices([voice])
    .format([voice], Math.max(1, noteAreaRight - noteAreaLeft), { context });
  alignStaveNotesToCenters(tickables, centers);
  voice.draw(context, stave);
}

function drawCenteredText(
  context: ReturnType<Renderer["getContext"]>,
  text: string,
  x: number,
  y: number
): void {
  const { width } = context.measureText(text);
  context.fillText(text, x - width / 2, y);
}

function getColumnBounds(
  centers: readonly number[],
  index: number,
  width: number
): { left: number; right: number } {
  const center = centers[index];
  const previousCenter = centers[index - 1];
  const nextCenter = centers[index + 1];
  const left =
    previousCenter === undefined
      ? center - ((nextCenter ?? center) - center) / 2
      : (previousCenter + center) / 2;
  const right =
    nextCenter === undefined
      ? center + (center - (previousCenter ?? center)) / 2
      : (center + nextCenter) / 2;
  return {
    left: Math.max(0, left),
    right: Math.min(width, right),
  };
}

function getNoteLine(note: TargetNote): number {
  return new StaveNote({
    clef: note.staff,
    duration: NOTE_DURATION,
    keys: [noteToVexKey(note)],
  }).getLineNumber();
}

function getPlacements(notes: readonly TargetNote[], stave: Stave): PlacementGeometry[] {
  return notes.map((note) => ({
    note,
    y: stave.getYForNote(getNoteLine(note)),
  }));
}

function getLedgerLines(notes: readonly TargetNote[]): number[] {
  if (notes.length === 0) {
    return [];
  }
  const noteLines = notes.map(getNoteLine);
  const lowestLine = Math.min(...noteLines);
  const highestLine = Math.max(...noteLines);
  const ledgerLines: number[] = [];
  for (let line = 0; line >= lowestLine; line -= 1) {
    ledgerLines.push(line);
  }
  for (let line = 6; line <= highestLine; line += 1) {
    ledgerLines.push(line);
  }
  return ledgerLines;
}

function addLedgerGuides(
  parent: SVGElement,
  centers: readonly number[],
  notes: readonly TargetNote[],
  stave: Stave,
  scale: number
): void {
  const ledgerLines = getLedgerLines(notes);
  centers.forEach((centerX) => {
    ledgerLines.forEach((line) => {
      const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
      guide.setAttribute("class", "staff-recall-ledger-guide");
      const halfWidth = logicalPx(STAFF_RECALL_LAYOUT.ledgerGuideHalfWidthPx, scale);
      guide.setAttribute("x1", String(centerX - halfWidth));
      guide.setAttribute("x2", String(centerX + halfWidth));
      guide.setAttribute("y1", String(stave.getYForNote(line)));
      guide.setAttribute("y2", String(stave.getYForNote(line)));
      parent.appendChild(guide);
    });
  });
}

function addStatusText({
  active,
  centerX,
  comparisonMedianMs,
  parent,
  scale,
  firstLineY,
  state,
}: {
  active: boolean;
  centerX: number;
  comparisonMedianMs?: number;
  parent: SVGElement;
  scale: number;
  firstLineY: number;
  state: StaffRecallColumnState;
}): void {
  const status = document.createElementNS("http://www.w3.org/2000/svg", "text");
  status.setAttribute("class", "staff-recall-column-status");
  status.setAttribute("x", String(centerX));
  status.setAttribute("text-anchor", "middle");

  const addLine = (text: string, lineIndex: 0 | 1 | 2, className?: string, offsetY = 0): void => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    line.setAttribute("x", String(centerX));
    line.setAttribute("y", String(getStatusLineY(lineIndex, firstLineY, scale) + offsetY));
    if (className) {
      line.setAttribute("class", className);
    }
    line.textContent = text;
    status.appendChild(line);
  };

  if (state.activeMs !== undefined) {
    addLine("用时", 0, "status-label");
    addLine(formatRecallSeconds(state.activeMs), 1, "status-value");
    if (comparisonMedianMs !== undefined) {
      const delta = formatStaffRecallDeltaMs(state.activeMs - comparisonMedianMs);
      if (delta) {
        addLine(delta.text, 2, delta.direction);
      }
    }
  } else if (active) {
    addLine("计时中", 0, "status-value", logicalPx(6, scale));
  } else if (comparisonMedianMs !== undefined) {
    addLine("中位", 0, "status-label");
    addLine(formatRecallSeconds(comparisonMedianMs), 1, "status-value");
  }
  parent.appendChild(status);
}

function formatRecallSeconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}秒`;
}

function getRecallLabelClearanceOffset(
  notes: readonly TargetNote[],
  staff: Staff,
  scale: number
): number {
  const staffTopY = logicalPx(
    staff === "treble"
      ? STAFF_RECALL_LAYOUT.vertical.trebleOnlyYPx
      : STAFF_RECALL_LAYOUT.vertical.bassOnlyYPx,
    scale
  );
  const stave = new Stave(0, staffTopY, 100).addClef(staff);
  const highestNoteY = Math.min(
    ...notes.map((note) => {
      const noteHead = new StaveNote({
        clef: staff,
        duration: NOTE_DURATION,
        keys: [noteToVexKey(note)],
      });
      return stave.getYForNote(noteHead.getLineNumber());
    })
  );
  const labelsBottomY = logicalPx(
    STAFF_RECALL_LAYOUT.labels.noteNameYPx +
      STAFF_RECALL_LAYOUT.labels.lineGapPx * 2 +
      STAFF_RECALL_LAYOUT.labels.fixedDoNumberFontSizePx * 0.4,
    scale
  );
  const noteGap = logicalPx(12, scale);
  return Number.isFinite(highestNoteY) ? Math.max(0, labelsBottomY + noteGap - highestNoteY) : 0;
}

function fitStaffRecallSurfaceHeight(
  rendererTarget: HTMLDivElement,
  surface: ReturnType<typeof createStaffRenderSurface>,
  contentHeight: number
): number {
  const logicalHeight = contentHeight / surface.scale;
  const viewBox = surface.svg.viewBox.baseVal;
  surface.svg.setAttribute("viewBox", `0 0 ${viewBox.width} ${logicalHeight}`);
  surface.svg.setAttribute("height", String(contentHeight));
  rendererTarget.style.height = `${contentHeight}px`;
  return logicalHeight;
}

function addStaffRecallRightBorder(
  svg: SVGSVGElement,
  topStave: Stave,
  bottomStave: Stave,
  rightEdgeX: number,
  stroke: string
): void {
  const border = document.createElementNS("http://www.w3.org/2000/svg", "line");
  border.setAttribute("aria-hidden", "true");
  border.setAttribute("class", "staff-recall-grand-staff-right-border");
  border.setAttribute("x1", String(rightEdgeX));
  border.setAttribute("x2", String(rightEdgeX));
  border.setAttribute("y1", String(topStave.getYForLine(0)));
  border.setAttribute("y2", String(bottomStave.getYForLine(4)));
  border.setAttribute("stroke", stroke);
  border.setAttribute("stroke-width", "1.25");
  border.setAttribute("vector-effect", "non-scaling-stroke");
  border.setAttribute("pointer-events", "none");
  svg.appendChild(border);
}

function noteById(
  notes: readonly TargetNote[],
  noteId: TargetNoteId | undefined
): TargetNote | undefined {
  return noteId ? notes.find((note) => note.id === noteId) : undefined;
}

function isColumnMasked(
  noteName: NoteName,
  state: StaffRecallColumnState,
  activeNoteName: NoteName | undefined,
  runCompleted: boolean
): boolean {
  if (runCompleted) {
    return false;
  }
  if (activeNoteName) {
    return noteName !== activeNoteName;
  }
  return state.activeMs !== undefined;
}

export function StaffRecallMap({
  activeNoteName,
  answerDisabled = false,
  columnStates,
  columns,
  comparisonMedianMsByNoteName,
  inputNotes,
  onColumnSelect,
  onPlacement,
  onRevealAnswer,
  revealedNoteName,
  runCompleted,
  staffNotationMode,
}: StaffRecallMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const answerButtonRef = useRef<HTMLButtonElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<MapGeometry | null>(null);
  const activePointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<{
    columnNoteName: NoteName;
    targetNoteId: TargetNoteId;
  } | null>(null);
  const isNightMode = useNightMode();
  const palette = useMemo<StaffRecallPalette>(
    () => ({
      answer: isNightMode ? "#5cc8ff" : "#1769aa",
      correct: isNightMode ? "#78c994" : CORRECT_COLOR,
      hover: isNightMode ? "rgba(128, 203, 180, 0.42)" : HOVER_COLOR,
      ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
      muted: isNightMode ? "#b2beb5" : MUTED_COLOR,
      wrong: isNightMode ? "#f18476" : WRONG_COLOR,
    }),
    [isNightMode]
  );

  useEffect(() => {
    const frame = frameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!frame || !rendererTarget) {
      return;
    }

    function render(): void {
      if (!frame || !rendererTarget) {
        return;
      }
      const displayWidth = Math.max(
        1,
        Math.floor(frame.clientWidth || frame.parentElement?.clientWidth || 1)
      );
      const displayHeight = STAFF_RECALL_LAYOUT.vertical.viewHeightPx;
      // 重画时沿用当前高度，避免 SVG 清空或重绘导致页面滚动锚定跳动。
      rendererTarget.style.height ||= `${displayHeight}px`;
      rendererTarget.innerHTML = "";
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        displayHeight,
        STAFF_RECALL_LAYOUT.notationScale
      );
      const { context, svg } = surface;
      frame.style.setProperty(
        "--staff-recall-status-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.fontSizePx, surface.scale)}px`
      );
      frame.style.setProperty(
        "--staff-recall-status-label-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.labelFontSizePx, surface.scale)}px`
      );
      frame.style.setProperty(
        "--staff-recall-status-value-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.valueFontSizePx, surface.scale)}px`
      );
      const frameMetrics = getResponsiveStaffFrame(
        surface,
        columns.length,
        STAFF_RECALL_LAYOUT.horizontal
      );
      const includeInterStaffLedgerSpellings =
        staffNotationMode === "grand" && inputNotes.some((note) => note.isInterStaffLedgerSpelling);
      const labelClearanceOffset =
        staffNotationMode === "grand"
          ? 0
          : getRecallLabelClearanceOffset(
              inputNotes,
              staffForSingleClefMode(staffNotationMode),
              surface.scale
            );
      const trebleInputNotes = inputNotes
        .filter((note) => note.staff === "treble")
        .sort(compareTargetNotePitch);
      const bassInputNotes = inputNotes
        .filter((note) => note.staff === "bass")
        .sort(compareTargetNotePitch);
      const system = drawStaffSystem({
        brace: true,
        columnCount: columns.length,
        context,
        frame: frameMetrics,
        horizontal: STAFF_RECALL_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        showGrandStaffRightConnector: false,
        showSingleStaffRightBarline: false,
        useLedgerGap: includeInterStaffLedgerSpellings,
        vertical: STAFF_RECALL_LAYOUT.vertical,
        yOffset: labelClearanceOffset,
      });
      const { noteArea } = system;
      const treble = system.mode === "grand" ? system.treble : undefined;
      const bass = system.mode === "grand" ? system.bass : undefined;
      const singleStave = system.mode === "grand" ? undefined : system.stave;
      const singleStaff = system.mode === "grand" ? undefined : system.staff;
      const centers = getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right);
      if (treble && bass) {
        addLedgerGuides(svg, centers, trebleInputNotes, treble, surface.scale);
        addLedgerGuides(svg, centers, bassInputNotes, bass, surface.scale);
      } else if (singleStave) {
        addLedgerGuides(svg, centers, inputNotes, singleStave, surface.scale);
      }

      const drawLayer = (
        notesForColumn: (column: NoteNameColumn, staff: Staff) => TargetNote[],
        color: string
      ): void => {
        if (treble && bass) {
          formatAndDrawLayer({
            bass,
            bassTickables: columns.map((column) =>
              makeChord(notesForColumn(column, "bass"), "bass", color)
            ),
            centers,
            context,
            noteAreaLeft: noteArea.left,
            noteAreaRight: noteArea.right,
            treble,
            trebleTickables: columns.map((column) =>
              makeChord(notesForColumn(column, "treble"), "treble", color)
            ),
          });
          return;
        }
        if (!singleStave || !singleStaff) {
          return;
        }
        formatAndDrawSingleLayer({
          centers,
          context,
          noteAreaLeft: noteArea.left,
          noteAreaRight: noteArea.right,
          stave: singleStave,
          tickables: columns.map((column) =>
            makeChord(notesForColumn(column, singleStaff), singleStaff, color)
          ),
        });
      };

      const isRevealedAnswerPitch = (column: NoteNameColumn, note: TargetNote): boolean =>
        column.noteName === revealedNoteName &&
        column.notes.some(
          (answerNote) => answerNote.staff === note.staff && answerNote.pitchId === note.pitchId
        );

      const correctNotesForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        const correctIds = new Set(columnStates[column.noteName].correctNoteIds);
        return column.notes.filter(
          (note) =>
            note.staff === staff && correctIds.has(note.id) && !isRevealedAnswerPitch(column, note)
        );
      };
      drawLayer(correctNotesForColumn, palette.correct);

      const wrongNoteForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        const note = noteById(inputNotes, columnStates[column.noteName].wrongNoteId);
        return note?.staff === staff && !isRevealedAnswerPitch(column, note) ? [note] : [];
      };
      drawLayer(wrongNoteForColumn, palette.wrong);

      const hoverNoteForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        if (hovered?.columnNoteName !== column.noteName) {
          return [];
        }
        const note = noteById(inputNotes, hovered.targetNoteId);
        if (
          !note ||
          note.staff !== staff ||
          columnStates[column.noteName].correctNoteIds.includes(note.id) ||
          isRevealedAnswerPitch(column, note)
        ) {
          return [];
        }
        return [note];
      };
      drawLayer(hoverNoteForColumn, palette.hover);

      if (revealedNoteName) {
        context.openGroup("staff-recall-answer-reveal");
        drawLayer(
          (column, staff) =>
            column.noteName === revealedNoteName
              ? column.notes.filter((note) => note.staff === staff)
              : [],
          palette.answer
        );
        context.closeGroup();
      }

      const topStaff = system.mode === "grand" ? system.treble : system.stave;
      const bottomStaff = system.mode === "grand" ? system.bass : system.stave;
      addStaffRecallRightBorder(
        svg,
        topStaff,
        bottomStaff,
        frameMetrics.x + frameMetrics.staveWidth - logicalPx(0.75, surface.scale),
        getPageThemeColor("--notation-staff", "#766b5f")
      );

      const placements = [
        ...(treble ? getPlacements(trebleInputNotes, treble) : []),
        ...(bass ? getPlacements(bassInputNotes, bass) : []),
        ...(singleStave ? getPlacements(inputNotes, singleStave) : []),
      ];
      const scoreBottomY = Math.max(
        (system.mode === "grand" ? system.bass : system.stave).getBottomLineY(),
        ...placements.map((placement) => placement.y + logicalPx(8, surface.scale))
      );
      const scoreTopY = Math.min(
        (system.mode === "grand" ? system.treble : system.stave).getYForLine(0),
        ...placements.map((placement) => placement.y - logicalPx(8, surface.scale))
      );
      const overlayPadding = logicalPx(STAFF_RECALL_LAYOUT.overlay.staffPaddingPx, surface.scale);
      const overlayTopY = scoreTopY - overlayPadding;
      const overlayHeight = scoreBottomY - scoreTopY + 2 * overlayPadding;
      const statusFirstLineY = scoreBottomY + logicalPx(30, surface.scale);
      const columnGeometry = columns.map((column, index): ColumnGeometry => {
        const { left, right } = getColumnBounds(centers, index, surface.width);
        return {
          centerX: centers[index],
          left,
          noteName: column.noteName,
          placements,
          right,
        };
      });
      columnGeometry.forEach((geometry, index) => {
        const column = columns[index];
        const state = columnStates[column.noteName];
        const masked = isColumnMasked(column.noteName, state, activeNoteName, runCompleted);
        if (masked) {
          const mask = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          mask.setAttribute("class", "staff-recall-column-mask");
          mask.setAttribute("x", String(geometry.left));
          mask.setAttribute("y", String(overlayTopY));
          mask.setAttribute("width", String(Math.max(1, geometry.right - geometry.left)));
          mask.setAttribute("height", String(overlayHeight));
          svg.appendChild(mask);
        } else if (activeNoteName === column.noteName) {
          const activeColumn = columns[index];
          const activeStaves =
            system.mode === "grand"
              ? [
                  { notes: activeColumn.trebleNotes, stave: system.treble },
                  { notes: activeColumn.bassNotes, stave: system.bass },
                ]
              : [{ notes: activeColumn.notes, stave: system.stave }];
          activeStaves.forEach(({ notes, stave }) => {
            if (notes.length === 0) {
              return;
            }
            const activePlacements = placements.filter((placement) =>
              notes.some((note) => note.id === placement.note.id)
            );
            const activeTopY = Math.min(
              stave.getYForLine(0),
              ...activePlacements.map((placement) => placement.y - logicalPx(8, surface.scale))
            );
            const activeBottomY = Math.max(
              stave.getBottomLineY(),
              ...activePlacements.map((placement) => placement.y + logicalPx(8, surface.scale))
            );
            const active = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            active.setAttribute("class", "staff-recall-column-active");
            active.setAttribute("x", String(geometry.left + 4));
            active.setAttribute("y", String(activeTopY));
            active.setAttribute("width", String(Math.max(1, geometry.right - geometry.left - 8)));
            active.setAttribute("height", String(activeBottomY - activeTopY));
            active.setAttribute("rx", "8");
            svg.insertBefore(active, svg.firstChild);
          });
        }
      });

      const uiGroup = context.openGroup("staff-recall-ui");
      columnGeometry.forEach((geometry, index) => {
        const column = columns[index];
        const state = columnStates[column.noteName];
        addStatusText({
          active: activeNoteName === column.noteName,
          centerX: geometry.centerX,
          comparisonMedianMs: comparisonMedianMsByNoteName[column.noteName],
          parent: uiGroup,
          scale: surface.scale,
          firstLineY: statusFirstLineY,
          state,
        });
      });
      context
        .setFont(
          "FredokaSystemDigits, Inter",
          logicalPx(STAFF_RECALL_LAYOUT.labels.noteNameFontSizePx, surface.scale),
          800
        )
        .setFillStyle(palette.ink);
      columnGeometry.forEach((geometry) => {
        drawCenteredText(
          context,
          geometry.noteName,
          geometry.centerX,
          logicalPx(STAFF_RECALL_LAYOUT.labels.noteNameYPx, surface.scale)
        );
      });
      context
        .setFont(
          "FredokaSystemDigits, Inter",
          logicalPx(
            STAFF_RECALL_LAYOUT.labels.solfegeFontSizePx ??
              STAFF_RECALL_LAYOUT.labels.fixedDoNumberFontSizePx,
            surface.scale
          ),
          700
        )
        .setFillStyle(palette.muted);
      columnGeometry.forEach((geometry, index) => {
        drawCenteredText(
          context,
          FIXED_DO_SOLFEGE[columns[index].noteName],
          geometry.centerX,
          logicalPx(
            STAFF_RECALL_LAYOUT.labels.noteNameYPx + STAFF_RECALL_LAYOUT.labels.lineGapPx,
            surface.scale
          )
        );
      });
      context
        .setFont(
          "FredokaSystemDigits, Inter",
          logicalPx(STAFF_RECALL_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale),
          700
        )
        .setFillStyle(palette.muted);
      columnGeometry.forEach((geometry, index) => {
        drawCenteredText(
          context,
          columns[index].answerNumber,
          geometry.centerX,
          logicalPx(
            STAFF_RECALL_LAYOUT.labels.noteNameYPx + STAFF_RECALL_LAYOUT.labels.lineGapPx * 2,
            surface.scale
          )
        );
      });
      context.closeGroup();

      const statusHeight =
        2 * logicalPx(STAFF_RECALL_LAYOUT.status.lineGapPx, surface.scale) +
        logicalPx(STAFF_RECALL_LAYOUT.status.valueFontSizePx + 12, surface.scale);
      const contentHeight = Math.ceil((statusFirstLineY + statusHeight) * surface.scale);
      const fittedSurfaceHeight = fitStaffRecallSurfaceHeight(
        rendererTarget,
        surface,
        contentHeight
      );

      geometryRef.current = {
        columns: columnGeometry,
        height: fittedSurfaceHeight,
        placementHitRadius:
          ((treble ?? singleStave)?.getSpacingBetweenLines() ?? 0) *
          STAFF_RECALL_LAYOUT.placementHitRadiusInStaffSpaces,
        width: surface.width,
        x: 0,
        y: 0,
      };
      const answerColumn = columnGeometry.find((column) => column.noteName === activeNoteName);
      if (answerButtonRef.current && answerColumn) {
        answerButtonRef.current.style.left = `${(answerColumn.centerX / surface.width) * 100}%`;
      }
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    activeNoteName,
    columnStates,
    columns,
    comparisonMedianMsByNoteName,
    hovered,
    inputNotes,
    palette,
    revealedNoteName,
    runCompleted,
    staffNotationMode,
  ]);

  const hitTest = useCallback(
    (
      clientX: number,
      clientY: number,
      includeInactiveColumns = false
    ): { columnNoteName: NoteName; note: TargetNote } | null => {
      const rendererTarget = rendererTargetRef.current;
      const geometry = geometryRef.current;
      const svg = rendererTarget?.querySelector("svg");
      if (!geometry || !svg) {
        return null;
      }
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
      }
      const x = geometry.x + ((clientX - bounds.left) / bounds.width) * geometry.width;
      const y = geometry.y + ((clientY - bounds.top) / bounds.height) * geometry.height;
      const column = geometry.columns.find(
        (candidate) => x >= candidate.left && x <= candidate.right
      );
      if (!column) {
        return null;
      }
      const state = columnStates[column.noteName];
      if (
        (!includeInactiveColumns &&
          isColumnMasked(column.noteName, state, activeNoteName, runCompleted)) ||
        runCompleted
      ) {
        return null;
      }
      const nearest = column.placements.reduce<
        { distance: number; placement: PlacementGeometry } | undefined
      >((best, placement) => {
        const distance = Math.abs(placement.y - y);
        return !best || distance < best.distance ? { distance, placement } : best;
      }, undefined);
      if (!nearest || nearest.distance > geometry.placementHitRadius) {
        return null;
      }
      return { columnNoteName: column.noteName, note: nearest.placement.note };
    },
    [activeNoteName, columnStates, runCompleted]
  );

  const getColumnAtX = useCallback(
    (clientX: number): NoteName | undefined => {
      if (runCompleted) {
        return undefined;
      }
      const geometry = geometryRef.current;
      const svg = rendererTargetRef.current?.querySelector("svg");
      const bounds = svg?.getBoundingClientRect();
      if (!geometry || !bounds || bounds.width <= 0) {
        return undefined;
      }
      const x = geometry.x + ((clientX - bounds.left) / bounds.width) * geometry.width;
      const columnNoteName = geometry.columns.find(
        (column) => x >= column.left && x <= column.right
      )?.noteName;
      return columns.some((column) => column.noteName === columnNoteName && column.notes.length > 0)
        ? columnNoteName
        : undefined;
    },
    [columns, runCompleted]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.pointerType === "touch") {
        setHovered((current) => (current === null ? current : null));
        return;
      }
      const hit = hitTest(event.clientX, event.clientY);
      setHovered((current) => {
        if (!hit) {
          return current === null ? current : null;
        }
        if (
          current?.columnNoteName === hit.columnNoteName &&
          current.targetNoteId === hit.note.id
        ) {
          return current;
        }
        return { columnNoteName: hit.columnNoteName, targetNoteId: hit.note.id };
      });
    },
    [hitTest]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const start = activePointerRef.current;
      activePointerRef.current = null;
      if (
        !start ||
        start.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
      ) {
        return;
      }

      const hit = hitTest(event.clientX, event.clientY);
      if (hit) {
        onPlacement(hit.columnNoteName, hit.note);
        return;
      }

      const columnNoteName = getColumnAtX(event.clientX);
      if (columnNoteName && columnNoteName !== activeNoteName) {
        const inactiveColumnHit = hitTest(event.clientX, event.clientY, true);
        if (inactiveColumnHit?.columnNoteName === columnNoteName) {
          onPlacement(inactiveColumnHit.columnNoteName, inactiveColumnHit.note);
        } else {
          onColumnSelect(columnNoteName);
        }
      }
    },
    [activeNoteName, getColumnAtX, hitTest, onColumnSelect, onPlacement]
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      activePointerRef.current = null;
      return;
    }
    activePointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const clearActivePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerRef.current?.pointerId === event.pointerId) {
      activePointerRef.current = null;
    }
  }, []);

  return (
    <div className="staff-recall-scroll">
      <div
        aria-label={staffNotationMode === "grand" ? "默写大谱表" : "默写单谱表"}
        className={
          onRevealAnswer
            ? "staff-recall-map staff-recall-map--with-answer-action"
            : "staff-recall-map"
        }
        onPointerCancel={clearActivePointer}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          activePointerRef.current = null;
          setHovered(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={frameRef}
      >
        <div className="staff-recall-map-renderer" ref={rendererTargetRef} />
        {activeNoteName && onRevealAnswer ? (
          <button
            aria-label={`查看 ${activeNoteName} 列答案`}
            className="staff-recall-answer-button staff-recall-answer-button--column"
            disabled={answerDisabled}
            onClick={(event) => {
              event.stopPropagation();
              onRevealAnswer();
            }}
            onPointerUp={(event) => event.stopPropagation()}
            ref={answerButtonRef}
            title="让本列答案闪烁高亮约 2 秒"
            type="button"
          >
            <Eye aria-hidden="true" size={16} />
            查看答案
          </button>
        ) : null}
      </div>
    </div>
  );
}
