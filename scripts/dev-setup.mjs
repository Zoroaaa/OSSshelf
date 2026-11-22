#!/usr/bin/env node
/**
 * 本地开发环境初始化（幂等，可重复执行）
 *
 * 做四件事：
 *   1. 检查 Node 版本（>= 22）
 *   2. 生成 apps/api/.dev.vars（已存在则跳过，不覆盖本地密钥）
 *   3. 构建 @osshelf/shared（API 通过 dist 引用它）
 *   4. 应用 D1 本地迁移（wrangler d1 migrations apply --local）
 *
 * 用法：pnpm dev:setup
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devVarsPath = path.join(root, 'apps/api/.dev.vars');

const log = (step, message) => console.log(`\n\x1b[36m[${step}]\x1b[0m ${message}`);
const ok = (message) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: 'inherit', env: process.env });
}

// 1. Node 版本
log('1/4', '检查 Node 版本');
const major = Number(process.versions.node.split('.')[0]);
if (Number.isNaN(major) || major < 22) {
  console.error(`  \x1b[31m✗\x1b[0m 当前 Node ${process.versions.node}，项目要求 >= 22`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// 2. .dev.vars
log('2/4', '生成本地环境变量 apps/api/.dev.vars');
if (fs.existsSync(devVarsPath)) {
  ok('已存在，跳过（如需重置请手动删除）');
} else {
  const secret = crypto.randomBytes(32).toString('hex');
  const content = [
    '# 本地开发环境变量（不入库，wrangler dev 自动加载）',
    '# JWT 签名密钥：仅用于本地调试，请勿用于生产',
    `JWT_SECRET=${secret}`,
    'ENVIRONMENT=development',
    'PUBLIC_URL=http://localhost:8787',
    'CORS_ORIGINS=http://localhost:3000',
    'TRASH_RETENTION_DAYS=30',
    '',
  ].join('\n');
  fs.writeFileSync(devVarsPath, content, 'utf8');
  ok('已生成（含随机 JWT_SECRET）');
}

// 3. shared 构建
log('3/4', '构建 @osshelf/shared');
run('pnpm --filter @osshelf/shared build');
ok('dist 已更新');

// 4. D1 本地迁移
log('4/4', '应用 D1 本地迁移');
try {
  run('pnpm exec wrangler d1 migrations apply ossshelf-db --local', path.join(root, 'apps/api'));
  ok('本地数据库已就绪（apps/api/.wrangler/state）');
} catch {
  console.error('\n  \x1b[31m✗\x1b[0m D1 迁移失败。');
  console.error('    如果 wrangler dev 正在运行，本地 D1 可能被占用：请先停止它再重试。');
  console.error('    也可手动执行：cd apps/api && pnpm exec wrangler d1 migrations apply ossshelf-db --local\n');
  process.exit(1);
}

console.log(`
\x1b[32m环境准备完成。\x1b[0m

请开两个终端分别启动：

  \x1b[1mpnpm dev:api\x1b[0m     # 后端 http://127.0.0.1:8787
  \x1b[1mpnpm dev:web\x1b[0m     # 前端 http://localhost:3000（监听 127.0.0.1）
  真机局域网调试：pnpm --filter web dev -- --host 0.0.0.0

首次访问 http://localhost:3000/register 注册首个账号（自动成为管理员且邮箱已验证）。
之后可运行冒烟测试：

  \x1b[1mpnpm smoke\x1b[0m

脚本会自动注册/登录测试账号 dev@example.com / dev123456（可用 SMOKE_EMAIL / SMOKE_PASSWORD 覆盖）。
`);
