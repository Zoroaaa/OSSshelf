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
import { errorHandler } from './middleware/error';
import type { Env } from './types/env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: ['https://ossshelf.neutronx.uk'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PROPFIND', 'MKCOL', 'COPY', 'MOVE', 'HEAD'],
  allowHeaders: ['Content-Type', 'Authorization', 'Depth', 'Destination', 'X-Requested-With'],
  exposeHeaders: ['Content-Length', 'Content-Range'],
  maxAge: 86400,
  credentials: true,
}));
app.use('*', secureHeaders());

app.use('*', errorHandler);

app.get('/', (c) => {
  return c.json({
    name: 'OSSshelf API',
    version: '0.1.0',
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
app.route('/dav', webdavRoutes);

app.notFound((c) => {
  return c.json({ success: false, error: { code: 'NOT_FOUND', message: '路由不存在' } }, 404);
});

export default app;
