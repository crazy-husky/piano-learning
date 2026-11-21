import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../../public/service-worker.js", import.meta.url),
  "utf8"
)
  .replace("__APP_BUILD_ID__", JSON.stringify("build-new"))
  .replace("__APP_ASSET_FILES__", "[]")
  .replace("__APP_SHARED_MEDIA_FILES__", "[]");

interface MockWindowClient {
  id: string;
  url: string;
  navigate: ReturnType<typeof vi.fn>;
}

function createServiceWorkerHarness(clients: MockWindowClient[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const entries = new Map<string, Response>();
  const cache = {
    delete: vi.fn(async (key: string | Request) =>
      entries.delete(key instanceof Request ? key.url : key)
    ),
    match: vi.fn(async (key: string | Request) =>
      entries.get(key instanceof Request ? key.url : key)
    ),
    put: vi.fn(async (key: string | Request, response: Response) => {
      entries.set(key instanceof Request ? key.url : key, response);
    }),
  };
  const clientsApi = {
    claim: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => clients),
  };
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    }),
    clients: clientsApi,
    location: new URL("https://example.test/piano-learning/service-worker.js"),
    navigator: { onLine: true },
    registration: { scope: "https://example.test/piano-learning/" },
    skipWaiting: vi.fn(async () => undefined),
  };

  runInNewContext(serviceWorkerSource, {
    Request,
    Response,
    URL,
    caches: { open: vi.fn(async () => cache), keys: vi.fn(async () => []) },
    fetch: vi.fn(),
    self,
  });

  return { cache, clientsApi, entries, listeners, self };
}

function makeClient(id: string, url: string): MockWindowClient {
  return { id, url, navigate: vi.fn(async () => undefined) };
}

describe("service worker update activation", () => {
  it("does not activate for messages other than an explicit update approval", async () => {
    const harness = createServiceWorkerHarness();
    const waitUntil = vi.fn();

    harness.listeners.get("message")?.({ data: { type: "unrelated" }, waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(harness.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("reloads every same-scope page except the tab that approved the update", async () => {
    const approver = makeClient(
      "approver",
      "https://example.test/piano-learning/#/level/8?tab=practice"
    );
    const otherAppPage = makeClient(
      "other-app-page",
      "https://example.test/piano-learning/#/level/3?tab=practice"
    );
    const outsideScope = makeClient("outside-scope", "https://example.test/other/");
    const otherOrigin = makeClient("other-origin", "https://other.test/piano-learning/");
    const harness = createServiceWorkerHarness([approver, otherAppPage, outsideScope, otherOrigin]);
    const messageTasks: Promise<unknown>[] = [];
    harness.listeners.get("message")?.({
      data: "skip-waiting",
      source: { id: approver.id },
      waitUntil: (task: Promise<unknown>) => messageTasks.push(task),
    });
    await Promise.all(messageTasks);

    expect(harness.self.skipWaiting).toHaveBeenCalledOnce();
    expect(
      [...harness.entries.entries()].some(([key]) => key.endsWith("/__app-update-approval__"))
    ).toBe(true);

    const activationTasks: Promise<unknown>[] = [];
    harness.listeners.get("activate")?.({
      waitUntil: (task: Promise<unknown>) => activationTasks.push(task),
    });
    await Promise.all(activationTasks);

    expect(harness.clientsApi.claim).toHaveBeenCalledOnce();
    expect(approver.navigate).not.toHaveBeenCalled();
    expect(otherAppPage.navigate).toHaveBeenCalledWith(otherAppPage.url);
    expect(outsideScope.navigate).not.toHaveBeenCalled();
    expect(otherOrigin.navigate).not.toHaveBeenCalled();
    expect(harness.entries.size).toBe(0);
  });

  it("claims pages on first install without reloading them", async () => {
    const page = makeClient("first-install-page", "https://example.test/piano-learning/");
    const harness = createServiceWorkerHarness([page]);
    const activationTasks: Promise<unknown>[] = [];

    harness.listeners.get("activate")?.({
      waitUntil: (task: Promise<unknown>) => activationTasks.push(task),
    });
    await Promise.all(activationTasks);

    expect(harness.clientsApi.claim).toHaveBeenCalledOnce();
    expect(page.navigate).not.toHaveBeenCalled();
  });
});
