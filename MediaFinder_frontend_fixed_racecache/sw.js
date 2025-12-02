const STATIC_CACHE = 'mfw-static-v21';
const DYNAMIC_CACHE = 'mfw-dynamic-v21';
const OFFLINE_URL = './offline.html';
const MAX_DYNAMIC_ENTRIES = 40;
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  './fuse_worker.js',
  './heatmap_worker.js',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const STATIC_PATHS = new Set(
  STATIC_ASSETS.map((asset) => new URL(asset, self.location).pathname)
);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, DYNAMIC_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (STATIC_PATHS.has(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }

    const staticDest = ['style', 'script', 'worker', 'font', 'manifest'];
    if (staticDest.includes(request.destination)) {
      event.respondWith(cacheFirst(request));
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
    await trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ENTRIES);
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const fallback = await caches.match(OFFLINE_URL);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  const over = keys.length - limit;
  for (let i = 0; i < over; i++) {
    await cache.delete(keys[i]);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
    await trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ENTRIES);
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      const fallback = await caches.match(OFFLINE_URL);
      if (fallback) return fallback;
    }
    throw err;
  }
}

self.addEventListener('push', (event) => {
  const payload = (() => {
    if (!event.data) {
      return { title: 'Dataset backend diperbarui', body: 'Buka tab Korpus untuk memuat item terbaru.', url: './#tab-corpus' };
    }
    try {
      return event.data.json();
    } catch (err) {
      return { title: 'Update Backend', body: event.data.text(), url: './#tab-corpus' };
    }
  })();
  const notifyPromise = (async () => {
    await self.registration.showNotification(payload.title || 'Update Backend', {
      body: payload.body || 'Dataset baru tersedia.',
      icon: payload.icon || 'icons/icon-192.png',
      badge: payload.badge || 'icons/icon-192.png',
      data: { url: payload.url || './', payload }
    });
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clientsList.forEach((client) => {
      client.postMessage({ type: 'backend-update', payload });
    });
  })();
  event.waitUntil(notifyPromise);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
