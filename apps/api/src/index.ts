/**
 * index.ts
 * API服务入口文件
 *
 * 功能:
 * - 注册所有API路由
 * - 配置中间件（CORS、日志、安全头）
 * - 全局错误处理
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import authRoutes from './routes/auth';
import filesRoutes from './routes/files';
import shareRoutes from './routes/share';
import webdavRoutes from './routes/webdav';
import bucketsRoutes from './routes/buckets';
import presignRoutes from './routes/presign';
import adminRoutes from './routes/admin';
import tasksRoutes from './routes/tasks';
import permissionsRoutes from './routes/permissions';
import batchRoutes from './routes/batch';
import searchRoutes from './routes/search';
import downloadsRoutes from './routes/downloads';
import previewRoutes from './routes/preview';
import cronRoutes from './routes/cron';
import telegramRoutes from './routes/telegram';
import migrateRoutes from './routes/migrate';
import directLinkRoutes from './routes/directLink';
import versionsRoutes from './routes/versions';
import { errorHandler } from './middleware/error';
import { runAllCleanupTasks } from './lib/cleanup';
import type { Env } from './types/env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const corsOrigins = c.env.CORS_ORIGINS || '';
      const allowedOrigins = corsOrigins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const defaultOrigins = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ];
      const allOrigins = [...new Set([...defaultOrigins, ...allowedOrigins])];
      if (allOrigins.includes(origin)) return origin;
      if (allowedOrigins.length > 0) return allowedOrigins[0];
      return defaultOrigins[0];
    },
    allowMethods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'PROPFIND',
      'PROPPATCH',
      'MKCOL',
      'COPY',
      'MOVE',
      'HEAD',
      'LOCK',
      'UNLOCK',
    ],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Depth',
      'Destination',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cache-Control',
      'Lock-Token',
      'If',
      'Overwrite',
      'Timeout',
    ],
    exposeHeaders: ['Content-Length', 'Content-Range', 'ETag', 'DAV', 'Lock-Token'],
    maxAge: 86400,
    credentials: true,
  })
);
app.use('/dav/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        DAV: '1, 2',
        'MS-Author-Via': 'DAV',
        Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, MOVE, COPY, LOCK, UNLOCK',
        'Content-Length': '0',
      },
    });
  }
  await next();
});
app.use(
  '*',
  secureHeaders({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  })
);

app.use('*', errorHandler);

app.get('/', (c) => {
  return c.json({
    name: 'OSSshelf API',
    version: '0.2.0',
    description: '基于 Cloudflare 部署的多厂商 OSS 文件管理系统 API',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.route('/api/auth', authRoutes);
app.route('/api/files', filesRoutes);
app.route('/api/share', shareRoutes);
app.route('/api/buckets', bucketsRoutes);
app.route('/api/presign', presignRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/tasks', tasksRoutes);
app.route('/api/permissions', permissionsRoutes);
app.route('/api/batch', batchRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/downloads', downloadsRoutes);
app.route('/api/preview', previewRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/migrate', migrateRoutes);
app.route('/api/direct', directLinkRoutes);
app.route('/api/versions', versionsRoutes);
app.route('/cron', cronRoutes);
app.route('/dav', webdavRoutes);

app.notFound((c) => {
  return c.json({ success: false, error: { code: 'NOT_FOUND', message: '路由不存在' } }, 404);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Cron trigger fired at ${new Date().toISOString()}`);
    ctx.waitUntil(
      runAllCleanupTasks(env)
        .then((result) => {
          console.log('Cron job completed:', JSON.stringify(result));
        })
        .catch((error) => {
          console.error('Cron job failed:', error);
        })
    );
  },
};
