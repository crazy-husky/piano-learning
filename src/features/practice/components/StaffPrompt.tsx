import { useEffect, useRef } from "react";
import { Accidental, Formatter, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../../../domain/notes";
import type {
  PromptNoteDuration,
  StaffNotationMode,
  TargetNote,
  TargetNoteId,
} from "../../../domain/types";
import { PRACTICE_SINGLE_STAFF_LAYOUT } from "../../../shared/staff/staffLayoutProfiles";
import { getPageThemeColor, useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getLedgerStemDirection,
} from "../../../shared/staff/staffGeometry";
import { getQuarterNoteBeats, getVexNoteDuration } from "../logic/staffPageNotation";

interface StaffPromptProps {
  effectiveTargetNoteIds: ReadonlySet<TargetNoteId>;
  note: TargetNote;
  noteDuration: PromptNoteDuration;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  wrong?: boolean;
  highlight?: boolean;
  showAccidental?: boolean;
  compact?: boolean;
  accessibleLabel?: string;
}

function makePromptNote(
  note: TargetNote,
  noteDuration: PromptNoteDuration,
  color: string,
  showAccidental: boolean
): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    keys: [noteToVexKey(note)],
    duration: getVexNoteDuration(noteDuration),
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setKeyStyle(0, { fillStyle: color, strokeStyle: color });
  if (showAccidental && note.accidental) {
    staveNote.addModifier(new Accidental(note.accidental === "sharp" ? "#" : "b"), 0);
  }
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

export function StaffPrompt({
  effectiveTargetNoteIds,
  note,
  noteDuration,
  staffNotationMode,
  useLedgerGap,
  wrong = false,
  highlight = false,
  showAccidental = false,
  compact = false,
  accessibleLabel,
}: StaffPromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const isNightMode = useNightMode();

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
      const layout = compact
        ? {
            ...PRACTICE_SINGLE_STAFF_LAYOUT,
            horizontal: {
              ...PRACTICE_SINGLE_STAFF_LAYOUT.horizontal,
              staffSidePaddingPx: 14,
              noteAreaSidePaddingPx: 38,
              minNoteAreaSidePaddingPx: 18,
            },
            vertical: {
              ...PRACTICE_SINGLE_STAFF_LAYOUT.vertical,
              centerYPx: 35,
              gapPx: 40,
              ledgerGapPx: 40,
              trebleOnlyYPx: 35,
              bassOnlyYPx: 35,
              viewHeightPx: 150,
            },
            width: { ...PRACTICE_SINGLE_STAFF_LAYOUT.width, minPx: 1 },
          }
        : PRACTICE_SINGLE_STAFF_LAYOUT;
      const containerWidth = frame.clientWidth || PRACTICE_SINGLE_STAFF_LAYOUT.width.minPx;
      const displayWidth = Math.max(
        layout.width.minPx,
        Math.min(layout.width.maxPx, containerWidth)
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        layout.vertical.viewHeightPx,
        layout.notationScale
      );
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(surface, layout.horizontal.staffSidePaddingPx);
      const system = drawStaffSystem({
        brace: true,
        columnCount: 1,
        context,
        frame: frameMetrics,
        horizontal: layout.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        useLedgerGap,
        vertical: layout.vertical,
      });
      const targetStave =
        system.mode === "grand"
          ? note.staff === "treble"
            ? system.treble
            : system.bass
          : system.stave;
      const { noteArea } = system;
      const noteCenter = getEvenlySpacedCenters(1, noteArea.left, noteArea.right);
      const drawNote = (targetNote: TargetNote, color: string): void => {
        const staveNote = makePromptNote(targetNote, noteDuration, color, showAccidental).setStave(
          targetStave
        );
        const voice = new Voice({
          numBeats: getQuarterNoteBeats(noteDuration),
          beatValue: 4,
        }).addTickables([staveNote]);
        new Formatter()
          .joinVoices([voice])
          .format([voice], Math.max(1, noteArea.right - noteArea.left), { context });
        alignStaveNotesToCenters([staveNote], noteCenter);
        voice.draw(context, targetStave);
      };
      drawNote(
        note,
        wrong
          ? getPageThemeColor("--notation-error", "#c84c3d")
          : highlight
            ? getPageThemeColor("--notation-active", "#256f67")
            : getPageThemeColor("--notation-ink", "#211c18")
      );
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    compact,
    highlight,
    isNightMode,
    note,
    noteDuration,
    showAccidental,
    staffNotationMode,
    useLedgerGap,
    wrong,
  ]);

  return (
    <div
      ref={frameRef}
      className={`staff${compact ? " is-compact-prompt" : ""}`}
      aria-label={accessibleLabel ?? `谱面 ${formatTargetNoteLabel(note, effectiveTargetNoteIds)}`}
      role={accessibleLabel ? "img" : undefined}
    >
      <div ref={rendererTargetRef} className="staff-renderer" />
    </div>
  );
}
