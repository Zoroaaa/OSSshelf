/**
 * webdav.ts
 * WebDAV协议路由
 *
 * 功能:
 * - WebDAV协议完整实现
 * - 支持Windows/macOS/Linux挂载
 * - 文件读写与目录管理
 * - 锁定与解锁（LOCK/UNLOCK，兼容 Windows 资源管理器与 WinSCP）
 *
 * 路径存储格式说明：
 * - WebDAV 上传：客户端写入时对路径/文件名做 URL 编码，name 和 path 字段存储编码格式
 *   （如 name="%E5%9C%A3%E5%A2%9F.json"，path="/legado/%E5%9C%A3%E5%A2%9F.json"）
 * - 非 WebDAV 上传（Web界面等）：name 和 path 字段存储原始中文
 *   （如 name="个人项目"，path="/个人项目"）
 * findFileByPath 策略1直接匹配 path 字段（命中 WebDAV 上传的记录），
 * 策略2按 name+parentId 层级递归，同时尝试原始值和 decode 值（兼容两种格式）。
 *
 * Windows 资源管理器兼容性说明：
 * - 所有 401 响应必须携带 DAV 头，否则 Mini-Redirector 不认为这是 WebDAV 服务器，
 *   直接报"输入的文件夹似乎无效"且不弹出密码框。
 * - PROPFIND 响应的根节点 <href> 必须与请求路径精确匹配（不能多/少尾部斜杠）。
 * - 必须实现 LOCK/UNLOCK，否则写操作前 Windows 发出的 LOCK 请求得到 405 后卡死。
 */

import { Hono, Context } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users } from '../db';
import type { File } from '../db/schema';
import { s3Put, s3Get, s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota, updateUserStorage } from '../lib/bucketResolver';
import { verifyPassword, getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { ERROR_CODES, logger } from '@osshelf/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// DAV 路由前缀，与 index.ts 中 app.route('/dav', ...) 保持一致
const DAV_PREFIX = '/dav';

// 所有响应（包括 401）都需要携带的 DAV 基础头
// Windows Mini-Redirector 会在 401 响应上二次确认 DAV 头，缺失则报"文件夹无效"
const DAV_BASE_HEADERS = {
  DAV: '1, 2',
  'MS-Author-Via': 'DAV',
};

app.options('/*', (_c) => {
  return new Response(null, {
    status: 200,
    headers: {
      ...DAV_BASE_HEADERS,
      Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, MOVE, COPY, LOCK, UNLOCK',
      'Content-Length': '0',
    },
  });
});

app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // 修复：401 必须携带 DAV 头，Windows Mini-Redirector 依此判断服务器是否支持 WebDAV
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        ...DAV_BASE_HEADERS,
        'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"',
      },
    });
  }

  try {
    const credentials = atob(authHeader.slice(6));
    const colonIndex = credentials.indexOf(':');
    if (colonIndex === -1) throw new Error('Invalid credentials');

    const email = credentials.slice(0, colonIndex);
    const password = credentials.slice(colonIndex + 1);

    const db = getDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.email, email)).get();

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          ...DAV_BASE_HEADERS,
          'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"',
        },
      });
    }

    c.set('userId', user.id);
    await next();
  } catch {
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        ...DAV_BASE_HEADERS,
        'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"',
      },
    });
  }
});

// ── Route all WebDAV methods ───────────────────────────────────────────────
app.all('/*', async (c) => {
  const method = c.req.method.toUpperCase();
  const userId = c.get('userId')!;
  // Strip /dav prefix to get the logical path
  const rawPath = new URL(c.req.url).pathname;
  const path = rawPath.replace(/^\/dav/, '') || '/';

  switch (method) {
    case 'PROPFIND':
      return handlePropfind(c, userId, path, rawPath);
    case 'GET':
    case 'HEAD':
      return handleGet(c, userId, path, method === 'HEAD');
    case 'PUT':
      return handlePut(c, userId, path);
    case 'MKCOL':
      return handleMkcol(c, userId, path);
    case 'DELETE':
      return handleDelete(c, userId, path);
    case 'MOVE':
      return handleMove(c, userId, path);
    case 'COPY':
      return handleCopy(c, userId, path);
    case 'LOCK':
      return handleLock(c, rawPath);
    case 'UNLOCK':
      // UNLOCK：无状态实现，直接返回成功
      return new Response(null, { status: 204, headers: DAV_BASE_HEADERS });
    case 'PROPPATCH':
      return handleProppatch(c, rawPath);
    default:
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          ...DAV_BASE_HEADERS,
          Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, MOVE, COPY, LOCK, UNLOCK',
        },
      });
  }
});

// ── Helpers ───────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type FileRow = typeof files.$inferSelect;
type FolderCache = Map<string, { name: string; parentId: string | null }>;

/**
 * 构建请求级文件夹缓存（id → {name, parentId}）。
 * 每次请求独立构建，避免模块级共享 Map 在 Cloudflare Workers 并发请求间互相污染
 * （原实现用全局 Map + clearPathCache，并发时会出现缓存被其他请求清空导致路径截断的问题）。
 */
async function buildFolderCache(db: ReturnType<typeof getDb>, userId: string): Promise<FolderCache> {
  const cache: FolderCache = new Map();
  const allFolders = await db
    .select({ id: files.id, name: files.name, parentId: files.parentId })
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .all();

  for (const folder of allFolders) {
    cache.set(folder.id, { name: folder.name, parentId: folder.parentId });
  }
  return cache;
}

// WebDAV 上传的 name 字段存储 URL 编码格式，displayname 输出时 decode 为可读中文
function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// findFileByPath 策略2中对路径分段安全 decode，用于匹配非 WebDAV 上传的原始中文 name
function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// 将路径各段统一 encode：先 decode（兼容已编码的 WebDAV name），再 encode，
// 确保最终 href 格式统一为 URL 编码，与客户端请求路径格式一致。
function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(safeDecodeURIComponent(seg)) : seg))
    .join('/');
}

function buildLogicalPathFromCache(cache: FolderCache, parentId: string | null, fileName: string): string {
  // 使用数据库原始 name 拼接路径（不 decode），保持与数据库 path 字段一致的格式，
  // 确保 href 与客户端下次请求的路径匹配（策略1可直接命中）。
  // displayname 的 decode 在 buildPropfindXML 中单独处理。
  if (!parentId) {
    return `/${fileName}`;
  }

  const pathParts: string[] = [fileName];
  let currentId: string | null = parentId;

  while (currentId) {
    const folder = cache.get(currentId);
    if (!folder) break;
    pathParts.unshift(folder.name);
    currentId = folder.parentId;
  }

  return '/' + pathParts.join('/');
}

function buildItemsWithLogicalPaths(cache: FolderCache, items: FileRow[]): FileRow[] {
  return items.map((file) => {
    const logicalPath = buildLogicalPathFromCache(cache, file.parentId, file.name);
    return {
      ...file,
      path: file.isFolder ? logicalPath + '/' : logicalPath,
    };
  });
}

/**
 * 构建 PROPFIND 响应 XML。
 *
 * @param items   当前目录下的文件/文件夹列表（path 字段已由 buildItemsWithLogicalPaths 重建为逻辑路径）
 * @param rawPath 原始请求路径（含 /dav 前缀），用于根集合条目的 <href> 精确匹配
 * @param isRoot  是否渲染根集合条目（自身 response 节点）
 *
 * 注意：
 * - 根节点 <href> 使用 rawPath 而非构造值，确保与客户端请求路径精确匹配（Windows 严格校验）
 * - 子项 <href> = DAV_PREFIX + 逻辑路径（由 buildLogicalPathFromCache 从 parentId 链递归构建）
 * - displayname 对 WebDAV 上传的编码文件名做 decode，统一展示为可读格式
 */
function buildPropfindXML(items: FileRow[], rawPath: string, isRoot: boolean = false): string {
  const responses: string[] = [];

  if (isRoot) {
    const rootHref = rawPath;
    responses.push(`
  <response>
    <href>${escapeXml(rootHref)}</href>
    <propstat>
      <prop>
        <displayname></displayname>
        <resourcetype><collection/></resourcetype>
        <getlastmodified>${new Date().toUTCString()}</getlastmodified>
        <creationdate>${new Date().toISOString()}</creationdate>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`);
  }

  items.forEach((file) => {
    let logicalPath = file.path;
    if (!logicalPath.startsWith('/')) logicalPath = '/' + logicalPath;
    if (file.isFolder && !logicalPath.endsWith('/')) logicalPath += '/';

    // 对路径各段统一 encode，与 rawPath（自身节点 href）格式保持一致，
    // 避免客户端因编码不一致把自身节点和子项当成两个不同路径
    const href = DAV_PREFIX + encodePathSegments(logicalPath);

    responses.push(`
  <response>
    <href>${escapeXml(href)}</href>
    <propstat>
      <prop>
        <displayname>${escapeXml(decodeName(file.name))}</displayname>
        <getcontentlength>${file.size}</getcontentlength>
        <getlastmodified>${new Date(file.updatedAt).toUTCString()}</getlastmodified>
        <creationdate>${file.createdAt}</creationdate>
        <resourcetype>${file.isFolder ? '<collection/>' : ''}</resourcetype>
        <getcontenttype>${file.mimeType || 'application/octet-stream'}</getcontenttype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`);
  });

  return `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">${responses.join('')}\n</multistatus>`;
}

async function handlePropfind(c: AppContext, userId: string, path: string, rawPath: string) {
  const depth = c.req.header('Depth') || '1';
  const db = getDb(c.env.DB);
  const isRoot = path === '/' || path === '';

  // 构建请求级局部缓存，每次请求独立，避免并发请求间共享状态互相污染
  const cache = await buildFolderCache(db, userId);

  const xmlHeaders = {
    'Content-Type': 'application/xml; charset=utf-8',
    ...DAV_BASE_HEADERS,
  };

  let parentCondition;
  let resolvedParent: File | undefined;

  if (isRoot) {
    parentCondition = isNull(files.parentId);
  } else {
    resolvedParent = await findFileByPath(db, userId, path);
    if (resolvedParent) {
      parentCondition = eq(files.parentId, resolvedParent.id);
    } else {
      // 路径不存在：返回 404，让 WebDAV 客户端知道目录不存在
      return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });
    }
  }

  const rawItems = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), parentCondition, isNull(files.deletedAt)))
    .all();

  const items = buildItemsWithLogicalPaths(cache, rawItems);

  if (depth === '0') {
    if (isRoot) {
      return new Response(buildPropfindXML([], rawPath, true), {
        status: 207,
        headers: xmlHeaders,
      });
    } else {
      if (resolvedParent) {
        const currentWithLogicalPath = buildItemsWithLogicalPaths(cache, [resolvedParent]);
        items.unshift(...currentWithLogicalPath);
      }
      return new Response(buildPropfindXML(items, rawPath, false), {
        status: 207,
        headers: xmlHeaders,
      });
    }
  }

  return new Response(buildPropfindXML(items, rawPath, true), {
    status: 207,
    headers: xmlHeaders,
  });
}

/**
 * 按逻辑路径查找文件或文件夹，兼容两种上传方式的存储格式：
 *
 * 策略1（直接匹配 path 字段）：
 *   适配 WebDAV 上传——客户端写入时对路径做 URL 编码，数据库 path 存储编码格式，
 *   WebDAV 请求的 pathname 同样保留编码（new URL().pathname 不自动解码），可直接命中。
 *
 * 策略2（按 name+parentId 层级递归）：
 *   适配非 WebDAV 上传——数据库 name/path 存储原始中文，但 WebDAV 客户端请求路径
 *   中的中文会被编码为 %XX 格式，需对每段 decode 后才能匹配；同时保留原始值以兼容
 *   WebDAV 上传的编码名（策略1未命中时的兜底）。
 */
async function findFileByPath(db: ReturnType<typeof getDb>, userId: string, path: string): Promise<File | undefined> {
  // 策略1：直接精确匹配 path 字段（命中 WebDAV 上传的编码路径）
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;

  let file = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.path, normalized), isNull(files.deletedAt)))
    .get();

  if (!file) {
    file = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.path, normalized + '/'), isNull(files.deletedAt)))
      .get();
  }

  if (file) return file;

  // 策略2：按名称层级递归定位（适配非 WebDAV 上传，name/path 存储的是原始中文）
  // WebDAV 请求路径中中文被编码为 %XX，需要 decode 后才能匹配数据库中的中文名称
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return undefined;

  let currentParentId: string | null = null;
  let currentFile: File | undefined;

  for (const part of parts) {
    // 同时尝试原始值（匹配 WebDAV 上传的编码名）和 decoded 值（匹配非 WebDAV 上传的中文名）
    const decodedPart = safeDecodeURIComponent(part);
    const nameCandidates = Array.from(new Set([part, decodedPart]));

    let found: File | undefined;
    for (const namePart of nameCandidates) {
      found = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, userId),
            eq(files.name, namePart),
            currentParentId ? eq(files.parentId, currentParentId) : isNull(files.parentId),
            isNull(files.deletedAt)
          )
        )
        .get();
      if (found) break;
    }

    if (!found) return undefined;
    currentFile = found;
    currentParentId = currentFile.id;
  }

  return currentFile;
}

async function handleGet(c: AppContext, userId: string, path: string, headOnly: boolean) {
  const db = getDb(c.env.DB);

  if (path === '/' || path === '') {
    return new Response(headOnly ? null : 'Root Collection', {
      status: 200,
      headers: {
        ...DAV_BASE_HEADERS,
        'Content-Type': 'text/html',
        'Content-Length': '14',
      },
    });
  }

  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });
  if (file.isFolder) return new Response('Is a collection', { status: 400, headers: DAV_BASE_HEADERS });

  const encKeyG = getEncryptionKey(c.env);
  const bucketCfgG = await resolveBucketConfig(db, userId, encKeyG, file.bucketId, file.parentId);
  const hdrs = {
    ...DAV_BASE_HEADERS,
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
  };
  if (bucketCfgG) {
    if (headOnly) return new Response(null, { headers: hdrs });
    const s3Res = await s3Get(bucketCfgG, file.r2Key);
    return new Response(s3Res.body, { headers: hdrs });
  } else if (c.env.FILES) {
    const r2Object = await c.env.FILES.get(file.r2Key);
    if (!r2Object) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });
    return new Response(headOnly ? null : r2Object.body, { headers: hdrs });
  }
  return new Response('Storage not configured', { status: 500, headers: DAV_BASE_HEADERS });
}

async function handlePut(c: AppContext, userId: string, path: string) {
  const body = await c.req.arrayBuffer();
  // 关键修复：先标准化路径，去除尾部斜杠，确保路径解析正确
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const fileName = normalizedPath.split('/').pop() || 'untitled';
  const parentPath =
    normalizedPath.lastIndexOf('/') > 0 ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  const encKeyP = getEncryptionKey(c.env);
  let parentId: string | null = null;

  if (parentPath !== '/') {
    const parentFolder = await findFileByPath(db, userId, parentPath);
    if (!parentFolder) {
      // 自动创建父目录
      const pathParts = parentPath.split('/').filter(Boolean);
      let currentParentId: string | null = null;
      let currentPath = '';

      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
        const folder = await findFileByPath(db, userId, currentPath);

        if (!folder) {
          const folderId = crypto.randomUUID();
          const now = new Date().toISOString();
          const bucketCfg = await resolveBucketConfig(db, userId, encKeyP, null, currentParentId);

          await db.insert(files).values({
            id: folderId,
            userId,
            parentId: currentParentId,
            name: part,
            path: currentPath,
            type: 'folder',
            size: 0,
            r2Key: `folders/${folderId}`,
            mimeType: null,
            hash: null,
            isFolder: true,
            bucketId: bucketCfg?.id ?? null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          currentParentId = folderId;
        } else {
          currentParentId = folder.id;
        }
      }
      parentId = currentParentId;
    } else {
      parentId = parentFolder.id;
    }
  }

  const existingFile = await findFileByPath(db, userId, normalizedPath);

  const fileId = existingFile?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const mimeType = c.req.header('Content-Type') || 'application/octet-stream';
  const r2Key = `files/${userId}/${fileId}/${fileName}`;

  const bucketCfgP = await resolveBucketConfig(db, userId, encKeyP, null, parentId);

  if (existingFile) {
    const sizeDelta = body.byteLength - existingFile.size;
    if (sizeDelta > 0) {
      const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
      if (userRow && userRow.storageUsed + sizeDelta > userRow.storageQuota) {
        return new Response('Insufficient Storage', { status: 507, headers: DAV_BASE_HEADERS });
      }
      if (bucketCfgP) {
        const quotaErr = await checkBucketQuota(db, bucketCfgP.id, sizeDelta);
        if (quotaErr) return new Response(quotaErr, { status: 507, headers: DAV_BASE_HEADERS });
      }
    }
  } else {
    const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
    if (userRow && userRow.storageUsed + body.byteLength > userRow.storageQuota) {
      return new Response('Insufficient Storage', { status: 507, headers: DAV_BASE_HEADERS });
    }
    if (bucketCfgP) {
      const quotaErr = await checkBucketQuota(db, bucketCfgP.id, body.byteLength);
      if (quotaErr) return new Response(quotaErr, { status: 507, headers: DAV_BASE_HEADERS });
    }
  }

  if (existingFile && existingFile.r2Key !== r2Key) {
    const oldBucketCfg = await resolveBucketConfig(db, userId, encKeyP, existingFile.bucketId, existingFile.parentId);
    if (oldBucketCfg) {
      try {
        await s3Delete(oldBucketCfg, existingFile.r2Key);
      } catch (error) {
        logger.error('WEBDAV', '删除旧对象失败', { r2Key: existingFile.r2Key }, error);
      }
      await updateBucketStats(db, oldBucketCfg.id, -existingFile.size, -1);
    } else if (c.env.FILES) {
      await c.env.FILES.delete(existingFile.r2Key);
    }
  }

  if (bucketCfgP) {
    await s3Put(bucketCfgP, r2Key, body, mimeType, { userId, originalName: fileName });
  } else if (c.env.FILES) {
    await c.env.FILES.put(r2Key, body, { httpMetadata: { contentType: mimeType } });
  } else {
    return new Response('Storage not configured', { status: 500, headers: DAV_BASE_HEADERS });
  }

  if (existingFile) {
    await db
      .update(files)
      .set({ size: body.byteLength, mimeType, r2Key, bucketId: bucketCfgP?.id ?? null, updatedAt: now })
      .where(eq(files.id, fileId));

    const sizeDelta = body.byteLength - existingFile.size;
    if (sizeDelta !== 0) {
      await updateUserStorage(db, userId, sizeDelta);
    }
    if (bucketCfgP && existingFile.r2Key !== r2Key) {
      await updateBucketStats(db, bucketCfgP.id, body.byteLength, 1);
    } else if (bucketCfgP) {
      await updateBucketStats(db, bucketCfgP.id, sizeDelta, 0);
    }
  } else {
    await db.insert(files).values({
      id: fileId,
      userId,
      parentId,
      name: fileName,
      path: normalizedPath,
      type: 'file',
      size: body.byteLength,
      r2Key,
      mimeType,
      hash: null,
      isFolder: false,
      bucketId: bucketCfgP?.id ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (bucketCfgP) await updateBucketStats(db, bucketCfgP.id, body.byteLength, 1);

    await updateUserStorage(db, userId, body.byteLength);
  }

  return new Response(null, { status: existingFile ? 204 : 201, headers: DAV_BASE_HEADERS });
}

async function handleMkcol(c: AppContext, userId: string, path: string) {
  const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const folderName = cleanPath.split('/').pop() || 'untitled';
  const parentPath = cleanPath.lastIndexOf('/') > 0 ? cleanPath.slice(0, cleanPath.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  let parentId: string | null = null;

  if (parentPath !== '/') {
    const parentFolder = await findFileByPath(db, userId, parentPath);
    if (!parentFolder) return new Response('Conflict: parent not found', { status: 409, headers: DAV_BASE_HEADERS });
    parentId = parentFolder.id;
  }

  const normalizedPath = cleanPath + '/';

  const existing = await findFileByPath(db, userId, normalizedPath);
  if (existing) return new Response('Method Not Allowed: already exists', { status: 405, headers: DAV_BASE_HEADERS });

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const encKey = getEncryptionKey(c.env);
  const bucketCfg = await resolveBucketConfig(db, userId, encKey, null, parentId);

  await db.insert(files).values({
    id: folderId,
    userId,
    parentId,
    name: folderName,
    path: normalizedPath,
    type: 'folder',
    size: 0,
    r2Key: `folders/${folderId}`,
    mimeType: null,
    hash: null,
    isFolder: true,
    bucketId: bucketCfg?.id ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

async function handleDelete(c: AppContext, userId: string, path: string) {
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });

  const encKeyD = getEncryptionKey(c.env);
  let totalFreedSize = 0;

  if (file.isFolder) {
    const folderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(folderPath + '/'));

    for (const child of childFiles) {
      if (!child.isFolder) {
        const bucketCfgD = await resolveBucketConfig(db, userId, encKeyD, child.bucketId, child.parentId);
        if (bucketCfgD) {
          try {
            await s3Delete(bucketCfgD, child.r2Key);
          } catch (error) {
            logger.error('WEBDAV', 'S3删除失败', { r2Key: child.r2Key }, error);
          }
          await updateBucketStats(db, bucketCfgD.id, -child.size, -1);
        } else if (c.env.FILES) {
          await c.env.FILES.delete(child.r2Key);
        }
        totalFreedSize += child.size;
      }
      await db.delete(files).where(eq(files.id, child.id));
    }
  } else {
    const bucketCfgD = await resolveBucketConfig(db, userId, encKeyD, file.bucketId, file.parentId);
    if (bucketCfgD) {
      try {
        await s3Delete(bucketCfgD, file.r2Key);
      } catch (error) {
        logger.error('WEBDAV', 'S3删除失败', { r2Key: file.r2Key }, error);
      }
      await updateBucketStats(db, bucketCfgD.id, -file.size, -1);
    } else if (c.env.FILES) {
      await c.env.FILES.delete(file.r2Key);
    }
    totalFreedSize = file.size;
  }

  await db.delete(files).where(eq(files.id, file.id));

  if (totalFreedSize > 0) {
    await updateUserStorage(db, userId, -totalFreedSize);
  }

  return new Response(null, { status: 204, headers: DAV_BASE_HEADERS });
}

async function handleMove(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const rawDestPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const destPath = rawDestPath.endsWith('/') ? rawDestPath.slice(0, -1) : rawDestPath;
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });

  const newName = destPath.split('/').pop() || file.name;

  const destParentPath = destPath.lastIndexOf('/') > 0 ? destPath.slice(0, destPath.lastIndexOf('/')) : '/';
  let destParentId: string | null = null;
  if (destParentPath !== '/') {
    const destParentFolder = await findFileByPath(db, userId, destParentPath);
    destParentId = destParentFolder?.id ?? null;
  }

  const now = new Date().toISOString();
  const oldPath = file.isFolder ? (file.path.endsWith('/') ? file.path.slice(0, -1) : file.path) : file.path;

  await db
    .update(files)
    .set({ name: newName, path: destPath, parentId: destParentId, updatedAt: now })
    .where(eq(files.id, file.id));

  if (file.isFolder) {
    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(oldPath + '/'));
    for (const child of childFiles) {
      const newChildPath = destPath + child.path.slice(oldPath.length);
      await db.update(files).set({ path: newChildPath, updatedAt: now }).where(eq(files.id, child.id));
    }
  }

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

async function handleCopy(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const rawDestPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const destPath = rawDestPath.endsWith('/') ? rawDestPath.slice(0, -1) : rawDestPath;
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });

  const newName = destPath.split('/').pop() || file.name;
  const now = new Date().toISOString();

  const destParentPath = destPath.lastIndexOf('/') > 0 ? destPath.slice(0, destPath.lastIndexOf('/')) : '/';
  let destParentId: string | null = null;
  if (destParentPath !== '/') {
    const destParentFolder = await findFileByPath(db, userId, destParentPath);
    destParentId = destParentFolder?.id ?? null;
  }

  const encKeyC = getEncryptionKey(c.env);
  const destBucketCfg = await resolveBucketConfig(db, userId, encKeyC, null, destParentId);

  let totalCopiedSize = 0;

  if (!file.isFolder) {
    const newId = crypto.randomUUID();
    const srcBucketCfg = await resolveBucketConfig(db, userId, encKeyC, file.bucketId, file.parentId);
    const newR2Key = `files/${userId}/${newId}/${newName}`;

    if (destBucketCfg) {
      let fileContent: ArrayBuffer;
      if (srcBucketCfg) {
        const srcRes = await s3Get(srcBucketCfg, file.r2Key);
        fileContent = await srcRes.arrayBuffer();
      } else if (c.env.FILES) {
        const r2Object = await c.env.FILES.get(file.r2Key);
        if (!r2Object) return new Response('Source file not found', { status: 404, headers: DAV_BASE_HEADERS });
        fileContent = await r2Object.arrayBuffer();
      } else {
        return new Response('Storage not configured', { status: 500, headers: DAV_BASE_HEADERS });
      }

      await s3Put(destBucketCfg, newR2Key, fileContent, file.mimeType || 'application/octet-stream');
      await db.insert(files).values({
        id: newId,
        userId,
        parentId: destParentId,
        name: newName,
        path: destPath,
        type: 'file',
        size: file.size,
        r2Key: newR2Key,
        mimeType: file.mimeType,
        hash: file.hash,
        refCount: 1,
        isFolder: false,
        bucketId: destBucketCfg.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await updateBucketStats(db, destBucketCfg.id, file.size, 1);
      totalCopiedSize += file.size;
    } else if (c.env.FILES) {
      const r2Object = await c.env.FILES.get(file.r2Key);
      if (r2Object) {
        await c.env.FILES.put(newR2Key, r2Object.body, {
          httpMetadata: { contentType: file.mimeType || 'application/octet-stream' },
        });
        await db.insert(files).values({
          id: newId,
          userId,
          parentId: destParentId,
          name: newName,
          path: destPath,
          type: 'file',
          size: file.size,
          r2Key: newR2Key,
          mimeType: file.mimeType,
          hash: file.hash,
          refCount: 1,
          isFolder: false,
          bucketId: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        totalCopiedSize += file.size;
      }
    }
  } else {
    const newFolderId = crypto.randomUUID();
    const srcFolderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;

    await db.insert(files).values({
      id: newFolderId,
      userId,
      parentId: destParentId,
      name: newName,
      path: destPath + '/',
      type: 'folder',
      size: 0,
      r2Key: `folders/${newFolderId}`,
      mimeType: null,
      hash: null,
      refCount: 1,
      isFolder: true,
      bucketId: destBucketCfg?.id ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(srcFolderPath + '/'));

    const idMapping: Map<string, string> = new Map();
    idMapping.set(file.id, newFolderId);

    for (const child of childFiles) {
      const newChildId = crypto.randomUUID();
      idMapping.set(child.id, newChildId);

      const childRelativePath = child.path.slice(srcFolderPath.length);
      const newChildPath = destPath + childRelativePath;

      const childParentPath =
        newChildPath.lastIndexOf('/') > 0 ? newChildPath.slice(0, newChildPath.lastIndexOf('/')) : '/';

      let childParentId: string | null = null;
      if (child.parentId && idMapping.has(child.parentId)) {
        childParentId = idMapping.get(child.parentId)!;
      } else if (childParentPath === destPath) {
        childParentId = newFolderId;
      }

      if (child.isFolder) {
        await db.insert(files).values({
          id: newChildId,
          userId,
          parentId: childParentId,
          name: child.name,
          path: newChildPath.endsWith('/') ? newChildPath : newChildPath + '/',
          type: 'folder',
          size: 0,
          r2Key: `folders/${newChildId}`,
          mimeType: null,
          hash: null,
          refCount: 1,
          isFolder: true,
          bucketId: destBucketCfg?.id ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      } else {
        const newR2Key = `files/${userId}/${newChildId}/${child.name}`;
        const srcBucketCfg = await resolveBucketConfig(db, userId, encKeyC, child.bucketId, child.parentId);

        let copied = false;
        if (destBucketCfg) {
          let fileContent: ArrayBuffer;
          if (srcBucketCfg) {
            const srcRes = await s3Get(srcBucketCfg, child.r2Key);
            fileContent = await srcRes.arrayBuffer();
          } else if (c.env.FILES) {
            const r2Object = await c.env.FILES.get(child.r2Key);
            if (r2Object) {
              fileContent = await r2Object.arrayBuffer();
            } else {
              continue;
            }
          } else {
            continue;
          }

          await s3Put(destBucketCfg, newR2Key, fileContent, child.mimeType || 'application/octet-stream');
          await updateBucketStats(db, destBucketCfg.id, child.size, 1);
          copied = true;
        } else if (c.env.FILES) {
          const r2Object = await c.env.FILES.get(child.r2Key);
          if (r2Object) {
            await c.env.FILES.put(newR2Key, r2Object.body, {
              httpMetadata: { contentType: child.mimeType || 'application/octet-stream' },
            });
            copied = true;
          }
        }

        if (copied) {
          await db.insert(files).values({
            id: newChildId,
            userId,
            parentId: childParentId,
            name: child.name,
            path: newChildPath,
            type: 'file',
            size: child.size,
            r2Key: newR2Key,
            mimeType: child.mimeType,
            hash: child.hash,
            refCount: 1,
            isFolder: false,
            bucketId: destBucketCfg?.id ?? null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          totalCopiedSize += child.size;
        }
      }
    }
  }

  if (totalCopiedSize > 0) {
    await updateUserStorage(db, userId, totalCopiedSize);
  }

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

/**
 * LOCK 处理器
 *
 * Windows 资源管理器和 WinSCP 在写操作前会先发 LOCK 请求。
 * 无状态实现：每次返回新 token，不持久化。单用户场景完全够用。
 */
function handleLock(c: AppContext, rawPath: string) {
  const token = `urn:uuid:${crypto.randomUUID()}`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<prop xmlns="DAV:">
  <lockdiscovery>
    <activelock>
      <locktype><write/></locktype>
      <lockscope><exclusive/></lockscope>
      <depth>0</depth>
      <owner/>
      <timeout>Second-3600</timeout>
      <locktoken><href>${escapeXml(token)}</href></locktoken>
      <lockroot><href>${escapeXml(rawPath)}</href></lockroot>
    </activelock>
  </lockdiscovery>
</prop>`;

  return new Response(xml, {
    status: 200,
    headers: {
      ...DAV_BASE_HEADERS,
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<${token}>`,
    },
  });
}

/**
 * PROPPATCH 处理器
 *
 * OSSshelf 属性均为只读，返回标准 403 响应防止客户端因无响应而挂起。
 */
function handleProppatch(c: AppContext, rawPath: string) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>${escapeXml(rawPath)}</href>
    <propstat>
      <prop/>
      <status>HTTP/1.1 403 Forbidden</status>
    </propstat>
  </response>
</multistatus>`;

  return new Response(xml, {
    status: 207,
    headers: {
      ...DAV_BASE_HEADERS,
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}

export default app;
