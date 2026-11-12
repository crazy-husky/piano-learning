import { ALL_NOTES, PITCH_OCTAVE_GROUPS } from "../../../domain/notes";
import { getTargetMidiNoteNumber } from "../../../domain/answerInput";
import type {
  AnswerEvent,
  DuetPracticeLevel,
  PracticeSessionRecord,
  PreReadingBufferSize,
  StaffDistanceTrainingMode,
  StaffRecallRunRecord,
} from "../../../domain/types";
import type { LearningLevelId } from "../../../routing/appRoutes";

export type LearningStatsRange =
  "1" | "3" | "7" | "15" | "30" | "90" | "180" | "365" | "all" | "custom";
export type LearningStatsMetric = "accuracy" | "response" | "volume" | "duration";
export type LearningStatsDimension = "all" | string;
export type WeakPracticeItem = {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  firstSeenAt?: string;
  lastSeenAt: string;
  event?: AnswerEvent;
  events?: AnswerEvent[];
  noteIds: string[];
  averageMs?: number;
};

export const LEARNING_STATS_RANGES: readonly { value: LearningStatsRange; label: string }[] = [
  { value: "1", label: "近一天" },
  { value: "3", label: "近三天" },
  { value: "7", label: "近 7 天" },
  { value: "15", label: "近半月" },
  { value: "30", label: "近一个月" },
  { value: "90", label: "近三个月" },
  { value: "180", label: "近半年" },
  { value: "365", label: "近一年" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义日期" },
];

export const LEARNING_STATS_PITCH_OPTIONS = [
  { value: "all", label: "全部音区" },
  ...PITCH_OCTAVE_GROUPS.map((group) => ({
    value: group.pitchIds[0]?.slice(-1) ?? "all",
    label: `${group.label} · ${group.rangeLabel}`,
  })),
];

const DUET_LEVELS: readonly DuetPracticeLevel[] = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
];

export function getLearningStatsDimensions(levelId: LearningLevelId) {
  if (levelId === 3) {
    return [
      { value: "all", label: "全部训练方式" },
      { value: "staff-to-name", label: "看谱认音" },
      { value: "name-to-key", label: "音名找键" },
    ];
  }
  if (levelId === 4) {
    return [
      { value: "all", label: "全部训练方式" },
      { value: "look", label: "看间距" },
      { value: "play", label: "弹间距" },
      { value: "finger", label: "手指练习" },
    ];
  }
  if (levelId === 5) {
    return [
      { value: "all", label: "全部预读深度" },
      ...([1, 2, 3, 4, 5] as PreReadingBufferSize[]).map((size) => ({
        value: String(size),
        label: `提前 ${size} 个音`,
      })),
    ];
  }
  if (levelId === 6) {
    return [...DUET_LEVELS.map((value, index) => ({ value, label: `L${index + 1}` }))];
  }
  if (levelId === 7) {
    return [
      { value: "all", label: "全部输入方式" },
      { value: "midi", label: "MIDI 键盘" },
      { value: "microphone", label: "麦克风" },
    ];
  }
  return [{ value: "all", label: "全部训练方式" }];
}

function getSessionConfig(session: PracticeSessionRecord | undefined) {
  return session && "startSnapshot" in session ? session.startSnapshot.practiceConfig : undefined;
}

export function getEventDimension(
  levelId: LearningLevelId,
  event: AnswerEvent,
  sessionsById: ReadonlyMap<string, PracticeSessionRecord>
): string {
  const session = sessionsById.get(event.sessionId);
  if (levelId === 3) return event.mode;
  if (levelId === 4) {
    const mode: StaffDistanceTrainingMode | undefined =
      event.staffDistance?.trainingMode ?? session?.staffDistance?.trainingMode;
    return mode ?? "unclassified";
  }
  if (levelId === 5) {
    const size = event.preReadingBufferSize ?? getSessionConfig(session)?.preReadingBufferSize;
    return size === undefined ? "unclassified" : String(size);
  }
  if (levelId === 6) {
    const level = event.duetLevel ?? getSessionConfig(session)?.duetLevel;
    return level && DUET_LEVELS.includes(level) ? level : "unclassified";
  }
  if (levelId === 7) return event.inputMode;
  return "all";
}

export function getEventPitchMidiValues(event: AnswerEvent): number[] {
  const values = [
    event.targetMidi,
    event.targetMidiHigh,
    event.targetMidiLow,
    ...(event.duetTargetMidis?.treble ?? []),
    ...(event.duetTargetMidis?.bass ?? []),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length) return [...new Set(values)];
  const id = event.targetNoteId;
  if (!id) return [];
  const note = ALL_NOTES.find((candidate) => candidate.id === id);
  return note ? [getTargetMidiNoteNumber(note)] : [];
}

function isInPitchGroup(midi: number, octaveValue: string): boolean {
  const octave = Number(octaveValue);
  if (!Number.isInteger(octave)) return true;
  const start = (octave + 1) * 12;
  return midi >= start && midi <= start + 11;
}

export function eventMatchesPitchGroup(event: AnswerEvent, pitchGroup: string): boolean {
  if (pitchGroup === "all") return true;
  const values = getEventPitchMidiValues(event);
  return values.some((midi) => isInPitchGroup(midi, pitchGroup));
}

export function eventMatchesPitchGroups(
  event: AnswerEvent,
  pitchGroups: readonly string[]
): boolean {
  return (
    pitchGroups.length === 0 ||
    pitchGroups.includes("all") ||
    pitchGroups.some((pitchGroup) => eventMatchesPitchGroup(event, pitchGroup))
  );
}

export function eventMatchesLevel(event: AnswerEvent, levelId: LearningLevelId): boolean {
  if (event.learningLevelId !== levelId) return false;
  if (levelId === 2) return event.mode === "free-practice";
  if (levelId === 3) return event.mode === "staff-to-name" || event.mode === "name-to-key";
  if (levelId === 4) return event.mode === "staff-distance";
  if (levelId === 5) return event.mode === "pre-reading";
  if (levelId === 6) {
    return (
      event.mode === "free-practice" &&
      Boolean(
        event.duetTargetNoteIds?.length || event.duetLevel || event.targetMidiHigh !== undefined
      )
    );
  }
  if (levelId === 7) return event.mode === "blind-practice";
  return false;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isWithinLearningStatsRange(
  timestamp: string,
  range: LearningStatsRange,
  customStart: string,
  customEnd: string,
  now = new Date()
): boolean {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  if (range === "all") return true;
  if (range === "custom") {
    const key = localDateKey(date);
    return (!customStart || key >= customStart) && (!customEnd || key <= customEnd);
  }
  const days = Number(range);
  const cutoff = new Date(now.getTime() - Math.max(0, days) * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}

export function getEventTargetIds(event: AnswerEvent): string[] {
  return [
    ...new Set([event.targetNoteId, ...(event.duetTargetNoteIds ?? [])].filter(Boolean)),
  ] as string[];
}

export function formatLearningNoteId(noteId: string): string {
  const note = ALL_NOTES.find((candidate) => candidate.id === noteId);
  return note ? `${note.noteName}${note.octave}` : noteId;
}

export function getEventPromptLabel(event: AnswerEvent): string {
  if (event.mode === "staff-distance") {
    const distance = event.staffDistance?.distance;
    const direction = event.staffDistance?.direction;
    if (distance !== undefined) {
      if (direction === "same") return "同音";
      return `${direction === "down" ? "向下" : "向上"}${distance} 度`;
    }
  }
  if (event.duetTargetNoteIds?.length) return `双手组合 · ${event.duetTargetNoteIds.length} 个音`;
  return (
    event.targetDisplayName ??
    (event.targetNoteId ? formatLearningNoteId(event.targetNoteId) : event.targetNoteName) ??
    "目标音"
  );
}

export function getLearningEventKey(event: AnswerEvent, levelId: LearningLevelId): string {
  const pitch =
    event.targetMidi ?? event.targetNoteId ?? event.targetDisplayName ?? event.eventIndex;
  if (
    levelId === 3 &&
    event.mode === "name-to-key" &&
    !event.nameToKeyConfig?.includeOctaveNumbers
  ) {
    return `${event.mode}:${event.targetDisplayName ?? event.targetNoteName ?? pitch}`;
  }
  if (levelId === 4) {
    return `staff-distance:${event.staffDistance?.trainingMode ?? "unknown"}:${event.staffDistance?.direction ?? "?"}:${event.staffDistance?.distance ?? "?"}`;
  }
  if (levelId === 5) {
    return `pre-reading:${event.preReadingBufferSize ?? "?"}:${pitch}`;
  }
  if (levelId === 6) {
    const notes = [...(event.duetTargetNoteIds ?? getEventTargetIds(event))].sort().join("+");
    return `duet:${event.duetLevel ?? "?"}:${notes || pitch}`;
  }
  return `${event.mode}:${pitch}`;
}

export function buildWeakPracticeItems(
  events: readonly AnswerEvent[],
  levelId: LearningLevelId
): WeakPracticeItem[] {
  if (levelId === 1) return [];
  const byKey = new Map<string, WeakPracticeItem>();
  for (const event of events) {
    if (event.wasInterrupted === true || event.wasSkipped === true) continue;
    if (!(event.isCorrectFirstTry === false || event.isMissed || event.wrongAttempts > 0)) continue;
    const noteIds = getEventTargetIds(event);
    const key = getLearningEventKey(event, levelId);
    const previous = byKey.get(key);
    const title = getEventPromptLabel(event);
    const subtitle =
      event.mode === "name-to-key"
        ? "音名找键"
        : event.mode === "staff-to-name"
          ? "看谱认音"
          : event.mode === "pre-reading"
            ? `提前 ${event.preReadingBufferSize ?? "?"} 个音`
            : event.mode === "staff-distance"
              ? event.staffDistance?.trainingMode === "look"
                ? "看间距"
                : event.staffDistance?.trainingMode === "play"
                  ? "弹间距"
                  : event.staffDistance?.trainingMode === "finger"
                    ? "手指练习"
                    : "音距速推"
              : levelId === 6
                ? `双手协同 · ${event.duetLevel ?? "等级未知"}`
                : levelId === 7
                  ? "盲弹练习"
                  : "单音练习";
    if (previous) {
      previous.count += 1;
      previous.events?.push(event);
      if (event.occurredAt < (previous.firstSeenAt ?? previous.lastSeenAt))
        previous.firstSeenAt = event.occurredAt;
      if (event.occurredAt > previous.lastSeenAt) {
        previous.lastSeenAt = event.occurredAt;
        previous.event = event;
      }
      continue;
    }
    byKey.set(key, {
      id: key,
      title,
      subtitle,
      count: 1,
      firstSeenAt: event.occurredAt,
      lastSeenAt: event.occurredAt,
      event,
      events: [event],
      noteIds,
    });
  }
  return [...byKey.values()].sort(
    (left, right) => right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt)
  );
}

export function getCorrectEventChoices(
  events: readonly AnswerEvent[],
  weakItems: readonly WeakPracticeItem[],
  levelId: LearningLevelId
): AnswerEvent[] {
  const weakKeys = new Set(
    weakItems.flatMap((item) => (item.event ? [getLearningEventKey(item.event, levelId)] : []))
  );
  const seenKeys = new Set<string>();
  return events
    .filter(
      (event) =>
        event.isCorrectFirstTry === true && !weakKeys.has(getLearningEventKey(event, levelId))
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .filter((event) => {
      const key = getLearningEventKey(event, levelId);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
}

export function getAnswerDisplay(event: AnswerEvent): string {
  const incorrectAttempt = event.attempts.find(
    (attempt) => !attempt.isCorrect && !attempt.isLateForPrevious
  );
  const midi = incorrectAttempt?.midi ?? event.recognizedMidi;
  if (midi !== undefined) {
    const note = ALL_NOTES.find((candidate) => getTargetMidiNoteNumber(candidate) === midi);
    return note ? formatLearningNoteId(note.id) : `MIDI ${midi}`;
  }
  if (incorrectAttempt?.noteName) return incorrectAttempt.noteName;
  const distance =
    incorrectAttempt?.staffDistanceAnswer ??
    event.attempts.find((attempt) => attempt.staffDistanceAnswer !== undefined)
      ?.staffDistanceAnswer;
  if (distance !== undefined) return `选择了 ${distance} 度`;
  return event.isMissed ? "漏答" : "未记录作答内容";
}

export function getIncorrectAnswerDisplays(event: AnswerEvent): string[] {
  const incorrect = event.attempts.filter(
    (attempt) => !attempt.isCorrect && !attempt.isLateForPrevious
  );
  if (incorrect.length === 0) return event.isMissed ? ["漏答"] : ["未记录作答内容"];
  return [
    ...new Set(
      incorrect.map((attempt) => {
        if (attempt.midi !== undefined) {
          const note = ALL_NOTES.find(
            (candidate) => getTargetMidiNoteNumber(candidate) === attempt.midi
          );
          return note ? formatLearningNoteId(note.id) : `MIDI ${attempt.midi}`;
        }
        if (attempt.noteName) return attempt.noteName;
        if (attempt.staffDistanceAnswer !== undefined)
          return `选择了 ${attempt.staffDistanceAnswer} 度`;
        return "未记录作答内容";
      })
    ),
  ];
}

export function buildRecallWeakItems(
  runs: readonly StaffRecallRunRecord[],
  pitchGroups: readonly string[]
): WeakPracticeItem[] {
  const perNote = new Map<string, { total: number; count: number; first: string; last: string }>();
  for (const run of runs) {
    const matchingNoteIds = run.targetNoteIds.filter((noteId) => {
      const match = noteId.match(/^([A-G])([2-6])$/);
      return Boolean(
        match &&
        (pitchGroups.length === 0 || pitchGroups.includes("all") || pitchGroups.includes(match[2]!))
      );
    });
    const noteCountByName = new Map<string, number>();
    for (const noteId of matchingNoteIds) {
      const name = noteId[0];
      if (name) noteCountByName.set(name, (noteCountByName.get(name) ?? 0) + 1);
    }
    for (const noteId of matchingNoteIds) {
      const name = noteId[0]!;
      const item = perNote.get(noteId) ?? {
        total: 0,
        count: 0,
        first: run.endedAt,
        last: run.endedAt,
      };
      const columnTime = run.columnActiveMs[name as keyof typeof run.columnActiveMs] ?? 0;
      item.total += columnTime / Math.max(1, noteCountByName.get(name) ?? 1);
      item.count += 1;
      if (run.endedAt < item.first) item.first = run.endedAt;
      if (run.endedAt > item.last) item.last = run.endedAt;
      perNote.set(noteId, item);
    }
  }
  const ranked = [...perNote.entries()]
    .map(([noteId, item]) => ({
      id: `recall:${noteId}`,
      title: formatLearningNoteId(noteId),
      subtitle: "估算识别用时",
      count: item.count,
      firstSeenAt: item.first,
      lastSeenAt: item.last,
      noteIds: [noteId],
      averageMs: item.count ? item.total / item.count : 0,
    }))
    .sort((left, right) => (right.averageMs ?? 0) - (left.averageMs ?? 0));
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 4)));
}

export function getMetricValue(event: AnswerEvent, metric: LearningStatsMetric): number | null {
  if (event.wasInterrupted === true || event.wasSkipped === true) return null;
  if (metric === "volume") return 1;
  if (metric === "accuracy") {
    if (event.isCorrectFirstTry !== null) return event.isCorrectFirstTry ? 1 : 0;
    return event.isMissed ? 0 : null;
  }
  if (metric === "response") {
    const value = event.responseTimeMs ?? event.rawResponseTimeMs;
    return typeof value === "number" && value > 0 && !event.isMissed ? value : null;
  }
  return null;
}

export function dateBucket(timestamp: string, range: LearningStatsRange): string {
  const date = new Date(timestamp);
  if (range === "1") {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:00`;
  }
  if (range === "all" || range === "365") return `${date.getFullYear()}/${date.getMonth() + 1}`;
  if (Number(range) > 30) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return `${monday.getMonth() + 1}/${monday.getDate()} 周`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
