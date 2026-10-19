import { frequencyToMidi } from "../../../domain/vocalPitch";
import type { PracticeMicrophoneAlgorithm } from "./practiceMicrophonePreferences";
import {
  applyPracticeMicrophoneAnalysisGain,
  PRACTICE_MICROPHONE_CLIPPING_THRESHOLD,
} from "./practiceMicrophoneCapture";

export const MICROPHONE_BENCHMARK_FRAME_INTERVALS = [20, 30, 40, 50] as const;
export const MICROPHONE_BENCHMARK_CONFIDENCE_THRESHOLDS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;
export const MICROPHONE_BENCHMARK_RMS_THRESHOLDS = [
  { id: "low", label: "低", value: 0.0009 },
  { id: "medium", label: "中", value: 0.0018 },
  { id: "high", label: "高", value: 0.0036 },
] as const;
export const MICROPHONE_BENCHMARK_STABLE_FRAME_COUNTS = [2, 3, 4] as const;
export const MICROPHONE_BENCHMARK_GAME_RANGE = { minMidi: 36, maxMidi: 95 } as const;
export const MICROPHONE_BENCHMARK_SWIFTF0_HOP_MS = (256 / 16_000) * 1000;
export const MICROPHONE_BENCHMARK_SWIFTF0_LOOKAHEAD_MS = 10 * MICROPHONE_BENCHMARK_SWIFTF0_HOP_MS;
export type MicrophoneBenchmarkAlgorithm = PracticeMicrophoneAlgorithm;

export const MICROPHONE_BENCHMARK_ALGORITHMS: readonly MicrophoneBenchmarkAlgorithm[] = [
  "yin",
  "swiftf0",
];

export interface MicrophoneBenchmarkConfiguration {
  algorithm: MicrophoneBenchmarkAlgorithm;
  confidenceThreshold: number;
  frameIntervalMs: number;
  inputRmsThreshold: number;
  inputRmsThresholdId: string;
  inputRmsThresholdLabel: string;
  requiredStableFrames: number;
}

export interface MicrophoneBenchmarkSelections {
  confidenceThresholds: readonly number[];
  frameIntervals: readonly number[];
  inputRmsThresholdIds: readonly string[];
  requiredStableFrames: readonly number[];
}

export interface MicrophoneBenchmarkFrame {
  confidence: number;
  frequencyHz: number;
  rms: number;
  timeMs: number;
}

export interface MicrophoneBenchmarkNoteEvent {
  midi: number;
  timeMs: number;
}

export interface MicrophoneBenchmarkScore {
  accuracy: number;
  correct: number;
  extra: number;
  falsePositiveRate: number;
  latencySampleCount: number;
  latencyCoverage: number;
  meanLatencyMs: number | null;
  missed: number;
  missedRate: number;
  predicted: number;
  onsetMarkerCount: number;
  truePositiveLatenciesMs: number[];
  wrong: number;
  wrongRate: number;
}

export interface MicrophoneBenchmarkResult extends MicrophoneBenchmarkConfiguration {
  actualFrameIntervalMs: number;
  recordingIndex: 1 | 2;
  score: MicrophoneBenchmarkScore;
  workerProcessingMs: number;
}

export interface MicrophoneBenchmarkSignalSummary {
  amplifiedClippedRatio: number;
  amplifiedPeak: number;
  amplifiedRms: number;
  rawClippedRatio: number;
  rawPeak: number;
  rawRms: number;
}

interface AlignmentCell {
  cost: number;
  operation: "match" | "substitute" | "delete" | "insert";
}

interface CorrectEventAlignment {
  expectedIndex: number;
  event: MicrophoneBenchmarkNoteEvent;
}

export function createMicrophoneBenchmarkConfigurations(
  algorithm: MicrophoneBenchmarkAlgorithm,
  selections: MicrophoneBenchmarkSelections
): MicrophoneBenchmarkConfiguration[] {
  const rmsThresholds = MICROPHONE_BENCHMARK_RMS_THRESHOLDS.filter((threshold) =>
    selections.inputRmsThresholdIds.includes(threshold.id)
  );
  return selections.frameIntervals.flatMap((frameIntervalMs) =>
    selections.confidenceThresholds.flatMap((confidenceThreshold) =>
      rmsThresholds.flatMap((rmsThreshold) =>
        selections.requiredStableFrames.map((requiredStableFrames) => ({
          algorithm,
          confidenceThreshold,
          frameIntervalMs,
          inputRmsThreshold: rmsThreshold.value,
          inputRmsThresholdId: rmsThreshold.id,
          inputRmsThresholdLabel: rmsThreshold.label,
          requiredStableFrames,
        }))
      )
    )
  );
}

export function createMicrophoneBenchmarkTargetSequence(): number[] {
  const whitePitchClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
  const whiteKeys: number[] = [];
  const blackKeys: number[] = [];
  for (
    let midi = MICROPHONE_BENCHMARK_GAME_RANGE.minMidi;
    midi <= MICROPHONE_BENCHMARK_GAME_RANGE.maxMidi;
    midi += 1
  ) {
    if (whitePitchClasses.has(((midi % 12) + 12) % 12)) whiteKeys.push(midi);
    else blackKeys.push(midi);
  }
  return [...whiteKeys, ...blackKeys];
}

export function encodeMicrophoneBenchmarkWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      44 + index * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function summarizeMicrophoneBenchmarkSignal(
  samples: Float32Array,
  inputGain: Parameters<typeof applyPracticeMicrophoneAnalysisGain>[1]
): MicrophoneBenchmarkSignalSummary {
  const amplifiedSamples = applyPracticeMicrophoneAnalysisGain(samples, inputGain);
  let rawEnergy = 0;
  let amplifiedEnergy = 0;
  let rawPeak = 0;
  let amplifiedPeak = 0;
  let rawClipped = 0;
  let amplifiedClipped = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const rawMagnitude = Math.abs(samples[index] ?? 0);
    const amplifiedMagnitude = Math.abs(amplifiedSamples[index] ?? 0);
    rawEnergy += rawMagnitude * rawMagnitude;
    amplifiedEnergy += amplifiedMagnitude * amplifiedMagnitude;
    rawPeak = Math.max(rawPeak, rawMagnitude);
    amplifiedPeak = Math.max(amplifiedPeak, amplifiedMagnitude);
    if (rawMagnitude >= PRACTICE_MICROPHONE_CLIPPING_THRESHOLD) rawClipped += 1;
    if (amplifiedMagnitude >= PRACTICE_MICROPHONE_CLIPPING_THRESHOLD) amplifiedClipped += 1;
  }

  const sampleCount = Math.max(1, samples.length);
  return {
    amplifiedClippedRatio: amplifiedClipped / sampleCount,
    amplifiedPeak,
    amplifiedRms: Math.sqrt(amplifiedEnergy / sampleCount),
    rawClippedRatio: rawClipped / sampleCount,
    rawPeak,
    rawRms: Math.sqrt(rawEnergy / sampleCount),
  };
}

export function createMicrophoneBenchmarkWaveform(
  samples: Float32Array,
  bucketCount = 600
): number[] {
  if (samples.length === 0 || bucketCount <= 0) return [];
  const bucketSize = Math.max(1, Math.ceil(samples.length / bucketCount));
  const waveform: number[] = [];
  for (let start = 0; start < samples.length; start += bucketSize) {
    let peak = 0;
    const end = Math.min(samples.length, start + bucketSize);
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    waveform.push(peak);
  }
  return waveform;
}

export function detectMicrophoneBenchmarkOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: { minimumGapMs?: number; noiseWindowMs?: number; windowMs?: number } = {}
): number[] {
  if (samples.length === 0 || sampleRate <= 0) return [];
  const windowSize = Math.max(1, Math.round((sampleRate * (options.windowMs ?? 10)) / 1000));
  const hopSize = Math.max(1, Math.round(windowSize / 2));
  const rmsValues: Array<{ rms: number; timeMs: number }> = [];
  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + windowSize);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      energy += sample * sample;
    }
    rmsValues.push({
      rms: Math.sqrt(energy / Math.max(1, end - start)),
      timeMs: (start * 1000) / sampleRate,
    });
  }

  const noiseWindowMs = options.noiseWindowMs ?? 800;
  const noiseSamples = rmsValues
    .filter((sample) => sample.timeMs <= noiseWindowMs)
    .map((sample) => sample.rms)
    .sort((left, right) => left - right);
  const backgroundRms = noiseSamples[Math.floor(noiseSamples.length / 2)] ?? 0;
  const threshold = Math.max(backgroundRms * 2, 0.0002);
  const minGapMs = options.minimumGapMs ?? 120;
  const onsets: number[] = [];
  let previousRms = 0;
  let lastOnsetMs = Number.NEGATIVE_INFINITY;
  let releaseSamples = 0;
  let isSounding = false;
  let isArmed = true;

  for (let index = 0; index < rmsValues.length; index += 1) {
    const sample = rmsValues[index]!;
    const localRise = sample.rms >= Math.max(threshold, previousRms * 1.6);
    if (
      isArmed &&
      sample.timeMs > noiseWindowMs &&
      localRise &&
      sample.timeMs - lastOnsetMs >= minGapMs
    ) {
      onsets.push(sample.timeMs);
      lastOnsetMs = sample.timeMs;
      isSounding = true;
      isArmed = false;
      releaseSamples = 0;
    }

    if (isSounding && sample.rms < Math.max(backgroundRms * 1.5, threshold * 0.6)) {
      releaseSamples += 1;
      if (releaseSamples >= 3) {
        isSounding = false;
        isArmed = true;
      }
    } else {
      releaseSamples = 0;
    }
    previousRms = sample.rms;
  }
  return onsets;
}

function toChromaticMidi(frequencyHz: number): number | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const midiValue = frequencyToMidi(frequencyHz);
  const midi = Math.round(midiValue);
  if (
    midi < MICROPHONE_BENCHMARK_GAME_RANGE.minMidi ||
    midi > MICROPHONE_BENCHMARK_GAME_RANGE.maxMidi ||
    Math.abs(midiValue - midi) * 100 > 45
  ) {
    return null;
  }
  return midi;
}

export function collectMicrophoneBenchmarkEvents(
  frames: readonly MicrophoneBenchmarkFrame[],
  configuration: Pick<
    MicrophoneBenchmarkConfiguration,
    "confidenceThreshold" | "inputRmsThreshold" | "requiredStableFrames"
  >
): MicrophoneBenchmarkNoteEvent[] {
  const events: MicrophoneBenchmarkNoteEvent[] = [];
  let candidateMidi: number | null = null;
  let candidateFrames = 0;
  let activeMidi: number | null = null;
  let silenceFrames = 0;

  for (const frame of frames) {
    const midi =
      frame.confidence >= configuration.confidenceThreshold &&
      frame.rms >= configuration.inputRmsThreshold
        ? toChromaticMidi(frame.frequencyHz)
        : null;

    if (midi === null) {
      candidateMidi = null;
      candidateFrames = 0;
      silenceFrames += 1;
      if (silenceFrames >= 2) activeMidi = null;
      continue;
    }

    silenceFrames = 0;
    if (midi === candidateMidi) candidateFrames += 1;
    else {
      candidateMidi = midi;
      candidateFrames = 1;
    }

    if (candidateFrames >= configuration.requiredStableFrames && midi !== activeMidi) {
      events.push({ midi, timeMs: frame.timeMs });
      activeMidi = midi;
    }
  }

  return events;
}

export function scoreMicrophoneBenchmarkEvents(
  expectedMidi: readonly number[],
  predictedEvents: readonly MicrophoneBenchmarkNoteEvent[],
  onsetMarkersMs: readonly number[]
): MicrophoneBenchmarkScore {
  const grid: AlignmentCell[][] = Array.from({ length: expectedMidi.length + 1 }, () =>
    Array.from({ length: predictedEvents.length + 1 }, () => ({ cost: 0, operation: "match" }))
  );
  for (let expectedIndex = 1; expectedIndex <= expectedMidi.length; expectedIndex += 1) {
    grid[expectedIndex]![0] = { cost: expectedIndex, operation: "delete" };
  }
  for (let predictedIndex = 1; predictedIndex <= predictedEvents.length; predictedIndex += 1) {
    grid[0]![predictedIndex] = { cost: predictedIndex, operation: "insert" };
  }
  for (let expectedIndex = 1; expectedIndex <= expectedMidi.length; expectedIndex += 1) {
    for (let predictedIndex = 1; predictedIndex <= predictedEvents.length; predictedIndex += 1) {
      if (expectedMidi[expectedIndex - 1] === predictedEvents[predictedIndex - 1]?.midi) {
        grid[expectedIndex]![predictedIndex] = {
          cost: grid[expectedIndex - 1]![predictedIndex - 1]!.cost,
          operation: "match",
        };
        continue;
      }
      const choices: AlignmentCell[] = [
        {
          cost: grid[expectedIndex - 1]![predictedIndex - 1]!.cost + 1,
          operation: "substitute",
        },
        { cost: grid[expectedIndex - 1]![predictedIndex]!.cost + 1, operation: "delete" },
        { cost: grid[expectedIndex]![predictedIndex - 1]!.cost + 1, operation: "insert" },
      ];
      grid[expectedIndex]![predictedIndex] = choices.reduce((best, next) =>
        next.cost < best.cost ? next : best
      );
    }
  }

  let expectedIndex = expectedMidi.length;
  let predictedIndex = predictedEvents.length;
  let correct = 0;
  let wrong = 0;
  let missed = 0;
  let extra = 0;
  const correctAlignments: CorrectEventAlignment[] = [];
  while (expectedIndex > 0 || predictedIndex > 0) {
    const operation = grid[expectedIndex]![predictedIndex]!.operation;
    if (operation === "match") {
      const event = predictedEvents[predictedIndex - 1];
      correct += 1;
      if (event) correctAlignments.push({ expectedIndex: expectedIndex - 1, event });
      expectedIndex -= 1;
      predictedIndex -= 1;
    } else if (operation === "substitute") {
      wrong += 1;
      expectedIndex -= 1;
      predictedIndex -= 1;
    } else if (operation === "delete") {
      missed += 1;
      expectedIndex -= 1;
    } else {
      extra += 1;
      predictedIndex -= 1;
    }
  }

  // Pair each correct recognition event with its closest earlier, unused onset marker.
  // Marker counts can differ from the target count because RMS onset detection may find
  // transients inside a note or miss a legato transition. A mismatch must not erase every
  // latency value, and each marker may only explain one recognized note.
  const truePositiveLatenciesMs: number[] = [];
  const maximumLatencyMs = 2_000;
  let lastUsedMarkerIndex = -1;
  for (const alignment of correctAlignments.reverse()) {
    let candidateIndex = -1;
    for (let index = lastUsedMarkerIndex + 1; index < onsetMarkersMs.length; index += 1) {
      const markerMs = onsetMarkersMs[index];
      if (markerMs === undefined || markerMs > alignment.event.timeMs) break;
      if (alignment.event.timeMs - markerMs <= maximumLatencyMs) candidateIndex = index;
    }
    if (candidateIndex < 0) continue;
    const onsetMs = onsetMarkersMs[candidateIndex];
    if (onsetMs === undefined) continue;
    truePositiveLatenciesMs.push(alignment.event.timeMs - onsetMs);
    lastUsedMarkerIndex = candidateIndex;
  }

  const expectedCount = Math.max(1, expectedMidi.length);
  const predictedCount = Math.max(1, predictedEvents.length);
  return {
    accuracy: correct / expectedCount,
    correct,
    extra,
    falsePositiveRate: extra / predictedCount,
    latencySampleCount: truePositiveLatenciesMs.length,
    latencyCoverage: correct > 0 ? truePositiveLatenciesMs.length / correct : 0,
    meanLatencyMs:
      truePositiveLatenciesMs.length > 0
        ? truePositiveLatenciesMs.reduce((sum, latency) => sum + latency, 0) /
          truePositiveLatenciesMs.length
        : null,
    missed,
    missedRate: missed / expectedCount,
    predicted: predictedEvents.length,
    onsetMarkerCount: onsetMarkersMs.length,
    truePositiveLatenciesMs,
    wrong,
    wrongRate: wrong / expectedCount,
  };
}
