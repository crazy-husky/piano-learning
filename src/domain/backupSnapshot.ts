import { createUuid } from "./id";
import { localDateKey } from "./stats";
import type {
  AppSettings,
  BackupDayFile,
  BackupSnapshot,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
  StaffGameWrongNoteArchive,
  StaffGameWrongNoteArchiveRun,
  AnswerEvent,
} from "./types";

function latestReview(reviews: ReviewRecord[]): ReviewRecord | undefined {
  return [...reviews].sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

function latestStaffRecallRun(runs: StaffRecallRunRecord[]): StaffRecallRunRecord | undefined {
  return [...runs].sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

function latestWrongNoteArchiveRun(
  archives: StaffGameWrongNoteArchive[]
): StaffGameWrongNoteArchiveRun | undefined {
  return archives
    .flatMap((archive) => archive.runs)
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function appendByDate<T>(recordsByDate: Map<string, T[]>, date: string, record: T): void {
  const records = recordsByDate.get(date);
  if (records) {
    records.push(record);
    return;
  }
  recordsByDate.set(date, [record]);
}

export function getBackupDataModifiedAt(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
  staffRecallRuns: StaffRecallRunRecord[] = [],
  wrongNoteArchives: StaffGameWrongNoteArchive[] = [],
  answerEvents: AnswerEvent[] = []
): string {
  return (
    latestTimestamp([
      settings.firstReviewAt,
      settings.createdAt,
      ...sessions.flatMap((session) => [session.endedAt, session.startedAt]),
      ...reviews.flatMap((review) => [review.endedAt, review.answeredAt, review.startedAt]),
      ...staffRecallRuns.flatMap((run) => [run.endedAt, run.startedAt]),
      ...wrongNoteArchives.flatMap((archive) =>
        archive.runs.flatMap((run) => [run.endedAt, run.startedAt])
      ),
      ...answerEvents.map((event) => event.occurredAt),
    ]) ?? settings.createdAt
  );
}

export function buildBackupSnapshot(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
  backupAt = new Date().toISOString(),
  staffRecallRuns: StaffRecallRunRecord[] = [],
  wrongNoteArchives: StaffGameWrongNoteArchive[] = [],
  answerEvents: AnswerEvent[] = []
): BackupSnapshot {
  const days: Record<string, BackupDayFile> = {};
  const sessionsByDate = new Map<string, PracticeSessionRecord[]>();
  const reviewsByDate = new Map<string, ReviewRecord[]>();
  const staffRecallRunsByDate = new Map<string, StaffRecallRunRecord[]>();
  const wrongNoteArchivesByDate = new Map<string, StaffGameWrongNoteArchive[]>();
  const answerEventsByDate = new Map<string, AnswerEvent[]>();

  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    appendByDate(sessionsByDate, date, session);
  }

  if (answerEvents.length === 0) {
    for (const review of reviews) {
      const date = localDateKey(review.startedAt);
      appendByDate(reviewsByDate, date, review);
    }
  }

  for (const run of staffRecallRuns) {
    const date = localDateKey(run.startedAt);
    appendByDate(staffRecallRunsByDate, date, run);
  }

  for (const archive of wrongNoteArchives) {
    appendByDate(wrongNoteArchivesByDate, archive.date || archive.id, archive);
  }

  for (const event of answerEvents) {
    appendByDate(answerEventsByDate, localDateKey(event.occurredAt), event);
  }

  const dates = new Set([
    ...sessionsByDate.keys(),
    ...reviewsByDate.keys(),
    ...staffRecallRunsByDate.keys(),
    ...wrongNoteArchivesByDate.keys(),
    ...answerEventsByDate.keys(),
  ]);
  for (const date of dates) {
    days[date] = {
      schemaVersion: 1,
      date,
      sessions: sessionsByDate.get(date) ?? [],
      reviews: reviewsByDate.get(date) ?? [],
      staffRecallRuns: staffRecallRunsByDate.get(date) ?? [],
      staffGameWrongNoteArchives: wrongNoteArchivesByDate.get(date) ?? [],
      answerEvents: answerEventsByDate.get(date) ?? [],
    };
  }

  return {
    manifest: {
      schemaVersion: 1,
      snapshotId: createUuid(),
      dataSetId: settings.dataSetId,
      createdAt: settings.createdAt,
      firstReviewAt: settings.firstReviewAt,
      settings,
      dataModifiedAt: getBackupDataModifiedAt(
        settings,
        sessions,
        reviews,
        staffRecallRuns,
        wrongNoteArchives,
        answerEvents
      ),
      lastBackupAt: backupAt,
      lastReviewId: latestReview(reviews)?.id,
      lastStaffRecallRunId: latestStaffRecallRun(staffRecallRuns)?.id,
      lastStaffGameWrongNoteArchiveRunId: latestWrongNoteArchiveRun(wrongNoteArchives)?.runId,
      lastAnswerEventId: answerEvents.at(-1)?.id,
      dates: [...dates].sort((a, b) => a.localeCompare(b)),
    },
    days,
  };
}

export function getBackupManifestVersion(manifest: BackupSnapshot["manifest"]): string {
  if (manifest.snapshotId) {
    return `snapshot:${manifest.snapshotId}`;
  }
  if (manifest.lastStaffGameWrongNoteArchiveRunId !== undefined) {
    return `legacy:${manifest.dataSetId}:${manifest.lastBackupAt}:${manifest.lastReviewId ?? ""}:${manifest.lastStaffRecallRunId ?? ""}:${manifest.lastStaffGameWrongNoteArchiveRunId}:${manifest.dates.join(",")}`;
  }
  if (manifest.lastStaffRecallRunId === undefined) {
    return `legacy:${manifest.dataSetId}:${manifest.lastBackupAt}:${manifest.lastReviewId ?? ""}:${manifest.dates.join(",")}`;
  }
  return `legacy:${manifest.dataSetId}:${manifest.lastBackupAt}:${manifest.lastReviewId ?? ""}:${manifest.lastStaffRecallRunId ?? ""}:${manifest.dates.join(",")}`;
}
