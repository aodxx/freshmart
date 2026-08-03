const CACHE_VERSION = 'freshmart-admin-shell-v1.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './products.html',
  './members.html',
  './orders.html',
  './offline.html',
  './admin.webmanifest',
  './icons/admin-192.png',
  './icons/admin-512.png',
  './icons/admin-maskable-512.png',
  '../css/style.css',
  '../css/admin-members.css',
  '../js/admin-pwa.js',
  '../js/admin-orders.js',
  '../js/admin-products.js',
  '../js/admin-members.js',
  '../js/supabaseClient.js',
  '../js/barcode.js',
  '../js/camera.js',
  '../js/config.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('freshmart-admin-shell-') && key !== CACHE_VERSION)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => response.ok ? response : Promise.reject(new Error('navigation failed')))
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then(cached => cached || caches.match('./offline.html')))
    );
    return;
  }

  if (!APP_SHELL.some(path => new URL(path, self.location.href).pathname === url.pathname)) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request))
  );
});
