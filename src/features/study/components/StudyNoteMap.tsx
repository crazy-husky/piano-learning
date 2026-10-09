import { useEffect, useMemo, useRef } from "react";
import { Formatter, Renderer, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../../../domain/notes";
import type { NoteName, Staff, StaffNotationMode, TargetNote } from "../../../domain/types";
import type { NoteNameColumn } from "../../../domain/staffRecall";
import { STUDY_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getResponsiveStaffFrame,
  logicalPx,
  staveNoteCenterX,
  type StaffRenderSurface,
} from "../../../shared/staff/staffGeometry";
import { useNightMode } from "../../../shared/appearance/pageAppearance";

const NOTE_DURATION = "w";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const ACTIVE_COLOR = "#2f8f5f";
const ACTIVE_FILL = "rgba(47, 143, 95, 0.16)";
const TRANSPARENT_NOTE_COLOR = "rgba(0, 0, 0, 0)";
const MOBILE_STUDY_STAFF_VERTICAL = {
  centerYPx: 160,
  gapPx: 110,
  ledgerGapPx: 180,
  trebleOnlyYPx: 160,
  bassOnlyYPx: 160,
  viewHeightPx: 460,
} as const;

interface StudyNoteMapProps {
  columns: NoteNameColumn[];
  highlightedNoteId?: string;
  highlightedNoteNames?: ReadonlySet<NoteName>;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  label: string;
  onPlayColumn: (noteName: NoteName) => void;
  onPlayNote: (note: TargetNote) => void;
  showLabels: boolean;
}

interface StudyNotationColors {
  active: string;
  activeFill: string;
  ink: string;
  muted: string;
}

interface StudyMapMetrics {
  fixedDoNumberY: number;
  height: number;
  labelHitHeight: number;
  labelHitTop: number;
  staveWidth: number;
  noteNameY: number;
  width: number;
  x: number;
}

interface StudyColumnLayout {
  centerX: number;
  highlightWidth: number;
}

function makeChord(
  notes: TargetNote[],
  staff: Staff,
  highlightedNoteNames: ReadonlySet<NoteName> | undefined,
  highlightedNoteId: string | undefined,
  colors: StudyNotationColors,
): StaveNote {
  const columnHighlighted = notes.some((note) => highlightedNoteNames?.has(note.noteName) ?? false);
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map(noteToVexKey) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const baseColor = hasNotes ? (columnHighlighted ? colors.active : colors.ink) : TRANSPARENT_NOTE_COLOR;
  chord.setStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  chord.setLedgerLineStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  if (hasNotes && !columnHighlighted && highlightedNoteId) {
    notes.forEach((note, index) => {
      if (note.id === highlightedNoteId) {
        chord.setKeyStyle(index, { fillStyle: colors.active, strokeStyle: colors.active });
      }
    });
  }
  return chord;
}

function drawCenteredText(context: ReturnType<Renderer["getContext"]>, text: string, x: number, y: number): void {
  const { width } = context.measureText(text);
  context.fillText(text, x - width / 2, y);
}

function noteHeadCenterX(chord: StaveNote, index: number): number {
  const noteHead = chord.noteHeads[index];
  return noteHead ? noteHead.getAbsoluteX() + noteHead.getWidth() / 2 : staveNoteCenterX(chord);
}

function noteHeadHitRadius(chord: StaveNote, index: number): number {
  return chord.noteHeads[index]?.getWidth() ?? chord.getGlyphWidth();
}

function getStudyMapMetrics(
  surface: StaffRenderSurface,
  columnCount: number,
): StudyMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STUDY_STAFF_LAYOUT.horizontal);
  const noteNameY = logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameYPx, surface.scale);
  const fixedDoNumberY = noteNameY + logicalPx(STUDY_STAFF_LAYOUT.labels.lineGapPx, surface.scale);
  const labelHitTop = noteNameY - logicalPx(
    STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
    surface.scale,
  );
  return {
    fixedDoNumberY,
    height: surface.height,
    labelHitHeight:
      fixedDoNumberY -
      labelHitTop +
      logicalPx(
        STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
        surface.scale,
      ),
    labelHitTop,
    staveWidth: frame.staveWidth,
    noteNameY,
    width: surface.width,
    x: frame.x,
  };
}

function getStudyColumnLayouts(tickables: StaveNote[], scale: number): StudyColumnLayout[] {
  const centers = tickables.map(staveNoteCenterX);
  const spacingPadding = logicalPx(STUDY_STAFF_LAYOUT.columnHighlight.spacingPaddingPx, scale);
  const maxWidth = logicalPx(STUDY_STAFF_LAYOUT.columnHighlight.maxWidthPx, scale);
  return centers.map((centerX, index) => {
    const neighborDistances = [
      index > 0 ? centerX - centers[index - 1] : undefined,
      index < centers.length - 1 ? centers[index + 1] - centerX : undefined,
    ].filter((distance): distance is number => distance !== undefined);
    const spacingWidth =
      (neighborDistances.length > 0
        ? Math.min(...neighborDistances) - spacingPadding * 2
        : maxWidth);
    return {
      centerX,
      highlightWidth: Math.max(1, Math.min(maxWidth, spacingWidth)),
    };
  });
}

function addColumnHighlight(
  svg: SVGSVGElement,
  layout: StudyColumnLayout,
  metrics: StudyMapMetrics,
  colors: StudyNotationColors,
): void {
  const highlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  highlight.setAttribute("class", "study-column-highlight");
  highlight.setAttribute("x", String(layout.centerX - layout.highlightWidth / 2));
  highlight.setAttribute("y", String(metrics.labelHitTop));
  highlight.setAttribute("width", String(layout.highlightWidth));
  highlight.setAttribute(
    "height",
    String(
      metrics.height -
        metrics.labelHitTop -
        logicalPx(
          STUDY_STAFF_LAYOUT.columnHighlight.bottomPaddingPx,
          STUDY_STAFF_LAYOUT.notationScale,
        ),
    ),
  );
  highlight.setAttribute("rx", "8");
  highlight.setAttribute("fill", colors.activeFill);
  highlight.setAttribute("stroke", colors.active);
  highlight.setAttribute("stroke-width", "1");
  svg.insertBefore(highlight, svg.firstChild);
}

function addLabelHotspot({
  layout,
  metrics,
  noteName,
  onPlayColumn,
  svg,
}: {
  layout: StudyColumnLayout;
  metrics: StudyMapMetrics;
  noteName: NoteName;
  onPlayColumn: (noteName: NoteName) => void;
  svg: SVGSVGElement;
}): void {
  const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  hotspot.setAttribute("class", "study-label-hotspot");
  hotspot.setAttribute("x", String(layout.centerX - layout.highlightWidth / 2));
  hotspot.setAttribute("y", String(metrics.labelHitTop));
  hotspot.setAttribute("width", String(layout.highlightWidth));
  hotspot.setAttribute("height", String(metrics.labelHitHeight));
  hotspot.setAttribute("role", "button");
  hotspot.setAttribute("tabindex", "0");
  hotspot.setAttribute("aria-label", `播放 ${noteName} 列`);
  hotspot.addEventListener("click", (event) => {
    event.stopPropagation();
    onPlayColumn(noteName);
  });
  hotspot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPlayColumn(noteName);
    }
  });
  svg.appendChild(hotspot);
}

function addNoteHotspot({
  effectiveTargetNoteIds,
  note,
  onPlayNote,
  radius,
  showHitArea,
  svg,
  x,
  y,
}: {
  effectiveTargetNoteIds: ReadonlySet<TargetNote["id"]>;
  note: TargetNote;
  onPlayNote: (note: TargetNote) => void;
  radius: number;
  showHitArea: boolean;
  svg: SVGSVGElement;
  x: number;
  y: number;
}): void {
  const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hotspot.setAttribute("class", showHitArea ? "study-note-hotspot active" : "study-note-hotspot");
  hotspot.setAttribute("cx", String(x));
  hotspot.setAttribute("cy", String(y));
  hotspot.setAttribute("r", String(radius));
  hotspot.setAttribute("role", "button");
  hotspot.setAttribute("tabindex", "0");
  hotspot.setAttribute("aria-label", `播放 ${formatTargetNoteLabel(note, effectiveTargetNoteIds)}`);
  hotspot.addEventListener("click", (event) => {
    event.stopPropagation();
    onPlayNote(note);
  });
  hotspot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPlayNote(note);
    }
  });
  svg.appendChild(hotspot);
}

function addNoteHotspots({
  chord,
  effectiveTargetNoteIds,
  highlightedNoteId,
  notes,
  onPlayNote,
  svg,
}: {
  chord: StaveNote;
  effectiveTargetNoteIds: ReadonlySet<TargetNote["id"]>;
  highlightedNoteId?: string;
  notes: TargetNote[];
  onPlayNote: (note: TargetNote) => void;
  svg: SVGSVGElement;
}): void {
  const ys = chord.getYs();
  notes.forEach((note, index) => {
    const x = noteHeadCenterX(chord, index);
    const y = ys[index];
    if (y === undefined) {
      return;
    }
    addNoteHotspot({
      effectiveTargetNoteIds,
      note,
      onPlayNote,
      radius: noteHeadHitRadius(chord, index),
      showHitArea: note.id === highlightedNoteId,
      svg,
      x,
      y,
    });
  });
}

export function StudyNoteMap({
  columns,
  highlightedNoteId,
  highlightedNoteNames,
  staffNotationMode,
  label,
  onPlayColumn,
  onPlayNote,
  showLabels,
  useLedgerGap,
}: StudyNoteMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();
  const colors = useMemo<StudyNotationColors>(() => ({
    active: isNightMode ? "#80cbb4" : ACTIVE_COLOR,
    activeFill: isNightMode ? "rgba(128, 203, 180, 0.18)" : ACTIVE_FILL,
    ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
    muted: isNightMode ? "#b2beb5" : MUTED_COLOR,
  }), [isNightMode]);
  const effectiveTargetNoteIds = useMemo(
    () => new Set(columns.flatMap((column) => column.notes.map((note) => note.id))),
    [columns],
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

      rendererTarget.innerHTML = "";
      const measuredWidth = frame.getBoundingClientRect().width || frame.clientWidth || frame.parentElement?.clientWidth || 1;
      const containerWidth = Math.max(1, Math.floor(measuredWidth));
      const vertical = containerWidth < 520 ? MOBILE_STUDY_STAFF_VERTICAL : STUDY_STAFF_LAYOUT.vertical;
      const surface = createStaffRenderSurface(
        rendererTarget,
        containerWidth,
        vertical.viewHeightPx,
        STUDY_STAFF_LAYOUT.notationScale,
      );
      const metrics = getStudyMapMetrics(surface, columns.length);
      const { context, svg } = surface;
      const system = drawStaffSystem({
        brace: true,
        columnCount: columns.length,
        context,
        frame: { x: metrics.x, staveWidth: metrics.staveWidth },
        horizontal: STUDY_STAFF_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        useLedgerGap,
        vertical,
      });
      const { noteArea } = system;
      const trebleTickables: StaveNote[] = [];
      const bassTickables: StaveNote[] = [];
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      let layoutTickables: StaveNote[];
      if (system.mode === "grand") {
        const { bass, treble } = system;
        trebleTickables.push(...columns.map((column) =>
          makeChord(column.trebleNotes, "treble", highlightedNoteNames, highlightedNoteId, colors),
        ));
        bassTickables.push(...columns.map((column) =>
          makeChord(column.bassNotes, "bass", highlightedNoteNames, highlightedNoteId, colors),
        ));
        const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
        const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
        treble.setNoteStartX(noteArea.left);
        bass.setNoteStartX(noteArea.left);
        treble.setWidth(Math.max(1, noteArea.right - metrics.x));
        bass.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter().joinVoices([trebleVoice, bassVoice]).formatToStave([trebleVoice, bassVoice], treble, {
          context,
          stave: treble,
        });
        alignStaveNotesToCenters(trebleTickables, getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right));
        trebleVoice.draw(context, treble);
        bassVoice.draw(context, bass);
        layoutTickables = trebleTickables;
      } else {
        const { staff, stave } = system;
        const tickables = columns.map((column) =>
          makeChord(staff === "treble" ? column.trebleNotes : column.bassNotes, staff, highlightedNoteNames, highlightedNoteId, colors),
        );
        if (staff === "treble") {
          trebleTickables.push(...tickables);
        } else {
          bassTickables.push(...tickables);
        }
        const voice = new Voice(voiceOptions).addTickables(tickables);
        stave.setNoteStartX(noteArea.left);
        stave.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
        alignStaveNotesToCenters(tickables, getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right));
        voice.draw(context, stave);
        layoutTickables = tickables;
      }
      const columnLayouts = getStudyColumnLayouts(layoutTickables, surface.scale);

      if (svg && highlightedNoteNames && highlightedNoteNames.size > 0) {
        columns.forEach((column, index) => {
          if (highlightedNoteNames.has(column.noteName)) {
            addColumnHighlight(svg, columnLayouts[index], metrics, colors);
          }
        });
      }

      if (showLabels) {
        context
          .setFont("FredokaSystemDigits, Inter", logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx, surface.scale), 800)
          .setFillStyle(colors.ink);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          drawCenteredText(context, column.noteName, centerX, metrics.noteNameY);
        });
        context
          .setFont("FredokaSystemDigits, Inter", logicalPx(STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale), 700)
          .setFillStyle(colors.muted);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          drawCenteredText(context, column.answerNumber, centerX, metrics.fixedDoNumberY);
        });
      }

      if (!svg) {
        return;
      }
      columns.forEach((column, index) => {
        addLabelHotspot({
          layout: columnLayouts[index],
          metrics,
          noteName: column.noteName,
          onPlayColumn,
          svg,
        });
        const trebleTickable = trebleTickables[index];
        const bassTickable = bassTickables[index];
        if (trebleTickable) {
          addNoteHotspots({
            chord: trebleTickable,
            effectiveTargetNoteIds,
            highlightedNoteId,
            notes: column.trebleNotes,
            onPlayNote,
            svg,
          });
        }
        if (bassTickable) {
          addNoteHotspots({
            chord: bassTickable,
            effectiveTargetNoteIds,
            highlightedNoteId,
            notes: column.bassNotes,
            onPlayNote,
            svg,
          });
        }
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    columns,
    colors,
    effectiveTargetNoteIds,
    highlightedNoteId,
    highlightedNoteNames,
    onPlayColumn,
    onPlayNote,
    showLabels,
    staffNotationMode,
    useLedgerGap,
  ]);

  return (
    <div ref={frameRef} className="study-map" aria-label={label}>
      <div ref={rendererTargetRef} className="study-map-renderer" />
    </div>
  );
}
