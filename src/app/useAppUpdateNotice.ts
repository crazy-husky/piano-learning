import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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

export type AppUpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "error";

export interface AppUpdateController {
  status: AppUpdateStatus;
  message: string;
  checkForUpdates: () => void;
  applyUpdate: () => void;
}

type VersionCheckResult =
  | { status: "up-to-date" }
  | { status: "available"; preparedUpdate: PreparedServiceWorkerUpdate }
  | { status: "error" };

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
  | { state: "failed"; worker: null }
  | { state: "timeout"; worker: null };

interface PreparedServiceWorkerUpdate {
  registration: ServiceWorkerRegistration;
  result: Extract<ServiceWorkerReadyResult, { state: "waiting" | "activated" }>;
}

function waitForWorkerReady(registration: ServiceWorkerRegistration, timeoutMs: number): Promise<ServiceWorkerReadyResult> {
  if (registration.waiting) return Promise.resolve({ state: "waiting", worker: registration.waiting });

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
        finish(registration.active
          ? { state: "activated", worker: registration.active }
          : { state: "failed", worker: null });
      } else if (observedWorker?.state === "redundant") {
        finish({ state: "failed", worker: null });
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
    timeoutId = window.setTimeout(() => finish(registration.waiting
      ? { state: "waiting", worker: registration.waiting }
      : { state: "timeout", worker: null }), timeoutMs);
    watchInstallingWorker();
  });
}

async function stageServiceWorkerUpdate(): Promise<PreparedServiceWorkerUpdate | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    if (registration.waiting) {
      return { registration, result: { state: "waiting", worker: registration.waiting } };
    }

    const previousActiveWorker = registration.active;
    try {
      await registration.update();
    } catch {
      // The version endpoint can update before the service-worker script is reachable.
      return null;
    }

    if (registration.waiting) {
      return { registration, result: { state: "waiting", worker: registration.waiting } };
    }
    if (registration.active && registration.active !== previousActiveWorker) {
      return { registration, result: { state: "activated", worker: registration.active } };
    }
    if (!registration.installing) return null;

    const result = await waitForWorkerReady(registration, WORKER_INSTALL_TIMEOUT_MS);
    if (result.state === "failed" || result.state === "timeout") return null;
    return { registration, result };
  } catch {
    return null;
  }
}

async function checkRemoteVersion(): Promise<VersionCheckResult> {
  if (!navigator.onLine) return { status: "error" };

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(getVersionUrl(), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { status: "error" };

    const payload: unknown = await response.json();
    if (!isBuildVersionResponse(payload) || typeof payload.buildId !== "string" || !payload.buildId) {
      return { status: "error" };
    }
    if (payload.buildId === __APP_BUILD_ID__) return { status: "up-to-date" };

    const preparedUpdate = await stageServiceWorkerUpdate();
    return preparedUpdate ? { status: "available", preparedUpdate } : { status: "error" };
  } catch {
    return { status: "error" };
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
  const [preparedUpdate, setPreparedUpdate] = useState<PreparedServiceWorkerUpdate | null>(null);
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [message, setMessage] = useState("");
  const preparedUpdateRef = useRef<PreparedServiceWorkerUpdate | null>(null);
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
    if (preparedUpdateRef.current) {
      setStatus("available");
      setMessage("发现新版本，已准备好更新");
      return;
    }

    setStatus("checking");
    setMessage("正在检查更新…");
    void runVersionCheck().then((result) => {
      if (result.status === "up-to-date") {
        setStatus("up-to-date");
        setMessage("当前已是最新版本");
      } else if (result.status === "available") {
        preparedUpdateRef.current = result.preparedUpdate;
        setPreparedUpdate(result.preparedUpdate);
        setStatus("available");
        setMessage("发现新版本，已准备好更新");
      } else {
        setStatus("error");
        setMessage(navigator.onLine ? "检查失败，请稍后重试" : "当前离线，连接网络后可重试");
      }
    });
  }, [runVersionCheck]);

  const applyUpdate = useCallback((): void => {
    const update = preparedUpdateRef.current;
    if (!update || !applyAvailableUpdate(update)) {
      preparedUpdateRef.current = null;
      setPreparedUpdate(null);
      toast.dismiss(UPDATE_NOTICE_ID);
      setStatus("error");
      setMessage("新版资源暂不可用，请重新检查");
      return;
    }
    toast.dismiss(UPDATE_NOTICE_ID);
    setMessage("正在重新加载…");
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let disposed = false;
    let updateFound = false;

    const checkForUpdate = async (): Promise<void> => {
      if (disposed || updateFound || preparedUpdateRef.current || document.visibilityState === "hidden") return;

      try {
        const result = await runVersionCheck();
        if (result.status !== "available") return;

        updateFound = true;
        if (!disposed) {
          preparedUpdateRef.current = result.preparedUpdate;
          setPreparedUpdate(result.preparedUpdate);
          setStatus("available");
          setMessage("发现新版本，已准备好更新");
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
    if (!preparedUpdate) return;
    toast.warning("发现新版本", {
      id: UPDATE_NOTICE_ID,
      description: "检测到新版本。点击立即更新会刷新页面；关闭页面后，下次打开将自动使用新版。",
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "立即更新",
        onClick: applyUpdate,
      },
    });
    return () => {
      toast.dismiss(UPDATE_NOTICE_ID);
    };
  }, [applyUpdate, preparedUpdate]);

  return { status, message, checkForUpdates, applyUpdate };
}
