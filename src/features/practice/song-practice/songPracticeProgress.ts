import type { SongPracticeHandMode, SongPracticeKeyVersion } from "./songPracticeMaterials";

const STORAGE_KEY = "piano-learning.song-practice-progress.v1";

export interface SongPracticeModeProgress {
  attempts: number;
  correctTargets: number;
  incorrectAttempts: number;
}

export interface SongPracticeProgress {
  completedSessions: number;
  activeMs: number;
  lastCompletedAt?: string;
  lastPlayedAt?: string;
  modes: Record<SongPracticeHandMode, SongPracticeModeProgress>;
  sessionsStarted: number;
}

export interface SongPracticeProgressEntry {
  key: string;
  progress: SongPracticeProgress;
}

interface SongPracticeProgressStore {
  version: 1;
  songs: Record<string, SongPracticeProgress>;
}

const EMPTY_MODE_PROGRESS = (): SongPracticeModeProgress => ({
  attempts: 0,
  correctTargets: 0,
  incorrectAttempts: 0,
});

function emptyProgress(): SongPracticeProgress {
  return {
    completedSessions: 0,
    activeMs: 0,
    modes: {
      left: EMPTY_MODE_PROGRESS(),
      right: EMPTY_MODE_PROGRESS(),
      both: EMPTY_MODE_PROGRESS(),
    },
    sessionsStarted: 0,
  };
}

function progressKey(songId: string, keyVersion: SongPracticeKeyVersion): string {
  return `${songId}:${keyVersion}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isModeProgress(value: unknown): value is SongPracticeModeProgress {
  return (
    isRecord(value) &&
    isCounter(value.attempts) &&
    isCounter(value.correctTargets) &&
    isCounter(value.incorrectAttempts)
  );
}

function isSongProgress(value: unknown): value is SongPracticeProgress {
  if (!isRecord(value) || !isRecord(value.modes)) return false;
  return (
    isCounter(value.completedSessions) &&
    isCounter(value.activeMs) &&
    isCounter(value.sessionsStarted) &&
    isModeProgress(value.modes.left) &&
    isModeProgress(value.modes.right) &&
    isModeProgress(value.modes.both) &&
    (value.lastCompletedAt === undefined || typeof value.lastCompletedAt === "string") &&
    (value.lastPlayedAt === undefined || typeof value.lastPlayedAt === "string")
  );
}

function readStore(): SongPracticeProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, songs: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.songs)) {
      return { version: 1, songs: {} };
    }
    return {
      version: 1,
      songs: Object.fromEntries(
        Object.entries(parsed.songs).filter((entry): entry is [string, SongPracticeProgress] =>
          isSongProgress(entry[1])
        )
      ),
    };
  } catch {
    return { version: 1, songs: {} };
  }
}

export function getSongPracticeProgressEntries(): SongPracticeProgressEntry[] {
  return Object.entries(readStore().songs).map(([key, progress]) => ({ key, progress }));
}

function updateProgress(
  songId: string,
  keyVersion: SongPracticeKeyVersion,
  update: (progress: SongPracticeProgress) => void
): void {
  try {
    const store = readStore();
    const key = progressKey(songId, keyVersion);
    const progress = store.songs[key] ?? emptyProgress();
    update(progress);
    store.songs[key] = progress;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Song progress is supplemental; storage availability must not block practice.
  }
}

export function recordSongPracticeSessionStarted(
  songId: string,
  keyVersion: SongPracticeKeyVersion
): void {
  updateProgress(songId, keyVersion, (progress) => {
    progress.sessionsStarted += 1;
    progress.lastPlayedAt = new Date().toISOString();
  });
}

export function recordSongPracticeAttempt(
  songId: string,
  keyVersion: SongPracticeKeyVersion,
  handMode: SongPracticeHandMode,
  correct: boolean
): void {
  updateProgress(songId, keyVersion, (progress) => {
    const modeProgress = progress.modes[handMode];
    modeProgress.attempts += 1;
    if (correct) modeProgress.correctTargets += 1;
    else modeProgress.incorrectAttempts += 1;
  });
}

export function recordSongPracticeSessionCompleted(
  songId: string,
  keyVersion: SongPracticeKeyVersion,
  activeMs: number
): void {
  updateProgress(songId, keyVersion, (progress) => {
    progress.completedSessions += 1;
    progress.activeMs += Math.max(0, Math.round(activeMs));
    progress.lastCompletedAt = new Date().toISOString();
  });
}
