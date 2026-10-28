export const METRONOME_HIDDEN_UNTIL_KEY = "anki-note.metronomeHiddenUntil";

export function clearMetronomeHiddenUntil(): boolean {
  try {
    window.localStorage.removeItem(METRONOME_HIDDEN_UNTIL_KEY);
    return true;
  } catch {
    return false;
  }
}
