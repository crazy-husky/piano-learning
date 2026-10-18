import type { PracticeMicrophoneAlgorithm } from "../../vocal-pitch/logic/practiceMicrophonePreferences";

type StaffGameComboPrompt = "comboAmazing" | "comboExcellent" | "comboUnbelievable";

/** Short acoustic/input tail after a spoken combo prompt ends. */
export const STAFF_GAME_PROMPT_RECOGNITION_TAIL_MS = 300;

const PROMPT_SUPPRESSED_MIDI_BY_ALGORITHM: Record<
  StaffGameComboPrompt,
  Record<PracticeMicrophoneAlgorithm, readonly number[]>
> = {
  comboAmazing: {
    "mpm-c": [74], // D5
    yin: [74], // D5
    swiftf0: [57, 74, 75], // A3, D5, D♯5
  },
  comboExcellent: {
    "mpm-c": [],
    yin: [],
    swiftf0: [],
  },
  comboUnbelievable: {
    "mpm-c": [75], // D♯5
    yin: [75], // D♯5
    swiftf0: [75, 77], // D♯5, F5
  },
};

export function staffGamePromptSuppressedMidiNotes(
  sound: StaffGameComboPrompt,
  algorithm: PracticeMicrophoneAlgorithm
): readonly number[] {
  return PROMPT_SUPPRESSED_MIDI_BY_ALGORITHM[sound][algorithm];
}
