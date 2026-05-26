// RPS Maintenance — Service Worker
// Minimal service worker to enable PWA install prompt.
// No caching — Next.js handles caching on its own.

const CACHE = 'rps-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Pass all fetches through — no offline caching for now
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
