import yin from "@audio/pitch-yin";
import type { PitchFrameCandidate, PitchFrameDetector } from "./pitchFrameDetector";

const TARGET_SAMPLE_RATE_HZ = 12_000;
const FRAME_PERIODS = 6;
const LOW_PASS_RADIUS = 15;

export interface PracticeYinDetectorOptions {
  maxFrequencyHz: number;
  minFrequencyHz: number;
  threshold: number;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

function getDownsampleFactor(sampleRate: number): number {
  return Math.max(1, Math.ceil(sampleRate / TARGET_SAMPLE_RATE_HZ));
}

export function getPracticeYinInputFrameSize(sampleRate: number, minFrequencyHz: number): number {
  const factor = getDownsampleFactor(sampleRate);
  const targetRate = sampleRate / factor;
  const analysisFrameSize = nextPowerOfTwo(Math.max(2048, Math.ceil(targetRate / minFrequencyHz * FRAME_PERIODS)));
  return nextPowerOfTwo(analysisFrameSize * factor);
}

function createLowPassKernel(factor: number): Float64Array {
  const kernel = new Float64Array(LOW_PASS_RADIUS * 2 + 1);
  const cutoff = 0.45 / factor;
  let sum = 0;

  for (let tap = -LOW_PASS_RADIUS; tap <= LOW_PASS_RADIUS; tap += 1) {
    const sinc = tap === 0
      ? 2 * cutoff
      : Math.sin(2 * Math.PI * cutoff * tap) / (Math.PI * tap);
    const window = 0.42 + 0.5 * Math.cos(Math.PI * tap / LOW_PASS_RADIUS) +
      0.08 * Math.cos(2 * Math.PI * tap / LOW_PASS_RADIUS);
    const coefficient = sinc * window;
    kernel[tap + LOW_PASS_RADIUS] = coefficient;
    sum += coefficient;
  }

  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return kernel;
}

function downsample(
  samples: Float32Array,
  factor: number,
  kernel: Float64Array,
  output: Float32Array,
): Float32Array {
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const center = outputIndex * factor;
    let value = 0;
    for (let tap = -LOW_PASS_RADIUS; tap <= LOW_PASS_RADIUS; tap += 1) {
      const sampleIndex = center + tap;
      if (sampleIndex >= 0 && sampleIndex < samples.length) {
        value += samples[sampleIndex] * kernel[tap + LOW_PASS_RADIUS];
      }
    }
    output[outputIndex] = value;
  }
  return output;
}

function emptyCandidate(): PitchFrameCandidate {
  return { clarity: 0, frequencyHz: 0 };
}

export function createPracticeYinDetector(
  frameSize: number,
  sampleRate: number,
  options: PracticeYinDetectorOptions,
): PitchFrameDetector {
  const factor = getDownsampleFactor(sampleRate);
  const targetRate = sampleRate / factor;
  const kernel = factor === 1 ? null : createLowPassKernel(factor);
  const outputBuffer = factor === 1 ? null : new Float32Array(Math.ceil(frameSize / factor));

  return {
    detect: (samples) => {
      const input = kernel && outputBuffer
        ? downsample(samples, factor, kernel, outputBuffer)
        : samples;
      const result = yin(input, {
        fs: targetRate,
        maxFreq: options.maxFrequencyHz,
        minFreq: options.minFrequencyHz,
        threshold: options.threshold,
      });
      const candidate = result
        ? { clarity: Math.max(0, Math.min(1, result.clarity)), frequencyHz: result.freq }
        : emptyCandidate();

      return { fallback: candidate, primary: candidate };
    },
  };
}
