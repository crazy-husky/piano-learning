import type { StaffGameChallengeMode } from "../../../domain/types";
import { resolveStaffGameInputMode } from "./staffGameSettings";
import {
  GAME_DIFFICULTIES,
  type GameDifficulty,
  type StaffGameArcadeDuration,
  type StaffGameNotePoolScope,
  type StaffGameNoteSchedulingStrategy,
} from "./staffGameRules";

const GAME_SETTINGS_KEY = "anki-note.staffGameSettings.v1";

export type GameInputMode = "physical" | "virtual" | "midi";

export type GameDisplayMode = "note" | "solfege" | "number" | "none";

export type StaffGameMode = "levels" | "songs";

export interface StaffGameAudioSettings {
  soundEffectsEnabled: boolean;
  backgroundMusicEnabled: boolean;
  pianoSoundEnabled: boolean;
}

export interface StaffGameSettings {
  inputMode: GameInputMode;
  displayMode: GameDisplayMode;
  difficulty: GameDifficulty;
  notePoolScope: StaffGameNotePoolScope;
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy;
  challengeMode: StaffGameChallengeMode;
  arcadeDuration: StaffGameArcadeDuration;
  wrongNoteStatisticsEnabled: boolean;
  autoArchiveWrongNotesEnabled: boolean;
  audioByMode: Record<StaffGameMode, StaffGameAudioSettings>;
  gameEffectsEnabled: boolean;
}

export interface StaffGameWrongNoteReviewCondition {
  id: string;
  level: number;
  difficulty: GameDifficulty;
  notePoolScope: StaffGameNotePoolScope;
  gameMode: StaffGameChallengeMode;
  runCount: number;
  latestEndedAt: string;
  label: string;
}

export const STAFF_GAME_REVIEW_SCOPE_LABELS: Record<StaffGameNotePoolScope, string> = {
  "current-group": "仅当前组已解锁音符",
  "all-history": "全部已解锁音符",
  "all-history-current-clef": "当前谱号全部已解锁音符",
};

export function staffGameWrongNoteReviewConditionId(
  level: number,
  difficulty: GameDifficulty,
  notePoolScope: StaffGameNotePoolScope,
  gameMode: StaffGameChallengeMode
): string {
  return `${level}|${difficulty}|${notePoolScope}|${gameMode}`;
}

export function areStaffGameSettingsEqual(
  left: StaffGameSettings,
  right: StaffGameSettings
): boolean {
  const sameAudioSettings = (mode: StaffGameMode): boolean =>
    left.audioByMode[mode].soundEffectsEnabled === right.audioByMode[mode].soundEffectsEnabled &&
    left.audioByMode[mode].backgroundMusicEnabled ===
      right.audioByMode[mode].backgroundMusicEnabled &&
    left.audioByMode[mode].pianoSoundEnabled === right.audioByMode[mode].pianoSoundEnabled;

  return (
    left.inputMode === right.inputMode &&
    left.displayMode === right.displayMode &&
    left.difficulty === right.difficulty &&
    left.notePoolScope === right.notePoolScope &&
    left.noteSchedulingStrategy === right.noteSchedulingStrategy &&
    left.challengeMode === right.challengeMode &&
    left.arcadeDuration === right.arcadeDuration &&
    left.wrongNoteStatisticsEnabled === right.wrongNoteStatisticsEnabled &&
    left.autoArchiveWrongNotesEnabled === right.autoArchiveWrongNotesEnabled &&
    left.gameEffectsEnabled === right.gameEffectsEnabled &&
    sameAudioSettings("levels") &&
    sameAudioSettings("songs")
  );
}

export function defaultGameSettings(): StaffGameSettings {
  return {
    inputMode: "virtual",
    displayMode: "note",
    difficulty: "normal",
    notePoolScope: "all-history",
    noteSchedulingStrategy: "system",
    challengeMode: "learning",
    arcadeDuration: "level-default",
    wrongNoteStatisticsEnabled: true,
    autoArchiveWrongNotesEnabled: true,
    audioByMode: {
      levels: { soundEffectsEnabled: true, backgroundMusicEnabled: true, pianoSoundEnabled: false },
      songs: { soundEffectsEnabled: false, backgroundMusicEnabled: false, pianoSoundEnabled: true },
    },
    gameEffectsEnabled: true,
  };
}

export function readGameSettings(
  virtualAvailable: boolean,
  midiAvailable: boolean
): StaffGameSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_SETTINGS_KEY) ?? "null") as
      | (Partial<Omit<StaffGameSettings, "audioByMode">> & {
          audioByMode?: Partial<Record<StaffGameMode, Partial<StaffGameAudioSettings>>>;
          soundEffectsEnabled?: unknown;
          backgroundMusicEnabled?: unknown;
          speed?: unknown;
        })
      | null;
    const base = defaultGameSettings();
    const inputMode: GameInputMode = resolveStaffGameInputMode(parsed?.inputMode, {
      midiAvailable,
      virtualAvailable,
    });
    const displayMode: GameDisplayMode =
      parsed?.displayMode === "solfege" ||
      parsed?.displayMode === "number" ||
      parsed?.displayMode === "none"
        ? parsed.displayMode
        : "note";
    const validDifficulty = GAME_DIFFICULTIES.some((item) => item.id === parsed?.difficulty);
    const legacySpeed = Number(parsed?.speed);
    const legacyDifficulty: GameDifficulty = !Number.isFinite(legacySpeed)
      ? base.difficulty
      : legacySpeed <= 1
        ? "easy"
        : legacySpeed <= 3
          ? "normal"
          : legacySpeed <= 4
            ? "hard"
            : "nightmare";
    const readModeAudio = (mode: StaffGameMode): StaffGameAudioSettings => {
      const saved = parsed?.audioByMode?.[mode];
      const defaults = base.audioByMode[mode];
      const canMigrateLegacyAudio = mode === "levels";
      return {
        soundEffectsEnabled:
          typeof saved?.soundEffectsEnabled === "boolean"
            ? saved.soundEffectsEnabled
            : canMigrateLegacyAudio && typeof parsed?.soundEffectsEnabled === "boolean"
              ? parsed.soundEffectsEnabled
              : defaults.soundEffectsEnabled,
        backgroundMusicEnabled:
          typeof saved?.backgroundMusicEnabled === "boolean"
            ? saved.backgroundMusicEnabled
            : canMigrateLegacyAudio && typeof parsed?.backgroundMusicEnabled === "boolean"
              ? parsed.backgroundMusicEnabled
              : defaults.backgroundMusicEnabled,
        pianoSoundEnabled:
          typeof saved?.pianoSoundEnabled === "boolean"
            ? saved.pianoSoundEnabled
            : defaults.pianoSoundEnabled,
      };
    };
    return {
      inputMode,
      displayMode,
      difficulty: validDifficulty ? (parsed!.difficulty as GameDifficulty) : legacyDifficulty,
      wrongNoteStatisticsEnabled:
        typeof parsed?.wrongNoteStatisticsEnabled === "boolean"
          ? parsed.wrongNoteStatisticsEnabled
          : base.wrongNoteStatisticsEnabled,
      autoArchiveWrongNotesEnabled:
        typeof parsed?.autoArchiveWrongNotesEnabled === "boolean"
          ? parsed.autoArchiveWrongNotesEnabled
          : base.autoArchiveWrongNotesEnabled,
      notePoolScope:
        parsed?.notePoolScope === "current-group"
          ? "current-group"
          : parsed?.notePoolScope === "all-history-current-clef"
            ? "all-history-current-clef"
            : base.notePoolScope,
      noteSchedulingStrategy:
        parsed?.noteSchedulingStrategy === "random" ? "random" : base.noteSchedulingStrategy,
      challengeMode: parsed?.challengeMode === "arcade" ? "arcade" : "learning",
      arcadeDuration:
        parsed?.arcadeDuration === 60_000 ||
        parsed?.arcadeDuration === 120_000 ||
        parsed?.arcadeDuration === 180_000
          ? parsed.arcadeDuration
          : "level-default",
      audioByMode: { levels: readModeAudio("levels"), songs: readModeAudio("songs") },
      gameEffectsEnabled:
        typeof parsed?.gameEffectsEnabled === "boolean"
          ? parsed.gameEffectsEnabled
          : base.gameEffectsEnabled,
    };
  } catch {
    return defaultGameSettings();
  }
}

export function saveGameSettings(settings: StaffGameSettings): void {
  try {
    localStorage.setItem(
      GAME_SETTINGS_KEY,
      JSON.stringify({
        ...settings,
        // Retain the old fields so older app versions can still read level-mode audio preferences.
        soundEffectsEnabled: settings.audioByMode.levels.soundEffectsEnabled,
        backgroundMusicEnabled: settings.audioByMode.levels.backgroundMusicEnabled,
      })
    );
  } catch {
    // Settings still apply for this visit if storage is unavailable.
  }
}

export function updateModeAudioSettings(
  settings: StaffGameSettings,
  mode: StaffGameMode,
  update: Partial<StaffGameAudioSettings>
): StaffGameSettings {
  return {
    ...settings,
    audioByMode: {
      ...settings.audioByMode,
      [mode]: { ...settings.audioByMode[mode], ...update },
    },
  };
}
