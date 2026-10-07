import * as ort from "onnxruntime-web/wasm";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { loadOrDownloadPitchModel } from "./enhancedPitchModels";
import {
  SWIFTF0_MAX_FREQUENCY_HZ,
  SWIFTF0_MIN_FREQUENCY_HZ,
  SWIFTF0_MODEL_SAMPLE_RATE,
  SWIFTF0_SILENCE_PEAK_THRESHOLD,
} from "./swiftF0Config";

const SWIFTF0_LOOKAHEAD_FRAMES = 10;

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
if (typeof globalThis.location !== "undefined") {
  ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, globalThis.location.href).href };
}

export interface SwiftF0Runtime {
  backend: "WASM";
  session: ort.InferenceSession;
}

export interface SwiftF0Result {
  confidence: number;
  frequencyHz: number;
  inferenceMs: number;
}

function resampleLinear(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === SWIFTF0_MODEL_SAMPLE_RATE) return samples;
  const outputLength = Math.max(1, Math.round(samples.length * SWIFTF0_MODEL_SAMPLE_RATE / sourceRate));
  const result = new Float32Array(outputLength);
  const sourceStep = sourceRate / SWIFTF0_MODEL_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * sourceStep;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    result[index] = samples[left] + (samples[right] - samples[left]) * fraction;
  }
  return result;
}

export function createSwiftF0Session(model: ArrayBuffer): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
}

export async function createSwiftF0Runtime(): Promise<SwiftF0Runtime> {
  return {
    backend: "WASM",
    session: await createSwiftF0Session(await loadOrDownloadPitchModel("swiftf0")),
  };
}

export async function analyzeSwiftF0(
  session: ort.InferenceSession,
  samples: Float32Array,
  sampleRate: number,
): Promise<SwiftF0Result> {
  const startedAt = performance.now();
  const samples16k = resampleLinear(samples, sampleRate);
  const output = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", samples16k, [1, samples16k.length]),
    [session.inputNames[1]]: new ort.Tensor("float32", Float32Array.of(SWIFTF0_MIN_FREQUENCY_HZ), []),
    [session.inputNames[2]]: new ort.Tensor("float32", Float32Array.of(SWIFTF0_MAX_FREQUENCY_HZ), []),
  });
  const frequenciesHz = output[session.outputNames[0]].data as Float64Array;
  const confidences = output[session.outputNames[1]].data as Float32Array;
  const lastFrame = frequenciesHz.length - SWIFTF0_LOOKAHEAD_FRAMES - 1;
  let framePeak = 0;
  if (lastFrame >= 0) {
    const frameStart = lastFrame * 256;
    for (let index = frameStart; index < Math.min(frameStart + 256, samples16k.length); index += 1) {
      framePeak = Math.max(framePeak, Math.abs(samples16k[index]));
    }
  }
  const silent = framePeak < SWIFTF0_SILENCE_PEAK_THRESHOLD;
  return {
    confidence: lastFrame >= 0 && !silent ? confidences[lastFrame] ?? 0 : 0,
    frequencyHz: lastFrame >= 0 && !silent ? frequenciesHz[lastFrame] ?? 0 : 0,
    inferenceMs: performance.now() - startedAt,
  };
}
