import type { PracticeMicrophoneAlgorithm } from "../../vocal-pitch/logic/practiceMicrophonePreferences";

type StaffGameComboPrompt = "comboAmazing" | "comboExcellent" | "comboStreak" | "comboUnbelievable";

/** Short acoustic/input tail after a combo sound ends. */
export const STAFF_GAME_PROMPT_RECOGNITION_TAIL_MS = 300;

const PROMPT_SUPPRESSED_MIDI_BY_ALGORITHM: Record<
  StaffGameComboPrompt,
  Record<PracticeMicrophoneAlgorithm, readonly number[]>
> = {
  comboAmazing: {
    yin: [74], // D5
    swiftf0: [57, 74, 75], // A3, D5, D♯5
  },
  comboExcellent: {
    yin: [],
    swiftf0: [],
  },
  comboStreak: {
    yin: [],
    swiftf0: [55], // G3
  },
  comboUnbelievable: {
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
