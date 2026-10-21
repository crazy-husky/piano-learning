import type {
  SongPracticeHandMode,
  SongPracticeInputMode,
  SongPracticeKeyVersion,
} from "./songPracticeMaterials";
import { SCORE_CHASE_SPEED_OPTIONS } from "../logic/scoreChase";

export const SONG_PRACTICE_UI_PREFERENCES_KEY = "songPracticeUiPreferences.v1";

export interface SongPracticeUiPreferences {
  handMode: SongPracticeHandMode;
  inputMode: SongPracticeInputMode;
  keyVersion: Exclude<SongPracticeKeyVersion, "source">;
  selectedSongId: string;
  chaseEnabled: boolean;
  chasePreferencesVersion: 2;
  chaseSpeedMultiplier: number;
  chaseStartCount: number;
}

export const SONG_CHASE_SPEED_OPTIONS = SCORE_CHASE_SPEED_OPTIONS;

export const DEFAULT_SONG_PRACTICE_UI_PREFERENCES: SongPracticeUiPreferences = {
  handMode: "right",
  inputMode: "virtual",
  keyVersion: "c",
  selectedSongId: "cong-cong-na-nian",
  chaseEnabled: true,
  chasePreferencesVersion: 2,
  chaseSpeedMultiplier: 0.5,
  chaseStartCount: 5,
};

const SONG_IDS = new Set(["cong-cong-na-nian", "always-with-me"]);

export function parseSongPracticeUiPreferences(
  value: unknown,
  fallback: SongPracticeUiPreferences
): SongPracticeUiPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const saved = value as Partial<Record<keyof SongPracticeUiPreferences, unknown>>;
  const migrateLegacyChaseDefaults =
    saved.chasePreferencesVersion !== 2 &&
    saved.chaseSpeedMultiplier === 1.5 &&
    saved.chaseStartCount === 4;
  return {
    handMode:
      saved.handMode === "left" || saved.handMode === "both" || saved.handMode === "right"
        ? saved.handMode
        : fallback.handMode,
    inputMode:
      saved.inputMode === "midi" ||
      saved.inputMode === "microphone" ||
      saved.inputMode === "virtual"
        ? saved.inputMode
        : fallback.inputMode,
    keyVersion:
      saved.keyVersion === "original" || saved.keyVersion === "c"
        ? saved.keyVersion
        : fallback.keyVersion,
    selectedSongId:
      typeof saved.selectedSongId === "string" && SONG_IDS.has(saved.selectedSongId)
        ? saved.selectedSongId
        : fallback.selectedSongId,
    chaseEnabled:
      typeof saved.chaseEnabled === "boolean" ? saved.chaseEnabled : fallback.chaseEnabled,
    chasePreferencesVersion: 2,
    chaseSpeedMultiplier:
      !migrateLegacyChaseDefaults &&
      typeof saved.chaseSpeedMultiplier === "number" &&
      SONG_CHASE_SPEED_OPTIONS.some((speed) => speed === saved.chaseSpeedMultiplier)
        ? saved.chaseSpeedMultiplier
        : fallback.chaseSpeedMultiplier,
    chaseStartCount:
      !migrateLegacyChaseDefaults &&
      typeof saved.chaseStartCount === "number" &&
      Number.isInteger(saved.chaseStartCount) &&
      saved.chaseStartCount >= 2 &&
      saved.chaseStartCount <= 12
        ? saved.chaseStartCount
        : fallback.chaseStartCount,
  };
}
