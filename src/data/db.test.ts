import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, type VocalAudioMaterial } from "../domain/vocalPitch";
import { makeReview } from "../domain/testFactories";
import type { PracticeSessionRecordV1, StaffRecallRunRecordV1 } from "../domain/types";
import { db, makeDefaultSettings, normalizeAppSettings, restoreDefaultConfiguration } from "./db";

describe("makeDefaultSettings", () => {
  it("uses the cold-start practice defaults", () => {
    expect(makeDefaultSettings()).toMatchObject({
      answerPitchMode: "note-name",
      defaultMode: "fixed-duration",
      fixedDurationSeconds: 60,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "quarter",
      autoPlayTarget: false,
      playAnswerNote: true,
      enabledGroupIds: ["G3-F4"],
      includeInterStaffLedgerSpellings: false,
      correctDelayMs: 0,
      answerKeyboardScale: 1,
      pianoVolume: 0.8,
    });
  });

  it("preserves the V2 notation mode while defaulting legacy settings to grand staff", () => {
    const current = makeDefaultSettings();
    expect(
      normalizeAppSettings({ ...current, enabledGroupIds: [], staffNotationMode: "bass-only" as const }),
    ).toMatchObject({
      enabledGroupIds: [],
      staffNotationMode: "bass-only",
    });
    expect(normalizeAppSettings({
      id: "default",
      schemaVersion: 1,
      dataSetId: "legacy",
      createdAt: "2026-07-01T00:00:00.000+08:00",
      enabledGroupIds: [],
    })).toMatchObject({
      enabledGroupIds: ["G3-F4"],
      staffNotationMode: "grand",
    });
  });

  it("discards the unreleased checkbox setting shape without failing", () => {
    const { staffNotationMode: _removedMode, ...staleV2 } = makeDefaultSettings();
    const normalized = normalizeAppSettings({
      ...staleV2,
      selectedStaffs: ["bass"],
    } as unknown as Parameters<typeof normalizeAppSettings>[0]);

    expect(normalized.staffNotationMode).toBe("grand");
    expect("selectedStaffs" in normalized).toBe(false);
  });

  it("defaults and clamps the answer keyboard scale without a schema migration", () => {
    const current = makeDefaultSettings();

    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 2 }).answerKeyboardScale).toBe(1.5);
    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 0.1 }).answerKeyboardScale).toBe(0.7);
    expect(normalizeAppSettings({
      ...current,
      answerKeyboardScale: undefined,
    } as unknown as Parameters<typeof normalizeAppSettings>[0]).answerKeyboardScale).toBe(1);
  });

  it("defaults answer-note playback on while preserving an explicit off setting", () => {
    const current = makeDefaultSettings();

    expect(normalizeAppSettings({
      ...current,
      playAnswerNote: undefined,
    } as unknown as Parameters<typeof normalizeAppSettings>[0]).playAnswerNote).toBe(true);
    expect(normalizeAppSettings({ ...current, playAnswerNote: false }).playAnswerNote).toBe(false);
  });

  it("defaults legacy answer matching to note names while preserving strict pitch matching", () => {
    const current = makeDefaultSettings();

    expect(normalizeAppSettings({
      ...current,
      answerPitchMode: undefined,
    } as unknown as Parameters<typeof normalizeAppSettings>[0]).answerPitchMode).toBe("note-name");
    expect(normalizeAppSettings({ ...current, answerPitchMode: "exact-pitch" }).answerPitchMode).toBe("exact-pitch");
    expect(normalizeAppSettings({
      ...current,
      answerPitchMode: "absolute-pitch",
    } as Parameters<typeof normalizeAppSettings>[0]).answerPitchMode).toBe("exact-pitch");
  });

  it("migrates the retired focused preference to the adaptive queue", () => {
    const normalized = normalizeAppSettings({
      ...makeDefaultSettings(),
      focusedTraining: true,
      queueStrategy: "focused",
    });

    expect(normalized.queueStrategy).toBe("adaptive");
    expect(normalized.focusedTraining).toBe(false);
  });
});

describe("restoreDefaultConfiguration", () => {
  it("resets configuration and backup binding while preserving learning data and dataset identity", async () => {
    const currentSettings = {
      ...makeDefaultSettings(),
      dataSetId: "dataset-keep",
      createdAt: "2026-01-01T00:00:00.000Z",
      firstReviewAt: "2026-01-02T00:00:00.000Z",
      answerPitchMode: "microphone" as const,
      pianoVolume: 0.3,
    };
    await db.settings.put(currentSettings);
    await db.backupStates.put({
      id: "default",
      schemaVersion: 1,
      directoryName: "piano-backups",
      lastBackupAt: "2026-01-03T00:00:00.000Z",
    });
    const session: PracticeSessionRecordV1 = {
      id: "session-kept",
      schemaVersion: 1,
      mode: "fixed-duration",
      enabledGroupIds: ["G3-F4"],
      startedAt: "2026-01-03T00:00:00.000Z",
      completedCount: 0,
      interruptedCount: 0,
    };
    const review = makeReview({ id: "review-kept", targetNoteId: "C4" });
    const recallRun: StaffRecallRunRecordV1 = {
      id: "recall-kept",
      schemaVersion: 1,
      answerSetKey: "recall-set",
      targetNoteIds: ["C4"],
      columnOrder: ["C"],
      columnActiveMs: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 },
      startedAt: "2026-01-03T00:00:00.000Z",
      endedAt: "2026-01-03T00:01:00.000Z",
    };
    const material: VocalAudioMaterial = {
      audioBlob: new Blob(["audio"]),
      config: DEFAULT_VOCAL_PITCH_CONFIG,
      contentDigest: "digest",
      createdAt: "2026-01-03T00:00:00.000Z",
      durationSeconds: 1,
      id: "material-kept",
      mimeType: "audio/wav",
      name: "recording",
      schemaVersion: 1,
      size: 5,
      source: "upload",
      updatedAt: "2026-01-03T00:00:00.000Z",
    };
    await db.practiceSessions.put(session);
    await db.reviews.put(review);
    await db.staffRecallRuns.put(recallRun);
    await db.vocalAudioMaterials.put(material);

    const restored = await restoreDefaultConfiguration(currentSettings);

    expect(restored).toMatchObject({
      dataSetId: "dataset-keep",
      createdAt: "2026-01-01T00:00:00.000Z",
      firstReviewAt: "2026-01-02T00:00:00.000Z",
      answerPitchMode: "note-name",
      pianoVolume: 0.8,
    });
    expect(await db.backupStates.get("default")).toEqual({ id: "default", schemaVersion: 1 });
    expect(await db.practiceSessions.get("session-kept")).toBeTruthy();
    expect(await db.reviews.get("review-kept")).toBeTruthy();
    expect(await db.staffRecallRuns.get("recall-kept")).toBeTruthy();
    expect(await db.vocalAudioMaterials.get("material-kept")).toBeTruthy();

    await Promise.all(db.tables.map((table) => table.clear()));
  });
});
