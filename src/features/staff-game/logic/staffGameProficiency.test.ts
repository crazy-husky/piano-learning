import { describe, expect, it } from "vitest";
import type { StaffGameProficiencySample } from "../../../domain/types";
import { aggregateStaffGameProficiencySamples } from "./staffGameProficiency";

const sample = (
  id: string,
  mode: StaffGameProficiencySample["mode"],
  wasInterrupted = false
): StaffGameProficiencySample => ({
  id,
  dataSetId: "dataset-1",
  runId: `run-${id}`,
  date: "2026-10-20",
  startedAt: "2026-10-20T10:00:00.000Z",
  endedAt: "2026-10-20T10:00:01.000Z",
  midi: 60,
  note: "C4",
  inputMode: "midi",
  sensitivityLevel: 3,
  rawResponseTimeMs: 1000,
  estimatedSystemDelayMs: 0,
  playerResponseTimeMs: 1000,
  firstInputCorrect: true,
  missed: false,
  wasInterrupted,
  mode,
});

describe("aggregateStaffGameProficiencySamples", () => {
  it("excludes song and interrupted samples from challenge proficiency", () => {
    const result = aggregateStaffGameProficiencySamples(
      [
        sample("learning", "staff-game"),
        sample("song", "song"),
        sample("interrupted", "staff-game", true),
      ],
      "midi",
      3
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ midi: 60, appearanceCount: 1, errorCount: 0 });
  });
});
