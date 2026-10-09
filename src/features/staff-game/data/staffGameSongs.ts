export interface StaffGameSong {
  id: string;
  title: string;
  englishTitle: string;
  description: string;
  difficulty: "入门" | "初级";
  noteMidis: readonly number[];
}

const midi = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 } as const;
const sequence = (notes: readonly (keyof typeof midi)[]): readonly number[] => notes.map((note) => midi[note]);

/** Original, simplified C-major single-note arrangements for the in-game play-along mode. */
export const STAFF_GAME_SONGS: readonly StaffGameSong[] = [
  {
    id: "hot-cross-buns",
    title: "热十字面包",
    englishTitle: "Hot Cross Buns",
    description: "只用三个音，从最短的旋律开始练习。",
    difficulty: "入门",
    noteMidis: sequence(["E", "D", "C", "E", "D", "C", "C", "C", "C", "C", "D", "D", "D", "D", "D", "E", "D", "C"]),
  },
  {
    id: "mary-had-a-little-lamb",
    title: "玛丽有只小羊羔",
    englishTitle: "Mary Had a Little Lamb",
    description: "熟悉的短句反复出现，适合练习看谱接续。",
    difficulty: "入门",
    noteMidis: sequence(["E", "D", "C", "D", "E", "E", "E", "D", "D", "D", "E", "G", "G", "E", "D", "C", "D", "E", "E", "E", "E", "D", "D", "E", "D", "C"]),
  },
  {
    id: "twinkle-twinkle",
    title: "小星星",
    englishTitle: "Twinkle, Twinkle, Little Star",
    description: "C 大调简化旋律，音域 C4–A4。",
    difficulty: "入门",
    noteMidis: sequence([
      "C", "C", "G", "G", "A", "A", "G", "F", "F", "E", "E", "D", "D", "C",
      "G", "G", "F", "F", "E", "E", "D", "G", "G", "F", "F", "E", "E", "D",
      "C", "C", "G", "G", "A", "A", "G", "F", "F", "E", "E", "D", "D", "C",
    ]),
  },
  {
    id: "ode-to-joy",
    title: "欢乐颂",
    englishTitle: "Ode to Joy",
    description: "C 大调单旋律简编，练习五个自然音的连续识谱。",
    difficulty: "初级",
    noteMidis: sequence([
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "E", "D", "D",
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "D", "C", "C",
      "D", "D", "E", "C", "D", "E", "F", "E", "C", "D", "E", "F", "E", "D", "C",
    ]),
  },
  {
    id: "frere-jacques",
    title: "两只老虎",
    englishTitle: "Frère Jacques",
    description: "重复乐句帮助熟悉旋律与音符位置。",
    difficulty: "初级",
    noteMidis: sequence([
      "C", "D", "E", "C", "C", "D", "E", "C", "E", "F", "G", "E", "F", "G",
      "G", "A", "G", "F", "E", "C", "G", "A", "G", "F", "E", "C",
      "C", "G", "C", "C", "C", "G", "C", "C",
    ]),
  },
];

export interface StaffGameSongRecord {
  bestScore: number;
  bestAccuracy: number;
  bestStars: number;
  maxCombo: number;
  plays: number;
}

export type StaffGameSongProgress = Record<string, StaffGameSongRecord>;

const SONG_PROGRESS_KEY = "anki-note.staffGameSongProgress.v1";

export function readStaffGameSongProgress(): StaffGameSongProgress {
  const defaults: StaffGameSongProgress = Object.fromEntries(
    STAFF_GAME_SONGS.map(({ id }) => [id, { bestScore: 0, bestAccuracy: 0, bestStars: 0, maxCombo: 0, plays: 0 }]),
  );
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SONG_PROGRESS_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    for (const song of STAFF_GAME_SONGS) {
      const value = (parsed as Record<string, unknown>)[song.id];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      defaults[song.id] = {
        bestScore: Math.max(0, Math.floor(Number(record.bestScore) || 0)),
        bestAccuracy: Math.max(0, Math.min(100, Math.floor(Number(record.bestAccuracy) || 0))),
        bestStars: Math.max(0, Math.min(3, Math.floor(Number(record.bestStars) || 0))),
        maxCombo: Math.max(0, Math.floor(Number(record.maxCombo) || 0)),
        plays: Math.max(0, Math.floor(Number(record.plays) || 0)),
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveStaffGameSongProgress(progress: StaffGameSongProgress): void {
  try {
    window.localStorage.setItem(SONG_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Song records are optional; keep the session playable if storage is unavailable.
  }
}
