/**
 * 登出时清空浏览器侧所有 Cache Storage，并通知 Service Worker 同步清理。
 * 目的：同一设备切换账号后，不会读到上一账号遗留的缓存响应。
 * 失败只记录告警，不阻塞登出流程。
 */
export async function clearClientCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_ALL_CACHES' });
    }
  } catch (error) {
    console.warn('[cache] clear on logout failed', error);
  }
}
