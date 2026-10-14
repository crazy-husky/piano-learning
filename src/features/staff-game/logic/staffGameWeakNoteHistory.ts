const WEAK_NOTE_HISTORY_KEY = "anki-note.staffGameWeakNoteHistory.v1";
const WEAK_NOTE_HISTORY_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const WEAK_NOTE_WEIGHT_MAX = 6;

interface WeakNoteEntry {
  midi: number;
  weight: number;
  updatedAt: number;
}

interface WeakNoteHistory {
  version: 1;
  notes: WeakNoteEntry[];
}

export type StaffGameWeakNoteWeights = Map<number, number>;

function readEntries(now: number): WeakNoteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(WEAK_NOTE_HISTORY_KEY) ?? "null"
    ) as Partial<WeakNoteHistory> | null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.notes)) return [];
    return parsed.notes.filter(
      (entry): entry is WeakNoteEntry =>
        Number.isInteger(entry?.midi) &&
        entry.midi >= 0 &&
        entry.midi <= 127 &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0 &&
        entry.weight <= WEAK_NOTE_WEIGHT_MAX &&
        Number.isFinite(entry.updatedAt) &&
        now - entry.updatedAt <= WEAK_NOTE_HISTORY_MAX_AGE_MS
    );
  } catch {
    return [];
  }
}

export function readStaffGameWeakNoteWeights(now = Date.now()): StaffGameWeakNoteWeights {
  return new Map(readEntries(now).map(({ midi, weight }) => [midi, weight]));
}

export function updateStaffGameWeakNoteWeights(
  outcomes: Iterable<{ midi: number; firstInputCorrect: boolean | null }>,
  now = Date.now()
): StaffGameWeakNoteWeights {
  const entries = new Map(
    readEntries(now).map(({ midi, weight }) => [midi, { weight, updatedAt: now }])
  );

  for (const outcome of outcomes) {
    const current = entries.get(outcome.midi)?.weight ?? 0;
    const nextWeight =
      outcome.firstInputCorrect === true
        ? Math.max(0, current - 1)
        : Math.min(WEAK_NOTE_WEIGHT_MAX, current + 2);
    if (nextWeight === 0) entries.delete(outcome.midi);
    else entries.set(outcome.midi, { weight: nextWeight, updatedAt: now });
  }

  const nextEntries = [...entries].map(([midi, entry]) => ({ midi, ...entry }));
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        WEAK_NOTE_HISTORY_KEY,
        JSON.stringify({ version: 1, notes: nextEntries } satisfies WeakNoteHistory)
      );
    } catch {
      // Keeping the current result useful should not depend on local storage being writable.
    }
  }
  return new Map(nextEntries.map(({ midi, weight }) => [midi, weight]));
}
