import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_DIFFICULTIES, GAME_LEVEL_COUNT } from "./staffGameRules";
import { defaultProgress, readProgress } from "./staffGameProgress";

const storageValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, value),
};

afterEach(() => {
  storageValues.clear();
  vi.unstubAllGlobals();
});

describe("staff game progress persistence", () => {
  it("creates a complete version-six progress shape", () => {
    const progress = defaultProgress();

    expect(progress.version).toBe(6);
    expect(progress.modes.learning.bestStars).toHaveLength(GAME_LEVEL_COUNT);
    expect(progress.modes.arcade.bestScores).toHaveLength(GAME_LEVEL_COUNT);
    expect(progress.unlockedLevel).toBe(1);
  });

  it("resets incompatible saved progress and persists the current shape", () => {
    vi.stubGlobal("localStorage", localStorageMock);
    storageValues.set("anki-note.staffGameProgress.v6", JSON.stringify({ version: 5 }));

    const progress = readProgress();

    expect(progress.version).toBe(6);
    expect(progress.selectedLevel).toBe(1);
    expect(JSON.parse(storageValues.get("anki-note.staffGameProgress.v6") ?? "{}").version).toBe(6);
  });

  it("clamps levels and metrics when restoring current-version progress", () => {
    vi.stubGlobal("localStorage", localStorageMock);
    const firstDifficulty = GAME_DIFFICULTIES[0]!.id;
    storageValues.set(
      "anki-note.staffGameProgress.v6",
      JSON.stringify({
        version: 6,
        unlockedLevel: GAME_LEVEL_COUNT + 10,
        selectedLevel: 0,
        modes: {
          learning: {
            bestStars: [5],
            bestAccuracy: [{ [firstDifficulty]: 2 }],
          },
        },
      })
    );

    const progress = readProgress();

    expect(progress.unlockedLevel).toBe(GAME_LEVEL_COUNT);
    expect(progress.selectedLevel).toBe(GAME_LEVEL_COUNT);
    expect(progress.modes.learning.bestStars[0]).toBe(3);
    expect(progress.modes.learning.bestAccuracy[0]?.[firstDifficulty]).toBe(1);
  });
});
