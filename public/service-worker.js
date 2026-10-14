const APP_BUILD_ID = __APP_BUILD_ID__;
const APP_ASSET_FILES = __APP_ASSET_FILES__;
const APP_SHARED_MEDIA_FILES = __APP_SHARED_MEDIA_FILES__;
const APP_CACHE_PREFIX = "anki-note-app-";
const CACHE_NAME = `${APP_CACHE_PREFIX}${APP_BUILD_ID}`;
const SHARED_MEDIA_CACHE_NAME = "anki-note-shared-media-v1";
// Bump this only when the files in public/audio/salamander change.
const PIANO_SAMPLE_CACHE_VERSION = "salamander-v1";
// Existing app caches do not record a sample-bank version, so migrate their samples only while v1 is current.
const LEGACY_PIANO_SAMPLE_MIGRATION_VERSION = "salamander-v1";
const PRELOAD_MAX_ATTEMPTS = 4;
const PRELOAD_RETRY_DELAYS_MS = [300, 900, 1800];
const RUNTIME_ASSET_MAX_ATTEMPTS = 4;
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL("index.html", scopeUrl).toString();
const APP_SHELL = ["", "index.html", "manifest.webmanifest", "icons/icon.svg?v=2"].map((path) =>
  new URL(path, scopeUrl).toString()
);
const APP_SHARED_MEDIA_PATHS = new Set(
  APP_SHARED_MEDIA_FILES.map((file) => new URL(file, scopeUrl).pathname)
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

function isPianoSampleAssetUrl(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopeUrl.pathname)) {
    return false;
  }
  const relativePath = url.pathname.slice(scopeUrl.pathname.length).toLowerCase();
  return relativePath.startsWith("audio/salamander/") && relativePath.endsWith(".mp3");
}

function isSharedMediaRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    (APP_SHARED_MEDIA_PATHS.has(url.pathname) || isPianoSampleAssetUrl(url))
  );
}

function getSharedMediaCacheKey(requestOrUrl) {
  const url = new URL(requestOrUrl instanceof Request ? requestOrUrl.url : requestOrUrl);
  url.searchParams.delete("__app_build");
  url.searchParams.delete("__media_version");
  if (isPianoSampleAssetUrl(url)) {
    url.searchParams.set("__media_version", PIANO_SAMPLE_CACHE_VERSION);
  }
  return new Request(url.toString());
}

function isReusableMediaResponse(response) {
  return response.ok && response.type === "basic" && !isHtmlFallbackResponse(response);
}

async function findPreviouslyCachedMedia(request) {
  const url = new URL(request.url);
  // Vite's emitted media URLs contain a content hash, so an identical pathname is immutable.
  // Legacy sample entries are safe to migrate only until the sample bank version changes.
  const isLegacySampleVersion =
    isPianoSampleAssetUrl(url) &&
    PIANO_SAMPLE_CACHE_VERSION === LEGACY_PIANO_SAMPLE_MIGRATION_VERSION;
  if (!APP_SHARED_MEDIA_PATHS.has(url.pathname) && !isLegacySampleVersion) return undefined;

  try {
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith(APP_CACHE_PREFIX)) continue;
      const previousCache = await caches.open(cacheName);
      const response = await previousCache.match(request, { ignoreSearch: true });
      if (response && isReusableMediaResponse(response)) return response;
    }
  } catch {
    // A legacy cache lookup is only an optimization; fetch the media if it cannot be read.
  }

  return undefined;
}

async function fetchSharedMedia(request) {
  const cacheKey = getSharedMediaCacheKey(request);
  let sharedCache;

  try {
    sharedCache = await caches.open(SHARED_MEDIA_CACHE_NAME);
    const cached = await sharedCache.match(cacheKey);
    if (cached) return cached;

    const previousBuildResponse = await findPreviouslyCachedMedia(request);
    if (previousBuildResponse) {
      await sharedCache.put(cacheKey, previousBuildResponse.clone()).catch(() => undefined);
      return previousBuildResponse;
    }
  } catch {
    // CacheStorage is best-effort; continue with the normal network request.
  }

  // A sample-bank cache-version bump must not repopulate CacheStorage from a stale HTTP cache entry.
  const response = isPianoSampleAssetUrl(new URL(request.url))
    ? await fetch(request, { cache: "reload" })
    : await fetch(request);
  if (isReusableMediaResponse(response)) {
    try {
      sharedCache ??= await caches.open(SHARED_MEDIA_CACHE_NAME);
      await sharedCache.put(cacheKey, response.clone());
    } catch {
      // Keep the network response usable if storage is unavailable or full.
    }
  }
  return response;
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
  const request = new Request(assetUrl);
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

    const htmlFallback =
      response.ok && isRetryableRuntimeAsset(request) && isHtmlFallbackResponse(response);
    if (htmlFallback) {
      const reason = [
        "Unexpected HTML response for runtime asset",
        `Content type: ${response.headers.get("content-type") || "unavailable"}`,
      ].join("; ");
      if (attempts < PRELOAD_MAX_ATTEMPTS) {
        await waitBeforePreloadRetry(attempts);
        continue;
      }
      throw createPreloadError("invalid-runtime-response", assetUrl, attempts, reason);
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
  if (event.data?.type === "get-service-worker-build-id") {
    event.ports[0]?.postMessage({ type: "service-worker-build-id", buildId: APP_BUILD_ID });
    return;
  }

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
  if (
    !response.ok ||
    response.type !== "basic" ||
    !isCacheableAssetUrl(url) ||
    (isRetryableRuntimeAsset(request) && isHtmlFallbackResponse(response))
  ) {
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

function isRetryableRuntimeAsset(request) {
  const url = new URL(request.url);
  const relativePath = url.pathname.slice(scopeUrl.pathname.length).toLowerCase();
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith(scopeUrl.pathname) &&
    relativePath.startsWith("assets/") &&
    /\.(?:js|css)$/.test(relativePath)
  );
}

function isRetryableRuntimeResponse(response) {
  return (
    response.status === 404 ||
    response.status === 408 ||
    response.status === 429 ||
    (response.status >= 500 && response.status < 600)
  );
}

function isHtmlFallbackResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function isRuntimeAssetOffline() {
  return typeof self.navigator?.onLine === "boolean" && !self.navigator.onLine;
}

async function notifyRuntimeAssetClient(clientId, message) {
  if (!clientId) return;
  try {
    const client = await self.clients.get(clientId);
    client?.postMessage(message);
  } catch {
    // Resource recovery should continue even if the page cannot receive progress updates.
  }
}

async function fetchRuntimeAssetWithRetries(request, clientId) {
  const assetUrl = request.url;
  let attempts = 0;

  while (attempts < RUNTIME_ASSET_MAX_ATTEMPTS) {
    attempts += 1;
    let response;

    try {
      response = await fetch(new Request(request, { cache: "reload" }));
    } catch (error) {
      const offline = isRuntimeAssetOffline();
      if (offline || attempts >= RUNTIME_ASSET_MAX_ATTEMPTS) {
        await notifyRuntimeAssetClient(clientId, {
          type: "app-runtime-asset-retry-failed",
          assetUrl,
          attempts,
          maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
          offline,
          reason: describeFailure(error),
        });
        throw error;
      }

      await notifyRuntimeAssetClient(clientId, {
        type: "app-runtime-asset-retrying",
        assetUrl,
        retry: attempts,
        maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
      });
      await waitBeforePreloadRetry(attempts);
      continue;
    }

    if (response.ok && isHtmlFallbackResponse(response)) {
      const reason = [
        "Unexpected HTML response for runtime asset",
        `Content type: ${response.headers.get("content-type") || "unavailable"}`,
      ].join("; ");
      if (attempts >= RUNTIME_ASSET_MAX_ATTEMPTS) {
        await notifyRuntimeAssetClient(clientId, {
          type: "app-runtime-asset-retry-failed",
          assetUrl,
          attempts,
          maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
          reason,
        });
        throw new Error(reason);
      }

      await notifyRuntimeAssetClient(clientId, {
        type: "app-runtime-asset-retrying",
        assetUrl,
        retry: attempts,
        maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
        reason,
      });
      await waitBeforePreloadRetry(attempts);
      continue;
    }

    if (response.ok) {
      if (attempts > 1) {
        await notifyRuntimeAssetClient(clientId, {
          type: "app-runtime-asset-recovered",
          assetUrl,
          attempts,
        });
      }
      return response;
    }

    if (!isRetryableRuntimeResponse(response) || attempts >= RUNTIME_ASSET_MAX_ATTEMPTS) {
      if (attempts > 1 || isRetryableRuntimeResponse(response)) {
        await notifyRuntimeAssetClient(clientId, {
          type: "app-runtime-asset-retry-failed",
          assetUrl,
          attempts,
          maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
          reason: `HTTP ${response.status} ${response.statusText}`,
        });
      }
      return response;
    }

    await notifyRuntimeAssetClient(clientId, {
      type: "app-runtime-asset-retrying",
      assetUrl,
      retry: attempts,
      maxRetries: RUNTIME_ASSET_MAX_ATTEMPTS - 1,
    });
    await waitBeforePreloadRetry(attempts);
  }

  throw new Error(`Runtime asset request exhausted retries: ${new URL(assetUrl).pathname}`);
}

self.addEventListener("fetch", (event) => {
  if (!canHandle(event.request)) {
    return;
  }

  if (isSharedMediaRequest(event.request)) {
    event.respondWith(fetchSharedMedia(event.request));
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
      const response = isRetryableRuntimeAsset(event.request)
        ? await fetchRuntimeAssetWithRetries(event.request, event.clientId)
        : await fetch(event.request, { cache: "reload" });
      return cacheResponse(event.request, response);
    })
  );
});
