/// <reference lib="webworker" />

import { DEFAULT_VOCAL_PITCH_CONFIG } from "../../../domain/vocalPitch";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import {
  analyzeSwiftF0Sequence,
  createSwiftF0Runtime,
  warmSwiftF0Runtime,
  type SwiftF0Runtime,
} from "./swiftF0Inference";
import {
  collectMicrophoneBenchmarkEvents,
  MICROPHONE_BENCHMARK_SWIFTF0_LOOKAHEAD_MS,
  scoreMicrophoneBenchmarkEvents,
  type MicrophoneBenchmarkAlgorithm,
  type MicrophoneBenchmarkConfiguration,
  type MicrophoneBenchmarkFrame,
  type MicrophoneBenchmarkResult,
} from "./microphoneParameterBenchmark";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "./practiceNoteRecognizer";
import {
  PRACTICE_MICROPHONE_ANALYSIS_GAINS,
  type PracticeMicrophoneAnalysisGain,
} from "./practiceMicrophonePreferences";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";

interface SwiftF0BenchmarkFrame {
  confidence: number;
  frequencyHz: number;
  rms: number;
  timeMs: number;
}

interface ScanRequest {
  algorithm: MicrophoneBenchmarkAlgorithm;
  configurations: MicrophoneBenchmarkConfiguration[];
  fixedParameters: {
    analysisGain: PracticeMicrophoneAnalysisGain;
    yinThreshold: number;
  };
  id: number;
  recordingIndex: 1 | 2;
  onsetMarkersMs: number[];
  expectedMidi: number[];
  sampleRate: number;
  samples: ArrayBuffer;
  type: "scan";
}

interface ScanCancelRequest {
  id: number;
  type: "cancel";
}

type BenchmarkRequest = ScanCancelRequest | ScanRequest;

let swiftF0RuntimePromise: Promise<SwiftF0Runtime> | null = null;

function getSwiftF0Runtime(): Promise<SwiftF0Runtime> {
  swiftF0RuntimePromise ??= createSwiftF0Runtime()
    .then(async (runtime) => {
      await warmSwiftF0Runtime(runtime);
      return runtime;
    })
    .catch((error: unknown) => {
      swiftF0RuntimePromise = null;
      throw error;
    });
  return swiftF0RuntimePromise;
}

function applyGain(samples: Float32Array, gain: PracticeMicrophoneAnalysisGain): Float32Array {
  if (gain === 1) return samples;
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
  }
  return output;
}

function calculateRms(samples: Float32Array, start: number, end: number): number {
  let energy = 0;
  let count = 0;
  for (let index = Math.max(0, start); index < Math.min(samples.length, end); index += 1) {
    const sample = samples[index] ?? 0;
    energy += sample * sample;
    count += 1;
  }
  return count > 0 ? Math.sqrt(energy / count) : 0;
}

function createYinObservations(
  samples: Float32Array,
  sampleRate: number,
  frameIntervalMs: number,
  yinThreshold: number
): { actualFrameIntervalMs: number; frames: MicrophoneBenchmarkFrame[]; processingMs: number } {
  const startedAt = performance.now();
  const hopSize = Math.max(1, Math.round((sampleRate * frameIntervalMs) / 1000));
  const actualFrameIntervalMs = (hopSize * 1000) / sampleRate;
  const frameSize = getPracticeYinInputFrameSize(
    sampleRate,
    PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
  );
  const detector = createPracticeYinDetector(frameSize, sampleRate, {
    maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
    minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
    threshold: yinThreshold,
  });
  const frameBuffer = new Float32Array(frameSize);
  const frames: MicrophoneBenchmarkFrame[] = [];

  for (let windowEnd = hopSize; windowEnd <= samples.length; windowEnd += hopSize) {
    const start = windowEnd - frameSize;
    frameBuffer.fill(0);
    const sourceStart = Math.max(0, start);
    const sourceEnd = Math.min(samples.length, windowEnd);
    frameBuffer.set(samples.subarray(sourceStart, sourceEnd), sourceStart - start);
    const timeMs = (windowEnd * 1000) / sampleRate;
    const detection = classifyPitchFrame(
      detector,
      frameBuffer,
      sampleRate,
      { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: 0 },
      timeMs / 1000,
      PRACTICE_NOTE_FREQUENCY_RANGE,
      0
    );
    frames.push({
      confidence: detection.candidate.clarity,
      frequencyHz: detection.candidate.frequencyHz,
      rms: detection.rms,
      timeMs,
    });
  }

  return {
    actualFrameIntervalMs,
    frames,
    processingMs: performance.now() - startedAt,
  };
}

function selectSwiftF0Observations(
  sequenceFrames: readonly SwiftF0BenchmarkFrame[],
  samples: Float32Array,
  sampleRate: number,
  frameIntervalMs: number
): { actualFrameIntervalMs: number; frames: MicrophoneBenchmarkFrame[]; processingMs: number } {
  const startedAt = performance.now();
  const hopSize = Math.max(1, Math.round((sampleRate * frameIntervalMs) / 1000));
  const requestedIntervalMs = (hopSize * 1000) / sampleRate;
  const windowSize = Math.max(1, hopSize);
  const frames: MicrophoneBenchmarkFrame[] = [];
  let nextTargetMs = requestedIntervalMs;
  let sequenceIndex = 0;

  while (nextTargetMs <= (samples.length * 1000) / sampleRate) {
    while (
      sequenceIndex + 1 < sequenceFrames.length &&
      Math.abs(sequenceFrames[sequenceIndex + 1]!.timeMs - nextTargetMs) <=
        Math.abs(sequenceFrames[sequenceIndex]!.timeMs - nextTargetMs)
    ) {
      sequenceIndex += 1;
    }
    const sequenceFrame = sequenceFrames[sequenceIndex];
    if (sequenceFrame) {
      const windowEnd = Math.round((nextTargetMs * sampleRate) / 1000);
      const windowStart = windowEnd - windowSize;
      frames.push({
        confidence: sequenceFrame.confidence,
        frequencyHz: sequenceFrame.frequencyHz,
        rms: calculateRms(samples, windowStart, windowEnd),
        timeMs: nextTargetMs + MICROPHONE_BENCHMARK_SWIFTF0_LOOKAHEAD_MS,
      });
    }
    nextTargetMs += requestedIntervalMs;
  }

  const actualFrameIntervalMs =
    frames.length > 1
      ? (frames[frames.length - 1]!.timeMs - frames[0]!.timeMs) / (frames.length - 1)
      : requestedIntervalMs;
  return { actualFrameIntervalMs, frames, processingMs: performance.now() - startedAt };
}

let cancelledId: number | null = null;

self.addEventListener("message", (event: MessageEvent<BenchmarkRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelledId = request.id;
    return;
  }

  cancelledId = null;
  void runScan(request).catch((error: unknown) => {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      id: request.id,
      type: "error",
    });
  });
});

async function runScan(request: ScanRequest): Promise<void> {
  if (!PRACTICE_MICROPHONE_ANALYSIS_GAINS.includes(request.fixedParameters.analysisGain)) {
    throw new Error("录音时的输入放大倍数无效，请重新录制。");
  }
  if (request.sampleRate <= 0 || request.configurations.length === 0) {
    throw new Error("没有可运行的参数组合或录音采样率无效。");
  }

  const rawSamples = new Float32Array(request.samples);
  const gainedSamples = applyGain(rawSamples, request.fixedParameters.analysisGain);
  let swiftF0Frames: SwiftF0BenchmarkFrame[] | undefined;
  let swiftF0ProcessingMs = 0;
  if (request.algorithm === "swiftf0") {
    self.postMessage({ id: request.id, type: "preparing" });
    const runtime = await getSwiftF0Runtime();
    const startedAt = performance.now();
    swiftF0Frames = await analyzeSwiftF0Sequence(
      runtime.session,
      gainedSamples,
      request.sampleRate
    );
    swiftF0ProcessingMs = performance.now() - startedAt;
  }

  const groupedByInterval = new Map<number, MicrophoneBenchmarkConfiguration[]>();
  for (const configuration of request.configurations) {
    const group = groupedByInterval.get(configuration.frameIntervalMs) ?? [];
    group.push(configuration);
    groupedByInterval.set(configuration.frameIntervalMs, group);
  }

  const results: MicrophoneBenchmarkResult[] = [];
  let completed = 0;
  for (const [frameIntervalMs, configurations] of groupedByInterval) {
    if (cancelledId === request.id) return;
    const extraction =
      request.algorithm === "swiftf0"
        ? selectSwiftF0Observations(
            swiftF0Frames ?? [],
            gainedSamples,
            request.sampleRate,
            frameIntervalMs
          )
        : createYinObservations(
            gainedSamples,
            request.sampleRate,
            frameIntervalMs,
            request.fixedParameters.yinThreshold
          );
    const extractionMs = extraction.processingMs;

    for (const configuration of configurations) {
      if (cancelledId === request.id) return;
      const evaluationStartedAt = performance.now();
      const predictedEvents = collectMicrophoneBenchmarkEvents(extraction.frames, configuration);
      const score = scoreMicrophoneBenchmarkEvents(
        request.expectedMidi,
        predictedEvents,
        request.onsetMarkersMs
      );
      const evaluationMs = performance.now() - evaluationStartedAt;
      const extractionShareMs = extractionMs / Math.max(1, configurations.length);
      results.push({
        ...configuration,
        actualFrameIntervalMs: extraction.actualFrameIntervalMs,
        recordingIndex: request.recordingIndex,
        score,
        workerProcessingMs: evaluationMs + extractionShareMs,
      });
      completed += 1;
      self.postMessage({
        completed,
        id: request.id,
        progress: completed / request.configurations.length,
        type: "progress",
      });
    }
  }

  if (request.algorithm === "swiftf0") {
    const share = swiftF0ProcessingMs / Math.max(1, request.configurations.length);
    for (const result of results) result.workerProcessingMs += share;
  }

  if (cancelledId === request.id) return;
  self.postMessage({ id: request.id, results, type: "complete" });
}
