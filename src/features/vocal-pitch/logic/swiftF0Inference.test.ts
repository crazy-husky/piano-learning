import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSwiftF0, createSwiftF0Session } from "./swiftF0Inference";

const SWIFTF0_PATH = resolve("public/models/vocal-pitch/swift-f0-v0.3.0.onnx");

function sine(frequencyHz: number): Float32Array {
  return Float32Array.from(
    { length: 16_000 },
    (_, index) => 0.2 * Math.sin(2 * Math.PI * frequencyHz * index / 16_000),
  );
}

describe("SwiftF0 live inference", () => {
  it("creates a WASM session and recognizes a reference tone", async () => {
    const modelBytes = await readFile(SWIFTF0_PATH);
    const model = modelBytes.buffer.slice(
      modelBytes.byteOffset,
      modelBytes.byteOffset + modelBytes.byteLength,
    );
    const session = await createSwiftF0Session(model);

    try {
      const result = await analyzeSwiftF0(session, sine(220), 16_000);
      expect(result.frequencyHz).toBeCloseTo(220, 0);
      expect(result.confidence).toBeGreaterThan(0);
    } finally {
      await session.release();
    }
  }, 30_000);
});
