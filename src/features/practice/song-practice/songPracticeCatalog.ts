import {
  BUILT_IN_ALWAYS_WITH_ME_C_MIDI_SCORE,
  BUILT_IN_ALWAYS_WITH_ME_ORIGINAL_MIDI_SCORE,
} from "./alwaysWithMeMidiScore";
import {
  BUILT_IN_CONG_CONG_NA_NIAN_C_MIDI_SCORE,
  BUILT_IN_CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SCORE,
} from "./congCongNaNianMidiScore";
import { type SongPracticeKeyVersion, type SongPracticeScore } from "./songPracticeMaterials";

export const BUILT_IN_SONG_PRACTICE_SCORES: readonly SongPracticeScore[] = [
  BUILT_IN_CONG_CONG_NA_NIAN_C_MIDI_SCORE,
  BUILT_IN_ALWAYS_WITH_ME_C_MIDI_SCORE,
];

export const SONG_PRACTICE_PROGRESS_SCORES: readonly SongPracticeScore[] = [
  BUILT_IN_CONG_CONG_NA_NIAN_C_MIDI_SCORE,
  BUILT_IN_CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SCORE,
  BUILT_IN_ALWAYS_WITH_ME_C_MIDI_SCORE,
  BUILT_IN_ALWAYS_WITH_ME_ORIGINAL_MIDI_SCORE,
];

export function getSongPracticeScore(
  songId: string,
  keyVersion: Exclude<SongPracticeKeyVersion, "source">
): SongPracticeScore {
  if (songId === "cong-cong-na-nian") return getCongCongNaNianScore(keyVersion);
  if (songId === "always-with-me") {
    return keyVersion === "original"
      ? BUILT_IN_ALWAYS_WITH_ME_ORIGINAL_MIDI_SCORE
      : BUILT_IN_ALWAYS_WITH_ME_C_MIDI_SCORE;
  }
  return getBuiltInSongPracticeScore(songId);
}

export function getCongCongNaNianScore(
  keyVersion: Exclude<SongPracticeKeyVersion, "source">
): SongPracticeScore {
  return keyVersion === "original"
    ? BUILT_IN_CONG_CONG_NA_NIAN_ORIGINAL_MIDI_SCORE
    : BUILT_IN_CONG_CONG_NA_NIAN_C_MIDI_SCORE;
}

export function getBuiltInSongPracticeScore(songId: string): SongPracticeScore {
  return (
    BUILT_IN_SONG_PRACTICE_SCORES.find((score) => score.id === songId) ??
    BUILT_IN_SONG_PRACTICE_SCORES[0]
  );
}
