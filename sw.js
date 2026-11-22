const CACHE_NAME = 'kscalc-v024';
const ASSETS = ['./', './index.html', './arithmetic.js?v=024', './ks-mode.js?v=024', './ks-mode.css?v=024', './manifest.webmanifest', './icon.png', './icon-512.png'];
const assetUrls = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all(['kscalc-v010', 'kscalc-v011', 'kscalc-v012', 'kscalc-v013', 'kscalc-v014', 'kscalc-v015', 'kscalc-v016', 'kscalc-v017', 'kscalc-v018', 'kscalc-v019', 'kscalc-v020', 'kscalc-v021', 'kscalc-v022', 'kscalc-v023'].map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !assetUrls.has(request.url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
        return (await cache.match(request)) || response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }
    return (await cache.match(request)) || fetch(request);
  })());
});
