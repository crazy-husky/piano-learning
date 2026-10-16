import type {
  PitchId,
  PracticeGroupId,
  StaffDistanceDirection,
  StaffDistancePracticeSettings,
  TargetNote,
} from "./types";
import { PITCH_OCTAVE_GROUPS } from "./notes";

export const MAX_STAFF_DISTANCE = 7;
const LONG_LEAP_MIN_DISTANCE = 5;
const DISTANCE_BALANCE_WINDOW = 20;

export type StaffDistanceValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "need-two-groups" | "only-one-answer" | "missing-distances";
      missing?: number[];
    };

interface StaffDistanceEdge {
  direction: StaffDistanceDirection;
  distance: number;
  note: TargetNote;
}

interface StaffDistancePhrase {
  direction: Exclude<StaffDistanceDirection, "same">;
  notes: TargetNote[];
}

const NOTE_ORDER = new Map([
  ["C", 0],
  ["D", 1],
  ["E", 2],
  ["F", 3],
  ["G", 4],
  ["A", 5],
  ["B", 6],
]);

export function staffPosition(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * 7 + (NOTE_ORDER.get(note.noteName) ?? 0);
}

export function staffDistance(
  from: Pick<TargetNote, "noteName" | "octave">,
  to: Pick<TargetNote, "noteName" | "octave">
): number {
  return Math.abs(staffPosition(to) - staffPosition(from));
}

function getEdges(
  from: TargetNote,
  notes: readonly TargetNote[],
  settings: StaffDistancePracticeSettings
): StaffDistanceEdge[] {
  return notes.flatMap((note) => {
    if (note.staff !== from.staff) return [];
    const delta = staffPosition(note) - staffPosition(from);
    const distance = Math.abs(delta);
    if (distance > settings.maxDistance || (distance === 0 && !settings.includeUnison)) {
      return [];
    }
    return [
      {
        direction: delta === 0 ? "same" : delta > 0 ? "up" : "down",
        distance,
        note,
      },
    ];
  });
}

export function validateStaffDistancePractice(
  notes: readonly TargetNote[],
  selectedRangeIds: readonly (PitchId | PracticeGroupId)[],
  settings: StaffDistancePracticeSettings
): StaffDistanceValidation {
  if (settings.maxDistance === 7 && !hasTwoConsecutiveSelectedGroups(selectedRangeIds)) {
    return { ok: false, reason: "need-two-groups" };
  }
  if (settings.maxDistance === 1 && !settings.includeUnison) {
    return { ok: false, reason: "only-one-answer" };
  }
  const availableDistances = new Set<number>();
  for (const note of notes) {
    for (const edge of getEdges(note, notes, settings)) {
      availableDistances.add(edge.distance);
    }
  }
  const requestedDistances = [
    ...(settings.includeUnison ? [0] : []),
    ...Array.from({ length: settings.maxDistance }, (_, index) => index + 1),
  ];
  const missing = requestedDistances.filter((distance) => !availableDistances.has(distance));
  return missing.length > 0 ? { ok: false, reason: "missing-distances", missing } : { ok: true };
}

function hasTwoConsecutiveSelectedGroups(
  selectedRangeIds: readonly (PitchId | PracticeGroupId)[]
): boolean {
  if (selectedRangeIds.length === 0) return false;
  if (selectedRangeIds[0]!.includes("-")) {
    const groupOrder: readonly PracticeGroupId[] = ["F1-F2", "G2-F3", "G3-F4", "G4-F5", "G5-G6"];
    const selected = new Set(selectedRangeIds as readonly PracticeGroupId[]);
    return groupOrder.some(
      (groupId, index) => selected.has(groupId) && selected.has(groupOrder[index + 1]!)
    );
  }
  const selectedPitchIds = new Set(selectedRangeIds as readonly PitchId[]);
  const selectedGroupIndexes = PITCH_OCTAVE_GROUPS.flatMap((group, index) =>
    group.pitchIds.some((pitchId) => selectedPitchIds.has(pitchId)) ? [index] : []
  );
  return selectedGroupIndexes.some((groupIndex) => selectedGroupIndexes.includes(groupIndex + 1));
}

function semitonePosition(note: TargetNote): number {
  const semitonesByName: Record<TargetNote["noteName"], number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const accidentalOffset = note.accidental === "sharp" ? 1 : note.accidental === "flat" ? -1 : 0;
  return (note.octave + 1) * 12 + semitonesByName[note.noteName] + accidentalOffset;
}

function createBassChordPhrases(
  notes: readonly TargetNote[],
  settings: StaffDistancePracticeSettings
): Map<TargetNote["id"], StaffDistancePhrase[]> {
  const bassNotesBySemitone = new Map<number, TargetNote>();
  for (const note of notes) {
    if (note.staff === "bass") bassNotesBySemitone.set(semitonePosition(note), note);
  }
  const phrasesByStart = new Map<TargetNote["id"], StaffDistancePhrase[]>();
  const chordQualities = [
    { third: 4, fifth: 7 },
    { third: 3, fifth: 7 },
  ] as const;
  const addPhrase = (phraseNotes: TargetNote[]): void => {
    if (phraseNotes.length < 3) return;
    for (let index = 1; index < phraseNotes.length; index += 1) {
      const distance = staffDistance(phraseNotes[index - 1]!, phraseNotes[index]!);
      if (distance === 0 || distance > settings.maxDistance) return;
    }
    const direction =
      staffPosition(phraseNotes[phraseNotes.length - 1]!) > staffPosition(phraseNotes[0]!)
        ? "up"
        : "down";
    const phrase = { direction, notes: phraseNotes } satisfies StaffDistancePhrase;
    const existing = phrasesByStart.get(phraseNotes[0]!.id) ?? [];
    existing.push(phrase);
    phrasesByStart.set(phraseNotes[0]!.id, existing);
  };

  for (const root of bassNotesBySemitone.values()) {
    const rootSemitones = semitonePosition(root);
    for (const quality of chordQualities) {
      const rootNote = bassNotesBySemitone.get(rootSemitones);
      const thirdNote = bassNotesBySemitone.get(rootSemitones + quality.third);
      const fifthNote = bassNotesBySemitone.get(rootSemitones + quality.fifth);
      const octaveNote = bassNotesBySemitone.get(rootSemitones + 12);
      if (!rootNote || !thirdNote || !fifthNote || !octaveNote) continue;
      addPhrase([rootNote, thirdNote, fifthNote, octaveNote]);
      addPhrase([octaveNote, fifthNote, thirdNote, rootNote]);
      addPhrase([rootNote, fifthNote, octaveNote]);
      addPhrase([octaveNote, fifthNote, rootNote]);
    }
  }
  return phrasesByStart;
}

function weightedPick<T>(
  items: readonly T[],
  weightFor: (item: T) => number,
  random: () => number
): T {
  const totalWeight = items.reduce((total, item) => total + weightFor(item), 0);
  let threshold = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
  for (const item of items) {
    threshold -= weightFor(item);
    if (threshold < 0) return item;
  }
  return items[items.length - 1]!;
}

function nonUnisonDistanceWeight(distance: number, staff: TargetNote["staff"]): number {
  if (staff === "treble") {
    if (distance <= 2) return 0.3;
    if (distance === 3) return 0.2;
    if (distance === 4) return 0.1;
    return 0.1 / 3;
  }
  if (distance <= 2) return 0.25 / 2;
  if (distance <= 4) return 0.35 / 2;
  return 0.4 / 3;
}

function distanceWeight(
  distance: number,
  staff: TargetNote["staff"],
  availableDistances: readonly number[]
): number {
  const includesUnison = availableDistances.includes(0);
  if (distance === 0) {
    const nonUnisonTotal = availableDistances
      .filter((candidate) => candidate > 0)
      .reduce((total, candidate) => total + nonUnisonDistanceWeight(candidate, staff), 0);
    return nonUnisonTotal > 0 ? 0.05 : 1;
  }

  const weight = nonUnisonDistanceWeight(distance, staff);
  if (!includesUnison) return weight;
  const nonUnisonTotal = availableDistances
    .filter((candidate) => candidate > 0)
    .reduce((total, candidate) => total + nonUnisonDistanceWeight(candidate, staff), 0);
  return nonUnisonTotal > 0 ? (weight / nonUnisonTotal) * 0.95 : weight;
}

function chooseBalancedDirection(
  edges: readonly StaffDistanceEdge[],
  directionCounts: ReadonlyMap<Exclude<StaffDistanceDirection, "same">, number>,
  random: () => number
): Exclude<StaffDistanceDirection, "same"> | "same" {
  const availableDirections = [...new Set(edges.map((edge) => edge.direction))];
  if (availableDirections.includes("same")) return "same";
  const directional = availableDirections as Exclude<StaffDistanceDirection, "same">[];
  const leastUsedCount = Math.min(
    ...directional.map((direction) => directionCounts.get(direction) ?? 0)
  );
  const leastUsed = directional.filter(
    (direction) => (directionCounts.get(direction) ?? 0) === leastUsedCount
  );
  return leastUsed[Math.min(leastUsed.length - 1, Math.floor(random() * leastUsed.length))]!;
}

function findNotePath(
  start: TargetNote,
  target: TargetNote,
  edgesById: ReadonlyMap<TargetNote["id"], readonly StaffDistanceEdge[]>
): TargetNote[] | undefined {
  const queue = [start];
  const previousById = new Map<TargetNote["id"], TargetNote["id"] | null>([[start.id, null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current.id === target.id) break;
    for (const edge of edgesById.get(current.id) ?? []) {
      if (edge.direction === "same" || previousById.has(edge.note.id)) continue;
      previousById.set(edge.note.id, current.id);
      queue.push(edge.note);
    }
  }
  if (!previousById.has(target.id)) return undefined;

  const path = [target];
  let currentId = target.id;
  while (currentId !== start.id) {
    const previousId = previousById.get(currentId);
    if (!previousId) return undefined;
    const previous = queue.find((note) => note.id === previousId);
    if (!previous) return undefined;
    path.push(previous);
    currentId = previousId;
  }
  return path.reverse();
}

function findBalancedLongLeapRoute(
  current: TargetNote,
  notes: readonly TargetNote[],
  edgesById: ReadonlyMap<TargetNote["id"], readonly StaffDistanceEdge[]>,
  maxTransitions: number,
  random: () => number
): TargetNote[] | undefined {
  const longUpEdges = notes.flatMap((lowNote) =>
    (edgesById.get(lowNote.id) ?? [])
      .filter((edge) => edge.direction === "up" && edge.distance >= LONG_LEAP_MIN_DISTANCE)
      .map((edge) => ({ highNote: edge.note, lowNote }))
  );
  const longDownEdges = notes.flatMap((highNote) =>
    (edgesById.get(highNote.id) ?? [])
      .filter((edge) => edge.direction === "down" && edge.distance >= LONG_LEAP_MIN_DISTANCE)
      .map((edge) => ({ highNote, lowNote: edge.note }))
  );
  const pathCache = new Map<string, TargetNote[] | undefined>();
  const pathBetween = (start: TargetNote, target: TargetNote): TargetNote[] | undefined => {
    const key = `${start.id}->${target.id}`;
    if (!pathCache.has(key)) pathCache.set(key, findNotePath(start, target, edgesById));
    return pathCache.get(key);
  };
  const routes: TargetNote[][] = [];
  for (const up of longUpEdges) {
    const pathToUp = pathBetween(current, up.lowNote);
    if (!pathToUp) continue;
    for (const down of longDownEdges) {
      if (up.lowNote.id === down.lowNote.id && up.highNote.id === down.highNote.id) continue;
      const pathToDown = pathBetween(up.highNote, down.highNote);
      if (!pathToDown) continue;
      const route = [...pathToUp.slice(1), up.highNote, ...pathToDown.slice(1), down.lowNote];
      if (route.length <= maxTransitions) routes.push(route);
    }
  }
  if (routes.length > 0) {
    return routes[Math.min(routes.length - 1, Math.max(0, Math.floor(random() * routes.length)))];
  }

  // A very narrow selection may have only one long-leap pair. Use it both ways
  // so each 20-question block still practices both directions when possible.
  const fallbackRoutes = longUpEdges.flatMap((edge) => {
    const path = pathBetween(current, edge.lowNote);
    if (!path || path.length - 1 + 2 > maxTransitions) return [];
    return [[...path.slice(1), edge.highNote, edge.lowNote]];
  });
  return fallbackRoutes.length === 0
    ? undefined
    : fallbackRoutes[
        Math.min(
          fallbackRoutes.length - 1,
          Math.max(0, Math.floor(random() * fallbackRoutes.length))
        )
      ];
}

export function createStaffDistanceSequence(
  notes: readonly TargetNote[],
  settings: StaffDistancePracticeSettings,
  transitionCount: number,
  random: () => number = Math.random,
  initialNote?: TargetNote,
  extraPitchIds: readonly PitchId[] = []
): TargetNote[] {
  if (transitionCount <= 0 || notes.length === 0) return [];
  const extraPitchIdSet = new Set(extraPitchIds);
  const targetWeight = (note: TargetNote): number => (extraPitchIdSet.has(note.pitchId) ? 0.15 : 1);
  const edgesById = new Map(notes.map((note) => [note.id, getEdges(note, notes, settings)]));
  const coreNotes = notes.filter((note) => !extraPitchIdSet.has(note.pitchId));
  const longLeapNotes = coreNotes.length > 0 ? coreNotes : notes;
  const longLeapEdgesById = new Map(
    longLeapNotes.map((note) => [note.id, getEdges(note, longLeapNotes, settings)])
  );
  const hasAvailableLongLeap = [...longLeapEdgesById.values()].some((edges) =>
    edges.some((edge) => edge.distance >= LONG_LEAP_MIN_DISTANCE)
  );
  const starts = initialNote
    ? [initialNote]
    : notes.filter((note) => {
        const edges = edgesById.get(note.id) ?? [];
        return (
          edges.length > 0 &&
          (!hasAvailableLongLeap || edges.some((edge) => edge.distance >= LONG_LEAP_MIN_DISTANCE))
        );
      });
  if (starts.length === 0) return [];
  let current = weightedPick(starts, targetWeight, random);
  const sequence = [current];
  const directionCounts = new Map<"up" | "down", number>([
    ["up", 0],
    ["down", 0],
  ]);
  const chordPhrases = createBassChordPhrases(notes, settings);
  let activeBalanceWindow = -1;
  let forcedLongLeapWindow = -1;
  let forceLongLeapAfter = 0;
  while (sequence.length <= transitionCount) {
    const edges = edgesById.get(current.id) ?? [];
    if (edges.length === 0) break;
    const remainingTransitions = transitionCount - (sequence.length - 1);
    const completedTransitions = sequence.length - 1;
    const balanceWindow = Math.floor(completedTransitions / DISTANCE_BALANCE_WINDOW);
    const transitionInWindow = completedTransitions % DISTANCE_BALANCE_WINDOW;
    if (balanceWindow !== activeBalanceWindow) {
      activeBalanceWindow = balanceWindow;
      forceLongLeapAfter = Math.floor(random() * 11);
    }

    if (
      settings.maxDistance >= LONG_LEAP_MIN_DISTANCE &&
      hasAvailableLongLeap &&
      forcedLongLeapWindow !== balanceWindow &&
      transitionInWindow >= forceLongLeapAfter
    ) {
      const transitionsLeftInWindow = DISTANCE_BALANCE_WINDOW - transitionInWindow;
      const route = findBalancedLongLeapRoute(
        current,
        longLeapNotes,
        longLeapEdgesById,
        Math.min(remainingTransitions, transitionsLeftInWindow),
        random
      );
      if (route) {
        for (const note of route) {
          const pair = summarizeStaffDistancePair(current, note);
          if (pair.direction !== "same") {
            directionCounts.set(pair.direction, (directionCounts.get(pair.direction) ?? 0) + 1);
          }
          current = note;
          sequence.push(note);
        }
        forcedLongLeapWindow = balanceWindow;
        continue;
      }
    }

    const bassPhrases =
      current.staff === "bass"
        ? (chordPhrases.get(current.id) ?? []).filter(
            (phrase) =>
              phrase.notes.every((note) => !extraPitchIdSet.has(note.pitchId)) &&
              phrase.notes.length - 1 <= remainingTransitions &&
              phrase.notes.length - 1 <= DISTANCE_BALANCE_WINDOW - transitionInWindow
          )
        : [];
    if (bassPhrases.length > 0 && random() < 0.45) {
      const leastUsedCount = Math.min(
        ...bassPhrases.map((phrase) => directionCounts.get(phrase.direction) ?? 0)
      );
      const directionalPhrases = bassPhrases.filter(
        (phrase) => (directionCounts.get(phrase.direction) ?? 0) === leastUsedCount
      );
      const phrase = weightedPick(directionalPhrases, () => 1, random);
      for (const note of phrase.notes.slice(1)) {
        directionCounts.set(phrase.direction, (directionCounts.get(phrase.direction) ?? 0) + 1);
        current = note;
        sequence.push(current);
      }
      continue;
    }

    const distances = [...new Set(edges.map((edge) => edge.distance))];
    const distance = weightedPick(
      distances,
      (candidate) => distanceWeight(candidate, current.staff, distances),
      random
    );
    const sameDistanceEdges = edges.filter((edge) => edge.distance === distance);
    const direction = chooseBalancedDirection(sameDistanceEdges, directionCounts, random);
    const directionEdges = sameDistanceEdges.filter((edge) => edge.direction === direction);
    const edge = weightedPick(directionEdges, (candidate) => targetWeight(candidate.note), random);
    if (edge.direction !== "same") {
      directionCounts.set(edge.direction, (directionCounts.get(edge.direction) ?? 0) + 1);
    }
    current = edge.note;
    sequence.push(current);
  }
  return sequence;
}

export function summarizeStaffDistancePair(
  from: TargetNote,
  to: TargetNote
): Pick<StaffDistanceEdge, "direction" | "distance"> {
  const delta = staffPosition(to) - staffPosition(from);
  return {
    direction: delta === 0 ? "same" : delta > 0 ? "up" : "down",
    distance: Math.abs(delta),
  };
}
