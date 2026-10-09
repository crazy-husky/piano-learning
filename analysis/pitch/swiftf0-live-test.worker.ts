/// <reference lib="webworker" />

import { analyzeSwiftF0, createSwiftF0Runtime } from "../../src/features/vocal-pitch/logic/swiftF0Inference";

let runtimePromise: ReturnType<typeof createSwiftF0Runtime> | null = null;

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as {
    type: "initialize" | "analyze";
    id?: number;
    samples?: ArrayBuffer;
    sampleRate?: number;
    generation?: number;
  };
  try {
    if (message.type === "initialize") {
      runtimePromise ??= createSwiftF0Runtime();
      const runtime = await runtimePromise;
      self.postMessage({ type: "ready", backend: runtime.backend });
      return;
    }

    if (!runtimePromise || !message.samples || !message.sampleRate) throw new Error("模型尚未就绪");
    const runtime = await runtimePromise;
    const result = await analyzeSwiftF0(runtime.session, new Float32Array(message.samples), message.sampleRate);
    self.postMessage({
      type: "result",
      id: message.id,
      generation: message.generation,
      ...result,
    });
  } catch (error) {
    if (message.type === "initialize") runtimePromise = null;
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      id: message.id,
      generation: message.generation,
    });
  }
});
