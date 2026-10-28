import { describe, expect, it } from "vitest";
import {
  serializeSessionProgressGroupKey,
  type SessionProgressGroup,
  type SessionProgressGroupKey,
} from "./sessionProgress";
import {
  createSessionProgressSelection,
  getSelectedSessionProgressGroups,
  getSessionProgressComparisonDimension,
  resolveSessionProgressSelection,
} from "./sessionProgressSelection";
import type {
  AnswerPitchMode,
  PracticeSessionRecordV1,
  PromptDisplayMode,
  QueueComparisonFamily,
} from "./types";

function group(
  id: string,
  promptDisplayMode: PromptDisplayMode,
  queueComparisonFamily: QueueComparisonFamily,
  startedAt: string,
  answerPitchMode: AnswerPitchMode = "note-name",
  context: Partial<
    Pick<
      SessionProgressGroupKey,
      | "practiceMode"
      | "duetDifficulty"
      | "duetLevel"
      | "duetCurriculumVersion"
      | "duetAllowDottedRhythms"
      | "metronomeSync"
    >
  > = {}
): SessionProgressGroup {
  const latestSession: PracticeSessionRecordV1 = {
    completedCount: 5,
    enabledGroupIds: ["G3-F4"],
    id,
    interruptedCount: 0,
    mode: "fixed-count",
    schemaVersion: 1,
    startedAt,
  };
  const key = {
    answerPitchMode,
    queueComparisonFamily,
    practiceMode: context.practiceMode ?? ("single-hand" as const),
    ...context,
    promptDisplayMode,
    promptNoteDuration: "quarter" as const,
    targetNoteSetKey: "target-set",
  };
  return {
    key,
    keyString: serializeSessionProgressGroupKey(key),
    latestSession,
    sessionCount: 1,
    sessionIds: [latestSession.id],
  };
}

describe("session progress selection", () => {
  it("does not mix single-hand and duet curriculum groups", () => {
    const single = group("single", "staff-page", "adaptive", "2026-07-01T10:00:00.000Z");
    const duetLevelOne = group(
      "duet-one",
      "staff-page",
      "adaptive",
      "2026-07-02T10:00:00.000Z",
      "note-name",
      {
        practiceMode: "duet",
        duetLevel: "level-1",
        duetCurriculumVersion: 2,
        duetAllowDottedRhythms: false,
      }
    );
    const duetLevelTwo = group(
      "duet-two",
      "staff-page",
      "adaptive",
      "2026-07-03T10:00:00.000Z",
      "note-name",
      {
        practiceMode: "duet",
        duetLevel: "level-2",
        duetCurriculumVersion: 2,
        duetAllowDottedRhythms: false,
      }
    );
    const selection = createSessionProgressSelection(duetLevelOne);

    expect(
      getSelectedSessionProgressGroups([single, duetLevelOne, duetLevelTwo], selection)
    ).toEqual([duetLevelOne]);
  });

  it("keeps note-name and exact-pitch records in separate selectable groups", () => {
    const noteName = group("note-name", "staff-page", "adaptive", "2026-07-01T10:00:00.000Z");
    const exactPitch = group(
      "exact-pitch",
      "staff-page",
      "adaptive",
      "2026-07-02T10:00:00.000Z",
      "exact-pitch"
    );
    const result = resolveSessionProgressSelection({
      current: createSessionProgressSelection(noteName),
      dimension: "answerPitchMode",
      groups: [noteName, exactPitch],
      preferredValue: "exact-pitch",
      values: ["note-name", "exact-pitch"],
    });

    expect(result.rejected).toBe(false);
    expect(getSessionProgressComparisonDimension(result.selection)).toBe("answerPitchMode");
    expect(getSelectedSessionProgressGroups([noteName, exactPitch], result.selection)).toHaveLength(
      2
    );
  });

  it("reconciles other dimensions to the nearest valid single group", () => {
    const single = group("single", "single-note", "adaptive", "2026-07-01T10:00:00.000Z");
    const staff = group("staff", "staff-page", "melody-v2", "2026-07-02T10:00:00.000Z");
    const result = resolveSessionProgressSelection({
      current: createSessionProgressSelection(single),
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["staff-page"],
    });

    expect(result.rejected).toBe(false);
    expect(result.selection.promptDisplayModes).toEqual(["staff-page"]);
    expect(result.selection.queueComparisonFamilies).toEqual(["melody-v2"]);
    expect(result.selection.chartBenchmarkGroupKey).toBe(staff.keyString);
  });

  it("builds a valid one-dimensional slice and preserves the benchmark group", () => {
    const single = group("single", "single-note", "adaptive", "2026-07-02T10:00:00.000Z");
    const staff = group("staff", "staff-page", "adaptive", "2026-07-01T10:00:00.000Z");
    const result = resolveSessionProgressSelection({
      current: createSessionProgressSelection(single),
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    });

    expect(result.rejected).toBe(false);
    expect(getSessionProgressComparisonDimension(result.selection)).toBe("promptDisplayMode");
    expect(getSelectedSessionProgressGroups([single, staff], result.selection)).toHaveLength(2);
    expect(result.selection.chartBenchmarkGroupKey).toBe(single.keyString);
  });

  it("rejects a multi-selection without a common fixed-condition slice", () => {
    const single = group("single", "single-note", "adaptive", "2026-07-02T10:00:00.000Z");
    const staff = group("staff", "staff-page", "melody-v2", "2026-07-01T10:00:00.000Z");
    const current = createSessionProgressSelection(single);
    const result = resolveSessionProgressSelection({
      current,
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    });

    expect(result.rejected).toBe(true);
    expect(result.selection).toBe(current);
  });

  it("moves the comparison axis and collapses the old axis to the benchmark value", () => {
    const singleAdaptive = group(
      "single-adaptive",
      "single-note",
      "adaptive",
      "2026-07-03T10:00:00.000Z"
    );
    const staffAdaptive = group(
      "staff-adaptive",
      "staff-page",
      "adaptive",
      "2026-07-02T10:00:00.000Z"
    );
    const singleMelody = group(
      "single-melody",
      "single-note",
      "melody-v2",
      "2026-07-01T10:00:00.000Z"
    );
    const displaySlice = resolveSessionProgressSelection({
      current: createSessionProgressSelection(singleAdaptive),
      dimension: "promptDisplayMode",
      groups: [singleAdaptive, staffAdaptive, singleMelody],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    }).selection;
    const result = resolveSessionProgressSelection({
      current: displaySlice,
      dimension: "queueComparisonFamily",
      groups: [singleAdaptive, staffAdaptive, singleMelody],
      preferredValue: "melody-v2",
      values: ["adaptive", "melody-v2"],
    });

    expect(result.rejected).toBe(false);
    expect(result.selection.promptDisplayModes).toEqual(["single-note"]);
    expect(result.selection.queueComparisonFamilies).toEqual(["adaptive", "melody-v2"]);
  });

  it("rejects clearing a condition dimension", () => {
    const single = group("single", "single-note", "adaptive", "2026-07-01T10:00:00.000Z");
    const current = createSessionProgressSelection(single);
    const result = resolveSessionProgressSelection({
      current,
      dimension: "promptDisplayMode",
      groups: [single],
      preferredValue: "single-note",
      values: [],
    });

    expect(result.rejected).toBe(true);
    expect(result.selection).toBe(current);
  });
});
