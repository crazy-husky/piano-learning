import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  type BackupPreflightResult,
  chooseBackupDirectory,
  refreshBackupConflictDetails,
  resolveBackupConflict,
  supportsFileBackups,
  syncBackupBeforeActivity,
  type BackupConflictResolution,
} from "../data/backup";
import {
  getBackupState,
  loadAllData,
} from "../data/db";
import { shouldRunBackupEntryPreflight } from "../domain/backupSync";
import { backupText, formatBackupConflictDetail } from "../domain/backupText";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord, StaffRecallRunRecord } from "../domain/types";

const BACKUP_REMINDER_SUPPRESSED_DATE_KEY = "anki-note.backupReminderSuppressedDate";
const BACKUP_REMINDER_SUPPRESSED_WEEK_KEY = "anki-note.backupReminderSuppressedWeek";

type View = "home" | "practice" | "study" | "stats" | "settings" | "vocal";
type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
type BackupReminderAction = "choose-directory";

export interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  backupState: BackupState;
  practiceHistoryLoaded: boolean;
  staffRecallHistoryLoaded: boolean;
}

export type BackupReminderState =
  | { kind: "none"; showReminder: false }
  | { kind: "needs-directory"; showReminder: boolean }
  | { kind: "data-conflict"; showReminder: true };

export interface BackupReminderMessage {
  dangerous?: boolean;
  detail: string;
  title: string;
}

interface BackupCheckResult {
  latestData?: AppData;
  proceed: boolean;
  result: BackupPreflightResult;
}

interface UseBackupReminderOptions {
  data: AppData | null;
  setData: Dispatch<SetStateAction<AppData | null>>;
  refresh: () => Promise<void>;
  refreshBackupState: () => Promise<void>;
  hasBackupDirectory: boolean;
  practiceRunning: boolean;
  view: View;
}

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function weekStartKey(): string {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${monday.getFullYear()}-${month}-${day}`;
}

function isBackupReminderSuppressed(): boolean {
  try {
    const suppressedToday = localStorage.getItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY) === todayKey();
    const suppressedThisWeek = localStorage.getItem(BACKUP_REMINDER_SUPPRESSED_WEEK_KEY) === weekStartKey();
    return suppressedToday || suppressedThisWeek;
  } catch {
    return false;
  }
}

function backupSyncRequired(backupState: BackupState): boolean {
  const stored = backupState as StoredBackupState;
  return Boolean(backupState.dataConflictBeforeBackup ?? backupState.syncRequiredBeforeBackup ?? stored.restoreRequiredBeforeBackup);
}

function backupConflictDetailsMissing(backupState: BackupState): boolean {
  return (
    !backupState.conflictRevision ||
    backupState.conflictBrowserReviewCount === undefined ||
    backupState.conflictBackupReviewCount === undefined ||
    backupState.conflictBrowserStaffRecallRunCount === undefined ||
    backupState.conflictBackupStaffRecallRunCount === undefined ||
    backupState.conflictBrowserVocalAudioCounts === undefined ||
    backupState.conflictBackupVocalAudioCounts === undefined
  );
}

function isUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function getBackupReminderState(data: AppData): BackupReminderState {
  if (!supportsFileBackups()) {
    return { kind: "none", showReminder: false };
  }
  if (backupSyncRequired(data.backupState)) {
    return { kind: "data-conflict", showReminder: true };
  }
  if (!data.backupState.directoryHandle) {
    return { kind: "needs-directory", showReminder: !isBackupReminderSuppressed() };
  }
  return { kind: "none", showReminder: false };
}

export async function loadFreshAppData(): Promise<AppData> {
  const [{ settings, sessions, reviews, staffRecallRuns }, backupState] = await Promise.all([loadAllData(), getBackupState()]);
  return {
    settings,
    sessions,
    reviews,
    staffRecallRuns,
    backupState,
    practiceHistoryLoaded: true,
    staffRecallHistoryLoaded: true,
  };
}

export function useBackupReminder({
  data,
  setData,
  refresh,
  refreshBackupState,
  hasBackupDirectory,
  practiceRunning,
  view,
}: UseBackupReminderOptions) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<BackupReminderMessage | null>(null);
  const [visible, setVisible] = useState(false);
  const checkInFlightRef = useRef<Promise<BackupCheckResult> | null>(null);

  const showMessage = useCallback((title: string, detail: string, autoHide: boolean): void => {
    if (autoHide) {
      setMessage(null);
      setVisible(false);
      toast.success(title, { description: detail, duration: 2_500 });
      return;
    }
    toast.error(title, { description: detail });
    setMessage({ dangerous: true, detail, title });
    setVisible(true);
  }, []);

  const suppressToday = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY, todayKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setVisible(false);
  }, []);

  const suppressThisWeek = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_WEEK_KEY, weekStartKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setVisible(false);
  }, []);

  const showAfterActivity = useCallback((): void => {
    if (data && getBackupReminderState(data).showReminder) {
      setVisible(true);
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;
    if (!message) {
      setVisible(getBackupReminderState(data).showReminder);
    }
  }, [
    message,
    data !== null,
    hasBackupDirectory,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    data?.sessions.length,
    data?.reviews.length,
  ]);

  useEffect(() => {
    if (
      !data ||
      !hasBackupDirectory ||
      !backupSyncRequired(data.backupState) ||
      !backupConflictDetailsMissing(data.backupState)
    ) {
      return;
    }
    let cancelled = false;
    void refreshBackupConflictDetails()
      .then((updated) => {
        if (updated && !cancelled) {
          void refreshBackupState();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    data !== null,
    hasBackupDirectory,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    data?.backupState.conflictBrowserReviewCount,
    data?.backupState.conflictBackupReviewCount,
    data?.backupState.conflictBrowserRecordCount,
    data?.backupState.conflictBackupRecordCount,
    data?.backupState.conflictBrowserStaffRecallRunCount,
    data?.backupState.conflictBackupStaffRecallRunCount,
    data?.backupState.conflictBrowserVocalAudioCounts,
    data?.backupState.conflictBackupVocalAudioCounts,
    refreshBackupState,
  ]);

  const runBackupCheck = useCallback(
    async ({ requestPermission }: { requestPermission: boolean }): Promise<BackupCheckResult> => {
      while (checkInFlightRef.current) {
        const inFlightResult = await checkInFlightRef.current;
        if (!requestPermission || inFlightResult.result !== "skipped") {
          return inFlightResult;
        }
      }

      const checkPromise = (async (): Promise<BackupCheckResult> => {
        try {
          const outcome = await syncBackupBeforeActivity({ requestPermission });
          const { result } = outcome;
          if (result === "needs-directory") {
            setVisible(true);
            return { proceed: true, result };
          }
          if (result === "data-conflict") {
            await refreshBackupState();
            setVisible(true);
            return { proceed: false, result };
          }
          if (result === "synced-up") {
            const latestData = outcome.importedData ?? (await loadFreshAppData());
            setData({
              ...latestData,
              practiceHistoryLoaded: true,
              staffRecallHistoryLoaded: true,
            });
            showMessage(backupText.titles.importSuccess, backupText.messages.backupDirectoryAutoImported, true);
            return {
              latestData: {
                ...latestData,
                practiceHistoryLoaded: true,
                staffRecallHistoryLoaded: true,
              },
              proceed: true,
              result,
            };
          }
          if (result === "synced-down") {
            await refreshBackupState();
            return { proceed: true, result };
          }
          if (result === "ready") {
            if (outcome.backupStateChanged) {
              await refreshBackupState();
            }
            return { proceed: true, result };
          }
          return { proceed: true, result };
        } catch (error) {
          if (!requestPermission || isUserAbort(error)) {
            return { proceed: true, result: "skipped" };
          }
          showMessage(
            error instanceof Error ? error.message : String(error),
            backupText.messages.backupPermissionOrDirectoryHint,
            false,
          );
          return { proceed: false, result: "skipped" };
        }
      })();

      checkInFlightRef.current = checkPromise;
      try {
        return await checkPromise;
      } finally {
        if (checkInFlightRef.current === checkPromise) {
          checkInFlightRef.current = null;
        }
      }
    },
    [refreshBackupState, setData, showMessage],
  );

  const preflightBeforePracticeStart = useCallback(async () => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    if (!checkResult.proceed) return { proceed: false };
    if (checkResult.result !== "synced-up") return { proceed: true };
    const latestData = checkResult.latestData ?? (await loadFreshAppData());
    setData(latestData);
    return { proceed: true, reviews: latestData.reviews, settings: latestData.settings };
  }, [runBackupCheck, setData]);

  const preflightBeforeStaffRecallStart = useCallback(async () => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    return { proceed: checkResult.proceed };
  }, [runBackupCheck]);

  const preflightBeforeVocalLibraryChange = useCallback(async () => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    if (!checkResult.proceed) return "blocked" as const;
    return checkResult.result === "synced-up" ? "backup-updated" as const : "proceed" as const;
  }, [runBackupCheck]);

  useEffect(() => {
    const backupEntryView = view === "practice" || view === "vocal" ? view : null;
    if (
      !data ||
      !shouldRunBackupEntryPreflight(backupEntryView, practiceRunning) ||
      !hasBackupDirectory
    ) {
      return;
    }
    void runBackupCheck({ requestPermission: false });
  }, [
    data !== null,
    hasBackupDirectory,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    practiceRunning,
    runBackupCheck,
    view,
  ]);

  const runReminderAction = useCallback(async (action: BackupReminderAction): Promise<void> => {
    if (!data || busy) {
      return;
    }

    const reminderState = getBackupReminderState(data);
    setBusy(true);
    setMessage(null);
    try {
      if (action === "choose-directory") {
        const result = await chooseBackupDirectory();
        const latestBackupState = await getBackupState();
        await refresh();
        if (result === "diverged") {
          showMessage(backupText.titles.dataConflict, formatBackupConflictDetail(latestBackupState), false);
          return;
        }
        if (result === "synced-up") {
          showMessage(backupText.titles.importSuccess, backupText.messages.importSuccessDetail, true);
        }
        return;
      }
    } catch (error) {
      if (isUserAbort(error)) {
        setMessage(null);
        setVisible(reminderState.showReminder);
        return;
      }
      showMessage(
        error instanceof Error ? error.message : String(error),
        backupText.messages.backupPermissionOrDirectoryHint,
        false,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, data, refresh, showMessage]);

  const resolveReminderConflict = useCallback(async (resolution: BackupConflictResolution): Promise<void> => {
    if (!data || busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await resolveBackupConflict(resolution);
      await refresh();
      showMessage(backupText.titles.conflictResolved, backupText.messages.conflictResolvedDetail, true);
    } catch (error) {
      await refresh();
      showMessage(
        error instanceof Error ? error.message : String(error),
        backupText.messages.backupPermissionOrDirectoryHint,
        false,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, data, refresh, showMessage]);

  return {
    busy,
    message,
    visible,
    setVisible,
    showAfterActivity,
    suppressToday,
    suppressThisWeek,
    runReminderAction,
    resolveReminderConflict,
    preflightBeforePracticeStart,
    preflightBeforeStaffRecallStart,
    preflightBeforeVocalLibraryChange,
  };
}
