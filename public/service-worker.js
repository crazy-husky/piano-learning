const APP_BUILD_ID = __APP_BUILD_ID__;
const APP_ASSET_FILES = __APP_ASSET_FILES__;
const APP_CACHE_PREFIX = "anki-note-app-";
const CACHE_NAME = `${APP_CACHE_PREFIX}${APP_BUILD_ID}`;
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL("index.html", scopeUrl).toString();
const APP_SHELL = ["", "index.html", "manifest.webmanifest", "icons/icon.svg?v=2"].map((path) =>
  new URL(path, scopeUrl).toString(),
);

function isCacheableAssetUrl(url) {
  return url.origin === self.location.origin
    && !url.pathname.includes("/models/vocal-pitch/")
    && !url.pathname.endsWith("/version.json")
    && !url.pathname.endsWith("/service-worker.js");
}

function getBuildCacheKey(requestOrUrl) {
  const url = new URL(requestOrUrl instanceof Request ? requestOrUrl.url : requestOrUrl);
  url.searchParams.set("__app_build", APP_BUILD_ID);
  return new Request(url.toString());
}

async function preloadAsset(cache, assetUrl) {
  const cacheKey = getBuildCacheKey(assetUrl);
  const response = await fetch(cacheKey, { cache: "reload" });
  if (!response.ok || response.type !== "basic") {
    throw new Error(`Unable to preload app code asset: ${new URL(assetUrl).pathname}`);
  }
  await cache.put(cacheKey, response);
}

self.addEventListener("install", (event) => {
  const assets = [...new Set([...APP_SHELL, ...APP_ASSET_FILES.map((file) => new URL(file, scopeUrl).toString())])]
    .filter((assetUrl) => isCacheableAssetUrl(new URL(assetUrl)));

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(assets.map((assetUrl) => preloadAsset(cache, assetUrl)));
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") {
    event.waitUntil(self.skipWaiting());
  }
});

function canHandle(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === self.location.origin && (url.protocol === "http:" || url.protocol === "https:");
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
        }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(getBuildCacheKey(event.request));
      if (cached) {
        return cached;
      }
      return fetch(event.request, { cache: "reload" }).then((response) => cacheResponse(event.request, response));
    }),
  );
});
