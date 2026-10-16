import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readStaffGameSongProgress,
  saveStaffGameSongProgress,
  STAFF_GAME_SONGS,
} from "./staffGameSongs";

function installStorage(): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

describe("staff game song progress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clears legacy song results instead of migrating them", () => {
    const values = installStorage();
    values.set(
      "anki-note.staffGameSongProgress.v1",
      JSON.stringify({ "hot-cross-buns": { bestScore: 999, bestStars: 3 } })
    );

    const progress = readStaffGameSongProgress();

    expect(values.has("anki-note.staffGameSongProgress.v1")).toBe(false);
    expect(progress[STAFF_GAME_SONGS[0]!.id]?.muggle.bestScore).toBe(0);
    expect(progress[STAFF_GAME_SONGS[0]!.id]?.muggle.bestStars).toBe(0);
  });

  it("stores song results independently for each difficulty", () => {
    installStorage();
    const progress = readStaffGameSongProgress();
    const songId = STAFF_GAME_SONGS[0]!.id;
    progress[songId]!.easy = {
      bestScore: 120,
      bestAccuracy: 80,
      bestStars: 2,
      maxCombo: 7,
      plays: 1,
    };

    saveStaffGameSongProgress(progress);
    const saved = readStaffGameSongProgress();

    expect(saved[songId]?.easy.bestScore).toBe(120);
    expect(saved[songId]?.easy.bestStars).toBe(2);
    expect(saved[songId]?.normal.bestScore).toBe(0);
  });
});
