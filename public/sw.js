const CACHE = 'naturalfix-v1.1.3-featurepack';
const CORE = ['./styles.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API and page navigations must always reach the authenticated server.
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') return;

  // Runtime config and the feature pack should refresh from the server first.
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith('/config.js') || url.pathname.endsWith('/features.js'))
  ) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        caches.match(request).then((cached) => cached || new Response('', { status: 503 }))
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
      )
    );
  }
});
