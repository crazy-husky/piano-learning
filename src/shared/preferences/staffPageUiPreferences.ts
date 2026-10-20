export interface StaffPageUiPreferences {
  smoothStaffPageScroll: boolean;
  startPausedReading: boolean;
}

export const STAFF_PAGE_UI_PREFERENCES_KEY = "anki-note.staffPageUiPreferences";

export const DEFAULT_STAFF_PAGE_UI_PREFERENCES: StaffPageUiPreferences = {
  smoothStaffPageScroll: true,
  startPausedReading: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStaffPageUiPreferences(
  value: unknown,
  fallback: StaffPageUiPreferences
): StaffPageUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    smoothStaffPageScroll:
      typeof value.smoothStaffPageScroll === "boolean"
        ? value.smoothStaffPageScroll
        : fallback.smoothStaffPageScroll,
    startPausedReading:
      typeof value.startPausedReading === "boolean"
        ? value.startPausedReading
        : fallback.startPausedReading,
  };
}
