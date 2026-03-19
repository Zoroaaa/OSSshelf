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
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { verifyPassword, getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';

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

app.options('/*', (c) => {
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
        headers: { ...DAV_BASE_HEADERS, Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, MOVE, COPY, LOCK, UNLOCK' },
      });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type FileRow = typeof files.$inferSelect;

/**
 * 构建 PROPFIND 响应 XML。
 *
 * @param items       当前目录下的文件/文件夹列表
 * @param rawPath     原始请求路径（含 /dav 前缀，用于根节点 href 精确匹配）
 * @param isRoot      是否渲染根集合条目
 *
 * 关键修复：
 * 1. 根节点 <href> 使用 rawPath（即请求的原始路径），而非构造值，
 *    确保与 Windows 请求的路径精确匹配。
 * 2. 子项 <href> 统一加 /dav 前缀。
 */
function buildPropfindXML(items: FileRow[], rawPath: string, isRoot: boolean = false): string {
  const responses: string[] = [];

  if (isRoot) {
    // 根节点 href 必须与请求路径精确匹配，Windows 会用它来验证路径合法性
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

    const href = DAV_PREFIX + logicalPath;

    responses.push(`
  <response>
    <href>${escapeXml(href)}</href>
    <propstat>
      <prop>
        <displayname>${escapeXml(file.name)}</displayname>
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

  const xmlHeaders = {
    'Content-Type': 'application/xml; charset=utf-8',
    ...DAV_BASE_HEADERS,
  };

  let parentCondition;

  if (isRoot) {
    parentCondition = isNull(files.parentId);
  } else {
    const parentFolder = await findFileByPath(db, userId, path);
    if (parentFolder) {
      parentCondition = eq(files.parentId, parentFolder.id);
    } else {
      return new Response(buildPropfindXML([], rawPath, false), {
        status: 207,
        headers: xmlHeaders,
      });
    }
  }

  const items = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), parentCondition, isNull(files.deletedAt)))
    .all();

  if (depth === '0') {
    if (isRoot) {
      return new Response(buildPropfindXML([], rawPath, true), {
        status: 207,
        headers: xmlHeaders,
      });
    } else {
      const current = await findFileByPath(db, userId, path);
      if (current) items.unshift(current);
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

async function findFileByPath(db: ReturnType<typeof getDb>, userId: string, path: string): Promise<File | undefined> {
  let file = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.path, path), isNull(files.deletedAt)))
    .get();

  if (!file) {
    file = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.path, path + '/'), isNull(files.deletedAt)))
      .get();
  }

  if (!file && path.endsWith('/')) {
    file = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.path, path.slice(0, -1)), isNull(files.deletedAt)))
      .get();
  }

  return file;
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
  const fileName = path.split('/').pop() || 'untitled';
  const parentPath = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  const encKeyP = getEncryptionKey(c.env);
  let parentId: string | null = null;

  if (parentPath !== '/') {
    let parentFolder = await findFileByPath(db, userId, parentPath);
    if (!parentFolder) {
      const pathParts = parentPath.split('/').filter(Boolean);
      let currentParentId: string | null = null;
      let currentPath = '';

      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
        let folder = await findFileByPath(db, userId, currentPath);

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

  const existingFile = await findFileByPath(db, userId, path);

  const fileId = existingFile?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const mimeType = c.req.header('Content-Type') || 'application/octet-stream';
  const r2Key = `files/${userId}/${fileId}/${fileName}`;

  const bucketCfgP = await resolveBucketConfig(db, userId, encKeyP, null, parentId);

  if (!existingFile) {
    const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
    if (userRow && userRow.storageUsed + body.byteLength > userRow.storageQuota) {
      return new Response('Insufficient Storage', { status: 507, headers: DAV_BASE_HEADERS });
    }
    if (bucketCfgP) {
      const quotaErr = await checkBucketQuota(db, bucketCfgP.id, body.byteLength);
      if (quotaErr) return new Response(quotaErr, { status: 507, headers: DAV_BASE_HEADERS });
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
    await db.update(files).set({ size: body.byteLength, mimeType, updatedAt: now }).where(eq(files.id, fileId));

    const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
    if (userRow) {
      const sizeDelta = body.byteLength - existingFile.size;
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, userRow.storageUsed + sizeDelta), updatedAt: now })
        .where(eq(users.id, userId));
    }
  } else {
    await db.insert(files).values({
      id: fileId,
      userId,
      parentId,
      name: fileName,
      path,
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

    const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
    if (userRow) {
      await db
        .update(users)
        .set({ storageUsed: userRow.storageUsed + body.byteLength, updatedAt: now })
        .where(eq(users.id, userId));
    }
  }

  return new Response(null, { status: existingFile ? 204 : 201, headers: DAV_BASE_HEADERS });
}

async function handleMkcol(c: AppContext, userId: string, path: string) {
  const folderName = path.split('/').pop() || 'untitled';
  const parentPath = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  let parentId: string | null = null;

  if (parentPath !== '/') {
    const parentFolder = await findFileByPath(db, userId, parentPath);
    if (!parentFolder) return new Response('Conflict: parent not found', { status: 409, headers: DAV_BASE_HEADERS });
    parentId = parentFolder.id;
  }

  const normalizedPath = path.endsWith('/') ? path : path + '/';

  const existing = await findFileByPath(db, userId, normalizedPath);
  if (existing) return new Response('Method Not Allowed: already exists', { status: 405, headers: DAV_BASE_HEADERS });

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();

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

  if (!file.isFolder) {
    const encKeyD = getEncryptionKey(c.env);
    const bucketCfgD = await resolveBucketConfig(db, userId, encKeyD, file.bucketId, file.parentId);
    if (bucketCfgD) {
      try {
        await s3Delete(bucketCfgD, file.r2Key);
      } catch (e) {
        console.error('webdav delete s3 error:', e);
      }
      await updateBucketStats(db, bucketCfgD.id, -file.size, -1);
    } else if (c.env.FILES) {
      await c.env.FILES.delete(file.r2Key);
    }
    const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
    if (userRow) {
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, userRow.storageUsed - file.size), updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }
  }
  await db.delete(files).where(eq(files.id, file.id));
  return new Response(null, { status: 204, headers: DAV_BASE_HEADERS });
}

async function handleMove(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
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

  await db
    .update(files)
    .set({ name: newName, path: destPath, parentId: destParentId, updatedAt: new Date().toISOString() })
    .where(eq(files.id, file.id));

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

async function handleCopy(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404, headers: DAV_BASE_HEADERS });

  const newName = destPath.split('/').pop() || file.name;
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!file.isFolder) {
    const encKeyC = getEncryptionKey(c.env);
    const bucketCfgC = await resolveBucketConfig(db, userId, encKeyC, file.bucketId, file.parentId);
    const newR2Key = `files/${userId}/${newId}/${newName}`;
    if (bucketCfgC) {
      const srcRes = await s3Get(bucketCfgC, file.r2Key);
      await s3Put(bucketCfgC, newR2Key, await srcRes.arrayBuffer(), file.mimeType || 'application/octet-stream');
      await db.insert(files).values({
        id: newId,
        userId,
        parentId: file.parentId,
        name: newName,
        path: destPath,
        type: 'file',
        size: file.size,
        r2Key: newR2Key,
        mimeType: file.mimeType,
        hash: file.hash,
        isFolder: false,
        bucketId: file.bucketId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await updateBucketStats(db, bucketCfgC.id, file.size, 1);
    } else if (c.env.FILES) {
      const r2Object = await c.env.FILES.get(file.r2Key);
      if (r2Object) {
        await c.env.FILES.put(newR2Key, r2Object.body, {
          httpMetadata: { contentType: file.mimeType || 'application/octet-stream' },
        });
        await db.insert(files).values({
          id: newId,
          userId,
          parentId: file.parentId,
          name: newName,
          path: destPath,
          type: 'file',
          size: file.size,
          r2Key: newR2Key,
          mimeType: file.mimeType,
          hash: file.hash,
          isFolder: false,
          bucketId: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }
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
