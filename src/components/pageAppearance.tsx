import { createContext, useContext, type ReactNode } from "react";

export type PageAppearanceMode = "off" | "on" | "auto";

export interface PageAppearancePreferences {
  endHour: number;
  mode: PageAppearanceMode;
  startHour: number;
}

export const PAGE_APPEARANCE_PREFERENCES_KEY = "anki-note.pageAppearancePreferences";
export const DEFAULT_PAGE_APPEARANCE_PREFERENCES: PageAppearancePreferences = {
  endHour: 7,
  mode: "off",
  startHour: 19,
};

const PageAppearanceContext = createContext(false);

export function parsePageAppearancePreferences(
  value: unknown,
  fallback: PageAppearancePreferences,
): PageAppearancePreferences {
  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const stored = value as Partial<PageAppearancePreferences>;
  return {
    endHour: isHour(stored.endHour) ? stored.endHour : fallback.endHour,
    mode: stored.mode === "off" || stored.mode === "on" || stored.mode === "auto" ? stored.mode : fallback.mode,
    startHour: isHour(stored.startHour) ? stored.startHour : fallback.startHour,
  };
}

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

export function isNightHour(hour: number, startHour: number, endHour: number): boolean {
  if (!isHour(hour) || !isHour(startHour) || !isHour(endHour)) {
    return false;
  }
  if (startHour === endHour) {
    return true;
  }
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

export function resolveNightMode(
  preferences: PageAppearancePreferences,
  now: Date,
): boolean {
  if (preferences.mode === "on") {
    return true;
  }
  if (preferences.mode === "off") {
    return false;
  }
  return isNightHour(now.getHours(), preferences.startHour, preferences.endHour);
}

export function PageAppearanceProvider({
  children,
  isNightMode,
}: {
  children: ReactNode;
  isNightMode: boolean;
}): JSX.Element {
  return <PageAppearanceContext.Provider value={isNightMode}>{children}</PageAppearanceContext.Provider>;
}

export function useNightMode(): boolean {
  return useContext(PageAppearanceContext);
}

export function getPageThemeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
