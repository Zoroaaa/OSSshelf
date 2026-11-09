#!/usr/bin/env node
/**
 * encrypt-plaintext-secrets.mjs
 * 一次性迁移：把 ai_providers 中历史上以明文保存的 API Key 重新用 AES-GCM 加密。
 *
 * 特性：
 * - 迁移前自动备份（含原值，供回滚；文件仅保存在本地，切勿提交）
 * - 支持 --dry-run：只生成备份与 SQL，不写库
 * - 支持 --rollback <backup.json>：按备份原值回滚
 * - 已加密的行会被跳过（以能否用 JWT_SECRET 成功解密为准）
 *
 * 加密格式与 src/lib/crypto.ts 完全一致：
 *   base64( iv(12B) || AES-GCM(ciphertext + tag) )，密钥 = SHA-256(JWT_SECRET)
 *
 * 用法：
 *   JWT_SECRET=xxx node scripts/encrypt-plaintext-secrets.mjs --remote
 *   JWT_SECRET=xxx node scripts/encrypt-plaintext-secrets.mjs --local
 *   JWT_SECRET=xxx node scripts/encrypt-plaintext-secrets.mjs --remote --dry-run
 *   node scripts/encrypt-plaintext-secrets.mjs --remote --rollback backups/ai-provider-keys-xxx.json
 *
 * 依赖：已登录的 wrangler（或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const TABLE = 'ai_providers';
const COLUMN = 'api_key_encrypted';

function parseArgs(argv) {
  const args = { db: 'ossshelf-db', remote: false, local: false, dryRun: false, rollback: null, backup: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--remote') args.remote = true;
    else if (arg === '--local') args.local = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--rollback') args.rollback = argv[++i];
    else if (arg === '--backup') args.backup = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.remote && !args.local) args.remote = true;
  return args;
}

function printUsage() {
  console.log(`用法:
  JWT_SECRET=xxx node scripts/encrypt-plaintext-secrets.mjs [--remote|--local] [--db ossshelf-db] [--dry-run] [--backup path]
  node scripts/encrypt-plaintext-secrets.mjs [--remote|--local] --rollback <backup.json>`);
}

function runWrangler(args) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return execFileSync(command, ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function targetFlags(args) {
  return [args.local ? '--local' : '--remote'];
}

function queryRows(args) {
  const sql = `SELECT id, user_id, ${COLUMN} AS value FROM ${TABLE} WHERE ${COLUMN} IS NOT NULL AND ${COLUMN} != '';`;
  const raw = runWrangler(['d1', 'execute', args.db, ...targetFlags(args), '--json', '--command', sql]);
  const parsed = JSON.parse(raw);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return Array.isArray(first?.results) ? first.results : [];
}

function executeSqlFile(args, file) {
  runWrangler(['d1', 'execute', args.db, ...targetFlags(args), '--file', file]);
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function importAesKey(secret) {
  const keyData = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return globalThis.crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptValue(secret, plaintext) {
  const key = await importAesKey(secret);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH },
    key,
    new TextEncoder().encode(plaintext)
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString('base64');
}

async function tryDecrypt(secret, value) {
  try {
    const combined = Uint8Array.from(Buffer.from(value, 'base64'));
    if (combined.length <= IV_LENGTH + 16) return null;
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);
    const key = await importAesKey(secret);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_LENGTH },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

function buildUpdateSql(rows) {
  const lines = ['BEGIN;'];
  for (const row of rows) {
    lines.push(
      `UPDATE ${TABLE} SET ${COLUMN} = ${sqlString(row.value)} WHERE id = ${sqlString(row.id)};`
    );
  }
  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

async function rollback(args, secret) {
  const backupPath = resolve(args.rollback);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  if (backup.table !== TABLE || backup.column !== COLUMN) {
    throw new Error('备份文件与目标表不匹配');
  }
  if (backup.secretFingerprint && secret && backup.secretFingerprint !== fingerprint(secret)) {
    throw new Error('JWT_SECRET 与备份时不一致，回滚后的密文将无法解密');
  }

  const sqlPath = resolve(`rollback-${Date.now()}.sql`);
  writeFileSync(sqlPath, buildUpdateSql(backup.rows), 'utf8');
  console.log(`已生成回滚 SQL: ${sqlPath}（${backup.rows.length} 行）`);

  if (args.dryRun) {
    console.log('--dry-run：未执行回滚');
    return;
  }

  executeSqlFile(args, sqlPath);
  console.log('回滚完成：原值已写回数据库');
}

function fingerprint(secret) {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

async function migrate(args, secret) {
  const rows = queryRows(args);
  console.log(`共读取 ${rows.length} 条供应商密钥记录`);

  const plaintextRows = [];
  let alreadyEncrypted = 0;

  for (const row of rows) {
    if (!row.value) continue;
    const decrypted = await tryDecrypt(secret, row.value);
    if (decrypted !== null) {
      alreadyEncrypted += 1;
      continue;
    }
    plaintextRows.push({ id: row.id, userId: row.user_id, value: row.value });
  }

  console.log(`已加密: ${alreadyEncrypted} 条，待迁移明文: ${plaintextRows.length} 条`);

  if (plaintextRows.length === 0) {
    console.log('无需迁移');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(args.backup ?? `backups/ai-provider-keys-${timestamp}.json`);
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        table: TABLE,
        column: COLUMN,
        secretFingerprint: fingerprint(secret),
        rows: plaintextRows,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`已备份原值到: ${backupPath}（含明文密钥，请妥善保管且不要提交到仓库）`);

  const updates = [];
  for (const row of plaintextRows) {
    updates.push({ id: row.id, value: await encryptValue(secret, row.value) });
  }

  const sqlPath = resolve(`encrypt-keys-${timestamp}.sql`);
  writeFileSync(sqlPath, buildUpdateSql(updates), 'utf8');
  console.log(`已生成迁移 SQL: ${sqlPath}`);

  if (args.dryRun) {
    console.log('--dry-run：未写入数据库。确认无误后去掉 --dry-run 重新执行。');
    return;
  }

  executeSqlFile(args, sqlPath);

  // 写后校验：逐行解密，确保迁移成功
  const verifyRows = queryRows(args);
  let verified = 0;
  for (const row of verifyRows) {
    if (!updates.some((item) => item.id === row.id)) continue;
    if ((await tryDecrypt(secret, row.value)) !== null) verified += 1;
  }

  if (verified !== updates.length) {
    throw new Error(`校验失败：${verified}/${updates.length} 行可解密，请使用 --rollback ${backupPath} 回滚`);
  }

  console.log(`迁移完成并校验通过：${verified} 条密钥已加密`);
  console.log(`如需回滚：node scripts/encrypt-plaintext-secrets.mjs --rollback "${backupPath}"`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('缺少 JWT_SECRET 环境变量（必须与 Worker 运行时一致）');

  if (args.rollback) {
    await rollback(args, secret);
    return;
  }
  await migrate(args, secret);
}

main().catch((error) => {
  console.error(`执行失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
