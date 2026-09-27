const CACHE_VERSION = 'beezmovies-static-v4';
const PRECACHE_URLS = [
  '/branding/beezmovies-logo.jpg',
  '/branding/beezmovies-bee.png',
  '/branding/icon-192.png',
  '/branding/icon-512.png',
  '/branding/icon-maskable-512.png',
  '/branding/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_VERSION)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.get('authorization')) return;
  if (request.headers.get('rsc') || request.headers.get('next-router-prefetch')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.destination === 'video' || request.destination === 'track') return;
  if (url.pathname === '/sw.js') return;

  const isPrivatePage = url.pathname === '/account'
    || url.pathname.startsWith('/account/')
    || url.pathname === '/my-list'
    || url.pathname === '/login'
    || url.pathname === '/register'
    || url.pathname === '/forgot-password'
    || url.pathname === '/reset-password'
    || url.pathname === '/admin'
    || url.pathname.startsWith('/admin/');
  if (isPrivatePage) return;

  const isStaticAsset = url.pathname.startsWith('/_next/static/')
    || url.pathname.startsWith('/branding/')
    || request.destination === 'font'
    || request.destination === 'style'
    || request.destination === 'script'
    || request.destination === 'image';

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    const cacheNavigation = !url.search && !url.pathname.startsWith('/search');
    event.respondWith(cacheNavigation ? networkFirst(request) : networkOrOffline(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

async function offlineResponse() {
  const cached = await caches.match('/offline.html');
  if (cached) return cached;
  return new Response('BeezMovies is offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
