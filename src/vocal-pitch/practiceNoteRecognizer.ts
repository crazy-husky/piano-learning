import { frequencyToMidi, midiToFrequency } from "../domain/vocalPitch";
import type { NoteName, Octave } from "../domain/types";

export const PRACTICE_NOTE_MIN_MIDI = 29;
export const PRACTICE_NOTE_MAX_MIDI = 91;
export const PRACTICE_NOTE_MIN_FREQUENCY_HZ = midiToFrequency(PRACTICE_NOTE_MIN_MIDI);
export const PRACTICE_NOTE_MAX_FREQUENCY_HZ = midiToFrequency(PRACTICE_NOTE_MAX_MIDI);
export const PRACTICE_NOTE_FREQUENCY_RANGE = {
  maxFrequencyHz: PRACTICE_NOTE_MAX_FREQUENCY_HZ,
  minFrequencyHz: PRACTICE_NOTE_MIN_FREQUENCY_HZ,
};

const NATURAL_NOTE_BY_SEMITONE: Partial<Record<number, NoteName>> = {
  0: "C",
  2: "D",
  4: "E",
  5: "F",
  7: "G",
  9: "A",
  11: "B",
};
const MIN_NOTE_CONFIDENCE = 0.9;
const MAX_NOTE_DEVIATION_CENTS = 45;
const REQUIRED_STABLE_FRAMES = 4;
const REQUIRED_STABLE_MS = 80;
const SILENCE_REARM_FRAMES = 2;
const SAME_NOTE_REFRACTORY_MS = 180;
const SAME_NOTE_ONSET_RMS_RATIO = 1.18;

export interface PracticeNoteObservation {
  ambiguous?: boolean;
  confidence: number;
  frequencyHz: number | null;
  rms: number;
  timeMs: number;
}

export interface RecognizedPracticeNote {
  midiNoteNumber: number;
  noteName: NoteName;
  octave: Octave;
}

export interface PracticeNoteRecognizer {
  process: (observation: PracticeNoteObservation) => RecognizedPracticeNote | null;
  reset: () => void;
}

export function frequencyToNaturalPracticeNote(frequencyHz: number): RecognizedPracticeNote | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    return null;
  }
  const midiValue = frequencyToMidi(frequencyHz);
  const midiNoteNumber = Math.round(midiValue);
  if (
    midiNoteNumber < PRACTICE_NOTE_MIN_MIDI ||
    midiNoteNumber > PRACTICE_NOTE_MAX_MIDI ||
    Math.abs(midiValue - midiNoteNumber) * 100 > MAX_NOTE_DEVIATION_CENTS
  ) {
    return null;
  }
  const noteName = NATURAL_NOTE_BY_SEMITONE[((midiNoteNumber % 12) + 12) % 12];
  if (!noteName) {
    return null;
  }
  return {
    midiNoteNumber,
    noteName,
    octave: (Math.floor(midiNoteNumber / 12) - 1) as Octave,
  };
}

export function createPracticeNoteRecognizer(): PracticeNoteRecognizer {
  let candidateMidi: number | null = null;
  let candidateFrames = 0;
  let candidateStartedAt = 0;
  let lastAcceptedMidi: number | null = null;
  let lastAcceptedAt = 0;
  let previousRms = 0;
  let silenceFrames = 0;

  const reset = (): void => {
    candidateMidi = null;
    candidateFrames = 0;
    candidateStartedAt = 0;
    lastAcceptedMidi = null;
    lastAcceptedAt = 0;
    previousRms = 0;
    silenceFrames = 0;
  };

  const process = (observation: PracticeNoteObservation): RecognizedPracticeNote | null => {
    const candidate = observation.frequencyHz === null ||
        observation.confidence < MIN_NOTE_CONFIDENCE ||
        observation.ambiguous
      ? null
      : frequencyToNaturalPracticeNote(observation.frequencyHz);

    if (!candidate) {
      candidateMidi = null;
      candidateFrames = 0;
      silenceFrames += 1;
      previousRms = 0;
      if (silenceFrames >= SILENCE_REARM_FRAMES) {
        lastAcceptedMidi = null;
      }
      return null;
    }

    silenceFrames = 0;
    const isSameHeldNote = candidate.midiNoteNumber === lastAcceptedMidi;
    const isSameNoteOnset =
      isSameHeldNote &&
      observation.timeMs - lastAcceptedAt >= SAME_NOTE_REFRACTORY_MS &&
      previousRms > 0 &&
      observation.rms >= previousRms * SAME_NOTE_ONSET_RMS_RATIO;
    if (isSameHeldNote && candidateMidi === null && !isSameNoteOnset) {
      previousRms = observation.rms;
      return null;
    }

    if (candidateMidi !== candidate.midiNoteNumber) {
      candidateMidi = candidate.midiNoteNumber;
      candidateFrames = 1;
      candidateStartedAt = observation.timeMs;
    } else {
      candidateFrames += 1;
    }
    previousRms = observation.rms;

    if (
      candidateFrames < REQUIRED_STABLE_FRAMES ||
      observation.timeMs - candidateStartedAt < REQUIRED_STABLE_MS
    ) {
      return null;
    }

    lastAcceptedMidi = candidate.midiNoteNumber;
    lastAcceptedAt = observation.timeMs;
    candidateMidi = null;
    candidateFrames = 0;
    return candidate;
  };

  return { process, reset };
}
