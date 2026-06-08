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
import { logger as appLogger } from '@osshelf/shared';
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
import notesRoutes from './routes/notes';
import apiKeysRoutes from './routes/apiKeys';
import groupsRoutes from './routes/groups';
import teamsRoutes from './routes/teams';
import webhooksRoutes from './routes/webhooks';
import aiRoutes from './routes/ai';
import aiConfigRoutes from './routes/aiConfigRoutes';
import aiChatRoutes from './routes/aiChatRoutes';
import analyticsRoutes from './routes/analytics';
import notificationsRoutes from './routes/notifications';
import { createDocsRoutes } from './routes/docs';
import { errorHandler } from './middleware/error';
import { runAllCleanupTasks } from './lib/cleanup';
import { processAiTaskMessage, checkAndCompleteTask } from './lib/ai/aiTaskQueue';
import type { Env, AiTaskMessage } from './types/env';

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
        .map((o: string) => o.trim())
        .filter(Boolean);
      const defaultOrigins = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ];
      const allOrigins = [...new Set([...defaultOrigins, ...allowedOrigins])];
      if (allOrigins.includes(origin)) return origin;
      return undefined;
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
    version: '3.5.0',
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
app.route('/api/notes', notesRoutes);
app.route('/api/keys', apiKeysRoutes);
app.route('/api/groups', groupsRoutes);
app.route('/api/teams', teamsRoutes);
app.route('/api/webhooks', webhooksRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/ai-config', aiConfigRoutes);
app.route('/api/ai-chat', aiChatRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/notifications', notificationsRoutes);
// 文档路由：必须在所有业务路由之后注册，以便从 app.routes 提取完整路由列表
app.route('/api', createDocsRoutes(app));
app.route('/cron', cronRoutes);
app.route('/dav', webdavRoutes);

app.notFound((c) => {
  return c.json({ success: false, error: { code: 'NOT_FOUND', message: '路由不存在' } }, 404);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    appLogger.info('CRON', '定时任务触发', { time: new Date().toISOString() });
    ctx.waitUntil(
      runAllCleanupTasks(env)
        .then((result) => {
          appLogger.info('CRON', '定时任务完成', { result });
        })
        .catch((error) => {
          appLogger.error('CRON', '定时任务失败', {}, error);
        })
    );
  },
  async queue(batch: MessageBatch<AiTaskMessage>, env: Env, _ctx: ExecutionContext) {
    appLogger.info('QUEUE', '收到队列消息', { count: batch.messages.length });

    for (const message of batch.messages) {
      try {
        const result = await processAiTaskMessage(message.body, env);

        if (result.success) {
          message.ack();
          appLogger.info('QUEUE', '任务处理成功', {
            type: message.body.type,
            fileId: message.body.fileId,
          });

          await checkAndCompleteTask(env, message.body.taskId);
        } else {
          message.retry();
          appLogger.warn('QUEUE', '任务处理失败，将重试', {
            type: message.body.type,
            fileId: message.body.fileId,
            error: result.error,
          });
        }
      } catch (error) {
        message.retry();
        appLogger.error(
          'QUEUE',
          '任务处理异常',
          {
            type: message.body.type,
            fileId: message.body.fileId,
          },
          error
        );
      }
    }
  },
};
