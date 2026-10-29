import {
  ArrowLeft,
  BellOff,
  FolderOpen,
  Gamepad2,
  GripVertical,
  House,
  Settings,
  Timer,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Toaster, toast } from "sonner";
import { setPianoVolume } from "../audio/pianoSettings";
import {
  db,
  ensureSettings,
  getBackupState,
  loadPracticeHistory,
  loadStaffRecallHistory,
  recoverAbandonedSessions,
  retryPendingAnswerEvents,
  restoreDefaultConfiguration,
} from "../data/db";
import { IndexedDbMaintenancePanel } from "../debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "../debug/indexedDbMaintenance";
import { backupText, formatBackupConflictDetail } from "../domain/backupText";
import type { AppSettings } from "../domain/types";
import { MidiLatencyDiagnosticsPanel } from "../diagnostics/MidiLatencyDiagnosticsPanel";
import { MIDI_LATENCY_DIAGNOSTICS_ENABLED } from "../diagnostics/midiLatencyDiagnostics";
import { BackupConflictResolver } from "../shared/components/BackupConflictResolver";
import { AppStartupSkeleton, RouteLoadingSkeleton } from "../shared/components/LoadingSkeletons";
import { HomeView } from "../features/home/components/HomeView";
import { ModuleLayout } from "../features/learning/components/ModuleLayout";
import { ModuleGuideView } from "../features/learning/components/ModuleGuideView";
import { getLearningModule } from "../features/learning/learningModules";
import { StaffGameRoute } from "../features/staff-game/components/StaffGameRoute";
import { PracticeFullscreenFrame } from "../features/practice/components/PracticeFullscreenFrame";
import type {
  PracticeNavigationExitRequest,
  PracticeNavigationExitTarget,
  PracticeInputMode,
} from "../features/practice/components/PracticeView";
import { MetronomeDialog } from "../features/metronome/components/MetronomeDialog";
import { MetronomeFloating } from "../features/metronome/components/MetronomeFloating";
import { useMetronomeController } from "../features/metronome/useMetronomeController";
import { useMetronomeScreenWakeLock } from "../features/metronome/useMetronomeScreenWakeLock";
import { useBlurButtonAfterPointerClick } from "./hooks/useBlurButtonAfterPointerClick";
import { useLocalStorageState } from "../shared/hooks/useLocalStorageState";
import {
  clearLocalPreferenceStorage,
  LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT,
  LOCAL_STORAGE_PREFERENCES_RESET_EVENT,
} from "../storage/localPreferenceEvents";
import {
  DEFAULT_PRACTICE_PAGE_PREFERENCES,
  parsePracticePagePreferences,
  PRACTICE_PAGE_PREFERENCES_KEY,
} from "../shared/preferences/practicePagePreferences";
import {
  DEFAULT_PAGE_APPEARANCE_PREFERENCES,
  PAGE_APPEARANCE_PREFERENCES_KEY,
  PageAppearanceProvider,
  parsePageAppearancePreferences,
  resolveNightMode,
} from "../shared/appearance/pageAppearance";
import { useMidiInput } from "../midi/useMidiInput";
import { ENHANCED_PITCH_MODEL_CACHE } from "../features/vocal-pitch/logic/enhancedPitchModels";
import { useAppUpdateNotice } from "./useAppUpdateNotice";
import { useNightModeSuggestion } from "./useNightModeSuggestion";
import {
  getBackupReminderState,
  loadFreshAppData,
  useBackupReminder,
  type AppData,
} from "./useBackupReminder";
import {
  appRouteQuery,
  appRouteFromHash,
  appRoutePathForPage,
  appRouteUrl,
  isStaffGameRoutePath,
  isStaffGameSongRoutePath,
  type AppRoute,
  type AppRoutePath,
  type LearningModuleTab,
} from "../routing/appRoutes";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  createDefaultPracticeMicrophonePreferences,
  defaultPracticeMicrophoneSensitivityForDevice,
  parseSystemPracticeMicrophonePreferences,
  PRACTICE_MICROPHONE_PREFERENCES_KEY,
} from "../features/vocal-pitch/logic/practiceMicrophonePreferences";

const SettingsView = lazy(() =>
  import("../features/settings/components/SettingsView").then((module) => ({
    default: module.SettingsView,
  }))
);
const PracticeView = lazy(() =>
  import("../features/practice/components/PracticeView").then((module) => ({
    default: module.PracticeView,
  }))
);
const StatsView = lazy(() =>
  import("../features/stats/components/StatsView").then((module) => ({ default: module.StatsView }))
);
const StudyView = lazy(() =>
  import("../features/study/components/StudyView").then((module) => ({ default: module.StudyView }))
);
const VocalPitchView = lazy(() =>
  import("../features/vocal-pitch/components/VocalPitchView").then((module) => ({
    default: module.VocalPitchView,
  }))
);

type View = PracticeNavigationExitTarget | "metronome";
type SettingsSaveOptions = { feedback?: boolean };

const INITIAL_PRACTICE_MICROPHONE_PREFERENCES = (() => {
  if (typeof navigator === "undefined") return DEFAULT_PRACTICE_MICROPHONE_PREFERENCES;
  const sensitivityLevel = defaultPracticeMicrophoneSensitivityForDevice(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints
  );
  return createDefaultPracticeMicrophonePreferences(sensitivityLevel);
})();

const LOCAL_PREFERENCE_FEEDBACK_KEYS = new Set([
  "anki-note.globalDebugEnabled",
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
  "anki-note.midiInputId.v2",
]);

function HistoryLoadingState({
  error,
  label,
  onRetry,
}: {
  error: string | null;
  label: string;
  onRetry: () => void;
}): JSX.Element {
  if (!error) {
    return (
      <section
        aria-busy="true"
        aria-label={`正在加载${label}`}
        className="history-loading-state"
        role="status"
      >
        <span>{label}加载中</span>
        <div aria-hidden="true" className="route-loading-panel">
          <i />
          <i />
          <i />
        </div>
        <div aria-hidden="true" className="route-loading-panel route-loading-panel-short">
          <i />
          <i />
        </div>
        <div aria-hidden="true" className="route-loading-panel">
          <i />
          <i />
          <i />
        </div>
      </section>
    );
  }

  return (
    <section className="history-load-error" role="alert">
      <strong>{label}加载失败</strong>
      <p>{error}</p>
      <button className="primary" onClick={onRetry}>
        重试加载
      </button>
    </section>
  );
}

export function App({
  skipPendingAnswerEventRetry = false,
}: {
  skipPendingAnswerEventRetry?: boolean;
}): JSX.Element {
  useBlurButtonAfterPointerClick();
  const appUpdateController = useAppUpdateNotice();
  const midi = useMidiInput();
  const previousMidiStatusRef = useRef({
    initialized: false,
    inputId: midi.selectedInputId,
    isConnected: midi.isConnected,
    status: midi.status,
  });

  useEffect(() => {
    const previous = previousMidiStatusRef.current;
    const next = {
      inputId: midi.selectedInputId,
      isConnected: midi.isConnected,
      status: midi.status,
    };

    if (previous.initialized) {
      if (!previous.isConnected && next.isConnected) {
        const name = midi.selectedInput?.name;
        toast.success(name ? `MIDI 已连接：${name}` : "MIDI 已连接", {
          duration: 2000,
          id: "midi-device-status",
        });
      } else if (previous.isConnected && !next.isConnected) {
        toast.info("MIDI 已断开", { duration: 2000, id: "midi-device-status" });
      } else if (previous.isConnected && next.isConnected && previous.inputId !== next.inputId) {
        const previousInputWasRemoved = !midi.inputs.some((input) => input.id === previous.inputId);
        const name = midi.selectedInput?.name;
        toast.success(
          previousInputWasRemoved
            ? `原 MIDI 已断开，已切换到${name ? `：${name}` : "其他设备"}`
            : `已切换 MIDI${name ? `：${name}` : "设备"}`,
          { duration: 2000, id: "midi-device-status" }
        );
      } else if (previous.status === "requesting" && next.status === "error") {
        toast.error(midi.errorMessage ?? "MIDI 连接失败", {
          duration: 2000,
          id: "midi-device-status",
        });
      } else if (previous.status === "requesting" && next.status === "ready" && !next.isConnected) {
        toast.info("未检测到 MIDI 输入设备", {
          duration: 2000,
          id: "midi-device-status",
        });
      }
    }

    previousMidiStatusRef.current = { ...next, initialized: true };
  }, [
    midi.errorMessage,
    midi.inputs,
    midi.isConnected,
    midi.selectedInput?.name,
    midi.selectedInputId,
    midi.status,
  ]);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("app-startup-reload-attempted");
    } catch {
      // The application can start without session storage.
    }

    const refreshUrl = new URL(window.location.href);
    if (!refreshUrl.searchParams.has("__app_refresh")) return;
    refreshUrl.searchParams.delete("__app_refresh");
    window.history.replaceState(
      window.history.state,
      "",
      `${refreshUrl.pathname}${refreshUrl.search}${refreshUrl.hash}`
    );
  }, []);

  const [route, setRoute] = useState<AppRoute>(() => appRouteFromHash(window.location.hash));
  const [isHomeMetronomeOpen, setIsHomeMetronomeOpen] = useState(() => route.page === "metronome");
  const metronomeController = useMetronomeController();
  const stopMetronome = metronomeController.stop;
  const practiceMetronomeSyncToggleRef = useRef<(() => void) | null>(null);
  const practiceMetronomeSyncPauseRef = useRef<(() => void) | null>(null);
  const [practiceMetronomeHiddenForVisit, setPracticeMetronomeHiddenForVisit] = useState(false);
  const [practiceInputModeState, setPracticeInputModeState] = useState<{
    mode: PracticeInputMode;
    routeKey: string;
  } | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const practiceHistoryRestorePendingRef = useRef(false);
  const staffGameSelectionReturnPathRef = useRef<AppRoutePath>("/");
  const staffGameSelectionRoutePushedRef = useRef(false);
  const staffGamePlayRoutePushedRef = useRef(false);
  const [pageAppearancePreferences, setPageAppearancePreferences] = useLocalStorageState(
    PAGE_APPEARANCE_PREFERENCES_KEY,
    DEFAULT_PAGE_APPEARANCE_PREFERENCES,
    { parse: parsePageAppearancePreferences }
  );
  const [practiceMicrophonePreferences, setPracticeMicrophonePreferences] = useLocalStorageState(
    PRACTICE_MICROPHONE_PREFERENCES_KEY,
    INITIAL_PRACTICE_MICROPHONE_PREFERENCES,
    { parse: parseSystemPracticeMicrophonePreferences }
  );
  const [practicePagePreferences, setPracticePagePreferences] = useLocalStorageState(
    PRACTICE_PAGE_PREFERENCES_KEY,
    DEFAULT_PRACTICE_PAGE_PREFERENCES,
    { parse: parsePracticePagePreferences }
  );
  const [appearanceTimestamp, setAppearanceTimestamp] = useState(() => Date.now());
  const isNightMode = resolveNightMode(pageAppearancePreferences, new Date(appearanceTimestamp));
  useNightModeSuggestion({
    appearanceTimestamp,
    pageAppearancePreferences,
    setAppearanceTimestamp,
    setPageAppearancePreferences,
  });
  useEffect(() => {
    // A background tab can otherwise reuse an old auto-mode setting when it becomes visible again.
    const synchronizeAppearancePreferences = (event: StorageEvent): void => {
      if (event.key !== PAGE_APPEARANCE_PREFERENCES_KEY && event.key !== null) return;
      try {
        const storedValue =
          event.key === null
            ? window.localStorage.getItem(PAGE_APPEARANCE_PREFERENCES_KEY)
            : event.newValue;
        setPageAppearancePreferences(
          parsePageAppearancePreferences(
            storedValue ? JSON.parse(storedValue) : null,
            DEFAULT_PAGE_APPEARANCE_PREFERENCES
          )
        );
      } catch {
        setPageAppearancePreferences(DEFAULT_PAGE_APPEARANCE_PREFERENCES);
      }
    };
    window.addEventListener("storage", synchronizeAppearancePreferences);
    return () => window.removeEventListener("storage", synchronizeAppearancePreferences);
  }, [setPageAppearancePreferences]);
  const [data, setData] = useState<AppData | null>(null);
  const [historyLoadErrors, setHistoryLoadErrors] = useState<{
    practice: string | null;
    staffRecall: string | null;
  }>({
    practice: null,
    staffRecall: null,
  });
  const [historyLoadRetryToken, setHistoryLoadRetryToken] = useState(0);
  const currentSettingsRef = useRef<AppSettings | undefined>(undefined);
  currentSettingsRef.current = data?.settings;
  const settingsMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const configurationRestoreInProgressRef = useRef(false);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const [practiceFullscreenAvailable, setPracticeFullscreenAvailable] = useState(false);
  const [practiceVirtualKeyboardActive, setPracticeVirtualKeyboardActive] = useState(false);
  const practiceRunningRef = useRef(false);
  practiceRunningRef.current = practiceRunning;
  const [practiceStageActive, setPracticeStageActive] = useState(false);
  const practiceStageActiveRef = useRef(false);
  practiceStageActiveRef.current = practiceStageActive;
  const pendingRoutePathRef = useRef<AppRoutePath | null>(null);
  const [mobileBackPosition, setMobileBackPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const mobileBackButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileBackDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const ignoreMobileBackClickRef = useRef(false);
  const view: View =
    route.page === "game" ? "practice" : route.page === "metronome" ? "home" : route.page;
  const module = route.levelId ? getLearningModule(route.levelId) : null;
  const moduleTab: LearningModuleTab = route.moduleTab ?? "practice";
  const isPracticePageRoute =
    route.path === "/practice" || (route.levelId !== undefined && route.levelId > 1);

  useEffect(() => {
    if (view !== "practice" || isStaffGameRoutePath(route.path)) {
      setPracticeFullscreenAvailable(false);
    }
  }, [route.path, view]);

  const practiceInputRouteKey = `${route.path}:${route.practiceTab ?? "free"}`;
  const handlePracticeInputModeChange = useCallback(
    (mode: PracticeInputMode): void => {
      setPracticeInputModeState({ mode, routeKey: practiceInputRouteKey });
    },
    [practiceInputRouteKey]
  );
  const registerPracticeMetronomeSyncToggle = useCallback(
    (toggle: (() => void) | undefined): void => {
      practiceMetronomeSyncToggleRef.current = toggle ?? null;
    },
    []
  );
  const registerPracticeMetronomeSyncPause = useCallback(
    (pause: (() => void) | undefined): void => {
      practiceMetronomeSyncPauseRef.current = pause ?? null;
    },
    []
  );
  const toggleSynchronizedPractice = useCallback((): void => {
    practiceMetronomeSyncToggleRef.current?.();
  }, []);
  const pauseMetronomeForInactivity = useCallback((): void => {
    if (!metronomeController.isPlaying) return;
    if (metronomeController.isSyncLocked && practiceMetronomeSyncPauseRef.current) {
      practiceMetronomeSyncPauseRef.current();
      return;
    }
    stopMetronome();
  }, [metronomeController.isPlaying, metronomeController.isSyncLocked, stopMetronome]);
  useMetronomeScreenWakeLock({
    isPlaying: metronomeController.isPlaying,
    onPause: pauseMetronomeForInactivity,
    subscribeMidiActivity: midi.subscribe,
  });
  const isStaffGamePage = route.page === "game";
  const [practiceExitRequest, setPracticeExitRequest] =
    useState<PracticeNavigationExitRequest | null>(null);
  const [vocalExitRequest, setVocalExitRequest] = useState<PracticeNavigationExitRequest | null>(
    null
  );
  const practiceExitRequestIdRef = useRef(0);
  const vocalExitRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isPracticePageRoute && route.path !== "/metronome") {
      stopMetronome();
    }
  }, [isPracticePageRoute, route.path, stopMetronome]);

  useEffect(() => {
    if (!isPracticePageRoute) setPracticeInputModeState(null);
  }, [isPracticePageRoute]);

  useEffect(() => {
    setIsHomeMetronomeOpen(route.page === "metronome");
  }, [route.page]);

  useEffect(() => {
    if (!isPracticePageRoute) setPracticeMetronomeHiddenForVisit(false);
  }, [isPracticePageRoute]);

  useEffect(() => {
    if (
      isPracticePageRoute &&
      practiceInputModeState?.routeKey === practiceInputRouteKey &&
      practiceInputModeState.mode === "microphone"
    ) {
      stopMetronome();
    }
  }, [isPracticePageRoute, practiceInputModeState, practiceInputRouteKey, stopMetronome]);

  useEffect(() => {
    if (isPracticePageRoute) stopMetronome();
  }, [isPracticePageRoute, route.path, route.practiceTab, stopMetronome]);

  useEffect(() => {
    const clampMobileBackPosition = (): void => {
      const button = mobileBackButtonRef.current;
      if (!button) return;
      const { width, height } = button.getBoundingClientRect();
      const maxLeft = Math.max(0, document.documentElement.clientWidth - width);
      const maxTop = Math.max(0, document.documentElement.clientHeight - height);
      setMobileBackPosition((position) =>
        position
          ? {
              left: Math.min(maxLeft, Math.max(0, position.left)),
              top: Math.min(maxTop, Math.max(0, position.top)),
            }
          : position
      );
    };
    window.addEventListener("resize", clampMobileBackPosition);
    return () => window.removeEventListener("resize", clampMobileBackPosition);
  }, []);

  const handleMobileBackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      if (!event.isPrimary || event.button > 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      mobileBackDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handleMobileBackPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      const drag = mobileBackDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
      drag.moved = true;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const maxLeft = Math.max(0, document.documentElement.clientWidth - rect.width);
      const maxTop = Math.max(0, document.documentElement.clientHeight - rect.height);
      setMobileBackPosition({
        left: Math.min(maxLeft, Math.max(0, drag.left + deltaX)),
        top: Math.min(maxTop, Math.max(0, drag.top + deltaY)),
      });
    },
    []
  );

  const finishMobileBackDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, suppressClick: boolean): void => {
      const drag = mobileBackDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      ignoreMobileBackClickRef.current = suppressClick && drag.moved;
      mobileBackDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (ignoreMobileBackClickRef.current) {
        window.setTimeout(() => {
          ignoreMobileBackClickRef.current = false;
        }, 0);
      }
    },
    []
  );

  const showConfigurationFeedback = useCallback(
    (
      detail: string,
      options: { requiresRefresh?: boolean; title?: string; error?: boolean } = {}
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
    },
    []
  );

  const refresh = useCallback(async (): Promise<void> => {
    setData(await loadFreshAppData());
  }, []);

  const refreshPracticeHistory = useCallback(async (): Promise<void> => {
    const [history, settings, backupState] = await Promise.all([
      loadPracticeHistory(),
      ensureSettings(),
      getBackupState(),
    ]);
    setData((current) =>
      current
        ? {
            ...current,
            ...history,
            settings,
            backupState,
            practiceHistoryLoaded: true,
          }
        : current
    );
  }, []);

  const refreshStaffRecallHistory = useCallback(async (): Promise<void> => {
    const [staffRecallRuns, backupState] = await Promise.all([
      loadStaffRecallHistory(),
      getBackupState(),
    ]);
    setData((current) =>
      current
        ? {
            ...current,
            staffRecallRuns,
            backupState,
            staffRecallHistoryLoaded: true,
          }
        : current
    );
  }, []);

  const saveSettings = useCallback(
    async (settings: AppSettings, options: SettingsSaveOptions = {}): Promise<void> => {
      if (configurationRestoreInProgressRef.current) return;
      const previousSettings = currentSettingsRef.current;
      const changedKeys = previousSettings
        ? Object.keys(settings).filter(
            (key) =>
              !Object.is(
                (settings as unknown as Record<string, unknown>)[key],
                (previousSettings as unknown as Record<string, unknown>)[key]
              )
          )
        : [];
      if (changedKeys.length === 0) return;
      currentSettingsRef.current = settings;
      setData((current) => (current ? { ...current, settings } : current));
      const writePromise = settingsMutationQueueRef.current.then(() => db.settings.put(settings));
      settingsMutationQueueRef.current = writePromise.then(
        () => undefined,
        () => undefined
      );
      await writePromise;
      if (options.feedback === false) return;
      showConfigurationFeedback("设置已保存并生效");
    },
    [showConfigurationFeedback]
  );

  const restoreAllConfiguration = useCallback(async (): Promise<void> => {
    if (!data || configurationRestoreInProgressRef.current) return;
    configurationRestoreInProgressRef.current = true;
    const restorePromise = settingsMutationQueueRef.current.then(async () => {
      const settings = await restoreDefaultConfiguration(
        currentSettingsRef.current ?? data.settings
      );
      let storageResult: ReturnType<typeof clearLocalPreferenceStorage>;
      try {
        storageResult = clearLocalPreferenceStorage(window.localStorage);
      } catch {
        storageResult = { clearedKeys: [], failedKeys: ["<localStorage access>"] };
      }
      window.dispatchEvent(new Event(LOCAL_STORAGE_PREFERENCES_RESET_EVENT));
      currentSettingsRef.current = settings;
      setData((current) =>
        current
          ? { ...current, settings, backupState: { id: "default", schemaVersion: 1 } }
          : current
      );
      if (storageResult.failedKeys.length > 0) {
        showConfigurationFeedback(
          `默认配置已恢复，页面偏好已同步。未能清理：${storageResult.failedKeys.join("、")}；刷新后这些项目可能重新加载。`,
          { title: "本地偏好部分未清理", error: true }
        );
      } else {
        showConfigurationFeedback(
          "默认配置已恢复，学习数据和备份文件均已保留。刷新页面以重新初始化 MIDI 设备。",
          { requiresRefresh: true }
        );
      }
    });
    settingsMutationQueueRef.current = restorePromise.then(
      () => undefined,
      () => undefined
    );
    try {
      await restorePromise;
    } catch (error) {
      showConfigurationFeedback(
        `恢复配置失败：${error instanceof Error ? error.message : String(error)}`,
        { title: "配置未能完整恢复", error: true }
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
  const {
    busy: backupReminderBusy,
    message: backupReminderMessage,
    visible: backupReminderVisible,
    setVisible: setBackupReminderVisible,
    showAfterActivity: showBackupReminderAfterActivity,
    suppressToday: suppressBackupReminderToday,
    suppressThisWeek: suppressBackupReminderThisWeek,
    runReminderAction: runBackupReminderAction,
    resolveReminderConflict: resolveBackupReminderConflict,
    preflightBeforePracticeStart,
    preflightBeforeStaffRecallStart,
    preflightBeforeVocalLibraryChange,
  } = useBackupReminder({
    data,
    setData,
    refresh,
    refreshBackupState,
    hasBackupDirectory,
    practiceRunning,
    view,
  });

  const navigateToRoute = useCallback(
    (
      path: AppRoutePath,
      options: { query?: Record<string, string>; replace?: boolean } = {}
    ): void => {
      const queryString = options.query ? new URLSearchParams(options.query).toString() : "";
      const nextRoute = appRouteFromHash(`#${path}${queryString ? `?${queryString}` : ""}`);
      const currentRoute = routeRef.current;
      if (path === "/playground/songs" && !isStaffGameSongRoutePath(currentRoute.path)) {
        staffGameSelectionReturnPathRef.current = currentRoute.path;
        staffGameSelectionRoutePushedRef.current = !options.replace;
      }
      if (
        currentRoute.path === nextRoute.path &&
        currentRoute.songId === nextRoute.songId &&
        currentRoute.practiceTab === nextRoute.practiceTab &&
        currentRoute.practiceDistanceMode === nextRoute.practiceDistanceMode &&
        currentRoute.moduleTab === nextRoute.moduleTab &&
        currentRoute.playgroundStatsTab === nextRoute.playgroundStatsTab
      )
        return;
      const url = appRouteUrl(nextRoute.path, options.query ?? appRouteQuery(nextRoute));
      if (options.replace) {
        window.history.replaceState(window.history.state, "", url);
      } else {
        window.history.pushState(window.history.state, "", url);
      }
      routeRef.current = nextRoute;
      setRoute(nextRoute);
    },
    []
  );

  const selectModuleTab = useCallback(
    (tab: LearningModuleTab): void => {
      if (!routeRef.current.levelId) return;
      const path = routeRef.current.path;
      const currentQuery = appRouteQuery(routeRef.current) ?? {};
      navigateToRoute(path, {
        query: { ...currentQuery, tab },
      });
    },
    [navigateToRoute]
  );

  const closeHomeMetronome = useCallback((): void => {
    stopMetronome();
    setIsHomeMetronomeOpen(false);
    if (routeRef.current.path === "/metronome") {
      navigateToRoute("/", { replace: true });
    }
  }, [navigateToRoute, stopMetronome]);

  useEffect(() => {
    const normalizedRoute = appRouteFromHash(window.location.hash);
    const normalizedQuery = appRouteQuery(normalizedRoute);
    const normalizedHash = `${normalizedRoute.path}${normalizedQuery ? `?${new URLSearchParams(normalizedQuery).toString()}` : ""}`;
    if (!window.location.hash || normalizedHash !== window.location.hash.slice(1)) {
      window.history.replaceState(
        window.history.state,
        "",
        appRouteUrl(normalizedRoute.path, normalizedQuery)
      );
    }
    const synchronizeRoute = (): void => {
      const incomingRoute = appRouteFromHash(window.location.hash);
      const currentRoute = routeRef.current;
      if (
        incomingRoute.path === currentRoute.path &&
        incomingRoute.songId === currentRoute.songId &&
        incomingRoute.practiceTab === currentRoute.practiceTab &&
        incomingRoute.practiceDistanceMode === currentRoute.practiceDistanceMode &&
        incomingRoute.moduleTab === currentRoute.moduleTab &&
        incomingRoute.playgroundStatsTab === currentRoute.playgroundStatsTab
      ) {
        practiceHistoryRestorePendingRef.current = false;
        return;
      }
      if (practiceHistoryRestorePendingRef.current) return;
      if (
        !isStaffGameSongRoutePath(currentRoute.path) &&
        incomingRoute.path === "/practice/game/songs"
      ) {
        staffGameSelectionReturnPathRef.current = currentRoute.path;
        staffGameSelectionRoutePushedRef.current = true;
      }
      if (
        currentRoute.path === "/practice/game/songs" &&
        incomingRoute.path === "/practice/game/songs/play"
      ) {
        staffGamePlayRoutePushedRef.current = staffGameSelectionRoutePushedRef.current;
      }
      if (
        currentRoute.path === "/practice/game/songs/play" &&
        incomingRoute.path === "/practice/game/songs"
      ) {
        staffGamePlayRoutePushedRef.current = false;
      }
      if (
        isStaffGameSongRoutePath(currentRoute.path) &&
        !isStaffGameSongRoutePath(incomingRoute.path)
      ) {
        staffGameSelectionRoutePushedRef.current = false;
      }
      if (
        (practiceRunningRef.current || practiceStageActiveRef.current) &&
        currentRoute.path === "/practice" &&
        (incomingRoute.path !== "/practice" ||
          incomingRoute.practiceTab !== currentRoute.practiceTab ||
          incomingRoute.practiceDistanceMode !== currentRoute.practiceDistanceMode ||
          incomingRoute.moduleTab !== currentRoute.moduleTab)
      ) {
        pendingRoutePathRef.current = null;
        practiceExitRequestIdRef.current += 1;
        setPracticeExitRequest({
          id: practiceExitRequestIdRef.current,
          returnToSetup: true,
          targetView: "practice",
        });
        practiceHistoryRestorePendingRef.current = true;
        window.history.forward();
        window.setTimeout(() => {
          practiceHistoryRestorePendingRef.current = false;
        }, 250);
        return;
      }
      if (currentRoute.page === "vocal" && incomingRoute.page !== "vocal") {
        pendingRoutePathRef.current = incomingRoute.path;
        vocalExitRequestIdRef.current += 1;
        setVocalExitRequest({
          id: vocalExitRequestIdRef.current,
          targetView: incomingRoute.page === "game" ? "practice" : incomingRoute.page,
        });
        window.history.pushState(
          window.history.state,
          "",
          appRouteUrl(currentRoute.path, appRouteQuery(currentRoute))
        );
        return;
      }
      const isLeavingPractice =
        currentRoute.page === "practice" && incomingRoute.page !== "practice";
      const isLeavingStaffGame = currentRoute.page === "game" && incomingRoute.page !== "game";
      if (
        (practiceRunningRef.current || practiceStageActiveRef.current) &&
        (isLeavingPractice || isLeavingStaffGame)
      ) {
        pendingRoutePathRef.current = incomingRoute.path;
        practiceExitRequestIdRef.current += 1;
        setPracticeExitRequest({
          id: practiceExitRequestIdRef.current,
          targetView: incomingRoute.page === "game" ? "practice" : incomingRoute.page,
        });
        window.history.pushState(
          window.history.state,
          "",
          appRouteUrl(currentRoute.path, appRouteQuery(currentRoute))
        );
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
    document.documentElement.dataset.appTheme = isNightMode ? "dark" : "light";
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = isNightMode ? "#171b19" : "#f6f1e8";
    }
  }, [isNightMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!skipPendingAnswerEventRetry) await retryPendingAnswerEvents();
      await recoverAbandonedSessions();
      const [settings, backupState] = await Promise.all([ensureSettings(), getBackupState()]);
      if (!cancelled)
        setData({
          settings,
          backupState,
          sessions: [],
          reviews: [],
          staffRecallRuns: [],
          practiceHistoryLoaded: false,
          staffRecallHistoryLoaded: false,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [skipPendingAnswerEventRetry]);

  const appDataAvailable = data !== null;
  const practiceHistoryLoaded = data?.practiceHistoryLoaded ?? false;
  const staffRecallHistoryLoaded = data?.staffRecallHistoryLoaded ?? false;

  useEffect(() => {
    if (!appDataAvailable) return undefined;
    const needsPracticeHistory =
      ((view === "practice" && !isStaffGameRoutePath(route.path)) ||
        view === "stats" ||
        (route.levelId !== undefined && moduleTab === "stats")) &&
      !practiceHistoryLoaded;
    const needsStaffRecallHistory = view === "study" && !staffRecallHistoryLoaded;
    if (!needsPracticeHistory && !needsStaffRecallHistory) return undefined;

    let cancelled = false;
    if (needsPracticeHistory) {
      setHistoryLoadErrors((current) => ({ ...current, practice: null }));
      void loadPracticeHistory()
        .then((history) => {
          if (!cancelled)
            setData((current) =>
              current ? { ...current, ...history, practiceHistoryLoaded: true } : current
            );
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : String(error);
            setHistoryLoadErrors((current) => ({ ...current, practice: message }));
            toast.error("练习记录加载失败", { description: message });
          }
        });
    }
    if (needsStaffRecallHistory) {
      setHistoryLoadErrors((current) => ({ ...current, staffRecall: null }));
      void loadStaffRecallHistory()
        .then((staffRecallRuns) => {
          if (!cancelled)
            setData((current) =>
              current ? { ...current, staffRecallRuns, staffRecallHistoryLoaded: true } : current
            );
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : String(error);
            setHistoryLoadErrors((current) => ({ ...current, staffRecall: message }));
            toast.error("学习记录加载失败", { description: message });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    appDataAvailable,
    historyLoadRetryToken,
    practiceHistoryLoaded,
    route.levelId,
    route.path,
    moduleTab,
    staffRecallHistoryLoaded,
    view,
  ]);

  useEffect(() => {
    if (!isPracticePageRoute) return undefined;

    let cancelled = false;
    void import("../audio/piano")
      .then(({ preloadPianoSamples }) => {
        if (!cancelled) void preloadPianoSamples();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isPracticePageRoute]);

  useEffect(() => {
    if (data) {
      setPianoVolume(data.settings.pianoVolume);
    }
  }, [data]);

  useEffect(() => {
    function onLocalPreferenceChange(event: Event): void {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (view === "settings" && key && LOCAL_PREFERENCE_FEEDBACK_KEYS.has(key)) {
        showConfigurationFeedback("设置已保存并生效");
      }
    }

    window.addEventListener(LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT, onLocalPreferenceChange);
    return () =>
      window.removeEventListener(LOCAL_STORAGE_PREFERENCE_CHANGE_EVENT, onLocalPreferenceChange);
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
      const nextRoute = appRouteFromHash(`#${nextPath}`);
      const isSameRoute =
        nextRoute.path === route.path &&
        nextRoute.songId === route.songId &&
        nextRoute.practiceTab === route.practiceTab &&
        nextRoute.practiceDistanceMode === route.practiceDistanceMode &&
        nextRoute.moduleTab === route.moduleTab &&
        nextRoute.playgroundStatsTab === route.playgroundStatsTab;
      if ((practiceRunning || practiceStageActive) && view === "practice" && !isSameRoute) {
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
    [
      navigateToRoute,
      practiceExitRequest,
      practiceRunning,
      practiceStageActive,
      route.path,
      route.practiceTab,
      route.practiceDistanceMode,
      route.moduleTab,
      route.playgroundStatsTab,
      route.songId,
      view,
    ]
  );

  const handleNavigationExit = useCallback(
    (targetView: PracticeNavigationExitTarget): void => {
      const returnToSetup = practiceExitRequest?.returnToSetup === true;
      setPracticeExitRequest(null);
      if (returnToSetup) {
        pendingRoutePathRef.current = null;
        return;
      }
      const path = pendingRoutePathRef.current ?? appRoutePathForPage(targetView);
      const replace = pendingRoutePathRef.current !== null;
      pendingRoutePathRef.current = null;
      navigateToRoute(path, { replace });
    },
    [navigateToRoute, practiceExitRequest]
  );

  const handleVocalNavigationExit = useCallback(
    (targetView: PracticeNavigationExitTarget): void => {
      setVocalExitRequest(null);
      const path = pendingRoutePathRef.current ?? appRoutePathForPage(targetView);
      const replace = pendingRoutePathRef.current !== null;
      pendingRoutePathRef.current = null;
      navigateToRoute(path, { replace });
    },
    [navigateToRoute]
  );

  const selectPracticeGameRoute = useCallback(
    (isGame: boolean): void => {
      navigateToRoute(isGame ? "/playground/challenge" : "/", { replace: !isGame });
    },
    [navigateToRoute]
  );

  const selectStaffGameMode = useCallback(
    (mode: "levels" | "songs"): void => {
      if (
        mode === "songs" &&
        routeRef.current.path === "/playground/songs/play" &&
        staffGamePlayRoutePushedRef.current
      ) {
        staffGamePlayRoutePushedRef.current = false;
        window.history.back();
        return;
      }
      const returningFromSongGame =
        mode === "songs" && routeRef.current.path === "/playground/songs/play";
      navigateToRoute(mode === "songs" ? "/playground/songs" : "/playground/challenge", {
        replace: returningFromSongGame,
      });
    },
    [navigateToRoute]
  );

  const selectStaffGameModeFromNavigation = useCallback(
    (mode: "levels" | "songs"): void => {
      const nextPath: AppRoutePath =
        mode === "songs" ? "/playground/songs" : "/playground/challenge";
      if (
        (practiceRunning || practiceStageActive) &&
        view === "practice" &&
        nextPath !== route.path
      ) {
        pendingRoutePathRef.current = nextPath;
        if (!practiceExitRequest) {
          practiceExitRequestIdRef.current += 1;
          setPracticeExitRequest({ id: practiceExitRequestIdRef.current, targetView: "practice" });
        }
        return;
      }
      if (view === "vocal" && nextPath !== route.path) {
        pendingRoutePathRef.current = nextPath;
        vocalExitRequestIdRef.current += 1;
        setVocalExitRequest({ id: vocalExitRequestIdRef.current, targetView: "practice" });
        return;
      }
      selectStaffGameMode(mode);
    },
    [
      practiceExitRequest,
      practiceRunning,
      practiceStageActive,
      route.path,
      selectStaffGameMode,
      view,
    ]
  );

  const startStaffGameSong = useCallback(
    (songId: string): void => {
      const isAlreadyOnSongPlayRoute = routeRef.current.path === "/playground/songs/play";
      navigateToRoute("/playground/songs/play", {
        query: { songId },
        replace: isAlreadyOnSongPlayRoute,
      });
      if (!isAlreadyOnSongPlayRoute) staffGamePlayRoutePushedRef.current = true;
    },
    [navigateToRoute]
  );

  const returnFromStaffGameSongSelection = useCallback((): void => {
    if (staffGameSelectionRoutePushedRef.current) {
      staffGameSelectionRoutePushedRef.current = false;
      window.history.back();
      return;
    }
    navigateToRoute(staffGameSelectionReturnPathRef.current, { replace: true });
  }, [navigateToRoute]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);

    if (import.meta.env.PROD) {
      void navigator.serviceWorker
        .register(new URL("service-worker.js", appBaseUrl).toString(), {
          scope: appBaseUrl.pathname,
        })
        .catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      )
      .then(() => ("caches" in window ? caches.keys() : []))
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("anki-note-") && key !== ENHANCED_PITCH_MODEL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .catch(() => undefined);
  }, []);

  const showIndexedDbMaintenance =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("debug") === "indexeddb";
  const showMobileBackButton =
    view !== "home" &&
    !(view === "practice" && isStaffGameRoutePath(route.path)) &&
    !practiceVirtualKeyboardActive &&
    (!practiceRunning || view === "practice");
  const mobileBackReturnsToSetup = view === "practice" && (practiceRunning || practiceStageActive);
  useLayoutEffect(() => {
    if (!showMobileBackButton || !mobileBackPosition) return;
    const button = mobileBackButtonRef.current;
    if (!button) return;
    const { width, height } = button.getBoundingClientRect();
    const maxLeft = Math.max(0, document.documentElement.clientWidth - width);
    const maxTop = Math.max(0, document.documentElement.clientHeight - height);
    setMobileBackPosition((position) => {
      if (!position) return position;
      const left = Math.min(maxLeft, Math.max(0, position.left));
      const top = Math.min(maxTop, Math.max(0, position.top));
      return left === position.left && top === position.top ? position : { left, top };
    });
  }, [mobileBackPosition, showMobileBackButton]);

  if (showIndexedDbMaintenance) {
    return <IndexedDbMaintenancePanel />;
  }

  if (!data) {
    return <AppStartupSkeleton />;
  }

  const backupReminderState = getBackupReminderState(data);
  const showBackupReminder =
    (backupReminderVisible && backupReminderState.showReminder) || backupReminderMessage !== null;
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
    isStaffGamePage ? "app-shell-game-immersive" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <PageAppearanceProvider isNightMode={isNightMode}>
      <Toaster
        closeButton
        position="top-center"
        richColors
        theme={isNightMode ? "dark" : "light"}
      />
      <div className={shellClassName}>
        <nav aria-label="主导航" className="app-nav">
          <button
            aria-label="首页"
            aria-current={route.page === "home" ? "page" : undefined}
            className={route.page === "home" ? "active" : ""}
            onClick={() => selectView("home")}
            type="button"
          >
            <House aria-hidden="true" size={18} />
            首页
          </button>
          <button
            aria-current={route.path.startsWith("/playground/") ? "page" : undefined}
            className={route.path.startsWith("/playground/") ? "active" : ""}
            onClick={() => selectStaffGameModeFromNavigation("levels")}
            type="button"
          >
            <Gamepad2 aria-hidden="true" size={18} />
            游乐场
          </button>
          <button
            aria-current={route.page === "metronome" ? "page" : undefined}
            className={route.page === "metronome" ? "active" : ""}
            onClick={() => selectView("metronome")}
            type="button"
          >
            <Timer aria-hidden="true" size={18} />
            节拍器
          </button>
          {/* 清唱导航入口暂时隐藏，后续需要时可以取消注释并恢复 AudioLines 导入。
          <button
            aria-current={view === "vocal" ? "page" : undefined}
            className={`app-nav-vocal${view === "vocal" ? " active" : ""}`}
            onClick={() => selectView("vocal")}
            type="button"
          >
            <AudioLines aria-hidden="true" size={18} />
            清唱
          </button>
          */}
          <button
            aria-current={route.page === "settings" ? "page" : undefined}
            className={route.page === "settings" ? "active" : ""}
            onClick={() => selectView("settings")}
            type="button"
          >
            <Settings aria-hidden="true" size={18} />
            设置
          </button>
        </nav>
        <main
          className={displayBackupReminder && view !== "vocal" ? "has-backup-reminder" : undefined}
        >
          {displayBackupReminder ? (
            <div
              aria-label={backupReminderTitle}
              className={[
                "backup-reminder",
                view === "vocal" ? "vocal-backup-reminder" : "",
                backupReminderMessage?.dangerous || backupReminderState.kind === "data-conflict"
                  ? "is-dangerous"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="region"
            >
              <div>
                <strong>{backupReminderTitle}</strong>
                <span>
                  {backupReminderMessage
                    ? backupReminderMessage.detail
                    : backupReminderState.kind === "data-conflict"
                      ? formatBackupConflictDetail()
                      : backupText.messages.browserOnlyNeedsDirectory}
                </span>
              </div>
              <div className="backup-reminder-actions">
                {backupReminderState.kind === "needs-directory" ? (
                  <button
                    className="primary"
                    disabled={backupReminderBusy}
                    onClick={() => void runBackupReminderAction("choose-directory")}
                  >
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
                <button
                  title={backupText.labels.close}
                  onClick={() => setBackupReminderVisible(false)}
                >
                  <X size={18} />
                  {backupText.labels.dismiss}
                </button>
              </div>
            </div>
          ) : null}
          <Suspense fallback={<RouteLoadingSkeleton />}>
            {view === "home" ? (
              <HomeView
                microphoneAlgorithm={practiceMicrophonePreferences.algorithm}
                onNavigate={navigateToRoute}
              />
            ) : null}
            {route.levelId && module ? (
              <ModuleLayout activeTab={moduleTab} module={module} onTabChange={selectModuleTab}>
                {moduleTab === "guide" ? <ModuleGuideView module={module} /> : null}
                {moduleTab === "practice" && route.levelId === 1 ? (
                  data.staffRecallHistoryLoaded ? (
                    <StudyView
                      onBeforeStaffRecallStart={preflightBeforeStaffRecallStart}
                      onDataChanged={refreshStaffRecallHistory}
                      onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
                      onStaffRecallFinished={showBackupReminderAfterActivity}
                      settings={data.settings}
                      staffRecallRuns={data.staffRecallRuns}
                    />
                  ) : (
                    <HistoryLoadingState
                      error={historyLoadErrors.staffRecall}
                      label="学习记录"
                      onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                    />
                  )
                ) : null}
                {moduleTab === "practice" && route.levelId > 1 ? (
                  data.practiceHistoryLoaded ? (
                    <PracticeFullscreenFrame enabled={practiceFullscreenAvailable}>
                      <PracticeView
                        midi={midi}
                        metronomeController={metronomeController}
                        practiceMicrophonePreferences={practiceMicrophonePreferences}
                        practicePagePreferences={practicePagePreferences}
                        settings={data.settings}
                        sessions={data.sessions}
                        reviews={data.reviews}
                        navigationExitRequest={practiceExitRequest}
                        practiceTab={route.practiceTab ?? "free"}
                        practiceDistanceMode={route.practiceDistanceMode}
                        showPracticeKindTabs={false}
                        onPracticeDistanceModeChange={(mode, replace = false) =>
                          navigateToRoute(route.path, {
                            query: { tab: "practice", distanceMode: mode },
                            replace,
                          })
                        }
                        onPracticeTabChange={() => undefined}
                        onDataChanged={refreshPracticeHistory}
                        onNavigationExit={handleNavigationExit}
                        onOpenStats={() => selectModuleTab("stats")}
                        onBeforePracticeStart={preflightBeforePracticeStart}
                        onPracticeFinished={showBackupReminderAfterActivity}
                        onRunningChange={setPracticeRunning}
                        onPracticeStageChange={setPracticeStageActive}
                        onFullscreenAvailabilityChange={setPracticeFullscreenAvailable}
                        onVirtualKeyboardActiveChange={setPracticeVirtualKeyboardActive}
                        onInputModeChange={handlePracticeInputModeChange}
                        onMetronomeSyncToggleChange={registerPracticeMetronomeSyncToggle}
                        onMetronomeSyncPauseChange={registerPracticeMetronomeSyncPause}
                        onSettingsSaved={(settings, options) =>
                          saveSettings(settings, { ...options, feedback: false })
                        }
                      />
                      {practiceInputModeState?.routeKey === practiceInputRouteKey &&
                      practiceInputModeState.mode !== "microphone" ? (
                        <MetronomeFloating
                          controller={metronomeController}
                          hiddenForVisit={practiceMetronomeHiddenForVisit}
                          activePractice={practiceRunning}
                          onHideForVisit={() => setPracticeMetronomeHiddenForVisit(true)}
                          onSyncPauseToggle={toggleSynchronizedPractice}
                        />
                      ) : null}
                    </PracticeFullscreenFrame>
                  ) : (
                    <HistoryLoadingState
                      error={historyLoadErrors.practice}
                      label="练习记录"
                      onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                    />
                  )
                ) : null}
                {moduleTab === "stats" ? (
                  data.practiceHistoryLoaded ? (
                    <StatsView
                      settings={data.settings}
                      reviews={data.reviews}
                      sessions={data.sessions}
                      onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
                    />
                  ) : (
                    <HistoryLoadingState
                      error={historyLoadErrors.practice}
                      label="统计记录"
                      onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                    />
                  )
                ) : null}
              </ModuleLayout>
            ) : null}
            {!route.levelId && view === "practice" && !isStaffGameRoutePath(route.path) ? (
              data.practiceHistoryLoaded ? (
                <PracticeFullscreenFrame enabled={practiceFullscreenAvailable}>
                  <PracticeView
                    midi={midi}
                    metronomeController={metronomeController}
                    practiceMicrophonePreferences={practiceMicrophonePreferences}
                    practicePagePreferences={practicePagePreferences}
                    settings={data.settings}
                    sessions={data.practiceHistoryLoaded ? data.sessions : []}
                    reviews={data.practiceHistoryLoaded ? data.reviews : []}
                    navigationExitRequest={practiceExitRequest}
                    practiceTab={route.practiceTab ?? "free"}
                    practiceDistanceMode={route.practiceDistanceMode}
                    onPracticeDistanceModeChange={(mode, replace = false) =>
                      navigateToRoute("/practice", {
                        query: { tab: "distance", distanceMode: mode },
                        replace,
                      })
                    }
                    onPracticeTabChange={(tab) => navigateToRoute("/practice", { query: { tab } })}
                    onDataChanged={refreshPracticeHistory}
                    onNavigationExit={handleNavigationExit}
                    onOpenStats={() => selectView("stats")}
                    onBeforePracticeStart={preflightBeforePracticeStart}
                    onPracticeFinished={showBackupReminderAfterActivity}
                    onRunningChange={setPracticeRunning}
                    onPracticeStageChange={setPracticeStageActive}
                    onFullscreenAvailabilityChange={setPracticeFullscreenAvailable}
                    onVirtualKeyboardActiveChange={setPracticeVirtualKeyboardActive}
                    onInputModeChange={handlePracticeInputModeChange}
                    onMetronomeSyncToggleChange={registerPracticeMetronomeSyncToggle}
                    onMetronomeSyncPauseChange={registerPracticeMetronomeSyncPause}
                    onSettingsSaved={(settings, options) =>
                      saveSettings(settings, { ...options, feedback: false })
                    }
                  />
                  {route.path === "/practice" &&
                  practiceInputModeState?.routeKey === practiceInputRouteKey &&
                  practiceInputModeState.mode !== "microphone" ? (
                    <MetronomeFloating
                      controller={metronomeController}
                      hiddenForVisit={practiceMetronomeHiddenForVisit}
                      activePractice={practiceRunning}
                      onHideForVisit={() => setPracticeMetronomeHiddenForVisit(true)}
                      onSyncPauseToggle={toggleSynchronizedPractice}
                    />
                  ) : null}
                </PracticeFullscreenFrame>
              ) : (
                <HistoryLoadingState
                  error={historyLoadErrors.practice}
                  label="练习记录"
                  onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                />
              )
            ) : null}
            {isStaffGamePage ? (
              <StaffGameRoute
                midi={midi}
                microphonePreferences={practiceMicrophonePreferences}
                initialMode={isStaffGameSongRoutePath(route.path) ? "songs" : "levels"}
                initialSongSelectionStep={
                  route.path === "/practice/game/songs/play" ? "detail" : "list"
                }
                initialSongId={route.songId}
                isSongPlayRoute={route.path === "/practice/game/songs/play"}
                onModeChange={selectStaffGameMode}
                onSongStart={startStaffGameSong}
                onSongSelectionExit={returnFromStaffGameSongSelection}
                onExit={() => selectPracticeGameRoute(false)}
                onRunningChange={setPracticeRunning}
                navigationExitRequest={practiceExitRequest}
                onNavigationExit={handleNavigationExit}
              />
            ) : null}
            {!route.levelId && view === "stats" ? (
              data.practiceHistoryLoaded ? (
                <StatsView
                  settings={data.settings}
                  reviews={data.reviews}
                  sessions={data.sessions}
                  onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
                />
              ) : (
                <HistoryLoadingState
                  error={historyLoadErrors.practice}
                  label="统计记录"
                  onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                />
              )
            ) : null}
            {!route.levelId && view === "study" ? (
              data.staffRecallHistoryLoaded ? (
                <StudyView
                  onBeforeStaffRecallStart={preflightBeforeStaffRecallStart}
                  onDataChanged={refreshStaffRecallHistory}
                  onSettingsSaved={(settings) => saveSettings(settings, { feedback: false })}
                  onStaffRecallFinished={showBackupReminderAfterActivity}
                  settings={data.settings}
                  staffRecallRuns={data.staffRecallRuns}
                />
              ) : (
                <HistoryLoadingState
                  error={historyLoadErrors.staffRecall}
                  label="学习记录"
                  onRetry={() => setHistoryLoadRetryToken((current) => current + 1)}
                />
              )
            ) : null}
            {view === "settings" ? (
              <SettingsView
                appUpdateStatus={appUpdateController.status}
                appUpdateMessage={appUpdateController.message}
                hasUpdateAvailable={appUpdateController.hasUpdateAvailable}
                hasPreparedUpdate={appUpdateController.hasPreparedUpdate}
                backupState={data.backupState}
                pageAppearancePreferences={pageAppearancePreferences}
                practiceMicrophonePreferences={practiceMicrophonePreferences}
                practicePagePreferences={practicePagePreferences}
                settings={data.settings}
                midi={midi}
                onCheckForUpdates={appUpdateController.checkForUpdates}
                onApplyUpdate={appUpdateController.applyUpdate}
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
          </Suspense>
          {isHomeMetronomeOpen && view === "home" ? (
            <MetronomeDialog controller={metronomeController} onClose={closeHomeMetronome} />
          ) : null}
        </main>
        {showMobileBackButton ? (
          <button
            aria-label={`${mobileBackReturnsToSetup ? "返回练习配置" : "返回首页"}，可拖动调整位置`}
            className="mobile-route-back"
            onClick={() => {
              if (ignoreMobileBackClickRef.current) {
                ignoreMobileBackClickRef.current = false;
                return;
              }
              if (mobileBackReturnsToSetup) {
                if (!practiceExitRequest?.returnToSetup) {
                  practiceExitRequestIdRef.current += 1;
                  setPracticeExitRequest({
                    id: practiceExitRequestIdRef.current,
                    returnToSetup: true,
                    targetView: "practice",
                  });
                }
                return;
              }
              selectView("home");
            }}
            onPointerCancel={(event) => finishMobileBackDrag(event, false)}
            onPointerDown={handleMobileBackPointerDown}
            onPointerMove={handleMobileBackPointerMove}
            onPointerUp={(event) => finishMobileBackDrag(event, true)}
            ref={mobileBackButtonRef}
            style={
              mobileBackPosition
                ? {
                    left: mobileBackPosition.left,
                    top: mobileBackPosition.top,
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
            title={`拖动调整位置，点击${mobileBackReturnsToSetup ? "返回练习配置" : "返回首页"}`}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={19} />
            <GripVertical aria-hidden="true" size={16} />
            {mobileBackReturnsToSetup ? "配置" : "返回"}
          </button>
        ) : null}
        {MIDI_LATENCY_DIAGNOSTICS_ENABLED ? (
          <MidiLatencyDiagnosticsPanel correctDelayMs={data.settings.correctDelayMs} />
        ) : null}
      </div>
    </PageAppearanceProvider>
  );
}
