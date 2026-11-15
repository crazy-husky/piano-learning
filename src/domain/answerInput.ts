import { getTargetNoteMidi, pianoKeySemitone } from "./blackKeyPractice";
import type { AnswerPitchMode, DuetTimingGrade, NoteName, PianoKeyName, TargetNote } from "./types";
import type { PracticeMicrophoneAlgorithm } from "../features/vocal-pitch/logic/practiceMicrophonePreferences";

export type AnswerInputSource = "computer-keyboard" | "microphone" | "midi" | "screen-keyboard";

export interface PracticeAnswerInput {
  clipping?: boolean;
  confidence?: number;
  microphoneAlgorithm?: PracticeMicrophoneAlgorithm;
  diagnosticSampleId?: number;
  midiNoteNumber?: number;
  pianoKeyName?: PianoKeyName;
  inputTimeMs?: number;
  /** Optional onset-based timing result attached by synchronized duet practice. */
  duetTimingGrade?: DuetTimingGrade;
  noteName: NoteName;
  octave?: number;
  source: AnswerInputSource;
}

export function normalizeAnswerPitchMode(
  value: unknown,
  fallback: AnswerPitchMode = "note-name"
): AnswerPitchMode {
  if (value === "microphone") {
    return "microphone";
  }
  if (value === "exact-pitch" || value === "absolute-pitch") {
    return "exact-pitch";
  }
  return value === "note-name" ? "note-name" : fallback;
}

export function resolveAvailableAnswerPitchMode(
  configuredMode: AnswerPitchMode,
  midiConnected: boolean
): AnswerPitchMode {
  if (configuredMode === "microphone") {
    return configuredMode;
  }
  return midiConnected ? configuredMode : "note-name";
}

export function isPracticeAnswerSourceAllowed(
  answer: PracticeAnswerInput,
  mode: AnswerPitchMode
): boolean {
  if (mode === "microphone") {
    return answer.source === "microphone";
  }
  if (mode === "exact-pitch") {
    return answer.source === "midi";
  }
  return true;
}

export function getTargetMidiNoteNumber(
  target: Pick<TargetNote, "noteName" | "octave" | "accidental">
): number {
  return getTargetNoteMidi(target);
}

export function isPracticeAnswerCorrect(
  answer: PracticeAnswerInput,
  target: Pick<TargetNote, "noteName" | "octave" | "accidental">,
  mode: AnswerPitchMode
): boolean {
  if (mode === "note-name") {
    if (answer.midiNoteNumber !== undefined) {
      return answer.midiNoteNumber % 12 === getTargetMidiNoteNumber(target) % 12;
    }
    if (answer.pianoKeyName) {
      return pianoKeySemitone(answer.pianoKeyName) === getTargetMidiNoteNumber(target) % 12;
    }
    return answer.noteName === target.noteName && !target.accidental;
  }
  return (
    (mode === "microphone" ? answer.source === "microphone" : answer.source === "midi") &&
    answer.midiNoteNumber === getTargetMidiNoteNumber(target)
  );
}
