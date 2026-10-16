import Dexie, { type Table } from "dexie";
import { normalizeAnswerPitchMode } from "../domain/answerInput";
import { createUuid } from "../domain/id";
import {
  DEFAULT_ENABLED_GROUPS,
  normalizeCurrentPracticeGroupIds,
  normalizeEnabledPitchIds,
  normalizePracticeGroupIds,
} from "../domain/notes";
import {
  DEFAULT_ANSWER_KEYBOARD_SCALE,
  DEFAULT_PIANO_VOLUME,
  normalizeAnswerKeyboardScale,
  normalizePianoVolume,
} from "../domain/settings";
import type {
  AppSettings,
  BackupState,
  NoteName,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  StoredAppSettings,
  StaffNotationMode,
  StaffRangeSelection,
} from "../domain/types";
import { localDateKey } from "../domain/stats";
import {
  filterLegacyStaffGameDrillArchives,
  mergeStaffGameWrongNoteArchives,
} from "../domain/staffGameWrongNoteArchives";
import type { VocalAudioMaterial } from "../domain/vocalPitch";

const PENDING_STAFF_GAME_ARCHIVES_KEY = "anki-note.pendingArchive";
const STAFF_GAME_ARCHIVE_MUTATION_LOCK_NAME = "anki-note.staff-game-archive-mutations";
const STORED_PROMPT_NOTE_DURATIONS = ["whole", "quarter", "eighth", "sixteenth"] as const;
let staffGameArchiveMutationQueue: Promise<void> = Promise.resolve();

function withStaffGameArchiveMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const serializeInThisPage = (): Promise<T> => {
    const result = staffGameArchiveMutationQueue.then(operation, operation);
    staffGameArchiveMutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks
      .request<Promise<T>>(STAFF_GAME_ARCHIVE_MUTATION_LOCK_NAME, serializeInThisPage)
      .then((result) => result);
  }
  return serializeInThisPage();
}

function isPendingStaffGameArchiveRun(value: unknown): value is StaffGameWrongNoteArchiveRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<StaffGameWrongNoteArchiveRun>;
  return (
    typeof run.runId === "string" &&
    (run.source === "challenge" || run.source === "review") &&
    typeof run.endedAt === "string" &&
    Number.isFinite(Date.parse(run.endedAt)) &&
    Number.isFinite(run.totalTargets) &&
    !!run.notes &&
    typeof run.notes === "object" &&
    !Array.isArray(run.notes)
  );
}

function writePendingStaffGameArchiveRuns(runs: readonly StaffGameWrongNoteArchiveRun[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (runs.length === 0) window.localStorage.removeItem(PENDING_STAFF_GAME_ARCHIVES_KEY);
    else window.localStorage.setItem(PENDING_STAFF_GAME_ARCHIVES_KEY, JSON.stringify(runs));
    return true;
  } catch {
    // Archive saving must remain usable when browser storage is unavailable.
    return false;
  }
}

function readPendingStaffGameArchiveRuns(): StaffGameWrongNoteArchiveRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_STAFF_GAME_ARCHIVES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPendingStaffGameArchiveRun) : [];
  } catch {
    return [];
  }
}

async function updatePendingStaffGameArchiveRuns<T>(
  update: (pendingRuns: StaffGameWrongNoteArchiveRun[]) => {
    nextRuns: readonly StaffGameWrongNoteArchiveRun[];
    result: T;
  }
): Promise<{ result: T; persisted: boolean }> {
  return db.transaction("rw", db.staffGameWrongNoteArchives, async () => {
    // Overlapping readwrite transactions on this store serialize queue updates across tabs.
    await db.staffGameWrongNoteArchives.count();
    const { nextRuns, result } = update(readPendingStaffGameArchiveRuns());
    return { result, persisted: writePendingStaffGameArchiveRuns(nextRuns) };
  });
}

function removePendingStaffGameArchiveRunFromQueue(
  pendingRuns: StaffGameWrongNoteArchiveRun[],
  run: StaffGameWrongNoteArchiveRun
): StaffGameWrongNoteArchiveRun[] {
  return pendingRuns.filter((pending) => {
    if (pending.runId !== run.runId) return true;
    if (pending.trendOnly !== true && run.trendOnly === true) return true;
    const pendingUpdatedAt = Date.parse(pending.updatedAt ?? pending.endedAt);
    const savedUpdatedAt = Date.parse(run.updatedAt ?? run.endedAt);
    return Number.isFinite(pendingUpdatedAt) && Number.isFinite(savedUpdatedAt)
      ? savedUpdatedAt < pendingUpdatedAt
      : pending.updatedAt !== run.updatedAt;
  });
}

export async function enqueuePendingStaffGameWrongNoteArchiveRun(
  run: StaffGameWrongNoteArchiveRun
): Promise<boolean> {
  try {
    const { persisted } = await withStaffGameArchiveMutationLock(() =>
      updatePendingStaffGameArchiveRuns((pendingRuns) => {
        const existing = pendingRuns.find((pending) => pending.runId === run.runId);
        const shouldKeepFullArchive =
          existing !== undefined && existing.trendOnly !== true && run.trendOnly === true;
        const nextRun = shouldKeepFullArchive ? existing : run;
        return {
          nextRuns: [...pendingRuns.filter((pending) => pending.runId !== run.runId), nextRun],
          result: undefined,
        };
      })
    );
    return persisted;
  } catch {
    return false;
  }
}

export async function removePendingStaffGameWrongNoteArchiveRun(
  run: StaffGameWrongNoteArchiveRun
): Promise<void> {
  try {
    await withStaffGameArchiveMutationLock(() =>
      updatePendingStaffGameArchiveRuns((pendingRuns) => ({
        nextRuns: removePendingStaffGameArchiveRunFromQueue(pendingRuns, run),
        result: undefined,
      }))
    );
  } catch {
    // Keep the pending item for a later idempotent retry if queue coordination fails.
  }
}

export class AppDatabase extends Dexie {
  settings!: Table<StoredAppSettings, string>;
  practiceSessions!: Table<PracticeSessionRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  staffRecallRuns!: Table<StaffRecallRunRecord, string>;
  backupStates!: Table<BackupState, string>;
  vocalAudioMaterials!: Table<VocalAudioMaterial, string>;
  staffGameWrongNoteArchives!: Table<StaffGameWrongNoteArchive, string>;

  constructor(name = "anki-note") {
    super(name);
    this.version(1).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      backupStates: "id",
    });
    this.version(2).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
    });
    this.version(3).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
      vocalAudioMaterials: "id, createdAt, updatedAt, name",
    });
    this.version(4).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
      vocalAudioMaterials: "id, createdAt, updatedAt, name",
      staffGameWrongNoteArchives: "id, date",
    });
    this.version(5)
      .stores({
        settings: "id",
        practiceSessions: "id, startedAt, mode, endReason",
        reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
        staffRecallRuns: "id, answerSetKey, endedAt",
        backupStates: "id",
        vocalAudioMaterials: "id, createdAt, updatedAt, name",
        staffGameWrongNoteArchives: "id, date",
      })
      .upgrade(async (transaction) => {
        const archiveTable = transaction.table<StaffGameWrongNoteArchive>(
          "staffGameWrongNoteArchives"
        );
        const archives = await archiveTable.toArray();
        for (const archive of archives) {
          const [filteredArchive] = filterLegacyStaffGameDrillArchives([archive]);
          if (!filteredArchive) {
            await archiveTable.delete(archive.id);
          } else if (filteredArchive.runs.length !== archive.runs.length) {
            await archiveTable.put(filteredArchive);
          }
        }
      });
  }
}

export const db = new AppDatabase();

export function resolveQueueStrategy(settings: {
  queueStrategy?: PracticeQueueStrategy;
  focusedTraining?: boolean;
}): PracticeQueueStrategy {
  const stored = settings.queueStrategy ?? (settings.focusedTraining ? "focused" : "adaptive");
  return stored === "focused" ? "adaptive" : stored;
}

export function resolveDrillNoteNames(settings: { drillNoteNames?: NoteName[] }): NoteName[] {
  return settings.drillNoteNames && settings.drillNoteNames.length > 0
    ? settings.drillNoteNames
    : ["C"];
}

export function makeDefaultSettings(): AppSettings {
  const now = new Date().toISOString();
  return {
    id: "default",
    schemaVersion: 2,
    dataSetId: createUuid(),
    createdAt: now,
    enabledGroupIds: DEFAULT_ENABLED_GROUPS,
    staffNotationMode: "grand",
    defaultMode: "fixed-duration",
    promptDisplayMode: "staff-page",
    promptNoteDuration: "quarter",
    fixedCount: 20,
    fixedDurationSeconds: 60,
    autoPlayTarget: false,
    playAnswerNote: true,
    answerPitchMode: "note-name",
    includeInterStaffLedgerSpellings: false,
    answerKeyboardScale: DEFAULT_ANSWER_KEYBOARD_SCALE,
    pianoVolume: DEFAULT_PIANO_VOLUME,
    queueStrategy: "adaptive",
    drillNoteNames: ["C"],
    focusedTraining: false,
    inactivityThresholdSeconds: 30,
    correctDelayMs: 0,
  };
}

function normalizeStoredStaffNotationMode(value: unknown): StaffNotationMode {
  if (value === "treble-only" || value === "bass-only" || value === "grand") {
    return value;
  }
  return "grand";
}

function normalizeStaffRangeProfiles(
  value: unknown
): Partial<Record<StaffNotationMode, StaffRangeSelection>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const storedProfiles = value as Record<string, unknown>;
  const profiles: Partial<Record<StaffNotationMode, StaffRangeSelection>> = {};
  for (const mode of ["treble-only", "bass-only", "grand"] as const) {
    const candidate = storedProfiles[mode];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const storedRange = candidate as Record<string, unknown>;
    profiles[mode] = {
      enabledGroupIds: Array.isArray(storedRange.enabledGroupIds)
        ? normalizeCurrentPracticeGroupIds(storedRange.enabledGroupIds as string[])
        : [],
      enabledPitchIds: normalizeEnabledPitchIds(
        Array.isArray(storedRange.enabledPitchIds)
          ? (storedRange.enabledPitchIds as string[])
          : undefined
      ),
      crossGroupPitchIds: normalizeEnabledPitchIds(
        Array.isArray(storedRange.crossGroupPitchIds)
          ? (storedRange.crossGroupPitchIds as string[])
          : undefined
      ),
    };
  }
  return Object.keys(profiles).length > 0 ? profiles : undefined;
}

export function normalizeAppSettings(existing: StoredAppSettings): AppSettings {
  const { selectedStaffs: _discardedStaffs, ...stored } = existing as StoredAppSettings & {
    selectedStaffs?: unknown;
  };
  const defaults = makeDefaultSettings();
  const queueStrategy = resolveQueueStrategy(existing);
  return {
    ...defaults,
    ...stored,
    schemaVersion: 2,
    enabledGroupIds:
      existing.schemaVersion === 2
        ? normalizeCurrentPracticeGroupIds(existing.enabledGroupIds)
        : normalizePracticeGroupIds(existing.enabledGroupIds),
    enabledPitchIds: normalizeEnabledPitchIds(existing.enabledPitchIds),
    crossGroupPitchIds: normalizeEnabledPitchIds(existing.crossGroupPitchIds),
    staffRangeProfiles: normalizeStaffRangeProfiles(existing.staffRangeProfiles),
    staffNotationMode: normalizeStoredStaffNotationMode(
      "staffNotationMode" in stored ? stored.staffNotationMode : undefined
    ),
    defaultMode: existing.defaultMode ?? defaults.defaultMode,
    promptDisplayMode: existing.promptDisplayMode ?? "staff-page",
    promptNoteDuration: existing.promptNoteDuration ?? "quarter",
    ...(Array.isArray(existing.promptNoteDurations) &&
    existing.promptNoteDurations.some((duration) =>
      STORED_PROMPT_NOTE_DURATIONS.includes(
        duration as (typeof STORED_PROMPT_NOTE_DURATIONS)[number]
      )
    )
      ? {
          promptNoteDurations: STORED_PROMPT_NOTE_DURATIONS.filter((duration) =>
            existing.promptNoteDurations?.includes(duration)
          ),
        }
      : {}),
    fixedCount: existing.fixedCount ?? defaults.fixedCount,
    fixedDurationSeconds: existing.fixedDurationSeconds ?? defaults.fixedDurationSeconds,
    autoPlayTarget: existing.autoPlayTarget ?? defaults.autoPlayTarget,
    playAnswerNote: existing.playAnswerNote ?? defaults.playAnswerNote,
    answerPitchMode: normalizeAnswerPitchMode(existing.answerPitchMode),
    includeInterStaffLedgerSpellings:
      existing.schemaVersion === 2
        ? (existing.includeInterStaffLedgerSpellings ?? defaults.includeInterStaffLedgerSpellings)
        : (existing.includeLedgerVariants ?? true),
    answerKeyboardScale: normalizeAnswerKeyboardScale(existing.answerKeyboardScale),
    pianoVolume: normalizePianoVolume(existing.pianoVolume),
    queueStrategy,
    drillNoteNames: resolveDrillNoteNames(existing),
    focusedTraining: false,
    inactivityThresholdSeconds:
      existing.inactivityThresholdSeconds ?? defaults.inactivityThresholdSeconds,
    correctDelayMs: existing.correctDelayMs ?? defaults.correctDelayMs,
  };
}

function sameGroupIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((groupId, index) => groupId === b[index]);
}

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get("default");
  if (existing) {
    const migrated = normalizeAppSettings(existing);
    if (
      existing.schemaVersion !== 2 ||
      !sameGroupIds(existing.enabledGroupIds ?? [], migrated.enabledGroupIds) ||
      JSON.stringify(existing) !== JSON.stringify(migrated)
    ) {
      await db.settings.put(migrated);
    }
    return migrated;
  }
  const settings = makeDefaultSettings();
  await db.settings.put(settings);
  return settings;
}

export async function restoreDefaultConfiguration(
  currentSettings: AppSettings
): Promise<AppSettings> {
  const defaults = makeDefaultSettings();
  const settings: AppSettings = {
    ...defaults,
    dataSetId: currentSettings.dataSetId,
    createdAt: currentSettings.createdAt,
    ...(currentSettings.firstReviewAt ? { firstReviewAt: currentSettings.firstReviewAt } : {}),
  };

  await db.transaction("rw", db.settings, db.backupStates, async () => {
    await db.settings.put(settings);
    await db.backupStates.clear();
    await db.backupStates.put({ id: "default", schemaVersion: 1 });
  });

  return settings;
}

export async function getBackupState(): Promise<BackupState> {
  const existing = await db.backupStates.get("default");
  if (existing) {
    return existing;
  }
  const state: BackupState = { id: "default", schemaVersion: 1 };
  await db.backupStates.put(state);
  return state;
}

export async function saveReview(review: ReviewRecord): Promise<void> {
  await db.transaction("rw", db.reviews, db.settings, async () => {
    await db.reviews.put(review);
    const settings = await ensureSettings();
    if (!review.ignored && !settings.firstReviewAt) {
      await db.settings.put({ ...settings, firstReviewAt: review.startedAt });
    }
  });
}

export async function saveStaffRecallRun(run: StaffRecallRunRecord): Promise<void> {
  await db.staffRecallRuns.put(run);
}

export async function deletePracticeSessionWithReviews(
  sessionId: PracticeSessionRecord["id"],
  reviews: ReviewRecord[]
): Promise<void> {
  const reviewIds = reviews.filter((review) => !review.ignored).map((review) => review.id);
  await db.transaction("rw", db.settings, db.practiceSessions, db.reviews, async () => {
    await db.practiceSessions.delete(sessionId);
    if (reviewIds.length > 0) {
      await db.reviews.bulkDelete(reviewIds);
    }

    const settings = await db.settings.get("default");
    if (!settings) {
      return;
    }
    const [firstRemainingReview] = await db.reviews
      .filter((review) => !review.ignored)
      .sortBy("startedAt");
    const nextFirstReviewAt = firstRemainingReview?.startedAt;
    if (settings.firstReviewAt === nextFirstReviewAt) {
      return;
    }

    const nextSettings = { ...settings };
    if (nextFirstReviewAt) {
      nextSettings.firstReviewAt = nextFirstReviewAt;
    } else {
      delete nextSettings.firstReviewAt;
    }
    await db.settings.put(nextSettings);
  });
}

export async function replaceAllData(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
  staffRecallRuns: StaffRecallRunRecord[] = [],
  vocalAudioMaterials?: VocalAudioMaterial[],
  staffGameWrongNoteArchives: StaffGameWrongNoteArchive[] = []
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.settings,
      db.practiceSessions,
      db.reviews,
      db.staffRecallRuns,
      db.vocalAudioMaterials,
      db.staffGameWrongNoteArchives,
    ],
    async () => {
      await db.settings.clear();
      await db.practiceSessions.clear();
      await db.reviews.clear();
      await db.staffRecallRuns.clear();
      await db.settings.put(settings);
      await db.practiceSessions.bulkPut(sessions);
      await db.reviews.bulkPut(reviews);
      await db.staffRecallRuns.bulkPut(staffRecallRuns);
      const existingWrongNoteArchives = await db.staffGameWrongNoteArchives.toArray();
      const mergedWrongNoteArchives = mergeStaffGameWrongNoteArchives(
        existingWrongNoteArchives,
        staffGameWrongNoteArchives
      );
      await db.staffGameWrongNoteArchives.clear();
      await db.staffGameWrongNoteArchives.bulkPut(mergedWrongNoteArchives);
      if (vocalAudioMaterials) {
        await db.vocalAudioMaterials.clear();
        await db.vocalAudioMaterials.bulkPut(vocalAudioMaterials);
      }
    }
  );
}

export async function applyBackupDataChanges(
  settings: AppSettings,
  changes: {
    sessions: { deletes: string[]; puts: PracticeSessionRecord[] };
    reviews: { deletes: string[]; puts: ReviewRecord[] };
    staffRecallRuns: { deletes: string[]; puts: StaffRecallRunRecord[] };
    staffGameWrongNoteArchives?: StaffGameWrongNoteArchive[];
  }
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.settings,
      db.practiceSessions,
      db.reviews,
      db.staffRecallRuns,
      db.staffGameWrongNoteArchives,
    ],
    async () => {
      await db.settings.put(settings);
      await db.practiceSessions.bulkDelete(changes.sessions.deletes);
      await db.reviews.bulkDelete(changes.reviews.deletes);
      await db.staffRecallRuns.bulkDelete(changes.staffRecallRuns.deletes);
      await db.practiceSessions.bulkPut(changes.sessions.puts);
      await db.reviews.bulkPut(changes.reviews.puts);
      await db.staffRecallRuns.bulkPut(changes.staffRecallRuns.puts);
      if (changes.staffGameWrongNoteArchives?.length) {
        const existing = await db.staffGameWrongNoteArchives.toArray();
        await db.staffGameWrongNoteArchives.bulkPut(
          mergeStaffGameWrongNoteArchives(existing, changes.staffGameWrongNoteArchives)
        );
      }
    }
  );
}

export async function loadAllData(): Promise<{
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  staffGameWrongNoteArchives: StaffGameWrongNoteArchive[];
}> {
  const settings = await ensureSettings();
  const [sessions, reviews, staffRecallRuns, staffGameWrongNoteArchives] = await Promise.all([
    db.practiceSessions.orderBy("startedAt").toArray(),
    db.reviews.orderBy("startedAt").toArray(),
    db.staffRecallRuns.orderBy("endedAt").toArray(),
    db.staffGameWrongNoteArchives.orderBy("date").toArray(),
  ]);
  return { settings, sessions, reviews, staffRecallRuns, staffGameWrongNoteArchives };
}

export async function archiveStaffGameWrongNoteRun(
  run: StaffGameWrongNoteArchiveRun
): Promise<StaffGameWrongNoteArchive> {
  return withStaffGameArchiveMutationLock(() => writeStaffGameWrongNoteRun(run));
}

async function writeStaffGameWrongNoteRun(
  run: StaffGameWrongNoteArchiveRun
): Promise<StaffGameWrongNoteArchive> {
  const date = localDateKey(run.endedAt);
  return db.transaction("rw", db.staffGameWrongNoteArchives, async () => {
    const current = await db.staffGameWrongNoteArchives.get(date);
    const next = mergeStaffGameWrongNoteArchives(current ? [current] : [], [
      { id: date, date, runs: [run] },
    ])[0]!;
    await db.staffGameWrongNoteArchives.put(next);
    return next;
  });
}

async function writePendingStaffGameWrongNoteRunIfQueued(
  runId: string
): Promise<{ archive: StaffGameWrongNoteArchive; run: StaffGameWrongNoteArchiveRun } | null> {
  return db.transaction("rw", db.staffGameWrongNoteArchives, async () => {
    await db.staffGameWrongNoteArchives.count();
    const run = readPendingStaffGameArchiveRuns().find((pending) => pending.runId === runId);
    if (!run) return null;
    const date = localDateKey(run.endedAt);
    const current = await db.staffGameWrongNoteArchives.get(date);
    const next = mergeStaffGameWrongNoteArchives(current ? [current] : [], [
      { id: date, date, runs: [run] },
    ])[0]!;
    await db.staffGameWrongNoteArchives.put(next);
    return { archive: next, run };
  });
}

async function restorePendingStaffGameArchiveRuns(
  runs: readonly StaffGameWrongNoteArchiveRun[]
): Promise<void> {
  if (runs.length === 0) return;
  try {
    await updatePendingStaffGameArchiveRuns((currentRuns) => {
      const currentRunIds = new Set(currentRuns.map((run) => run.runId));
      return {
        nextRuns: [...currentRuns, ...runs.filter((run) => !currentRunIds.has(run.runId))],
        result: undefined,
      };
    });
  } catch {
    // Preserve the original archive operation error if queue restoration also fails.
  }
}

export async function retryPendingStaffGameWrongNoteArchives(): Promise<
  StaffGameWrongNoteArchive[]
> {
  const savedArchives: StaffGameWrongNoteArchive[] = [];
  const pendingRunIds = readPendingStaffGameArchiveRuns().map((run) => run.runId);
  for (const runId of pendingRunIds) {
    const savedArchive = await withStaffGameArchiveMutationLock(async () => {
      const run = readPendingStaffGameArchiveRuns().find((pending) => pending.runId === runId);
      if (!run) return null;
      try {
        const result = await writePendingStaffGameWrongNoteRunIfQueued(runId);
        if (!result) return null;
        await updatePendingStaffGameArchiveRuns((pendingRuns) => ({
          nextRuns: removePendingStaffGameArchiveRunFromQueue(pendingRuns, result.run),
          result: undefined,
        }));
        return result.archive;
      } catch {
        // Keep failed runs in local storage for the next game-page visit.
        return null;
      }
    });
    if (savedArchive) savedArchives.push(savedArchive);
  }
  return savedArchives;
}

export async function clearStaffGameWrongNoteArchives(): Promise<void> {
  await withStaffGameArchiveMutationLock(async () => {
    let pendingRuns: StaffGameWrongNoteArchiveRun[] = [];
    try {
      await db.transaction("rw", db.staffGameWrongNoteArchives, async () => {
        await db.staffGameWrongNoteArchives.count();
        pendingRuns = readPendingStaffGameArchiveRuns();
        if (pendingRuns.length > 0 && !writePendingStaffGameArchiveRuns([])) {
          throw new Error("Could not clear pending wrong note archives");
        }
        await db.staffGameWrongNoteArchives.clear();
      });
    } catch (error) {
      await restorePendingStaffGameArchiveRuns(pendingRuns);
      throw error;
    }
  });
}

export async function deleteStaffGameWrongNoteArchiveRuns(
  runIds: readonly string[]
): Promise<StaffGameWrongNoteArchive[]> {
  const idsToDelete = new Set(runIds);
  if (idsToDelete.size === 0) return db.staffGameWrongNoteArchives.orderBy("date").toArray();

  return withStaffGameArchiveMutationLock(async () => {
    let pendingRunsToDelete: StaffGameWrongNoteArchiveRun[] = [];
    try {
      return await db.transaction("rw", db.staffGameWrongNoteArchives, async () => {
        await db.staffGameWrongNoteArchives.count();
        const pendingRuns = readPendingStaffGameArchiveRuns();
        pendingRunsToDelete = pendingRuns.filter((run) => idsToDelete.has(run.runId));
        if (
          pendingRunsToDelete.length > 0 &&
          !writePendingStaffGameArchiveRuns(
            pendingRuns.filter((run) => !idsToDelete.has(run.runId))
          )
        ) {
          throw new Error("Could not remove pending wrong note archives");
        }
        const archives = await db.staffGameWrongNoteArchives.toArray();
        for (const archive of archives) {
          const runs = archive.runs.filter((run) => !idsToDelete.has(run.runId));
          if (runs.length === archive.runs.length) continue;
          if (runs.length === 0) {
            await db.staffGameWrongNoteArchives.delete(archive.id);
          } else {
            await db.staffGameWrongNoteArchives.put({ ...archive, runs });
          }
        }
        return db.staffGameWrongNoteArchives.orderBy("date").toArray();
      });
    } catch (error) {
      await restorePendingStaffGameArchiveRuns(pendingRunsToDelete);
      throw error;
    }
  });
}

export async function loadPracticeHistory(): Promise<{
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
}> {
  const [sessions, reviews] = await Promise.all([
    db.practiceSessions.orderBy("startedAt").toArray(),
    db.reviews.orderBy("startedAt").toArray(),
  ]);
  return { sessions, reviews };
}

export async function loadStaffRecallHistory(): Promise<StaffRecallRunRecord[]> {
  return db.staffRecallRuns.orderBy("endedAt").toArray();
}

export async function recoverAbandonedSessions(): Promise<void> {
  const openSessions = await db.practiceSessions.filter((session) => !session.endedAt).toArray();
  if (openSessions.length === 0) {
    return;
  }
  const endedAt = new Date().toISOString();
  await db.practiceSessions.bulkPut(
    openSessions.map((session) => ({
      ...session,
      endedAt,
      endReason: "abandoned" as const,
    }))
  );
}

export async function listVocalAudioMaterials(): Promise<VocalAudioMaterial[]> {
  return db.vocalAudioMaterials.orderBy("createdAt").reverse().toArray();
}

export async function getVocalAudioMaterial(id: string): Promise<VocalAudioMaterial | undefined> {
  return db.vocalAudioMaterials.get(id);
}

export async function saveVocalAudioMaterial(material: VocalAudioMaterial): Promise<void> {
  await db.vocalAudioMaterials.put(material);
}

export async function deleteVocalAudioMaterial(id: string): Promise<void> {
  await db.vocalAudioMaterials.delete(id);
}

export async function replaceVocalAudioMaterials(materials: VocalAudioMaterial[]): Promise<void> {
  await db.transaction("rw", db.vocalAudioMaterials, async () => {
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.bulkPut(materials);
  });
}
