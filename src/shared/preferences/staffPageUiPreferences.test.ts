import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  parseStaffPageUiPreferences,
} from "./staffPageUiPreferences";

describe("staff-page UI preferences", () => {
  it("parses stored preferences without losing defaults", () => {
    expect(
      parseStaffPageUiPreferences(
        { pausedPlaybackBpm: 140, smoothStaffPageScroll: false, startPausedReading: true },
        DEFAULT_STAFF_PAGE_UI_PREFERENCES
      )
    ).toEqual({ smoothStaffPageScroll: false, startPausedReading: true });
    expect(parseStaffPageUiPreferences({}, DEFAULT_STAFF_PAGE_UI_PREFERENCES)).toEqual(
      DEFAULT_STAFF_PAGE_UI_PREFERENCES
    );
  });
});
