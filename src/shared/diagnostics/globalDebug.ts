import { announceLocalStoragePreferenceChange } from "../../storage/localPreferenceEvents";

export const GLOBAL_DEBUG_ENABLED_KEY = "anki-note.globalDebugEnabled";
export const GLOBAL_DEBUG_MODE_CHANGE_EVENT = "piano-learning:global-debug-mode-change";
export const GLOBAL_DEBUG_ENTRY_EVENT = "piano-learning:global-debug-entry";

const MAX_GLOBAL_DEBUG_EVENTS = 300;
const MAX_EVENT_DATA_LENGTH = 4_000;

export interface GlobalDebugEvent {
  at: string;
  elapsedMs: number;
  category: string;
  event: string;
  page: string;
  data: Record<string, unknown>;
}

let events: GlobalDebugEvent[] = [];
let sessionStartedAt: number | null = null;

export function isGlobalDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GLOBAL_DEBUG_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function dispatchEntriesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GLOBAL_DEBUG_ENTRY_EVENT));
}

function currentPage(): string {
  if (typeof window === "undefined") return "unavailable";
  const route = window.location.hash.split("?")[0];
  return `${window.location.pathname}${route}`;
}

function normalizeEventData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const serialized = JSON.stringify(data);
    if (!serialized) return {};
    if (serialized.length > MAX_EVENT_DATA_LENGTH) {
      return {
        truncated: true,
        preview: serialized.slice(0, MAX_EVENT_DATA_LENGTH),
      };
    }
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return { unavailable: "Event data could not be serialized." };
  }
}

export function recordGlobalDebugEvent(
  category: string,
  event: string,
  data: Record<string, unknown> = {}
): void {
  if (!isGlobalDebugEnabled()) return;
  const now = Date.now();
  sessionStartedAt ??= now;
  events.push({
    at: new Date(now).toISOString(),
    elapsedMs: Math.max(0, now - sessionStartedAt),
    category,
    event,
    page: currentPage(),
    data: normalizeEventData(data),
  });
  if (events.length > MAX_GLOBAL_DEBUG_EVENTS) {
    events = events.slice(-MAX_GLOBAL_DEBUG_EVENTS);
  }
  dispatchEntriesChanged();
}

export function getGlobalDebugEvents(): GlobalDebugEvent[] {
  return events.map((entry) => ({ ...entry, data: { ...entry.data } }));
}

export function clearGlobalDebugEvents(): void {
  events = [];
  sessionStartedAt = isGlobalDebugEnabled() ? Date.now() : null;
  dispatchEntriesChanged();
}

export function setGlobalDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const wasEnabled = isGlobalDebugEnabled();
  try {
    if (enabled) window.localStorage.setItem(GLOBAL_DEBUG_ENABLED_KEY, "true");
    else window.localStorage.removeItem(GLOBAL_DEBUG_ENABLED_KEY);
  } catch {
    // Debug preferences should not block access to the settings page.
  }

  const nextEnabled = isGlobalDebugEnabled();
  if (!nextEnabled || !wasEnabled) clearGlobalDebugEvents();
  if (nextEnabled && !wasEnabled) sessionStartedAt = Date.now();
  window.dispatchEvent(
    new CustomEvent(GLOBAL_DEBUG_MODE_CHANGE_EVENT, { detail: { enabled: nextEnabled } })
  );
  announceLocalStoragePreferenceChange(GLOBAL_DEBUG_ENABLED_KEY);
  if (nextEnabled && !wasEnabled) {
    recordGlobalDebugEvent("app", "全局调试已开启");
  }
}
