# D1 迁移 112 失败修复手册

适用场景：`wrangler d1 migrations apply ossshelf-db --remote` 在
`112_ai_provider_connections.sql` 报 `duplicate column name: protocol (SQLITE_ERROR, code 7500)`，
导致 112-116 未执行、部署未上线。

面向对象：只用 Cloudflare D1 控制台粘贴 SQL 的操作者。
本文所有结论来自仓库内 `apps/api/migrations/111~116` 的实际 SQL。

---

## 0. 先备份：记下 Time Travel 时间点

Cloudflare 控制台 → **D1** → `ossshelf-db` → **Time Travel**，记下当前时间（或创建一个 bookmark）。
后续任何一步误操作，都可以按这个时间点恢复。**动手前先做这一步。**

---

## 1. 事实与原因（不用操作，先看结论）

- 112 文件里第 13-26 行是 13 条 `ALTER TABLE ... ADD COLUMN`，**SQLite 不支持 `ADD COLUMN IF NOT EXISTS`**。
- 本次 CI 报错落在 112 的**第一条** `ALTER TABLE ai_providers ADD COLUMN protocol`，且日志里没有 112 的
  `Executed N commands`，说明**这次线上没有产生 112 的任何写入**。
- 但 `protocol` 列已存在，说明**此前有人在控制台手工执行过 112 的一部分**。
- 因此现在需要确认：生产库到底执行到 112 的哪一步。112 的 5 段数据迁移（连接/密钥搬迁）
  **可能完全没跑**，不确认就补记录会导致上线后 AI 配置引用了不存在的连接。

修复思路：把生产库的 schema 修成“112 已完整执行”的样子，然后在 `d1_migrations` 补一条 112 记录，
让 wrangler 跳过它。**不修改 112 文件**（全新库仍然需要那 13 条 ADD COLUMN 和 2 条 DROP COLUMN）。

---

## 2. 校验 SQL（逐段粘贴，记录结果）

> 控制台里建议**一次执行一段**，执行完记录返回值再继续。

### ① 迁移历史

```sql
SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
```

判读：应能看到 `111_remove_legacy_chat.sql`，**不应**有 `112_...`。

### ② `ai_providers` 新增列（112 第 1 段，期望 8 行）

```sql
SELECT name, type, "notnull" AS not_null, dflt_value
FROM pragma_table_info('ai_providers')
WHERE name IN ('protocol','api_key_encrypted','preset_id','logo_url',
               'headers_json','discovered_models_json','models_synced_at','default_input')
ORDER BY name;
```

判读：
- **8 行** → 112 的增列部分完整；
- 少于 8 行 → 缺哪些列，第二、四节第 1 步就补哪些；
- 顺带检查 `protocol` 的 `not_null` 应为 1、`dflt_value` 应为 `'openai_compatible'`。若不匹配，
  先不要改（不影响本次恢复），但要记录，后续单独评估。

### ③ `ai_models` 新旧列（期望只剩 5 个新列）

```sql
SELECT name, type
FROM pragma_table_info('ai_models')
WHERE name IN ('context_window','max_output_tokens','input_modalities','pricing_json',
               'metadata_source','api_endpoint','api_key_encrypted')
ORDER BY name;
```

判读：
- 期望是 `context_window / input_modalities / max_output_tokens / metadata_source / pricing_json` 共 5 行；
- 如果还能看到 `api_endpoint` 或 `api_key_encrypted` → 112 第 8 段（DROP COLUMN）没执行，
  **必须等数据搬迁完成后再删**（见第四节顺序）。

### ④ 表是否存在（113 / 115）

```sql
SELECT name FROM sqlite_master
WHERE type='table' AND name IN ('ai_catalog_snapshot','ai_quota_counters');
```

判读：这里通常是 0 行（113/115 还没跑），属于正常，交给 CI 处理即可。

### ⑤ 索引是否存在（112 / 115 / 116）

```sql
SELECT name, tbl_name FROM sqlite_master
WHERE type='index' AND name IN ('idx_ai_providers_user_preset','idx_ai_models_user_provider_model',
                                'idx_ai_quota_counters_updated_at','idx_memories_session');
```

判读：若存在 `idx_ai_providers_user_preset` 与 `idx_ai_models_user_provider_model`，说明 112 第 9 段跑过。

### ⑥ 存储触发器（114，期望 6 个）

```sql
SELECT name FROM sqlite_master
WHERE type='trigger' AND name LIKE 'trg_files_storage_%' ORDER BY name;
```

判读：0 行是正常的（114 未执行）；若部分存在也不影响，114 全部是 `DROP TRIGGER IF EXISTS` + `CREATE`。

### ⑦ 112 数据迁移是否做过（关键）

```sql
SELECT
  (SELECT COUNT(*) FROM ai_providers WHERE is_system = 0)                                        AS user_providers,
  (SELECT COUNT(*) FROM ai_models WHERE provider_id IS NULL AND provider <> 'workers_ai')        AS orphan_models,
  (SELECT COUNT(*) FROM ai_models
     WHERE provider_id IN (SELECT id FROM ai_providers WHERE is_system = 1))                     AS models_on_system_preset;
```

判读：

| 结果 | 含义 |
| --- | --- |
| `orphan_models = 0` 且 `models_on_system_preset = 0` | 112 的数据段（第 2-7 段）已生效 |
| `orphan_models > 0` 或 `models_on_system_preset > 0` | 数据段**没跑或没跑完**，必须走第四节情形 2 的第 2 步 |

> 注意：`orphan_models` 只统计 `provider <> 'workers_ai'` 且有 `provider_id` 的模型。
> 如果全库还没有任何外部模型，这三个数都可能是 0，此时两个情形都可以走，按列/索引判断即可。

---

## 3. 情形 1：112 其实已完整执行（②=8 行、③无旧列、⑤两个索引都在、⑦两项都为 0）

只差一条历史记录。在控制台执行：

```sql
INSERT INTO d1_migrations (name)
SELECT '112_ai_provider_connections.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '112_ai_provider_connections.sql');
```

执行后再次运行 ①，确认 112 已出现在历史里。然后直接看第五节“如何重跑 Deploy API”。

---

## 4. 情形 2：112 只执行了一部分

**必须按下面顺序操作，尤其是第 3 步不能提前。**

### 第 1 步：补缺失的列

只执行 ② 结果中**缺失**的语句，一条一条粘贴（已存在的列跳过，否则会再次报 duplicate column）：

```sql
ALTER TABLE ai_providers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai_compatible';
ALTER TABLE ai_providers ADD COLUMN api_key_encrypted TEXT;
ALTER TABLE ai_providers ADD COLUMN preset_id TEXT;
ALTER TABLE ai_providers ADD COLUMN logo_url TEXT;
ALTER TABLE ai_providers ADD COLUMN headers_json TEXT;
ALTER TABLE ai_providers ADD COLUMN discovered_models_json TEXT;
ALTER TABLE ai_providers ADD COLUMN models_synced_at TEXT;
ALTER TABLE ai_providers ADD COLUMN default_input TEXT NOT NULL DEFAULT '["text"]';
```

`ai_models` 侧同理，只执行 ③ 中缺失的：

```sql
ALTER TABLE ai_models ADD COLUMN context_window INTEGER;
ALTER TABLE ai_models ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN input_modalities TEXT DEFAULT '["text"]';
ALTER TABLE ai_models ADD COLUMN pricing_json TEXT;
ALTER TABLE ai_models ADD COLUMN metadata_source TEXT;
```

### 第 2 步：执行 112 的数据迁移（可安全重复）

打开 `apps/api/migrations/112_ai_provider_connections.sql`，**原样复制第 31-217 行**（第 2 段到第 7 段），
在控制台执行。这些语句都带 `NOT EXISTS` / `IS NULL` 守卫，重复执行只会补漏，不会重复插入。

如果控制台一次只接受一条语句，按文件里的 `;` 分隔逐条执行，顺序保持不变。

执行完再跑一次 ⑦，确认：

- `orphan_models = 0`
- `models_on_system_preset = 0`
- `user_providers` 数量与新连接一致（至少不再增长）

### 第 3 步：删除 `ai_models` 上的旧连接字段

**只有 ③ 里还看得到这两列时才执行，且必须在第 2 步之后。**
提前删除会丢失尚未搬迁的 API Key：

```sql
ALTER TABLE ai_models DROP COLUMN api_endpoint;
ALTER TABLE ai_models DROP COLUMN api_key_encrypted;
```

### 第 4 步：补索引

```sql
CREATE INDEX IF NOT EXISTS idx_ai_providers_user_preset ON ai_providers(user_id, preset_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_user_provider_model ON ai_models(user_id, provider_id, model_id);
```

### 第 5 步：补写 112 的迁移记录

```sql
INSERT INTO d1_migrations (name)
SELECT '112_ai_provider_connections.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '112_ai_provider_connections.sql');
```

### 第 6 步：复核

依次重跑 ②、③、⑤、⑦：

- ② = 8 行
- ③ = 5 行（无 `api_endpoint`、无 `api_key_encrypted`）
- ⑤ 含两个 112 索引
- ⑦ `orphan_models = 0`、`models_on_system_preset = 0`

---

## 5. 修完后如何重跑 Deploy API

1. 先在控制台确认历史记录：

```sql
SELECT name FROM d1_migrations WHERE name LIKE '11%' ORDER BY name;
```

应至少包含 `111_remove_legacy_chat.sql` 与 `112_ai_provider_connections.sql`。

2. 打开 GitHub 仓库 → **Actions** → 左侧 **Deploy API to Cloudflare Workers** →
   右侧 **Run workflow** → 分支选 `main` → **Run workflow**。

3. 观察日志：

   - `Apply D1 migrations` 应只列出 113、114、115、116（112 已被跳过）；
   - 这 4 个文件全部使用 `IF NOT EXISTS` / `DROP ... IF EXISTS`，重复执行安全；
   - 之后 `Deploy to Cloudflare Workers` 才会真正上线新代码。

4. 部署完成后访问线上环境，检查 AI 设置页能正常列出连接与模型。

**不要**为了让迁移重跑而删除 `d1_migrations` 里的记录——112 的第一条 `ALTER` 依然会失败。

---

## 6. 风险提示

- **不要在修复前重跑部署**：CI 仍会卡在 112，只是重复失败。
- **不要跳过第 4 节第 2 步直接删列**：`ai_models.api_key_encrypted` 里可能还有没搬走的 Key，
  删除后无法恢复（只能靠 Time Travel 回滚整库）。
- **不要整段重跑 112 文件**：前 13 条 `ALTER` 与最后 2 条 `DROP COLUMN` 都不具备可重复执行性。
- **补记录前必须先做完 schema 校验**：如果只补记录而实际缺列，部署后运行时会报 `no such column`。
- `d1_migrations` 的写入请只做本文给出的这一条 INSERT，不要手工改 id 或时间戳。
- 操作期间避免同时在应用里编辑 AI 供应商配置；迁移与配置写入并发时结果难以判断。

---

## 7. 全新库是否受影响

不受影响。本手册没有修改任何迁移文件，全新库执行 112 时会从“没有这些列”的初始状态开始，
13 条 `ADD COLUMN`、数据迁移、2 条 `DROP COLUMN`、索引都会按预期生效。

---

## 8. 后续建议（本次不做）

- 建表 / 建索引 / 删表 / 删触发器统一用 `IF (NOT) EXISTS`，目前已基本遵守。
- `ADD COLUMN` 是 SQLite 唯一无法自我保护的 DDL：新增列前先提供 `pragma_table_info` 校验 SQL，
  并在迁移文件头部注释说明“该列可能已由控制台手工添加”。
- 发版前先跑一次“`d1_migrations` vs `sqlite_master`”比对，避免再次出现“库已改、历史未记”。
- 不建议在 CI 中自动改写 `d1_migrations`，补记录应人工确认后执行。
