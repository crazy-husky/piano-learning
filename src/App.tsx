import { ArrowLeft, AudioLines, BarChart3, BellOff, BookOpen, Dumbbell, FolderOpen, House, Settings, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { preloadPianoSamples, setPianoVolume } from "./audio/piano";
import {
  type BackupPreflightResult,
  chooseBackupDirectory,
  refreshBackupConflictDetails,
  resolveBackupConflict,
  supportsFileBackups,
  syncBackupBeforeActivity,
  type BackupConflictResolution,
} from "./data/backup";
import { db, getBackupState, loadAllData, recoverAbandonedSessions, restoreDefaultConfiguration } from "./data/db";
import { IndexedDbMaintenancePanel } from "./debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "./debug/indexedDbMaintenance";
import { shouldRunBackupEntryPreflight } from "./domain/backupSync";
import { backupText, formatBackupConflictDetail } from "./domain/backupText";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord, StaffRecallRunRecord } from "./domain/types";
import { MidiLatencyDiagnosticsPanel } from "./diagnostics/MidiLatencyDiagnosticsPanel";
import { MIDI_LATENCY_DIAGNOSTICS_ENABLED } from "./diagnostics/midiLatencyDiagnostics";
import { BackupConflictResolver } from "./components/BackupConflictResolver";
import { HomeView } from "./components/HomeView";
import {
  PracticeView,
  type PracticeNavigationExitRequest,
  type PracticeNavigationExitTarget,
  type PracticeStartPreflightResult,
} from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/stats/StatsView";
import { StudyView, type StaffRecallStartPreflightResult } from "./components/StudyView";
import {
  VocalPitchView,
  type VocalLibraryMutationPreflightResult,
} from "./components/vocal-pitch/VocalPitchView";
import { useBlurButtonAfterPointerClick } from "./components/useBlurButtonAfterPointerClick";
import { useLocalStorageState } from "./components/useLocalStorageState";
import {
  clearLocalPreferenceStorage,
  LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT,
  LOCAL_STORAGE_PREFERENCES_RESET_EVENT,
} from "./storage/localPreferenceEvents";
import {
  DEFAULT_PRACTICE_PAGE_PREFERENCES,
  parsePracticePagePreferences,
  PRACTICE_PAGE_PREFERENCES_KEY,
} from "./components/practicePagePreferences";
import {
  DEFAULT_PAGE_APPEARANCE_PREFERENCES,
  PAGE_APPEARANCE_PREFERENCES_KEY,
  PageAppearanceProvider,
  parsePageAppearancePreferences,
  resolveNightMode,
} from "./components/pageAppearance";
import { useMidiInput } from "./midi/useMidiInput";
import { ENHANCED_PITCH_MODEL_CACHE } from "./vocal-pitch/enhancedPitchModels";
import { useAppUpdateNotice } from "./useAppUpdateNotice";
import { appRouteFromHash, appRoutePathForPage, appRouteUrl, isStaffGameRoutePath, isStaffGameSongRoutePath, type AppRoute, type AppRoutePath } from "./routing/appRoutes";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  createDefaultPracticeMicrophonePreferences,
  isTouchPracticeDevice,
  parsePracticeMicrophonePreferences,
  PRACTICE_MICROPHONE_PREFERENCES_KEY,
} from "./vocal-pitch/practiceMicrophonePreferences";

type View = PracticeNavigationExitTarget;
type SettingsSaveOptions = { feedback?: boolean };

const BACKUP_REMINDER_SUPPRESSED_DATE_KEY = "anki-note.backupReminderSuppressedDate";
const BACKUP_REMINDER_SUPPRESSED_WEEK_KEY = "anki-note.backupReminderSuppressedWeek";
const INITIAL_PRACTICE_MICROPHONE_PREFERENCES = (() => {
  if (typeof navigator === "undefined") return DEFAULT_PRACTICE_MICROPHONE_PREFERENCES;
  const sensitivityLevel = isTouchPracticeDevice(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  ) ? 1 : 3;
  return createDefaultPracticeMicrophonePreferences(sensitivityLevel);
})();

const LOCAL_PREFERENCE_FEEDBACK_KEYS = new Set([
  "anki-note.pageAppearancePreferences",
  "anki-note.practiceMicrophonePreferences",
  "anki-note.practicePagePreferences",
  "anki-note.practiceSetupUiPreferences",
  "anki-note.sessionProgressUiPreferences",
  "anki-note.staffPageUiPreferences",
  "anki-note.statsUiPreferences",
  "anki-note.studyUiPreferences",
  "anki-note.staffRecallUiPreferences",
  "anki-note.vocalPitch.microphoneId",
  "anki-note.vocalPitch.allowBackgroundRecording",
  "anki-note.vocalPitch.playbackVolume",
  "anki-note.vocalPitch.sidebarOpen",
  "anki-note.vocalPitch.parametersOpen",
  "anki-note.vocalPitch.materialsOpen",
  "anki-note.midiInputId",
]);

interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  backupState: BackupState;
}

interface BackupCheckResult {
  latestData?: AppData;
  proceed: boolean;
  result: BackupPreflightResult;
}

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
type BackupReminderState =
  | { kind: "none"; showReminder: false }
  | { kind: "needs-directory"; showReminder: boolean }
  | { kind: "data-conflict"; showReminder: true };
type BackupReminderAction = "choose-directory";

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

function getBackupReminderState(data: AppData): BackupReminderState {
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

async function loadFreshAppData(): Promise<AppData> {
  const [{ settings, sessions, reviews, staffRecallRuns }, backupState] = await Promise.all([loadAllData(), getBackupState()]);
  return { settings, sessions, reviews, staffRecallRuns, backupState };
}

export function App(): JSX.Element {
  useBlurButtonAfterPointerClick();
  useAppUpdateNotice();
  const midi = useMidiInput();

  const [route, setRoute] = useState<AppRoute>(() => appRouteFromHash(window.location.hash));
  const routeRef = useRef(route);
  routeRef.current = route;
  const staffGameSelectionReturnPathRef = useRef<AppRoutePath>("/");
  const staffGameSelectionRoutePushedRef = useRef(false);
  const staffGamePlayRoutePushedRef = useRef(false);
  const [pageAppearancePreferences, setPageAppearancePreferences] = useLocalStorageState(
    PAGE_APPEARANCE_PREFERENCES_KEY,
    DEFAULT_PAGE_APPEARANCE_PREFERENCES,
    { parse: parsePageAppearancePreferences },
  );
  const [practiceMicrophonePreferences, setPracticeMicrophonePreferences] = useLocalStorageState(
    PRACTICE_MICROPHONE_PREFERENCES_KEY,
    INITIAL_PRACTICE_MICROPHONE_PREFERENCES,
    { parse: parsePracticeMicrophonePreferences },
  );
  const [practicePagePreferences, setPracticePagePreferences] = useLocalStorageState(
    PRACTICE_PAGE_PREFERENCES_KEY,
    DEFAULT_PRACTICE_PAGE_PREFERENCES,
    { parse: parsePracticePagePreferences },
  );
  const [appearanceTimestamp, setAppearanceTimestamp] = useState(() => Date.now());
  const isNightMode = resolveNightMode(pageAppearancePreferences, new Date(appearanceTimestamp));
  const [data, setData] = useState<AppData | null>(null);
  const currentSettingsRef = useRef<AppSettings | undefined>(undefined);
  currentSettingsRef.current = data?.settings;
  const settingsMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const configurationRestoreInProgressRef = useRef(false);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const practiceRunningRef = useRef(false);
  practiceRunningRef.current = practiceRunning;
  const pendingRoutePathRef = useRef<AppRoutePath | null>(null);
  const view = route.page;
  const [backupReminderBusy, setBackupReminderBusy] = useState(false);
  const [backupReminderMessage, setBackupReminderMessage] = useState<{ dangerous?: boolean; detail: string; title: string } | null>(null);
  const [backupReminderVisible, setBackupReminderVisible] = useState(false);
  const [practiceExitRequest, setPracticeExitRequest] = useState<PracticeNavigationExitRequest | null>(null);
  const [vocalExitRequest, setVocalExitRequest] = useState<PracticeNavigationExitRequest | null>(null);
  const practiceExitRequestIdRef = useRef(0);
  const vocalExitRequestIdRef = useRef(0);
  const backupCheckInFlightRef = useRef<Promise<BackupCheckResult> | null>(null);

  const showConfigurationFeedback = useCallback((
    detail: string,
    options: { requiresRefresh?: boolean; title?: string; error?: boolean } = {},
  ): void => {
    const requiresRefresh = options.requiresRefresh ?? false;
    const title = options.title ?? (requiresRefresh ? "需要刷新页面" : "设置已生效");
    if (requiresRefresh) {
      toast.warning(title, {
        description: detail,
        duration: 30_000,
        action: { label: "刷新页面", onClick: () => window.location.reload() },
      });
    } else if (options.error) {
      toast.error(title, { description: detail });
    } else {
      toast.success("设置已保存并生效");
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setData(await loadFreshAppData());
  }, []);

  const saveSettings = useCallback(async (
    settings: AppSettings,
    options: SettingsSaveOptions = {},
  ): Promise<void> => {
    if (configurationRestoreInProgressRef.current) return;
    const previousSettings = currentSettingsRef.current;
    const changedKeys = previousSettings
      ? Object.keys(settings).filter((key) => !Object.is(
          (settings as unknown as Record<string, unknown>)[key],
          (previousSettings as unknown as Record<string, unknown>)[key],
        ))
      : [];
    if (changedKeys.length === 0) return;
    currentSettingsRef.current = settings;
    setData((current) => (current ? { ...current, settings } : current));
    const writePromise = settingsMutationQueueRef.current.then(() => db.settings.put(settings));
    settingsMutationQueueRef.current = writePromise.then(() => undefined, () => undefined);
    await writePromise;
    if (options.feedback === false) return;
    showConfigurationFeedback("设置已保存并生效");
  }, [showConfigurationFeedback]);

  const restoreAllConfiguration = useCallback(async (): Promise<void> => {
    if (!data || configurationRestoreInProgressRef.current) return;
    configurationRestoreInProgressRef.current = true;
    const restorePromise = settingsMutationQueueRef.current.then(async () => {
      const settings = await restoreDefaultConfiguration(currentSettingsRef.current ?? data.settings);
      let storageResult: ReturnType<typeof clearLocalPreferenceStorage>;
      try {
        storageResult = clearLocalPreferenceStorage(window.localStorage);
      } catch {
        storageResult = { clearedKeys: [], failedKeys: ["<localStorage access>"] };
      }
      window.dispatchEvent(new Event(LOCAL_STORAGE_PREFERENCES_RESET_EVENT));
      currentSettingsRef.current = settings;
      setData((current) => current
        ? { ...current, settings, backupState: { id: "default", schemaVersion: 1 } }
        : current);
      if (storageResult.failedKeys.length > 0) {
        showConfigurationFeedback(
          `默认配置已恢复，页面偏好已同步。未能清理：${storageResult.failedKeys.join("、")}；刷新后这些项目可能重新加载。`,
          { title: "本地偏好部分未清理", error: true },
        );
      } else {
        showConfigurationFeedback(
          "默认配置已恢复，学习数据和备份文件均已保留。刷新页面以重新初始化 MIDI 设备。",
          { requiresRefresh: true },
        );
      }
    });
    settingsMutationQueueRef.current = restorePromise.then(() => undefined, () => undefined);
    try {
      await restorePromise;
    } catch (error) {
      showConfigurationFeedback(
        `恢复配置失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "配置未能完整恢复", error: true },
      );
    } finally {
      configurationRestoreInProgressRef.current = false;
    }
  }, [data, showConfigurationFeedback]);

  const refreshBackupState = useCallback(async (): Promise<void> => {
    const backupState = await getBackupState();
    setData((current) => (current ? { ...current, backupState } : current));
  }, []);
  const hasBackupDirectory = Boolean(data?.backupState.directoryHandle);

  const navigateToRoute = useCallback((path: AppRoutePath, options: { query?: Record<string, string>; replace?: boolean } = {}): void => {
    const queryString = options.query ? new URLSearchParams(options.query).toString() : "";
    const nextRoute = appRouteFromHash(`#${path}${queryString ? `?${queryString}` : ""}`);
    const currentRoute = routeRef.current;
    if (path === "/practice/game/songs" && !isStaffGameSongRoutePath(currentRoute.path)) {
      staffGameSelectionReturnPathRef.current = currentRoute.path;
      staffGameSelectionRoutePushedRef.current = !options.replace;
    }
    if (currentRoute.path === nextRoute.path && currentRoute.songId === nextRoute.songId) return;
    const url = appRouteUrl(nextRoute.path, options.query);
    if (options.replace) {
      window.history.replaceState(window.history.state, "", url);
    } else {
      window.history.pushState(window.history.state, "", url);
    }
    routeRef.current = nextRoute;
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const normalizedRoute = appRouteFromHash(window.location.hash);
    const normalizedHash = `${normalizedRoute.path}${normalizedRoute.songId ? `?songId=${encodeURIComponent(normalizedRoute.songId)}` : ""}`;
    if (!window.location.hash || normalizedHash !== window.location.hash.slice(1)) {
      window.history.replaceState(window.history.state, "", appRouteUrl(normalizedRoute.path, normalizedRoute.songId ? { songId: normalizedRoute.songId } : undefined));
    }
    const synchronizeRoute = (): void => {
      const incomingRoute = appRouteFromHash(window.location.hash);
      const currentRoute = routeRef.current;
      if (incomingRoute.path === currentRoute.path && incomingRoute.songId === currentRoute.songId) return;
      if (!isStaffGameSongRoutePath(currentRoute.path) && incomingRoute.path === "/practice/game/songs") {
        staffGameSelectionReturnPathRef.current = currentRoute.path;
        staffGameSelectionRoutePushedRef.current = true;
      }
      if (currentRoute.path === "/practice/game/songs" && incomingRoute.path === "/practice/game/songs/play") {
        staffGamePlayRoutePushedRef.current = staffGameSelectionRoutePushedRef.current;
      }
      if (currentRoute.path === "/practice/game/songs/play" && incomingRoute.path === "/practice/game/songs") {
        staffGamePlayRoutePushedRef.current = false;
      }
      if (isStaffGameSongRoutePath(currentRoute.path) && !isStaffGameSongRoutePath(incomingRoute.path)) {
        staffGameSelectionRoutePushedRef.current = false;
      }
      if (currentRoute.page === "vocal" && incomingRoute.page !== "vocal") {
        pendingRoutePathRef.current = incomingRoute.path;
        vocalExitRequestIdRef.current += 1;
        setVocalExitRequest({ id: vocalExitRequestIdRef.current, targetView: incomingRoute.page });
        window.history.pushState(window.history.state, "", appRouteUrl(currentRoute.path, currentRoute.songId ? { songId: currentRoute.songId } : undefined));
        return;
      }
      const isLeavingPractice = currentRoute.page === "practice" && incomingRoute.page !== "practice";
      const isLeavingStaffGame = isStaffGameRoutePath(currentRoute.path) && !isStaffGameRoutePath(incomingRoute.path);
      if (practiceRunningRef.current && (isLeavingPractice || isLeavingStaffGame)) {
        pendingRoutePathRef.current = incomingRoute.path;
        practiceExitRequestIdRef.current += 1;
        setPracticeExitRequest({ id: practiceExitRequestIdRef.current, targetView: incomingRoute.page });
        window.history.pushState(window.history.state, "", appRouteUrl(currentRoute.path, currentRoute.songId ? { songId: currentRoute.songId } : undefined));
        return;
      }
      routeRef.current = incomingRoute;
      setRoute(incomingRoute);
    };
    window.addEventListener("hashchange", synchronizeRoute);
    window.addEventListener("popstate", synchronizeRoute);
    return () => {
      window.removeEventListener("hashchange", synchronizeRoute);
      window.removeEventListener("popstate", synchronizeRoute);
    };
  }, []);

  useEffect(() => {
    let timeoutId = 0;
    const scheduleNextMinute = (): void => {
      const now = new Date();
      const elapsedInMinute = now.getSeconds() * 1000 + now.getMilliseconds();
      timeoutId = window.setTimeout(() => {
        setAppearanceTimestamp(Date.now());
        scheduleNextMinute();
      }, 60_000 - elapsedInMinute);
    };
    const refreshAppearanceTime = (): void => {
      setAppearanceTimestamp(Date.now());
      window.clearTimeout(timeoutId);
      scheduleNextMinute();
    };
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") {
        refreshAppearanceTime();
      }
    };

    scheduleNextMinute();
    window.addEventListener("focus", refreshAppearanceTime);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refreshAppearanceTime);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = isNightMode ? "dark" : "light";
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = isNightMode ? "#171b19" : "#f6f1e8";
    }
  }, [isNightMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await recoverAbandonedSessions();
      if (!cancelled) {
        await refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    preloadPianoSamples();
  }, []);

  useEffect(() => {
    if (data) {
      setPianoVolume(data.settings.pianoVolume);
    }
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (!backupReminderMessage) {
      setBackupReminderVisible(getBackupReminderState(data).showReminder);
    }
  }, [
    backupReminderMessage,
    data !== null,
    hasBackupDirectory,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    data?.sessions.length,
    data?.reviews.length,
  ]);

  useEffect(() => {
    function onLocalPreferenceChange(event: Event): void {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (view === "settings" && key && LOCAL_PREFERENCE_FEEDBACK_KEYS.has(key)) {
        showConfigurationFeedback("设置已保存并生效");
      }
    }

    window.addEventListener(LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT, onLocalPreferenceChange);
    return () => window.removeEventListener(LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT, onLocalPreferenceChange);
  }, [showConfigurationFeedback, view]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    return installIndexedDbMaintenanceDebug();
  }, []);

  const selectView = useCallback(
    (nextView: View): void => {
      const nextPath = appRoutePathForPage(nextView);
      if (practiceRunning && view === "practice" && nextPath !== route.path) {
        pendingRoutePathRef.current = nextPath;
        if (!practiceExitRequest) {
          practiceExitRequestIdRef.current += 1;
          setPracticeExitRequest({
            id: practiceExitRequestIdRef.current,
            targetView: nextView,
          });
        }
        return;
      }
      if (view === "vocal" && nextPath !== route.path) {
        pendingRoutePathRef.current = nextPath;
        vocalExitRequestIdRef.current += 1;
        setVocalExitRequest({ id: vocalExitRequestIdRef.current, targetView: nextView });
        return;
      }
      navigateToRoute(nextPath);
    },
    [navigateToRoute, practiceExitRequest, practiceRunning, route.path, view, vocalExitRequest],
  );

  const handleNavigationExit = useCallback((targetView: PracticeNavigationExitTarget): void => {
    setPracticeExitRequest(null);
    const path = pendingRoutePathRef.current ?? appRoutePathForPage(targetView);
    const replace = pendingRoutePathRef.current !== null;
    pendingRoutePathRef.current = null;
    navigateToRoute(path, { replace });
  }, [navigateToRoute]);

  const handleVocalNavigationExit = useCallback((targetView: PracticeNavigationExitTarget): void => {
    setVocalExitRequest(null);
    const path = pendingRoutePathRef.current ?? appRoutePathForPage(targetView);
    const replace = pendingRoutePathRef.current !== null;
    pendingRoutePathRef.current = null;
    navigateToRoute(path, { replace });
  }, [navigateToRoute]);

  const selectPracticeGameRoute = useCallback((isGame: boolean): void => {
    navigateToRoute(isGame ? "/practice/game" : "/", { replace: !isGame });
  }, [navigateToRoute]);

  const selectStaffGameMode = useCallback((mode: "levels" | "songs"): void => {
    if (mode === "songs" && routeRef.current.path === "/practice/game/songs/play" && staffGamePlayRoutePushedRef.current) {
      staffGamePlayRoutePushedRef.current = false;
      window.history.back();
      return;
    }
    const returningFromSongGame = mode === "songs" && routeRef.current.path === "/practice/game/songs/play";
    navigateToRoute(mode === "songs" ? "/practice/game/songs" : "/practice/game", {
      replace: returningFromSongGame,
    });
  }, [navigateToRoute]);

  const startStaffGameSong = useCallback((songId: string): void => {
    const isAlreadyOnSongPlayRoute = routeRef.current.path === "/practice/game/songs/play";
    navigateToRoute("/practice/game/songs/play", {
      query: { songId },
      replace: isAlreadyOnSongPlayRoute,
    });
    if (!isAlreadyOnSongPlayRoute) staffGamePlayRoutePushedRef.current = true;
  }, [navigateToRoute]);

  const returnFromStaffGameSongSelection = useCallback((): void => {
    if (staffGameSelectionRoutePushedRef.current) {
      staffGameSelectionRoutePushedRef.current = false;
      window.history.back();
      return;
    }
    navigateToRoute(staffGameSelectionReturnPathRef.current, { replace: true });
  }, [navigateToRoute]);

  const showBackupReminderMessage = useCallback((title: string, detail: string, autoHide: boolean): void => {
    if (autoHide) {
      setBackupReminderMessage(null);
      setBackupReminderVisible(false);
      toast.success(title, { description: detail, duration: 2_500 });
      return;
    }
    toast.error(title, { description: detail });
    setBackupReminderMessage({ dangerous: true, detail, title });
    setBackupReminderVisible(true);
  }, []);

  const suppressBackupReminderToday = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY, todayKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setBackupReminderVisible(false);
  }, []);

  const suppressBackupReminderThisWeek = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_WEEK_KEY, weekStartKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setBackupReminderVisible(false);
  }, []);

  const showBackupReminderAfterActivity = useCallback((): void => {
    if (data && getBackupReminderState(data).showReminder) {
      setBackupReminderVisible(true);
    }
  }, [data]);

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
      while (backupCheckInFlightRef.current) {
        const inFlightResult = await backupCheckInFlightRef.current;
        if (!requestPermission || inFlightResult.result !== "skipped") {
          return inFlightResult;
        }
      }

      const checkPromise = (async (): Promise<BackupCheckResult> => {
        try {
          const outcome = await syncBackupBeforeActivity({ requestPermission });
          const { result } = outcome;
          if (result === "needs-directory") {
            setBackupReminderVisible(true);
            return { proceed: true, result };
          }
          if (result === "data-conflict") {
            await refreshBackupState();
            setBackupReminderVisible(true);
            return { proceed: false, result };
          }
          if (result === "synced-up") {
            const latestData = outcome.importedData ?? (await loadFreshAppData());
            setData(latestData);
            showBackupReminderMessage(backupText.titles.importSuccess, backupText.messages.backupDirectoryAutoImported, true);
            return { latestData, proceed: true, result };
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
          showBackupReminderMessage(
            error instanceof Error ? error.message : String(error),
            backupText.messages.backupPermissionOrDirectoryHint,
            false,
          );
          return { proceed: false, result: "skipped" };
        }
      })();

      backupCheckInFlightRef.current = checkPromise;
      try {
        return await checkPromise;
      } finally {
        if (backupCheckInFlightRef.current === checkPromise) {
          backupCheckInFlightRef.current = null;
        }
      }
    },
    [refreshBackupState, showBackupReminderMessage],
  );

  const preflightBeforePracticeStart = useCallback(async (): Promise<PracticeStartPreflightResult> => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    if (!checkResult.proceed) {
      return { proceed: false };
    }
    if (checkResult.result !== "synced-up") {
      return { proceed: true };
    }
    const latestData = checkResult.latestData ?? (await loadFreshAppData());
    setData(latestData);
    return { proceed: true, reviews: latestData.reviews, settings: latestData.settings };
  }, [runBackupCheck]);

  const preflightBeforeStaffRecallStart = useCallback(async (): Promise<StaffRecallStartPreflightResult> => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    return { proceed: checkResult.proceed };
  }, [runBackupCheck]);

  const preflightBeforeVocalLibraryChange = useCallback(async (): Promise<VocalLibraryMutationPreflightResult> => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    if (!checkResult.proceed) return "blocked";
    return checkResult.result === "synced-up" ? "backup-updated" : "proceed";
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

  const runBackupReminderAction = useCallback(async (action: BackupReminderAction): Promise<void> => {
    if (!data || backupReminderBusy) {
      return;
    }

    const reminderState = getBackupReminderState(data);
    setBackupReminderBusy(true);
    setBackupReminderMessage(null);
    try {
      if (action === "choose-directory") {
        const result = await chooseBackupDirectory();
        const latestBackupState = await getBackupState();
        await refresh();
        if (result === "diverged") {
          showBackupReminderMessage(backupText.titles.dataConflict, formatBackupConflictDetail(latestBackupState), false);
          return;
        }
        if (result === "synced-up") {
          showBackupReminderMessage(backupText.titles.importSuccess, backupText.messages.importSuccessDetail, true);
        }
        return;
      }

    } catch (error) {
      if (isUserAbort(error)) {
        setBackupReminderMessage(null);
        setBackupReminderVisible(reminderState.showReminder);
        return;
      }
      showBackupReminderMessage(
        error instanceof Error ? error.message : String(error),
        backupText.messages.backupPermissionOrDirectoryHint,
        false,
      );
    } finally {
      setBackupReminderBusy(false);
    }
  }, [backupReminderBusy, data, refresh, showBackupReminderMessage]);

  const resolveBackupReminderConflict = useCallback(async (resolution: BackupConflictResolution): Promise<void> => {
    if (!data || backupReminderBusy) {
      return;
    }
    setBackupReminderBusy(true);
    setBackupReminderMessage(null);
    try {
      await resolveBackupConflict(resolution);
      await refresh();
      showBackupReminderMessage(backupText.titles.conflictResolved, backupText.messages.conflictResolvedDetail, true);
    } catch (error) {
      await refresh();
      showBackupReminderMessage(
        error instanceof Error ? error.message : String(error),
        backupText.messages.backupPermissionOrDirectoryHint,
        false,
      );
    } finally {
      setBackupReminderBusy(false);
    }
  }, [backupReminderBusy, data, refresh, showBackupReminderMessage]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);

    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register(new URL("service-worker.js", appBaseUrl).toString(), {
        scope: appBaseUrl.pathname,
      }).catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => ("caches" in window ? caches.keys() : []))
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("anki-note-") && key !== ENHANCED_PITCH_MODEL_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .catch(() => undefined);
  }, []);

  const showIndexedDbMaintenance = import.meta.env.DEV && new URLSearchParams(window.location.search).get("debug") === "indexeddb";
  if (showIndexedDbMaintenance) {
    return <IndexedDbMaintenancePanel />;
  }

  if (!data) {
    return <div className="loading">加载中</div>;
  }

  const backupReminderState = getBackupReminderState(data);
  const showBackupReminder = (backupReminderVisible && backupReminderState.showReminder) || backupReminderMessage !== null;
  const backupReminderTitle =
    backupReminderMessage?.title ??
    (backupReminderState.kind === "data-conflict"
      ? backupText.titles.dataConflict
      : backupText.titles.chooseDirectorySuggestion);
  const displayBackupReminder =
    showBackupReminder &&
    !practiceRunning &&
    !isStaffGameRoutePath(route.path) &&
    (view !== "vocal" || backupReminderState.kind === "data-conflict");
  const shellClassName = [
    "app-shell",
    practiceRunning ? "app-shell-practice-running" : "",
    view === "practice" ? "app-shell-practice-page" : "",
    view === "home" ? "app-shell-home" : "",
  ].filter(Boolean).join(" ");
  const showMobileBackButton = view !== "home" && !(view === "practice" && isStaffGameRoutePath(route.path)) && (!practiceRunning || view === "practice");
  return (
    <PageAppearanceProvider isNightMode={isNightMode}>
    <Toaster closeButton position="top-center" richColors theme={isNightMode ? "dark" : "light"} />
    <div className={shellClassName}>
      <nav aria-label="主导航" className="app-nav">
        <button aria-label="首页" aria-current={view === "home" ? "page" : undefined} className={view === "home" ? "active" : ""} onClick={() => selectView("home")} type="button">
          <House aria-hidden="true" size={18} />
          首页
        </button>
        <button aria-current={view === "study" ? "page" : undefined} className={view === "study" ? "active" : ""} onClick={() => selectView("study")} type="button">
          <BookOpen aria-hidden="true" size={18} />
          学习
        </button>
        <button aria-current={view === "practice" ? "page" : undefined} className={view === "practice" ? "active" : ""} onClick={() => selectView("practice")} type="button">
          <Dumbbell aria-hidden="true" size={18} />
          练习
        </button>
        <button aria-current={view === "stats" ? "page" : undefined} className={view === "stats" ? "active" : ""} onClick={() => selectView("stats")} type="button">
          <BarChart3 aria-hidden="true" size={18} />
          统计
        </button>
        <button aria-current={view === "vocal" ? "page" : undefined} className={view === "vocal" ? "active" : ""} onClick={() => selectView("vocal")} type="button">
          <AudioLines aria-hidden="true" size={18} />
          清唱
        </button>
        <button aria-current={view === "settings" ? "page" : undefined} className={view === "settings" ? "active" : ""} onClick={() => selectView("settings")} type="button">
          <Settings aria-hidden="true" size={18} />
          设置
        </button>
      </nav>
      <main className={displayBackupReminder && view !== "vocal" ? "has-backup-reminder" : undefined}>
        {displayBackupReminder ? (
          <div
            aria-label={backupReminderTitle}
            className={[
              "backup-reminder",
              view === "vocal" ? "vocal-backup-reminder" : "",
              backupReminderMessage?.dangerous || backupReminderState.kind === "data-conflict" ? "is-dangerous" : "",
            ].filter(Boolean).join(" ")}
            role="region"
          >
            <div>
              <strong>
                {backupReminderTitle}
              </strong>
              <span>
                {backupReminderMessage
                  ? backupReminderMessage.detail
                  : backupReminderState.kind === "data-conflict"
                    ? formatBackupConflictDetail(data.backupState)
                    : backupText.messages.browserOnlyNeedsDirectory}
              </span>
            </div>
            <div className="backup-reminder-actions">
              {backupReminderState.kind === "needs-directory" ? (
                <button className="primary" disabled={backupReminderBusy} onClick={() => void runBackupReminderAction("choose-directory")}>
                  <FolderOpen size={18} />
                  {backupText.labels.chooseDirectory}
                </button>
              ) : null}
              {backupReminderState.kind === "data-conflict" ? (
                <BackupConflictResolver
                  backupState={data.backupState}
                  disabled={backupReminderBusy}
                  onResolve={resolveBackupReminderConflict}
                />
              ) : null}
              {backupReminderState.kind === "data-conflict" ? (
                <button
                  disabled={backupReminderBusy}
                  onClick={() => void runBackupReminderAction("choose-directory")}
                >
                  <FolderOpen size={18} />
                  {backupText.labels.chooseEmptyDirectory}
                </button>
              ) : null}
              {backupReminderState.kind === "needs-directory" ? (
                <button onClick={suppressBackupReminderToday}>
                  <BellOff size={18} />
                  {backupText.labels.suppressToday}
                </button>
              ) : null}
              {backupReminderState.kind === "needs-directory" ? (
                <button onClick={suppressBackupReminderThisWeek}>
                  <BellOff size={18} />
                  {backupText.labels.suppressWeek}
                </button>
              ) : null}
              <button title={backupText.labels.close} onClick={() => setBackupReminderVisible(false)}>
                <X size={18} />
                {backupText.labels.dismiss}
              </button>
            </div>
          </div>
        ) : null}
        {view === "home" ? <HomeView onNavigate={navigateToRoute} /> : null}
        {view === "practice" ? (
          <PracticeView
            midi={midi}
            practiceMicrophonePreferences={practiceMicrophonePreferences}
            onPracticeMicrophonePreferencesChange={setPracticeMicrophonePreferences}
            practicePagePreferences={practicePagePreferences}
            settings={data.settings}
            sessions={data.sessions}
            reviews={data.reviews}
            navigationExitRequest={practiceExitRequest}
            onRequestNavigationExit={selectView}
            isStaffGameRoute={isStaffGameRoutePath(route.path)}
            initialStaffGameMode={isStaffGameSongRoutePath(route.path) ? "songs" : "levels"}
            initialSongSelectionStep={route.path === "/practice/game/songs/play" ? "detail" : "list"}
            initialSongId={route.songId}
            isStaffGameSongPlayRoute={route.path === "/practice/game/songs/play"}
            onStaffGameRouteChange={selectPracticeGameRoute}
            onStaffGameModeChange={selectStaffGameMode}
            onStaffGameSongStart={startStaffGameSong}
            onStaffGameSongSelectionExit={returnFromStaffGameSongSelection}
            onDataChanged={refresh}
            onNavigationExit={handleNavigationExit}
            onOpenStats={() => selectView("stats")}
            onOpenSettings={() => selectView("settings")}
            onBeforePracticeStart={preflightBeforePracticeStart}
            onPracticeFinished={showBackupReminderAfterActivity}
            onRunningChange={setPracticeRunning}
            onSettingsSaved={(settings, options) => saveSettings(settings, { ...options, feedback: false })}
          />
        ) : null}
        {view === "stats" ? (
          <StatsView
            settings={data.settings}
            reviews={data.reviews}
            sessions={data.sessions}
            onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
          />
        ) : null}
        {view === "study" ? (
          <StudyView
            onBeforeStaffRecallStart={preflightBeforeStaffRecallStart}
            onDataChanged={refresh}
            onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
            onStaffRecallFinished={showBackupReminderAfterActivity}
            settings={data.settings}
            staffRecallRuns={data.staffRecallRuns}
          />
        ) : null}
        {view === "settings" ? (
          <SettingsView
            backupState={data.backupState}
            pageAppearancePreferences={pageAppearancePreferences}
            practiceMicrophonePreferences={practiceMicrophonePreferences}
            practicePagePreferences={practicePagePreferences}
            settings={data.settings}
            midi={midi}
            onDataChanged={refresh}
            onPageAppearancePreferencesChange={setPageAppearancePreferences}
            onPracticeMicrophonePreferencesChange={setPracticeMicrophonePreferences}
            onPracticePagePreferencesChange={setPracticePagePreferences}
            onRestoreDefaultConfiguration={restoreAllConfiguration}
            onSettingsSaved={saveSettings}
          />
        ) : null}
        {view === "vocal" ? (
          <VocalPitchView
            backupDirectory={data.backupState.directoryHandle}
            libraryRevision={data.backupState.lastSeenVocalAudioLibraryDigest}
            navigationExitRequest={vocalExitRequest}
            onBackupStateChanged={refreshBackupState}
            onBeforeLibraryChange={preflightBeforeVocalLibraryChange}
            onNavigationExit={handleVocalNavigationExit}
          />
        ) : null}
      </main>
      {showMobileBackButton ? (
        <button aria-label="返回首页" className="mobile-route-back" onClick={() => selectView("home")} type="button">
          <ArrowLeft aria-hidden="true" size={19} />
          返回
        </button>
      ) : null}
      {MIDI_LATENCY_DIAGNOSTICS_ENABLED ? (
        <MidiLatencyDiagnosticsPanel correctDelayMs={data.settings.correctDelayMs} />
      ) : null}
    </div>
    </PageAppearanceProvider>
  );
}
