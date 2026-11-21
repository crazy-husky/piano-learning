import { GAME_DIFFICULTIES, GAME_LEVEL_COUNT, type GameDifficulty } from "./staffGameRules";

export const GAME_PROGRESS_KEY = "anki-note.staffGameProgress.v6";

export interface StaffGameModeProgress {
  bestStars: number[];
  bestAccuracy: Array<Record<GameDifficulty, number | null>>;
  bestResponseMs: Array<Record<GameDifficulty, number | null>>;
  maxCombos: number[];
}

export interface StaffGameArcadeProgress extends StaffGameModeProgress {
  bestScores: number[];
}

export interface StaffGameProgress {
  version: 6;
  modes: {
    learning: StaffGameModeProgress;
    arcade: StaffGameArcadeProgress;
  };
  /** 仅调试用，后续清理。 */
  _debugLastRound: StaffGameLevelRoundSummary | null;
  unlockedLevel: number;
  selectedLevel: number;
}

export interface StaffGameLevelRoundSummary {
  level: number;
  difficulty: GameDifficulty;
  generatedBubbleCount: number;
  firstTryCorrectCount: number;
  correctBubbleCount: number;
  responseTotalMs: number;
  responseSampleCount: number;
  accuracy: number | null;
  averageResponseMs: number | null;
}

function createDifficultyMetricSlots(): Array<Record<GameDifficulty, number | null>> {
  return Array.from(
    { length: GAME_LEVEL_COUNT },
    () =>
      Object.fromEntries(GAME_DIFFICULTIES.map(({ id }) => [id, null])) as Record<
        GameDifficulty,
        number | null
      >
  );
}

export function defaultProgress(): StaffGameProgress {
  const defaultModeProgress = (): StaffGameModeProgress => ({
    bestStars: Array(GAME_LEVEL_COUNT).fill(0),
    bestAccuracy: createDifficultyMetricSlots(),
    bestResponseMs: createDifficultyMetricSlots(),
    maxCombos: Array(GAME_LEVEL_COUNT).fill(0),
  });
  return {
    version: 6,
    modes: {
      learning: defaultModeProgress(),
      arcade: {
        ...defaultModeProgress(),
        bestScores: Array(GAME_LEVEL_COUNT).fill(0),
      },
    },
    _debugLastRound: null,
    unlockedLevel: 1,
    selectedLevel: 1,
  };
}

function readStoredJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function readProgress(): StaffGameProgress {
  try {
    const stored = readStoredJson(GAME_PROGRESS_KEY);
    const base = defaultProgress();
    if (
      !stored ||
      typeof stored !== "object" ||
      Array.isArray(stored) ||
      (stored as { version?: unknown }).version !== 6
    ) {
      saveProgress(base);
      return base;
    }
    const parsed = stored as Partial<StaffGameProgress>;
    const readArray = (value: unknown, maxValue = Number.MAX_SAFE_INTEGER): number[] =>
      Array.from({ length: GAME_LEVEL_COUNT }, (_, index) => {
        const item = Array.isArray(value) ? Number(value[index]) : 0;
        return Number.isFinite(item) ? Math.max(0, Math.min(maxValue, Math.floor(item))) : 0;
      });
    const readMetricSlots = (
      value: unknown,
      maxValue: number
    ): Array<Record<GameDifficulty, number | null>> =>
      Array.from({ length: GAME_LEVEL_COUNT }, (_, index) => {
        const row = Array.isArray(value) ? value[index] : null;
        const record =
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Partial<Record<GameDifficulty, unknown>>)
            : {};
        return Object.fromEntries(
          GAME_DIFFICULTIES.map(({ id }) => {
            const raw = record[id];
            if (raw === null || raw === undefined) return [id, null];
            const metric = Number(raw);
            return [id, Number.isFinite(metric) ? Math.max(0, Math.min(maxValue, metric)) : null];
          })
        ) as Record<GameDifficulty, number | null>;
      });
    const normalizeModeProgress = (
      value: unknown,
      includeArcadeRecords: boolean
    ): StaffGameModeProgress | StaffGameArcadeProgress => {
      const record =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Partial<StaffGameModeProgress & StaffGameArcadeProgress>)
          : {};
      return {
        bestStars: readArray(record.bestStars, 3),
        bestAccuracy: readMetricSlots(record.bestAccuracy, 1),
        bestResponseMs: readMetricSlots(record.bestResponseMs, Number.MAX_SAFE_INTEGER),
        maxCombos: readArray(record.maxCombos),
        ...(includeArcadeRecords
          ? {
              bestScores: readArray(record.bestScores),
            }
          : {}),
      };
    };
    const readLastRound = (value: unknown): StaffGameLevelRoundSummary | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const record = value as Record<string, unknown>;
      const difficulty = GAME_DIFFICULTIES.find(({ id }) => id === record.difficulty)?.id;
      const level = Math.floor(Number(record.level));
      if (!difficulty || level < 1 || level > GAME_LEVEL_COUNT) return null;
      const readCount = (key: string): number => Math.max(0, Math.floor(Number(record[key]) || 0));
      const readDuration = (key: string): number => Math.max(0, Number(record[key]) || 0);
      const readOptionalMetric = (key: string): number | null => {
        if (record[key] === null || record[key] === undefined) return null;
        const metric = Number(record[key]);
        return Number.isFinite(metric) ? Math.max(0, metric) : null;
      };
      return {
        level,
        difficulty,
        generatedBubbleCount: readCount("generatedBubbleCount"),
        firstTryCorrectCount: readCount("firstTryCorrectCount"),
        correctBubbleCount: readCount("correctBubbleCount"),
        responseTotalMs: readDuration("responseTotalMs"),
        responseSampleCount: readCount("responseSampleCount"),
        accuracy: readOptionalMetric("accuracy"),
        averageResponseMs: readOptionalMetric("averageResponseMs"),
      };
    };
    const lastRound = readLastRound(parsed._debugLastRound);
    const progress: StaffGameProgress = {
      version: 6,
      modes: {
        learning: normalizeModeProgress(parsed.modes?.learning, false) as StaffGameModeProgress,
        arcade: normalizeModeProgress(parsed.modes?.arcade, true) as StaffGameArcadeProgress,
      },
      _debugLastRound: lastRound,
      unlockedLevel: Math.max(
        1,
        Math.min(GAME_LEVEL_COUNT, Math.floor(Number(parsed.unlockedLevel) || base.unlockedLevel))
      ),
      selectedLevel: Math.max(
        1,
        Math.min(
          GAME_LEVEL_COUNT,
          Math.floor(
            Number(parsed.selectedLevel) || Number(parsed.unlockedLevel) || base.selectedLevel
          )
        )
      ),
    };
    saveProgress(progress);
    return progress;
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(progress: StaffGameProgress): boolean {
  try {
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    // The current game remains playable if browser storage is unavailable.
    return false;
  }
}
