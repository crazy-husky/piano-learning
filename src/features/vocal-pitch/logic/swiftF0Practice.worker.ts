/// <reference lib="webworker" />

import { analyzeSwiftF0, createSwiftF0Runtime, type SwiftF0Runtime } from "./swiftF0Inference";
import type { SwiftF0PracticeRequest, SwiftF0PracticeResponse } from "./swiftF0PracticeProtocol";

let runtimePromise: Promise<SwiftF0Runtime> | null = null;

function postResponse(response: SwiftF0PracticeResponse): void {
  self.postMessage(response);
}

self.addEventListener("message", async (event: MessageEvent<SwiftF0PracticeRequest>) => {
  const message = event.data;
  try {
    if (message.type === "initialize") {
      runtimePromise ??= createSwiftF0Runtime();
      const runtime = await runtimePromise;
      postResponse({ type: "ready", backend: runtime.backend });
      return;
    }

    if (!runtimePromise) throw new Error("SwiftF0 尚未初始化");
    const runtime = await runtimePromise;
    const result = await analyzeSwiftF0(runtime.session, new Float32Array(message.samples), message.sampleRate);
    postResponse({ ...result, generation: message.generation, id: message.id, type: "result" });
  } catch (error) {
    if (message.type === "initialize") runtimePromise = null;
    postResponse({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      ...(message.type === "analyze" ? { generation: message.generation, id: message.id } : {}),
    });
  }
});
