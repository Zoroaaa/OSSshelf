/**
 * webdav.ts
 * WebDAV协议路由
 *
 * 功能:
 * - WebDAV协议完整实现
 * - 支持Windows/macOS/Linux挂载
 * - 文件读写与目录管理
 * - 锁定与解锁（LOCK/UNLOCK，兼容 Windows 资源管理器与 WinSCP）
 */

import { Hono, Context } from 'hono';
import { getDb } from '../db';
import { verifyPassword, getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import {
  createWebDAVSession,
  validateWebDAVSession,
  webdavPropFind,
  webdavGet,
  webdavPut,
  webdavDelete,
  webdavMkCol,
  webdavCopy,
  webdavMove,
  listWebDAVSessions,
  revokeWebDAVSession,
} from '../services/webdav.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const DAV_PREFIX = '/dav';
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
    const sessionResult = await validateWebDAVSession(db, email, password);

    if (!sessionResult.valid) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          ...DAV_BASE_HEADERS,
          'WWW-Authenticate': 'Basic realm="OSSshelf WebDAV"',
        },
      });
    }

    c.set('userId', sessionResult.userId);
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

app.all('/*', async (c) => {
  const method = c.req.method.toUpperCase();
  const userId = c.get('userId')!;
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPropfindXML(items: any[], rawPath: string, isRoot: boolean = false): string {
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

  const items = await webdavPropFind(db, userId, path, depth as '0' | '1' | 'infinity');
  const isRoot = path === '/' || path === '';

  const xmlHeaders = {
    'Content-Type': 'application/xml; charset=utf-8',
    ...DAV_BASE_HEADERS,
  };

  return new Response(buildPropfindXML(items, rawPath, depth === '0' ? isRoot : isRoot), {
    status: 207,
    headers: xmlHeaders,
  });
}

async function handleGet(c: AppContext, userId: string, path: string, headOnly: boolean) {
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

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

  const result = await webdavGet(c.env, db, encKey, userId, path);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 404, headers: DAV_BASE_HEADERS });
  }

  if (headOnly) {
    return new Response(null, { headers: { ...DAV_BASE_HEADERS, ...result.data!.headers } });
  }

  return new Response(result.data!.body, { headers: { ...DAV_BASE_HEADERS, ...result.data!.headers } });
}

async function handlePut(c: AppContext, userId: string, path: string) {
  const body = await c.req.arrayBuffer();
  const contentType = c.req.header('Content-Type') || 'application/octet-stream';

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await webdavPut(c.env, db, encKey, userId, path, body, contentType);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 500, headers: DAV_BASE_HEADERS });
  }

  return new Response(null, { status: result.data?.fileId ? 201 : 204, headers: DAV_BASE_HEADERS });
}

async function handleMkcol(c: AppContext, userId: string, path: string) {
  const db = getDb(c.env.DB);

  const result = await webdavMkCol(db, userId, path);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 400, headers: DAV_BASE_HEADERS });
  }

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

async function handleDelete(c: AppContext, userId: string, path: string) {
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await webdavDelete(c.env, db, encKey, userId, path);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 404, headers: DAV_BASE_HEADERS });
  }

  return new Response(null, { status: 204, headers: DAV_BASE_HEADERS });
}

async function handleMove(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const db = getDb(c.env.DB);

  const result = await webdavMove(db, userId, path, destPath);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 404, headers: DAV_BASE_HEADERS });
  }

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

async function handleCopy(c: AppContext, userId: string, path: string) {
  const destination = c.req.header('Destination');
  if (!destination) return new Response('Destination header required', { status: 400, headers: DAV_BASE_HEADERS });

  const destPath = new URL(destination).pathname.replace(/^\/dav/, '') || '/';
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await webdavCopy(c.env, db, encKey, userId, path, destPath);

  if (!result.success) {
    return new Response(result.error, { status: result.status || 404, headers: DAV_BASE_HEADERS });
  }

  return new Response(null, { status: 201, headers: DAV_BASE_HEADERS });
}

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
