import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reportAppDiagnostic } from "../shared/diagnostics/appDiagnostics";

const UPDATE_CHECK_INTERVAL_MS = 60_000;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const WORKER_INSTALL_TIMEOUT_MS = 120_000;
const WORKER_ACTIVATION_TIMEOUT_MS = 15_000;
const UPDATE_NOTICE_DURATION_MS = 10_000;
const UPDATE_NOTICE_ID = "app-update-available";
const UPDATE_RESULT_NOTICE_ID = "app-update-result";
const PENDING_UPDATE_STORAGE_KEY_PREFIX = "piano-learning.pending-app-update:";
const UPDATE_TAB_ID_STORAGE_KEY = "piano-learning.update-tab-id";
const UPDATE_RELOAD_PARAM = "__app_update";
const UPDATE_RECOVERY_TTL_MS = 15 * 60_000;
const MAX_FORCED_UPDATE_RELOADS = 1;
const UPDATE_FAILURE_MESSAGE =
  "新版暂未能加载，请关闭此页面后重新进入；如果仍未更新，请检查网络后重试。";

interface PendingAppUpdate {
  ownerTabId: string;
  sourceBuildId: string;
  targetBuildId: string;
  startedAt: number;
  forcedReloads: number;
  phase: "preparing" | "refresh-requested";
}

interface BuildVersionResponse {
  version?: unknown;
  buildTime?: unknown;
  buildId?: unknown;
}

export type AppUpdateStatus =
  "idle" | "checking" | "up-to-date" | "available" | "preparing" | "reloading" | "error";

export interface AppUpdateController {
  status: AppUpdateStatus;
  message: string;
  hasUpdateAvailable: boolean;
  hasPreparedUpdate: boolean;
  checkForUpdates: () => void;
  applyUpdate: () => void;
}

type VersionCheckResult =
  | { status: "up-to-date" }
  | { status: "available"; buildId: string }
  | { status: "error"; diagnostic: string };

function getVersionUrl(): URL {
  const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.origin);
  url.searchParams.set("check", String(Date.now()));
  return url;
}

function isBuildVersionResponse(value: unknown): value is BuildVersionResponse {
  return Boolean(value && typeof value === "object" && "buildId" in value);
}

function getUpdateTabId(): string | null {
  try {
    const existingId = window.sessionStorage.getItem(UPDATE_TAB_ID_STORAGE_KEY);
    if (existingId) return existingId;
    const newId =
      window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(UPDATE_TAB_ID_STORAGE_KEY, newId);
    return newId;
  } catch {
    return null;
  }
}

function getPendingUpdateStorageKey(ownerTabId: string): string {
  return `${PENDING_UPDATE_STORAGE_KEY_PREFIX}${ownerTabId}`;
}

function parsePendingAppUpdate(value: string): PendingAppUpdate | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const update = parsed as Partial<PendingAppUpdate>;
    if (
      typeof update.ownerTabId !== "string" ||
      typeof update.sourceBuildId !== "string" ||
      typeof update.targetBuildId !== "string" ||
      typeof update.startedAt !== "number" ||
      !Number.isFinite(update.startedAt) ||
      typeof update.forcedReloads !== "number" ||
      !Number.isInteger(update.forcedReloads) ||
      update.forcedReloads < 0 ||
      (update.phase !== "preparing" && update.phase !== "refresh-requested")
    ) {
      return null;
    }
    return update as PendingAppUpdate;
  } catch {
    return null;
  }
}

function readPendingAppUpdate(ownerTabId: string): PendingAppUpdate | null {
  const storageKey = getPendingUpdateStorageKey(ownerTabId);
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[storageName];
      const value = storage.getItem(storageKey);
      if (!value) continue;
      const update = parsePendingAppUpdate(value);
      if (update?.ownerTabId === ownerTabId) return update;
      storage.removeItem(storageKey);
    } catch {
      // Try the next storage area when this one is unavailable.
    }
  }
  return null;
}

function writePendingAppUpdate(update: PendingAppUpdate): boolean {
  const value = JSON.stringify(update);
  const storageKey = getPendingUpdateStorageKey(update.ownerTabId);
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      window[storageName].setItem(storageKey, value);
      return true;
    } catch {
      // Fall back to session storage if persistent storage is unavailable.
      try {
        window[storageName].removeItem(storageKey);
      } catch {
        // Storage may be entirely unavailable.
      }
    }
  }
  return false;
}

function clearPendingAppUpdate(ownerTabId: string): void {
  const storageKey = getPendingUpdateStorageKey(ownerTabId);
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      window[storageName].removeItem(storageKey);
    } catch {
      // Storage may be unavailable in private browsing.
    }
  }
}

function clearUpdateReloadParameter(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(UPDATE_RELOAD_PARAM)) return;
    url.searchParams.delete(UPDATE_RELOAD_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch (error) {
    reportAppDiagnostic({
      source: "app-update",
      details: `Stage: reload-parameter-cleanup\n${describeThrownValue(error)}`,
    });
  }
}

function requestForcedUpdateReload(update: PendingAppUpdate, reason: string): boolean {
  if (update.forcedReloads >= MAX_FORCED_UPDATE_RELOADS) return false;
  const nextUpdate: PendingAppUpdate = {
    ...update,
    forcedReloads: update.forcedReloads + 1,
    phase: "refresh-requested",
  };
  if (!writePendingAppUpdate(nextUpdate)) {
    reportAppDiagnostic({
      source: "app-update",
      details: [
        "Stage: update-state-storage",
        `Local build: ${update.sourceBuildId}`,
        `Remote build: ${update.targetBuildId}`,
        "Could not persist the reload guard; automatic reload was cancelled to prevent a loop.",
      ].join("\n"),
    });
    return false;
  }

  reportAppDiagnostic({
    source: "app-update",
    details: [
      "Stage: fallback-reload",
      `Local build: ${update.sourceBuildId}`,
      `Remote build: ${update.targetBuildId}`,
      `Attempt: ${nextUpdate.forcedReloads}/${MAX_FORCED_UPDATE_RELOADS}`,
      `Reason: ${reason}`,
    ].join("\n"),
  });

  try {
    const refreshUrl = new URL(window.location.href);
    refreshUrl.searchParams.set(UPDATE_RELOAD_PARAM, String(Date.now()));
    window.location.replace(refreshUrl.toString());
    return true;
  } catch (error) {
    reportAppDiagnostic({
      source: "app-update",
      details: `Stage: fallback-reload-navigation\n${describeThrownValue(error)}`,
    });
    return false;
  }
}

function markUpdateRefreshRequested(update: PendingAppUpdate): PendingAppUpdate | null {
  const refreshRequestedUpdate: PendingAppUpdate = { ...update, phase: "refresh-requested" };
  if (writePendingAppUpdate(refreshRequestedUpdate)) return refreshRequestedUpdate;

  reportAppDiagnostic({
    source: "app-update",
    details: [
      "Stage: update-state-storage",
      `Local build: ${update.sourceBuildId}`,
      `Remote build: ${update.targetBuildId}`,
      "Could not persist the refresh request; automatic activation was cancelled to prevent an unconfirmed reload.",
    ].join("\n"),
  });
  return null;
}

function describePendingUpdate(update: PendingAppUpdate, stage: string, reason: string): string {
  return [
    `Stage: ${stage}`,
    `Local build: ${update.sourceBuildId}`,
    `Remote build: ${update.targetBuildId}`,
    `Forced reloads: ${update.forcedReloads}/${MAX_FORCED_UPDATE_RELOADS}`,
    `Reason: ${reason}`,
  ].join("\n");
}

function showUpdateFailureNotice(description: string): void {
  toast.error("新版暂未能加载", {
    id: UPDATE_RESULT_NOTICE_ID,
    description,
    duration: 15_000,
  });
}

type ServiceWorkerReadyResult =
  | { state: "waiting"; worker: ServiceWorker }
  | { state: "activated"; worker: ServiceWorker }
  | { state: "failed"; worker: ServiceWorker | null }
  | { state: "timeout"; worker: ServiceWorker | null };

type ServiceWorkerUpdateResult =
  | { status: "prepared"; preparedUpdate: PreparedServiceWorkerUpdate }
  | { status: "error"; diagnostic: string };

type UpdatePreparationOutcome =
  | { buildId: string; status: "prepared"; preparedUpdate: PreparedServiceWorkerUpdate }
  | { buildId: string; status: "error"; diagnostic: string };

interface PreparedServiceWorkerUpdate {
  registration: ServiceWorkerRegistration;
  result: Extract<ServiceWorkerReadyResult, { state: "waiting" | "activated" }>;
}

async function readServiceWorkerBuildId(worker: ServiceWorker): Promise<string | null> {
  if (typeof MessageChannel === "undefined") return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => finish(null), 3_000);
    let settled = false;

    const finish = (buildId: string | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      channel.port1.close();
      resolve(buildId);
    };

    channel.port1.onmessage = (event: MessageEvent<unknown>): void => {
      const response = event.data;
      if (
        response &&
        typeof response === "object" &&
        "type" in response &&
        response.type === "service-worker-build-id" &&
        "buildId" in response &&
        typeof response.buildId === "string"
      ) {
        finish(response.buildId);
      }
    };

    try {
      worker.postMessage({ type: "get-service-worker-build-id" }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function verifyServiceWorkerBuild(
  worker: ServiceWorker,
  expectedBuildId: string
): Promise<string | null> {
  const actualBuildId = await readServiceWorkerBuildId(worker);
  if (actualBuildId === expectedBuildId) return null;

  return [
    "Stage: service-worker-build-verification",
    `Expected build: ${expectedBuildId}`,
    `Prepared build: ${actualBuildId ?? "unavailable"}`,
  ].join("\n");
}

function waitForWorkerReady(
  registration: ServiceWorkerRegistration,
  timeoutMs: number
): Promise<ServiceWorkerReadyResult> {
  if (registration.waiting)
    return Promise.resolve({ state: "waiting", worker: registration.waiting });

  return new Promise((resolve) => {
    let observedWorker: ServiceWorker | null = null;
    let timeoutId = 0;
    let settled = false;

    const finish = (result: ServiceWorkerReadyResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      registration.removeEventListener("updatefound", onUpdateFound);
      observedWorker?.removeEventListener("statechange", onStateChange);
      resolve(result);
    };

    const onStateChange = (): void => {
      if (registration.waiting) {
        finish({ state: "waiting", worker: registration.waiting });
      } else if (observedWorker?.state === "activated") {
        finish(
          registration.active
            ? { state: "activated", worker: registration.active }
            : { state: "failed", worker: null }
        );
      } else if (observedWorker?.state === "redundant") {
        finish({ state: "failed", worker: observedWorker });
      }
    };

    const watchInstallingWorker = (): void => {
      observedWorker?.removeEventListener("statechange", onStateChange);
      observedWorker = registration.installing;
      observedWorker?.addEventListener("statechange", onStateChange);
      onStateChange();
    };

    const onUpdateFound = (): void => watchInstallingWorker();

    registration.addEventListener("updatefound", onUpdateFound);
    timeoutId = window.setTimeout(
      () =>
        finish(
          registration.waiting
            ? { state: "waiting", worker: registration.waiting }
            : { state: "timeout", worker: observedWorker }
        ),
      timeoutMs
    );
    watchInstallingWorker();
  });
}

function describeThrownValue(value: unknown): string {
  if (value instanceof Error) {
    return [
      `${value.name}: ${value.message || "(message unavailable)"}`,
      value.stack ? `Stack:\n${value.stack}` : "Stack: (unavailable)",
    ].join("\n");
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function createPreparedServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
  result: Extract<ServiceWorkerReadyResult, { state: "waiting" | "activated" }>,
  expectedBuildId: string
): Promise<ServiceWorkerUpdateResult> {
  const diagnostic = await verifyServiceWorkerBuild(result.worker, expectedBuildId);
  if (diagnostic) return { status: "error", diagnostic };
  return { status: "prepared", preparedUpdate: { registration, result } };
}

async function stageServiceWorkerUpdate(
  expectedBuildId: string
): Promise<ServiceWorkerUpdateResult> {
  if (!("serviceWorker" in navigator)) {
    return {
      status: "error",
      diagnostic: "Stage: service-worker-registration\nService Worker API is unavailable.",
    };
  }

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
      registration = await navigator.serviceWorker.register(
        new URL("service-worker.js", appBaseUrl).toString(),
        { scope: appBaseUrl.pathname }
      );
    }
  } catch (error) {
    return {
      status: "error",
      diagnostic: [
        "Stage: service-worker-registration",
        `Could not find or register the app Service Worker:\n${describeThrownValue(error)}`,
      ].join("\n"),
    };
  }

  try {
    if (registration.waiting) {
      return createPreparedServiceWorkerUpdate(
        registration,
        { state: "waiting", worker: registration.waiting },
        expectedBuildId
      );
    }

    const previousActiveWorker = registration.active;
    try {
      await registration.update();
    } catch (error) {
      return {
        status: "error",
        diagnostic: `Stage: service-worker-script-update\nregistration.update() failed:\n${describeThrownValue(error)}`,
      };
    }

    if (registration.waiting) {
      return createPreparedServiceWorkerUpdate(
        registration,
        { state: "waiting", worker: registration.waiting },
        expectedBuildId
      );
    }
    if (registration.active && registration.active !== previousActiveWorker) {
      return createPreparedServiceWorkerUpdate(
        registration,
        { state: "activated", worker: registration.active },
        expectedBuildId
      );
    }
    if (!registration.installing) {
      return {
        status: "error",
        diagnostic: [
          "Stage: service-worker-installation",
          "registration.update() completed but no installing, waiting, or newly active worker was found.",
        ].join("\n"),
      };
    }

    const result = await waitForWorkerReady(registration, WORKER_INSTALL_TIMEOUT_MS);
    if (result.state === "failed") {
      return {
        status: "error",
        diagnostic: [
          "Stage: service-worker-installation",
          `New worker became redundant${result.worker ? ` (state: ${result.worker.state})` : ""}.`,
          `Active worker state: ${registration.active?.state ?? "unavailable"}.`,
        ].join("\n"),
      };
    }
    if (result.state === "timeout") {
      return {
        status: "error",
        diagnostic: [
          "Stage: service-worker-installation",
          `No installed worker appeared within ${WORKER_INSTALL_TIMEOUT_MS} ms.`,
          `Observed worker state: ${result.worker?.state ?? "unavailable"}.`,
        ].join("\n"),
      };
    }
    return createPreparedServiceWorkerUpdate(registration, result, expectedBuildId);
  } catch (error) {
    return {
      status: "error",
      diagnostic: `Stage: service-worker-installation\n${describeThrownValue(error)}`,
    };
  }
}

async function checkRemoteVersion(): Promise<VersionCheckResult> {
  if (!navigator.onLine) {
    return {
      status: "error",
      diagnostic: "Stage: connectivity\nBrowser reports navigator.onLine=false.",
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  let stage = "version-fetch";

  try {
    const versionUrl = getVersionUrl();
    const response = await fetch(versionUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "error",
        diagnostic: [
          `Stage: ${stage}`,
          `GET ${versionUrl.pathname} returned HTTP ${response.status} ${response.statusText}.`,
        ].join("\n"),
      };
    }

    stage = "version-json-parse";
    const payload: unknown = await response.json();
    stage = "version-payload";
    if (
      !isBuildVersionResponse(payload) ||
      typeof payload.buildId !== "string" ||
      !payload.buildId
    ) {
      return {
        status: "error",
        diagnostic: `Stage: version-payload\nThe response did not contain a non-empty string buildId. Response type: ${typeof payload}.`,
      };
    }
    if (payload.buildId === __APP_BUILD_ID__) return { status: "up-to-date" };

    return { status: "available", buildId: payload.buildId };
  } catch (error) {
    const timeoutNote =
      error instanceof Error && error.name === "AbortError"
        ? `\nRequest timeout: ${UPDATE_CHECK_TIMEOUT_MS} ms.`
        : "";
    return {
      status: "error",
      diagnostic: `Stage: ${stage}\n${describeThrownValue(error)}${timeoutNote}`,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function applyAvailableUpdate(preparedUpdate: PreparedServiceWorkerUpdate): boolean {
  const { registration, result } = preparedUpdate;
  if (result.state === "activated") {
    window.location.reload();
    return true;
  }

  const waitingWorker = registration.waiting;
  if (waitingWorker !== result.worker || waitingWorker.state !== "installed") return false;

  let reloading = false;
  const reloadOnce = (): void => {
    if (reloading) return;
    reloading = true;
    window.clearTimeout(fallbackTimeoutId);
    waitingWorker.removeEventListener("statechange", onWorkerStateChange);
    window.location.reload();
  };
  const onWorkerStateChange = (): void => {
    if (waitingWorker.state === "activated") reloadOnce();
  };
  const fallbackTimeoutId = window.setTimeout(reloadOnce, WORKER_ACTIVATION_TIMEOUT_MS);

  waitingWorker.addEventListener("statechange", onWorkerStateChange);
  waitingWorker.postMessage("skip-waiting");
  return true;
}

export function useAppUpdateNotice(): AppUpdateController {
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [message, setMessage] = useState("");
  const [preparationOutcome, setPreparationOutcome] = useState<UpdatePreparationOutcome | null>(
    null
  );
  const hasUpdateAvailableRef = useRef(false);
  const remoteBuildIdRef = useRef<string | null>(null);
  const preparationOutcomeRef = useRef<UpdatePreparationOutcome | null>(null);
  const preparingBuildIdRef = useRef<string | null>(null);
  const dismissedBuildIdsRef = useRef(new Set<string>());
  const applyingUpdateRef = useRef(false);
  const activeCheckRef = useRef<Promise<VersionCheckResult> | null>(null);
  const startupUpdateRecoveryHandledRef = useRef(false);

  const runVersionCheck = useCallback((): Promise<VersionCheckResult> => {
    if (activeCheckRef.current) return activeCheckRef.current;

    const check = checkRemoteVersion();
    activeCheckRef.current = check;
    void check.finally(() => {
      if (activeCheckRef.current === check) activeCheckRef.current = null;
    });
    return check;
  }, []);

  const beginBackgroundPreparation = useCallback((buildId: string): void => {
    if (preparationOutcomeRef.current?.buildId === buildId) return;
    if (preparingBuildIdRef.current) return;

    preparingBuildIdRef.current = buildId;
    setStatus("preparing");
    setMessage("发现新版本，正在后台准备");

    void stageServiceWorkerUpdate(buildId)
      .then((result): void => {
        if (preparingBuildIdRef.current === buildId) preparingBuildIdRef.current = null;

        const latestBuildId = remoteBuildIdRef.current;
        if (latestBuildId !== buildId) {
          if (latestBuildId) beginBackgroundPreparation(latestBuildId);
          return;
        }

        const outcome: UpdatePreparationOutcome =
          result.status === "prepared"
            ? { buildId, status: "prepared", preparedUpdate: result.preparedUpdate }
            : { buildId, status: "error", diagnostic: result.diagnostic };
        preparationOutcomeRef.current = outcome;
        setPreparationOutcome(outcome);

        if (outcome.status === "prepared") {
          setStatus("available");
          setMessage("新版已准备好，可立即使用");
        } else {
          reportAppDiagnostic({
            source: "app-update",
            details: [
              "Stage: background-prepare-update",
              `Local build: ${__APP_BUILD_ID__}`,
              `Remote build: ${buildId}`,
              outcome.diagnostic,
            ].join("\n"),
          });
          setStatus("error");
          setMessage("新版已发布，自动准备未完成；刷新时会尝试加载新版。");
        }

        if (dismissedBuildIdsRef.current.has(buildId)) {
          setHasUpdateAvailable(false);
          return;
        }
        hasUpdateAvailableRef.current = true;
        setHasUpdateAvailable(true);
      })
      .catch((error: unknown): void => {
        if (preparingBuildIdRef.current === buildId) preparingBuildIdRef.current = null;
        if (remoteBuildIdRef.current !== buildId) return;

        const diagnostic = describeThrownValue(error);
        const outcome: UpdatePreparationOutcome = { buildId, status: "error", diagnostic };
        preparationOutcomeRef.current = outcome;
        setPreparationOutcome(outcome);
        reportAppDiagnostic({
          source: "app-update",
          details: [
            "Stage: background-prepare-update",
            `Local build: ${__APP_BUILD_ID__}`,
            `Remote build: ${buildId}`,
            diagnostic,
          ].join("\n"),
        });
        setStatus("error");
        setMessage("新版已发布，自动准备未完成；刷新时会尝试加载新版。");
        hasUpdateAvailableRef.current = true;
        setHasUpdateAvailable(!dismissedBuildIdsRef.current.has(buildId));
      });
  }, []);

  const acceptAvailableBuild = useCallback(
    (buildId: string, manualCheck: boolean): void => {
      const previousBuildId = remoteBuildIdRef.current;
      if (previousBuildId !== buildId) {
        remoteBuildIdRef.current = buildId;
        preparationOutcomeRef.current = null;
        setPreparationOutcome(null);
        setHasUpdateAvailable(false);
      }
      hasUpdateAvailableRef.current = true;

      const existingOutcome = preparationOutcomeRef.current;
      if (existingOutcome?.buildId === buildId) {
        if (manualCheck) {
          setHasUpdateAvailable(true);
          setStatus(existingOutcome.status === "prepared" ? "available" : "error");
          setMessage(
            existingOutcome.status === "prepared"
              ? "新版已准备好，可立即使用"
              : "新版已发布，刷新时会尝试加载新版。"
          );
        }
        return;
      }

      if (preparingBuildIdRef.current === buildId) {
        setStatus("preparing");
        setMessage("发现新版本，正在后台准备");
        return;
      }

      if (dismissedBuildIdsRef.current.has(buildId) && !manualCheck) {
        setHasUpdateAvailable(false);
        return;
      }

      beginBackgroundPreparation(buildId);
    },
    [beginBackgroundPreparation]
  );

  const checkForUpdates = useCallback((): void => {
    if (import.meta.env.DEV) {
      setStatus("error");
      setMessage("开发环境暂不支持检查线上更新");
      return;
    }
    setStatus("checking");
    setMessage("正在检查更新…");
    void runVersionCheck().then((result) => {
      if (result.status === "up-to-date") {
        hasUpdateAvailableRef.current = false;
        remoteBuildIdRef.current = null;
        setHasUpdateAvailable(false);
        setPreparationOutcome(null);
        preparationOutcomeRef.current = null;
        toast.dismiss(UPDATE_NOTICE_ID);
        setStatus("up-to-date");
        setMessage("当前已是最新版本");
      } else if (result.status === "available") {
        acceptAvailableBuild(result.buildId, true);
      } else {
        reportAppDiagnostic({ source: "app-update", details: result.diagnostic });
        setStatus("error");
        setMessage(navigator.onLine ? "检查失败，请稍后重试" : "当前离线，连接网络后可重试");
      }
    });
  }, [acceptAvailableBuild, runVersionCheck]);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    const ownerTabId = getUpdateTabId();
    clearUpdateReloadParameter();
    if (!ownerTabId) return;

    const pendingUpdate = readPendingAppUpdate(ownerTabId);
    if (!pendingUpdate) return;

    const ageMs = Date.now() - pendingUpdate.startedAt;
    if (ageMs < 0 || ageMs > UPDATE_RECOVERY_TTL_MS) {
      clearPendingAppUpdate(ownerTabId);
      return;
    }

    if (pendingUpdate.phase !== "refresh-requested") {
      // The tab was refreshed while the Service Worker was still being prepared.
      // Do not treat that as a failed update or start a competing fallback reload.
      clearPendingAppUpdate(ownerTabId);
      return;
    }

    startupUpdateRecoveryHandledRef.current = true;
    if (__APP_BUILD_ID__ !== pendingUpdate.sourceBuildId) {
      clearPendingAppUpdate(ownerTabId);
      setStatus("up-to-date");
      setMessage("更新完成，当前版本已启用");
      toast.dismiss(UPDATE_NOTICE_ID);
      toast.success("更新完成", {
        id: UPDATE_RESULT_NOTICE_ID,
        description: "新版已成功启用。",
        duration: 3_000,
      });
      return;
    }

    if (pendingUpdate.forcedReloads < MAX_FORCED_UPDATE_RELOADS) {
      setStatus("reloading");
      setMessage("正在重新加载页面以完成更新…");
      if (requestForcedUpdateReload(pendingUpdate, "刷新后仍运行旧版本，执行一次缓存绕过刷新")) {
        return;
      }
      clearPendingAppUpdate(ownerTabId);
    } else {
      clearPendingAppUpdate(ownerTabId);
    }

    const failureReason =
      pendingUpdate.forcedReloads >= MAX_FORCED_UPDATE_RELOADS
        ? "页面刷新后仍运行旧版本，自动兜底次数已用完。"
        : "无法安全发起缓存绕过刷新。";
    reportAppDiagnostic({
      source: "app-update",
      details: describePendingUpdate(pendingUpdate, "update-verification", failureReason),
    });
    setHasUpdateAvailable(false);
    hasUpdateAvailableRef.current = false;
    setStatus("error");
    setMessage(UPDATE_FAILURE_MESSAGE);
    showUpdateFailureNotice(UPDATE_FAILURE_MESSAGE);
  }, []);

  const applyUpdate = useCallback((): void => {
    const buildId = remoteBuildIdRef.current;
    const outcome = preparationOutcomeRef.current;
    if (
      !hasUpdateAvailableRef.current ||
      applyingUpdateRef.current ||
      !buildId ||
      !outcome ||
      outcome.buildId !== buildId
    )
      return;

    applyingUpdateRef.current = true;
    dismissedBuildIdsRef.current.add(buildId);
    setHasUpdateAvailable(false);
    setStatus("reloading");
    setMessage("正在切换到新版…");
    toast.loading("正在切换到新版…", {
      id: UPDATE_NOTICE_ID,
      duration: Number.POSITIVE_INFINITY,
    });

    const ownerTabId = getUpdateTabId();
    if (!ownerTabId) {
      const storageFailureMessage =
        "无法安全记录当前页面，已暂停自动更新。请稍后重试；若仍失败，请关闭此页面后重新进入。";
      reportAppDiagnostic({
        source: "app-update",
        details:
          "Stage: update-tab-identity\nCould not persist the current tab identity in session storage.",
      });
      setStatus("error");
      setMessage(storageFailureMessage);
      toast.dismiss(UPDATE_NOTICE_ID);
      toast.error("无法安全启动更新", { description: storageFailureMessage });
      applyingUpdateRef.current = false;
      return;
    }

    const pendingUpdate: PendingAppUpdate = {
      ownerTabId,
      sourceBuildId: __APP_BUILD_ID__,
      targetBuildId: remoteBuildIdRef.current ?? "unknown",
      startedAt: Date.now(),
      forcedReloads: 0,
      phase: "preparing",
    };
    if (!writePendingAppUpdate(pendingUpdate)) {
      reportAppDiagnostic({
        source: "app-update",
        details: [
          "Stage: update-state-storage",
          `Local build: ${pendingUpdate.sourceBuildId}`,
          `Remote build: ${pendingUpdate.targetBuildId}`,
          "Could not persist the update state; update activation was stopped to prevent a reload loop without confirmation.",
        ].join("\n"),
      });
      setStatus("error");
      const storageFailureMessage =
        "无法安全记录更新状态，已暂停自动刷新以避免循环。请稍后重试；若仍失败，请关闭此页面后重新进入。";
      setMessage(storageFailureMessage);
      toast.dismiss(UPDATE_NOTICE_ID);
      toast.error("无法安全启动更新", { description: storageFailureMessage });
      applyingUpdateRef.current = false;
      return;
    }

    if (outcome.status === "error") {
      if (requestForcedUpdateReload(pendingUpdate, outcome.diagnostic)) {
        setMessage("正在强制刷新并尝试加载新版…");
        return;
      }
      clearPendingAppUpdate(ownerTabId);
      applyingUpdateRef.current = false;
      setStatus("error");
      setMessage(UPDATE_FAILURE_MESSAGE);
      toast.dismiss(UPDATE_NOTICE_ID);
      showUpdateFailureNotice(UPDATE_FAILURE_MESSAGE);
      return;
    }

    const refreshRequestedUpdate = markUpdateRefreshRequested(pendingUpdate);
    if (!refreshRequestedUpdate) {
      clearPendingAppUpdate(ownerTabId);
      applyingUpdateRef.current = false;
      setStatus("error");
      setMessage("无法安全确认刷新状态，暂未启用新版。请重新检查更新后重试。");
      toast.dismiss(UPDATE_NOTICE_ID);
      toast.error("无法安全启用更新", {
        description: "刷新状态保存失败，已取消自动刷新以避免循环。",
      });
      return;
    }

    if (!applyAvailableUpdate(outcome.preparedUpdate)) {
      const waitingWorker = outcome.preparedUpdate.registration.waiting;
      const diagnostic = [
        "Stage: apply-update",
        `Expected waiting worker state: installed; actual state: ${waitingWorker?.state ?? "no waiting worker"}.`,
      ].join("\n");
      reportAppDiagnostic({ source: "app-update", details: diagnostic });
      if (requestForcedUpdateReload(refreshRequestedUpdate, diagnostic)) {
        setMessage("新版启用未完成，正在强制刷新尝试加载…");
        return;
      }

      clearPendingAppUpdate(ownerTabId);
      applyingUpdateRef.current = false;
      setStatus("error");
      setMessage(UPDATE_FAILURE_MESSAGE);
      toast.dismiss(UPDATE_NOTICE_ID);
      showUpdateFailureNotice(UPDATE_FAILURE_MESSAGE);
      return;
    }

    setMessage("正在重新加载…");
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let disposed = false;

    const checkForUpdate = async (): Promise<void> => {
      if (
        disposed ||
        startupUpdateRecoveryHandledRef.current ||
        document.visibilityState === "hidden"
      )
        return;

      try {
        const result = await runVersionCheck();
        if (result.status === "error") {
          reportAppDiagnostic({
            source: "app-update",
            details: result.diagnostic,
            notify: false,
          });
          return;
        }
        if (result.status !== "available") return;

        if (!disposed) {
          acceptAvailableBuild(result.buildId, false);
        }
      } catch {
        // A failed automatic check is transient; the next interval, focus, or reconnect retries it.
      }
    };

    const checkWhenVisible = (): void => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    const intervalId = window.setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    void checkForUpdate();

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [acceptAvailableBuild, runVersionCheck]);

  useEffect(() => {
    if (!hasUpdateAvailable || !preparationOutcome) return;
    const buildId = remoteBuildIdRef.current;
    if (
      !buildId ||
      preparationOutcome.buildId !== buildId ||
      dismissedBuildIdsRef.current.has(buildId)
    )
      return;

    let actionStarted = false;
    const suppressBuildNotice = (): void => {
      if (actionStarted) return;
      dismissedBuildIdsRef.current.add(buildId);
      setHasUpdateAvailable(false);
      setStatus("idle");
      setMessage("");
    };
    const ready = preparationOutcome.status === "prepared";
    toast.warning("新版已发布，快来试试吧～", {
      id: UPDATE_NOTICE_ID,
      description: ready
        ? "新版资源已在后台准备好，点击后即可切换。"
        : "后台准备未成功，点击将强制刷新并尝试加载新版。",
      duration: UPDATE_NOTICE_DURATION_MS,
      onAutoClose: suppressBuildNotice,
      onDismiss: suppressBuildNotice,
      action: {
        label: ready ? "立即使用新版" : "刷新试试",
        onClick: () => {
          actionStarted = true;
          applyUpdate();
        },
      },
    });
    return () => {
      if (!actionStarted) toast.dismiss(UPDATE_NOTICE_ID);
    };
  }, [applyUpdate, hasUpdateAvailable, preparationOutcome]);

  return {
    status,
    message,
    hasUpdateAvailable,
    hasPreparedUpdate: preparationOutcome?.status === "prepared",
    checkForUpdates,
    applyUpdate,
  };
}
