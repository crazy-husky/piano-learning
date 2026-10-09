import type {
  SwiftF0PracticeRequest,
  SwiftF0PracticeResponse,
} from "./swiftF0PracticeProtocol";

type MessageListener = (message: SwiftF0PracticeResponse) => void;

let worker: Worker | null = null;
let ready = false;
let initializationPromise: Promise<void> | null = null;
let resolveInitialization: (() => void) | null = null;
let rejectInitialization: ((error: Error) => void) | null = null;
const messageListeners = new Set<MessageListener>();

function clearWorker(): void {
  worker?.terminate();
  worker = null;
  ready = false;
}

function dispatch(message: SwiftF0PracticeResponse): void {
  for (const listener of messageListeners) {
    listener(message);
  }
}

function getWorker(): Worker {
  if (worker) return worker;

  const nextWorker = new Worker(new URL("./swiftF0Practice.worker.ts", import.meta.url), { type: "module" });
  nextWorker.addEventListener("message", (event: MessageEvent<SwiftF0PracticeResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready = true;
      const resolve = resolveInitialization;
      initializationPromise = null;
      resolveInitialization = null;
      rejectInitialization = null;
      resolve?.();
    } else if (message.type === "error" && message.id === undefined && !ready) {
      const reject = rejectInitialization;
      initializationPromise = null;
      resolveInitialization = null;
      rejectInitialization = null;
      clearWorker();
      reject?.(new Error(message.error));
      return;
    }
    dispatch(message);
  });
  nextWorker.addEventListener("error", (event: ErrorEvent) => {
    const error = new Error(event.message || "SwiftF0 Worker 启动失败");
    const reject = rejectInitialization;
    initializationPromise = null;
    resolveInitialization = null;
    rejectInitialization = null;
    clearWorker();
    reject?.(error);
    dispatch({ type: "error", error: error.message });
  });
  worker = nextWorker;
  return nextWorker;
}

export function isSwiftF0PracticeRuntimeReady(): boolean {
  return ready;
}

export function ensureSwiftF0PracticeRuntimeReady(): Promise<void> {
  if (ready) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  const activeWorker = getWorker();
  const promise = new Promise<void>((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });
  initializationPromise = promise;
  try {
    activeWorker.postMessage({ type: "initialize" } satisfies SwiftF0PracticeRequest);
  } catch (error) {
    const reject = rejectInitialization;
    initializationPromise = null;
    resolveInitialization = null;
    rejectInitialization = null;
    clearWorker();
    reject?.(error instanceof Error ? error : new Error(String(error)));
  }
  return promise;
}

export function getReadySwiftF0PracticeWorker(): Worker {
  if (!ready || !worker) {
    throw new Error("SwiftF0 尚未初始化");
  }
  return worker;
}

export function subscribeToSwiftF0PracticeMessages(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function releaseSwiftF0PracticeRuntime(): void {
  const reject = rejectInitialization;
  initializationPromise = null;
  resolveInitialization = null;
  rejectInitialization = null;
  clearWorker();
  reject?.(new Error("SwiftF0 资源加载已取消"));
}
