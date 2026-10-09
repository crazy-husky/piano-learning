import type { NoteName, PianoKeyName } from "../../../domain/types";

export type GameDifficulty = "easy" | "normal" | "hard" | "nightmare";

export interface StaffGamePitch {
  midi: number;
  name: PianoKeyName;
  octave: number;
}

export const GAME_LEVEL_COUNT = 60;
export const SONG_STAR_THRESHOLDS = [60, 80, 95] as const;
export const RUSH_MODE_COMBO_THRESHOLD = 5;
export const COMBO_INDICATOR_FADE_DURATION_MS = 280;
export const RUSH_FALL_SPEED_MULTIPLIER = 0.92;
export const STAR_CREDIT_PER_CORRECT_ANSWER = 10;
export const ERROR_FLASH_THRESHOLD = 4;
export const ERROR_FLASH_DURATION_MS = 1_400;
export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
export const PITCH_NAMES: PianoKeyName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const BLACK_KEY_NOTES: Array<{ pitch: PianoKeyName; className: string }> = [
  { pitch: "C#", className: "key-cs" },
  { pitch: "D#", className: "key-ds" },
  { pitch: "F#", className: "key-fs" },
  { pitch: "G#", className: "key-gs" },
  { pitch: "A#", className: "key-as" },
];
export const COMPUTER_KEY_PITCHES: Record<string, PianoKeyName> = {
  KeyA: "C", KeyS: "D", KeyD: "E", KeyF: "F", KeyG: "G", KeyH: "A", KeyJ: "B",
  KeyW: "C#", KeyE: "D#", KeyT: "F#", KeyY: "G#", KeyU: "A#",
};
const WHITE_NOTE_MIDI_RANGE = { min: 29, max: 88 } as const;
export const GAME_NOTE_PROGRESSION: Array<{ midi: number; name: PianoKeyName; octave: number }> = (() => {
  const pitchForMidi = (midi: number) => ({
    midi,
    name: PITCH_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  });
  const whiteNotes = Array.from({ length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 }, (_, index) =>
    pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index),
  ).filter((note) => !note.name.includes("#"));
  const blackNotes = Array.from({ length: WHITE_NOTE_MIDI_RANGE.max - WHITE_NOTE_MIDI_RANGE.min + 1 }, (_, index) =>
    pitchForMidi(WHITE_NOTE_MIDI_RANGE.min + index),
  ).filter((note) => note.name.includes("#"));
  return [
    ...whiteNotes.filter((note) => note.midi >= 60),
    ...whiteNotes.filter((note) => note.midi < 60).reverse(),
    ...blackNotes.filter((note) => note.midi >= 60),
    ...blackNotes.filter((note) => note.midi < 60).reverse(),
  ];
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
  { id: "easy", label: "简单", bubbleDurationMs: 4_900, comboWindowMs: 3_000, correctPoints: 8, comboBonusPoints: 1 },
  { id: "normal", label: "普通", bubbleDurationMs: 3_300, comboWindowMs: 2_200, correctPoints: 10, comboBonusPoints: 2 },
  { id: "hard", label: "困难", bubbleDurationMs: 2_700, comboWindowMs: 1_600, correctPoints: 12, comboBonusPoints: 3 },
  { id: "nightmare", label: "噩梦", bubbleDurationMs: 2_200, comboWindowMs: 1_000, correctPoints: 15, comboBonusPoints: 4 },
];
export const STAR_THRESHOLDS = [36, 70, 110] as const;
export const STAR_BASE_DURATION_MS = 30_000;

export function starsForStarCredit(starCredit: number, level: number): number {
  const durationScale = gameDurationMsForLevel(level) / STAR_BASE_DURATION_MS;
  return STAR_THRESHOLDS.filter((threshold) => starCredit >= Math.ceil(threshold * durationScale)).length;
}

export function starsForSongAccuracy(accuracy: number): number {
  return SONG_STAR_THRESHOLDS.filter((threshold) => accuracy >= threshold).length;
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
  if (lastThree.length === 3 && lastThree[0] === lastThree[2] && lastThree[1] === midi) return false;
  return true;
}

export function shuffledNoteBag(level: number): StaffGamePitch[] {
  const unlockedNotes = GAME_NOTE_PROGRESSION.slice(0, level);
  const focusNote = unlockedNotes[unlockedNotes.length - 1];
  if (!focusNote) return [];

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
    addReviewNotes(unlockedNotes.slice(0, -1), 12);
  } else {
    // Keep the focus note at 30%; distribute review slots across the newest five and older notes.
    addCopies(focusNote, 6);
    const earlierNotes = unlockedNotes.slice(0, -1);
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

export function drawNextNote(
  level: number,
  notePool: StaffGamePitch[],
  recentNoteMidis: number[],
): StaffGamePitch | null {
  if (level === 1) {
    if (notePool.length === 0) notePool.push(...shuffledNoteBag(level));
    return notePool.pop() ?? null;
  }

  if (notePool.length === 0) notePool.push(...shuffledNoteBag(level));
  let eligibleIndices = notePool.flatMap((note, index) => canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []);
  if (eligibleIndices.length === 0) {
    // Keep blocked notes in the pool; add a fresh weighted draw so a legal note is always available.
    notePool.push(...shuffledNoteBag(level));
    eligibleIndices = notePool.flatMap((note, index) => canFollowRecentNotes(note.midi, recentNoteMidis) ? [index] : []);
  }
  if (eligibleIndices.length === 0) return null;
  const chosenIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
  return notePool.splice(chosenIndex, 1)[0] ?? null;
}

export function randomBubbleCenterX(playfield: HTMLElement | null): number {
  if (!playfield || typeof window === "undefined" || playfield.clientWidth <= 0) return 0;
  const viewportWidth = window.innerWidth;
  const bubbleWidth = viewportWidth > 820
    ? Math.max(112, Math.min(viewportWidth * 0.11, 150))
    : Math.max(144, Math.min(viewportWidth * 0.22, 190));
  const edgePadding = viewportWidth > 820
    ? Math.max(72, Math.min(playfield.clientWidth * 0.14, 190))
    : Math.min(28, Math.max(20, playfield.clientWidth * 0.035));
  const availableWidth = Math.max(0, playfield.clientWidth - bubbleWidth - edgePadding * 2);
  return bubbleWidth / 2 + edgePadding + Math.random() * availableWidth;
}
