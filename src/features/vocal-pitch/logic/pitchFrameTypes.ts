export const VOCAL_PITCH_DETECTOR_ID = "yin";
export const VOCAL_PITCH_DETECTOR_VERSION = 5;

export interface PitchFrameCandidate {
  clarity: number;
  frequencyHz: number;
}

export interface PitchFrameDetection {
  fallback: PitchFrameCandidate;
  primary: PitchFrameCandidate;
}

export interface PitchFrameDetector {
  detect: (samples: Float32Array, sampleRate: number) => PitchFrameDetection;
}
