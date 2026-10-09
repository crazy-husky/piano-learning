import { useEffect, useState } from "react";
import { toast } from "sonner";

const UPDATE_CHECK_INTERVAL_MS = 60_000;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const UPDATE_NOTICE_ID = "app-update-available";

interface BuildVersionResponse {
  buildId?: unknown;
}

function getVersionUrl(): URL {
  const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.origin);
  url.searchParams.set("check", String(Date.now()));
  return url;
}

function isBuildVersionResponse(value: unknown): value is BuildVersionResponse {
  return Boolean(value && typeof value === "object" && "buildId" in value);
}

export function useAppUpdateNotice(): void {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let disposed = false;
    let checking = false;
    let updateFound = false;
    let requestController: AbortController | null = null;
    let requestTimeoutId: number | null = null;

    const checkForUpdate = async (): Promise<void> => {
      if (disposed || checking || updateFound || document.visibilityState === "hidden") return;
      checking = true;
      requestController = new AbortController();
      requestTimeoutId = window.setTimeout(() => requestController?.abort(), UPDATE_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch(getVersionUrl(), {
          cache: "no-store",
          signal: requestController.signal,
        });
        if (!response.ok) return;

        const payload: unknown = await response.json();
        if (!isBuildVersionResponse(payload) || typeof payload.buildId !== "string" || !payload.buildId) return;
        if (payload.buildId === __APP_BUILD_ID__) return;

        updateFound = true;
        if (!disposed) setUpdateAvailable(true);
      } catch {
        // A failed check is transient; the next interval, focus, or reconnect retries it.
      } finally {
        if (requestTimeoutId !== null) window.clearTimeout(requestTimeoutId);
        requestTimeoutId = null;
        requestController = null;
        checking = false;
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
      if (requestTimeoutId !== null) window.clearTimeout(requestTimeoutId);
      requestController?.abort();
    };
  }, []);

  useEffect(() => {
    if (!updateAvailable) return;
    toast.warning("发现新版本", {
      id: UPDATE_NOTICE_ID,
      description: "刷新页面后即可使用最新版本。",
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "刷新页面",
        onClick: () => window.location.reload(),
      },
    });
    return () => {
      toast.dismiss(UPDATE_NOTICE_ID);
    };
  }, [updateAvailable]);
}
