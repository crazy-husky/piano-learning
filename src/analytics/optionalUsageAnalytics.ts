export interface UsageAnalyticsEvent {
  name: string;
  properties: Record<string, string | number | boolean | null>;
}

declare global {
  interface Window {
    __PIANO_ANALYTICS_EVENT_QUEUE__?: UsageAnalyticsEvent[];
    __PIANO_ANALYTICS_TRACK__?: (event: UsageAnalyticsEvent) => void;
  }
}

let analyticsEnabled = false;

/**
 * Loads the privately hosted usage collector only in builds that opt in.
 * Public and local builds without the two environment values remain no-op.
 */
export function startOptionalUsageAnalytics(): void {
  try {
    const scriptUrl = import.meta.env.VITE_PIANO_ANALYTICS_SCRIPT_URL?.trim();
    const endpoint = import.meta.env.VITE_PIANO_ANALYTICS_ENDPOINT?.trim();
    if (!scriptUrl || !endpoint || typeof document === "undefined") return;

    analyticsEnabled = true;
    window.__PIANO_ANALYTICS_EVENT_QUEUE__ ??= [];
    const script = document.createElement("script");
    script.async = true;
    script.src = scriptUrl;
    script.dataset.endpoint = endpoint;
    script.dataset.appVersion = __APP_VERSION__;
    script.dataset.appBuildId = __APP_BUILD_ID__;
    script.dataset.appBuildTime = __APP_BUILD_TIME__;
    script.dataset.appEnvironment = import.meta.env.MODE;
    script.dataset.eventSchemaVersion = "1";
    script.onerror = () => undefined;
    document.head.append(script);
  } catch {
    // Telemetry bootstrap must never prevent the learning app from starting.
  }
}

export function trackUsageEvent(
  name: string,
  properties: UsageAnalyticsEvent["properties"] = {}
): void {
  try {
    if (!analyticsEnabled || typeof window === "undefined") return;
    const event = { name, properties };
    if (window.__PIANO_ANALYTICS_TRACK__) {
      window.__PIANO_ANALYTICS_TRACK__(event);
      return;
    }
    const queue = (window.__PIANO_ANALYTICS_EVENT_QUEUE__ ??= []);
    if (queue.length >= 50) queue.shift();
    queue.push(event);
  } catch {
    // Analytics is best effort and must not affect the learning flow.
  }
}
