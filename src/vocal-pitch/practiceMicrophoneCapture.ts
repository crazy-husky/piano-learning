import type {
  PracticeMicrophoneAlgorithm,
  PracticeMicrophoneAnalysisGain,
  PracticeMicrophoneFrameInterval,
  PracticeMicrophoneSensitivityLevel,
  PracticeMicrophoneStableDuration,
  PracticeMicrophoneStableFrameCount,
} from "./practiceMicrophonePreferences";

export const PRACTICE_MICROPHONE_CLIPPING_THRESHOLD = 0.999;
export const PRACTICE_MICROPHONE_PCM_CAPTURE_INTERVAL_MS = 50;
export const PRACTICE_MICROPHONE_FRAME_SEMANTICS =
  "pitch observations use the selected recognition cadence; PCM analyser windows target 50 ms sampling and may overlap" as const;

export type PracticeMicrophoneCaptureStopReason =
  | "manual"
  | "duration-limit"
  | "practice-paused"
  | "microphone-ended"
  | "input-released"
  | "recognition-error"
  | "component-unmounted";

export type PracticeMicrophoneCaptureLifecycleEventType =
  | "track-muted"
  | "track-unmuted"
  | "track-ended"
  | "audio-context-state";

export interface PracticeMicrophoneConstraintValues {
  autoGainControl: MediaTrackConstraints["autoGainControl"] | null;
  channelCount: MediaTrackConstraints["channelCount"] | null;
  echoCancellation: MediaTrackConstraints["echoCancellation"] | null;
  noiseSuppression: MediaTrackConstraints["noiseSuppression"] | null;
  sampleRate: MediaTrackConstraints["sampleRate"] | null;
}

export interface PracticeMicrophoneTrackSettingsSnapshot {
  autoGainControl: boolean | null;
  channelCount: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  sampleRate: number | null;
}

export interface PracticeMicrophoneCaptureMetadata {
  algorithm: PracticeMicrophoneAlgorithm;
  analysisGain: PracticeMicrophoneAnalysisGain;
  audioContextSampleRate: number;
  audioContextStateAtCaptureStart: string | null;
  autoGainControl: boolean | null;
  audioSession: {
    atStart: { state: string | null; type: string | null } | null;
    atEnd: { state: string | null; type: string | null } | null;
  };
  captureDurationMs: number;
  captureEndedAt: string | null;
  captureStartedAt: string;
  captureStopReason: PracticeMicrophoneCaptureStopReason | null;
  channelCount: number | null;
  clippingThreshold: number;
  confidenceThreshold: number;
  debugMode: boolean;
  constraintSupport: {
    autoGainControl: boolean | null;
    channelCount: boolean | null;
    echoCancellation: boolean | null;
    noiseSuppression: boolean | null;
    sampleRate: boolean | null;
  } | null;
  echoCancellation: boolean | null;
  frameCaptureIntervalMs: number;
  frameIntervalSelection: PracticeMicrophoneFrameInterval;
  frameSemantics: typeof PRACTICE_MICROPHONE_FRAME_SEMANTICS;
  frameSize: number;
  inputRmsThreshold: number;
  lifecycleEvents: PracticeMicrophoneCaptureLifecycleEvent[];
  noiseSuppression: boolean | null;
  pcmCaptureIntervalMs: number;
  primaryClarityThreshold: number;
  requiredStableFrames: PracticeMicrophoneStableFrameCount;
  requiredStableMs: PracticeMicrophoneStableDuration;
  recordingLimitMs: number;
  requestedConstraints: PracticeMicrophoneConstraintValues;
  trackConstraints: PracticeMicrophoneConstraintValues | null;
  trackMutedAtCaptureStart: boolean | null;
  trackReadyStateAtCaptureStart: MediaStreamTrackState | null;
  trackSampleRate: number | null;
  trackSettings: PracticeMicrophoneTrackSettingsSnapshot;
  userAgent: string;
  sensitivityLevel: PracticeMicrophoneSensitivityLevel;
  yinThreshold: number;
}

export interface PracticeMicrophoneCaptureLifecycleEvent {
  offsetMs: number;
  state?: string;
  type: PracticeMicrophoneCaptureLifecycleEventType;
}

export interface PracticeMicrophoneCaptureFrame {
  analysisClippedSampleRatio?: number;
  analysisPeak?: number;
  analysisRms?: number;
  ambiguous?: boolean;
  clippedSampleRatio: number;
  confidence?: number;
  frequencyHz?: number | null;
  gain?: PracticeMicrophoneAnalysisGain;
  offsetMs: number;
  outcome?: string;
  peak: number;
  recognizedMidi?: number;
  rms: number;
  samples: Float32Array;
  timeMs: number;
  zeroSampleRatio: number;
}

export interface PracticeMicrophoneSignalSummary {
  clippedSampleRatio: number;
  peak: number;
  rms: number;
  zeroSampleRatio: number;
}

export function summarizePracticeMicrophoneSamples(
  samples: Float32Array,
  knownRms?: number,
): PracticeMicrophoneSignalSummary {
  if (samples.length === 0) {
    return { clippedSampleRatio: 0, peak: 0, rms: 0, zeroSampleRatio: 0 };
  }

  let energy = 0;
  let peak = 0;
  let zeroCount = 0;
  let clippedCount = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (knownRms === undefined) energy += sample * sample;
    if (magnitude > peak) peak = magnitude;
    if (sample === 0) zeroCount += 1;
    if (magnitude >= PRACTICE_MICROPHONE_CLIPPING_THRESHOLD) clippedCount += 1;
  }

  return {
    clippedSampleRatio: clippedCount / samples.length,
    peak,
    rms: knownRms ?? Math.sqrt(energy / samples.length),
    zeroSampleRatio: zeroCount / samples.length,
  };
}

export function applyPracticeMicrophoneAnalysisGain(
  samples: Float32Array,
  gain: PracticeMicrophoneAnalysisGain,
): Float32Array {
  if (gain === 1) return samples;
  const amplified = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    amplified[index] = Math.max(-1, Math.min(1, samples[index] * gain));
  }
  return amplified;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function createPracticeMicrophoneCaptureBlob(
  metadata: PracticeMicrophoneCaptureMetadata,
  frames: PracticeMicrophoneCaptureFrame[],
  analysis?: unknown,
): Blob {
  const sampleCount = frames.reduce((total, frame) => total + frame.samples.length, 0);
  const pcmBytes = new Uint8Array(sampleCount * Float32Array.BYTES_PER_ELEMENT);
  const pcmView = new DataView(pcmBytes.buffer);
  const frameManifest: Array<{
    analysisClippedSampleRatio?: number;
    analysisPeak?: number;
    analysisRms?: number;
    ambiguous?: boolean;
    clippedSampleRatio: number;
    confidence?: number;
    frequencyHz?: number | null;
    gain?: PracticeMicrophoneAnalysisGain;
    offsetMs: number;
    outcome?: string;
    peak: number;
    recognizedMidi?: number;
    rms: number;
    sampleCount: number;
    sampleOffset: number;
    zeroSampleRatio: number;
  }> = [];
  let sampleOffset = 0;

  for (const frame of frames) {
    frameManifest.push({
      ...(frame.analysisClippedSampleRatio === undefined ? {} : { analysisClippedSampleRatio: frame.analysisClippedSampleRatio }),
      ...(frame.analysisPeak === undefined ? {} : { analysisPeak: frame.analysisPeak }),
      ...(frame.analysisRms === undefined ? {} : { analysisRms: frame.analysisRms }),
      ...(frame.ambiguous === undefined ? {} : { ambiguous: frame.ambiguous }),
      clippedSampleRatio: frame.clippedSampleRatio,
      ...(frame.confidence === undefined ? {} : { confidence: frame.confidence }),
      ...(frame.frequencyHz === undefined ? {} : { frequencyHz: frame.frequencyHz }),
      ...(frame.gain === undefined ? {} : { gain: frame.gain }),
      offsetMs: Math.round(frame.offsetMs),
      ...(frame.outcome === undefined ? {} : { outcome: frame.outcome }),
      peak: frame.peak,
      ...(frame.recognizedMidi === undefined ? {} : { recognizedMidi: frame.recognizedMidi }),
      rms: frame.rms,
      sampleCount: frame.samples.length,
      sampleOffset,
      zeroSampleRatio: frame.zeroSampleRatio,
    });
    for (const sample of frame.samples) {
      pcmView.setFloat32(sampleOffset * Float32Array.BYTES_PER_ELEMENT, sample, true);
      sampleOffset += 1;
    }
  }

  return new Blob([JSON.stringify({
    format: "piano-learning-practice-microphone-capture",
    version: 4,
    exportedAt: new Date().toISOString(),
    metadata,
    ...(analysis === undefined ? {} : { analysis }),
    pcmSemantics: "concatenated-time-domain-analysis-windows; windows may overlap",
    frames: frameManifest,
    pcmEncoding: "float32-le-base64",
    pcmWindowsBase64: encodeBase64(pcmBytes),
  })], { type: "application/json" });
}
