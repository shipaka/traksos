// TrakSOS website: offline static shell, never offline private or transactional data.
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
      // Online users must see the current deployment, not an obsolete cached
      // truck image or old registration. Offline users retain the last copy.
      try {
        const current = await fetch(new Request(request, { cache: 'no-store' }));
        if (current.ok) {
          await cache.put(url.pathname, current.clone());
          return current;
        }
        const saved = await cache.match(url.pathname);
        return saved ?? current;
      } catch {
        return (await cache.match(url.pathname)) ??
          new Response('Нет подключения. Проверьте интернет и повторите.', {
            status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' }
          });
      }
    })
  );
});
