const LEGACY_WEAK_NOTE_HISTORY_KEY = "anki-note.staffGameWeakNoteHistory.v1";
const WEAK_NOTE_HISTORY_KEY = "anki-note.staffGameWeakNoteHistory.v2";
const WEAK_NOTE_HISTORY_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const WEAK_NOTE_WEIGHT_MAX = 6;

interface WeakNoteEntry {
  midi: number;
  weight: number;
  lastErrorAt: number;
}

interface WeakNoteHistory {
  version: 2;
  notes: WeakNoteEntry[];
}

export type StaffGameWeakNoteWeights = Map<number, number>;

function readEntries(now: number): WeakNoteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    window.localStorage.removeItem(LEGACY_WEAK_NOTE_HISTORY_KEY);
  } catch {
    // Legacy weak-note weights are disposable derived data.
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(WEAK_NOTE_HISTORY_KEY) ?? "null"
    ) as Partial<WeakNoteHistory> | null;
    if (parsed?.version !== 2 || !Array.isArray(parsed.notes)) return [];
    return parsed.notes.filter(
      (entry): entry is WeakNoteEntry =>
        Number.isInteger(entry?.midi) &&
        entry.midi >= 0 &&
        entry.midi <= 127 &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0 &&
        entry.weight <= WEAK_NOTE_WEIGHT_MAX &&
        Number.isFinite(entry.lastErrorAt) &&
        now - entry.lastErrorAt <= WEAK_NOTE_HISTORY_MAX_AGE_MS
    );
  } catch {
    return [];
  }
}

export function readStaffGameWeakNoteWeights(now = Date.now()): StaffGameWeakNoteWeights {
  return new Map(readEntries(now).map(({ midi, weight }) => [midi, weight]));
}

export function updateStaffGameWeakNoteWeights(
  outcomes: Iterable<{
    midi: number;
    firstInputCorrect: boolean | null;
    errorAt?: number;
  }>,
  now = Date.now()
): StaffGameWeakNoteWeights {
  const entries = new Map(
    readEntries(now).map(({ midi, weight, lastErrorAt }) => [midi, { weight, lastErrorAt }])
  );

  for (const outcome of outcomes) {
    const current = entries.get(outcome.midi);
    const currentWeight = current?.weight ?? 0;
    if (outcome.firstInputCorrect === true) {
      const nextWeight = Math.max(0, currentWeight - 1);
      if (nextWeight === 0) entries.delete(outcome.midi);
      else if (current) entries.set(outcome.midi, { ...current, weight: nextWeight });
      continue;
    }

    const reportedErrorAt = outcome.errorAt;
    const errorAt = Number.isFinite(reportedErrorAt) ? reportedErrorAt! : now;
    entries.set(outcome.midi, {
      weight: Math.min(WEAK_NOTE_WEIGHT_MAX, currentWeight + 2),
      lastErrorAt: Math.max(current?.lastErrorAt ?? Number.NEGATIVE_INFINITY, errorAt),
    });
  }

  const nextEntries = [...entries].map(([midi, entry]) => ({ midi, ...entry }));
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        WEAK_NOTE_HISTORY_KEY,
        JSON.stringify({ version: 2, notes: nextEntries } satisfies WeakNoteHistory)
      );
    } catch {
      // Keeping the current result useful should not depend on local storage being writable.
    }
  }
  return new Map(nextEntries.map(({ midi, weight }) => [midi, weight]));
}
