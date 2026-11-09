#!/usr/bin/env node
/**
 * preflight-migrations.mjs
 *
 * Deploy 前预检：比对 `d1_migrations` 记录与真实 schema，避免“控制台手工执行过迁移、
 * 但历史表没记录”或“历史记录有、对象却不存在”的情况在 CI 里以 SQLite 报错的形式炸开。
 *
 * 检查方式：
 *   1. 解析 apps/api/migrations/*.sql，提取建表/建索引/建触发器/增删列/删除对象；
 *   2. 读取远端（或本地）D1 的 sqlite_master、pragma_table_info 与 d1_migrations；
 *   3. 按迁移顺序模拟 DDL：
 *      - 待执行迁移里出现“不可重复执行”的语句且对象已存在/已缺失 → 报错（会直接失败）；
 *      - 已记录迁移创建的最终对象在库中缺失 → 报错（schema 漂移）；
 *      - 其余情况（IF [NOT] EXISTS、后续被删除、库内额外对象）一律容忍。
 *
 * 用法（必须在 apps/api 目录下执行，wrangler 需要当前目录的 wrangler.toml）：
 *   node scripts/preflight-migrations.mjs --remote
 *   node scripts/preflight-migrations.mjs --local
 *   node scripts/preflight-migrations.mjs --plan          # 只做静态检查，不连数据库
 *   node scripts/preflight-migrations.mjs --remote --json # 机器可读输出
 *
 * 退出码：0 = 通过；1 = 存在会阻塞部署的差异。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 历史库的既知差异白名单。
 * 命中后从“错误”降级为“警告”，不会阻塞部署。
 * 格式：{ migration: '112_xxx.sql', object: 'column:ai_providers.protocol', reason: '说明' }
 */
const KNOWN_DIFFERENCES = [];

const INTERNAL_TABLES = new Set(['d1_migrations']);

function parseArgs(argv) {
  const args = { db: 'ossshelf-db', remote: false, local: false, plan: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--remote') args.remote = true;
    else if (arg === '--local') args.local = true;
    else if (arg === '--plan') args.plan = true;
    else if (arg === '--json') args.json = true;
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
  node scripts/preflight-migrations.mjs [--remote|--local] [--db ossshelf-db] [--json]
  node scripts/preflight-migrations.mjs --plan        # 仅静态检查迁移文件，不连数据库`);
}

function runWrangler(wranglerArgs) {
  // Windows 上 Node 22 无法直接 spawn .cmd（EINVAL），改为用 node 执行本地 wrangler 入口，
  // 同时避免经过 shell 导致 SQL 引号被二次解释。
  const localEntry = resolve('node_modules', 'wrangler', 'bin', 'wrangler.js');
  const [command, prefix] = existsSync(localEntry)
    ? [process.execPath, [localEntry]]
    : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler']];
  return execFileSync(command, [...prefix, ...wranglerArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function query(args, sql) {
  const raw = runWrangler([
    'd1',
    'execute',
    args.db,
    args.local ? '--local' : '--remote',
    '--json',
    '--command',
    sql,
  ]);
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((item) => (Array.isArray(item?.results) ? item.results : []));
}

/** 去掉行尾注释，避免把被注释掉的 DDL 当成真实语句 */
function stripLine(line) {
  return line.replace(/--.*$/, '').trim();
}

function parseMigration(text) {
  const statements = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = stripLine(raw);
    if (!line) return;
    const lineNo = index + 1;
    let m;

    m = /^CREATE\s+(VIRTUAL\s+)?(UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+(IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z_][\w]*)[`"]?/i.exec(
      line
    );
    if (m) {
      statements.push({
        kind: 'create',
        type: m[3].toLowerCase(),
        name: m[5],
        ifNotExists: Boolean(m[4]),
        line: lineNo,
      });
      return;
    }

    m = /^ALTER\s+TABLE\s+[`"]?([A-Za-z_][\w]*)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?([A-Za-z_][\w]*)[`"]?/i.exec(
      line
    );
    if (m) {
      statements.push({ kind: 'addColumn', table: m[1], column: m[2], line: lineNo });
      return;
    }

    m = /^ALTER\s+TABLE\s+[`"]?([A-Za-z_][\w]*)[`"]?\s+DROP\s+COLUMN\s+[`"]?([A-Za-z_][\w]*)[`"]?/i.exec(
      line
    );
    if (m) {
      statements.push({ kind: 'dropColumn', table: m[1], column: m[2], line: lineNo });
      return;
    }

    m = /^ALTER\s+TABLE\s+[`"]?([A-Za-z_][\w]*)[`"]?\s+RENAME\s+TO\s+[`"]?([A-Za-z_][\w]*)[`"]?/i.exec(
      line
    );
    if (m) {
      statements.push({ kind: 'rename', from: m[1], to: m[2], line: lineNo });
      return;
    }

    m = /^DROP\s+(TABLE|INDEX|TRIGGER)\s+(IF\s+EXISTS\s+)?[`"]?([A-Za-z_][\w]*)[`"]?/i.exec(line);
    if (m) {
      statements.push({ kind: 'drop', type: m[1].toLowerCase(), name: m[3], ifExists: Boolean(m[2]), line: lineNo });
    }
  });
  return statements;
}

function loadMigrations(dir) {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return names.map((name) => ({
    name,
    statements: parseMigration(readFileSync(join(dir, name), 'utf8')),
  }));
}

function describeStatement(statement) {
  switch (statement.kind) {
    case 'create':
      return `CREATE ${statement.type.toUpperCase()} ${statement.name}${statement.ifNotExists ? '（IF NOT EXISTS）' : '（无 IF NOT EXISTS）'}`;
    case 'addColumn':
      return `ALTER TABLE ${statement.table} ADD COLUMN ${statement.column}`;
    case 'dropColumn':
      return `ALTER TABLE ${statement.table} DROP COLUMN ${statement.column}`;
    case 'rename':
      return `ALTER TABLE ${statement.from} RENAME TO ${statement.to}`;
    case 'drop':
      return `DROP ${statement.type.toUpperCase()} ${statement.name}${statement.ifExists ? '（IF EXISTS）' : '（无 IF EXISTS）'}`;
    default:
      return statement.kind;
  }
}

/** 静态模式：只列出不可重复执行的语句，用于新增迁移时自检 */
function runPlan(files) {
  console.log(`迁移静态检查：共 ${files.length} 个文件\n`);
  let risky = 0;
  for (const file of files) {
    const list = file.statements.filter(
      (s) =>
        s.kind === 'addColumn' ||
        s.kind === 'dropColumn' ||
        (s.kind === 'create' && !s.ifNotExists) ||
        (s.kind === 'drop' && !s.ifExists)
    );
    if (!list.length) continue;
    risky += list.length;
    console.log(`${file.name}`);
    for (const statement of list) {
      console.log(`  L${statement.line}  ${describeStatement(statement)}`);
    }
    console.log('');
  }
  console.log(
    risky === 0
      ? '全部语句可重复执行。'
      : `发现 ${risky} 条不可重复执行的语句（ADD/DROP COLUMN 为 SQLite 限制，属预期；其余应补 IF [NOT] EXISTS）。`
  );
  console.log('提示：这些迁移只能依赖 d1_migrations 记录保证不被重跑，禁止在控制台手工执行。');
  return 0;
}

function objectKey(type, name) {
  return `${type}:${name}`;
}

function columnKey(table, column) {
  return `column:${table}.${column}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const migrationsDir = resolve('migrations');
  const files = loadMigrations(migrationsDir);

  if (args.plan) return runPlan(files);

  // 1) 读取迁移历史（表不存在视为全新库）
  const [migrationTable] = query(
    args,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations';"
  );
  let recorded = [];
  if (migrationTable.length > 0) {
    const [rows] = query(args, 'SELECT name FROM d1_migrations ORDER BY id;');
    recorded = rows.map((row) => row.name);
  }
  const recordedSet = new Set(recorded);

  // 2) 读取真实 schema
  const alterTables = new Set();
  for (const file of files) {
    for (const statement of file.statements) {
      if (statement.kind === 'addColumn' || statement.kind === 'dropColumn') alterTables.add(statement.table);
      if (statement.kind === 'rename') alterTables.add(statement.from);
    }
  }

  let sql =
    "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger') " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';";
  const tables = [...alterTables];
  for (const table of tables) {
    sql += `SELECT '${table}' AS tbl, name AS col FROM pragma_table_info('${table}');`;
  }
  const results = query(args, sql);

  const dbObjects = new Set();
  for (const row of results[0] ?? []) {
    if (INTERNAL_TABLES.has(row.name)) continue;
    dbObjects.add(objectKey(row.type, row.name));
  }
  const dbTableNames = new Set(
    [...dbObjects].filter((key) => key.startsWith('table:')).map((key) => key.slice('table:'.length))
  );
  const dbColumns = new Set();
  tables.forEach((table, index) => {
    for (const row of results[index + 1] ?? []) {
      dbColumns.add(columnKey(table, row.col));
    }
  });

  // 3) 顺序模拟
  const objects = new Map(); // key -> 创建它的迁移文件
  const columns = new Map();
  for (const key of dbObjects) objects.set(key, null);
  for (const key of dbColumns) columns.set(key, null);

  const errors = [];
  const warnings = [];

  const pushIssue = (issue) => {
    const allowed = KNOWN_DIFFERENCES.find(
      (item) => item.object === issue.object && (!item.migration || item.migration === issue.migration)
    );
    if (allowed) warnings.push({ ...issue, message: `${issue.message}（已知差异：${allowed.reason}）` });
    else errors.push(issue);
  };

  for (const file of files) {
    const isRecorded = recordedSet.has(file.name);
    for (const statement of file.statements) {
      if (statement.kind === 'create') {
        const key = objectKey(statement.type, statement.name);
        const exists = objects.has(key);
        if (exists && !statement.ifNotExists && !isRecorded) {
          pushIssue({
            migration: file.name,
            object: key,
            line: statement.line,
            message: `${describeStatement(statement)} 会失败：对象已存在但该迁移未记录`,
            hint: '可能曾在 D1 控制台手工执行过该迁移。见 docs/runbooks/d1-112-repair.md',
          });
        } else if (exists && statement.ifNotExists && !isRecorded && !objects.get(key)) {
          // 仅在“库里已有该对象，但本仓库没有任何迁移创建过它”时提示，避免同一对象
          // 被多个迁移重复 IF NOT EXISTS 创建时的噪音。
          warnings.push({
            migration: file.name,
            object: key,
            line: statement.line,
            message: `${statement.type} ${statement.name} 已存在（IF NOT EXISTS 不会报错），但该迁移未记录`,
          });
        }
        objects.set(key, file.name);
        continue;
      }

      if (statement.kind === 'drop') {
        const key = objectKey(statement.type, statement.name);
        if (!objects.has(key) && !statement.ifExists && !isRecorded) {
          pushIssue({
            migration: file.name,
            object: key,
            line: statement.line,
            message: `${describeStatement(statement)} 会失败：对象不存在且未加 IF EXISTS`,
            hint: '见 docs/runbooks/d1-112-repair.md',
          });
        }
        objects.delete(key);
        if (statement.type === 'table') {
          const prefix = `column:${statement.name}.`;
          for (const column of [...columns.keys()]) {
            if (column.startsWith(prefix)) columns.delete(column);
          }
        }
        continue;
      }

      if (statement.kind === 'addColumn') {
        const key = columnKey(statement.table, statement.column);
        const exists = columns.has(key);
        if (exists && !isRecorded) {
          pushIssue({
            migration: file.name,
            object: key,
            line: statement.line,
            message: `${describeStatement(statement)} 会失败：列已存在但该迁移未记录`,
            hint: '可能曾在 D1 控制台手工执行过该迁移。见 docs/runbooks/d1-112-repair.md',
          });
        }
        columns.set(key, file.name);
        continue;
      }

      if (statement.kind === 'dropColumn') {
        const key = columnKey(statement.table, statement.column);
        const exists = columns.has(key);
        // 内联在 CREATE TABLE 里的列无法从语句中解析；只有确认表已存在于数据库时，
        // “列不存在”才是可靠结论（全新库由更早的待执行迁移建表，这里不做判断）。
        if (!exists && !isRecorded && dbTableNames.has(statement.table)) {
          pushIssue({
            migration: file.name,
            object: key,
            line: statement.line,
            message: `${describeStatement(statement)} 会失败：列不存在`,
            hint: '见 docs/runbooks/d1-112-repair.md',
          });
        }
        columns.delete(key);
        continue;
      }

      if (statement.kind === 'rename') {
        const fromKey = objectKey('table', statement.from);
        const toKey = objectKey('table', statement.to);
        const origin = objects.get(fromKey) ?? file.name;
        objects.delete(fromKey);
        objects.set(toKey, origin);
        for (const [key, value] of [...columns.entries()]) {
          const prefix = `column:${statement.from}.`;
          if (key.startsWith(prefix)) {
            columns.delete(key);
            columns.set(`column:${statement.to}.${key.slice(prefix.length)}`, value);
          }
        }
      }
    }
  }

  // 4) 已记录迁移的最终对象必须存在
  for (const [key, origin] of objects.entries()) {
    if (!origin || !recordedSet.has(origin)) continue;
    if (!dbObjects.has(key)) {
      errors.push({
        migration: origin,
        object: key,
        message: `对象 ${key} 由已记录的迁移 ${origin} 创建，但数据库中不存在（schema 漂移）`,
        hint: '见 docs/runbooks/d1-112-repair.md',
      });
    }
  }
  for (const [key, origin] of columns.entries()) {
    if (!origin || !recordedSet.has(origin)) continue;
    if (!dbColumns.has(key)) {
      errors.push({
        migration: origin,
        object: key,
        message: `列 ${key.replace('column:', '')} 由已记录的迁移 ${origin} 添加，但数据库中不存在（schema 漂移）`,
        hint: '见 docs/runbooks/d1-112-repair.md',
      });
    }
  }

  const pending = files.map((file) => file.name).filter((name) => !recordedSet.has(name));

  if (args.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, database: args.db, recorded, pending, errors, warnings }, null, 2));
    return errors.length === 0 ? 0 : 1;
  }

  console.log(`迁移预检 @ ${args.db} (${args.local ? 'local' : 'remote'})`);
  console.log(`迁移文件 ${files.length} 个，已记录 ${recorded.length} 个，待执行 ${pending.length} 个`);
  if (pending.length) console.log(`待执行：${pending.join(', ')}`);
  console.log('');

  for (const item of errors) {
    console.log(`✘ ${item.migration}${item.line ? `:${item.line}` : ''}`);
    console.log(`  ${item.message}`);
    if (item.hint) console.log(`  提示：${item.hint}`);
  }
  for (const item of warnings) {
    console.log(`⚠ ${item.migration}${item.line ? `:${item.line}` : ''}`);
    console.log(`  ${item.message}`);
  }

  if (errors.length > 0) {
    console.log(`\n预检失败：${errors.length} 处差异会阻塞迁移，请先按提示对齐数据库或补充迁移记录。`);
    return 1;
  }

  console.log(`预检通过${warnings.length ? `（${warnings.length} 条警告）` : ''}。`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`预检执行失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
