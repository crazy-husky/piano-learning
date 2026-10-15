import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, type VocalAudioMaterial } from "../domain/vocalPitch";
import { makeReview } from "../domain/testFactories";
import type {
  StaffGameWrongNoteArchive,
  PracticeSessionRecordV1,
  StaffGameWrongNoteArchiveRun,
  StaffRecallRunRecordV1,
} from "../domain/types";
import {
  AppDatabase,
  db,
  clearStaffGameWrongNoteArchives,
  deleteStaffGameWrongNoteArchiveRuns,
  enqueuePendingStaffGameWrongNoteArchiveRun,
  makeDefaultSettings,
  normalizeAppSettings,
  retryPendingStaffGameWrongNoteArchives,
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

    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 2 }).answerKeyboardScale).toBe(
      1.5
    );
    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 0.1 }).answerKeyboardScale).toBe(
      0.7
    );
    expect(
      normalizeAppSettings({
        ...current,
        answerKeyboardScale: undefined,
      } as unknown as Parameters<typeof normalizeAppSettings>[0]).answerKeyboardScale
    ).toBe(1);
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

describe("staff game archive database migration", () => {
  it("removes legacy drill runs and empty dates when upgrading to version 5", async () => {
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

    expect(await upgradedDatabase.staffGameWrongNoteArchives.toArray()).toEqual([
      { ...mixedDateArchive, runs: [challengeRun, reviewRun] },
    ]);
    await upgradedDatabase.delete();
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
      enabledGroupIds: ["G3-F4"],
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
});
