import { useEffect, useMemo, useRef } from "react";
import { Accidental, Formatter, GhostNote, StaveNote, Voice } from "vexflow";
import type { Staff } from "../../../domain/types";
import { useNightMode, getPageThemeColor } from "../../../shared/appearance/pageAppearance";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawGrandStaff,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getGrandStaffAnchors,
} from "../../../shared/staff/staffGeometry";

export type DuetStaffNoteTone = "danger" | "success" | "neutral";

export interface DuetStaffNotationNote {
  accidental: "sharp" | "flat" | undefined;
  count: number;
  midi: number;
  noteName: string;
  octave: number;
  staff: Staff;
  tone: DuetStaffNoteTone;
}

export interface DuetStaffNotationColumn {
  annotation?: string;
  key: string;
  notes: DuetStaffNotationNote[];
}

function formatScoreNote(note: DuetStaffNotationNote): string {
  const accidental = note.accidental === "sharp" ? "♯" : note.accidental === "flat" ? "♭" : "";
  return `${note.noteName}${accidental}${note.octave}`;
}

function makeVexKey(note: DuetStaffNotationNote): string {
  const accidental = note.accidental === "sharp" ? "#" : note.accidental === "flat" ? "b" : "";
  return `${note.noteName.toLowerCase()}${accidental}/${note.octave}`;
}

function noteToneColor(
  tone: DuetStaffNoteTone,
  colors: { danger: string; ink: string; success: string }
): string {
  if (tone === "danger") return colors.danger;
  if (tone === "success") return colors.success;
  return colors.ink;
}

function makeStaffTickable(
  notes: readonly DuetStaffNotationNote[],
  staff: Staff,
  colors: { danger: string; ink: string; success: string }
): StaveNote | GhostNote {
  if (notes.length === 0) return new GhostNote("q");
  const tickable = new StaveNote({
    clef: staff,
    duration: "q",
    keys: notes.map(makeVexKey),
  });
  tickable.setStemStyle({ fillStyle: colors.ink, strokeStyle: colors.ink });
  tickable.setLedgerLineStyle({ fillStyle: colors.ink, strokeStyle: colors.ink });
  notes.forEach((note, index) => {
    const color = noteToneColor(note.tone, colors);
    tickable.setKeyStyle(index, { fillStyle: color, strokeStyle: color });
    if (note.accidental) {
      tickable.addModifier(new Accidental(note.accidental === "sharp" ? "#" : "b"), index);
    }
  });
  return tickable;
}

function createCountLabel(
  note: DuetStaffNotationNote,
  tickable: StaveNote,
  noteIndex: number,
  svg: SVGSVGElement,
  colors: { danger: string; ink: string; success: string }
): void {
  if (note.count <= 1) return;
  const noteHead = tickable.noteHeads[noteIndex];
  const noteY = tickable.getYs()[noteIndex];
  if (!noteHead || typeof noteY !== "number" || !Number.isFinite(noteY)) return;

  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const color = noteToneColor(note.tone, colors);
  label.setAttribute("class", "duet-wrong-note-count");
  label.setAttribute("text-anchor", "start");
  label.setAttribute("x", (noteHead.getAbsoluteX() + noteHead.getWidth() + 5).toFixed(2));
  label.setAttribute("y", (noteY + 4).toFixed(2));
  label.setAttribute("fill", color);
  label.setAttribute("stroke", "none");
  label.textContent = `×${note.count}`;
  svg.appendChild(label);
}

function getCompactNoteCenters(
  count: number,
  left: number,
  right: number,
  maxGap: number
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [left];

  const availableWidth = Math.max(1, right - left);
  const gap = Math.min(maxGap, availableWidth / (count - 1));
  return Array.from({ length: count }, (_, index) => left + gap * index);
}

export function DuetStaffNotationGroup({
  columns,
  compactColumns = false,
  compactColumnGap = 92,
  label,
}: {
  columns: readonly DuetStaffNotationColumn[];
  compactColumnGap?: number;
  compactColumns?: boolean;
  label: string;
}): JSX.Element {
  const staffFrameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();
  const ariaLabel = useMemo(
    () =>
      columns
        .map((column) => {
          const notes = column.notes
            .map(
              (note) =>
                `${formatScoreNote(note)} ${note.tone === "success" ? "正确" : note.tone === "danger" ? "错误" : "未作答"}${note.count > 1 ? ` ×${note.count}` : ""}`
            )
            .join(" + ");
          return column.annotation ? `${notes}，${column.annotation}` : notes;
        })
        .join("；"),
    [columns]
  );

  useEffect(() => {
    const staffFrame = staffFrameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!staffFrame || !rendererTarget) return undefined;

    let renderFrame = 0;
    const render = (): void => {
      const measuredWidth = Math.floor(staffFrame.clientWidth);
      if (measuredWidth <= 0) return;

      const minColumnGap = compactColumns ? compactColumnGap : 92;
      const width = Math.max(measuredWidth, 190 + columns.length * minColumnGap);
      rendererTarget.replaceChildren();
      const surface = createStaffRenderSurface(rendererTarget, width, 280);
      const { context, svg } = surface;
      const frame = getFixedStaffFrame(surface, 14);
      const anchors = getGrandStaffAnchors(surface.scale, 112, 96);
      const { bass, treble } = drawGrandStaff(context, frame, anchors, {
        brace: true,
        showRightConnector: true,
      });
      const colors = {
        danger: getPageThemeColor("--danger", "#c84c3d"),
        ink: getPageThemeColor("--notation-ink", "#211c18"),
        muted: getPageThemeColor("--muted", "#aeb8b2"),
        success: getPageThemeColor("--success", "#2f8f58"),
      };
      const trebleTickables = columns.map((column) =>
        makeStaffTickable(
          column.notes.filter((note) => note.staff === "treble"),
          "treble",
          colors
        )
      );
      const bassTickables = columns.map((column) =>
        makeStaffTickable(
          column.notes.filter((note) => note.staff === "bass"),
          "bass",
          colors
        )
      );
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) };
      const trebleVoice = new Voice(voiceOptions).setStrict(false).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).setStrict(false).addTickables(bassTickables);
      const noteStartX = frame.x + 84;
      treble.setNoteStartX(noteStartX);
      bass.setNoteStartX(noteStartX);
      treble.setWidth(Math.max(1, frame.staveWidth));
      bass.setWidth(Math.max(1, frame.staveWidth));
      // Separate formatters keep each staff's tick contexts independent. With
      // joined voices, centering the second staff would shift the first staff too.
      new Formatter().formatToStave([trebleVoice], treble, { context, stave: treble });
      new Formatter().formatToStave([bassVoice], bass, { context, stave: bass });
      const noteAreaLeft = noteStartX + 8;
      const noteAreaRight = Math.max(noteAreaLeft, treble.getNoteEndX() - 48);
      const noteCenters = compactColumns
        ? getCompactNoteCenters(columns.length, noteAreaLeft, noteAreaRight, compactColumnGap)
        : getEvenlySpacedCenters(columns.length, noteAreaLeft, noteAreaRight);
      const trebleAnchors: StaveNote[] = [];
      const trebleAnchorCenters: number[] = [];
      const bassAnchors: StaveNote[] = [];
      const bassAnchorCenters: number[] = [];
      columns.forEach((_, columnIndex) => {
        const center = noteCenters[columnIndex];
        if (center === undefined) return;
        const trebleTickable = trebleTickables[columnIndex];
        if (trebleTickable instanceof StaveNote) {
          trebleAnchors.push(trebleTickable);
          trebleAnchorCenters.push(center);
        }
        const bassTickable = bassTickables[columnIndex];
        if (bassTickable instanceof StaveNote) {
          bassAnchors.push(bassTickable);
          bassAnchorCenters.push(center);
        }
      });
      alignStaveNotesToCenters(trebleAnchors, trebleAnchorCenters);
      alignStaveNotesToCenters(bassAnchors, bassAnchorCenters);
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);

      columns.forEach((column, columnIndex) => {
        const trebleTickable = trebleTickables[columnIndex];
        const bassTickable = bassTickables[columnIndex];
        if (trebleTickable instanceof StaveNote) {
          column.notes
            .filter((note) => note.staff === "treble")
            .forEach((note, noteIndex) =>
              createCountLabel(note, trebleTickable, noteIndex, svg, colors)
            );
        }
        if (bassTickable instanceof StaveNote) {
          column.notes
            .filter((note) => note.staff === "bass")
            .forEach((note, noteIndex) =>
              createCountLabel(note, bassTickable, noteIndex, svg, colors)
            );
        }
        if (column.annotation) {
          const annotation = document.createElementNS("http://www.w3.org/2000/svg", "text");
          annotation.setAttribute("class", "duet-staff-column-annotation");
          annotation.setAttribute("text-anchor", "middle");
          annotation.setAttribute("fill", colors.muted);
          annotation.setAttribute("x", (noteCenters[columnIndex] ?? noteAreaLeft).toFixed(2));
          annotation.setAttribute("y", (bass.getYForLine(4) + 44).toFixed(2));
          annotation.textContent = column.annotation;
          svg.appendChild(annotation);
        }
      });

      const noteYs = [...trebleTickables, ...bassTickables]
        .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote)
        .flatMap((tickable) => tickable.getYs().filter((y) => Number.isFinite(y)));
      const minimumY = Math.min(treble.getYForLine(0) - 28, ...noteYs.map((y) => y - 26));
      const metadataBottom = columns.some((column) => column.annotation)
        ? bass.getYForLine(4) + 52
        : Number.NEGATIVE_INFINITY;
      const maximumY = Math.max(
        bass.getYForLine(4) + 28,
        metadataBottom,
        ...noteYs.map((y) => y + 24)
      );
      const renderedHeight = Math.max(1, Math.ceil(maximumY - minimumY));
      svg.setAttribute("viewBox", `0 ${minimumY} ${width} ${renderedHeight}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(renderedHeight));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", ariaLabel);
      svg.setAttribute("focusable", "false");
    };
    const scheduleRender = (): void => {
      if (renderFrame !== 0) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        render();
      });
    };

    render();
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(staffFrame);
    return () => {
      window.cancelAnimationFrame(renderFrame);
      observer.disconnect();
    };
  }, [ariaLabel, columns, compactColumnGap, compactColumns, isNightMode]);

  return (
    <section className="practice-wrong-note-staff-section duet-wrong-note-group">
      <h3>{label}</h3>
      <div className="practice-wrong-note-staff-scroll">
        <div className="practice-wrong-note-staff" ref={staffFrameRef}>
          <div className="practice-wrong-note-staff-renderer" ref={rendererTargetRef} />
        </div>
      </div>
    </section>
  );
}
