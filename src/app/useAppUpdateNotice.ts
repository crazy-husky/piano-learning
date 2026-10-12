import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reportAppDiagnostic } from "../shared/diagnostics/appDiagnostics";

const UPDATE_CHECK_INTERVAL_MS = 60_000;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const WORKER_INSTALL_TIMEOUT_MS = 120_000;
const WORKER_ACTIVATION_TIMEOUT_MS = 15_000;
const UPDATE_NOTICE_ID = "app-update-available";

interface BuildVersionResponse {
  version?: unknown;
  buildTime?: unknown;
  buildId?: unknown;
}

export type AppUpdateStatus =
  "idle" | "checking" | "up-to-date" | "available" | "preparing" | "error";

export interface AppUpdateController {
  status: AppUpdateStatus;
  message: string;
  hasUpdateAvailable: boolean;
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

type ServiceWorkerReadyResult =
  | { state: "waiting"; worker: ServiceWorker }
  | { state: "activated"; worker: ServiceWorker }
  | { state: "failed"; worker: ServiceWorker | null }
  | { state: "timeout"; worker: ServiceWorker | null };

type ServiceWorkerUpdateResult =
  | { status: "prepared"; preparedUpdate: PreparedServiceWorkerUpdate }
  | { status: "error"; diagnostic: string };

interface PreparedServiceWorkerUpdate {
  registration: ServiceWorkerRegistration;
  result: Extract<ServiceWorkerReadyResult, { state: "waiting" | "activated" }>;
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

async function stageServiceWorkerUpdate(): Promise<ServiceWorkerUpdateResult> {
  if (!("serviceWorker" in navigator)) {
    return {
      status: "error",
      diagnostic: "Stage: service-worker-registration\nService Worker API is unavailable.",
    };
  }

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
  } catch (error) {
    return {
      status: "error",
      diagnostic: `Stage: service-worker-registration\ngetRegistration() failed:\n${describeThrownValue(error)}`,
    };
  }
  if (!registration) {
    return {
      status: "error",
      diagnostic:
        "Stage: service-worker-registration\nNo Service Worker registration was found for this page.",
    };
  }

  try {
    if (registration.waiting) {
      return {
        status: "prepared",
        preparedUpdate: {
          registration,
          result: { state: "waiting", worker: registration.waiting },
        },
      };
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
      return {
        status: "prepared",
        preparedUpdate: {
          registration,
          result: { state: "waiting", worker: registration.waiting },
        },
      };
    }
    if (registration.active && registration.active !== previousActiveWorker) {
      return {
        status: "prepared",
        preparedUpdate: {
          registration,
          result: { state: "activated", worker: registration.active },
        },
      };
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
    return {
      status: "prepared",
      preparedUpdate: { registration, result },
    };
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
  const hasUpdateAvailableRef = useRef(false);
  const remoteBuildIdRef = useRef<string | null>(null);
  const preparationInProgressRef = useRef(false);
  const activeCheckRef = useRef<Promise<VersionCheckResult> | null>(null);

  const runVersionCheck = useCallback((): Promise<VersionCheckResult> => {
    if (activeCheckRef.current) return activeCheckRef.current;

    const check = checkRemoteVersion();
    activeCheckRef.current = check;
    void check.finally(() => {
      if (activeCheckRef.current === check) activeCheckRef.current = null;
    });
    return check;
  }, []);

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
        toast.dismiss(UPDATE_NOTICE_ID);
        setStatus("up-to-date");
        setMessage("当前已是最新版本");
      } else if (result.status === "available") {
        hasUpdateAvailableRef.current = true;
        remoteBuildIdRef.current = result.buildId;
        setHasUpdateAvailable(true);
        setStatus("available");
        setMessage("发现新版本，可选择立即使用");
      } else {
        reportAppDiagnostic({ source: "app-update", details: result.diagnostic });
        setStatus("error");
        setMessage(navigator.onLine ? "检查失败，请稍后重试" : "当前离线，连接网络后可重试");
      }
    });
  }, [runVersionCheck]);

  const applyUpdate = useCallback(async (): Promise<void> => {
    if (!hasUpdateAvailableRef.current || preparationInProgressRef.current) return;

    preparationInProgressRef.current = true;
    setStatus("preparing");
    setMessage("正在准备新版资源…");
    try {
      const serviceWorkerResult = await stageServiceWorkerUpdate();
      if (serviceWorkerResult.status === "error") {
        reportAppDiagnostic({
          source: "app-update",
          details: [
            "Stage: prepare-update",
            `Local build: ${__APP_BUILD_ID__}`,
            `Remote build: ${remoteBuildIdRef.current ?? "unavailable"}`,
            serviceWorkerResult.diagnostic,
          ].join("\n"),
        });
        setStatus("error");
        setMessage("新版资源准备失败，请查看右下角诊断后重试");
        return;
      }

      if (!applyAvailableUpdate(serviceWorkerResult.preparedUpdate)) {
        const waitingWorker = serviceWorkerResult.preparedUpdate.registration.waiting;
        reportAppDiagnostic({
          source: "app-update",
          details: [
            "Stage: apply-update",
            `Expected waiting worker state: installed; actual state: ${waitingWorker?.state ?? "no waiting worker"}.`,
          ].join("\n"),
        });
        setStatus("error");
        setMessage("新版启用失败，请查看右下角诊断后重试");
        return;
      }

      toast.dismiss(UPDATE_NOTICE_ID);
      setMessage("正在重新加载…");
    } finally {
      preparationInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let disposed = false;
    let updateFound = false;

    const checkForUpdate = async (): Promise<void> => {
      if (
        disposed ||
        updateFound ||
        hasUpdateAvailableRef.current ||
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

        updateFound = true;
        if (!disposed) {
          hasUpdateAvailableRef.current = true;
          remoteBuildIdRef.current = result.buildId;
          setHasUpdateAvailable(true);
          setStatus("available");
          setMessage("发现新版本，可选择立即使用");
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
  }, [runVersionCheck]);

  useEffect(() => {
    if (!hasUpdateAvailable) return;
    toast.warning("发现新版本", {
      id: UPDATE_NOTICE_ID,
      description: "检测到新版本。点击立即使用会下载并缓存新版资源，准备完成后自动刷新页面。",
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "立即使用新版",
        onClick: applyUpdate,
      },
    });
    return () => {
      toast.dismiss(UPDATE_NOTICE_ID);
    };
  }, [applyUpdate, hasUpdateAvailable]);

  return { status, message, hasUpdateAvailable, checkForUpdates, applyUpdate };
}
