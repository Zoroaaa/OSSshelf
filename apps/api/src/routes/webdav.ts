/**
 * webdav.ts
 * WebDAV协议路由
 * 
 * 功能:
 * - WebDAV协议完整实现
 * - 支持Windows/macOS/Linux挂载
 * - 文件读写与目录管理
 * - 锁定与解锁
 */

import { Hono, Context } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users } from '../db';
import { s3Put, s3Get, s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
import type { Env, Variables } from '../types/env';
import { verifyPassword } from '../lib/crypto';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

app.options('/*', (c) => {
  return new Response(null, {
    status: 200,
    headers: {
      Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, MOVE, COPY',
      DAV: '1, 2',
      'MS-Author-Via': 'DAV',
      'Content-Length': '0',
    },
  });
});

app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"' },
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
        headers: { 'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"' },
      });
    }

    c.set('userId', user.id);
    await next();
  } catch {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"' },
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
      return handlePropfind(c, userId, path);
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
    default:
      return new Response('Method Not Allowed', { status: 405 });
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

function buildPropfindXML(items: FileRow[], basePath: string, isRoot: boolean = false): string {
  const responses: string[] = [];
  
  if (isRoot) {
    responses.push(`
  <response>
    <href>${escapeXml(basePath)}</href>
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
    let href = file.path;
    if (!href.startsWith('/')) href = '/' + href;
    if (file.isFolder && !href.endsWith('/')) href += '/';
    
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

async function handlePropfind(c: AppContext, userId: string, path: string) {
  const depth = c.req.header('Depth') || '1';
  const db = getDb(c.env.DB);
  const isRoot = path === '/' || path === '';

  let parentCondition;
  let parentFolder = null;
  
  if (isRoot) {
    parentCondition = isNull(files.parentId);
  } else {
    parentFolder = await findFileByPath(db, userId, path);
    if (parentFolder) {
      parentCondition = eq(files.parentId, parentFolder.id);
    } else {
      return new Response(buildPropfindXML([], '/', false), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
  }

  const items = await db.select().from(files)
    .where(and(eq(files.userId, userId), parentCondition, isNull(files.deletedAt))).all();

  if (depth === '0') {
    if (isRoot) {
      return new Response(buildPropfindXML([], '/', true), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    } else {
      const current = await findFileByPath(db, userId, path);
      if (current) items.unshift(current);
      return new Response(buildPropfindXML(items, '/', false), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
  }

  return new Response(buildPropfindXML(items, '/', true), {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

async function findFileByPath(db: ReturnType<typeof getDb>, userId: string, path: string) {
  let file = await db.select().from(files)
    .where(and(eq(files.userId, userId), eq(files.path, path), isNull(files.deletedAt))).get();
  
  if (!file) {
    file = await db.select().from(files)
      .where(and(eq(files.userId, userId), eq(files.path, path + '/'), isNull(files.deletedAt))).get();
  }
  
  if (!file && path.endsWith('/')) {
    file = await db.select().from(files)
      .where(and(eq(files.userId, userId), eq(files.path, path.slice(0, -1)), isNull(files.deletedAt))).get();
  }
  
  return file;
}

async function handleGet(c: AppContext, userId: string, path: string, headOnly: boolean) {
  const db = getDb(c.env.DB);
  
  if (path === '/' || path === '') {
    return new Response(headOnly ? null : 'Root Collection', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': '14',
      },
    });
  }
  
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404 });
  if (file.isFolder) return new Response('Is a collection', { status: 400 });

  const encKeyG = c.env.JWT_SECRET || 'ossshelf-key';
  const bucketCfgG = await resolveBucketConfig(db, userId, encKeyG, file.bucketId, file.parentId);
  const hdrs = { 'Content-Type': file.mimeType || 'application/octet-stream', 'Content-Length': file.size.toString() };
  if (bucketCfgG) {
    if (headOnly) return new Response(null, { headers: hdrs });
    const s3Res = await s3Get(bucketCfgG, file.r2Key);
    return new Response(s3Res.body, { headers: hdrs });
  } else if (c.env.FILES) {
    const r2Object = await c.env.FILES.get(file.r2Key);
    if (!r2Object) return new Response('Not Found', { status: 404 });
    return new Response(headOnly ? null : r2Object.body, { headers: hdrs });
  }
  return new Response('Storage not configured', { status: 500 });
}

async function handlePut(c: AppContext, userId: string, path: string) {
  const body = await c.req.arrayBuffer();
  const fileName = path.split('/').pop() || 'untitled';
  const parentPath = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  const encKeyP = c.env.JWT_SECRET || 'ossshelf-key';
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
            id: folderId, userId, parentId: currentParentId, name: part, path: currentPath, type: 'folder',
            size: 0, r2Key: `folders/${folderId}`, mimeType: null, hash: null, isFolder: true, 
            bucketId: bucketCfg?.id ?? null, createdAt: now, updatedAt: now, deletedAt: null,
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
  if (bucketCfgP) {
    await s3Put(bucketCfgP, r2Key, body, mimeType, { userId, originalName: fileName });
  } else if (c.env.FILES) {
    await c.env.FILES.put(r2Key, body, { httpMetadata: { contentType: mimeType } });
  } else {
    return new Response('Storage not configured', { status: 500 });
  }

  if (existingFile) {
    await db.update(files).set({ size: body.byteLength, mimeType, updatedAt: now }).where(eq(files.id, fileId));
  } else {
    await db.insert(files).values({
      id: fileId, userId, parentId, name: fileName, path, type: 'file',
      size: body.byteLength, r2Key, mimeType, hash: null, isFolder: false,
      bucketId: bucketCfgP?.id ?? null, createdAt: now, updatedAt: now, deletedAt: null,
    });
    if (bucketCfgP) await updateBucketStats(db, bucketCfgP.id, body.byteLength, 1);
  }

  return new Response(null, { status: existingFile ? 204 : 201 });
}

async function handleMkcol(c: AppContext, userId: string, path: string) {
  const folderName = path.split('/').pop() || 'untitled';
  const parentPath = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '/';

  const db = getDb(c.env.DB);
  let parentId: string | null = null;

  if (parentPath !== '/') {
    const parentFolder = await findFileByPath(db, userId, parentPath);
    if (!parentFolder) return new Response('Conflict: parent not found', { status: 409 });
    parentId = parentFolder.id;
  }

  const normalizedPath = path.endsWith('/') ? path : path + '/';
  
  const existing = await findFileByPath(db, userId, normalizedPath);
  if (existing) return new Response('Method Not Allowed: already exists', { status: 405 });

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(files).values({
    id: folderId, userId, parentId, name: folderName, path: normalizedPath, type: 'folder',
    size: 0, r2Key: `folders/${folderId}`, mimeType: null, hash: null, isFolder: true, 
    createdAt: now, updatedAt: now, deletedAt: null,
  });

  return new Response(null, { status: 201 });
}

async function handleDelete(c: AppContext, userId: string, path: string) {
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404 });

  if (!file.isFolder) {
    const encKeyD = c.env.JWT_SECRET || 'ossshelf-key';
    const bucketCfgD = await resolveBucketConfig(db, userId, encKeyD, file.bucketId, file.parentId);
    if (bucketCfgD) {
      try { await s3Delete(bucketCfgD, file.r2Key); } catch(e) { console.error('webdav delete s3 error:', e); }
      await updateBucketStats(db, bucketCfgD.id, -file.size, -1);
    } else if (c.env.FILES) {
      await c.env.FILES.delete(file.r2Key);
    }
  }
  await db.delete(files).where(eq(files.id, file.id));
  return new Response(null, { status: 204 });
}

async function handleMove(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400 });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404 });

  const newName = destPath.split('/').pop() || file.name;
  await db.update(files)
    .set({ name: newName, path: destPath, updatedAt: new Date().toISOString() })
    .where(eq(files.id, file.id));

  return new Response(null, { status: 201 });
}

async function handleCopy(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400 });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const db = getDb(c.env.DB);
  const file = await findFileByPath(db, userId, path);

  if (!file) return new Response('Not Found', { status: 404 });

  const newName = destPath.split('/').pop() || file.name;
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!file.isFolder) {
    const encKeyC = c.env.JWT_SECRET || 'ossshelf-key';
    const bucketCfgC = await resolveBucketConfig(db, userId, encKeyC, file.bucketId, file.parentId);
    const newR2Key = `files/${userId}/${newId}/${newName}`;
    if (bucketCfgC) {
      const srcRes = await s3Get(bucketCfgC, file.r2Key);
      await s3Put(bucketCfgC, newR2Key, await srcRes.arrayBuffer(), file.mimeType || 'application/octet-stream');
      await db.insert(files).values({ 
        id: newId, userId, parentId: file.parentId, name: newName, path: destPath, type: 'file', 
        size: file.size, r2Key: newR2Key, mimeType: file.mimeType, hash: file.hash, 
        isFolder: false, bucketId: file.bucketId, createdAt: now, updatedAt: now, deletedAt: null,
      });
      await updateBucketStats(db, bucketCfgC.id, file.size, 1);
    } else if (c.env.FILES) {
      const r2Object = await c.env.FILES.get(file.r2Key);
      if (r2Object) {
        await c.env.FILES.put(newR2Key, r2Object.body, { httpMetadata: { contentType: file.mimeType || 'application/octet-stream' } });
        await db.insert(files).values({ 
          id: newId, userId, parentId: file.parentId, name: newName, path: destPath, type: 'file', 
          size: file.size, r2Key: newR2Key, mimeType: file.mimeType, hash: file.hash, 
          isFolder: false, bucketId: null, createdAt: now, updatedAt: now, deletedAt: null,
        });
      }
    }
  }

  return new Response(null, { status: 201 });
}

export default app;
