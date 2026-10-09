export interface PracticePagePreferences {
  focusLossPauseSeconds: 0 | 10 | 20 | 30;
}

export const PRACTICE_PAGE_PREFERENCES_KEY = "anki-note.practicePagePreferences";
export const DEFAULT_PRACTICE_PAGE_PREFERENCES: PracticePagePreferences = {
  focusLossPauseSeconds: 10,
};

export function parsePracticePagePreferences(
  value: unknown,
  fallback: PracticePagePreferences = DEFAULT_PRACTICE_PAGE_PREFERENCES,
): PracticePagePreferences {
  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const seconds = (value as Partial<PracticePagePreferences>).focusLossPauseSeconds;
  return {
    focusLossPauseSeconds: seconds === 0 || seconds === 10 || seconds === 20 || seconds === 30
      ? seconds
      : fallback.focusLossPauseSeconds,
  };
}
