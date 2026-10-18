export const B6_SWIFTF0_REMINDER_KEY = "anki-note.practiceMicrophone.b6SwiftF0ReminderDate.v1";

let shownDateInMemory: string | null = null;

function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function isB6SwiftF0ReminderShownToday(
  storage?: Pick<Storage, "getItem">,
  now = new Date()
): boolean {
  const today = localDateKey(now);
  if (!storage && shownDateInMemory === today) return true;

  try {
    return (storage ?? getLocalStorage())?.getItem(B6_SWIFTF0_REMINDER_KEY) === today;
  } catch {
    return !storage && shownDateInMemory === today;
  }
}

export function markB6SwiftF0ReminderShownToday(
  storage?: Pick<Storage, "setItem">,
  now = new Date()
): void {
  const today = localDateKey(now);
  if (!storage) shownDateInMemory = today;

  try {
    (storage ?? getLocalStorage())?.setItem(B6_SWIFTF0_REMINDER_KEY, today);
  } catch {
    // The reminder still stays suppressed for this tab if storage is unavailable.
  }
}
