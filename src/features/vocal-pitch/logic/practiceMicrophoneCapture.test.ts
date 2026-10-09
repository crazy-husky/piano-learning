import { describe, expect, it } from "vitest";
import {
  PRACTICE_MICROPHONE_FRAME_SEMANTICS,
  applyPracticeMicrophoneAnalysisGain,
  createPracticeMicrophoneCaptureBlob,
  summarizePracticeMicrophoneSamples,
  type PracticeMicrophoneCaptureFrame,
  type PracticeMicrophoneCaptureMetadata,
} from "./practiceMicrophoneCapture";

const metadata: PracticeMicrophoneCaptureMetadata = {
  algorithm: "mpm-c",
  analysisGain: 4,
  audioContextSampleRate: 48000,
  audioContextStateAtCaptureStart: "running",
  autoGainControl: false,
  audioSession: { atStart: { state: "active", type: "playback" }, atEnd: null },
  captureDurationMs: 0,
  captureEndedAt: null,
  captureStartedAt: "2026-10-07T00:00:00.000Z",
  captureStopReason: null,
  channelCount: 1,
  clippingThreshold: 0.999,
  confidenceThreshold: 0.75,
  debugMode: false,
  constraintSupport: {
    autoGainControl: true,
    channelCount: false,
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: false,
  },
  echoCancellation: false,
  frameCaptureIntervalMs: 50,
  frameIntervalSelection: "auto",
  frameSemantics: PRACTICE_MICROPHONE_FRAME_SEMANTICS,
  frameSize: 8192,
  inputRmsThreshold: 0.0018,
  lifecycleEvents: [],
  noiseSuppression: false,
  pcmCaptureIntervalMs: 50,
  primaryClarityThreshold: 0.8,
  requiredStableFrames: 4,
  requiredStableMs: 80,
  recordingLimitMs: 30000,
  requestedConstraints: {
    autoGainControl: false,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    sampleRate: null,
  },
  trackConstraints: {
    autoGainControl: false,
    channelCount: null,
    echoCancellation: false,
    noiseSuppression: false,
    sampleRate: null,
  },
  trackMutedAtCaptureStart: false,
  trackReadyStateAtCaptureStart: "live",
  trackSampleRate: 48000,
  trackSettings: {
    autoGainControl: false,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    sampleRate: 48000,
  },
  userAgent: "test browser",
  sensitivityLevel: 3,
  yinThreshold: 0.15,
};

describe("practice microphone capture", () => {
  it("summarizes silence, peak and clipping for a sampled window", () => {
    expect(summarizePracticeMicrophoneSamples(new Float32Array([-1, -0.5, 0, 0.5, 1])))
      .toEqual({
        clippedSampleRatio: 0.4,
        peak: 1,
        rms: Math.sqrt(0.5),
        zeroSampleRatio: 0.2,
      });
  });

  it("returns finite zero values for an empty window", () => {
    expect(summarizePracticeMicrophoneSamples(new Float32Array()))
      .toEqual({ clippedSampleRatio: 0, peak: 0, rms: 0, zeroSampleRatio: 0 });
  });

  it("amplifies analysis samples with digital clipping while preserving the raw samples", () => {
    const rawSamples = new Float32Array([0.1, -0.25, 0.6]);
    const rawSamplesBeforeGain = rawSamples.slice();

    const amplified = applyPracticeMicrophoneAnalysisGain(rawSamples, 4);

    expect(amplified[0]).toBeCloseTo(0.4);
    expect(Array.from(amplified.slice(1))).toEqual([-1, 1]);
    expect(rawSamples).toEqual(rawSamplesBeforeGain);
    expect(applyPracticeMicrophoneAnalysisGain(rawSamples, 1)).toBe(rawSamples);
  });

  it("exports time-offset analysis windows with explicit overlap semantics", async () => {
    const frames: PracticeMicrophoneCaptureFrame[] = [
      {
        clippedSampleRatio: 0,
        analysisClippedSampleRatio: 1,
        analysisPeak: 1,
        analysisRms: 1,
        gain: 4,
        offsetMs: 20,
        peak: 0.5,
        rms: 0.25,
        samples: new Float32Array([0.25, -0.25]),
        timeMs: 100,
        zeroSampleRatio: 0,
      },
      {
        clippedSampleRatio: 0.5,
        analysisClippedSampleRatio: 0.5,
        analysisPeak: 1,
        analysisRms: Math.sqrt(0.5),
        gain: 4,
        offsetMs: 120,
        peak: 1,
        rms: 0.75,
        samples: new Float32Array([1, 0]),
        timeMs: 200,
        zeroSampleRatio: 0.5,
      },
      {
        clippedSampleRatio: 0,
        confidence: 0.8,
        frequencyHz: 440,
        offsetMs: 150,
        peak: 0.5,
        rms: 0.25,
        samples: new Float32Array(0),
        timeMs: 230,
        zeroSampleRatio: 0,
      },
    ];
    const analysis = { counts: { detected: 1, difference: -1, expected: 2 }, events: [{ note: "A4", offsetMs: 120 }] };
    const blob = createPracticeMicrophoneCaptureBlob(metadata, frames, analysis);
    const exported = JSON.parse(await blob.text());

    expect(exported.version).toBe(4);
    expect(exported.pcmSemantics).toBe("concatenated-time-domain-analysis-windows; windows may overlap");
    expect(exported.metadata.analysisGain).toBe(4);
    expect(exported.analysis).toEqual(analysis);
    expect(exported.metadata.pcmCaptureIntervalMs).toBe(50);
    expect(exported.frames).toMatchObject([
      { offsetMs: 20, sampleCount: 2, sampleOffset: 0, peak: 0.5, zeroSampleRatio: 0 },
      {
        offsetMs: 120,
        sampleCount: 2,
        sampleOffset: 2,
        peak: 1,
        clippedSampleRatio: 0.5,
        analysisRms: Math.sqrt(0.5),
        analysisPeak: 1,
        analysisClippedSampleRatio: 0.5,
        gain: 4,
      },
      { offsetMs: 150, sampleCount: 0, sampleOffset: 4 },
    ]);
    expect(exported.metadata.constraintSupport.channelCount).toBe(false);
    expect(exported.metadata.requestedConstraints.channelCount).toBe(1);
    expect(exported.metadata.trackSettings.channelCount).toBe(1);

    const decoded = Uint8Array.from(atob(exported.pcmWindowsBase64), (character) => character.charCodeAt(0));
    const pcmView = new DataView(decoded.buffer);
    expect(Array.from({ length: 4 }, (_, index) => pcmView.getFloat32(index * 4, true)))
      .toEqual([0.25, -0.25, 1, 0]);
  });
});
