import { staffForSingleClefMode } from "./staffNotation";
import type {
  NoteName,
  Octave,
  PianoKeyName,
  CurrentPracticeGroupId,
  PitchId,
  PracticeGroup,
  PracticeGroupId,
  Staff,
  StaffNotationMode,
  TargetNote,
  TargetNoteId,
} from "./types";

export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const NOTE_NAME_INDEX = new Map(NOTE_NAMES.map((noteName, index) => [noteName, index]));
type PracticePitch = { noteName: NoteName; octave: Octave };
type PracticeGroupDefinition = {
  id: CurrentPracticeGroupId;
  label: string;
  pitches: PracticePitch[];
};

export const ANSWER_BUTTONS: Array<{ key: string; label: string; noteName: NoteName }> =
  NOTE_NAMES.map((noteName, index) => ({
    key: String(index + 1),
    label: String(index + 1),
    noteName,
  }));

const PRACTICE_GROUP_DEFINITIONS: PracticeGroupDefinition[] = [
  {
    id: "C2-B2",
    label: "C2-B2",
    pitches: NOTE_NAMES.map((noteName) => ({ noteName, octave: 2 })),
  },
  {
    id: "C3-B3",
    label: "C3-B3",
    pitches: NOTE_NAMES.map((noteName) => ({ noteName, octave: 3 })),
  },
  {
    id: "C4-B4",
    label: "C4-B4",
    pitches: NOTE_NAMES.map((noteName) => ({ noteName, octave: 4 })),
  },
  {
    id: "C5-B5",
    label: "C5-B5",
    pitches: NOTE_NAMES.map((noteName) => ({ noteName, octave: 5 })),
  },
  {
    id: "C6-B6",
    label: "C6-B6",
    pitches: NOTE_NAMES.map((noteName) => ({ noteName, octave: 6 })),
  },
];

const LEGACY_GROUP_ID_SEQUENCES: readonly (readonly PracticeGroupId[])[] = [
  ["F1-F2", "G2-F3", "G3-F4", "G4-F5", "G5-G6"],
];

function noteOrder(noteName: NoteName, octave: Octave): number {
  const index = NOTE_NAME_INDEX.get(noteName);
  if (index === undefined) {
    throw new Error(`Unknown note name: ${noteName}`);
  }
  return octave * NOTE_NAMES.length + index;
}

function isLedgerOverlap(noteName: NoteName, octave: Octave): boolean {
  const order = noteOrder(noteName, octave);
  return order >= noteOrder("E", 3) && order <= noteOrder("A", 4);
}

function getDefaultStaff(octave: Octave): Staff {
  return octave >= 4 ? "treble" : "bass";
}

function getAlternateStaff(staff: Staff): Staff {
  return staff === "treble" ? "bass" : "treble";
}

export function makePitchId(noteName: NoteName, octave: Octave): PitchId {
  return `${noteName}${octave}` as PitchId;
}

export function makeNoteId(
  noteName: NoteName,
  octave: Octave,
  staff = getDefaultStaff(octave)
): TargetNoteId {
  const pitchId = makePitchId(noteName, octave);
  return staff === getDefaultStaff(octave) ? pitchId : `${pitchId}-${staff}`;
}

function makeTargetNote(
  noteName: NoteName,
  octave: Octave,
  groupId: PracticeGroupId,
  staff = getDefaultStaff(octave)
): TargetNote {
  const pitchId = makePitchId(noteName, octave);
  const isInterStaffLedgerSpelling =
    isLedgerOverlap(noteName, octave) && staff !== getDefaultStaff(octave);
  return {
    id: makeNoteId(noteName, octave, staff),
    pitchId,
    noteName,
    octave,
    groupId,
    staff,
    isInterStaffLedgerSpelling,
  };
}

function makeTargetNotes(
  noteName: NoteName,
  octave: Octave,
  groupId: PracticeGroupId
): TargetNote[] {
  const defaultStaff = getDefaultStaff(octave);
  return [
    makeTargetNote(noteName, octave, groupId, defaultStaff),
    makeTargetNote(noteName, octave, groupId, getAlternateStaff(defaultStaff)),
  ];
}

export const PRACTICE_GROUPS: PracticeGroup[] = PRACTICE_GROUP_DEFINITIONS.map((group) => ({
  id: group.id,
  label: group.label,
  notes: group.pitches.flatMap((pitch) => makeTargetNotes(pitch.noteName, pitch.octave, group.id)),
}));

export const ALL_NOTES: TargetNote[] = PRACTICE_GROUPS.flatMap((group) => group.notes);
export const AVAILABLE_PITCH_IDS: PitchId[] = [...new Set(ALL_NOTES.map((note) => note.pitchId))];
const LEGACY_LOW_NOTES: TargetNote[] = (["F", "G", "A", "B"] as const).flatMap((noteName) =>
  makeTargetNotes(noteName, 1, "F1-F2")
);

const OCTAVE_GROUP_LABELS = new Map<number, string>([
  [2, "大字组"],
  [3, "小字组"],
  [4, "小字一组"],
  [5, "小字二组"],
  [6, "小字三组"],
]);

export interface PitchOctaveGroup {
  label: string;
  pitchIds: PitchId[];
  rangeLabel: string;
}

export const PITCH_OCTAVE_GROUPS: PitchOctaveGroup[] = [...OCTAVE_GROUP_LABELS.entries()]
  .map(([octave, label]) => {
    const pitchIds = AVAILABLE_PITCH_IDS.filter((pitchId) => pitchId.endsWith(String(octave)));
    return {
      label,
      pitchIds,
      rangeLabel: pitchIds.length > 0 ? `${pitchIds[0]}–${pitchIds[pitchIds.length - 1]}` : "",
    };
  })
  .filter((group) => group.pitchIds.length > 0);

export const CURRENT_PRACTICE_GROUP_IDS: CurrentPracticeGroupId[] = PRACTICE_GROUPS.map(
  (group) => group.id
);
export const DEFAULT_ENABLED_GROUPS: PracticeGroupId[] = ["C4-B4"];

const CURRENT_GROUP_IDS = CURRENT_PRACTICE_GROUP_IDS;
const CURRENT_GROUP_ID_SET = new Set<string>(CURRENT_GROUP_IDS);
const CURRENT_PITCH_ID_SET = new Set<string>(AVAILABLE_PITCH_IDS);
const ALL_NOTES_BY_ID = new Map<TargetNoteId, TargetNote>(
  [...ALL_NOTES, ...LEGACY_LOW_NOTES].map((note) => [note.id, note])
);

function isCurrentPracticeGroupId(groupId: string): groupId is PracticeGroupId {
  return CURRENT_GROUP_ID_SET.has(groupId);
}

function currentGroupIdForLegacyPosition(
  legacyIndex: number,
  legacyCount: number
): PracticeGroupId {
  if (legacyCount <= 1 || CURRENT_GROUP_IDS.length <= 1) {
    return CURRENT_GROUP_IDS[0];
  }
  const currentIndex = Math.round(
    (legacyIndex / (legacyCount - 1)) * (CURRENT_GROUP_IDS.length - 1)
  );
  return CURRENT_GROUP_IDS[Math.max(0, Math.min(CURRENT_GROUP_IDS.length - 1, currentIndex))];
}

export function findNoteById(id: TargetNoteId): TargetNote | undefined {
  return ALL_NOTES_BY_ID.get(id);
}

export function getNoteById(id: TargetNoteId): TargetNote {
  const note = findNoteById(id);
  if (!note) {
    throw new Error(`Unknown target note: ${id}`);
  }
  return note;
}

export function getNotesForGroups(
  groupIds: PracticeGroupId[],
  includeInterStaffLedgerSpellings = true,
  staffNotationMode: StaffNotationMode = "grand"
): TargetNote[] {
  return getNotesForSelection(
    groupIds,
    undefined,
    undefined,
    includeInterStaffLedgerSpellings,
    staffNotationMode
  );
}

export function getPitchIdsForGroups(groupIds: readonly PracticeGroupId[]): PitchId[] {
  const enabled = new Set(normalizeCurrentPracticeGroupIds(groupIds));
  return AVAILABLE_PITCH_IDS.filter((pitchId) =>
    ALL_NOTES.some((note) => note.pitchId === pitchId && enabled.has(note.groupId))
  );
}

export function getSelectedPitchIds(
  groupIds: readonly PracticeGroupId[],
  enabledPitchIds?: readonly PitchId[],
  crossGroupPitchIds?: readonly PitchId[]
): PitchId[] {
  const basePitchIds = enabledPitchIds ?? getPitchIdsForGroups(groupIds);
  const selected = new Set([...basePitchIds, ...(crossGroupPitchIds ?? [])]);
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export interface StaffRangeExtensionOption {
  direction: "lower" | "higher";
  pitchIds: PitchId[];
}

export function getStaffCorePitchIds(
  pitchIds: readonly PitchId[],
  staffNotationMode: StaffNotationMode
): PitchId[] {
  const selectedPitchIds = new Set(pitchIds);
  if (staffNotationMode === "grand") {
    return AVAILABLE_PITCH_IDS.filter((pitchId) => selectedPitchIds.has(pitchId));
  }
  const boundaryPitchId = staffNotationMode === "treble-only" ? "C4" : "B3";
  const boundary = AVAILABLE_PITCH_IDS.indexOf(boundaryPitchId);
  return AVAILABLE_PITCH_IDS.filter((pitchId) => {
    const index = AVAILABLE_PITCH_IDS.indexOf(pitchId);
    return (
      selectedPitchIds.has(pitchId) &&
      (staffNotationMode === "treble-only" ? index >= boundary : index <= boundary)
    );
  });
}

export function getStaffRangeExtensionOptions(
  basePitchIds: readonly PitchId[]
): StaffRangeExtensionOption[] {
  if (basePitchIds.length === 0) return [];
  const indexes = basePitchIds
    .map((pitchId) => AVAILABLE_PITCH_IDS.indexOf(pitchId))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return [];
  const options: StaffRangeExtensionOption[] = [];
  const counts = [3, 5];
  const lowest = Math.min(...indexes);
  const highest = Math.max(...indexes);
  for (const count of counts) {
    const start = lowest - count;
    if (start >= 0) {
      options.push({ direction: "lower", pitchIds: AVAILABLE_PITCH_IDS.slice(start, lowest) });
    }
    const end = highest + count;
    if (end < AVAILABLE_PITCH_IDS.length) {
      options.push({
        direction: "higher",
        pitchIds: AVAILABLE_PITCH_IDS.slice(highest + 1, end + 1),
      });
    }
  }
  return options;
}

export function getValidStaffCrossGroupPitchIds(
  basePitchIds: readonly PitchId[],
  crossGroupPitchIds: readonly PitchId[] | undefined
): PitchId[] {
  if (!crossGroupPitchIds?.length) return [];
  const candidate = new Set(crossGroupPitchIds);
  const options = getStaffRangeExtensionOptions(basePitchIds);
  const selected = new Set<PitchId>();
  for (const direction of ["lower", "higher"] as const) {
    const option = options
      .filter((candidateOption) => candidateOption.direction === direction)
      .filter((candidateOption) =>
        candidateOption.pitchIds.every((pitchId) => candidate.has(pitchId))
      )
      .sort((left, right) => right.pitchIds.length - left.pitchIds.length)[0];
    option?.pitchIds.forEach((pitchId) => selected.add(pitchId));
  }
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export function getStaffSelectedPitchIds(
  groupIds: readonly PracticeGroupId[],
  enabledPitchIds: readonly PitchId[] | undefined,
  crossGroupPitchIds: readonly PitchId[] | undefined,
  staffNotationMode: StaffNotationMode
): PitchId[] {
  const basePitchIds = getStaffCorePitchIds(
    enabledPitchIds ?? getPitchIdsForGroups(groupIds),
    staffNotationMode
  );
  const selected = new Set([
    ...basePitchIds,
    ...getValidStaffCrossGroupPitchIds(basePitchIds, crossGroupPitchIds),
  ]);
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export function normalizeEnabledPitchIds(
  pitchIds: readonly string[] | undefined
): PitchId[] | undefined {
  if (pitchIds === undefined) return undefined;
  const selected = new Set(
    pitchIds.filter((pitchId): pitchId is PitchId => CURRENT_PITCH_ID_SET.has(pitchId))
  );
  return AVAILABLE_PITCH_IDS.filter((pitchId) => selected.has(pitchId));
}

export function getNotesForSelection(
  groupIds: PracticeGroupId[],
  enabledPitchIds?: readonly PitchId[],
  crossGroupPitchIds?: readonly PitchId[],
  includeInterStaffLedgerSpellings = true,
  staffNotationMode: StaffNotationMode = "grand"
): TargetNote[] {
  const selectedPitchIds = new Set(
    getStaffSelectedPitchIds(groupIds, enabledPitchIds, crossGroupPitchIds, staffNotationMode)
  );
  const isSelected = (note: TargetNote): boolean => selectedPitchIds.has(note.pitchId);
  if (staffNotationMode !== "grand") {
    const staff = staffForSingleClefMode(staffNotationMode);
    return ALL_NOTES.filter((note) => isSelected(note) && note.staff === staff);
  }
  return ALL_NOTES.filter(
    (note) =>
      isSelected(note) &&
      (note.staff === getDefaultStaff(note.octave) ||
        (includeInterStaffLedgerSpellings && note.isInterStaffLedgerSpelling))
  );
}

export function getCurrentTargetNoteIdsForGroups(
  groupIds: PracticeGroupId[],
  includeInterStaffLedgerSpellings = true,
  staffNotationMode: StaffNotationMode = "grand"
): Set<TargetNoteId> {
  return new Set(
    getNotesForGroups(groupIds, includeInterStaffLedgerSpellings, staffNotationMode).map(
      (note) => note.id
    )
  );
}

export function normalizePracticeGroupIds(
  groupIds: readonly string[] | undefined
): PracticeGroupId[] {
  const normalized = normalizeCurrentPracticeGroupIds(groupIds);
  return normalized.length > 0 ? normalized : DEFAULT_ENABLED_GROUPS;
}

export function normalizeCurrentPracticeGroupIds(
  groupIds: readonly string[] | undefined
): PracticeGroupId[] {
  const selected = new Set<PracticeGroupId>();

  for (const groupId of groupIds ?? []) {
    if (isCurrentPracticeGroupId(groupId)) {
      selected.add(groupId);
      continue;
    }

    for (const legacyGroupIds of LEGACY_GROUP_ID_SEQUENCES) {
      const legacyIndex = legacyGroupIds.indexOf(groupId as PracticeGroupId);
      if (legacyIndex >= 0) {
        selected.add(currentGroupIdForLegacyPosition(legacyIndex, legacyGroupIds.length));
        break;
      }
    }
  }

  return CURRENT_GROUP_IDS.filter((groupId) => selected.has(groupId));
}

export function formatStaffLabel(staff: Staff): string {
  return staff === "treble" ? "高音谱号" : "低音谱号";
}

export function formatTargetNoteLabel(
  note: TargetNote,
  effectiveTargetNoteIds?: ReadonlySet<TargetNoteId>
): string {
  if (effectiveTargetNoteIds) {
    const samePitchCount = [...effectiveTargetNoteIds]
      .map((id) => ALL_NOTES_BY_ID.get(id))
      .filter((candidate) => candidate?.pitchId === note.pitchId).length;
    if (samePitchCount <= 1 && effectiveTargetNoteIds.has(note.id)) {
      return note.pitchId;
    }
  }
  return `${note.pitchId} · ${formatStaffLabel(note.staff)}`;
}

export function noteToVexKey(note: TargetNote): string {
  return `${note.noteName.toLowerCase()}/${note.octave}`;
}

export function noteToToneName(noteName: PianoKeyName, octave: Octave): string {
  return `${noteName}${octave}`;
}
