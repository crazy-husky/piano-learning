import { describe, expect, it } from "vitest";
import { clearLocalPreferenceStorage } from "./localPreferenceEvents";

describe("clearLocalPreferenceStorage", () => {
  it("clears application preferences while retaining route state and unrelated storage", () => {
    const values = new Map([
      ["anki-note.pageAppearancePreferences", "{}"],
      ["anki-note.midiInputId", "midi-1"],
      ["anki-note.reloadView", "settings"],
      ["unrelated-app-key", "value"],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
    };

    const result = clearLocalPreferenceStorage(storage, ["anki-note.reloadView"]);

    expect(result).toEqual({
      clearedKeys: ["anki-note.pageAppearancePreferences", "anki-note.midiInputId"],
      failedKeys: [],
    });
    expect([...values]).toEqual([
      ["anki-note.reloadView", "settings"],
      ["unrelated-app-key", "value"],
    ]);
  });

  it("continues clearing keys after one local preference fails", () => {
    const values = new Map([
      ["anki-note.first", "1"],
      ["anki-note.second", "2"],
      ["anki-note.third", "3"],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key: string) {
        if (key === "anki-note.second") throw new Error("storage unavailable");
        values.delete(key);
      },
    };

    const result = clearLocalPreferenceStorage(storage);

    expect(result).toEqual({
      clearedKeys: ["anki-note.first", "anki-note.third"],
      failedKeys: ["anki-note.second"],
    });
    expect([...values]).toEqual([["anki-note.second", "2"]]);
  });
});
