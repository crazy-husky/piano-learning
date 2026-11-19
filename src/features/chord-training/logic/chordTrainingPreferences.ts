import {
  CHORD_DEGREE_OPTIONS,
  CHORD_MAJOR_KEYS,
  DEFAULT_CHORD_TRAINING_CONFIG,
  type ChordDegree,
  type ChordTask,
  type ChordTrainingConfig,
} from "./chordTraining";
import type { CurrentPracticeGroupId } from "../../../domain/types";
import { CURRENT_PRACTICE_GROUP_IDS } from "../../../domain/notes";

export const CHORD_TRAINING_PREFERENCES_KEY = "anki-note.chordTrainingPreferences.v3";

const LEGACY_DEFAULT_CHORD_DEGREES: ChordDegree[] = [1, 5, 6, 4, 2, 3, 7];

function matchesValues(value: unknown, expected: readonly unknown[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((item, index) => value[index] === item)
  );
}

function isLegacyDefaultConfig(stored: Partial<ChordTrainingConfig>): boolean {
  return (
    stored.task === "recognize" &&
    stored.keyId === "C" &&
    (stored.practiceGroupIds === undefined || matchesValues(stored.practiceGroupIds, ["C4-B4"])) &&
    matchesValues(stored.chordDegrees, LEGACY_DEFAULT_CHORD_DEGREES) &&
    matchesValues(stored.qualities, ["triad"]) &&
    (matchesValues(stored.inversions, [0, 1, 2]) || matchesValues(stored.inversions, [0])) &&
    stored.lengthMode === "fixed-count" &&
    stored.fixedCount === 30 &&
    stored.fixedDurationSeconds === 90
  );
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function parseChordTrainingConfig(value: unknown): ChordTrainingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CHORD_TRAINING_CONFIG };
  }
  const stored = value as Partial<ChordTrainingConfig>;
  if (isLegacyDefaultConfig(stored)) {
    return { ...DEFAULT_CHORD_TRAINING_CONFIG };
  }
  const qualities = Array.isArray(stored.qualities)
    ? [...new Set(stored.qualities)].filter(
        (kind): kind is "triad" | "seventh" => kind === "triad" || kind === "seventh"
      )
    : DEFAULT_CHORD_TRAINING_CONFIG.qualities;
  const lengthMode =
    stored.lengthMode === "open-ended" ||
    stored.lengthMode === "fixed-count" ||
    stored.lengthMode === "fixed-duration"
      ? stored.lengthMode
      : DEFAULT_CHORD_TRAINING_CONFIG.lengthMode;
  const task: ChordTask =
    stored.task === "block" || stored.task === "arpeggio" || stored.task === "recognize"
      ? stored.task
      : DEFAULT_CHORD_TRAINING_CONFIG.task;
  const keyId = CHORD_MAJOR_KEYS.some((key) => key.id === stored.keyId)
    ? stored.keyId!
    : DEFAULT_CHORD_TRAINING_CONFIG.keyId;
  const validDegrees = new Set(CHORD_DEGREE_OPTIONS.map(({ degree }) => degree));
  const chordDegrees = Array.isArray(stored.chordDegrees)
    ? [...new Set(stored.chordDegrees)].filter(
        (degree): degree is ChordDegree =>
          typeof degree === "number" && validDegrees.has(degree as ChordDegree)
      )
    : [...DEFAULT_CHORD_TRAINING_CONFIG.chordDegrees];
  const selectedDegrees = new Set(
    chordDegrees.length > 0 ? chordDegrees : DEFAULT_CHORD_TRAINING_CONFIG.chordDegrees
  );
  const practiceGroupIds = Array.isArray(stored.practiceGroupIds)
    ? [...new Set(stored.practiceGroupIds)].filter(
        (groupId): groupId is CurrentPracticeGroupId =>
          typeof groupId === "string" &&
          CURRENT_PRACTICE_GROUP_IDS.includes(groupId as CurrentPracticeGroupId)
      )
    : [...DEFAULT_CHORD_TRAINING_CONFIG.practiceGroupIds];
  const inversions = Array.isArray(stored.inversions)
    ? [...new Set(stored.inversions)].filter(
        (inversion): inversion is number =>
          typeof inversion === "number" &&
          Number.isInteger(inversion) &&
          inversion >= 0 &&
          inversion <= 3
      )
    : [...DEFAULT_CHORD_TRAINING_CONFIG.inversions];
  return {
    task,
    keyId,
    practiceGroupIds:
      practiceGroupIds.length > 0
        ? CURRENT_PRACTICE_GROUP_IDS.filter((groupId) => practiceGroupIds.includes(groupId))
        : [...DEFAULT_CHORD_TRAINING_CONFIG.practiceGroupIds],
    chordDegrees: CHORD_DEGREE_OPTIONS.filter(({ degree }) => selectedDegrees.has(degree)).map(
      ({ degree }) => degree
    ),
    qualities: qualities.length > 0 ? qualities : [...DEFAULT_CHORD_TRAINING_CONFIG.qualities],
    inversions: inversions.length > 0 ? inversions : [...DEFAULT_CHORD_TRAINING_CONFIG.inversions],
    requireInversionAnswer:
      typeof stored.requireInversionAnswer === "boolean"
        ? stored.requireInversionAnswer
        : DEFAULT_CHORD_TRAINING_CONFIG.requireInversionAnswer,
    lengthMode,
    fixedCount: clampInteger(stored.fixedCount, 30, 1, 500),
    fixedDurationSeconds: clampInteger(stored.fixedDurationSeconds, 90, 60, 60 * 120),
  };
}

export function readChordTrainingConfig(): ChordTrainingConfig {
  try {
    const raw = window.localStorage.getItem(CHORD_TRAINING_PREFERENCES_KEY);
    return parseChordTrainingConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return parseChordTrainingConfig(null);
  }
}

export function writeChordTrainingConfig(config: ChordTrainingConfig): void {
  try {
    window.localStorage.setItem(CHORD_TRAINING_PREFERENCES_KEY, JSON.stringify(config));
  } catch {
    // Keep the current setup usable when local storage is unavailable.
  }
}
