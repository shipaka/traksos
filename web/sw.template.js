// TrackSOS website: offline static shell, never offline private or transactional data.
// The build injects a content-derived cache version and an exact allowlist of public assets.
const CACHE_NAME = __CACHE_NAME__;
const STATIC_PATHS = new Set(__STATIC_PATHS__);
const PREFIX = 'tracksos-static-';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...STATIC_PATHS].map((path) =>
        new Request(path, { cache: 'reload', credentials: 'same-origin' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only exact build artifacts or index are intercepted. /api/*, photos, uploads,
  // chat, payments, documents, SMS and other dynamic resources are network-only.
  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      return fetch(request); // Graceful recovery if installation was interrupted
    })
  );
});
