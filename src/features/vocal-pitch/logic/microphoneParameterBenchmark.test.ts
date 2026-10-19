import { midiToFrequency } from "../../../domain/vocalPitch";
import { describe, expect, it } from "vitest";
import {
  collectMicrophoneBenchmarkEvents,
  createMicrophoneBenchmarkConfigurations,
  createMicrophoneBenchmarkTargetSequence,
  detectMicrophoneBenchmarkOnsets,
  encodeMicrophoneBenchmarkWav,
  MICROPHONE_BENCHMARK_ALGORITHMS,
  MICROPHONE_BENCHMARK_STABLE_DURATIONS,
  scoreMicrophoneBenchmarkEvents,
  summarizeMicrophoneBenchmarkSignal,
} from "./microphoneParameterBenchmark";

describe("microphone parameter benchmark", () => {
  it("builds the 648 combinations for one algorithm", () => {
    const configurations = createMicrophoneBenchmarkConfigurations("swiftf0", {
      confidenceThresholds: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      frameIntervals: [20, 30, 40, 50],
      inputRmsThresholdIds: ["low", "medium", "high"],
      requiredStableFrames: [2, 3, 4],
      requiredStableMs: [...MICROPHONE_BENCHMARK_STABLE_DURATIONS],
    });

    expect(configurations).toHaveLength(648);
    expect(configurations.some((configuration) => configuration.frameIntervalMs === 40)).toBe(true);
    expect(configurations.some((configuration) => configuration.requiredStableMs === 65)).toBe(
      true
    );
  });

  it("creates one ascending white-key then black-key pass across the game range", () => {
    const sequence = createMicrophoneBenchmarkTargetSequence();
    const allMidi = [...Array(60)].map((_, index) => 36 + index);
    const isWhiteKey = (midi: number) => [0, 2, 4, 5, 7, 9, 11].includes(midi % 12);
    const expectedFirstPass = [
      allMidi.filter(isWhiteKey),
      allMidi.filter((midi) => !isWhiteKey(midi)),
    ].flat();

    expect(sequence).toHaveLength(60);
    expect(sequence).toEqual(expectedFirstPass);
  });

  it("scans the primary and fallback algorithms with a full matrix and two takes", () => {
    const configurationsPerAlgorithm = MICROPHONE_BENCHMARK_ALGORITHMS.map((algorithm) =>
      createMicrophoneBenchmarkConfigurations(algorithm, {
        confidenceThresholds: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        frameIntervals: [20, 30, 40, 50],
        inputRmsThresholdIds: ["low", "medium", "high"],
        requiredStableFrames: [2, 3, 4],
        requiredStableMs: [...MICROPHONE_BENCHMARK_STABLE_DURATIONS],
      })
    );

    expect(configurationsPerAlgorithm.map((items) => items.length)).toEqual([648, 648]);
    expect(configurationsPerAlgorithm.reduce((sum, items) => sum + items.length, 0) * 2).toBe(2592);
  });

  it("encodes gained analysis samples as a mono PCM WAV", async () => {
    const wav = encodeMicrophoneBenchmarkWav(Float32Array.of(-1, 0, 0.5), 48_000);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(wav.type).toBe("audio/wav");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(16383);
  });

  it("reports original and amplified signal levels separately", () => {
    const summary = summarizeMicrophoneBenchmarkSignal(Float32Array.of(0.08, -0.08, 0.04), 15);

    expect(summary.rawRms).toBeCloseTo(Math.sqrt((0.08 ** 2 + 0.08 ** 2 + 0.04 ** 2) / 3));
    expect(summary.amplifiedPeak).toBe(1);
    expect(summary.amplifiedClippedRatio).toBeGreaterThan(0);
  });

  it("detects an RMS onset after the initial quiet calibration window", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(2000);
    for (let index = 1000; index < samples.length; index += 1) samples[index] = 0.2;

    const onsets = detectMicrophoneBenchmarkOnsets(samples, sampleRate, {
      noiseWindowMs: 500,
      windowMs: 20,
    });

    expect(onsets[0]).toBeGreaterThanOrEqual(900);
    expect(onsets[0]).toBeLessThanOrEqual(1000);
  });

  it("requires both stable frames and minimum stable duration", () => {
    const midi = 60;
    const frames = [0, 20, 40, 60].map((timeMs) => ({
      confidence: 0.8,
      frequencyHz: midiToFrequency(midi),
      rms: 0.01,
      timeMs,
    }));
    const events = collectMicrophoneBenchmarkEvents(frames, {
      confidenceThreshold: 0.6,
      inputRmsThreshold: 0.0018,
      requiredStableFrames: 2,
      requiredStableMs: 50,
    });
    const score = scoreMicrophoneBenchmarkEvents([midi], events, [0]);

    expect(events).toEqual([{ midi, timeMs: 60 }]);
    expect(score.correct).toBe(1);
    expect(score.accuracy).toBe(1);
    expect(score.meanLatencyMs).toBe(60);
  });

  it("separates wrong, missed, and extra detections", () => {
    const score = scoreMicrophoneBenchmarkEvents(
      [60, 62, 64],
      [
        { midi: 60, timeMs: 100 },
        { midi: 63, timeMs: 200 },
        { midi: 64, timeMs: 300 },
        { midi: 65, timeMs: 400 },
      ],
      [80, 180, 280]
    );

    expect(score.correct).toBe(2);
    expect(score.wrong).toBe(1);
    expect(score.wrongNotes).toEqual([{ expectedMidi: 62, predictedMidi: 63 }]);
    expect(score.missed).toBe(0);
    expect(score.missedMidi).toEqual([]);
    expect(score.extra).toBe(1);
    expect(score.falsePositiveRate).toBe(0.25);
  });
});
