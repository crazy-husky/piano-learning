const APP_BUILD_ID = __APP_BUILD_ID__;
const APP_ASSET_FILES = __APP_ASSET_FILES__;
const APP_CACHE_PREFIX = "anki-note-app-";
const CACHE_NAME = `${APP_CACHE_PREFIX}${APP_BUILD_ID}`;
const PRELOAD_MAX_ATTEMPTS = 4;
const PRELOAD_RETRY_DELAYS_MS = [300, 900, 1800];
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL("index.html", scopeUrl).toString();
const APP_SHELL = ["", "index.html", "manifest.webmanifest", "icons/icon.svg?v=2"].map((path) =>
  new URL(path, scopeUrl).toString()
);

function isCacheableAssetUrl(url) {
  return (
    url.origin === self.location.origin &&
    !url.pathname.includes("/models/vocal-pitch/") &&
    !url.pathname.endsWith("/version.json") &&
    !url.pathname.endsWith("/service-worker.js")
  );
}

function getBuildCacheKey(requestOrUrl) {
  const url = new URL(requestOrUrl instanceof Request ? requestOrUrl.url : requestOrUrl);
  url.searchParams.set("__app_build", APP_BUILD_ID);
  return new Request(url.toString());
}

function describeFailure(value) {
  if (value && typeof value === "object") {
    const name = typeof value.name === "string" ? value.name : "Error";
    const message = typeof value.message === "string" ? value.message : String(value);
    return `${name}: ${message}`;
  }
  return String(value);
}

function createPreloadError(stage, assetUrl, attempt, reason) {
  const assetPath = new URL(assetUrl).pathname;
  return new Error(
    [
      "Stage: service-worker-precache",
      `Build ID: ${APP_BUILD_ID}`,
      `Asset: ${assetPath}`,
      `Failure stage: ${stage}`,
      `Attempts: ${attempt}/${PRELOAD_MAX_ATTEMPTS}`,
      `Reason: ${describeFailure(reason)}`,
    ].join("\n")
  );
}

function waitBeforePreloadRetry(attempt) {
  const delayMs = PRELOAD_RETRY_DELAYS_MS[attempt - 1] || 0;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function preloadAsset(cache, assetUrl) {
  const cacheKey = getBuildCacheKey(assetUrl);
  let response;
  let attempts = 0;

  while (attempts < PRELOAD_MAX_ATTEMPTS) {
    attempts += 1;
    try {
      response = await fetch(cacheKey, { cache: "reload" });
    } catch (error) {
      if (attempts >= PRELOAD_MAX_ATTEMPTS) {
        throw createPreloadError("network-fetch", assetUrl, attempts, error);
      }
      await waitBeforePreloadRetry(attempts);
      continue;
    }

    if (!response.ok || response.type !== "basic") {
      const reason = `HTTP ${response.status} ${response.statusText}; response type ${response.type}`;
      if (response.status >= 500 && response.status < 600 && attempts < PRELOAD_MAX_ATTEMPTS) {
        await waitBeforePreloadRetry(attempts);
        continue;
      }
      throw createPreloadError("network-response", assetUrl, attempts, reason);
    }
    break;
  }

  try {
    await cache.put(cacheKey, response);
  } catch (error) {
    // Storage quota and cache-write failures are not transient network failures; report them directly.
    throw createPreloadError("cache-write", assetUrl, attempts, error);
  }
}

async function reportPrecacheFailure(error) {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const details = error instanceof Error ? error.message : describeFailure(error);
    for (const client of clients) {
      client.postMessage({ type: "app-update-diagnostic", details });
    }
  } catch {
    // Install still fails; reporting is best-effort if no client can be reached.
  }
}

function wrapInstallFailure(stage, error) {
  return new Error(
    [
      "Stage: service-worker-precache",
      `Build ID: ${APP_BUILD_ID}`,
      `Failure stage: ${stage}`,
      `Reason: ${describeFailure(error)}`,
    ].join("\n")
  );
}

self.addEventListener("install", (event) => {
  const assets = [
    ...new Set([
      ...APP_SHELL,
      ...APP_ASSET_FILES.map((file) => new URL(file, scopeUrl).toString()),
    ]),
  ].filter((assetUrl) => isCacheableAssetUrl(new URL(assetUrl)));

  event.waitUntil(
    (async () => {
      let stage = "cache-open";
      try {
        const cache = await caches.open(CACHE_NAME);
        stage = "asset-preload";
        const results = await Promise.all(
          assets.map((assetUrl) =>
            preloadAsset(cache, assetUrl).then(
              () => ({ error: null }),
              (error) => ({ error })
            )
          )
        );
        const failedResult = results.find((result) => result.error);
        if (failedResult?.error) throw failedResult.error;
      } catch (error) {
        const diagnostic = stage === "cache-open" ? wrapInstallFailure("cache-open", error) : error;
        await reportPrecacheFailure(diagnostic);
        throw diagnostic;
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") {
    event.waitUntil(self.skipWaiting());
  }
});

function canHandle(request) {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    (url.protocol === "http:" || url.protocol === "https:")
  );
}

async function cacheResponse(request, response) {
  const url = new URL(request.url);
  if (!response.ok || response.type !== "basic" || !isCacheableAssetUrl(url)) {
    return response;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(getBuildCacheKey(request), response.clone());
  } catch {
    // Cache writes are best-effort; the network response remains usable.
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (!canHandle(event.request)) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => cacheResponse(event.request, response))
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return cache.match(getBuildCacheKey(indexUrl));
        })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(getBuildCacheKey(event.request));
      if (cached) {
        return cached;
      }
      return fetch(event.request, { cache: "reload" }).then((response) =>
        cacheResponse(event.request, response)
      );
    })
  );
});
