import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../../domain/types";
import {
  makeDefaultPracticeSetupUiPreferences,
  normalizePromptNoteDurations,
  parsePracticeSetupUiPreferences,
} from "./practiceSetupUiPreferences";

const settings = {
  answerPitchMode: "exact",
  promptNoteDuration: "quarter",
  promptNoteDurations: ["quarter"],
  autoPlayTarget: false,
  playAnswerNote: false,
  drillNoteNames: ["C"],
  fixedCount: 20,
  fixedDurationSeconds: 60,
  defaultMode: "open-ended",
  promptDisplayMode: "staff-page",
} as unknown as AppSettings;

const fallback = makeDefaultPracticeSetupUiPreferences(settings);

describe("practice setup UI preference parsing", () => {
  it("migrates unversioned queue strategies to the adaptive strategy", () => {
    const parsed = parsePracticeSetupUiPreferences({ queueStrategy: "melody" }, fallback);

    expect(parsed.queueStrategy).toBe("adaptive");
    expect(parsed.queueStrategyPreferenceVersion).toBe(1);
  });

  it("keeps supported current-version strategies and normalizes focused mode", () => {
    expect(
      parsePracticeSetupUiPreferences(
        { queueStrategy: "melody", queueStrategyPreferenceVersion: 1 },
        fallback
      ).queueStrategy
    ).toBe("melody");
    expect(
      parsePracticeSetupUiPreferences(
        { queueStrategy: "focused", queueStrategyPreferenceVersion: 1 },
        fallback
      ).queueStrategy
    ).toBe("adaptive");
  });

  it("migrates the old chase defaults and rejects invalid note-duration values", () => {
    const parsed = parsePracticeSetupUiPreferences(
      {
        chaseSpeedMultiplier: 1.5,
        chaseStartCount: 4,
        promptNoteDurations: ["not-a-duration", "quarter"],
      },
      fallback
    );

    expect(parsed.chaseSpeedMultiplier).toBe(fallback.chaseSpeedMultiplier);
    expect(parsed.chaseStartCount).toBe(fallback.chaseStartCount);
    expect(parsed.promptNoteDurations).toEqual(["quarter"]);
    expect(normalizePromptNoteDurations([], ["eighth"])).toEqual(["eighth"]);
  });
});
