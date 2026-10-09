import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../../../domain/vocalPitch";
import type {
  PracticeMicrophoneCaptureFrame,
  PracticeMicrophoneCaptureMetadata,
} from "./practiceMicrophoneCapture";
import { PRACTICE_MICROPHONE_FRAME_SEMANTICS } from "./practiceMicrophoneCapture";
import {
  analyzePracticeMicrophoneCapture,
  parseExpectedPracticeNoteSequence,
} from "./practiceMicrophoneAnalysis";

const metadata: PracticeMicrophoneCaptureMetadata = {
  algorithm: "mpm-c",
  analysisGain: 1,
  audioContextSampleRate: 48000,
  audioContextStateAtCaptureStart: "running",
  autoGainControl: false,
  audioSession: { atStart: null, atEnd: null },
  captureDurationMs: 5000,
  captureEndedAt: "2026-10-07T00:00:05.000Z",
  captureStartedAt: "2026-10-07T00:00:00.000Z",
  captureStopReason: "manual",
  channelCount: 1,
  clippingThreshold: 0.999,
  confidenceThreshold: 0.6,
  debugMode: false,
  constraintSupport: null,
  echoCancellation: false,
  frameCaptureIntervalMs: 30,
  frameIntervalSelection: 30,
  frameSemantics: PRACTICE_MICROPHONE_FRAME_SEMANTICS,
  frameSize: 8192,
  inputRmsThreshold: 0.0009,
  lifecycleEvents: [],
  noiseSuppression: false,
  pcmCaptureIntervalMs: 50,
  primaryClarityThreshold: 0.65,
  requiredStableFrames: 2,
  requiredStableMs: 50,
  recordingLimitMs: 30000,
  requestedConstraints: {
    autoGainControl: false,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    sampleRate: null,
  },
  trackConstraints: null,
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
  sensitivityLevel: 1,
  yinThreshold: 0.25,
};

function makeFrame(offsetMs: number, midi: number | null, overrides: Partial<PracticeMicrophoneCaptureFrame> = {}): PracticeMicrophoneCaptureFrame {
  return {
    ambiguous: false,
    clippedSampleRatio: 0,
    confidence: midi === null ? 0 : 0.9,
    frequencyHz: midi === null ? null : midiToFrequency(midi),
    offsetMs,
    outcome: midi === null ? "silence" : "candidate",
    peak: 0.01,
    rms: midi === null ? 0 : 0.005,
    analysisRms: midi === null ? 0 : 0.005,
    samples: new Float32Array(4),
    timeMs: offsetMs,
    zeroSampleRatio: 0,
    ...overrides,
  };
}

function appendStableNote(frames: PracticeMicrophoneCaptureFrame[], midi: number, startMs: number): number {
  frames.push(makeFrame(startMs, midi), makeFrame(startMs + 30, midi), makeFrame(startMs + 60, midi));
  return startMs + 90;
}

describe("practice microphone capture analysis", () => {
  it("parses the default central C white-key sequence and allows free-play analysis", () => {
    expect(parseExpectedPracticeNoteSequence("C4 D4 E4 F4 G4 A4 B4"))
      .toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(parseExpectedPracticeNoteSequence("C4, D4，E4、F4"))
      .toEqual([60, 62, 64, 65]);
    expect(parseExpectedPracticeNoteSequence(" ")).toBeNull();
    expect(parseExpectedPracticeNoteSequence("C4 D#4")).toBeNull();
    expect(parseExpectedPracticeNoteSequence("C0")).toBeNull();
    expect(parseExpectedPracticeNoteSequence(new Array(66).fill("C4").join(" "))).toBeNull();
  });

  it("replays stable detections and reports correct notes and timing", () => {
    const frames: PracticeMicrophoneCaptureFrame[] = [];
    let timeMs = 0;
    for (const midi of [60, 62, 64, 65, 67, 69, 71]) {
      timeMs = appendStableNote(frames, midi, timeMs);
      frames.push(makeFrame(timeMs, null), makeFrame(timeMs + 30, null));
      timeMs += 60;
    }

    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, [60, 62, 64, 65, 67, 69, 71]);

    expect(analysis.counts).toEqual({ correct: 7, detected: 7, difference: 0, extra: 0, expected: 7, missed: 0, wrong: 0 });
    expect(analysis.parameters).toMatchObject({
      algorithm: "mpm-c",
      analysisGain: 1,
      debugMode: false,
      frameIntervalSelection: 30,
      primaryClarityThreshold: 0.65,
      requiredStableFrames: 2,
      requiredStableMs: 50,
      sensitivityLevel: 1,
      yinThreshold: 0.25,
    });
    expect(analysis.events.map(({ note, offsetMs, intervalFromPreviousMs, classification }) => ({
      note,
      offsetMs,
      intervalFromPreviousMs,
      classification,
    })))
      .toEqual(["C4", "D4", "E4", "F4", "G4", "A4", "B4"].map((note, index) => ({
        note,
        offsetMs: index * 150 + 60,
        intervalFromPreviousMs: index === 0 ? null : 150,
        classification: "correct",
      })));
    expect(analysis.medianFrameIntervalMs).toBe(30);
  });

  it("distinguishes an extra recognized note from a wrong or missed note", () => {
    const frames = [
      makeFrame(0, 60), makeFrame(30, 60), makeFrame(60, 60),
      makeFrame(90, null), makeFrame(120, null),
      makeFrame(150, 60), makeFrame(180, 60), makeFrame(210, 60),
      makeFrame(240, null), makeFrame(270, null),
      makeFrame(300, 65), makeFrame(330, 65), makeFrame(360, 65),
    ];

    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, [60, 62]);

    expect(analysis.counts).toEqual({ correct: 1, detected: 3, difference: 1, extra: 1, expected: 2, missed: 0, wrong: 1 });
    expect(analysis.events.map((event) => [event.note, event.classification, event.expectedMidiNoteNumber]))
      .toEqual([["C4", "correct", 60], ["C4", "extra", null], ["F4", "wrong", 62]]);
  });

  it("reports three extra detections when seven expected notes produce ten events", () => {
    const expected = [60, 62, 64, 65, 67, 69, 71];
    const detected = [...expected, 60, 62, 64];
    const frames: PracticeMicrophoneCaptureFrame[] = [];
    let timeMs = 0;
    for (const midi of detected) {
      frames.push(makeFrame(timeMs, midi), makeFrame(timeMs + 30, midi), makeFrame(timeMs + 60, midi));
      frames.push(makeFrame(timeMs + 90, null), makeFrame(timeMs + 120, null));
      timeMs += 150;
    }

    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, expected);

    expect(analysis.counts).toEqual({ correct: 7, detected: 10, difference: 3, extra: 3, expected: 7, missed: 0, wrong: 0 });
  });

  it("keeps short unstable candidates visible without counting them as recognized notes", () => {
    const analysis = analyzePracticeMicrophoneCapture(metadata, [makeFrame(0, 64)], [64]);

    expect(analysis.counts).toEqual({ correct: 0, detected: 0, difference: -1, extra: 0, expected: 1, missed: 1, wrong: 0 });
    expect(analysis.unansweredCandidateSegmentCount).toBe(1);
    expect(analysis.candidateSegments[0]).toMatchObject({
      note: "E4",
      frameCount: 1,
      stableThresholdMet: false,
      thresholdEligibleFrameCount: 1,
    });
  });

  it("keeps trigger-frame raw and processed signal values for recognized notes", () => {
    const frames = [
      makeFrame(0, 64, { confidence: 0.7, rms: 0.001, analysisRms: 0.01, peak: 0.003, analysisPeak: 0.03 }),
      makeFrame(30, 64, { confidence: 0.8, rms: 0.002, analysisRms: 0.02, peak: 0.004, analysisPeak: 0.04 }),
      makeFrame(60, 64, { confidence: 0.9, rms: 0.003, analysisRms: 0.03, peak: 0.005, analysisPeak: 0.05 }),
    ];

    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, [64]);

    expect(analysis.events[0]).toMatchObject({
      analysisRms: 0.03,
      analysisPeak: 0.05,
      confidence: 0.9,
      frequencyHz: midiToFrequency(64),
      offsetMs: 60,
      peak: 0.005,
      rms: 0.003,
    });
    expect(analysis.candidateSegments[0]).toMatchObject({
      analysisRmsAverage: 0.02,
      analysisRmsMaximum: 0.03,
      confidenceMaximum: 0.9,
      frameCount: 3,
      inputRmsAverage: 0.002,
      inputRmsMaximum: 0.003,
      stableEventCount: 1,
      stableThresholdMet: true,
      frames: [
        { analysisRms: 0.01, confidence: 0.7, eligible: true, offsetMs: 0, rms: 0.001 },
        { analysisRms: 0.02, confidence: 0.8, eligible: true, offsetMs: 30, rms: 0.002 },
        { analysisRms: 0.03, confidence: 0.9, eligible: true, offsetMs: 60, rms: 0.003 },
      ],
    });
    expect(analysis.candidateSegments[0].confidenceAverage).toBeCloseTo(0.8, 10);
  });

  it("identifies confidence and RMS gate failures in candidate frame diagnostics", () => {
    const frames = [
      makeFrame(0, 64, { confidence: 0.5, rms: 0.002, analysisRms: 0.01 }),
      makeFrame(30, 64, { confidence: 0.7, rms: 0.002, analysisRms: 0.0005 }),
      makeFrame(60, 64, { confidence: 0.8, rms: 0.003, analysisRms: 0.02 }),
    ];

    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, [64]);

    expect(analysis.candidateSegments[0]).toMatchObject({
      lowConfidenceFrameCount: 1,
      lowRmsFrameCount: 1,
      stableEventCount: 0,
      stableThresholdMet: false,
      thresholdEligibleFrameCount: 1,
      frames: [
        { eligible: false },
        { eligible: false },
        { eligible: true },
      ],
    });
  });

  it("does not claim correctness when no expected sequence is supplied", () => {
    const frames = [makeFrame(0, 64), makeFrame(30, 64), makeFrame(60, 64)];
    const analysis = analyzePracticeMicrophoneCapture(metadata, frames, null);

    expect(analysis.counts).toEqual({ correct: null, detected: 1, difference: null, extra: null, expected: null, missed: null, wrong: null });
    expect(analysis.events[0].classification).toBe("uncompared");
  });
});
