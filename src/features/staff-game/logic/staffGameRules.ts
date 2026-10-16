// ⚠️ [错题袋覆盖]。详见 docs/product-decisions.md
import type { NoteName, PianoKeyName } from "../../../domain/types";

export type GameDifficulty = "muggle" | "leisure" | "easy" | "normal" | "hard" | "nightmare";
export type StaffGameNotePoolScope = "current-group" | "all-history" | "all-history-current-clef";
export type StaffGameNoteSchedulingStrategy = "random" | "system";

export interface StaffGamePitch {
  midi: number;
  name: PianoKeyName;
  octave: number;
}

export const GAME_LEVEL_COUNT = 60;
export const BUBBLE_FADE_IN_MS = 200;
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
const WHITE_NOTE_MIDI_RANGE = { min: 29, max: 88 } as const;
export const GAME_NOTE_PROGRESSION: Array<{ midi: number; name: PianoKeyName; octave: number }> =
  (() => {
    const pitchForMidi = (midi: number) => ({
      midi,
      name: PITCH_NAMES[((midi % 12) + 12) % 12],
      octave: Math.floor(midi / 12) - 1,
    });
    const whiteNotes = Array.from(
      { length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 },
      (_, index) => pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index)
    ).filter((note) => !note.name.includes("#"));
    const blackNotes = Array.from(
      { length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 },
      (_, index) => pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index)
    ).filter((note) => note.name.includes("#"));
    const interleaveOctaves = (notes: typeof whiteNotes) =>
      [4, 3, 5, 2, 6, 1].flatMap((octave) =>
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
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy = "system",
  weakNoteWeights?: ReadonlyMap<number, number>
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
  const addReviewNotes = (
    pool: typeof GAME_NOTE_PROGRESSION,
    count: number,
    weakSlotRatio = 0.25
  ): void => {
    const weakNotes = weakNoteWeights
      ? pool.filter((note) => (weakNoteWeights.get(note.midi) ?? 0) > 0)
      : [];
    const weakSlots = weakNotes.length > 0 ? Math.min(count, Math.ceil(count * weakSlotRatio)) : 0;
    if (weakSlots > 0) {
      bag.push(...weightedNoteDraws(weakNotes, weakSlots, weakNoteWeights));
    }
    let remaining = count - weakSlots;
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

function weightedNoteDraws(
  pool: readonly StaffGamePitch[],
  count: number,
  weights?: ReadonlyMap<number, number>
): StaffGamePitch[] {
  if (pool.length === 0 || count <= 0) return [];
  const weightedPool = pool.map((note) => ({
    note,
    weight: Math.max(0, weights?.get(note.midi) ?? 1),
  }));
  const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return Array.from({ length: count }, () => ({
      ...pool[Math.floor(Math.random() * pool.length)]!,
    }));
  }
  return Array.from({ length: count }, () => {
    let point = Math.random() * totalWeight;
    const selected = weightedPool.find((item) => {
      point -= item.weight;
      return point < 0;
    });
    return { ...(selected?.note ?? weightedPool[weightedPool.length - 1]!.note) };
  });
}

export function drawNextWrongNoteReviewNote(
  noteBag: StaffGamePitch[],
  recentNoteMidis: number[]
): StaffGamePitch | null {
  if (noteBag.length === 0) return null;
  const eligibleIndices = noteBag.flatMap((note, index) =>
    canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []
  );
  const chosenIndex = eligibleIndices.length
    ? eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)]!
    : noteBag.length - 1;
  return noteBag.splice(chosenIndex, 1)[0] ?? null;
}

export function drawNextNote(
  level: number,
  notePool: StaffGamePitch[],
  recentNoteMidis: number[],
  notePoolScope: StaffGameNotePoolScope = "all-history",
  noteSchedulingStrategy: StaffGameNoteSchedulingStrategy = "system",
  weakNoteWeights?: ReadonlyMap<number, number>
): StaffGamePitch | null {
  const nextBag = (): StaffGamePitch[] =>
    shuffledNoteBag(level, notePoolScope, noteSchedulingStrategy, weakNoteWeights);
  if (level === 1) {
    if (notePool.length === 0) notePool.push(...nextBag());
    return notePool.pop() ?? null;
  }

  if (notePool.length === 0) notePool.push(...nextBag());
  const candidates = notePoolCandidates(level, notePoolScope);
  // A pool with one distinct note has no legal alternative, so the repeat guard must yield.
  if (candidates.length <= 1) {
    return notePool.pop() ?? null;
  }

  if (noteSchedulingStrategy === "random") {
    let eligibleIndices = notePool.flatMap((note, index) =>
      canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []
    );
    if (eligibleIndices.length === 0) {
      const notesAlreadyInBag = new Set(notePool.map((note) => note.midi));
      const missingNotes = candidates
        .filter((note) => !notesAlreadyInBag.has(note.midi))
        .map((note) => ({ ...note }));
      notePool.push(...shuffledItems(missingNotes));
      eligibleIndices = notePool.flatMap((note, index) =>
        canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []
      );
    }
    if (eligibleIndices.length === 0) return null;
    const chosenIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
    return notePool.splice(chosenIndex, 1)[0] ?? null;
  }

  let eligibleIndices = notePool.flatMap((note, index) =>
    canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []
  );
  if (eligibleIndices.length === 0) {
    // Keep blocked notes in the pool; add a fresh weighted draw so a legal note is always available.
    notePool.push(...nextBag());
    eligibleIndices = notePool.flatMap((note, index) =>
      canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []
    );
  }
  if (eligibleIndices.length === 0) return null;
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
