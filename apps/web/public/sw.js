/**
 * Service Worker for OSSshelf
 *
 * 功能:
 * - 离线缓存
 * - 预缓存静态资源
 * - 运行时缓存策略
 * - 系统分享面板（Web Share Target）接管
 */

const CACHE_NAME = 'osshelf-v2';
const STATIC_CACHE_NAME = 'osshelf-static-v2';
const DYNAMIC_CACHE_NAME = 'osshelf-dynamic-v2';

const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// 系统分享面板（Web Share Target）：manifest.json 中声明的 action
const SHARE_TARGET_PATH = '/api/share-target';
const SHARE_TARGET_CACHE_NAME = 'osshelf-share-target-v1';
const SHARE_TARGET_ENTRY_PREFIX = '/__share-target/';

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
            return (
              name !== STATIC_CACHE_NAME &&
              name !== DYNAMIC_CACHE_NAME &&
              name !== CACHE_NAME &&
              name !== SHARE_TARGET_CACHE_NAME
            );
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

  // 系统分享面板：manifest.json 声明 POST /api/share-target。
  // 该路径在静态托管上并不存在（直接放行会得到 405），必须由 SW 拦截并暂存文件。
  if (request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(request));
    return;
  }

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

/**
 * 处理系统分享面板提交的文件：
 * 1. 解析 multipart/form-data 中的文件
 * 2. 暂存到 Cache（页面通过 /__share-target/<token>/... 读取）
 * 3. 303 重定向到文件管理页，由页面确认并上传
 */
async function handleShareTarget(request) {
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filesUrl = new URL('/files', self.location.origin).href;

  try {
    const formData = await request.formData();
    const files = formData.getAll('file').filter((item) => item instanceof File && item.size > 0);

    if (files.length === 0) {
      console.warn('[SW] Share target 未收到文件');
      return Response.redirect(`${filesUrl}?shareTargetEmpty=1`, 303);
    }

    const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
    // 分享数据为一次性：清理上一次未被消费的残留
    const staleKeys = await cache.keys();
    await Promise.all(staleKeys.map((key) => cache.delete(key)));

    const manifest = { token, createdAt: Date.now(), files: [] };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      manifest.files.push({ name: file.name, type: file.type, size: file.size });
      await cache.put(
        new URL(`${SHARE_TARGET_ENTRY_PREFIX}${token}/${i}`, self.location.origin).href,
        new Response(file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        })
      );
    }

    await cache.put(
      new URL(`${SHARE_TARGET_ENTRY_PREFIX}${token}/manifest`, self.location.origin).href,
      new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
    );

    return Response.redirect(`${filesUrl}?shareTarget=${token}`, 303);
  } catch (error) {
    console.error('[SW] 处理系统分享失败', error);
    return Response.redirect(`${filesUrl}?shareTargetError=1`, 303);
  }
}

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
