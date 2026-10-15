import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { isNightHour, type PageAppearancePreferences } from "../shared/appearance/pageAppearance";

const NIGHT_MODE_SUGGESTION_LAST_SHOWN_KEY = "anki-note.nightModeSuggestionLastShownAt";
const NIGHT_MODE_SUGGESTION_TOAST_ID = "automatic-night-mode-suggestion";
const NIGHT_MODE_SUGGESTION_COOLDOWN_MS = 72 * 60 * 60 * 1_000;

interface NightModeSuggestionRecord {
  ownerId: string;
  shownAt: number;
}

interface UseNightModeSuggestionOptions {
  appearanceTimestamp: number;
  pageAppearancePreferences: PageAppearancePreferences;
  setAppearanceTimestamp: Dispatch<SetStateAction<number>>;
  setPageAppearancePreferences: Dispatch<SetStateAction<PageAppearancePreferences>>;
}

function readSuggestionRecord(): NightModeSuggestionRecord | null {
  try {
    const storedValue = window.localStorage.getItem(NIGHT_MODE_SUGGESTION_LAST_SHOWN_KEY);
    if (storedValue === null) return null;
    const parsed: unknown = JSON.parse(storedValue);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Partial<NightModeSuggestionRecord>;
    return typeof record.ownerId === "string" &&
      typeof record.shownAt === "number" &&
      Number.isFinite(record.shownAt) &&
      record.shownAt >= 0
      ? { ownerId: record.ownerId, shownAt: record.shownAt }
      : null;
  } catch {
    return null;
  }
}

function createOwnerId(): string {
  return typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function useNightModeSuggestion({
  appearanceTimestamp,
  pageAppearancePreferences,
  setAppearanceTimestamp,
  setPageAppearancePreferences,
}: UseNightModeSuggestionOptions): void {
  const latestPreferencesRef = useRef(pageAppearancePreferences);
  latestPreferencesRef.current = pageAppearancePreferences;
  const lastSuggestionTimestampRef = useRef<number | null>(null);
  const ownerIdRef = useRef<string | null>(null);
  ownerIdRef.current ??= createOwnerId();

  useEffect(() => {
    if (document.visibilityState !== "visible") {
      toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID);
      return;
    }

    const now = new Date(appearanceTimestamp);
    const shouldSuggest =
      pageAppearancePreferences.mode === "off" &&
      isNightHour(
        now.getHours(),
        pageAppearancePreferences.startHour,
        pageAppearancePreferences.endHour
      );
    if (!shouldSuggest) {
      toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID);
      return;
    }

    const storedRecord = readSuggestionRecord();
    const storedTimestamp = storedRecord?.shownAt ?? null;
    const lastSuggestionTimestamp = Math.max(
      storedTimestamp ?? 0,
      lastSuggestionTimestampRef.current ?? 0
    );
    if (
      lastSuggestionTimestamp > 0 &&
      appearanceTimestamp < lastSuggestionTimestamp + NIGHT_MODE_SUGGESTION_COOLDOWN_MS
    ) {
      return;
    }

    const ownerId = ownerIdRef.current ?? createOwnerId();
    ownerIdRef.current = ownerId;
    const record: NightModeSuggestionRecord = {
      ownerId,
      shownAt: appearanceTimestamp,
    };
    lastSuggestionTimestampRef.current = appearanceTimestamp;
    try {
      window.localStorage.setItem(NIGHT_MODE_SUGGESTION_LAST_SHOWN_KEY, JSON.stringify(record));
      const confirmedRecord = readSuggestionRecord();
      if (confirmedRecord && confirmedRecord.ownerId !== record.ownerId) return;
    } catch {
      // Keep the three-day cooldown for this open page if persistent storage is unavailable.
    }

    toast.info("现在是夜间时段，要开启自动夜间模式吗？", {
      id: NIGHT_MODE_SUGGESTION_TOAST_ID,
      description: "夜间配色更柔和，阅读更舒适。",
      duration: 12_000,
      action: {
        label: "开启",
        onClick: () => {
          const preferences = latestPreferencesRef.current;
          setPageAppearancePreferences((current) => ({ ...current, mode: "auto" }));
          setAppearanceTimestamp(Date.now());
          toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID);
          toast.success("自动夜间模式已开启", {
            description: `每天 ${formatHour(preferences.startHour)}–${formatHour(preferences.endHour)} 自动切换；可在“设置 → 页面设置”调整时段。`,
            duration: 3_000,
          });
        },
      },
      cancel: {
        label: "暂不",
        onClick: () => toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID),
      },
    });
  }, [
    appearanceTimestamp,
    pageAppearancePreferences,
    setAppearanceTimestamp,
    setPageAppearancePreferences,
  ]);

  useEffect(() => {
    const synchronizeSuggestion = (event: StorageEvent): void => {
      if (event.key !== NIGHT_MODE_SUGGESTION_LAST_SHOWN_KEY || event.newValue === null) return;
      const record = readSuggestionRecord();
      if (!record) return;
      lastSuggestionTimestampRef.current = Math.max(
        lastSuggestionTimestampRef.current ?? 0,
        record.shownAt
      );
      if (record.ownerId !== ownerIdRef.current) {
        toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID);
      }
    };

    window.addEventListener("storage", synchronizeSuggestion);
    return () => {
      window.removeEventListener("storage", synchronizeSuggestion);
      toast.dismiss(NIGHT_MODE_SUGGESTION_TOAST_ID);
    };
  }, []);
}
