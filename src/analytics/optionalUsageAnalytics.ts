/**
 * Loads the privately hosted usage collector only in builds that opt in.
 * Public and local builds without the two environment values remain no-op.
 */
export function startOptionalUsageAnalytics(): void {
  try {
    const scriptUrl = import.meta.env.VITE_PIANO_ANALYTICS_SCRIPT_URL?.trim();
    const endpoint = import.meta.env.VITE_PIANO_ANALYTICS_ENDPOINT?.trim();
    if (!scriptUrl || !endpoint || typeof document === "undefined") return;

    const script = document.createElement("script");
    script.async = true;
    script.src = scriptUrl;
    script.dataset.endpoint = endpoint;
    script.onerror = () => undefined;
    document.head.append(script);
  } catch {
    // Telemetry bootstrap must never prevent the learning app from starting.
  }
}
