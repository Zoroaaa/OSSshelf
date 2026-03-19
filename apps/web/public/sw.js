/**
 * Service Worker for OSSshelf
 *
 * 功能:
 * - 离线缓存
 * - 预缓存静态资源
 * - 运行时缓存策略
 * - 后台同步
 */

const CACHE_NAME = 'osshelf-v2';
const STATIC_CACHE_NAME = 'osshelf-static-v2';
const DYNAMIC_CACHE_NAME = 'osshelf-dynamic-v2';

const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

const CACHE_STRATEGIES = {
  networkFirst: ['/api/'],
  cacheFirst: ['/api/files/preview/', '/api/files/thumbnail/'],
  staleWhileRevalidate: ['/api/buckets', '/api/user'],
};

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name !== STATIC_CACHE_NAME && name !== DYNAMIC_CACHE_NAME && name !== CACHE_NAME;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );

  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  // 非同源请求（预签名 S3/R2 URL 等）不拦截，让浏览器直接处理
  if (url.origin !== location.origin) {
    return;
  }

  // 下载、预签名相关路径不走缓存
  if (url.pathname.startsWith('/api/files/download/') || url.pathname.includes('/presign')) {
    return;
  }

  // API 请求：network first
  if (CACHE_STRATEGIES.networkFirst.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 预览/缩略图：cache first
  if (CACHE_STRATEGIES.cacheFirst.some((path) => url.pathname.includes(path))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // stale-while-revalidate
  if (CACHE_STRATEGIES.staleWhileRevalidate.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 页面导航（SPA 路由如 /files/xxx）统一走 networkFirst，失败时回退到缓存的 index.html
  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源：stale-while-revalidate
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 其他请求（fetch/XHR 发出的 API 调用等）不拦截，避免意外捕获导致网络错误
});

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    if (request.destination === 'document') {
      return caches.match('/');
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        const responseToCache = networkResponse.clone();
        caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
      }
      return networkResponse;
    })
    .catch(() => {
      return cachedResponse || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    });

  return cachedResponse || fetchPromise;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((name) => caches.delete(name)));
      })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'upload-pending') {
    event.waitUntil(processPendingUploads());
  }
});

async function processPendingUploads() {
  console.log('[SW] Processing pending uploads...');
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body || '您有新的通知',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
    actions: data.actions || [],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'OSSshelf', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
