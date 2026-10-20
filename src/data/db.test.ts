import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, type VocalAudioMaterial } from "../domain/vocalPitch";
import { makeReview } from "../domain/testFactories";
import type {
  AnswerEvent,
  StaffGameProficiencySample,
  StaffGameWrongNoteArchive,
  PracticeSessionRecordV1,
  StaffGameWrongNoteArchiveRun,
  StaffRecallRunRecordV1,
} from "../domain/types";
import {
  AppDatabase,
  db,
  clearStaffGameWrongNoteArchives,
  clearLearningRecordsPreservingConfiguration,
  deletePracticeSessionWithReviews,
  deleteStaffGameWrongNoteArchiveRuns,
  enqueuePendingStaffGameWrongNoteArchiveRun,
  makeDefaultSettings,
  loadPracticeHistory,
  normalizeAppSettings,
  retryPendingStaffGameWrongNoteArchives,
  retryPendingAnswerEvents,
  saveAnswerEvents,
  openDatabaseForInitialization,
  finalizeStaffGameDataReset,
  replaceAllData,
  restoreDefaultConfiguration,
} from "./db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeMemoryLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

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
      enabledGroupIds: ["C4-B4"],
      includeInterStaffLedgerSpellings: false,
      correctDelayMs: 0,
      pianoVolume: 0.8,
    });
  });

  it("preserves the V2 notation mode while defaulting legacy settings to grand staff", () => {
    const current = makeDefaultSettings();
    expect(
      normalizeAppSettings({
        ...current,
        enabledGroupIds: [],
        staffNotationMode: "bass-only" as const,
      })
    ).toMatchObject({
      enabledGroupIds: [],
      staffNotationMode: "bass-only",
    });
    expect(
      normalizeAppSettings({
        id: "default",
        schemaVersion: 1,
        dataSetId: "legacy",
        createdAt: "2026-07-01T00:00:00.000+08:00",
        enabledGroupIds: [],
      })
    ).toMatchObject({
      enabledGroupIds: ["C4-B4"],
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

  it("discards the retired keyboard scale setting when loading existing settings", () => {
    const current = makeDefaultSettings();
    const normalized = normalizeAppSettings({
      ...current,
      answerKeyboardScale: 1.5,
    } as unknown as Parameters<typeof normalizeAppSettings>[0]);

    expect("answerKeyboardScale" in normalized).toBe(false);
  });

  it("defaults answer-note playback on while preserving an explicit off setting", () => {
    const current = makeDefaultSettings();

    expect(
      normalizeAppSettings({
        ...current,
        playAnswerNote: undefined,
      } as unknown as Parameters<typeof normalizeAppSettings>[0]).playAnswerNote
    ).toBe(true);
    expect(normalizeAppSettings({ ...current, playAnswerNote: false }).playAnswerNote).toBe(false);
  });

  it("defaults legacy answer matching to note names while preserving strict pitch matching", () => {
    const current = makeDefaultSettings();

    expect(
      normalizeAppSettings({
        ...current,
        answerPitchMode: undefined,
      } as unknown as Parameters<typeof normalizeAppSettings>[0]).answerPitchMode
    ).toBe("note-name");
    expect(
      normalizeAppSettings({ ...current, answerPitchMode: "exact-pitch" }).answerPitchMode
    ).toBe("exact-pitch");
    expect(
      normalizeAppSettings({
        ...current,
        answerPitchMode: "absolute-pitch",
      } as Parameters<typeof normalizeAppSettings>[0]).answerPitchMode
    ).toBe("exact-pitch");
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
      enabledGroupIds: ["C4-B4"],
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

describe("staff game archive database reset", () => {
  it("clears old archive rows as part of the v9 reset", async () => {
    const databaseName = `anki-note-drill-migration-${Date.now()}-${Math.random()}`;
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(4).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
      vocalAudioMaterials: "id, createdAt, updatedAt, name",
      staffGameWrongNoteArchives: "id, date",
    });
    await legacyDatabase.open();

    const challengeRun: StaffGameWrongNoteArchiveRun = {
      runId: "challenge-run",
      source: "challenge",
      level: 1,
      difficulty: "easy",
      inputMode: "virtual",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      totalTargets: 1,
      firstTryCorrect: 0,
      lowSample: false,
      notes: {},
    };
    const reviewRun: StaffGameWrongNoteArchiveRun = {
      ...challengeRun,
      runId: "review-run",
      source: "review",
      level: null,
      reviewRange: 7,
    };
    const legacyDrillRun = {
      ...challengeRun,
      runId: "drill-run",
      source: "drill",
    };
    const mixedDateArchive: StaffGameWrongNoteArchive = {
      id: "2026-10-15",
      date: "2026-10-15",
      runs: [challengeRun, reviewRun, legacyDrillRun as unknown as StaffGameWrongNoteArchiveRun],
    };
    const drillOnlyArchive = {
      id: "2026-10-14",
      date: "2026-10-14",
      runs: [legacyDrillRun],
    };
    await legacyDatabase
      .table("staffGameWrongNoteArchives")
      .bulkPut([mixedDateArchive, drillOnlyArchive]);
    legacyDatabase.close();

    const upgradedDatabase = new AppDatabase(databaseName);
    await upgradedDatabase.open();

    expect(await upgradedDatabase.staffGameWrongNoteArchives.toArray()).toEqual([]);
    await upgradedDatabase.delete();
  });
});

describe("Staff Game data reset", () => {
  it("keeps reporting a pending blocked open until it resolves", async () => {
    vi.stubGlobal("window", { localStorage: makeMemoryLocalStorage() });
    let resolveOpen!: (database: Dexie) => void;
    const pendingOpen = new Promise<Dexie>((resolve) => {
      resolveOpen = resolve;
    }) as ReturnType<typeof db.open>;
    await db.open();
    const isOpen = vi.spyOn(db, "isOpen").mockReturnValue(false);
    const open = vi.spyOn(db, "open").mockReturnValue(pendingOpen);

    const firstAttempt = openDatabaseForInitialization();
    await Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.on("blocked").fire({ oldVersion: 8, newVersion: 9 } as IDBVersionChangeEvent);
    await expect(firstAttempt).resolves.toBe(false);
    await expect(openDatabaseForInitialization()).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    resolveOpen(db);
    await pendingOpen;
    isOpen.mockReturnValue(true);
    await expect(openDatabaseForInitialization()).resolves.toBe(true);
  });

  it("opens the current database without deleting it when no local reset marker exists", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    const previousSettings = await db.settings.get("default");
    const settings = { ...makeDefaultSettings(), dataSetId: "keep-without-reset-marker" };
    await db.settings.put(settings);
    db.close();

    await expect(openDatabaseForInitialization()).resolves.toBe(true);
    await expect(db.settings.get("default")).resolves.toMatchObject({
      dataSetId: "keep-without-reset-marker",
    });

    if (previousSettings) await db.settings.put(previousSettings);
    else await db.settings.delete("default");
  });

  it("clears Staff Game rows and keeps unrelated events", async () => {
    const databaseName = `anki-note-staff-game-reset-${Date.now()}-${Math.random()}`;
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(8).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      answerEvents:
        "id, sessionId, eventIndex, occurredAt, mode, inputMode, sensitivityLevel, targetMidi, songId, levelId",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
      vocalAudioMaterials: "id, createdAt, updatedAt, name",
      staffGameWrongNoteArchives: "id, date",
      staffGameProficiencySamples:
        "id, runId, date, endedAt, midi, inputMode, sensitivityLevel, [midi+inputMode+sensitivityLevel]",
    });
    await legacyDatabase.open();
    await legacyDatabase.table("staffGameWrongNoteArchives").put({
      id: "2026-10-20",
      date: "2026-10-20",
      runs: [],
    });
    const sample: StaffGameProficiencySample = {
      id: "sample-staff-game",
      dataSetId: "dataset-1",
      runId: "run-1",
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
      mode: "staff-game",
    };
    await legacyDatabase.table("staffGameProficiencySamples").put(sample);
    const makeEvent = (id: string, mode: AnswerEvent["mode"]): AnswerEvent => ({
      id,
      dataSetId: "dataset-1",
      sessionId: `session-${id}`,
      eventIndex: 0,
      occurredAt: "2026-10-20T10:00:01.000Z",
      mode,
      inputMode: "midi",
      deviceInfo: "Mac",
      attempts: [],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    });
    await legacyDatabase
      .table("answerEvents")
      .bulkPut([
        makeEvent("event-staff-game", "staff-game"),
        makeEvent("event-song", "song"),
        makeEvent("event-free-practice", "free-practice"),
      ]);
    legacyDatabase.close();

    const upgradedDatabase = new AppDatabase(databaseName);
    await upgradedDatabase.open();
    try {
      expect(await upgradedDatabase.staffGameWrongNoteArchives.count()).toBe(0);
      expect(await upgradedDatabase.staffGameProficiencySamples.count()).toBe(0);
      expect(await upgradedDatabase.answerEvents.toArray()).toMatchObject([
        { id: "event-free-practice", mode: "free-practice" },
      ]);
      expect(await upgradedDatabase.appMigrationState.get("staff-game-data-reset-v9")).toEqual({
        id: "staff-game-data-reset-v9",
        pending: true,
      });
    } finally {
      upgradedDatabase.close();
      await upgradedDatabase.delete();
    }
  });

  it("clears old local progress and only removes Staff Game rows from the retry queue", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    const events: AnswerEvent[] = ["staff-game", "song", "free-practice"].map((mode, index) => ({
      id: `pending-${index}`,
      dataSetId: "dataset-1",
      sessionId: `pending-session-${index}`,
      eventIndex: 0,
      occurredAt: "2026-10-20T10:00:01.000Z",
      mode: mode as AnswerEvent["mode"],
      inputMode: "midi",
      deviceInfo: "Mac",
      attempts: [],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    }));
    localStorage.setItem("anki-note.staffGameProgress.v5", "old-progress");
    localStorage.setItem("anki-note.pendingArchive", "old-archive");
    localStorage.setItem("anki-note.pendingAnswerEvents.v1", JSON.stringify(events));
    await db.appMigrationState.put({ id: "staff-game-data-reset-v9", pending: true });

    await finalizeStaffGameDataReset();

    expect(localStorage.getItem("anki-note.staffGameProgress.v5")).toBeNull();
    expect(localStorage.getItem("anki-note.pendingArchive")).toBeNull();
    expect(JSON.parse(localStorage.getItem("anki-note.pendingAnswerEvents.v1") ?? "[]")).toEqual([
      events[2],
    ]);
    await expect(db.appMigrationState.get("staff-game-data-reset-v9")).resolves.toEqual({
      id: "staff-game-data-reset-v9",
      pending: false,
    });
  });

  it("retries a staged AnswerEvent after a transient IndexedDB write failure", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    const settings = { ...makeDefaultSettings(), dataSetId: "dataset-at-save" };
    await db.settings.put(settings);
    const event: AnswerEvent = {
      id: "retryable-event",
      dataSetId: "",
      sessionId: "retryable-session",
      eventIndex: 0,
      occurredAt: "2026-10-20T10:00:01.000Z",
      mode: "free-practice",
      inputMode: "midi",
      deviceInfo: "Mac",
      attempts: [],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    };
    const bulkPut = vi
      .spyOn(db.answerEvents, "bulkPut")
      .mockRejectedValueOnce(new Error("temporary IndexedDB failure"));

    await expect(saveAnswerEvents([event])).rejects.toThrow("temporary IndexedDB failure");
    expect(JSON.parse(localStorage.getItem("anki-note.pendingAnswerEvents.v1") ?? "[]")).toEqual([
      { ...event, dataSetId: "dataset-at-save" },
    ]);

    await db.settings.put({ ...settings, dataSetId: "dataset-after-switch" });
    bulkPut.mockRestore();
    expect(await retryPendingAnswerEvents()).toBe(1);
    expect(await db.answerEvents.get(event.id)).toMatchObject({
      id: event.id,
      dataSetId: "dataset-at-save",
    });
    expect(localStorage.getItem("anki-note.pendingAnswerEvents.v1")).toBeNull();
  });
});

describe("wrong note archive backup merge", () => {
  it("preserves unique runs and prefers the newer same-ID run during backup import", async () => {
    const run = (runId: string): StaffGameWrongNoteArchiveRun => ({
      runId,
      source: "challenge",
      level: 1,
      difficulty: "easy",
      inputMode: "midi",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      updatedAt: "2026-10-15T10:01:00.000Z",
      totalTargets: 1,
      firstTryCorrect: 0,
      lowSample: true,
      notes: {
        "60": {
          midi: 60,
          note: "C4",
          appear: 1,
          correct: 0,
          wrong: 1,
          missed: 0,
          confusions: {},
        },
      },
    });
    const local = run("conflict-run");
    const newerRemote = {
      ...run("conflict-run"),
      updatedAt: "2026-10-15T10:05:00.000Z",
      totalTargets: 2,
    };
    const remote = run("remote-run");
    const legacyDrillRun = {
      ...run("legacy-drill-run"),
      source: "drill",
    };
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.staffGameWrongNoteArchives.put({
      id: "2026-10-15",
      date: "2026-10-15",
      runs: [local],
    });

    await replaceAllData(makeDefaultSettings(), [], [], [], undefined, [
      {
        id: "2026-10-15",
        date: "2026-10-15",
        runs: [
          remote,
          newerRemote,
          local,
          legacyDrillRun as unknown as StaffGameWrongNoteArchiveRun,
        ],
      },
    ]);

    expect(await db.staffGameWrongNoteArchives.get("2026-10-15")).toEqual({
      id: "2026-10-15",
      date: "2026-10-15",
      runs: [newerRemote, remote],
    });
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("clears only wrong note archives", async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    const session: PracticeSessionRecordV1 = {
      id: "session-preserved",
      schemaVersion: 1,
      mode: "fixed-duration",
      enabledGroupIds: ["C4-B4"],
      startedAt: "2026-10-15T10:00:00.000Z",
      completedCount: 0,
      interruptedCount: 0,
    };
    const run: StaffGameWrongNoteArchiveRun = {
      runId: "archive-cleared",
      source: "challenge",
      level: 1,
      difficulty: "easy",
      inputMode: "midi",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      reviewRange: null,
      totalTargets: 1,
      firstTryCorrect: 0,
      lowSample: false,
      notes: {},
    };
    const review = makeReview({ id: "review-preserved", targetNoteId: "C4" });
    await db.settings.put(makeDefaultSettings());
    await db.practiceSessions.put(session);
    await db.reviews.put(review);
    await db.staffGameWrongNoteArchives.put({
      id: "2026-10-15",
      date: "2026-10-15",
      runs: [run],
    });

    await clearStaffGameWrongNoteArchives();

    expect(await db.staffGameWrongNoteArchives.count()).toBe(0);
    expect(await db.settings.get("default")).toBeTruthy();
    expect(await db.practiceSessions.get(session.id)).toEqual(session);
    expect(await db.reviews.get(review.id)).toEqual(review);
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it("deletes selected wrong note runs and removes empty daily rows", async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    const makeRun = (runId: string): StaffGameWrongNoteArchiveRun => ({
      runId,
      source: runId.startsWith("review") ? "review" : "challenge",
      level: runId.startsWith("review") ? null : 2,
      difficulty: "normal",
      inputMode: "virtual",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: "2026-10-15T10:01:00.000Z",
      reviewRange: runId.startsWith("review") ? 7 : null,
      totalTargets: 1,
      firstTryCorrect: 0,
      lowSample: false,
      notes: {},
    });
    await db.staffGameWrongNoteArchives.bulkPut([
      {
        id: "2026-10-15",
        date: "2026-10-15",
        runs: [makeRun("challenge-keep"), makeRun("challenge-delete")],
      },
      {
        id: "2026-10-14",
        date: "2026-10-14",
        runs: [makeRun("review-delete")],
      },
    ]);
    const makeAnswerEvent = (sessionId: string): AnswerEvent => ({
      id: `event-${sessionId}`,
      dataSetId: "dataset",
      sessionId,
      eventIndex: 0,
      occurredAt: "2026-10-15T10:01:00.000Z",
      mode: "staff-game",
      inputMode: "virtual-keyboard",
      deviceInfo: "Mac",
      attempts: [],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    });
    await db.answerEvents.bulkPut([
      makeAnswerEvent("challenge-keep"),
      makeAnswerEvent("challenge-delete"),
      makeAnswerEvent("review-delete"),
    ]);

    const remaining = await deleteStaffGameWrongNoteArchiveRuns([
      "challenge-delete",
      "review-delete",
    ]);

    expect(remaining).toEqual([
      {
        id: "2026-10-15",
        date: "2026-10-15",
        runs: [makeRun("challenge-keep")],
      },
    ]);
    expect(await db.staffGameWrongNoteArchives.get("2026-10-14")).toBeUndefined();
    expect(await db.answerEvents.toArray()).toEqual([makeAnswerEvent("challenge-keep")]);
    await Promise.all(db.tables.map((table) => table.clear()));
  });
});

describe("pending wrong note archive retry", () => {
  const storageKey = "anki-note.pendingArchive";
  const makeRun = (runId: string): StaffGameWrongNoteArchiveRun => ({
    runId,
    source: "challenge",
    level: 3,
    difficulty: "normal",
    inputMode: "virtual",
    startedAt: "2026-10-16T10:00:00.000Z",
    endedAt: "2026-10-16T10:01:00.000Z",
    updatedAt: "2026-10-16T10:01:00.000Z",
    reviewRange: null,
    totalTargets: 1,
    firstTryCorrect: 0,
    lowSample: false,
    notes: {},
  });

  it("retries a saved pending run once and clears it by run ID", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    await db.staffGameWrongNoteArchives.clear();
    await enqueuePendingStaffGameWrongNoteArchiveRun(makeRun("retry-once"));

    const saved = await retryPendingStaffGameWrongNoteArchives();
    const retriedAgain = await retryPendingStaffGameWrongNoteArchives();

    expect(saved).toHaveLength(1);
    expect(retriedAgain).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(await db.staffGameWrongNoteArchives.get("2026-10-16")).toMatchObject({
      runs: [{ runId: "retry-once" }],
    });
    await db.staffGameWrongNoteArchives.clear();
  });

  it("keeps a pending run when the database retry fails", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    await db.staffGameWrongNoteArchives.clear();
    const run = makeRun("retry-after-failure");
    await enqueuePendingStaffGameWrongNoteArchiveRun(run);
    const getSpy = vi
      .spyOn(db.staffGameWrongNoteArchives, "get")
      .mockRejectedValueOnce(new Error("database unavailable"));

    await retryPendingStaffGameWrongNoteArchives();

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([run]);
    getSpy.mockRestore();

    const saved = await retryPendingStaffGameWrongNoteArchives();

    expect(saved).toHaveLength(1);
    expect(localStorage.getItem(storageKey)).toBeNull();
    await db.staffGameWrongNoteArchives.clear();
  });

  it("deduplicates by run ID and does not downgrade a full archive to trend-only", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    const fullRun = { ...makeRun("same-run"), trendOnly: false };
    const trendRun = { ...makeRun("same-run"), trendOnly: true };

    await enqueuePendingStaffGameWrongNoteArchiveRun(fullRun);
    await enqueuePendingStaffGameWrongNoteArchiveRun(trendRun);

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([fullRun]);
  });

  it("uses the origin-wide Web Lock for queue writes, retry, and deletion", async () => {
    const localStorage = makeMemoryLocalStorage();
    const requestedLocks: string[] = [];
    const requestLock = vi.fn(async (name: string, callback: () => Promise<unknown>) => {
      requestedLocks.push(name);
      return callback();
    });
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    await db.staffGameWrongNoteArchives.clear();
    const run = makeRun("web-lock-run");
    await enqueuePendingStaffGameWrongNoteArchiveRun(run);

    await retryPendingStaffGameWrongNoteArchives();
    await deleteStaffGameWrongNoteArchiveRuns([run.runId]);

    expect(requestedLocks).toEqual([
      "anki-note.staff-game-archive-mutations",
      "anki-note.staff-game-archive-mutations",
      "anki-note.staff-game-archive-mutations",
    ]);
    await db.staffGameWrongNoteArchives.clear();
  });

  it("skips a snapshotted retry removed by another tab before its write transaction", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {});
    await db.staffGameWrongNoteArchives.clear();
    const run = makeRun("removed-in-another-tab");
    await enqueuePendingStaffGameWrongNoteArchiveRun(run);
    const otherTabDatabase = new AppDatabase(db.name);
    await otherTabDatabase.open();

    let unblockRetry!: () => void;
    let notifyRetryStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      notifyRetryStarted = resolve;
    });
    const retryGate = new Promise<void>((resolve) => {
      unblockRetry = resolve;
    });
    const otherTabDeletePromise = otherTabDatabase.transaction(
      "rw",
      otherTabDatabase.staffGameWrongNoteArchives,
      async () => {
        await otherTabDatabase.staffGameWrongNoteArchives.count();
        notifyRetryStarted();
        await retryGate;
        localStorage.removeItem(storageKey);
        await otherTabDatabase.staffGameWrongNoteArchives.clear();
      }
    );

    const retryPromise = retryPendingStaffGameWrongNoteArchives();
    await retryStarted;
    unblockRetry();
    await otherTabDeletePromise;

    expect(await retryPromise).toEqual([]);
    expect(await db.staffGameWrongNoteArchives.count()).toBe(0);
    otherTabDatabase.close();
  });

  it("does not restore a queued run deleted while a retry is saving another run", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    await db.staffGameWrongNoteArchives.clear();
    const keepRun = makeRun("retry-keep");
    const deleteRun = makeRun("retry-delete");
    await enqueuePendingStaffGameWrongNoteArchiveRun(keepRun);
    await enqueuePendingStaffGameWrongNoteArchiveRun(deleteRun);

    let unblockFirstWrite!: () => void;
    let notifyFirstWriteStarted!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      notifyFirstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      unblockFirstWrite = resolve;
    });
    const originalTransaction = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
    let shouldPause = true;
    vi.spyOn(db, "transaction").mockImplementation((async (...args: unknown[]) => {
      if (shouldPause) {
        shouldPause = false;
        notifyFirstWriteStarted();
        await firstWriteGate;
      }
      return originalTransaction(...args);
    }) as typeof db.transaction);

    const retryPromise = retryPendingStaffGameWrongNoteArchives();
    await firstWriteStarted;
    const deletePromise = deleteStaffGameWrongNoteArchiveRuns([deleteRun.runId]);
    unblockFirstWrite();

    const [retried, remaining] = await Promise.all([retryPromise, deletePromise]);

    expect(retried).toHaveLength(1);
    expect(retried[0]?.runs.map((run) => run.runId)).toEqual([keepRun.runId]);
    expect(remaining[0]?.runs.map((run) => run.runId)).toEqual([keepRun.runId]);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([]);
    vi.restoreAllMocks();
    await db.staffGameWrongNoteArchives.clear();
  });

  it("serializes queue read-modify-write through IndexedDB when Web Locks are unavailable", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {});
    const transactionSpy = vi.spyOn(db, "transaction");
    const run = makeRun("idb-coordinated-queue");

    await enqueuePendingStaffGameWrongNoteArchiveRun(run);
    await deleteStaffGameWrongNoteArchiveRuns([run.runId]);

    expect(transactionSpy).toHaveBeenCalledWith(
      "rw",
      db.staffGameWrongNoteArchives,
      expect.any(Function)
    );
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("reports when browser storage cannot persist a pending run", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage unavailable");
        },
        removeItem: () => undefined,
      },
    });

    await expect(
      enqueuePendingStaffGameWrongNoteArchiveRun(makeRun("storage-fails"))
    ).resolves.toBe(false);
  });

  it("loads practice history from answer events and removes its events with the session", async () => {
    const event: AnswerEvent = {
      id: "answer-event-practice-history",
      dataSetId: "dataset-1",
      sessionId: "practice-session-1",
      eventIndex: 0,
      occurredAt: "2026-10-19T10:00:02.000Z",
      promptStartedAt: "2026-10-19T10:00:00.000Z",
      mode: "free-practice",
      inputMode: "midi",
      deviceInfo: "Mac",
      targetMidi: 60,
      targetNoteId: "C4",
      targetGroupId: "G3-F4",
      targetNoteName: "C",
      targetOctave: 4,
      attempts: [{ midi: 60, atMs: 2000, isCorrect: true, clipping: false }],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      rawResponseTimeMs: 2000,
      responseTimeMs: 2000,
      activeMs: 2000,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    };
    await db.reviews.clear();
    await db.answerEvents.clear();
    await db.answerEvents.put(event);

    const history = await loadPracticeHistory();
    expect(history.reviews).toHaveLength(1);
    expect(history.reviews[0]).toMatchObject({
      id: event.id,
      sessionId: event.sessionId,
      targetNoteId: event.targetNoteId,
      answeredCorrectly: true,
    });

    await deletePracticeSessionWithReviews(event.sessionId, history.reviews);
    expect(await db.answerEvents.count()).toBe(0);
  });

  it("clears learning records while retaining settings and blocks silent backup restore", async () => {
    const localStorage = makeMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem("anki-note.practicePagePreferences", "saved-config");
    localStorage.setItem("anki-note.staffGameProgress.v5", "saved-progress");
    await db.settings.put({ ...makeDefaultSettings(), firstReviewAt: "2026-10-19T10:00:00.000Z" });
    await db.backupStates.put({
      id: "default",
      schemaVersion: 1,
      directoryName: "piano-backup",
      lastSeenBackupVersion: "snapshot:existing-backup",
      lastBackupAt: "2026-10-19T10:00:00.000Z",
    });
    await db.answerEvents.clear();
    await db.answerEvents.put({
      id: "clearable-answer-event",
      dataSetId: "dataset-1",
      sessionId: "session-1",
      eventIndex: 0,
      occurredAt: "2026-10-19T10:00:00.000Z",
      mode: "free-practice",
      inputMode: "midi",
      deviceInfo: "Mac",
      attempts: [],
      isCorrectFirstTry: true,
      isCorrectFinal: true,
      wrongAttempts: 0,
      isExtraNote: false,
      isMissed: false,
    });

    await clearLearningRecordsPreservingConfiguration();

    expect(await db.answerEvents.count()).toBe(0);
    expect((await db.settings.get("default"))?.firstReviewAt).toBeUndefined();
    expect((await db.settings.get("default"))?.dataSetId).toBeDefined();
    expect(await db.backupStates.get("default")).toMatchObject({
      directoryName: "piano-backup",
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
    });
    expect(localStorage.getItem("anki-note.practicePagePreferences")).toBe("saved-config");
    expect(localStorage.getItem("anki-note.staffGameProgress.v5")).toBeNull();
  });
});
