import { frequencyToMidi, midiToFrequency } from "../../../domain/vocalPitch";
import type { NoteName, Octave, PianoKeyName } from "../../../domain/types";

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
const DEFAULT_MIN_NOTE_CONFIDENCE = 0.9;
const MAX_NOTE_DEVIATION_CENTS = 45;
const REQUIRED_STABLE_FRAMES = 4;
const REQUIRED_STABLE_MS = 80;
const SILENCE_REARM_FRAMES = 2;
const SAME_NOTE_REFRACTORY_MS = 180;
const SAME_NOTE_ONSET_RMS_RATIO = 1.18;
const CONTINUITY_REFERENCE_WINDOW_MS = 500;
const OCTAVE_CHANGE_STABILITY_MULTIPLIER = 2;
export const PRACTICE_NOTE_CONTINUITY_CONFIDENCE = 0.25;

export interface PracticeNoteObservation {
  ambiguous?: boolean;
  confidence: number;
  frequencyHz: number | null;
  rms: number;
  timeMs: number;
}

export interface RecognizedPracticeNote {
  midiNoteNumber: number;
  noteName: PianoKeyName;
  octave: Octave;
}

export interface PracticeNoteRecognizer {
  process: (observation: PracticeNoteObservation) => RecognizedPracticeNote | null;
  reset: () => void;
}

export interface PracticeNoteRecognizerStabilityOptions {
  /** Allows low-clarity adjacent notes to be stabilized from a recently confirmed pitch. */
  continuityConfidence?: number;
  /** Include sharp notes for the staff game without changing standard practice recognition. */
  includeAccidentals?: boolean;
  requiredFrames?: number;
  requiredMs?: number;
}

const MAX_CONTINUITY_STEP_SEMITONES = 2;

function isOctaveRegisterChange(candidateMidi: number, referenceMidi: number): boolean {
  return candidateMidi !== referenceMidi && candidateMidi % 12 === referenceMidi % 12;
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

export function frequencyToChromaticPracticeNote(frequencyHz: number): RecognizedPracticeNote | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const midiValue = frequencyToMidi(frequencyHz);
  const midiNoteNumber = Math.round(midiValue);
  if (
    midiNoteNumber < PRACTICE_NOTE_MIN_MIDI ||
    midiNoteNumber > PRACTICE_NOTE_MAX_MIDI ||
    Math.abs(midiValue - midiNoteNumber) * 100 > MAX_NOTE_DEVIATION_CENTS
  ) return null;
  const noteName = (["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const)[((midiNoteNumber % 12) + 12) % 12];
  return {
    midiNoteNumber,
    noteName,
    octave: (Math.floor(midiNoteNumber / 12) - 1) as Octave,
  };
}

export function createPracticeNoteRecognizer(
  minConfidence = DEFAULT_MIN_NOTE_CONFIDENCE,
  stability: PracticeNoteRecognizerStabilityOptions = {},
): PracticeNoteRecognizer {
  const requiredStableFrames = stability.requiredFrames ?? REQUIRED_STABLE_FRAMES;
  const requiredStableMs = stability.requiredMs ?? REQUIRED_STABLE_MS;
  const continuityConfidence = stability.continuityConfidence ?? minConfidence;
  const convertFrequency = stability.includeAccidentals ? frequencyToChromaticPracticeNote : frequencyToNaturalPracticeNote;
  let candidateMidi: number | null = null;
  let candidateFrames = 0;
  let candidateStartedAt = 0;
  let lastAcceptedMidi: number | null = null;
  let lastAcceptedAt = 0;
  let continuityReferenceMidi: number | null = null;
  let continuityReferenceAt = 0;
  let previousRms = 0;
  let silenceFrames = 0;

  const reset = (): void => {
    candidateMidi = null;
    candidateFrames = 0;
    candidateStartedAt = 0;
    lastAcceptedMidi = null;
    lastAcceptedAt = 0;
    continuityReferenceMidi = null;
    continuityReferenceAt = 0;
    previousRms = 0;
    silenceFrames = 0;
  };

  const process = (observation: PracticeNoteObservation): RecognizedPracticeNote | null => {
    const detectedCandidate = observation.frequencyHz === null || observation.ambiguous
      ? null
      : convertFrequency(observation.frequencyHz);
    const isConfidentCandidate = observation.confidence >= minConfidence;
    const continuityReferenceAgeMs = observation.timeMs - continuityReferenceAt;
    const hasRecentContinuityReference = continuityReferenceMidi !== null &&
      continuityReferenceAgeMs >= 0 &&
      continuityReferenceAgeMs <= CONTINUITY_REFERENCE_WINDOW_MS;
    const continuityAnchorMidi = hasRecentContinuityReference ? continuityReferenceMidi : null;
    // MPM-C can return a neighboring note's octave when the fundamental is weak.
    // Only use that lower-confidence path near a recently confirmed melody pitch;
    // the ordinary confidence gate still applies to unrelated notes.
    const canUsePitchContinuity = continuityAnchorMidi !== null &&
      observation.confidence >= continuityConfidence;
    let candidate = detectedCandidate && (isConfidentCandidate || canUsePitchContinuity)
      ? detectedCandidate
      : null;
    let wasOctaveNormalized = false;

    if (candidate && continuityAnchorMidi !== null) {
      const nearbyOctaves = [
        candidate.midiNoteNumber - 24,
        candidate.midiNoteNumber - 12,
        candidate.midiNoteNumber,
        candidate.midiNoteNumber + 12,
        candidate.midiNoteNumber + 24,
      ].filter((midi) => midi >= PRACTICE_NOTE_MIN_MIDI && midi <= PRACTICE_NOTE_MAX_MIDI);
      const nearestMidi = nearbyOctaves.sort((left, right) =>
        Math.abs(left - continuityAnchorMidi) - Math.abs(right - continuityAnchorMidi),
      )[0];
      const nearestDistance = nearestMidi === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(nearestMidi - continuityAnchorMidi);
      const isOctaveChange = isOctaveRegisterChange(candidate.midiNoteNumber, continuityAnchorMidi);
      const shouldUseNearbyOctave = !isConfidentCandidate &&
        !isOctaveChange &&
        nearestDistance <= MAX_CONTINUITY_STEP_SEMITONES;
      if (!isConfidentCandidate && !shouldUseNearbyOctave && !isOctaveChange) {
        candidate = null;
      } else if (shouldUseNearbyOctave) {
        wasOctaveNormalized = nearestMidi !== candidate.midiNoteNumber;
        candidate = {
          ...candidate,
          midiNoteNumber: nearestMidi,
          octave: (Math.floor(nearestMidi / 12) - 1) as Octave,
        };
      }
    }

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

    const isRecentOctaveChange = hasRecentContinuityReference &&
      continuityAnchorMidi !== null &&
      isOctaveRegisterChange(candidate.midiNoteNumber, continuityAnchorMidi);
    // Require more sustained evidence for an octave jump, but don't use loudness
    // to rewrite its pitch: a real octave change can be quieter than its anchor.
    const candidateRequiredStableFrames = isRecentOctaveChange
      ? requiredStableFrames * OCTAVE_CHANGE_STABILITY_MULTIPLIER
      : requiredStableFrames;
    const candidateRequiredStableMs = isRecentOctaveChange
      ? requiredStableMs * OCTAVE_CHANGE_STABILITY_MULTIPLIER
      : requiredStableMs;

    if (
      candidateFrames < candidateRequiredStableFrames ||
      observation.timeMs - candidateStartedAt < candidateRequiredStableMs
    ) {
      return null;
    }
    if (wasOctaveNormalized) return null;

    lastAcceptedMidi = candidate.midiNoteNumber;
    lastAcceptedAt = observation.timeMs;
    continuityReferenceMidi = candidate.midiNoteNumber;
    continuityReferenceAt = observation.timeMs;
    candidateMidi = null;
    candidateFrames = 0;
    return candidate;
  };

  return { process, reset };
}
