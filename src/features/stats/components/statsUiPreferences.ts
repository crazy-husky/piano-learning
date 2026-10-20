import {
  RECOGNITION_RELATIVE_BASELINE_MODES,
  RECOGNITION_SERIES_KEYS,
  RECOGNITION_TIME_GROUPINGS,
  RECOGNITION_TIME_METRICS,
  RECOGNITION_TIME_VALUE_MODES,
  type RecognitionRelativeBaselineMode,
  type RecognitionSeriesKey,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { parseStatsRange, parseStatsRangeDays, type StatsRange } from "./statsRange";
import type {
  AppSettings,
  PitchId,
  StaffNotationMode,
  StaffRangeSelection,
} from "../../../domain/types";
import { normalizeCurrentPracticeGroupIds } from "../../../domain/notes";

export const STATS_TABS = ["overview", "notes", "progress", "wrong-notes"] as const;
export type StatsTab = (typeof STATS_TABS)[number];
export type WrongNoteStatsTab = "trend" | "note" | "manage";
export type StatsNoteMetric = "speed" | "errors" | "proficiency";

export type StatsNoteScopePreferences = Pick<
  AppSettings,
  | "staffNotationMode"
  | "staffRangeProfiles"
  | "enabledGroupIds"
  | "enabledPitchIds"
  | "crossGroupPitchIds"
  | "includeInterStaffLedgerSpellings"
>;

export const STATS_CAROUSEL_CARD_IDS = [
  "recognition-time",
  "session-progress",
  "note-range",
] as const;
export type StatsCarouselCardId = (typeof STATS_CAROUSEL_CARD_IDS)[number];

export interface StatsUiPreferences {
  activeTab: StatsTab;
  carouselCardId: StatsCarouselCardId;
  customRangeDays: number;
  hiddenRecognitionSeries: RecognitionSeriesKey[];
  range: StatsRange;
  recognitionTimeGrouping: RecognitionTimeGrouping;
  recognitionTimeMetric: RecognitionTimeMetric;
  recognitionTimeRelativeBaselineMode: RecognitionRelativeBaselineMode;
  recognitionTimeValueMode: RecognitionTimeValueMode;
  noteScope: StatsNoteScopePreferences | null;
  noteMetric: StatsNoteMetric;
  wrongNoteTab: WrongNoteStatsTab;
}

export const STATS_UI_PREFERENCES_KEY = "anki-note.statsUiPreferences";
export const DEFAULT_STATS_UI_PREFERENCES: StatsUiPreferences = {
  activeTab: "overview",
  carouselCardId: STATS_CAROUSEL_CARD_IDS[1],
  customRangeDays: 14,
  hiddenRecognitionSeries: [],
  range: 30,
  recognitionTimeGrouping: "practice-session",
  recognitionTimeMetric: "duration",
  recognitionTimeRelativeBaselineMode: "previous-range-end",
  recognitionTimeValueMode: "absolute",
  noteScope: null,
  noteMetric: "speed",
  wrongNoteTab: "trend",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecognitionTimeGrouping(value: unknown): value is RecognitionTimeGrouping {
  return (
    typeof value === "string" &&
    RECOGNITION_TIME_GROUPINGS.includes(value as RecognitionTimeGrouping)
  );
}

function isRecognitionTimeMetric(value: unknown): value is RecognitionTimeMetric {
  return (
    typeof value === "string" && RECOGNITION_TIME_METRICS.includes(value as RecognitionTimeMetric)
  );
}

function isRecognitionRelativeBaselineMode(
  value: unknown
): value is RecognitionRelativeBaselineMode {
  return (
    typeof value === "string" &&
    RECOGNITION_RELATIVE_BASELINE_MODES.includes(value as RecognitionRelativeBaselineMode)
  );
}

function isRecognitionTimeValueMode(value: unknown): value is RecognitionTimeValueMode {
  return (
    typeof value === "string" &&
    RECOGNITION_TIME_VALUE_MODES.includes(value as RecognitionTimeValueMode)
  );
}

export function parseHiddenRecognitionSeries(
  value: unknown,
  fallback: RecognitionSeriesKey[] = []
): RecognitionSeriesKey[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const hiddenSeries = RECOGNITION_SERIES_KEYS.filter((seriesKey) =>
    value.some((item) => item === seriesKey)
  );
  return hiddenSeries.length === RECOGNITION_SERIES_KEYS.length ? fallback : hiddenSeries;
}

function isStatsCarouselCardId(value: unknown): value is StatsCarouselCardId {
  return (
    typeof value === "string" && STATS_CAROUSEL_CARD_IDS.includes(value as StatsCarouselCardId)
  );
}

const STAFF_NOTATION_MODES: StaffNotationMode[] = ["treble-only", "bass-only", "grand"];
const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"] as const;

function isStatsTab(value: unknown): value is StatsTab {
  return typeof value === "string" && STATS_TABS.includes(value as StatsTab);
}

function isWrongNoteStatsTab(value: unknown): value is WrongNoteStatsTab {
  return value === "trend" || value === "note" || value === "manage";
}

function parsePitchIds(value: unknown): PitchId[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value.filter((item): item is PitchId =>
    NOTE_NAMES.some((name) => new RegExp(`^${name}[1-6]$`).test(item))
  );
}

function parseRangeSelection(value: unknown): StaffRangeSelection | undefined {
  if (!isRecord(value) || !Array.isArray(value.enabledGroupIds)) return undefined;
  const enabledGroupIds = normalizeCurrentPracticeGroupIds(
    value.enabledGroupIds.filter((group): group is string => typeof group === "string")
  );
  const enabledPitchIds =
    value.enabledPitchIds === undefined ? undefined : parsePitchIds(value.enabledPitchIds);
  const crossGroupPitchIds =
    value.crossGroupPitchIds === undefined ? undefined : parsePitchIds(value.crossGroupPitchIds);
  if (
    (value.enabledPitchIds !== undefined && enabledPitchIds === undefined) ||
    (value.crossGroupPitchIds !== undefined && crossGroupPitchIds === undefined)
  ) {
    return undefined;
  }
  return { enabledGroupIds, enabledPitchIds, crossGroupPitchIds };
}

function parseNoteScope(value: unknown): StatsNoteScopePreferences | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.staffNotationMode !== "string" ||
    !STAFF_NOTATION_MODES.includes(value.staffNotationMode as StaffNotationMode) ||
    !Array.isArray(value.enabledGroupIds) ||
    typeof value.includeInterStaffLedgerSpellings !== "boolean"
  ) {
    return null;
  }
  const enabledGroupIds = normalizeCurrentPracticeGroupIds(
    value.enabledGroupIds.filter((group): group is string => typeof group === "string")
  );
  const enabledPitchIds =
    value.enabledPitchIds === undefined ? undefined : parsePitchIds(value.enabledPitchIds);
  const crossGroupPitchIds =
    value.crossGroupPitchIds === undefined ? undefined : parsePitchIds(value.crossGroupPitchIds);
  if (
    (value.enabledPitchIds !== undefined && enabledPitchIds === undefined) ||
    (value.crossGroupPitchIds !== undefined && crossGroupPitchIds === undefined)
  ) {
    return null;
  }
  const staffRangeProfiles: Partial<Record<StaffNotationMode, StaffRangeSelection>> = {};
  if (isRecord(value.staffRangeProfiles)) {
    for (const mode of STAFF_NOTATION_MODES) {
      const selection = parseRangeSelection(value.staffRangeProfiles[mode]);
      if (selection) staffRangeProfiles[mode] = selection;
    }
  }
  return {
    staffNotationMode: value.staffNotationMode as StaffNotationMode,
    staffRangeProfiles,
    enabledGroupIds,
    enabledPitchIds,
    crossGroupPitchIds,
    includeInterStaffLedgerSpellings: value.includeInterStaffLedgerSpellings,
  };
}

export function parseStatsUiPreferences(
  value: unknown,
  fallback: StatsUiPreferences
): StatsUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    activeTab: isStatsTab(value.activeTab) ? value.activeTab : fallback.activeTab,
    carouselCardId: isStatsCarouselCardId(value.carouselCardId)
      ? value.carouselCardId
      : fallback.carouselCardId,
    customRangeDays: parseStatsRangeDays(value.customRangeDays) ?? fallback.customRangeDays,
    hiddenRecognitionSeries: parseHiddenRecognitionSeries(
      value.hiddenRecognitionSeries,
      fallback.hiddenRecognitionSeries
    ),
    range: parseStatsRange(value.range, fallback.range),
    recognitionTimeGrouping: isRecognitionTimeGrouping(value.recognitionTimeGrouping)
      ? value.recognitionTimeGrouping
      : fallback.recognitionTimeGrouping,
    recognitionTimeMetric: isRecognitionTimeMetric(value.recognitionTimeMetric)
      ? value.recognitionTimeMetric
      : fallback.recognitionTimeMetric,
    recognitionTimeRelativeBaselineMode: isRecognitionRelativeBaselineMode(
      value.recognitionTimeRelativeBaselineMode
    )
      ? value.recognitionTimeRelativeBaselineMode
      : typeof value.recognitionTimeResetNewRangeAtFirstPoint === "boolean"
        ? value.recognitionTimeResetNewRangeAtFirstPoint
          ? "new-range-start"
          : "previous-range-end"
        : fallback.recognitionTimeRelativeBaselineMode,
    recognitionTimeValueMode: isRecognitionTimeValueMode(value.recognitionTimeValueMode)
      ? value.recognitionTimeValueMode
      : fallback.recognitionTimeValueMode,
    noteScope: parseNoteScope(value.noteScope),
    noteMetric:
      value.noteMetric === "errors" || value.noteMetric === "proficiency"
        ? value.noteMetric
        : "speed",
    wrongNoteTab: isWrongNoteStatsTab(value.wrongNoteTab)
      ? value.wrongNoteTab
      : fallback.wrongNoteTab,
  };
}
