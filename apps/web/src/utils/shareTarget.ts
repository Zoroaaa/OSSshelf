/**
 * shareTarget.ts
 * 系统分享（Web Share Target）暂存数据的读取与清理
 *
 * 背景：manifest.json 声明的分享入口为 POST /api/share-target，
 * 静态托管无法处理该请求，由 Service Worker 拦截后把文件存入 Cache，
 * 再重定向到 /files?shareTarget=<token>。本模块供页面读取/清理这份数据。
 */

export const SHARE_TARGET_CACHE_NAME = 'osshelf-share-target-v1';

const SHARE_TARGET_ENTRY_PREFIX = '/__share-target/';

export interface SharedFile {
  name: string;
  type: string;
  size: number;
  file: File;
}

interface ShareTargetManifest {
  token: string;
  createdAt: number;
  files: Array<{ name: string; type: string; size: number }>;
}

function entryUrl(token: string, name: string): string {
  return new URL(`${SHARE_TARGET_ENTRY_PREFIX}${token}/${name}`, window.location.origin).href;
}

/** 读取 Service Worker 暂存的分享文件；无效 token 返回空数组 */
export async function readSharedFiles(token: string): Promise<SharedFile[]> {
  if (typeof caches === 'undefined') return [];

  const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
  const manifestRes = await cache.match(entryUrl(token, 'manifest'));
  if (!manifestRes) return [];

  const manifest = (await manifestRes.json()) as ShareTargetManifest;
  const result: SharedFile[] = [];

  for (let i = 0; i < manifest.files.length; i++) {
    const meta = manifest.files[i];
    if (!meta) continue;
    const res = await cache.match(entryUrl(token, String(i)));
    if (!res) continue;

    const blob = await res.blob();
    const type = meta.type || blob.type;
    result.push({
      name: meta.name,
      type,
      size: meta.size || blob.size,
      file: new File([blob], meta.name, { type }),
    });
  }

  return result;
}

/** 清理指定 token 的暂存数据 */
export async function clearSharedFiles(token: string): Promise<void> {
  if (typeof caches === 'undefined') return;

  const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
  const keys = await cache.keys();
  const prefix = new URL(`${SHARE_TARGET_ENTRY_PREFIX}${token}/`, window.location.origin).href;
  await Promise.all(keys.filter((key) => key.url.startsWith(prefix)).map((key) => cache.delete(key)));
}
