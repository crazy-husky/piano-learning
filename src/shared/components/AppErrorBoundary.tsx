import {
  Component,
  createRef,
  type CSSProperties,
  type ErrorInfo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Bug } from "lucide-react";
import { formatDateTime } from "../formatDateTime";
import { APP_DIAGNOSTIC_EVENT, type AppDiagnosticSource } from "../diagnostics/appDiagnostics";
import {
  clearGlobalDebugEvents,
  getGlobalDebugEvents,
  GLOBAL_DEBUG_ENABLED_KEY,
  GLOBAL_DEBUG_ENTRY_EVENT,
  GLOBAL_DEBUG_MODE_CHANGE_EVENT,
  isGlobalDebugEnabled,
} from "../diagnostics/globalDebug";
import { LOCAL_STORAGE_PREFERENCES_RESET_EVENT } from "../../storage/localPreferenceEvents";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  fatalErrorDetails: string | null;
  globalErrors: GlobalErrorRecord[];
  resourceRetryStatuses: Record<string, ResourceRetryStatus>;
  copyStatus: string;
  globalErrorNoticeVisible: boolean;
  globalErrorNoticeSecondsRemaining: number;
  errorDetailsOpen: boolean;
  globalDebugEnabled: boolean;
  globalDebugDialogOpen: boolean;
  globalDebugEventCount: number;
  globalErrorBadgePosition: FloatingBadgePosition | null;
  globalDebugBadgePosition: FloatingBadgePosition | null;
}

interface ResourceRetryStatus {
  kind: "asset" | "page-reload";
  phase: "retrying" | "offline" | "failed";
  retry: number;
  maxRetries: number;
}

type GlobalErrorSource =
  "window.error" | "unhandledrejection" | "resource-load-error" | AppDiagnosticSource;

interface GlobalErrorRecord {
  source: GlobalErrorSource;
  details: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
}

interface NavigatorWithDiagnostics extends Navigator {
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  deviceMemory?: number;
  standalone?: boolean;
}

interface FloatingBadgePosition {
  x: number;
  y: number;
}

type FloatingBadgeKind = "error" | "debug";

interface ActiveBadgeDrag {
  kind: FloatingBadgeKind;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
  lastPosition: FloatingBadgePosition | null;
}

type NavigatorWithFileShare = Pick<Navigator, "maxTouchPoints"> & {
  canShare?: (data: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

const MAX_GLOBAL_ERROR_RECORDS = 20;
const GLOBAL_ERROR_DEDUPE_WINDOW_MS = 30_000;
const MAX_GLOBAL_ERROR_DETAILS_LENGTH = 12_000;
const GLOBAL_ERROR_NOTICE_DURATION_SECONDS = 10;
const FLOATING_BADGE_POSITION_STORAGE_KEYS: Record<FloatingBadgeKind, string> = {
  error: "anki-note.globalErrorBadgePosition",
  debug: "anki-note.globalDebugBadgePosition",
};
const FLOATING_BADGE_DRAG_THRESHOLD_PX = 6;
const MODULE_LOAD_RETRY_SESSION_KEY = `app-module-load-retry:${__APP_BUILD_ID__}`;
const OFFLINE_MODULE_LOAD_RETRY_SESSION_KEY = `app-offline-module-load-retry:${__APP_BUILD_ID__}`;
const MODULE_LOAD_FAILURE_PATTERN =
  /importing a module script failed|failed to fetch dynamically imported module|unable to preload (?:css|module)|loading chunk .* failed/i;

function readFloatingBadgePosition(kind: FloatingBadgeKind): FloatingBadgePosition | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(FLOATING_BADGE_POSITION_STORAGE_KEYS[kind]) ?? "null"
    ) as { x?: unknown; y?: unknown } | null;
    if (
      !value ||
      typeof value.x !== "number" ||
      !Number.isFinite(value.x) ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.y)
    ) {
      return null;
    }
    return { x: Math.min(1, Math.max(0, value.x)), y: Math.min(1, Math.max(0, value.y)) };
  } catch {
    return null;
  }
}

function writeFloatingBadgePosition(
  kind: FloatingBadgeKind,
  position: FloatingBadgePosition
): void {
  try {
    window.localStorage.setItem(
      FLOATING_BADGE_POSITION_STORAGE_KEYS[kind],
      JSON.stringify(position)
    );
  } catch {
    // Keeping the latest position in memory is enough when storage is unavailable.
  }
}

function getAppCodeAssetPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value, window.location.href);
    if (
      url.origin !== window.location.origin ||
      !/\/assets\/[^/]+\.(?:js|css)$/i.test(url.pathname)
    ) {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  if (typeof error === "string") return `Message: ${error}`;
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
    const name = typeof value.name === "string" ? value.name : "Error";
    const message =
      typeof value.message === "string" && value.message.length > 0
        ? value.message
        : "(message unavailable)";
    const stack =
      typeof value.stack === "string" && value.stack.length > 0
        ? value.stack
        : "(stack unavailable)";
    const details = [`Name: ${name}`, `Message: ${message}`, `Stack:\n${stack}`];
    if (value.cause && value.cause !== error) details.push(`Cause:\n${describeError(value.cause)}`);
    return details.join("\n");
  }
  try {
    return `Thrown value: ${JSON.stringify(error, null, 2) ?? String(error)}`;
  } catch {
    return `Thrown value: ${String(error)}`;
  }
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    fatalErrorDetails: null,
    globalErrors: [],
    resourceRetryStatuses: {},
    copyStatus: "",
    globalErrorNoticeVisible: false,
    globalErrorNoticeSecondsRemaining: 0,
    errorDetailsOpen: false,
    globalDebugEnabled: isGlobalDebugEnabled(),
    globalDebugDialogOpen: false,
    globalDebugEventCount: getGlobalDebugEvents().length,
    globalErrorBadgePosition: null,
    globalDebugBadgePosition: null,
  };
  private errorBadgeRef = createRef<HTMLDivElement>();
  private globalDebugBadgeRef = createRef<HTMLDivElement>();
  private activeBadgeDrag: ActiveBadgeDrag | null = null;
  private suppressNextBadgeClick: FloatingBadgeKind | null = null;
  private suppressBadgeClickTimeout: number | null = null;
  private copyStatusTimeout: number | null = null;
  private globalErrorNoticeInterval: number | null = null;
  private globalDebugCountUpdateTimeout: number | null = null;
  private moduleReloadScheduled = false;
  private moduleReloadTimer: number | null = null;
  private networkIsOffline = typeof navigator !== "undefined" && !navigator.onLine;
  private offlineResourceRecoveryPending = false;

  componentDidMount(): void {
    this.networkIsOffline = !navigator.onLine;
    this.setState({
      globalErrorBadgePosition: readFloatingBadgePosition("error"),
      globalDebugBadgePosition: readFloatingBadgePosition("debug"),
    });
    window.addEventListener("resize", this.handleBadgeViewportResize);
    window.addEventListener("error", this.handleWindowError, true);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.addEventListener("vite:preloadError", this.handleVitePreloadError);
    window.addEventListener("offline", this.handleBrowserOffline);
    window.addEventListener("online", this.handleBrowserOnline);
    window.addEventListener(APP_DIAGNOSTIC_EVENT, this.handleAppDiagnostic);
    window.addEventListener(GLOBAL_DEBUG_MODE_CHANGE_EVENT, this.handleGlobalDebugModeChange);
    window.addEventListener(GLOBAL_DEBUG_ENTRY_EVENT, this.handleGlobalDebugEntriesChange);
    window.addEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, this.handlePreferencesReset);
    window.addEventListener("storage", this.handleStorageChange);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", this.handleServiceWorkerMessage);
    }
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError, true);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.removeEventListener("vite:preloadError", this.handleVitePreloadError);
    window.removeEventListener("offline", this.handleBrowserOffline);
    window.removeEventListener("online", this.handleBrowserOnline);
    window.removeEventListener(APP_DIAGNOSTIC_EVENT, this.handleAppDiagnostic);
    window.removeEventListener(GLOBAL_DEBUG_MODE_CHANGE_EVENT, this.handleGlobalDebugModeChange);
    window.removeEventListener(GLOBAL_DEBUG_ENTRY_EVENT, this.handleGlobalDebugEntriesChange);
    window.removeEventListener(LOCAL_STORAGE_PREFERENCES_RESET_EVENT, this.handlePreferencesReset);
    window.removeEventListener("storage", this.handleStorageChange);
    window.removeEventListener("resize", this.handleBadgeViewportResize);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("message", this.handleServiceWorkerMessage);
    }
    if (this.copyStatusTimeout !== null) window.clearTimeout(this.copyStatusTimeout);
    if (this.suppressBadgeClickTimeout !== null) {
      window.clearTimeout(this.suppressBadgeClickTimeout);
    }
    if (this.globalDebugCountUpdateTimeout !== null) {
      window.clearTimeout(this.globalDebugCountUpdateTimeout);
    }
    this.clearGlobalErrorNoticeInterval();
    if (this.moduleReloadTimer !== null) window.clearTimeout(this.moduleReloadTimer);
  }

  private getBadgeElement(kind: FloatingBadgeKind): HTMLDivElement | null {
    return kind === "error" ? this.errorBadgeRef.current : this.globalDebugBadgeRef.current;
  }

  private getBadgePosition(kind: FloatingBadgeKind): FloatingBadgePosition | null {
    return kind === "error"
      ? this.state.globalErrorBadgePosition
      : this.state.globalDebugBadgePosition;
  }

  private getBadgePositionStyle(kind: FloatingBadgeKind): CSSProperties | undefined {
    const position = this.getBadgePosition(kind);
    if (!position) return undefined;

    const rect = this.getBadgeElement(kind)?.getBoundingClientRect();
    const width = rect?.width ?? (kind === "error" ? 140 : 42);
    const height = rect?.height ?? 42;
    const maxLeft = Math.max(0, window.innerWidth - width - 16);
    const maxTop = Math.max(0, window.innerHeight - height - 16);
    return {
      bottom: "auto",
      left: `${8 + position.x * maxLeft}px`,
      right: "auto",
      top: `${8 + position.y * maxTop}px`,
    };
  }

  private setBadgePosition(kind: FloatingBadgeKind, position: FloatingBadgePosition): void {
    if (kind === "error") this.setState({ globalErrorBadgePosition: position });
    else this.setState({ globalDebugBadgePosition: position });
  }

  private handleBadgePointerDown = (
    kind: FloatingBadgeKind,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void => {
    if (event.button !== 0) return;
    const badge = this.getBadgeElement(kind);
    if (!badge) return;
    const rect = badge.getBoundingClientRect();
    this.activeBadgeDrag = {
      kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
      lastPosition: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the control still works with normal pointer events.
    }
  };

  private handleBadgePointerMove = (
    kind: FloatingBadgeKind,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void => {
    const drag = this.activeBadgeDrag;
    if (!drag || drag.kind !== kind || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < FLOATING_BADGE_DRAG_THRESHOLD_PX) return;

    drag.moved = true;
    event.preventDefault();
    const rect = this.getBadgeElement(kind)?.getBoundingClientRect();
    const width = rect?.width ?? (kind === "error" ? 140 : 42);
    const height = rect?.height ?? 42;
    const maxLeft = Math.max(0, window.innerWidth - width - 16);
    const maxTop = Math.max(0, window.innerHeight - height - 16);
    const left = Math.min(maxLeft + 8, Math.max(8, drag.startLeft + deltaX));
    const top = Math.min(maxTop + 8, Math.max(8, drag.startTop + deltaY));
    const position = {
      x: maxLeft > 0 ? (left - 8) / maxLeft : 0,
      y: maxTop > 0 ? (top - 8) / maxTop : 0,
    };
    drag.lastPosition = position;
    this.setBadgePosition(kind, position);
  };

  private finishBadgeDrag = (
    kind: FloatingBadgeKind,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void => {
    const drag = this.activeBadgeDrag;
    if (!drag || drag.kind !== kind || drag.pointerId !== event.pointerId) return;
    this.activeBadgeDrag = null;
    if (drag.moved && drag.lastPosition) {
      writeFloatingBadgePosition(kind, drag.lastPosition);
      this.suppressNextBadgeClick = kind;
      if (this.suppressBadgeClickTimeout !== null) {
        window.clearTimeout(this.suppressBadgeClickTimeout);
      }
      this.suppressBadgeClickTimeout = window.setTimeout(() => {
        if (this.suppressNextBadgeClick === kind) this.suppressNextBadgeClick = null;
        this.suppressBadgeClickTimeout = null;
      }, 0);
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
  };

  private consumeSuppressedBadgeClick(kind: FloatingBadgeKind): boolean {
    if (this.suppressNextBadgeClick !== kind) return false;
    this.suppressNextBadgeClick = null;
    if (this.suppressBadgeClickTimeout !== null) {
      window.clearTimeout(this.suppressBadgeClickTimeout);
      this.suppressBadgeClickTimeout = null;
    }
    return true;
  }

  private handleBadgeViewportResize = (): void => {
    this.forceUpdate();
  };

  componentDidUpdate(
    _previousProps: AppErrorBoundaryProps,
    previousState: AppErrorBoundaryState
  ): void {
    if (!previousState.fatalErrorDetails && this.state.fatalErrorDetails) {
      this.clearGlobalErrorNoticeInterval();
      if (this.state.globalErrorNoticeVisible) {
        this.setState({ globalErrorNoticeVisible: false, globalErrorNoticeSecondsRemaining: 0 });
      }
    }
  }

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { fatalErrorDetails: describeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const errorDetails = describeError(error);
    this.setState({
      fatalErrorDetails: `${errorDetails}\n\nReact component stack:${info.componentStack || " (unavailable)"}`,
    });

    if (MODULE_LOAD_FAILURE_PATTERN.test(errorDetails)) this.retryModuleLoadOnce();
  }

  private handleGlobalDebugModeChange = (event: Event): void => {
    const enabled = (event as CustomEvent<{ enabled?: unknown }>).detail?.enabled;
    const nextEnabled = typeof enabled === "boolean" ? enabled : isGlobalDebugEnabled();
    if (!nextEnabled) clearGlobalDebugEvents();
    this.setState({
      globalDebugEnabled: nextEnabled,
      globalDebugEventCount: getGlobalDebugEvents().length,
      globalDebugDialogOpen: nextEnabled ? this.state.globalDebugDialogOpen : false,
    });
  };

  private handleGlobalDebugEntriesChange = (): void => {
    if (this.globalDebugCountUpdateTimeout !== null) return;
    this.globalDebugCountUpdateTimeout = window.setTimeout(() => {
      this.globalDebugCountUpdateTimeout = null;
      this.setState({ globalDebugEventCount: getGlobalDebugEvents().length });
    }, 250);
  };

  private handlePreferencesReset = (): void => {
    clearGlobalDebugEvents();
    if (this.globalDebugCountUpdateTimeout !== null) {
      window.clearTimeout(this.globalDebugCountUpdateTimeout);
      this.globalDebugCountUpdateTimeout = null;
    }
    this.setState({
      globalDebugEnabled: false,
      globalDebugDialogOpen: false,
      globalDebugEventCount: 0,
    });
  };

  private handleStorageChange = (event: StorageEvent): void => {
    if (event.key !== GLOBAL_DEBUG_ENABLED_KEY && event.key !== null) return;
    const enabled = isGlobalDebugEnabled();
    if (!enabled) clearGlobalDebugEvents();
    this.setState({
      globalDebugEnabled: enabled,
      globalDebugDialogOpen: enabled ? this.state.globalDebugDialogOpen : false,
      globalDebugEventCount: getGlobalDebugEvents().length,
    });
  };

  private captureGlobalError = (
    source: GlobalErrorSource,
    details: string,
    showNotice = true
  ): void => {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const boundedDetails =
      details.length > MAX_GLOBAL_ERROR_DETAILS_LENGTH
        ? `${details.slice(0, MAX_GLOBAL_ERROR_DETAILS_LENGTH)}\n… (error details truncated)`
        : details;

    this.setState((current) => {
      const duplicateIndex = current.globalErrors.findIndex(
        (record) =>
          record.source === source &&
          record.details === boundedDetails &&
          now - Date.parse(record.lastSeenAt) <=
            (source === "app-update" ? 5 * 60_000 : GLOBAL_ERROR_DEDUPE_WINDOW_MS)
      );

      let globalErrors: GlobalErrorRecord[];
      if (duplicateIndex >= 0) {
        globalErrors = current.globalErrors.map((record, index) =>
          index === duplicateIndex
            ? { ...record, lastSeenAt: timestamp, count: record.count + 1 }
            : record
        );
      } else {
        globalErrors = [
          ...current.globalErrors,
          {
            source,
            details: boundedDetails,
            firstSeenAt: timestamp,
            lastSeenAt: timestamp,
            count: 1,
          },
        ].slice(-MAX_GLOBAL_ERROR_RECORDS);
      }

      return { globalErrors };
    });
    if (showNotice && !this.state.fatalErrorDetails) this.showGlobalErrorNotice();
  };

  private clearGlobalErrorNoticeInterval = (): void => {
    if (this.globalErrorNoticeInterval === null) return;
    window.clearInterval(this.globalErrorNoticeInterval);
    this.globalErrorNoticeInterval = null;
  };

  private showGlobalErrorNotice = (): void => {
    this.clearGlobalErrorNoticeInterval();
    this.setState({
      globalErrorNoticeVisible: true,
      globalErrorNoticeSecondsRemaining: GLOBAL_ERROR_NOTICE_DURATION_SECONDS,
    });

    let elapsedSeconds = 0;
    this.globalErrorNoticeInterval = window.setInterval(() => {
      elapsedSeconds += 1;
      const secondsRemaining = Math.max(0, GLOBAL_ERROR_NOTICE_DURATION_SECONDS - elapsedSeconds);
      this.setState({
        globalErrorNoticeSecondsRemaining: secondsRemaining,
        globalErrorNoticeVisible: secondsRemaining > 0,
      });
      if (secondsRemaining === 0) this.clearGlobalErrorNoticeInterval();
    }, 1_000);
  };

  private dismissGlobalErrorNotice = (): void => {
    this.clearGlobalErrorNoticeInterval();
    this.setState({ globalErrorNoticeVisible: false, globalErrorNoticeSecondsRemaining: 0 });
  };

  private refreshPage = (clearRetryGuard = true): void => {
    try {
      if (clearRetryGuard) {
        window.sessionStorage.removeItem(MODULE_LOAD_RETRY_SESSION_KEY);
        window.sessionStorage.removeItem(OFFLINE_MODULE_LOAD_RETRY_SESSION_KEY);
      }
    } catch {
      // Storage may be unavailable in private browsing; the page can still navigate.
    }

    // A cache-busting document navigation avoids racing Service Worker updates with reloads
    // in iOS browsers. App.tsx removes this temporary query once the app has booted.
    const refreshUrl = new URL(window.location.href);
    refreshUrl.searchParams.set("__app_refresh", String(Date.now()));
    window.location.replace(refreshUrl.toString());
  };

  private handleBrowserOffline = (): void => {
    this.networkIsOffline = true;
    const hasRetryInProgress = Object.values(this.state.resourceRetryStatuses).some(
      (status) => status.kind === "asset" && status.phase === "retrying"
    );
    const hasFailedResource = Object.values(this.state.resourceRetryStatuses).some(
      (status) => status.phase === "failed"
    );
    if (hasRetryInProgress || hasFailedResource) {
      this.offlineResourceRecoveryPending = true;
    }
    if (hasFailedResource) {
      this.setState((current) => ({
        resourceRetryStatuses: Object.fromEntries(
          Object.entries(current.resourceRetryStatuses).map(([key, status]) => [
            key,
            status.phase === "failed" ? { ...status, phase: "offline" as const } : status,
          ])
        ),
      }));
    }
  };

  private handleBrowserOnline = (): void => {
    this.networkIsOffline = false;
    if (!this.offlineResourceRecoveryPending) return;
    const retryStillRunning = Object.values(this.state.resourceRetryStatuses).some(
      (status) => status.kind === "asset" && status.phase === "retrying"
    );
    if (!retryStillRunning) this.scheduleOfflineResourceRetry();
  };

  private showOfflineResourceStatus = (
    phase: "offline" | "failed",
    fallbackKind: ResourceRetryStatus["kind"] = "asset"
  ): void => {
    this.offlineResourceRecoveryPending = phase === "offline";
    this.setState((current) => {
      const resourceRetryStatuses = Object.fromEntries(
        Object.entries(current.resourceRetryStatuses).map(([key, status]) => [
          key,
          { ...status, phase },
        ])
      );
      if (Object.keys(resourceRetryStatuses).length === 0) {
        resourceRetryStatuses["module-load"] = {
          kind: fallbackKind,
          phase,
          retry: 0,
          maxRetries: fallbackKind === "page-reload" ? 1 : 3,
        };
      }
      return {
        resourceRetryStatuses,
      };
    });
  };

  private scheduleOfflineResourceRetry = (): void => {
    if (!this.offlineResourceRecoveryPending || this.moduleReloadScheduled || !navigator.onLine) {
      return;
    }
    this.offlineResourceRecoveryPending = false;
    this.retryModuleLoadOnce(true);
  };

  private retryModuleLoadOnce = (allowControlledReload = false): void => {
    if (
      !allowControlledReload &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller
    ) {
      return;
    }
    if (this.moduleReloadScheduled) return;

    if (!navigator.onLine) {
      this.networkIsOffline = true;
      this.showOfflineResourceStatus("offline", "page-reload");
      return;
    }
    this.networkIsOffline = false;

    const retrySessionKey = allowControlledReload
      ? OFFLINE_MODULE_LOAD_RETRY_SESSION_KEY
      : MODULE_LOAD_RETRY_SESSION_KEY;
    try {
      if (window.sessionStorage.getItem(retrySessionKey) === "1") {
        this.setState((current) => ({
          resourceRetryStatuses: {
            ...current.resourceRetryStatuses,
            "module-load": { kind: "page-reload", phase: "failed", retry: 1, maxRetries: 1 },
          },
        }));
        return;
      }
      window.sessionStorage.setItem(retrySessionKey, "1");
    } catch {
      // Do not auto-retry when the guard cannot be persisted; that could cause a reload loop.
      this.setState((current) => ({
        resourceRetryStatuses: {
          ...current.resourceRetryStatuses,
          "module-load": { kind: "page-reload", phase: "failed", retry: 1, maxRetries: 1 },
        },
      }));
      return;
    }

    this.moduleReloadScheduled = true;
    this.setState((current) => ({
      resourceRetryStatuses: {
        ...current.resourceRetryStatuses,
        "module-load": { kind: "page-reload", phase: "retrying", retry: 1, maxRetries: 1 },
      },
    }));
    this.moduleReloadTimer = window.setTimeout(() => {
      this.moduleReloadTimer = null;
      if (!navigator.onLine) {
        this.moduleReloadScheduled = false;
        this.offlineResourceRecoveryPending = true;
        try {
          window.sessionStorage.removeItem(retrySessionKey);
        } catch {
          // The waiting notice remains useful when session storage is unavailable.
        }
        this.showOfflineResourceStatus("offline", "page-reload");
        return;
      }
      this.refreshPage(false);
    }, 650);
  };

  private hasModuleLoadRetryBeenUsed = (): boolean => {
    try {
      return (
        window.sessionStorage.getItem(MODULE_LOAD_RETRY_SESSION_KEY) === "1" ||
        window.sessionStorage.getItem(OFFLINE_MODULE_LOAD_RETRY_SESSION_KEY) === "1"
      );
    } catch {
      // Auto-retry is disabled when its loop guard cannot be read reliably.
      return true;
    }
  };

  private handleWindowError = (event: Event): void => {
    if (!(event instanceof ErrorEvent)) {
      const target = event.target;
      // Only record failures for app code chunks; image and font failures are recoverable.
      const resourceUrl =
        target instanceof HTMLScriptElement
          ? target.src
          : target instanceof HTMLLinkElement
            ? target.href
            : "";
      const assetPath = getAppCodeAssetPath(resourceUrl);
      if (!assetPath) return;
      const failedElement = `app asset ${assetPath}`;
      this.captureGlobalError("resource-load-error", `Failed element: ${failedElement}`, false);
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        if (!navigator.onLine || this.networkIsOffline) {
          this.showOfflineResourceStatus("offline", "asset");
        } else {
          this.setState((current) => ({
            resourceRetryStatuses: {
              ...current.resourceRetryStatuses,
              [assetPath]: { kind: "asset", phase: "failed", retry: 0, maxRetries: 0 },
            },
          }));
        }
      } else {
        this.retryModuleLoadOnce();
      }
      return;
    }
    const location = event.filename
      ? `Location: ${event.filename}:${event.lineno}:${event.colno}`
      : "Location: (unavailable)";
    this.captureGlobalError(
      "window.error",
      [
        `Browser message: ${event.message || "(message unavailable)"}`,
        location,
        event.error ? describeError(event.error) : "Error object: (unavailable)",
      ].join("\n")
    );
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    this.captureGlobalError("unhandledrejection", `Reason: ${describeError(event.reason)}`);
  };

  private handleVitePreloadError = (event: VitePreloadErrorEvent): void => {
    this.captureGlobalError(
      "resource-load-error",
      `Vite module preload error:\n${describeError(event.payload)}`,
      false
    );
    this.retryModuleLoadOnce();
  };

  private handleAppDiagnostic = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== "object") return;
    const diagnostic = detail as { source?: unknown; details?: unknown; notify?: unknown };
    if (
      (diagnostic.source !== "app-update" &&
        diagnostic.source !== "service-worker-update" &&
        diagnostic.source !== "backend") ||
      typeof diagnostic.details !== "string"
    )
      return;

    this.captureGlobalError(diagnostic.source, diagnostic.details, diagnostic.notify !== false);
  };

  private handleServiceWorkerMessage = (event: MessageEvent<unknown>): void => {
    if (!event.data || typeof event.data !== "object") return;
    const message = event.data as {
      type?: unknown;
      details?: unknown;
      assetUrl?: unknown;
      retry?: unknown;
      maxRetries?: unknown;
      attempts?: unknown;
      offline?: unknown;
      reason?: unknown;
    };
    const assetPath = getAppCodeAssetPath(message.assetUrl);
    if (assetPath && message.type === "app-runtime-asset-retrying") {
      const retry = typeof message.retry === "number" ? message.retry : 1;
      const maxRetries = typeof message.maxRetries === "number" ? message.maxRetries : 3;
      if (!navigator.onLine || this.networkIsOffline) {
        this.offlineResourceRecoveryPending = true;
      }
      this.setState((current) => ({
        resourceRetryStatuses: {
          ...current.resourceRetryStatuses,
          [assetPath]: { kind: "asset", phase: "retrying", retry, maxRetries },
        },
      }));
      return;
    }
    if (assetPath && message.type === "app-runtime-asset-recovered") {
      const offlineRecoveryWasPending = this.offlineResourceRecoveryPending;
      this.setState(
        (current) => {
          const resourceRetryStatuses = { ...current.resourceRetryStatuses };
          delete resourceRetryStatuses[assetPath];
          return { resourceRetryStatuses };
        },
        () => {
          if (!offlineRecoveryWasPending || !this.offlineResourceRecoveryPending) return;
          this.offlineResourceRecoveryPending = Object.values(
            this.state.resourceRetryStatuses
          ).some(
            (status) =>
              status.phase === "offline" || status.phase === "failed" || status.phase === "retrying"
          );
        }
      );
      return;
    }
    if (assetPath && message.type === "app-runtime-asset-retry-failed") {
      const attempts = typeof message.attempts === "number" ? message.attempts : 4;
      const maxRetries = typeof message.maxRetries === "number" ? message.maxRetries : 3;
      const offlineOccurred = this.offlineResourceRecoveryPending;
      const offline = message.offline === true || !navigator.onLine || this.networkIsOffline;
      this.offlineResourceRecoveryPending = offline || offlineOccurred;
      this.setState((current) => ({
        resourceRetryStatuses: {
          ...current.resourceRetryStatuses,
          [assetPath]: {
            kind: "asset",
            phase: offline ? "offline" : "failed",
            retry: Math.max(0, attempts - 1),
            maxRetries,
          },
        },
      }));
      this.captureGlobalError(
        "resource-load-error",
        `App asset retry failed: ${assetPath}\nAttempts: ${attempts}\nReason: ${String(message.reason ?? "unavailable")}`,
        false
      );
      if (this.offlineResourceRecoveryPending && navigator.onLine) {
        this.scheduleOfflineResourceRetry();
      }
      return;
    }
    if (message.type !== "app-update-diagnostic" || typeof message.details !== "string") return;
    this.captureGlobalError("service-worker-update", message.details);
  };

  private dismissResourceRetryNotice = (): void => {
    this.setState({ resourceRetryStatuses: {} });
  };

  private renderResourceRetryNotice(): ReactNode {
    const statuses = Object.values(this.state.resourceRetryStatuses);
    if (statuses.length === 0) return null;

    const isRetrying = statuses.some((status) => status.phase === "retrying");
    const isOffline = statuses.some((status) => status.phase === "offline");
    const status = statuses.find((item) => item.phase === "retrying") ?? statuses[0];
    const message = isRetrying
      ? status.kind === "page-reload"
        ? "运行资源加载失败，正在尝试重新打开页面…"
        : `运行资源加载失败，正在重试（${status.retry}/${status.maxRetries}）…`
      : isOffline
        ? "当前似乎处于离线状态，联网后将自动重新尝试加载运行资源。"
        : "运行资源仍未能加载，请刷新页面重试。";

    return (
      <div
        aria-live={isRetrying || isOffline ? "polite" : "assertive"}
        className={`app-runtime-asset-notice${isRetrying ? " is-retrying" : isOffline ? " is-offline" : " is-failed"}`}
        role={isRetrying || isOffline ? "status" : "alert"}
      >
        {isRetrying ? <span aria-hidden="true" className="app-runtime-asset-spinner" /> : null}
        <span className="app-runtime-asset-message">{message}</span>
        {!isRetrying && !isOffline ? (
          <button onClick={() => this.refreshPage()} type="button">
            刷新页面
          </button>
        ) : null}
        <button
          aria-label="关闭资源加载提示"
          onClick={this.dismissResourceRetryNotice}
          type="button"
        >
          ×
        </button>
      </div>
    );
  }

  private describeSource = (source: GlobalErrorSource): string => {
    switch (source) {
      case "window.error":
        return "页面脚本错误";
      case "unhandledrejection":
        return "未处理的异步错误";
      case "resource-load-error":
        return "页面资源加载错误";
      case "app-update":
        return "应用更新错误";
      case "service-worker-update":
        return "新版资源预缓存错误";
      case "backend":
        return "后端请求错误";
    }
  };

  private buildSystemMetadata = (): Record<string, unknown> => {
    const diagnosticNavigator = navigator as NavigatorWithDiagnostics;
    const connection = diagnosticNavigator.connection;
    const serviceWorkerController =
      "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
    const isStandaloneDisplay =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      Boolean(diagnosticNavigator.standalone);
    let timezone = "unavailable";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
    } catch {
      // Timezone is optional diagnostic context.
    }

    return {
      platform: navigator.platform || "unavailable",
      locale: navigator.language || "unavailable",
      timezone,
      screen: { width: window.screen.width, height: window.screen.height },
      devicePixelRatio: window.devicePixelRatio || 1,
      hardwareThreads: navigator.hardwareConcurrency || null,
      deviceMemoryGb: diagnosticNavigator.deviceMemory ?? null,
      displayMode: isStandaloneDisplay ? "standalone" : "browser",
      network: {
        effectiveType: connection?.effectiveType ?? null,
        downlinkMbps: connection?.downlink ?? null,
        rttMs: connection?.rtt ?? null,
        saveData: connection?.saveData ?? null,
      },
      serviceWorkerControllerState: serviceWorkerController?.state ?? "none",
    };
  };

  private buildDebugInfo = (): string => {
    const payload = {
      format: "piano-learning-global-debug",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      app: {
        version: __APP_VERSION__,
        buildId: __APP_BUILD_ID__,
        buildTime: __APP_BUILD_TIME__,
      },
      environment: {
        browser: navigator.userAgent,
        page: window.location.pathname + window.location.hash,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        online: navigator.onLine,
        ...this.buildSystemMetadata(),
      },
      errors: {
        fatalReactRenderError: this.state.fatalErrorDetails,
        runtimeAndUpdate: this.state.globalErrors.map((record) => ({
          ...record,
          sourceLabel: this.describeSource(record.source),
        })),
      },
      events: getGlobalDebugEvents(),
    };
    return JSON.stringify(payload, null, 2);
  };

  private downloadDebugFile = (file: File): void => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  private shareDebugInfo = async (): Promise<void> => {
    this.showCopyStatus("");
    try {
      const fileName =
        "piano-learning-debug-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      const file = new File([this.buildDebugInfo()], fileName, {
        type: "application/json",
      });
      const shareNavigator = navigator as NavigatorWithFileShare;
      let canShareFile = false;
      try {
        canShareFile =
          navigator.maxTouchPoints > 0 &&
          Boolean(shareNavigator.share && shareNavigator.canShare?.({ files: [file] }));
      } catch {
        canShareFile = false;
      }

      if (canShareFile && shareNavigator.share) {
        try {
          await shareNavigator.share({ files: [file], title: "钢琴练习调试信息" });
          this.showCopyStatus("调试 JSON 已通过系统分享", true);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            this.showCopyStatus("已取消分享，调试记录仍保留", true);
            return;
          }
          this.downloadDebugFile(file);
          this.showCopyStatus("系统分享未完成，已下载调试 JSON", true);
          return;
        }
      }

      this.downloadDebugFile(file);
      this.showCopyStatus(
        navigator.maxTouchPoints > 0
          ? "当前浏览器不支持分享文件，已下载调试 JSON"
          : "调试 JSON 已下载",
        true
      );
    } catch (error) {
      const message = error instanceof Error && error.message ? "：" + error.message : "";
      this.showCopyStatus("调试 JSON 导出失败" + message, true);
    }
  };

  private copyWithTextarea = (text: string): boolean => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0.01";
    textarea.style.fontSize = "16px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    textarea.parentNode?.removeChild(textarea);
    return copied;
  };

  private showCopyStatus = (status: string, autoDismiss = false): void => {
    if (this.copyStatusTimeout !== null) {
      window.clearTimeout(this.copyStatusTimeout);
      this.copyStatusTimeout = null;
    }
    this.setState({ copyStatus: status });
    if (autoDismiss) {
      this.copyStatusTimeout = window.setTimeout(() => {
        this.copyStatusTimeout = null;
        this.setState({ copyStatus: "" });
      }, 2_000);
    }
  };

  private copyDebugInfo = async (): Promise<void> => {
    this.showCopyStatus("");
    const text = this.buildDebugInfo();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        this.showCopyStatus("调试信息已复制", true);
        return;
      }
    } catch {
      // Fall through to the selection-based copy path for older browsers and denied clipboard access.
    }

    const copied = this.copyWithTextarea(text);
    this.showCopyStatus(copied ? "调试信息已复制" : "自动复制失败，请长按下方文字手动复制", copied);
  };

  private renderGlobalErrorNotice(): ReactNode {
    const hasGlobalErrors = this.state.globalErrors.length > 0 && !this.state.fatalErrorDetails;
    if (!hasGlobalErrors && !this.state.globalDebugEnabled) return null;

    const occurrenceCount = this.state.globalErrors.reduce(
      (total, record) => total + record.count,
      0
    );
    const copyFailed = this.state.copyStatus.startsWith("自动复制失败");

    return (
      <>
        {this.state.globalErrorNoticeVisible && hasGlobalErrors && (
          <div
            className="app-global-error-badge"
            ref={this.errorBadgeRef}
            role="status"
            style={this.getBadgePositionStyle("error")}
          >
            <button
              aria-label={`打开错误详情，${this.state.globalErrorNoticeSecondsRemaining} 秒后提示自动关闭`}
              className="app-global-error-badge-details"
              onPointerDown={(event) => this.handleBadgePointerDown("error", event)}
              onPointerMove={(event) => this.handleBadgePointerMove("error", event)}
              onPointerUp={(event) => this.finishBadgeDrag("error", event)}
              onPointerCancel={(event) => this.finishBadgeDrag("error", event)}
              onClick={() => {
                if (this.consumeSuppressedBadgeClick("error")) return;
                this.setState({ errorDetailsOpen: true, globalDebugDialogOpen: false });
              }}
              type="button"
            >
              <span aria-hidden="true" className="app-global-error-badge-icon">
                !
              </span>
              <span className="app-global-error-badge-countdown">
                {this.state.globalErrorNoticeSecondsRemaining}秒
              </span>
            </button>
            <button
              aria-label="关闭错误提示"
              className="app-global-error-badge-close"
              onClick={this.dismissGlobalErrorNotice}
              type="button"
            >
              ×
            </button>
          </div>
        )}
        {this.state.globalDebugEnabled && (
          <div
            className={
              this.state.globalErrorNoticeVisible && hasGlobalErrors
                ? "app-global-debug-badge has-error-badge"
                : "app-global-debug-badge"
            }
            ref={this.globalDebugBadgeRef}
            style={this.getBadgePositionStyle("debug")}
          >
            <button
              aria-label={
                this.state.globalDebugEventCount > 0
                  ? "打开调试信息，已记录 " + this.state.globalDebugEventCount + " 条"
                  : "打开调试信息"
              }
              onPointerDown={(event) => this.handleBadgePointerDown("debug", event)}
              onPointerMove={(event) => this.handleBadgePointerMove("debug", event)}
              onPointerUp={(event) => this.finishBadgeDrag("debug", event)}
              onPointerCancel={(event) => this.finishBadgeDrag("debug", event)}
              onClick={() => {
                if (this.consumeSuppressedBadgeClick("debug")) return;
                this.setState({ globalDebugDialogOpen: true, errorDetailsOpen: false });
              }}
              title="调试信息"
              type="button"
            >
              <Bug aria-hidden="true" size={19} />
              {this.state.globalDebugEventCount > 0 ? (
                <span aria-hidden="true" className="app-global-debug-badge-count">
                  {this.state.globalDebugEventCount > 99 ? "99+" : this.state.globalDebugEventCount}
                </span>
              ) : null}
            </button>
          </div>
        )}
        {this.state.errorDetailsOpen && (
          <div className="app-global-error-dialog-backdrop">
            <button
              aria-label="关闭错误详情"
              className="app-global-error-dialog-backdrop-close"
              onClick={() => this.setState({ errorDetailsOpen: false })}
              type="button"
            />
            <section
              aria-labelledby="app-global-error-dialog-title"
              aria-modal="true"
              className="app-global-error-dialog"
              role="dialog"
            >
              <header className="app-global-error-dialog-header">
                <div>
                  <h2 id="app-global-error-dialog-title">运行与更新诊断</h2>
                  <p>
                    已记录 {occurrenceCount} 次、{this.state.globalErrors.length}{" "}
                    类。页面仍可继续使用。
                  </p>
                </div>
                <button
                  aria-label="关闭错误详情"
                  className="app-global-error-dialog-close"
                  onClick={() => this.setState({ errorDetailsOpen: false })}
                  type="button"
                >
                  ×
                </button>
              </header>
              <p className="app-global-error-build-info">
                版本 {__APP_VERSION__} · 构建时间 {formatDateTime(__APP_BUILD_TIME__)}
              </p>
              <div className="app-global-error-dialog-actions">
                <button onClick={() => void this.copyDebugInfo()} type="button">
                  复制诊断信息
                </button>
                <button onClick={() => void this.refreshPage()} type="button">
                  刷新页面
                </button>
              </div>
              <p aria-live="polite" className="app-global-error-dialog-copy-status">
                {this.state.copyStatus || "诊断记录会保留到本次页面刷新。"}
              </p>
              <details open={copyFailed}>
                <summary>错误详情（可手动复制）</summary>
                <pre>{this.buildDebugInfo()}</pre>
              </details>
            </section>
          </div>
        )}
        {this.state.globalDebugDialogOpen && this.state.globalDebugEnabled && (
          <div className="app-global-error-dialog-backdrop">
            <button
              aria-label="关闭调试信息"
              className="app-global-error-dialog-backdrop-close"
              onClick={() => this.setState({ globalDebugDialogOpen: false })}
              type="button"
            />
            <section
              aria-labelledby="app-global-debug-dialog-title"
              aria-modal="true"
              className="app-global-error-dialog app-global-debug-dialog"
              role="dialog"
            >
              <header className="app-global-error-dialog-header">
                <div>
                  <h2 id="app-global-debug-dialog-title">全局调试信息</h2>
                  <p>
                    当前会话有 {this.state.globalDebugEventCount}{" "}
                    条调试事件；页面错误和设备环境信息也会一并导出。
                  </p>
                </div>
                <button
                  aria-label="关闭调试信息"
                  className="app-global-error-dialog-close"
                  onClick={() => this.setState({ globalDebugDialogOpen: false })}
                  type="button"
                >
                  ×
                </button>
              </header>
              <p className="app-global-error-build-info">
                版本 {__APP_VERSION__} · 构建时间 {formatDateTime(__APP_BUILD_TIME__)}
              </p>
              <div className="app-global-error-dialog-actions">
                <button onClick={() => void this.shareDebugInfo()} type="button">
                  分享调试 JSON
                </button>
                <button onClick={() => clearGlobalDebugEvents()} type="button">
                  清空记录
                </button>
              </div>
              <p aria-live="polite" className="app-global-error-dialog-copy-status">
                {this.state.copyStatus ||
                  "电脑会下载 JSON 文件；手机会打开系统分享菜单。记录不会自动上传。"}
              </p>
              <details open={copyFailed || this.state.globalDebugEventCount === 0}>
                <summary>调试 JSON（可手动查看）</summary>
                <pre>{this.buildDebugInfo()}</pre>
              </details>
            </section>
          </div>
        )}
      </>
    );
  }

  render(): ReactNode {
    if (this.state.fatalErrorDetails) {
      const isModuleLoadFailure = MODULE_LOAD_FAILURE_PATTERN.test(this.state.fatalErrorDetails);
      const isWaitingForNetwork = Object.values(this.state.resourceRetryStatuses).some(
        (status) => status.phase === "offline"
      );
      const isAutoReloading = Object.values(this.state.resourceRetryStatuses).some(
        (status) => status.kind === "page-reload" && status.phase === "retrying"
      );
      const hasTerminalModuleRetryFailure = Object.values(this.state.resourceRetryStatuses).some(
        (status) => status.kind === "page-reload" && status.phase === "failed"
      );
      const hasUncontrolledModuleRetry =
        isModuleLoadFailure &&
        !("serviceWorker" in navigator && navigator.serviceWorker.controller);
      const shouldShowModuleRetryFallback =
        isModuleLoadFailure &&
        (isAutoReloading ||
          isWaitingForNetwork ||
          (hasUncontrolledModuleRetry &&
            !this.hasModuleLoadRetryBeenUsed() &&
            !hasTerminalModuleRetryFailure));

      if (shouldShowModuleRetryFallback) {
        return (
          <>
            {this.renderResourceRetryNotice()}
            <main className="app-module-load-retry" role="status">
              <div className="app-module-load-retry-card">
                {!isWaitingForNetwork ? (
                  <span aria-hidden="true" className="app-runtime-asset-spinner" />
                ) : null}
                <p>
                  {isWaitingForNetwork
                    ? "当前似乎处于离线状态，联网后将自动重试运行资源。"
                    : "菜单运行资源加载失败，正在自动重试…"}
                </p>
              </div>
            </main>
          </>
        );
      }

      return (
        <>
          {this.renderResourceRetryNotice()}
          <main className="app-error-debug" role="alert">
            <section className="app-error-debug-card">
              <div className="app-error-debug-toolbar">
                <div>
                  <h1>{isModuleLoadFailure ? "页面资源加载失败" : "页面渲染失败"}</h1>
                  <p>
                    {isModuleLoadFailure
                      ? isWaitingForNetwork
                        ? "当前似乎处于离线状态，联网后会自动重新加载并重试菜单资源。"
                        : "菜单页面所需的运行资源暂时无法加载。请刷新页面重试，或复制诊断信息反馈。"
                      : "当前页面无法正常显示。请复制调试信息并反馈，方便定位问题。"}
                  </p>
                  <p className="app-error-build-info">
                    版本 {__APP_VERSION__} · 构建时间 {formatDateTime(__APP_BUILD_TIME__)}
                  </p>
                </div>
                <div className="app-error-debug-copy-control">
                  <div className="app-error-debug-actions">
                    <button onClick={() => void this.copyDebugInfo()} type="button">
                      复制调试信息
                    </button>
                    <button
                      disabled={isWaitingForNetwork || isAutoReloading}
                      onClick={() => void this.refreshPage()}
                      type="button"
                    >
                      {isWaitingForNetwork
                        ? "等待联网"
                        : isAutoReloading
                          ? "正在重试…"
                          : "刷新页面"}
                    </button>
                  </div>
                  <p aria-live="polite" className="app-error-debug-copy-status">
                    {this.state.copyStatus}
                  </p>
                </div>
              </div>
              <pre>{this.buildDebugInfo()}</pre>
            </section>
          </main>
        </>
      );
    }
    return (
      <>
        {this.renderResourceRetryNotice()}
        {this.props.children}
        {this.renderGlobalErrorNotice()}
      </>
    );
  }
}
