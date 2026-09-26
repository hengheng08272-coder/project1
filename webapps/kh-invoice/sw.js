// KH Invoice — minimal service worker.
// Goal: make the app installable (PWA) and keep it usable when the network
// drops mid-session, without trying to precache hashed build filenames
// (those change every deploy, so we cache at runtime instead).

const CACHE_NAME = 'kh-invoice-v1';
// Relative to this file, so the app works both at / and under a sub-path.
const APP_SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept API calls (Supabase) — always go to network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      // Stale-while-revalidate: serve cache immediately if we have it,
      // update in the background; fall back to network if nothing cached.
      return cached || network;
    })
  );
});
