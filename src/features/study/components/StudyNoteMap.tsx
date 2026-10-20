import { useEffect, useMemo, useRef } from "react";
import { Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../../../domain/notes";
import { staffForSingleClefMode } from "../../../domain/staffNotation";
import type { NoteName, Staff, StaffNotationMode, TargetNote } from "../../../domain/types";
import type { NoteNameColumn } from "../../../domain/staffRecall";
import { STUDY_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import { FIXED_DO_SOLFEGE } from "../../../shared/staff/fixedDoSolfege";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getResponsiveStaffFrame,
  getGrandStaffAnchors,
  logicalPx,
  staveNoteCenterX,
  type StaffSystem,
  type StaffRenderSurface,
} from "../../../shared/staff/staffGeometry";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";

const NOTE_DURATION = "w";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const ACTIVE_COLOR = "#2f8f5f";
const TRANSPARENT_NOTE_COLOR = "rgba(0, 0, 0, 0)";

function getStudyMapHeight(staffNotationMode: StaffNotationMode, useLedgerGap: boolean): number {
  if (staffNotationMode === "grand") {
    return useLedgerGap ? 440 : 360;
  }
  return 260;
}

interface StudyNoteMapProps {
  columns: NoteNameColumn[];
  highlightedNoteId?: string;
  highlightedNoteNames?: ReadonlySet<NoteName>;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  label: string;
  instructions?: string;
  onPlayColumn: (noteName: NoteName) => void;
  onPlayNote: (note: TargetNote) => void;
  showLabels: boolean;
}

interface StudyNotationColors {
  active: string;
  ink: string;
  muted: string;
  staff: string;
}

interface StudyMapMetrics {
  fixedDoNumberY: number;
  labelHitHeight: number;
  labelHitTop: number;
  noteNameY: number;
  solfegeY: number;
  staveWidth: number;
  x: number;
}

interface StudyColumnLayout {
  centerX: number;
  highlightWidth: number;
}

export function isStudyNoteNameHighlighted(
  noteName: NoteName,
  highlightedNoteNames: ReadonlySet<NoteName> | undefined
): boolean {
  return highlightedNoteNames?.has(noteName) ?? false;
}

export function isStudyNoteHighlighted(
  noteId: string,
  highlightedNoteId: string | undefined
): boolean {
  return highlightedNoteId === noteId;
}

function makeChord(
  notes: TargetNote[],
  staff: Staff,
  highlightedNoteNames: ReadonlySet<NoteName> | undefined,
  highlightedNoteId: string | undefined,
  colors: StudyNotationColors
): StaveNote {
  const columnHighlighted = notes.some((note) =>
    isStudyNoteNameHighlighted(note.noteName, highlightedNoteNames)
  );
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map(noteToVexKey) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const baseColor = hasNotes
    ? columnHighlighted
      ? colors.active
      : colors.ink
    : TRANSPARENT_NOTE_COLOR;
  chord.setStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  chord.setLedgerLineStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  if (!columnHighlighted && highlightedNoteId) {
    notes.forEach((note, index) => {
      if (isStudyNoteHighlighted(note.id, highlightedNoteId)) {
        chord.setKeyStyle(index, { fillStyle: colors.active, strokeStyle: colors.active });
      }
    });
  }
  return chord;
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
  noteNameY: number
): StudyMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STUDY_STAFF_LAYOUT.horizontal);
  const lineGap = logicalPx(STUDY_STAFF_LAYOUT.labels.lineGapPx, surface.scale);
  const solfegeY = noteNameY + lineGap;
  const fixedDoNumberY = solfegeY + lineGap;
  const labelHitTop =
    noteNameY -
    logicalPx(
      STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
      surface.scale
    );
  return {
    fixedDoNumberY,
    labelHitHeight:
      fixedDoNumberY -
      labelHitTop +
      logicalPx(
        STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
        surface.scale
      ),
    labelHitTop,
    noteNameY,
    solfegeY,
    staveWidth: frame.staveWidth,
    x: frame.x,
  };
}

function getStudyLabelOffset(
  columns: NoteNameColumn[],
  staffNotationMode: StaffNotationMode,
  useLedgerGap: boolean,
  scale: number
): number {
  const vertical = STUDY_STAFF_LAYOUT.vertical;
  const staves =
    staffNotationMode === "grand"
      ? getGrandStaffAnchors(
          scale,
          vertical.centerYPx,
          useLedgerGap ? vertical.ledgerGapPx : vertical.gapPx
        )
      : undefined;
  const selectedStaff =
    staffNotationMode === "grand" ? undefined : staffForSingleClefMode(staffNotationMode);
  const notes = columns.flatMap((column) =>
    staffNotationMode === "grand"
      ? [...column.trebleNotes, ...column.bassNotes]
      : selectedStaff === "treble"
        ? column.trebleNotes
        : column.bassNotes
  );
  if (notes.length === 0) {
    return 0;
  }

  const highestNoteCenter = Math.min(
    ...notes.map((note) => {
      const staff = selectedStaff ?? note.staff;
      const y =
        staves?.[staff === "treble" ? "trebleY" : "bassY"] ??
        logicalPx(staff === "treble" ? vertical.trebleOnlyYPx : vertical.bassOnlyYPx, scale);
      const stave = new Stave(0, y, 100).addClef(staff);
      const noteHead = new StaveNote({
        clef: staff,
        duration: NOTE_DURATION,
        keys: [noteToVexKey(note)],
      });
      return stave.getYForNote(noteHead.getLineNumber());
    })
  );
  const labelsBottomPx =
    STUDY_STAFF_LAYOUT.labels.noteNameYPx +
    STUDY_STAFF_LAYOUT.labels.lineGapPx * 2 +
    STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx * 0.4;
  const noteHeadAndBreathingRoomPx = 8;
  const labelBottomWithBreathingRoom = logicalPx(
    labelsBottomPx + noteHeadAndBreathingRoomPx,
    scale
  );
  const noteOffset = labelBottomWithBreathingRoom - highestNoteCenter;
  const trebleTopLineY =
    staves === undefined
      ? undefined
      : new Stave(0, staves.trebleY, 100).addClef("treble").getYForLine(0);
  const staffTopOffset =
    trebleTopLineY === undefined ? 0 : labelBottomWithBreathingRoom - trebleTopLineY;

  return Math.max(0, noteOffset, staffTopOffset);
}

function extendStudySurfaceForNotation(surface: StaffRenderSurface, lowestContentY: number): void {
  const bottomPadding = logicalPx(18, surface.scale);
  const requiredHeight = lowestContentY + bottomPadding;
  const extraHeight = Math.max(0, requiredHeight - surface.height);
  if (extraHeight === 0) {
    return;
  }

  const viewBox = surface.svg.viewBox.baseVal;
  const nextViewBoxHeight = viewBox.height + extraHeight;
  surface.svg.setAttribute("viewBox", `0 0 ${viewBox.width} ${nextViewBoxHeight}`);
  surface.svg.setAttribute("height", String(Math.ceil(nextViewBoxHeight * surface.scale)));
}

function addStudyStaffRightBorder(
  svg: SVGSVGElement,
  system: StaffSystem,
  rightEdgeX: number,
  stroke: string
): void {
  const topStave = system.mode === "grand" ? system.treble : system.stave;
  const bottomStave = system.mode === "grand" ? system.bass : system.stave;
  const rightBorder = document.createElementNS("http://www.w3.org/2000/svg", "line");
  rightBorder.setAttribute("aria-hidden", "true");
  rightBorder.setAttribute("class", "study-staff-right-border");
  rightBorder.setAttribute("x1", String(rightEdgeX));
  rightBorder.setAttribute("x2", String(rightEdgeX));
  rightBorder.setAttribute("y1", String(topStave.getYForLine(0)));
  rightBorder.setAttribute("y2", String(bottomStave.getYForLine(4)));
  rightBorder.setAttribute("stroke", stroke);
  rightBorder.setAttribute("stroke-width", "1.25");
  svg.appendChild(rightBorder);
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
      neighborDistances.length > 0 ? Math.min(...neighborDistances) - spacingPadding * 2 : maxWidth;
    return {
      centerX,
      highlightWidth: Math.max(1, Math.min(maxWidth, spacingWidth)),
    };
  });
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
  hotspot.setAttribute("data-study-hotspot-id", `column:${noteName}`);
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
  hotspot.setAttribute("data-study-hotspot-id", `note:${note.id}`);
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
  instructions,
  onPlayColumn,
  onPlayNote,
  showLabels,
  useLedgerGap,
}: StudyNoteMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();
  const colors = useMemo<StudyNotationColors>(
    () => ({
      active: isNightMode ? "#80cbb4" : ACTIVE_COLOR,
      ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
      muted: isNightMode ? "#b2beb5" : MUTED_COLOR,
      staff: getPageThemeColor("--notation-staff", isNightMode ? "#9aa99f" : "#766b5f"),
    }),
    [isNightMode]
  );
  const effectiveTargetNoteIds = useMemo(
    () => new Set(columns.flatMap((column) => column.notes.map((note) => note.id))),
    [columns]
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

      const focusedHotspot = document.activeElement;
      const focusedHotspotId =
        focusedHotspot && rendererTarget.contains(focusedHotspot)
          ? focusedHotspot.getAttribute("data-study-hotspot-id")
          : null;
      const hasExistingRender = rendererTarget.childNodes.length > 0;
      const previousPageScroll = hasExistingRender
        ? { left: window.scrollX, top: window.scrollY }
        : undefined;
      const previousMapScroll = hasExistingRender ? frame.scrollLeft : undefined;
      rendererTarget.innerHTML = "";
      const frameStyles = window.getComputedStyle(frame);
      const horizontalPadding =
        (Number.parseFloat(frameStyles.paddingLeft) || 0) +
        (Number.parseFloat(frameStyles.paddingRight) || 0);
      const horizontalBorder =
        (Number.parseFloat(frameStyles.borderLeftWidth) || 0) +
        (Number.parseFloat(frameStyles.borderRightWidth) || 0);
      const clientWidth = frame.clientWidth;
      const measuredWidth =
        clientWidth || frame.getBoundingClientRect().width || frame.parentElement?.clientWidth || 1;
      const containerWidth = Math.max(
        1,
        Math.floor(measuredWidth - horizontalPadding - (clientWidth ? 0 : horizontalBorder))
      );
      const renderWidth = containerWidth;
      rendererTarget.style.setProperty("--study-render-width", `${renderWidth}px`);
      const vertical = {
        ...STUDY_STAFF_LAYOUT.vertical,
        viewHeightPx: getStudyMapHeight(staffNotationMode, useLedgerGap),
      };
      const labelOffset = showLabels
        ? getStudyLabelOffset(
            columns,
            staffNotationMode,
            useLedgerGap,
            STUDY_STAFF_LAYOUT.notationScale
          )
        : 0;
      const surface = createStaffRenderSurface(
        rendererTarget,
        renderWidth,
        vertical.viewHeightPx,
        STUDY_STAFF_LAYOUT.notationScale
      );
      const metrics = getStudyMapMetrics(surface, columns.length, 0);
      const { context, svg } = surface;
      frame.classList.toggle("has-horizontal-overflow", renderWidth > containerWidth + 1);
      if (renderWidth <= containerWidth + 1) {
        frame.classList.remove("is-scroll-at-end");
      }
      const system = drawStaffSystem({
        brace: true,
        columnCount: columns.length,
        context,
        frame: { x: metrics.x, staveWidth: metrics.staveWidth },
        horizontal: STUDY_STAFF_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        showGrandStaffRightConnector: false,
        showSingleStaffRightBarline: false,
        useLedgerGap,
        vertical,
        yOffset: labelOffset,
      });
      const { noteArea } = system;
      const trebleTickables: StaveNote[] = [];
      const bassTickables: StaveNote[] = [];
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      let layoutTickables: StaveNote[];
      if (system.mode === "grand") {
        const { bass, treble } = system;
        trebleTickables.push(
          ...columns.map((column) =>
            makeChord(column.trebleNotes, "treble", highlightedNoteNames, highlightedNoteId, colors)
          )
        );
        bassTickables.push(
          ...columns.map((column) =>
            makeChord(column.bassNotes, "bass", highlightedNoteNames, highlightedNoteId, colors)
          )
        );
        const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
        const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
        treble.setNoteStartX(noteArea.left);
        bass.setNoteStartX(noteArea.left);
        treble.setWidth(Math.max(1, noteArea.right - metrics.x));
        bass.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter()
          .joinVoices([trebleVoice, bassVoice])
          .formatToStave([trebleVoice, bassVoice], treble, {
            context,
            stave: treble,
          });
        alignStaveNotesToCenters(
          trebleTickables,
          getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right)
        );
        trebleVoice.draw(context, treble);
        bassVoice.draw(context, bass);
        layoutTickables = trebleTickables;
      } else {
        const { staff, stave } = system;
        const tickables = columns.map((column) =>
          makeChord(
            staff === "treble" ? column.trebleNotes : column.bassNotes,
            staff,
            highlightedNoteNames,
            highlightedNoteId,
            colors
          )
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
        alignStaveNotesToCenters(
          tickables,
          getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right)
        );
        voice.draw(context, stave);
        layoutTickables = tickables;
      }
      const columnLayouts = getStudyColumnLayouts(layoutTickables, surface.scale);
      const visibleNoteBottomYs = columns.flatMap((column, index) => [
        ...(column.trebleNotes.length > 0
          ? (trebleTickables[index]?.noteHeads.map((noteHead) => {
              const bounds = noteHead.getBoundingBox();
              return bounds.getY() + bounds.getH();
            }) ?? [])
          : []),
        ...(column.bassNotes.length > 0
          ? (bassTickables[index]?.noteHeads.map((noteHead) => {
              const bounds = noteHead.getBoundingBox();
              return bounds.getY() + bounds.getH();
            }) ?? [])
          : []),
      ]);
      const lowestVisibleNoteBottomY =
        visibleNoteBottomYs.length > 0 ? Math.max(...visibleNoteBottomYs) : 0;
      const staffBottomY =
        system.mode === "grand" ? system.bass.getBottomLineY() : system.stave.getBottomLineY();
      extendStudySurfaceForNotation(surface, Math.max(lowestVisibleNoteBottomY, staffBottomY));
      const labelMetrics = getStudyMapMetrics(
        surface,
        columns.length,
        logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameYPx, surface.scale)
      );

      if (showLabels) {
        context
          .setFont(
            "FredokaSystemDigits, Inter",
            logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx, surface.scale),
            800
          )
          .setFillStyle(colors.ink);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          const columnHighlighted = isStudyNoteNameHighlighted(
            column.noteName,
            highlightedNoteNames
          );
          context.setFillStyle(columnHighlighted ? colors.active : colors.ink);
          drawCenteredText(context, column.noteName, centerX, labelMetrics.noteNameY);
        });
        context
          .setFont(
            "FredokaSystemDigits, Inter",
            logicalPx(
              STUDY_STAFF_LAYOUT.labels.solfegeFontSizePx ??
                STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx,
              surface.scale
            ),
            700
          )
          .setFillStyle(colors.muted);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          const columnHighlighted = isStudyNoteNameHighlighted(
            column.noteName,
            highlightedNoteNames
          );
          context.setFillStyle(columnHighlighted ? colors.active : colors.muted);
          drawCenteredText(
            context,
            FIXED_DO_SOLFEGE[column.noteName],
            centerX,
            labelMetrics.solfegeY
          );
        });
        context
          .setFont(
            "FredokaSystemDigits, Inter",
            logicalPx(STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale),
            700
          )
          .setFillStyle(colors.muted);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          const columnHighlighted = isStudyNoteNameHighlighted(
            column.noteName,
            highlightedNoteNames
          );
          context.setFillStyle(columnHighlighted ? colors.active : colors.muted);
          drawCenteredText(context, column.answerNumber, centerX, labelMetrics.fixedDoNumberY);
        });
      }

      if (!svg) {
        return;
      }
      // Tickable formatting narrows each VexFlow stave after it has drawn the staff lines.
      // Keep the closing edge tied to the responsive frame used for the original staff render.
      addStudyStaffRightBorder(svg, system, metrics.x + metrics.staveWidth - 0.75, colors.staff);
      columns.forEach((column, index) => {
        addLabelHotspot({
          layout: columnLayouts[index],
          metrics: labelMetrics,
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
      if (focusedHotspotId) {
        const replacementHotspot = Array.from(
          svg.querySelectorAll<SVGElement>("[data-study-hotspot-id]")
        ).find((hotspot) => hotspot.getAttribute("data-study-hotspot-id") === focusedHotspotId);
        replacementHotspot?.focus({ preventScroll: true });
      }
      if (previousMapScroll !== undefined) {
        frame.scrollLeft = previousMapScroll;
      }
      if (
        previousPageScroll &&
        (window.scrollX !== previousPageScroll.left || window.scrollY !== previousPageScroll.top)
      ) {
        window.scrollTo(previousPageScroll.left, previousPageScroll.top);
      }
      updateScrollHint();
    }

    function updateScrollHint(): void {
      const scrollFrame = frameRef.current;
      if (!scrollFrame) {
        return;
      }
      const hasOverflow = scrollFrame.scrollWidth > scrollFrame.clientWidth + 1;
      scrollFrame.classList.toggle("has-horizontal-overflow", hasOverflow);
      scrollFrame.classList.toggle(
        "is-scroll-at-end",
        !hasOverflow ||
          scrollFrame.scrollLeft + scrollFrame.clientWidth >= scrollFrame.scrollWidth - 2
      );
    }

    frame.addEventListener("scroll", updateScrollHint, { passive: true });
    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      frame.removeEventListener("scroll", updateScrollHint);
    };
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
      {instructions ? <p className="study-map-instructions">{instructions}</p> : null}
      <div ref={rendererTargetRef} className="study-map-renderer" />
    </div>
  );
}
