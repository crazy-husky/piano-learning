export type SwiftF0PracticeRequest =
  | { type: "initialize" }
  | { generation: number; id: number; sampleRate: number; samples: ArrayBuffer; type: "analyze" };

export type SwiftF0PracticeResponse =
  | { backend: "WASM"; type: "ready" }
  | {
      confidence: number;
      frequencyHz: number;
      generation: number;
      id: number;
      inferenceMs: number;
      type: "result";
    }
  | { error: string; generation?: number; id?: number; type: "error" };
