import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStaffGameWeakNoteWeights,
  updateStaffGameWeakNoteWeights,
} from "./staffGameWeakNoteHistory";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("staff game weak note history", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears v1 history without migrating it", () => {
    storage.setItem(
      "anki-note.staffGameWeakNoteHistory.v1",
      JSON.stringify({ version: 1, notes: [{ midi: 60, weight: 6, updatedAt: 9_900 }] })
    );

    expect(readStaffGameWeakNoteWeights(10_000).size).toBe(0);
    expect(storage.getItem("anki-note.staffGameWeakNoteHistory.v1")).toBeNull();
  });

  it("keeps the last-error time unchanged when a note is answered correctly", () => {
    storage.setItem(
      "anki-note.staffGameWeakNoteHistory.v2",
      JSON.stringify({
        version: 2,
        notes: [
          { midi: 60, weight: 4, lastErrorAt: 1_000 },
          { midi: 62, weight: 2, lastErrorAt: 1_000 },
        ],
      })
    );

    expect(updateStaffGameWeakNoteWeights([{ midi: 60, firstInputCorrect: true }], 2_000)).toEqual(
      new Map([
        [60, 3],
        [62, 2],
      ])
    );
    expect(JSON.parse(storage.getItem("anki-note.staffGameWeakNoteHistory.v2") ?? "null")).toEqual({
      version: 2,
      notes: [
        { midi: 60, weight: 3, lastErrorAt: 1_000 },
        { midi: 62, weight: 2, lastErrorAt: 1_000 },
      ],
    });
  });

  it("records the actual error time for wrong or missed notes", () => {
    updateStaffGameWeakNoteWeights(
      [
        { midi: 60, firstInputCorrect: false, errorAt: 4_500 },
        { midi: 62, firstInputCorrect: null, errorAt: 4_800 },
      ],
      5_000
    );

    expect(JSON.parse(storage.getItem("anki-note.staffGameWeakNoteHistory.v2") ?? "null")).toEqual({
      version: 2,
      notes: [
        { midi: 60, weight: 2, lastErrorAt: 4_500 },
        { midi: 62, weight: 2, lastErrorAt: 4_800 },
      ],
    });
  });

  it("expires entries based on lastErrorAt", () => {
    storage.setItem(
      "anki-note.staffGameWeakNoteHistory.v2",
      JSON.stringify({ version: 2, notes: [{ midi: 60, weight: 2, lastErrorAt: 1_000 }] })
    );

    expect(readStaffGameWeakNoteWeights(1_000 + 60 * 24 * 60 * 60 * 1_000).get(60)).toBe(2);
    expect(readStaffGameWeakNoteWeights(1_001 + 60 * 24 * 60 * 60 * 1_000).has(60)).toBe(false);
  });
});
