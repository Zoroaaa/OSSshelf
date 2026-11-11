#!/usr/bin/env node
/**
 * generate-wrangler.mjs
 *
 * 生成 apps/api/wrangler.toml。
 *
 * 为什么需要脚本而不是入库配置：
 * - D1 / KV 的 id 属于环境标识，现在放在部署环境变量里，不写进仓库；
 * - GitHub Actions（迁移后触发部署）与 Workers Builds（执行构建部署）
 *   必须使用同一份模板，否则两边配置会漂移。
 *
 * 必需环境变量：
 *   CLOUDFLARE_D1_DATABASE_ID、CLOUDFLARE_KV_NAMESPACE_ID
 * 可选环境变量：
 *   WORKER_NAME（默认 ossshelf-api，禁止随意修改：改名会重建 DO 命名空间）
 *   ENVIRONMENT、PUBLIC_URL、CORS_ORIGINS、TRASH_RETENTION_DAYS、
 *   ALERT_TG_CHAT_ID、CF_ACCOUNT_ID
 *
 * 密钥（JWT_SECRET / ALERT_TG_BOT_TOKEN / CF_API_TOKEN）不在此文件，走 secret 配置。
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const d1Id = env.CLOUDFLARE_D1_DATABASE_ID;
const kvId = env.CLOUDFLARE_KV_NAMESPACE_ID;
const missing = [
  ['CLOUDFLARE_D1_DATABASE_ID', d1Id],
  ['CLOUDFLARE_KV_NAMESPACE_ID', kvId],
].filter(([, value]) => !value);

if (missing.length > 0) {
  console.error(`[generate-wrangler] 缺少环境变量：${missing.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

/** TOML 字符串值转义，避免 URL 中的引号破坏配置 */
const q = (value) =>
  `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;

const toml = `# 由 scripts/generate-wrangler.mjs 生成，请勿手工编辑
name = ${q(env.WORKER_NAME || 'ossshelf-api')}
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]
upload_source_maps = true

# 前端 SPA 由同一 Worker 承载。
# run_worker_first 必须显式列出后端路径：否则浏览器直接访问 /api/... 时
# 会被 SPA 回退成 index.html（静态资源导航请求回退的陷阱）。
[assets]
directory = "../web/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api", "/api/*", "/dav", "/dav/*", "/agents", "/agents/*", "/cron", "/cron/*", "/health"]

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "ossshelf-files"

[[durable_objects.bindings]]
name = "OSSShelfAgent"
class_name = "OSSShelfAgent"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["OSSShelfAgent"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = ${q(d1Id)}

[[kv_namespaces]]
binding = "KV"
id = ${q(kvId)}

[[queues.producers]]
queue = "ossshelf-ai-tasks"
binding = "AI_TASKS_QUEUE"

[[queues.consumers]]
queue = "ossshelf-ai-tasks"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 6
retry_delay = 60
max_concurrency = 10

[observability]
enabled = false
head_sampling_rate = 1

[observability.logs]
enabled = true
head_sampling_rate = 1
persist = true
invocation_logs = true

[vars]
ENVIRONMENT = ${q(env.ENVIRONMENT || 'production')}
PUBLIC_URL = ${q(env.PUBLIC_URL || '')}
CORS_ORIGINS = ${q(env.CORS_ORIGINS || '')}
TRASH_RETENTION_DAYS = ${q(env.TRASH_RETENTION_DAYS || '30')}
ALERT_TG_CHAT_ID = ${q(env.ALERT_TG_CHAT_ID || '')}
CF_ACCOUNT_ID = ${q(env.CF_ACCOUNT_ID || '')}

[triggers]
crons = ["0 3 * * *"]
`;

const outFile = resolve(rootDir, 'apps/api/wrangler.toml');
writeFileSync(outFile, toml, 'utf8');
console.log(`[generate-wrangler] 已生成 ${outFile}`);
