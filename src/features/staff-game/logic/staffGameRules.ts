// ⚠️ [错题袋覆盖]。详见 docs/product-decisions.md
import type { NoteName, PianoKeyName, StaffGameChallengeMode } from "../../../domain/types";

export type GameDifficulty = "muggle" | "leisure" | "easy" | "normal" | "hard" | "nightmare";
export type { StaffGameChallengeMode };
export type StaffGameArcadeDuration = "level-default" | 60_000 | 120_000 | 180_000;
export type StaffGameNotePoolScope = "current-group" | "all-history" | "all-history-current-clef";
export type StaffGameNoteSchedulingStrategy = "random" | "system";

export interface StaffGamePitch {
  midi: number;
  name: PianoKeyName;
  octave: number;
}

export const GAME_LEVEL_COUNT = 60;
export const BUBBLE_FADE_IN_MS = 200;
export const LATE_PREVIOUS_INPUT_WINDOW_MS = 400;
export const ACCURACY_STAR_THRESHOLDS = [60, 75, 90] as const;
export const RUSH_MODE_COMBO_THRESHOLD = 5;
export const COMBO_BONUS_MAX_STEPS = 5;
export const RUSH_SCORE_MULTIPLIER = 2;
export const COMBO_INDICATOR_FADE_DURATION_MS = 280;
export const RUSH_FALL_SPEED_MULTIPLIER = 0.92;
export const ERROR_FLASH_DURATION_MS = 1_500;
export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const SOLFEGE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"] as const;

export function staffGameSolfegeLabel(pitch: PianoKeyName): string {
  const noteIndex = NOTE_NAMES.indexOf(pitch[0] as NoteName);
  const isSharp = pitch.includes("#");
  return `${SOLFEGE_NAMES[noteIndex]}${isSharp ? "♯" : ""}`;
}

export function staffGameReactionMs(correctAtMs: number, spawnAtMs: number): number {
  return correctAtMs - spawnAtMs - BUBBLE_FADE_IN_MS;
}

export const PITCH_NAMES: PianoKeyName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export const BLACK_KEY_NOTES: Array<{ pitch: PianoKeyName; className: string }> = [
  { pitch: "C#", className: "key-cs" },
  { pitch: "D#", className: "key-ds" },
  { pitch: "F#", className: "key-fs" },
  { pitch: "G#", className: "key-gs" },
  { pitch: "A#", className: "key-as" },
];
export const COMPUTER_KEY_PITCHES: Record<string, PianoKeyName> = {
  KeyA: "C",
  KeyS: "D",
  KeyD: "E",
  KeyF: "F",
  KeyG: "G",
  KeyH: "A",
  KeyJ: "B",
  KeyW: "C#",
  KeyE: "D#",
  KeyT: "F#",
  KeyY: "G#",
  KeyU: "A#",
};
// Five complete octaves, C2 through B6. This keeps every octave's seven white
// keys and five black keys together in the level progression.
const GAME_NOTE_MIDI_RANGE = { min: 36, max: 95 } as const;
export const GAME_NOTE_PROGRESSION: Array<{ midi: number; name: PianoKeyName; octave: number }> =
  (() => {
    const pitchForMidi = (midi: number) => ({
      midi,
      name: PITCH_NAMES[((midi % 12) + 12) % 12],
      octave: Math.floor(midi / 12) - 1,
    });
    const whiteNotes = Array.from(
      { length: GAME_NOTE_MIDI_RANGE.max - GAME_NOTE_MIDI_RANGE.min + 1 },
      (_, index) => pitchForMidi(GAME_NOTE_MIDI_RANGE.min + index)
    ).filter((note) => !note.name.includes("#"));
    const blackNotes = Array.from(
      { length: GAME_NOTE_MIDI_RANGE.max - GAME_NOTE_MIDI_RANGE.min + 1 },
      (_, index) => pitchForMidi(GAME_NOTE_MIDI_RANGE.min + index)
    ).filter((note) => note.name.includes("#"));
    const interleaveOctaves = (notes: typeof whiteNotes) =>
      [4, 3, 5, 2, 6].flatMap((octave) =>
        notes
          .filter((note) => note.octave === octave)
          .sort((first, second) => first.midi - second.midi)
      );
    return [...interleaveOctaves(whiteNotes), ...interleaveOctaves(blackNotes)];
  })();

export function gameDurationMsForLevel(level: number): number {
  if (level === 1) return 15_000;
  if (level === 2) return 20_000;
  if (level <= 3) return 30_000;
  if (level <= 6) return 60_000;
  if (level <= 9) return 120_000;
  return 140_000;
}

export const GAME_DIFFICULTIES: Array<{
  id: GameDifficulty;
  label: string;
  bubbleDurationMs: number;
  comboWindowMs: number;
  correctPoints: number;
  comboBonusPoints: number;
}> = [
  {
    id: "muggle",
    label: "麻瓜",
    bubbleDurationMs: 15_000,
    comboWindowMs: 9_000,
    correctPoints: 6,
    comboBonusPoints: 1,
  },
  {
    id: "leisure",
    label: "悠闲",
    bubbleDurationMs: 10_000,
    comboWindowMs: 6_000,
    correctPoints: 7,
    comboBonusPoints: 2,
  },
  {
    id: "easy",
    label: "简单",
    bubbleDurationMs: 7_000,
    comboWindowMs: 4_200,
    correctPoints: 8,
    comboBonusPoints: 2,
  },
  {
    id: "normal",
    label: "普通",
    bubbleDurationMs: 4_900,
    comboWindowMs: 3_000,
    correctPoints: 10,
    comboBonusPoints: 3,
  },
  {
    id: "hard",
    label: "困难",
    bubbleDurationMs: 3_300,
    comboWindowMs: 2_000,
    correctPoints: 12,
    comboBonusPoints: 4,
  },
  {
    id: "nightmare",
    label: "噩梦",
    bubbleDurationMs: 2_200,
    comboWindowMs: 1_300,
    correctPoints: 15,
    comboBonusPoints: 5,
  },
];

export function gameDifficultyPreset(difficulty: GameDifficulty) {
  return (
    GAME_DIFFICULTIES.find((item) => item.id === difficulty) ??
    GAME_DIFFICULTIES.find((item) => item.id === "normal")!
  );
}

export function starsForAccuracy(correctCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return ACCURACY_STAR_THRESHOLDS.filter(
    (threshold) => correctCount * 100 >= threshold * totalCount
  ).length;
}

export function gameNoteFromMidi(midi: number): StaffGamePitch {
  return {
    midi,
    name: PITCH_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  };
}

export function shuffledItems<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/** Every distinct note in the selected challenge pool appears exactly twice. */
export function learningTestNoteBag(
  level: number,
  notePoolScope: StaffGameNotePoolScope
): StaffGamePitch[] {
  const uniqueNotes = new Map(
    notePoolCandidates(level, notePoolScope).map((note) => [note.midi, note] as const)
  );
  const bag = [...uniqueNotes.values()].flatMap((note) => [{ ...note }, { ...note }]);
  return shuffledItems(bag);
}

/** Draws from a finite learning-test bag without replenishing it. */
export function drawNextLearningTestNote(
  noteBag: StaffGamePitch[],
  recentNoteMidis: number[],
  temporarilyExcludedMidiNotes: ReadonlySet<number> = new Set()
): StaffGamePitch | null {
  const allowedIndices = noteBag.flatMap((note, index) =>
    temporarilyExcludedMidiNotes.has(note.midi) ? [] : [index]
  );
  if (allowedIndices.length === 0) return null;
  const eligibleIndices = allowedIndices.filter((index) =>
    canFollowRecentNotes(noteBag[index]!.midi, recentNoteMidis)
  );
  const chosenIndex = eligibleIndices.length
    ? eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)]!
    : allowedIndices[allowedIndices.length - 1]!;
  return noteBag.splice(chosenIndex, 1)[0] ?? null;
}

export function canFollowRecentNotes(midi: number, recentNoteMidis: number[]): boolean {
  const lastTwo = recentNoteMidis.slice(-2);
  if (lastTwo.length === 2 && lastTwo[0] === midi && lastTwo[1] === midi) return false;

  const lastThree = recentNoteMidis.slice(-3);
  if (lastThree.length === 3 && lastThree[0] === lastThree[2] && lastThree[1] === midi)
    return false;
  return true;
}

export function notePoolCandidates(
  level: number,
  notePoolScope: StaffGameNotePoolScope
): StaffGamePitch[] {
  const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, level);
  const focusNote = unlockedNotes[unlockedNotes.length - 1];
  if (!focusNote) return [];
  if (notePoolScope === "current-group") {
    return unlockedNotes.filter(
      (note) => note.octave === focusNote.octave && note.midi <= focusNote.midi
    );
  }
  if (notePoolScope === "all-history-current-clef") {
    const focusUsesBassClef = focusNote.midi < 60;
    return unlockedNotes.filter((note) => note.midi < 60 === focusUsesBassClef);
  }
  return unlockedNotes;
}

export function gameLevelForNotePoolScope(
  level: number,
  notePoolScope: StaffGameNotePoolScope
): number {
  return notePoolScope === "all-history"
    ? level
    : Math.max(1, notePoolCandidates(level, notePoolScope).length);
}

export function shuffledNoteBag(
  level: number,
  notePoolScope: StaffGameNotePoolScope = "all-history",
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy = "system"
): StaffGamePitch[] {
  const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, level);
  const focusNote = unlockedNotes[unlockedNotes.length - 1];
  if (!focusNote) return [];
  const poolNotes = notePoolCandidates(level, notePoolScope);
  if (noteSchedulingStrategy === "random") {
    return shuffledItems(poolNotes.map((note) => ({ ...note })));
  }

  const bag: typeof GAME_NOTE_PROGRESSION = [];
  const addCopies = (note: (typeof GAME_NOTE_PROGRESSION)[number], count: number): void => {
    for (let index = 0; index < count; index += 1) bag.push({ ...note });
  };
  const addReviewNotes = (pool: typeof GAME_NOTE_PROGRESSION, count: number): void => {
    let remaining = count;
    while (pool.length > 0 && remaining > 0) {
      const cycle = shuffledItems(pool);
      const selected = cycle.slice(0, remaining);
      bag.push(...selected.map((note) => ({ ...note })));
      remaining -= selected.length;
    }
  };

  if (level === 1) {
    addCopies(focusNote, 1);
  } else if (level <= 5) {
    // A 20-note bag keeps the new focus note at 40%, with the rest reviewing earlier notes.
    addCopies(focusNote, 8);
    addReviewNotes(poolNotes.slice(0, -1), 12);
  } else {
    // Keep the focus note at 30%; distribute review slots across the newest five and older notes.
    addCopies(focusNote, 6);
    const earlierNotes = poolNotes.slice(0, -1);
    const recentNotes = earlierNotes.slice(-5);
    const olderNotes = earlierNotes.slice(0, -5);
    if (olderNotes.length === 0) {
      addReviewNotes(recentNotes, 14);
    } else {
      // Let the older-note share grow with its pool so one very old note is not overrepresented early on.
      const olderSlots = Math.min(7, olderNotes.length);
      addReviewNotes(recentNotes, 14 - olderSlots);
      addReviewNotes(olderNotes, olderSlots);
    }
  }

  return shuffledItems(bag);
}

function systemNoteWeights(
  level: number,
  notePoolScope: StaffGameNotePoolScope
): Map<number, number> {
  const poolNotes = notePoolCandidates(level, notePoolScope);
  const focusNote = poolNotes[poolNotes.length - 1];
  const weights = new Map<number, number>();
  if (!focusNote) return weights;

  const addReviewWeights = (pool: StaffGamePitch[], count: number): void => {
    if (pool.length === 0 || count <= 0) return;
    const regularWeightPerNote = count / pool.length;
    for (const note of pool) weights.set(note.midi, regularWeightPerNote);
  };

  if (level <= 5) {
    weights.set(focusNote.midi, 8);
    addReviewWeights(poolNotes.slice(0, -1), 12);
  } else {
    weights.set(focusNote.midi, 6);
    const earlierNotes = poolNotes.slice(0, -1);
    const recentNotes = earlierNotes.slice(-5);
    const olderNotes = earlierNotes.slice(0, -5);
    if (olderNotes.length === 0) {
      addReviewWeights(recentNotes, 14);
    } else {
      const olderSlots = Math.min(7, olderNotes.length);
      addReviewWeights(recentNotes, 14 - olderSlots);
      addReviewWeights(olderNotes, olderSlots);
    }
  }

  return weights;
}

function chooseSystemWeightedNote(
  candidates: StaffGamePitch[],
  level: number,
  notePoolScope: StaffGameNotePoolScope
): StaffGamePitch | null {
  if (candidates.length === 0) return null;
  const weights = systemNoteWeights(level, notePoolScope);
  const totalWeight = candidates.reduce((sum, note) => sum + (weights.get(note.midi) ?? 0), 0);
  if (totalWeight <= 0) return { ...candidates[Math.floor(Math.random() * candidates.length)]! };

  let point = Math.random() * totalWeight;
  const selected = candidates.find((note) => {
    point -= weights.get(note.midi) ?? 0;
    return point < 0;
  });
  return { ...(selected ?? candidates[candidates.length - 1]!) };
}

export function drawNextWrongNoteReviewNote(
  noteBag: StaffGamePitch[],
  recentNoteMidis: number[],
  temporarilyExcludedMidiNotes: ReadonlySet<number> = new Set()
): StaffGamePitch | null {
  if (noteBag.length === 0) return null;
  const allowedIndices = noteBag.flatMap((note, index) =>
    temporarilyExcludedMidiNotes.has(note.midi) ? [] : [index]
  );
  if (allowedIndices.length === 0) return null;
  const eligibleIndices = allowedIndices.filter((index) =>
    canFollowRecentNotes(noteBag[index]!.midi, recentNoteMidis)
  );
  const chosenIndex = eligibleIndices.length
    ? eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)]!
    : allowedIndices[allowedIndices.length - 1]!;
  return noteBag.splice(chosenIndex, 1)[0] ?? null;
}

export function drawNextNote(
  level: number,
  notePool: StaffGamePitch[],
  recentNoteMidis: number[],
  notePoolScope: StaffGameNotePoolScope = "all-history",
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy = "system",
  temporarilyExcludedMidiNotes: ReadonlySet<number> = new Set()
): StaffGamePitch | null {
  const nextBag = (): StaffGamePitch[] =>
    shuffledNoteBag(level, notePoolScope, noteSchedulingStrategy);
  if (level === 1) {
    if (notePool.length === 0) notePool.push(...nextBag());
    let index = notePool.length - 1;
    while (index >= 0 && temporarilyExcludedMidiNotes.has(notePool[index]!.midi)) index -= 1;
    return index < 0 ? null : (notePool.splice(index, 1)[0] ?? null);
  }

  if (notePool.length === 0) notePool.push(...nextBag());
  const candidates = notePoolCandidates(level, notePoolScope);
  const allowedCandidates = candidates.filter(
    (note) => !temporarilyExcludedMidiNotes.has(note.midi)
  );
  if (allowedCandidates.length === 0) return null;
  // A pool with one distinct note has no legal alternative, so the repeat guard must yield.
  if (candidates.length <= 1) {
    let index = notePool.length - 1;
    while (index >= 0 && temporarilyExcludedMidiNotes.has(notePool[index]!.midi)) index -= 1;
    return index < 0 ? null : (notePool.splice(index, 1)[0] ?? null);
  }

  if (noteSchedulingStrategy === "random") {
    let eligibleIndices = notePool.flatMap((note, index) =>
      !temporarilyExcludedMidiNotes.has(note.midi) &&
      canFollowRecentNotes(note.midi, recentNoteMidis)
        ? [index]
        : []
    );
    if (eligibleIndices.length === 0) {
      const notesAlreadyInBag = new Set(notePool.map((note) => note.midi));
      const missingNotes = allowedCandidates
        .filter((note) => !notesAlreadyInBag.has(note.midi))
        .map((note) => ({ ...note }));
      notePool.push(...shuffledItems(missingNotes));
      eligibleIndices = notePool.flatMap((note, index) =>
        !temporarilyExcludedMidiNotes.has(note.midi) &&
        canFollowRecentNotes(note.midi, recentNoteMidis)
          ? [index]
          : []
      );
    }
    if (eligibleIndices.length === 0) return null;
    const chosenIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
    return notePool.splice(chosenIndex, 1)[0] ?? null;
  }

  let eligibleIndices = notePool.flatMap((note, index) =>
    !temporarilyExcludedMidiNotes.has(note.midi) && canFollowRecentNotes(note.midi, recentNoteMidis)
      ? [index]
      : []
  );
  if (eligibleIndices.length === 0) {
    // Keep blocked notes in the pool, but only replenish with currently safe pitches.
    notePool.push(...nextBag().filter((note) => !temporarilyExcludedMidiNotes.has(note.midi)));
    eligibleIndices = notePool.flatMap((note, index) =>
      !temporarilyExcludedMidiNotes.has(note.midi) &&
      canFollowRecentNotes(note.midi, recentNoteMidis)
        ? [index]
        : []
    );
  }
  if (eligibleIndices.length === 0) {
    const safeCandidates = allowedCandidates.filter((note) =>
      canFollowRecentNotes(note.midi, recentNoteMidis)
    );
    const fallbackNote = chooseSystemWeightedNote(safeCandidates, level, notePoolScope);
    if (!fallbackNote) return null;
    notePool.push(fallbackNote);
    return notePool.pop() ?? null;
  }
  const chosenIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
  return notePool.splice(chosenIndex, 1)[0] ?? null;
}

export function randomBubbleCenterX(playfield: HTMLElement | null): number {
  if (!playfield || typeof window === "undefined" || playfield.clientWidth <= 0) return 0;
  const viewportWidth = window.innerWidth;
  const bubbleWidth =
    viewportWidth > 820
      ? Math.max(112, Math.min(viewportWidth * 0.11, 150))
      : Math.max(144, Math.min(viewportWidth * 0.22, 190));
  const edgePadding =
    viewportWidth > 820
      ? Math.max(72, Math.min(playfield.clientWidth * 0.14, 190))
      : Math.min(28, Math.max(20, playfield.clientWidth * 0.035));
  const availableWidth = Math.max(0, playfield.clientWidth - bubbleWidth - edgePadding * 2);
  return bubbleWidth / 2 + edgePadding + Math.random() * availableWidth;
}
