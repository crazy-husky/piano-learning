import type {
  PitchId,
  Staff,
  StaffDistanceFingerBatch,
  StaffDistanceFingerHand,
  StaffDistanceFingerNumber,
  PracticeGroupId,
  TargetNote,
} from "./types";
import { staffPosition } from "./staffDistancePractice";

export interface StaffDistanceFingerCard {
  batch: StaffDistanceFingerBatch;
  reference: TargetNote;
  target: TargetNote;
}

interface FingerRange {
  lower: number;
  upper: number;
}

export interface StaffDistanceFingerProfile extends FingerRange {
  lineAnchorPitchId: PitchId;
  spaceAnchorPitchId: PitchId;
  staff: Staff;
}

const FINGER_RANGES: Record<
  StaffDistanceFingerHand,
  Record<StaffDistanceFingerNumber, FingerRange>
> = {
  right: {
    1: { lower: 2, upper: 5 },
    2: { lower: 3, upper: 4 },
    3: { lower: 4, upper: 3 },
    4: { lower: 5, upper: 2 },
    5: { lower: 6, upper: 1 },
  },
  left: {
    1: { lower: 5, upper: 2 },
    2: { lower: 4, upper: 3 },
    3: { lower: 3, upper: 4 },
    4: { lower: 2, upper: 5 },
    5: { lower: 1, upper: 6 },
  },
};

const LINE_ANCHORS: Record<StaffDistanceFingerHand, Record<StaffDistanceFingerNumber, PitchId>> = {
  right: {
    1: "E4",
    2: "G4",
    3: "B4",
    4: "D5",
    5: "F5",
  },
  left: {
    1: "F3",
    2: "D3",
    3: "B2",
    4: "G2",
    5: "E2",
  },
};

const SPACE_ANCHORS: Record<StaffDistanceFingerHand, Record<StaffDistanceFingerNumber, PitchId>> = {
  right: {
    1: "F4",
    2: "A4",
    3: "C5",
    4: "E5",
    5: "G5",
  },
  left: {
    1: "G3",
    2: "E3",
    3: "C3",
    4: "A2",
    5: "F2",
  },
};

const FINGER_GROUP_IDS: Record<StaffDistanceFingerHand, readonly PracticeGroupId[]> = {
  right: ["C4-B4", "C5-B5"],
  left: ["C2-B2", "C3-B3"],
};

export function getStaffDistanceFingerGroupIds(hand: StaffDistanceFingerHand): PracticeGroupId[] {
  return [...FINGER_GROUP_IDS[hand]];
}

export function getStaffDistanceFingerProfile(
  hand: StaffDistanceFingerHand,
  finger: StaffDistanceFingerNumber
): StaffDistanceFingerProfile {
  return {
    ...FINGER_RANGES[hand][finger],
    lineAnchorPitchId: LINE_ANCHORS[hand][finger],
    spaceAnchorPitchId: SPACE_ANCHORS[hand][finger],
    staff: hand === "right" ? "treble" : "bass",
  };
}

function shuffledWithoutAdjacentDuplicates(
  targets: readonly TargetNote[],
  random: () => number,
  previousPitchId?: TargetNote["pitchId"]
): TargetNote[] {
  const remaining = targets.flatMap((target) => [target, target]);
  const result: TargetNote[] = [];
  let previous = previousPitchId;

  while (remaining.length > 0) {
    const eligibleIndexes = remaining.flatMap((target, index) =>
      target.pitchId === previous ? [] : [index]
    );
    const choices =
      eligibleIndexes.length > 0 ? eligibleIndexes : remaining.map((_, index) => index);
    const sampled = random();
    const randomIndex = Number.isFinite(sampled) ? Math.max(0, Math.min(0.999999, sampled)) : 0;
    const pickedIndex = choices[Math.floor(randomIndex * choices.length)]!;
    const [picked] = remaining.splice(pickedIndex, 1);
    if (picked) {
      result.push(picked);
      previous = picked.pitchId;
    }
  }

  return result;
}

function noteForStaffPosition(
  notesByPosition: ReadonlyMap<number, TargetNote>,
  position: number,
  staff: Staff
): TargetNote | undefined {
  const note = notesByPosition.get(position);
  return note?.staff === staff ? note : undefined;
}

export function createStaffDistanceFingerCards(
  availableNotes: readonly TargetNote[],
  hand: StaffDistanceFingerHand,
  finger: StaffDistanceFingerNumber,
  random: () => number = Math.random
): { cards: StaffDistanceFingerCard[]; error?: undefined } | { cards: []; error: string } {
  const profile = getStaffDistanceFingerProfile(hand, finger);
  const staff = profile.staff;
  const notesByPosition = new Map<number, TargetNote>();
  for (const note of availableNotes) {
    if (note.staff === staff && note.accidental === undefined) {
      notesByPosition.set(staffPosition(note), note);
    }
  }

  const lineAnchor = availableNotes.find(
    (note) => note.pitchId === profile.lineAnchorPitchId && note.staff === staff
  );
  if (!lineAnchor) {
    return {
      cards: [],
      error: "单指专项固定音域无法生成所选手指的参考音，请切换手别或手指后重试。",
    };
  }

  const { lower, upper } = profile;
  const anchorPositions = [staffPosition(lineAnchor), staffPosition(lineAnchor) + 1] as const;
  const batches: Array<{
    batch: StaffDistanceFingerBatch;
    reference: TargetNote;
    targets: TargetNote[];
  }> = [];

  for (const [batchIndex, batch] of (["line", "space"] as const).entries()) {
    const reference = noteForStaffPosition(notesByPosition, anchorPositions[batchIndex]!, staff);
    const expectedPitchId =
      batch === "line" ? profile.lineAnchorPitchId : profile.spaceAnchorPitchId;
    if (!reference || reference.pitchId !== expectedPitchId) {
      return { cards: [], error: "单指专项固定音域缺少线上或间上的参考音，暂时无法开始。" };
    }
    const targetPositions = Array.from(
      { length: lower + upper + 1 },
      (_, index) => staffPosition(reference) - lower + index
    ).filter((position) => position !== staffPosition(reference));
    const targets = targetPositions.map((position) =>
      noteForStaffPosition(notesByPosition, position, staff)
    );
    if (targets.some((target) => target === undefined) || targets.length !== 7) {
      return { cards: [], error: "单指专项固定音域无法覆盖所选手指的完整活动范围，暂时无法开始。" };
    }
    batches.push({
      batch,
      reference,
      targets: targets.filter((target): target is TargetNote => target !== undefined),
    });
  }

  const cards: StaffDistanceFingerCard[] = [];
  let previousTargetPitchId: TargetNote["pitchId"] | undefined;
  for (const { batch, reference, targets } of batches) {
    const shuffled = shuffledWithoutAdjacentDuplicates(targets, random, previousTargetPitchId);
    cards.push(...shuffled.map((target) => ({ batch, reference, target })));
    previousTargetPitchId = shuffled.at(-1)?.pitchId;
  }

  return { cards };
}
