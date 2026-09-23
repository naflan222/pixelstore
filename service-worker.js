'use strict';

const STATIC_CACHE = 'pixelhouse-static-v3';
const APP_SHELL = [
  '/',
  '/home.html',
  '/products.html',
  '/offline.html',
  '/style.css',
  '/js/api-client.js?v=20260923.1',
  '/js/active.js',
  '/img/icons/icon-192x192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  // Account, cart and checkout pages can contain private or rapidly changing
  // information, so they always use the network and are never cached.
  if (/\/(?:cart|checkout|profile|my-order|notifications|login|register|otp|forget-password)/.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // CSS and JavaScript are network-first so a deployment cannot leave users
  // on an outdated interface. The cache remains an offline fallback.
  if (['style', 'script'].includes(request.destination)) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Images and fonts use stale-while-revalidate for fast repeat visits.
  if (['image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
