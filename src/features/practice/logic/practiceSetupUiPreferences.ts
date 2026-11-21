import { normalizeAnswerPitchMode } from "../../../domain/answerInput";
import { normalizeBlackKeyPracticeSettings } from "../../../domain/blackKeyPractice";
import { ANSWER_BUTTONS } from "../../../domain/notes";
import type {
  AnswerPitchMode,
  AppSettings,
  BlackKeyPracticeSettings,
  DuetPracticeLevel,
  NoteName,
  PracticeMode,
  PracticeQueueStrategy,
  PromptDisplayMode,
  PromptNoteDuration,
} from "../../../domain/types";
import { resolveDrillNoteNames } from "../../../data/db";
import {
  DEFAULT_DUET_PRACTICE_RANGE_PRESET,
  DUET_PRACTICE_CURRICULUM_VERSION,
  getDuetPracticeGroupIds,
  normalizeDuetPracticeLevel,
  normalizeDuetPracticeRangeGroupIds,
  normalizeDuetPracticeRangePreset,
  type DuetPracticeRangeGroupId,
  type DuetPracticeRangePreset,
} from "./duetPractice";
import {
  DEFAULT_SCORE_CHASE_PREFERENCES,
  SCORE_CHASE_SPEED_OPTIONS,
  type ChaseHandMode,
} from "./scoreChase";
import { PROMPT_NOTE_DURATIONS } from "./staffPageNotation";

export interface PracticeSetupUiPreferences {
  answerPitchMode: AnswerPitchMode;
  practiceMode: "single" | "duet";
  metronomeSyncEnabled: boolean;
  blindPracticeMetronomeSyncEnabled: boolean;
  duetMetronomeSyncEnabled: boolean;
  duetLevel: DuetPracticeLevel;
  duetRangePreset: DuetPracticeRangePreset;
  duetRangeGroupIds: DuetPracticeRangeGroupId[];
  duetMaxStaffDistance: number | null;
  duetCurriculumVersion: number;
  duetAllowDottedRhythms: boolean;
  duetStrictHandAlternation: boolean;
  singleBlackKeys: BlackKeyPracticeSettings;
  duetBlackKeys: BlackKeyPracticeSettings;
  autoPlayTarget: boolean;
  midiAutoPlayTarget: boolean;
  chaseEnabled: boolean;
  chaseHandMode: ChaseHandMode;
  chasePreferencesVersion: 2;
  chaseSpeedMultiplier: number;
  chaseStartCount: number;
  playAnswerNote: boolean;
  midiPlayAnswerNote: boolean;
  drillNoteNames: NoteName[];
  fixedCount: number;
  fixedDurationSeconds: number;
  mode: PracticeMode;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  promptNoteDurations: PromptNoteDuration[];
  queueStrategy: PracticeQueueStrategy;
  queueStrategyPreferenceVersion: 1;
}

export const PRACTICE_SETUP_UI_PREFERENCES_KEY = "anki-note.practiceSetupUiPreferences";

export const PRACTICE_QUEUE_STRATEGY_PREFERENCE_VERSION = 1 as const;

export const PRACTICE_MODES: readonly PracticeMode[] = [
  "open-ended",
  "fixed-count",
  "fixed-duration",
];

export const PROMPT_DISPLAY_MODES: readonly PromptDisplayMode[] = ["single-note", "staff-page"];

export const PRACTICE_QUEUE_STRATEGIES: readonly PracticeQueueStrategy[] = [
  "adaptive",
  "focused",
  "melody",
  "note-drill",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === "string" && PRACTICE_MODES.includes(value as PracticeMode);
}

function isPromptDisplayMode(value: unknown): value is PromptDisplayMode {
  return typeof value === "string" && PROMPT_DISPLAY_MODES.includes(value as PromptDisplayMode);
}

function isPromptNoteDuration(value: unknown): value is PromptNoteDuration {
  return typeof value === "string" && PROMPT_NOTE_DURATIONS.includes(value as PromptNoteDuration);
}

export function normalizePromptNoteDurations(
  value: unknown,
  fallback: readonly PromptNoteDuration[]
): PromptNoteDuration[] {
  const candidates = Array.isArray(value) ? value.filter(isPromptNoteDuration) : [...fallback];
  const selected = new Set(candidates);
  const normalized = PROMPT_NOTE_DURATIONS.filter((duration) => selected.has(duration));
  return normalized.length > 0 ? normalized : [...fallback];
}

function isPracticeQueueStrategy(value: unknown): value is PracticeQueueStrategy {
  return (
    typeof value === "string" && PRACTICE_QUEUE_STRATEGIES.includes(value as PracticeQueueStrategy)
  );
}

export function normalizeFixedCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : fallback;
}

export function normalizeFixedDurationSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(60, Math.round(parsed)) : fallback;
}

function normalizeDrillNoteNames(value: unknown, fallback: NoteName[]): NoteName[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const selected = new Set(
    value.filter((noteName): noteName is string => typeof noteName === "string")
  );
  return ANSWER_BUTTONS.map((button) => button.noteName).filter((noteName) =>
    selected.has(noteName)
  );
}

export function makeDefaultPracticeSetupUiPreferences(
  settings: AppSettings
): PracticeSetupUiPreferences {
  const promptNoteDurations = normalizePromptNoteDurations(settings.promptNoteDurations, [
    settings.promptNoteDuration ?? "quarter",
  ]);
  return {
    answerPitchMode: settings.answerPitchMode,
    practiceMode: "single",
    metronomeSyncEnabled: false,
    blindPracticeMetronomeSyncEnabled: false,
    duetMetronomeSyncEnabled: true,
    duetLevel: "level-1",
    duetRangePreset: DEFAULT_DUET_PRACTICE_RANGE_PRESET,
    duetRangeGroupIds: getDuetPracticeGroupIds(DEFAULT_DUET_PRACTICE_RANGE_PRESET),
    duetMaxStaffDistance: null,
    duetCurriculumVersion: DUET_PRACTICE_CURRICULUM_VERSION,
    duetAllowDottedRhythms: false,
    duetStrictHandAlternation: false,
    singleBlackKeys: { enabled: false, ratio: 20, spelling: "mixed" },
    duetBlackKeys: { enabled: false, ratio: 20, spelling: "mixed" },
    autoPlayTarget: settings.autoPlayTarget,
    midiAutoPlayTarget: false,
    chaseEnabled: DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
    chaseHandMode: "both",
    chasePreferencesVersion: 2,
    chaseSpeedMultiplier: DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier,
    chaseStartCount: DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
    playAnswerNote: settings.playAnswerNote,
    midiPlayAnswerNote: false,
    drillNoteNames: resolveDrillNoteNames(settings),
    fixedCount: settings.fixedCount,
    fixedDurationSeconds: settings.fixedDurationSeconds,
    mode: settings.defaultMode,
    promptDisplayMode:
      promptNoteDurations.length > 1 ? "staff-page" : (settings.promptDisplayMode ?? "staff-page"),
    promptNoteDuration: promptNoteDurations[0]!,
    promptNoteDurations,
    queueStrategy: "adaptive",
    queueStrategyPreferenceVersion: PRACTICE_QUEUE_STRATEGY_PREFERENCE_VERSION,
  };
}

export function parsePracticeSetupUiPreferences(
  value: unknown,
  fallback: PracticeSetupUiPreferences
): PracticeSetupUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  const migrateLegacyChaseDefaults =
    value.chasePreferencesVersion !== 2 &&
    value.chaseSpeedMultiplier === 1.5 &&
    value.chaseStartCount === 4;
  const promptNoteDurations = normalizePromptNoteDurations(value.promptNoteDurations, [
    isPromptNoteDuration(value.promptNoteDuration)
      ? value.promptNoteDuration
      : fallback.promptNoteDuration,
  ]);
  const duetCurriculumVersion =
    typeof value.duetCurriculumVersion === "number" ? value.duetCurriculumVersion : undefined;
  const hasCurrentQueueStrategyPreferenceVersion =
    value.queueStrategyPreferenceVersion === PRACTICE_QUEUE_STRATEGY_PREFERENCE_VERSION;
  const duetRangePreset = normalizeDuetPracticeRangePreset(value.duetRangePreset);

  return {
    answerPitchMode: normalizeAnswerPitchMode(value.answerPitchMode, fallback.answerPitchMode),
    practiceMode: value.practiceMode === "duet" ? "duet" : "single",
    metronomeSyncEnabled:
      typeof value.metronomeSyncEnabled === "boolean" ? value.metronomeSyncEnabled : false,
    blindPracticeMetronomeSyncEnabled:
      typeof value.blindPracticeMetronomeSyncEnabled === "boolean"
        ? value.blindPracticeMetronomeSyncEnabled
        : false,
    duetMetronomeSyncEnabled:
      typeof value.duetMetronomeSyncEnabled === "boolean"
        ? value.duetMetronomeSyncEnabled
        : fallback.duetMetronomeSyncEnabled,
    duetLevel: normalizeDuetPracticeLevel(
      value.duetLevel ?? value.duetDifficulty,
      duetCurriculumVersion
    ),
    duetRangePreset,
    duetRangeGroupIds: normalizeDuetPracticeRangeGroupIds(
      value.duetRangeGroupIds,
      getDuetPracticeGroupIds(duetRangePreset)
    ),
    duetMaxStaffDistance:
      typeof value.duetMaxStaffDistance === "number" &&
      Number.isInteger(value.duetMaxStaffDistance) &&
      value.duetMaxStaffDistance >= 1 &&
      value.duetMaxStaffDistance <= 7
        ? value.duetMaxStaffDistance
        : null,
    duetCurriculumVersion: DUET_PRACTICE_CURRICULUM_VERSION,
    duetAllowDottedRhythms:
      typeof value.duetAllowDottedRhythms === "boolean" ? value.duetAllowDottedRhythms : false,
    duetStrictHandAlternation:
      typeof value.duetStrictHandAlternation === "boolean"
        ? value.duetStrictHandAlternation
        : false,
    singleBlackKeys: normalizeBlackKeyPracticeSettings(value.singleBlackKeys),
    duetBlackKeys: normalizeBlackKeyPracticeSettings(value.duetBlackKeys),
    autoPlayTarget:
      typeof value.autoPlayTarget === "boolean" ? value.autoPlayTarget : fallback.autoPlayTarget,
    midiAutoPlayTarget:
      typeof value.midiAutoPlayTarget === "boolean" ? value.midiAutoPlayTarget : false,
    chaseEnabled:
      typeof value.chaseEnabled === "boolean"
        ? value.chaseEnabled
        : DEFAULT_SCORE_CHASE_PREFERENCES.enabled,
    chaseHandMode:
      value.chaseHandMode === "left" ||
      value.chaseHandMode === "right" ||
      value.chaseHandMode === "both"
        ? value.chaseHandMode
        : "both",
    chasePreferencesVersion: 2,
    chaseSpeedMultiplier:
      !migrateLegacyChaseDefaults &&
      typeof value.chaseSpeedMultiplier === "number" &&
      SCORE_CHASE_SPEED_OPTIONS.some((speed) => speed === value.chaseSpeedMultiplier)
        ? value.chaseSpeedMultiplier
        : DEFAULT_SCORE_CHASE_PREFERENCES.speedMultiplier,
    chaseStartCount:
      !migrateLegacyChaseDefaults &&
      typeof value.chaseStartCount === "number" &&
      Number.isInteger(value.chaseStartCount) &&
      value.chaseStartCount >= 2 &&
      value.chaseStartCount <= 12
        ? value.chaseStartCount
        : DEFAULT_SCORE_CHASE_PREFERENCES.startCount,
    playAnswerNote:
      typeof value.playAnswerNote === "boolean" ? value.playAnswerNote : fallback.playAnswerNote,
    midiPlayAnswerNote:
      typeof value.midiPlayAnswerNote === "boolean" ? value.midiPlayAnswerNote : false,
    drillNoteNames: normalizeDrillNoteNames(value.drillNoteNames, fallback.drillNoteNames),
    fixedCount: normalizeFixedCount(value.fixedCount, fallback.fixedCount),
    fixedDurationSeconds: normalizeFixedDurationSeconds(
      value.fixedDurationSeconds,
      fallback.fixedDurationSeconds
    ),
    mode: isPracticeMode(value.mode) ? value.mode : fallback.mode,
    promptDisplayMode:
      promptNoteDurations.length > 1
        ? "staff-page"
        : isPromptDisplayMode(value.promptDisplayMode)
          ? value.promptDisplayMode
          : fallback.promptDisplayMode,
    promptNoteDuration: promptNoteDurations[0]!,
    promptNoteDurations,
    queueStrategy: hasCurrentQueueStrategyPreferenceVersion
      ? isPracticeQueueStrategy(value.queueStrategy)
        ? value.queueStrategy === "focused"
          ? "adaptive"
          : value.queueStrategy
        : "adaptive"
      : "adaptive",
    queueStrategyPreferenceVersion: PRACTICE_QUEUE_STRATEGY_PREFERENCE_VERSION,
  };
}
