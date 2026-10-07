export const LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT = "piano-learning:local-preference-change";
export const LOCAL_STORAGE_PREFERENCES_RESET_EVENT = "piano-learning:local-preferences-reset";

export function announceLocalStoragePreferenceChange(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT, { detail: { key } }));
}

export function clearLocalPreferenceStorage(
  storage: Pick<Storage, "key" | "length" | "removeItem">,
  preservedKeys: readonly string[] = [],
): { clearedKeys: string[]; failedKeys: string[] } {
  const preserved = new Set(preservedKeys);
  let keys: string[];
  try {
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null && key.startsWith("anki-note.") && !preserved.has(key));
  } catch {
    return { clearedKeys: [], failedKeys: ["<localStorage enumeration>"] };
  }

  const clearedKeys: string[] = [];
  const failedKeys: string[] = [];
  keys.forEach((key) => {
    try {
      storage.removeItem(key);
      clearedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  });
  return { clearedKeys, failedKeys };
}
