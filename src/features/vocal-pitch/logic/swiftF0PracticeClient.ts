import type { SwiftF0PracticeRequest, SwiftF0PracticeResponse } from "./swiftF0PracticeProtocol";

type MessageListener = (message: SwiftF0PracticeResponse) => void;

let worker: Worker | null = null;
let ready = false;
let initializationPromise: Promise<void> | null = null;
let resolveInitialization: (() => void) | null = null;
let rejectInitialization: ((error: Error) => void) | null = null;
let initializationTimeoutId: number | null = null;
let initializationDeadlineAt = 0;
const messageListeners = new Set<MessageListener>();

function clearInitializationTimeout(): void {
  if (initializationTimeoutId !== null) {
    window.clearTimeout(initializationTimeoutId);
    initializationTimeoutId = null;
  }
  initializationDeadlineAt = 0;
}

function clearWorker(): void {
  clearInitializationTimeout();
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

  const nextWorker = new Worker(new URL("./swiftF0Practice.worker.ts", import.meta.url), {
    type: "module",
  });
  nextWorker.addEventListener("message", (event: MessageEvent<SwiftF0PracticeResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready = true;
      clearInitializationTimeout();
      const resolve = resolveInitialization;
      initializationPromise = null;
      resolveInitialization = null;
      rejectInitialization = null;
      resolve?.();
    } else if (message.type === "error" && message.id === undefined && !ready) {
      clearInitializationTimeout();
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
    clearInitializationTimeout();
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

export function ensureSwiftF0PracticeRuntimeReady(timeoutMs = 20_000): Promise<void> {
  if (ready) return Promise.resolve();
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 20_000;
  const deadlineAt = Date.now() + effectiveTimeoutMs;
  if (initializationPromise) {
    if (initializationTimeoutId === null || deadlineAt < initializationDeadlineAt) {
      clearInitializationTimeout();
      initializationDeadlineAt = deadlineAt;
      initializationTimeoutId = window.setTimeout(
        () => {
          initializationTimeoutId = null;
          initializationDeadlineAt = 0;
          const activeWorker = worker;
          if (!activeWorker || ready) return;
          const reject = rejectInitialization;
          initializationPromise = null;
          resolveInitialization = null;
          rejectInitialization = null;
          clearWorker();
          reject?.(new Error("SwiftF0 Worker 初始化超时，请重试。"));
        },
        Math.max(1, deadlineAt - Date.now())
      );
    }
    return initializationPromise;
  }

  const activeWorker = getWorker();
  const promise = new Promise<void>((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });
  initializationPromise = promise;
  initializationDeadlineAt = deadlineAt;
  initializationTimeoutId = window.setTimeout(
    () => {
      initializationTimeoutId = null;
      initializationDeadlineAt = 0;
      if (worker !== activeWorker || ready) return;
      const reject = rejectInitialization;
      initializationPromise = null;
      resolveInitialization = null;
      rejectInitialization = null;
      clearWorker();
      reject?.(new Error("SwiftF0 Worker 初始化超时，请重试。"));
    },
    Math.max(1, deadlineAt - Date.now())
  );
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
  clearInitializationTimeout();
  const reject = rejectInitialization;
  initializationPromise = null;
  resolveInitialization = null;
  rejectInitialization = null;
  clearWorker();
  reject?.(new Error("SwiftF0 资源加载已取消"));
}
