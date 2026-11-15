// Offline cache for the heavy art (scenes, videos, bodies) so returning
// clients load instantly. Never caches the API or uploaded photos.
const CACHE = 'ink-consult-v2'; // bump whenever art changes under the same file name

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/artist')) return;
  // Videos use byte ranges; let the browser handle them directly.
  if (e.request.headers.has('range')) return;
  const art = /^\/(media|models|audio|assets|icons)\//.test(url.pathname);
  if (art) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok && res.status === 200) cache.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  // Pages: network first so updates arrive, cache as the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match('/'))),
  );
});
