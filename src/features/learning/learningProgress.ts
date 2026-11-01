import { getStaffRecallTargetNoteSetKey } from "../../domain/staffRecall";
import type {
  AnswerEvent,
  DuetPracticeLevel,
  PracticeSessionRecord,
  PreReadingBufferSize,
  StaffRecallRunRecord,
} from "../../domain/types";
import type { LearningLevelId } from "../../routing/appRoutes";
import { getLearningModule, type GraduationCriteria } from "./learningModules";

export type LearningProgressStatus = "not-started" | "in-progress" | "mastered";

export interface LearningProgressSummary {
  status: LearningProgressStatus;
  detail: string;
}

const DUET_LEVELS: readonly DuetPracticeLevel[] = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
];

function isDuetEvent(event: AnswerEvent): boolean {
  return (
    event.mode === "free-practice" &&
    (Boolean(event.duetTargetNoteIds?.length) ||
      event.duetDifficulty !== undefined ||
      event.duetLevel !== undefined ||
      event.targetMidiHigh !== undefined ||
      event.targetMidiLow !== undefined)
  );
}

function isPracticeSample(event: AnswerEvent): boolean {
  return (
    event.wasInterrupted !== true &&
    event.wasSkipped !== true &&
    (event.isCorrectFinal !== null || event.isMissed)
  );
}

function firstTryAccuracy(events: readonly AnswerEvent[]): number {
  const samples = events.filter(isPracticeSample);
  return samples.length === 0
    ? 0
    : samples.filter((event) => event.isCorrectFirstTry === true).length / samples.length;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getGraduationCriteria<TKind extends GraduationCriteria["kind"]>(
  levelId: LearningLevelId,
  kind: TKind
): Extract<GraduationCriteria, { kind: TKind }> {
  const criteria = getLearningModule(levelId).graduationCriteria;
  if (criteria.kind !== kind) {
    throw new Error(`Level ${levelId} has unexpected graduation criteria: ${criteria.kind}`);
  }
  return criteria as Extract<GraduationCriteria, { kind: TKind }>;
}

function getSessionConfig(session: PracticeSessionRecord | undefined) {
  return session &&
    (session.schemaVersion === 3 || session.schemaVersion === 4 || session.schemaVersion === 5)
    ? session.startSnapshot.practiceConfig
    : undefined;
}

function duetLevelForEvent(
  event: AnswerEvent,
  sessionsById: ReadonlyMap<string, PracticeSessionRecord>
): DuetPracticeLevel | undefined {
  const eventLevel = event.duetLevel;
  if (eventLevel && DUET_LEVELS.includes(eventLevel)) return eventLevel;
  const configLevel = getSessionConfig(sessionsById.get(event.sessionId))?.duetLevel;
  return configLevel && DUET_LEVELS.includes(configLevel) ? configLevel : undefined;
}

function preReadingBufferForEvent(
  event: AnswerEvent,
  sessionsById: ReadonlyMap<string, PracticeSessionRecord>
): PreReadingBufferSize | undefined {
  const buffer =
    event.preReadingBufferSize ??
    getSessionConfig(sessionsById.get(event.sessionId))?.preReadingBufferSize;
  return buffer === 1 || buffer === 2 || buffer === 3 || buffer === 4 || buffer === 5
    ? buffer
    : undefined;
}

function isWithinCriteria(
  events: readonly AnswerEvent[],
  sampleCount: number,
  minAccuracy: number
): boolean {
  const samples = events.filter(isPracticeSample);
  return samples.length >= sampleCount && firstTryAccuracy(samples) >= minAccuracy;
}

export function evaluateLearningProgress({
  answerEvents,
  staffRecallRuns,
  practiceSessions,
}: {
  answerEvents: readonly AnswerEvent[];
  staffRecallRuns: readonly StaffRecallRunRecord[];
  practiceSessions: readonly PracticeSessionRecord[];
}): Record<LearningLevelId, LearningProgressSummary> {
  const sessionsById = new Map(practiceSessions.map((session) => [session.id, session]));
  const freeSingleNote = answerEvents.filter(
    (event) => event.mode === "free-practice" && !isDuetEvent(event)
  );
  const staffToName = answerEvents.filter((event) => event.mode === "staff-to-name");
  const nameToKey = answerEvents.filter((event) => event.mode === "name-to-key");
  const distance = answerEvents.filter(
    (event) =>
      event.mode === "staff-distance" &&
      (event.staffDistance?.trainingMode === "look" || event.staffDistance?.trainingMode === "play")
  );
  const preReading = answerEvents.filter((event) => event.mode === "pre-reading");
  const duetEvents = answerEvents.filter(isDuetEvent);
  const staffRecallCriteria = getGraduationCriteria(1, "staff-recall");
  const staffRecallTarget = staffRecallCriteria.completedRuns;
  const matchingRecallRuns = [...new Set(staffRecallRuns.map(getStaffRecallTargetNoteSetKey))]
    .map((key) => staffRecallRuns.filter((run) => getStaffRecallTargetNoteSetKey(run) === key))
    .reduce((best, runs) => (runs.length > best ? runs.length : best), 0);
  const levelOneActivity = staffRecallRuns.length > 0;
  const levelOneMastered = matchingRecallRuns >= staffRecallTarget;

  const singleCriteria = getGraduationCriteria(2, "single-note");
  const singleTarget = singleCriteria.sampleCount;
  const singleAccuracyTarget = singleCriteria.minFirstTryAccuracy;
  const singleResponseTarget = singleCriteria.maxAverageResponseMs;
  const singleSamples = freeSingleNote.filter(isPracticeSample);
  const singleResponseTimes = freeSingleNote
    .filter((event) => isPracticeSample(event))
    .map((event) => event.responseTimeMs ?? event.rawResponseTimeMs)
    .filter((value): value is number => value !== null && value !== undefined && value > 0);
  const averageSingleResponse = singleResponseTimes.length
    ? singleResponseTimes.reduce((sum, value) => sum + value, 0) / singleResponseTimes.length
    : Number.POSITIVE_INFINITY;
  const levelTwoMastered =
    singleSamples.length >= singleTarget &&
    singleResponseTimes.length >= singleTarget &&
    firstTryAccuracy(singleSamples) >= singleAccuracyTarget &&
    averageSingleResponse <= singleResponseTarget;

  const mappingCriteria = getGraduationCriteria(3, "name-mapping");
  const mappingTarget = mappingCriteria.sampleCountPerDirection;
  const mappingAccuracyTarget = mappingCriteria.minFirstTryAccuracy;
  const levelThreeMastered =
    isWithinCriteria(staffToName, mappingTarget, mappingAccuracyTarget) &&
    isWithinCriteria(nameToKey, mappingTarget, mappingAccuracyTarget);

  const distanceCriteria = getGraduationCriteria(4, "distance");
  const distanceTarget = distanceCriteria.sampleCount;
  const distanceAccuracyTarget = distanceCriteria.minFirstTryAccuracy;
  const distanceLook = distance.filter((event) => event.staffDistance?.trainingMode === "look");
  const distancePlay = distance.filter((event) => event.staffDistance?.trainingMode === "play");
  const levelFourMastered = [distanceLook, distancePlay].some((events) =>
    isWithinCriteria(events, distanceTarget, distanceAccuracyTarget)
  );

  const preReadingCriteria = getGraduationCriteria(5, "pre-reading");
  const preReadingBuffers = preReadingCriteria.buffers;
  const preReadingTarget = preReadingCriteria.sampleCountPerBuffer;
  const preReadingAccuracyTarget = preReadingCriteria.minFirstTryAccuracy;
  const preReadingByBuffer = new Map<PreReadingBufferSize, AnswerEvent[]>();
  for (const event of preReading) {
    const buffer = preReadingBufferForEvent(event, sessionsById);
    if (buffer === undefined) continue;
    const group = preReadingByBuffer.get(buffer) ?? [];
    group.push(event);
    preReadingByBuffer.set(buffer, group);
  }
  const levelFiveMastered = preReadingBuffers.every((buffer) =>
    isWithinCriteria(
      preReadingByBuffer.get(buffer) ?? [],
      preReadingTarget,
      preReadingAccuracyTarget
    )
  );

  const duetCriteria = getGraduationCriteria(6, "duet");
  const duetLevels = duetCriteria.levels;
  const duetTarget = duetCriteria.sampleCountPerLevel;
  const duetAccuracyTarget = duetCriteria.minFirstTryAccuracy;
  const duetByLevel = new Map<DuetPracticeLevel, AnswerEvent[]>();
  for (const event of duetEvents) {
    const level = duetLevelForEvent(event, sessionsById);
    if (!level) continue;
    const group = duetByLevel.get(level) ?? [];
    group.push(event);
    duetByLevel.set(level, group);
  }
  const levelSixMastered = duetLevels.every((level) =>
    isWithinCriteria(duetByLevel.get(level) ?? [], duetTarget, duetAccuracyTarget)
  );

  const activityByLevel = [
    levelOneActivity,
    freeSingleNote.length > 0,
    staffToName.length + nameToKey.length > 0,
    answerEvents.some((event) => event.mode === "staff-distance"),
    preReading.length > 0,
    duetEvents.length > 0,
  ];
  const masteredByLevel = [
    levelOneMastered,
    levelTwoMastered,
    levelThreeMastered,
    levelFourMastered,
    levelFiveMastered,
    levelSixMastered,
  ];
  const sampleCount = (events: readonly AnswerEvent[]): number =>
    events.filter(isPracticeSample).length;
  const countProgress = (events: readonly AnswerEvent[], target: number): string =>
    `${Math.min(sampleCount(events), target)}/${target}`;
  const responseDetail = Number.isFinite(averageSingleResponse)
    ? `${(averageSingleResponse / 1000).toFixed(1)} 秒`
    : "—";
  const detailByLevel = [
    `${Math.min(matchingRecallRuns, staffRecallTarget)}/${staffRecallTarget} 轮`,
    `${Math.min(singleSamples.length, singleTarget)}/${singleTarget} 题 · 首次答对 ${formatPercent(firstTryAccuracy(singleSamples))}（需 ${formatPercent(singleAccuracyTarget)}） · 平均 ${responseDetail}（需 ≤${(singleResponseTarget / 1000).toFixed(1)} 秒）`,
    `看谱认音 ${countProgress(staffToName, mappingTarget)} · 音名找键 ${countProgress(nameToKey, mappingTarget)}（首次答对需 ${formatPercent(mappingAccuracyTarget)}）`,
    `看谱 ${countProgress(distanceLook, distanceTarget)} · 弹奏 ${countProgress(distancePlay, distanceTarget)}（首次答对需 ${formatPercent(distanceAccuracyTarget)}）`,
    preReadingBuffers
      .map(
        (buffer) =>
          `提前 ${buffer} 音 ${countProgress(preReadingByBuffer.get(buffer) ?? [], preReadingTarget)}`
      )
      .join(" · ") + `（首次答对需 ${formatPercent(preReadingAccuracyTarget)}）`,
    `${duetLevels.filter((level) => isWithinCriteria(duetByLevel.get(level) ?? [], duetTarget, duetAccuracyTarget)).length}/${duetLevels.length} 个难度达标`,
  ];

  const result = {} as Record<LearningLevelId, LearningProgressSummary>;
  for (let index = 0; index < 6; index += 1) {
    const level = (index + 1) as LearningLevelId;
    const status = masteredByLevel[index]
      ? "mastered"
      : activityByLevel[index]
        ? "in-progress"
        : "not-started";
    result[level] = { status, detail: detailByLevel[index]! };
  }
  return result;
}
