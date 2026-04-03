/**
 * admin.ts
 * 管理员路由
 *
 * 功能:
 * - 用户管理（列表、查询、禁用、删除）
 * - 注册配置管理
 * - 邀请码管理
 * - 系统统计与审计日志
 *
 * 所有接口需要管理员权限
 */

import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, desc, sql, gte, lte } from 'drizzle-orm';
import { getDb, users, files, storageBuckets, auditLogs } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { hashPassword } from '../lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getRegConfig, type RegConfig } from '../lib/utils';
import { createNotification, sendNotification } from '../lib/notificationUtils';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', authMiddleware);

app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throwAppError('UNAUTHORIZED');
  }
  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId!)).get();
  if (!user || user.role !== 'admin') {
    throwAppError('ADMIN_REQUIRED');
  }
  c.set('user', { id: user.id, email: user.email, role: user.role });
  await next();
});

const patchUserSchema = z
  .object({
    name: z.string().max(100).optional(),
    role: z.enum(['admin', 'user']).optional(),
    storageQuota: z.number().int().min(0).optional(),
    newPassword: z.string().min(6).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: '至少提供一个更新字段' });

const registrationSchema = z.object({
  open: z.boolean().optional(),
  requireInviteCode: z.boolean().optional(),
});

const INVITE_PREFIX = 'admin:invite:';
const REG_CONFIG_KEY = 'admin:registration_config';

app.get('/users', async (c) => {
  const db = getDb(c.env.DB);
  const allUsers = await db.select().from(users).all();

  const enriched = await Promise.all(
    allUsers.map(async (u) => {
      const userFiles = await db
        .select({ size: files.size, isFolder: files.isFolder })
        .from(files)
        .where(and(eq(files.userId, u.id), isNull(files.deletedAt)))
        .all();
      const actualStorageUsed = userFiles.filter((f) => !f.isFolder).reduce((sum, f) => sum + f.size, 0);
      const fileCount = userFiles.filter((f) => !f.isFolder).length;

      const buckets = await db
        .select()
        .from(storageBuckets)
        .where(and(eq(storageBuckets.userId, u.id), eq(storageBuckets.isActive, true)))
        .all();

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        storageQuota: u.storageQuota,
        storageUsed: actualStorageUsed,
        fileCount,
        bucketCount: buckets.length,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    })
  );

  return c.json({ success: true, data: enriched });
});

// ── GET /api/admin/users/:id ──────────────────────────────────────────────

app.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throwAppError('USER_NOT_FOUND');
  const { passwordHash: _pw, ...safe } = user;
  return c.json({ success: true, data: safe });
});

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────

app.patch('/users/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const result = patchUserSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throwAppError('USER_NOT_FOUND');

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  const { name, role, storageQuota, newPassword } = result.data;
  if (name !== undefined) updateData.name = name;
  if (role !== undefined) updateData.role = role;
  if (storageQuota !== undefined) updateData.storageQuota = storageQuota;
  if (newPassword) updateData.passwordHash = await hashPassword(newPassword);

  await db.update(users).set(updateData).where(eq(users.id, id));

  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'user.update',
    resourceType: 'user',
    resourceId: id,
    details: { name: name !== undefined, role, storageQuota, passwordReset: !!newPassword },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '用户已更新' } });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────

app.delete('/users/:id', async (c) => {
  const adminId = c.get('userId')!;
  const id = c.req.param('id');

  if (id === adminId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '不能删除自己的账户' } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throwAppError('USER_NOT_FOUND');

  // Cascade: files + buckets + sessions are deleted via DB ON DELETE CASCADE
  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'user.delete',
    resourceType: 'user',
    resourceId: id,
    details: { targetEmail: user.email, targetName: user.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  await db.delete(users).where(eq(users.id, id));

  return c.json({ success: true, data: { message: '用户已删除' } });
});

// ── GET /api/admin/registration ───────────────────────────────────────────

app.get('/registration', async (c) => {
  const config = await getRegConfig(c.env.KV);

  // List active invite codes
  const list = await c.env.KV.list({ prefix: INVITE_PREFIX });
  const codes = await Promise.all(
    list.keys.map(async ({ name }) => {
      const raw = await c.env.KV.get(name);
      const code = name.replace(INVITE_PREFIX, '');
      try {
        const meta = raw ? JSON.parse(raw) : {};
        return { code, ...meta };
      } catch {
        return { code, usedBy: null, createdAt: null };
      }
    })
  );

  return c.json({ success: true, data: { ...config, inviteCodes: codes } });
});

// ── PUT /api/admin/registration ───────────────────────────────────────────

app.put('/registration', async (c) => {
  const body = await c.req.json();
  const result = registrationSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const current = await getRegConfig(c.env.KV);
  const updated: RegConfig = { ...current, ...result.data };
  await c.env.KV.put(REG_CONFIG_KEY, JSON.stringify(updated));

  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'admin.config_change',
    resourceType: 'registration',
    details: { before: current, after: updated },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  const adminId = c.get('userId')!;

  if (current.open !== updated.open) {
    sendNotification(c, {
      userId: adminId,
      type: updated.open ? 'registration_opened' : 'registration_closed',
      title: updated.open ? '注册已开放' : '注册已关闭',
      body: updated.open ? '系统已开放新用户注册' : '系统已关闭新用户注册',
      data: { changedBy: adminId },
    });
  }

  if (current.requireInviteCode !== updated.requireInviteCode) {
    sendNotification(c, {
      userId: adminId,
      type: updated.requireInviteCode ? 'invite_registration_opened' : 'invite_registration_closed',
      title: updated.requireInviteCode ? '邀请码注册已开放' : '邀请码注册已关闭',
      body: updated.requireInviteCode ? '系统已开放邀请码注册' : '系统已关闭邀请码注册',
      data: { changedBy: adminId },
    });
  }

  return c.json({ success: true, data: updated });
});

// ── POST /api/admin/registration/codes ────────────────────────────────────

app.post('/registration/codes', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(50, Number(body.count) || 1));

  const codes: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    await c.env.KV.put(`${INVITE_PREFIX}${code}`, JSON.stringify({ usedBy: null, createdAt: now }), {
      expirationTtl: 60 * 60 * 24 * 30,
    });
    codes.push(code);
  }

  await createAuditLog({
    env: c.env,
    userId: c.get('userId')!,
    action: 'admin.invite_code_create',
    resourceType: 'system',
    details: { count },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  sendNotification(c, {
    userId: c.get('userId')!,
    type: 'invite_code_created',
    title: '邀请码已生成',
    body: `已生成 ${count} 个邀请码`,
    data: { count, codes },
  });

  return c.json({ success: true, data: { codes, createdAt: now } });
});

// ── DELETE /api/admin/registration/codes/:code ────────────────────────────

app.delete('/registration/codes/:code', async (c) => {
  const code = c.req.param('code');
  await c.env.KV.delete(`${INVITE_PREFIX}${code}`);

  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'admin.invite_code_revoke',
    resourceType: 'invite_code',
    details: { code },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '邀请码已撤销' } });
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────

app.get('/stats', async (c) => {
  const db = getDb(c.env.DB);

  const allUsers = await db.select().from(users).all();
  const allFiles = await db.select().from(files).where(isNull(files.deletedAt)).all();
  const allBuckets = await db.select().from(storageBuckets).all();

  const totalStorage = allFiles.filter((f) => !f.isFolder).reduce((sum, f) => sum + f.size, 0);
  const totalQuota = allUsers.reduce((sum, u) => sum + (u.storageQuota ?? 0), 0);

  const providerBreakdown: Record<string, { bucketCount: number; storageUsed: number }> = {};
  for (const b of allBuckets) {
    if (!providerBreakdown[b.provider]) {
      providerBreakdown[b.provider] = { bucketCount: 0, storageUsed: 0 };
    }
    providerBreakdown[b.provider].bucketCount++;
    providerBreakdown[b.provider].storageUsed += b.storageUsed ?? 0;
  }

  return c.json({
    success: true,
    data: {
      userCount: allUsers.length,
      adminCount: allUsers.filter((u) => u.role === 'admin').length,
      fileCount: allFiles.filter((f) => !f.isFolder).length,
      folderCount: allFiles.filter((f) => f.isFolder).length,
      bucketCount: allBuckets.length,
      totalStorageUsed: totalStorage,
      totalStorageQuota: totalQuota,
      providerBreakdown,
    },
  });
});

// ── GET /api/admin/audit-logs ─────────────────────────────────────────────

app.get('/audit-logs', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const userId = c.req.query('userId');
  const action = c.req.query('action');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const resourceType = c.req.query('resourceType');

  const db = getDb(c.env.DB);

  const conditions: any[] = [];
  if (userId) conditions.push(eq(auditLogs.userId, userId));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
  if (startDate) conditions.push(gte(auditLogs.createdAt, startDate));
  if (endDate) conditions.push(lte(auditLogs.createdAt, endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause)
      .get(),
  ]);

  const total = countResult?.count ?? 0;

  const enrichedItems = await Promise.all(
    items.map(async (log) => {
      let userEmail = null;
      if (log.userId) {
        const user = await db.select({ email: users.email }).from(users).where(eq(users.id, log.userId)).get();
        userEmail = user?.email ?? null;
      }
      return {
        ...log,
        userEmail,
      };
    })
  );

  return c.json({
    success: true,
    data: {
      items: enrichedItems,
      total,
      page,
      limit,
    },
  });
});

// ── Helper ────────────────────────────────────────────────────────────────

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}`;
}

// ── Email Configuration ───────────────────────────────────────────────────

const emailConfigSchema = z.object({
  apiKey: z.string().min(1, 'API Key不能为空'),
  fromAddress: z.string().email('发件人地址格式不正确'),
  fromName: z.string().min(1, '发件人名称不能为空'),
});

const emailTestSchema = z.object({
  to: z.string().email('收件人地址格式不正确').optional(),
});

const emailBroadcastSchema = z.object({
  subject: z.string().min(1, '邮件主题不能为空'),
  body: z.string().min(1, '邮件内容不能为空'),
  userFilter: z
    .object({
      role: z.enum(['admin', 'user']).optional(),
      active: z.boolean().optional(),
    })
    .optional(),
});

app.get('/email/config', async (c) => {
  const configStr = await c.env.KV.get('config:resend');
  if (!configStr) {
    return c.json({ success: true, data: null });
  }

  const config = JSON.parse(configStr) as { apiKey: string; fromAddress: string; fromName: string };
  const maskedApiKey = `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`;

  return c.json({
    success: true,
    data: {
      apiKey: maskedApiKey,
      fromAddress: config.fromAddress,
      fromName: config.fromName,
      configured: true,
    },
  });
});

app.put('/email/config', async (c) => {
  const body = await c.req.json();
  const result = emailConfigSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { apiKey, fromAddress, fromName } = result.data;

  await c.env.KV.put('config:resend', JSON.stringify({ apiKey, fromAddress, fromName }));

  await createAuditLog({
    env: c.env,
    userId: c.get('userId')!,
    action: 'admin.email_config_update',
    resourceType: 'system',
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '邮件配置已保存' } });
});

app.post('/email/test', async (c) => {
  const body = await c.req.json();
  const result = emailTestSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const to = result.data.to || user.email;

  const configStr = await c.env.KV.get('config:resend');
  if (!configStr) {
    return c.json({ success: false, error: { code: 'EMAIL_NOT_CONFIGURED', message: '邮件服务未配置' } }, 500);
  }

  const config = JSON.parse(configStr) as { apiKey: string; fromAddress: string; fromName: string };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${config.fromName} <${config.fromAddress}>`,
        to,
        subject: 'OSSShelf 测试邮件',
        html: `
          <div style="padding: 20px; font-family: sans-serif;">
            <h2>测试邮件</h2>
            <p>这是一封来自 OSSShelf 的测试邮件。</p>
            <p>如果您收到此邮件，说明邮件服务配置成功！</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      logger.error('ADMIN', 'Resend API错误', { status: res.status, error });
      return c.json(
        { success: false, error: { code: 'EMAIL_SEND_FAILED', message: `邮件发送失败: ${res.status}` } },
        500
      );
    }

    await createAuditLog({
      env: c.env,
      userId,
      action: 'admin.email_test',
      resourceType: 'system',
      details: { to },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json({ success: true, data: { message: `测试邮件已发送到 ${to}` } });
  } catch (error) {
    logger.error('ADMIN', '邮件测试失败', {}, error);
    return c.json({ success: false, error: { code: 'EMAIL_SEND_FAILED', message: '邮件发送失败' } }, 500);
  }
});

app.post('/email/broadcast', async (c) => {
  const body = await c.req.json();
  const result = emailBroadcastSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { subject, body: emailBody, userFilter } = result.data;

  const configStr = await c.env.KV.get('config:resend');
  if (!configStr) {
    return c.json({ success: false, error: { code: 'EMAIL_NOT_CONFIGURED', message: '邮件服务未配置' } }, 500);
  }

  const config = JSON.parse(configStr) as { apiKey: string; fromAddress: string; fromName: string };
  const db = getDb(c.env.DB);

  const conditions = [];
  if (userFilter?.role) {
    conditions.push(eq(users.role, userFilter.role));
  }
  if (userFilter?.active !== undefined) {
    conditions.push(eq(users.role, 'user'));
  }

  const allUsers =
    conditions.length > 0
      ? await db
          .select()
          .from(users)
          .where(and(...conditions))
          .all()
      : await db.select().from(users).all();

  const batchSize = 100;
  const batches = [];
  for (let i = 0; i < allUsers.length; i += batchSize) {
    batches.push(allUsers.slice(i, i + batchSize));
  }

  let successCount = 0;
  let failCount = 0;

  for (const batch of batches) {
    const promises = batch.map(async (user) => {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${config.fromName} <${config.fromAddress}>`,
            to: user.email,
            subject,
            html: `
              <div style="padding: 20px; font-family: sans-serif;">
                <p>您好，${user.name || user.email}！</p>
                <div style="margin: 20px 0;">${emailBody}</div>
              </div>
            `,
          }),
        });

        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    });

    await Promise.all(promises);

    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  await createAuditLog({
    env: c.env,
    userId: c.get('userId')!,
    action: 'admin.email_broadcast',
    resourceType: 'system',
    details: { subject, total: allUsers.length, successCount, failCount },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: {
      message: `群发完成：成功 ${successCount} 封，失败 ${failCount} 封`,
      total: allUsers.length,
      successCount,
      failCount,
    },
  });
});

export default app;
