import type {
  SongPracticeHandMode,
  SongPracticeInputMode,
  SongPracticeKeyVersion,
} from "./songPracticeMaterials";

export const SONG_PRACTICE_UI_PREFERENCES_KEY = "songPracticeUiPreferences.v1";

export interface SongPracticeUiPreferences {
  handMode: SongPracticeHandMode;
  inputMode: SongPracticeInputMode;
  keyVersion: Exclude<SongPracticeKeyVersion, "source">;
  selectedSongId: string;
}

export const DEFAULT_SONG_PRACTICE_UI_PREFERENCES: SongPracticeUiPreferences = {
  handMode: "right",
  inputMode: "virtual",
  keyVersion: "c",
  selectedSongId: "cong-cong-na-nian",
};

const SONG_IDS = new Set(["cong-cong-na-nian", "always-with-me"]);

export function parseSongPracticeUiPreferences(
  value: unknown,
  fallback: SongPracticeUiPreferences
): SongPracticeUiPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const saved = value as Partial<Record<keyof SongPracticeUiPreferences, unknown>>;
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
  };
}
