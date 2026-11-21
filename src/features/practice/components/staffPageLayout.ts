import type { Staff, StaffNotationMode, TargetNote } from "../../../domain/types";
import type { PracticePageStaffLayoutProfile } from "../../../shared/staff/staffLayoutProfiles";

export const STAFF_PAGE_ROW_TOP_CLEARANCE_PX = 16;

export const STAFF_PAGE_NOTE_TOP_CLEARANCE_PX = 20;

export const STAFF_PAGE_CURRENT_NOTE_INDICATOR_TIP_OFFSET_PX = 15;

export const STAFF_PAGE_CURRENT_NOTE_INDICATOR_HEIGHT_PX = 8;

export const STAFF_PAGE_CURRENT_NOTE_INDICATOR_TOP_CLEARANCE_PX = 27;

export const STAFF_PAGE_NOTE_BOTTOM_CLEARANCE_PX = 20;

export const STAFF_PAGE_STAVE_LINE_SPACING_PX = 10;

export const STAFF_PAGE_STAVE_TOP_LINE_OFFSET_PX = 40;

export const STAFF_PAGE_NOTE_NAME_ORDER: Record<TargetNote["noteName"], number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

export const STAFF_PAGE_TREBLE_TOP_LINE_ORDER = 5 * 7 + STAFF_PAGE_NOTE_NAME_ORDER.F;

export const STAFF_PAGE_TREBLE_BOTTOM_LINE_ORDER = 4 * 7 + STAFF_PAGE_NOTE_NAME_ORDER.E;

export const STAFF_PAGE_BASS_TOP_LINE_ORDER = 3 * 7 + STAFF_PAGE_NOTE_NAME_ORDER.A;

export const STAFF_PAGE_BASS_BOTTOM_LINE_ORDER = 2 * 7 + STAFF_PAGE_NOTE_NAME_ORDER.G;

export function getStaffPageHighNoteTopPaddingPx(
  notes: readonly TargetNote[],
  layout: PracticePageStaffLayoutProfile,
  staffNotationMode: StaffNotationMode,
  useLedgerGap: boolean,
  noteTopClearancePx = STAFF_PAGE_NOTE_TOP_CLEARANCE_PX
): number {
  if (staffNotationMode === "bass-only" && noteTopClearancePx <= STAFF_PAGE_NOTE_TOP_CLEARANCE_PX) {
    return 0;
  }

  const topStaff: Staff = staffNotationMode === "bass-only" ? "bass" : "treble";
  const topNotes =
    staffNotationMode === "grand" ? notes.filter((note) => note.staff === "treble") : notes;
  if (topNotes.length === 0) return 0;

  const staffTopLineY =
    (staffNotationMode === "grand"
      ? layout.vertical.centerYPx -
        (useLedgerGap ? layout.vertical.ledgerGapPx : layout.vertical.gapPx) / 2
      : topStaff === "bass"
        ? layout.vertical.bassOnlyYPx
        : layout.vertical.trebleOnlyYPx) + STAFF_PAGE_STAVE_TOP_LINE_OFFSET_PX;
  const topLineOrder =
    topStaff === "bass" ? STAFF_PAGE_BASS_TOP_LINE_ORDER : STAFF_PAGE_TREBLE_TOP_LINE_ORDER;
  const highestNoteY = Math.min(
    ...topNotes.map((note) => {
      const noteOrder = note.octave * 7 + STAFF_PAGE_NOTE_NAME_ORDER[note.noteName];
      return staffTopLineY - (noteOrder - topLineOrder) * (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2);
    })
  );
  const requiredPadding = Math.max(0, noteTopClearancePx - highestNoteY);

  // Snap the additional row height to a staff half-space so ledger lines stay
  // aligned when the enabled range includes notes above the normal treble staff.
  return (
    Math.ceil(requiredPadding / (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2)) *
    (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2)
  );
}

export function getStaffPageLowNoteBottomPaddingPx(
  notes: readonly TargetNote[],
  layout: PracticePageStaffLayoutProfile,
  staffNotationMode: StaffNotationMode,
  useLedgerGap: boolean
): number {
  const bottomStaff = staffNotationMode === "treble-only" ? "treble" : "bass";
  const bottomNotes =
    staffNotationMode === "grand" ? notes.filter((note) => note.staff === "bass") : notes;
  if (bottomNotes.length === 0) return 0;

  const bottomLineOrder =
    bottomStaff === "bass"
      ? STAFF_PAGE_BASS_BOTTOM_LINE_ORDER
      : STAFF_PAGE_TREBLE_BOTTOM_LINE_ORDER;
  const bottomLineY =
    (staffNotationMode === "grand"
      ? layout.vertical.centerYPx +
        (useLedgerGap ? layout.vertical.ledgerGapPx : layout.vertical.gapPx) / 2
      : bottomStaff === "bass"
        ? layout.vertical.bassOnlyYPx
        : layout.vertical.trebleOnlyYPx) +
    STAFF_PAGE_STAVE_TOP_LINE_OFFSET_PX +
    4 * STAFF_PAGE_STAVE_LINE_SPACING_PX;
  const lowestNoteY = Math.max(
    ...bottomNotes.map((note) => {
      const noteOrder = note.octave * 7 + STAFF_PAGE_NOTE_NAME_ORDER[note.noteName];
      return bottomLineY + (bottomLineOrder - noteOrder) * (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2);
    })
  );
  const requiredPadding = Math.max(
    0,
    lowestNoteY + STAFF_PAGE_NOTE_BOTTOM_CLEARANCE_PX - layout.vertical.viewHeightPx
  );

  // Keep the additional viewport height aligned to staff half-spaces.
  return (
    Math.ceil(requiredPadding / (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2)) *
    (STAFF_PAGE_STAVE_LINE_SPACING_PX / 2)
  );
}

export function getStaffPageRowCenterY(row: SVGElement): number {
  const staves = Array.from(row.querySelectorAll<SVGElement>(".vf-stave"));
  const firstStave = staves[0]?.getBoundingClientRect();
  const lastStave = staves[staves.length - 1]?.getBoundingClientRect();
  if (firstStave && lastStave) return (firstStave.top + lastStave.bottom) / 2;
  const rowBounds = row.getBoundingClientRect();
  return (rowBounds.top + rowBounds.bottom) / 2;
}

export function getStaffPageRowTopY(row: SVGElement, rowStepPx: number): number {
  const svg = row.ownerSVGElement;
  const rowIndex = Number(row.getAttribute("data-staff-row-index"));
  if (svg && Number.isInteger(rowIndex) && rowIndex >= 0 && svg.viewBox.baseVal.width > 0) {
    const svgBounds = svg.getBoundingClientRect();
    const renderedScale = svgBounds.width / svg.viewBox.baseVal.width;
    return svgBounds.top + rowIndex * rowStepPx * renderedScale - STAFF_PAGE_ROW_TOP_CLEARANCE_PX;
  }

  const firstStave = row.querySelector<SVGElement>(".vf-stave")?.getBoundingClientRect();
  if (!firstStave) return row.getBoundingClientRect().top;

  // Fall back to the stave when this row is detached from its SVG surface.
  return firstStave.top - STAFF_PAGE_ROW_TOP_CLEARANCE_PX;
}

export function getPracticeSessionHeader(frame: HTMLElement): HTMLElement | null {
  return (
    frame
      .closest<HTMLElement>(".practice-session-frame")
      ?.querySelector<HTMLElement>(".practice-session-header") ?? null
  );
}

export function getStickyPracticeHeaderInsetPx(frame: HTMLElement): number {
  if (frame.closest<HTMLElement>(".staff-page-scroll-viewport")) return 0;
  const header = getPracticeSessionHeader(frame);
  if (!header || window.getComputedStyle(header).position !== "sticky") return 0;
  const style = window.getComputedStyle(header);
  const stickyTop = Number.parseFloat(style.top) || 0;
  return stickyTop + header.getBoundingClientRect().height;
}

export function chunkNoteGroups(
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
