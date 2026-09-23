const CACHE = 'naturalfix-v1.1.2-auth';
const CORE = ['./styles.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const SHELL_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;

  if (url.origin === self.location.origin && url.pathname.endsWith('/config.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response(
      "window.NATURALFIX_CONFIG = Object.freeze({ API_BASE_URL: '' });",
      { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }
    )));
    return;
  }

  if (request.mode === 'navigate') return;
    
      
      
        
            
            
          
          
        
        
    
  
  

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok && !url.pathname.endsWith('/config.js')) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
