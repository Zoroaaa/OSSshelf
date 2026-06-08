/**
 * docs.ts
 * 统一 API 文档路由（Scalar UI）— 基于路由自省自动生成
 *
 * 核心设计:
 * - 从运行中的 Hono app 实例自动提取所有已注册路由（app.routes）
 * - 生成 OpenAPI 3.1.0 spec 骨架，无需手动维护路由列表
 * - 通过 routeMetadata 补充人类友好的 tag/summary/description
 * - 使用 Scalar 渲染器展示交互式文档
 *
 * 唯一性保证:
 * - 不存在 v1 冗余副本，所有文档来源于实际运行的业务路由
 * - 新增任何路由后只需在 metadata 中补充说明（可选），spec 自动更新
 */

import { Hono } from 'hono';
import { Scalar } from '@scalar/hono-api-reference';
import type { Env } from '../types/env';
import type { RouterRoute } from 'hono/types';

// ═════════════════════════════════════════════════════════════════════════════
// 路由元数据 — 为自动发现的路由补充 tag/summary/description
// key 格式: "METHOD /path" （全小写）
// 未匹配的路由仍会出现在文档中，但只有路径没有描述
// ═════════════════════════════════════════════════════════════════════════════

interface RouteMeta {
  summary: string;
  description?: string;
  tags: string[];
  // 是否需要认证（影响 security 标记）
  auth?: boolean;
}

const routeMetadata: Record<string, RouteMeta> = {
  // ── Auth ──────────────────────────────────────────────
  'post /auth/register':           { summary: '用户注册', tags: ['Auth'], auth: false },
  'post /auth/login':              { summary: '用户登录', tags: ['Auth'], auth: false },
  'get  /auth/registration-config': { summary: '获取注册配置', tags: ['Auth'], auth: false },
  'get  /auth/me':                 { summary: '获取当前用户信息', tags: ['Auth'] },
  'patch /auth/me':               { summary: '更新用户信息', tags: ['Auth'] },
  'delete /auth/me':              { summary: '注销账户', tags: ['Auth'] },
  'post /auth/logout':            { summary: '用户登出', tags: ['Auth'] },
  'post /auth/refresh':           { summary: '刷新 JWT Token', tags: ['Auth'] },
  'get  /auth/devices':           { summary: '获取已登录设备列表', tags: ['Auth'] },
  'delete /auth/devices/:id':     { summary: '注销设备', tags: ['Auth'] },
  'post /auth/forgot-password':   { summary: '申请密码重置', tags: ['Auth'], auth: false },
  'post /auth/reset-password':    { summary: '重置密码', tags: ['Auth'], auth: false },
  'post /auth/verify-email':      { summary: '验证邮箱', tags: ['Auth'] },
  'post /auth/resend-verification': { summary: '重发验证邮件', tags: ['Auth'] },
  'get  /auth/stats':             { summary: '获取用户统计信息', tags: ['Auth'] },

  // ── Files ────────────────────────────────────────────
  'get  /files':                  { summary: '列出文件', tags: ['Files'] },
  'post /files':                  { summary: '创建文件夹', tags: ['Files'] },
  'post /files/upload':           { summary: '上传文件（代理模式）', tags: ['Files'] },
  'get  /files/:fileId':          { summary: '获取文件信息', tags: ['Files'] },
  'put  /files/:fileId':          { summary: '更新文件/文件夹', tags: ['Files'] },
  'delete /files/:fileId':        { summary: '删除文件/文件夹（移至回收站）', tags: ['Files'] },
  'get  /files/:fileId/detail':   { summary: '获取文件详情（含 AI 信息和统计）', tags: ['Files'] },
  'get  /files/:fileId/download': { summary: '下载文件', tags: ['Files'] },
  'get  /files/:fileId/preview':  { summary: '文件预览', tags: ['Files'] },
  'post /files/:fileId/star':    { summary: '收藏文件', tags: ['Files'] },
  'delete /files/:fileId/star':  { summary: '取消收藏', tags: ['Files'] },
  'post /files/:fileId/move':    { summary: '移动文件', tags: ['Files'] },
  'get  /files/trash':            { summary: '列出回收站文件', tags: ['Files'] },
  'delete /files/trash':          { summary: '清空回收站', tags: ['Files'] },
  'post /files/trash/:fileId/restore': { summary: '恢复文件', tags: ['Files'] },

  // ── Buckets ──────────────────────────────────────────
  'get  /buckets':                { summary: '列出存储桶', tags: ['Buckets'] },
  'post /buckets':                { summary: '创建存储桶', tags: ['Buckets'] },
  'get  /buckets/providers':       { summary: '获取支持的存储提供商列表', tags: ['Buckets'] },
  'get  /buckets/:bucketId':      { summary: '获取单个存储桶', tags: ['Buckets'] },
  'put  /buckets/:bucketId':      { summary: '更新存储桶', tags: ['Buckets'] },
  'delete /buckets/:bucketId':    { summary: '删除存储桶', tags: ['Buckets'] },

  // ── Share ───────────────────────────────────────────
  'get  /share':                  { summary: '列出我的分享', tags: ['Share'] },
  'post /share':                  { summary: '创建下载分享', tags: ['Share'] },
  'post /share/upload-link':      { summary: '创建上传链接', tags: ['Share'] },
  'get  /share/:shareId':         { summary: '获取分享信息（公开）', tags: ['Share'], auth: false },
  'delete /share/:shareId':       { summary: '删除分享', tags: ['Share'] },

  // ── Direct Link ─────────────────────────────────────
  'post /direct':                 { summary: '创建直链', tags: ['DirectLink'] },
  'get  /direct/:token':          { summary: '通过直链下载文件（公开）', tags: ['DirectLink'], auth: false },

  // ── Presign ─────────────────────────────────────────
  'post /presign/upload':         { summary: '获取上传预签名 URL', tags: ['Presign'] },
  'get  /presign/download/:fileId': { summary: '获取下载预签名 URL', tags: ['Presign'] },

  // ── Search ──────────────────────────────────────────
  'get  /search':                 { summary: '搜索文件', tags: ['Search'] },
  'post /search':                 { summary: '高级搜索（多条件组合）', tags: ['Search'] },

  // ── Batch ───────────────────────────────────────────
  'post /batch/delete':           { summary: '批量删除', tags: ['Batch'] },
  'post /batch/move':             { summary: '批量移动', tags: ['Batch'] },
  'post /batch/copy':             { summary: '批量复制', tags: ['Batch'] },
  'post /batch/rename':           { summary: '批量重命名', tags: ['Batch'] },

  // ── Permissions ─────────────────────────────────────
  'get  /permissions/all':        { summary: '获取所有权限列表', tags: ['Permissions'] },
  'get  /permissions/users/search': { summary: '搜索用户', tags: ['Permissions'] },
  'get  /permissions/tags/user':  { summary: '获取用户标签', tags: ['Permissions'] },
  'post /permissions/grant':      { summary: '授予权限', tags: ['Permissions'] },
  'post /permissions/revoke':     { summary: '撤销权限', tags: ['Permissions'] },
  'get  /permissions/file/:fileId': { summary: '获取文件权限', tags: ['Permissions'] },
  'get  /permissions/check/:fileId': { summary: '检查文件权限', tags: ['Permissions'] },
  'get  /permissions/resolve/:fileId': { summary: '解析有效权限', tags: ['Permissions'] },
  'patch /permissions/:permissionId': { summary: '更新权限', tags: ['Permissions'] },
  'delete /permissions/:permissionId': { summary: '删除权限', tags: ['Permissions'] },
  'post /permissions/requests':   { summary: '发起权限申请 (v5.0)', tags: ['Permissions'] },
  'get  /permissions/requests/my': { summary: '我的权限申请 (v5.0)', tags: ['Permissions'] },
  'get  /permissions/requests/pending': { summary: '待审批的申请 (v5.0)', tags: ['Permissions'] },
  'put  /permissions/requests/:id/review': { summary: '审批权限申请 (v5.0)', tags: ['Permissions'] },
  'post /permissions/batch-grant': { summary: '批量授权 (v5.0)', tags: ['Permissions'] },
  'post /permissions/batch-revoke':{ summary: '批量撤销 (v5.0)', tags: ['Permissions'] },
  'get  /roles/templates':        { summary: '获取角色模板列表 (v5.0)', tags: ['Permissions'] },

  // ── Groups ──────────────────────────────────────────
  'get  /groups':                 { summary: '获取用户组列表', tags: ['Groups'] },
  'post /groups':                 { summary: '创建用户组', tags: ['Groups'] },
  'get  /groups/:groupId':        { summary: '获取用户组详情', tags: ['Groups'] },
  'put  /groups/:groupId':        { summary: '更新用户组', tags: ['Groups'] },
  'delete /groups/:groupId':      { summary: '删除用户组', tags: ['Groups'] },
  'get  /groups/:groupId/members': { summary: '获取组成员', tags: ['Groups'] },
  'post /groups/:groupId/members': { summary: '添加组成员', tags: ['Groups'] },
  'delete /groups/:groupId/members/:userId': { summary: '移除组成员', tags: ['Groups'] },

  // ── Teams (v5.0) ───────────────────────────────────
  'get  /teams':                  { summary: '获取团队列表', tags: ['Teams'] },
  'post /teams':                  { summary: '创建团队', tags: ['Teams'] },
  'get  /teams/:teamId':          { summary: '获取团队详情', tags: ['Teams'] },
  'put  /teams/:teamId':          { summary: '更新团队信息', tags: ['Teams'] },
  'delete /teams/:teamId':        { summary: '删除团队', tags: ['Teams'] },
  'get  /teams/:teamId/members':  { summary: '列出团队成员', tags: ['Teams'] },
  'post /teams/:teamId/members':  { summary: '添加团队成员', tags: ['Teams'] },
  'delete /teams/:teamId/members/:memberUserId': { summary: '移除成员', tags: ['Teams'] },
  'put  /teams/:teamId/members/:memberUserId/role': { summary: '变更角色', tags: ['Teams'] },
  'post /teams/:teamId/resources': { summary: '挂载资源到团队', tags: ['Teams'] },
  'delete /teams/:teamId/resources/:fileId': { summary: '卸载资源', tags: ['Teams'] },
  'get  /teams/:teamId/resources/list': { summary: '列出团队资源', tags: ['Teams'] },

  // ── Webhooks ────────────────────────────────────────
  'get  /webhooks':               { summary: '获取 Webhook 列表', tags: ['Webhooks'] },
  'post /webhooks':               { summary: '创建 Webhook', tags: ['Webhooks'] },
  'get  /webhooks/:webhookId':    { summary: '获取 Webhook 详情', tags: ['Webhooks'] },
  'put  /webhooks/:webhookId':    { summary: '更新 Webhook', tags: ['Webhooks'] },
  'delete /webhooks/:webhookId':  { summary: '删除 Webhook', tags: ['Webhooks'] },

  // ── Tasks ───────────────────────────────────────────
  'post /tasks/create':           { summary: '创建上传任务', tags: ['Tasks'] },
  'get  /tasks/list':             { summary: '列出上传任务', tags: ['Tasks'] },

  // ── Downloads ───────────────────────────────────────
  'post /downloads/create':       { summary: '创建离线下载任务', tags: ['Downloads'] },
  'get  /downloads/list':         { summary: '列出下载任务', tags: ['Downloads'] },

  // ── Preview ─────────────────────────────────────────
  'get  /preview/:fileId/info':   { summary: '获取预览信息', tags: ['Preview'] },
  'get  /preview/:fileId/thumbnail': { summary: '获取缩略图', tags: ['Preview'] },

  // ── Versions ────────────────────────────────────────
  'get  /versions/file/:fileId':  { summary: '获取文件版本列表', tags: ['Versions'] },
  'post /versions/create':        { summary: '创建新版本', tags: ['Versions'] },
  'get  /versions/:versionId':   { summary: '获取版本内容', tags: ['Versions'] },
  'delete /versions/:versionId':  { summary: '删除版本', tags: ['Versions'] },

  // ── Notes ───────────────────────────────────────────
  'get  /notes/file/:fileId':    { summary: '获取文件笔记列表', tags: ['Notes'] },
  'post /notes':                  { summary: '创建笔记', tags: ['Notes'] },
  'delete /notes/:noteId':        { summary: '删除笔记', tags: ['Notes'] },

  // ── API Keys ────────────────────────────────────────
  'get  /api-keys':               { summary: '获取 API Key 列表', tags: ['ApiKeys'] },
  'post /api-keys':               { summary: '创建 API Key', tags: ['ApiKeys'] },
  'delete /api-keys/:keyId':      { summary: '撤销 API Key', tags: ['ApiKeys'] },

  // ── Analytics ───────────────────────────────────────
  'get  /analytics/storage-breakdown': { summary: '获取存储空间分布', tags: ['Analytics'] },
  'get  /analytics/activity-heatmap':  { summary: '获取活跃度热力图', tags: ['Analytics'] },
  'get  /analytics/large-files':     { summary: '大文件排行', tags: ['Analytics'] },
  'get  /analytics/type-distribution': { summary: '文件类型分布', tags: ['Analytics'] },

  // ── Notifications ───────────────────────────────────
  'get  /notifications':           { summary: '获取通知列表', tags: ['Notifications'] },
  'put  /notifications/read-all': { summary: '全部标记已读', tags: ['Notifications'] },

  // ── Admin ───────────────────────────────────────────
  'get  /admin/users':            { summary: '获取用户列表（需 admin 角色）', tags: ['Admin'] },
  'patch /admin/users/:userId':   { summary: '更新用户（需 admin 角色）', tags: ['Admin'] },
  'delete /admin/users/:userId':  { summary: '删除用户（需 admin 角色）', tags: ['Admin'] },
  'get  /admin/stats':            { summary: '获取系统统计', tags: ['Admin'] },
  'post /admin/invite-code':      { summary: '生成邀请码', tags: ['Admin'] },
  'get  /admin/audit-log':        { summary: '审计日志', tags: ['Admin'] },
  'post /admin/mail/config':      { summary: '配置邮件服务', tags: ['Admin'] },
  'post /admin/mail/test':        { summary: '发送测试邮件', tags: ['Admin'] },
  'post /admin/mail/broadcast':  { summary: '群发系统公告', tags: ['Admin'] },
  'get  /admin/mail/status':      { summary: '查询邮件服务状态', tags: ['Admin'] },

  // ── AI ──────────────────────────────────────────────
  'post /ai':                     { summary: 'AI 文件处理（摘要/标签/索引）', tags: ['AI'] },

  // ── AI Config ──────────────────────────────────────
  'get  /ai-config/models':       { summary: '获取可用模型列表', tags: ['AI'] },
  'get  /ai-config/settings':     { summary: '获取 AI 设置', tags: ['AI'] },
  'put  /ai-config/settings':     { summary: '更新 AI 设置', tags: ['AI'] },
  'post /ai-config/provider/default': { summary: '设置默认提供商', tags: ['AI'] },

  // ── AI Chat ────────────────────────────────────────
  'post /ai-chat/chat':           { summary: '发送 AI 对话消息', tags: ['AI'] },
  'get  /ai-chat/conversations':  { summary: '获取对话列表', tags: ['AI'] },
  'get  /ai-chat/conversations/:convId': { summary: '获取对话详情', tags: ['AI'] },
  'delete /ai-chat/conversations/:convId': { summary: '删除对话', tags: ['AI'] },
  'post /ai-chat/generate-title': { summary: '生成对话标题', tags: ['AI'] },

  // ── Telegram ────────────────────────────────────────
  'post /telegram/test':           { summary: '测试 Telegram Bot 连接', tags: ['Telegram'] },

  // ── Migrate ─────────────────────────────────────────
  'post /migrate/start':          { summary: '启动迁移任务', tags: ['Migrate'] },
  'get  /migrate/tasks':          { summary: '查询迁移任务状态', tags: ['Migrate'] },

  // ── Health ──────────────────────────────────────────
  'get  /health':                 { summary: '健康检查', tags: ['Health'], auth: false },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tag 定义 — 用于 OpenAPI spec 的 tags 数组和侧边栏分组
// ═════════════════════════════════════════════════════════════════════════════

const tagDefinitions = [
  { name: 'Auth', description: '用户认证 — 注册、登录、JWT 管理、设备管理、邮箱验证' },
  { name: 'Files', description: '文件管理 — CRUD、上传下载、预览、收藏、回收站' },
  { name: 'Buckets', description: '存储桶管理 — 多厂商存储后端（R2/S3/OSS/COS/OBS/B2/MinIO/Telegram）' },
  { name: 'Share', description: '分享管理 — 下载分享、上传链接、密码保护、过期时间' },
  { name: 'DirectLink', description: '文件直链 — 公开访问链接生成与管理' },
  { name: 'Presign', description: '预签名上传 — 直传、分片上传、预签名下载 URL' },
  { name: 'Search', description: '搜索 — 关键词搜索、FTS5 全文搜索、语义搜索、高级条件组合' },
  { name: 'Batch', description: '批量操作 — 批量删除/移动/复制/重命名/恢复' },
  { name: 'Permissions', description: '权限与标签 — 文件授权(用户/组/团队)、角色模板、权限申请/审批流(v5.0)' },
  { name: 'Groups', description: '用户组 — 组管理与批量授权' },
  { name: 'Teams', description: '团队协作 (v5.0) — 团队空间、成员管理、资源挂载、四级角色体系' },
  { name: 'Webhooks', description: 'Webhook — 事件订阅与第三方系统集成' },
  { name: 'Tasks', description: '上传任务 — 分片上传任务管理与进度追踪' },
  { name: 'Downloads', description: '离线下载 — URL 离线下载到云存储' },
  { name: 'Preview', description: '预览 — 多格式在线预览（图片/视频/PDF/Office/代码/EPUB 等）' },
  { name: 'Versions', description: '版本控制 — 文本文件历史版本管理与对比回滚' },
  { name: 'Notes', description: '文件笔记 — 评论、@提及、嵌套回复' },
  { name: 'ApiKeys', description: 'API Keys — 程序化访问密钥管理与细粒度权限控制' },
  { name: 'Analytics', description: '存储分析 — 存储分布、活跃度热力图、大文件排行、类型分布' },
  { name: 'Notifications', description: '通知系统 — 实时通知推送与消息中心' },
  { name: 'Admin', description: '管理员接口 — 用户管理、系统配置、审计日志、邮件服务、邀请码' },
  { name: 'AI', description: 'AI 功能 — 文件摘要、智能标签、语义搜索、Agent 对话引擎' },
  { name: 'Telegram', description: 'Telegram 集成 — Bot 连接测试与存储' },
  { name: 'Migrate', description: '存储迁移 — 跨存储桶数据迁移与进度追踪' },
  { name: 'Health', description: '健康检查 — 服务状态探针' },
];

// ═════════════════════════════════════════════════════════════════════════════
// 核心：从 Hono app 实例生成 OpenAPI spec
// ═════════════════════════════════════════════════════════════════════════════

function buildOpenApiSpec(appRoutes: RouterRoute[]) {
  const paths: Record<string, unknown> = {};

  for (const route of appRoutes) {
    // 路由格式: { method: string, path: string }
    const method = route.method.toLowerCase(); // get/post/put/delete/patch...
    const path = normalizePath(route.path);
    const key = `${method} ${path}`;

    const meta = routeMetadata[key];
    if (!meta) continue; // 未定义元数据的路由跳过（内部路由等）

    if (!paths[path]) {
      paths[path] = {};
    }

    const operation: Record<string, unknown> = {
      summary: meta.summary,
      tags: meta.tags,
      ...(meta.description && { description: meta.description }),
      ...(meta.auth !== false && {
        security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
      }),
      responses: {
        200: { description: '操作成功' },
        401: { description: '未认证' },
        403: { description: '无权限' },
        500: { description: '服务器错误' },
      },
    };

    (paths[path] as Record<string, unknown>)[method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'OSSshelf API',
      version: '5.0.0',
      description: `
OSSshelf 对象存储管理平台 RESTful API 文档

## 认证方式

| 方式 | 说明 |
|------|------|
| **Bearer Token (JWT)** | 大多数 API 使用此方式。登录后从响应中获取 |
| **API Key** | 程序化访问推荐（v4.0+）。通过 Header \`X-API-Key\` 传递 |

\\\`\\\
Authorization: Bearer <jwt-token>
X-API-Key: osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\\\`\\\`

## 统一响应格式

**成功**: \\\`{ "success": true, "data": {...} }\\\`
**错误**: \\\`{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }\\\`

> 本文档由运行中的业务路由自动生成，确保与实际 API 完全一致。
`,
      contact: { name: 'OSSshelf Team' },
    },
    servers: [{ url: '/api', description: '本地开发 / 生产环境' }],
    tags: tagDefinitions,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Bearer Token 认证（登录/注册时返回）',
        },
        apiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key 认证（程序化访问，管理员面板创建）',
        },
      },
    },
  };
}

/** 将 :param 格式的路径参数转为 OpenAPI 的 {param} 格式 */
function normalizePath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

// ═════════════════════════════════════════════════════════════════════════════
// 导出：创建带文档的路由
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 创建文档路由工厂函数
 * 在所有业务路由注册完成后调用，传入主 app 实例以提取路由
 */
export function createDocsRoutes(mainApp: Hono<{ Bindings: Env }>) {
  const app = new Hono<{ Bindings: Env }>();

  // 从主 app 提取路由并生成 spec
  const routes = mainApp.routes as RouterRoute[];
  const spec = buildOpenApiSpec(routes);

  app.get(
    '/docs',
    Scalar({
      pageTitle: 'OSSshelf API 文档',
      spec: { content: spec as Record<string, unknown> },
      theme: 'purple',
      isEditable: false,
      hideDownloadButton: true,
      layout: 'classic',
      searchHotKey: 'k',
    })
  );

  // 同时提供 raw JSON（供工具集成）
  app.get('/openapi.json', (c) => c.json(spec));

  return app;
}
