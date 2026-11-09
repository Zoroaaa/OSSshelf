# 明文密钥加密迁移操作手册

适用对象：`ai_providers.api_key_encrypted` 中历史上以**明文**保存的 AI 供应商 API Key。
目标：把它们按 `src/lib/crypto.ts` 的格式（`base64(iv || AES-GCM 密文+tag)`，密钥 = `SHA-256(JWT_SECRET)`）重新加密。

> 本文所有结论均来自 `apps/api/scripts/encrypt-plaintext-secrets.mjs` 当前实现。

---

## 1. 脚本与参数

| 项目     | 值                                                              |
| -------- | --------------------------------------------------------------- |
| 脚本路径 | `apps/api/scripts/encrypt-plaintext-secrets.mjs`                |
| 包命令   | 在 `apps/api` 目录下 `pnpm secrets:encrypt`（根目录**没有**该别名） |
| 数据库   | 默认 `ossshelf-db`，默认对 `--remote`（生产库）执行             |

支持的参数：

| 参数                  | 作用                                             | 默认             |
| --------------------- | ------------------------------------------------ | ---------------- |
| `--remote`            | 操作生产 D1                                      | 默认（不写也是它） |
| `--local`             | 操作本地 D1                                      | —                |
| `--db <name>`         | 指定 D1 数据库名                                 | `ossshelf-db`    |
| `--dry-run`           | 只读 + 生成备份/SQL，**不写库**                  | 关闭             |
| `--backup <path>`     | 自定义备份文件路径                               | 见下             |
| `--rollback <json>`   | 按备份文件回滚（可叠加 `--dry-run` 只生成 SQL）  | —                |
| `--help`              | 打印用法                                         | —                |

产物都落在**当前工作目录**（在 `apps/api` 下执行时）：

- 备份：`apps/api/backups/ai-provider-keys-<时间戳>.json`，**含明文密钥**
- 迁移 SQL：`apps/api/encrypt-keys-<时间戳>.sql`（`BEGIN; UPDATE ...; COMMIT;`）
- 回滚 SQL：`apps/api/rollback-<时间戳>.sql`

> `--dry-run` 也**必须**提供 `JWT_SECRET`：脚本要用它判断某行是否已加密。缺变量会直接报错退出。

---

## 2. Windows PowerShell 完整步骤

### 2.1 确认 JWT_SECRET（最重要，不要猜）

脚本用 `JWT_SECRET` 判断“已加密 / 明文”。**如果填错，所有已加密的行会被当成明文再加密一次**，等于把现有供应商密钥全部写坏。

因此 `$env:JWT_SECRET` 必须是 Worker 运行时正在使用的那个值（即 GitHub Secrets 里的 `JWT_SECRET`）。
Cloudflare 控制台只能看到 secret 的名字、看不到值。如果你不确定当前值，**先不要执行正式迁移**。

### 2.2 逐条复制执行

```powershell
# 1) 进入仓库根目录
Set-Location "d:\开发项目\OSSshelf"

# 2) 安装依赖（首次或依赖有更新时）
pnpm install

# 3) 需要工作目录下存在 wrangler.toml（已被 .gitignore 忽略）
if (-not (Test-Path "apps\api\wrangler.toml")) {
  Copy-Item "apps\api\wrangler.toml.example" "apps\api\wrangler.toml"
}

# 4) 打开 apps\api\wrangler.toml，把 database_id 改成真实 D1 ID
#    （Cloudflare 控制台 → D1 → ossshelf-db 可看到；CI 里对应 CLOUDFLARE_D1_DATABASE_ID）
notepad "apps\api\wrangler.toml"

# 5) 切到 apps/api（必须，脚本按当前目录找 wrangler.toml 和写备份）
Set-Location "d:\开发项目\OSSshelf\apps\api"

# 6) 设置环境变量（只在当前 PowerShell 窗口有效）
$env:JWT_SECRET = "与 Worker 运行时完全一致的值"
$env:CLOUDFLARE_API_TOKEN = "你的 Cloudflare API Token"
$env:CLOUDFLARE_ACCOUNT_ID = "你的 Account ID"

# 7) 干跑
node scripts\encrypt-plaintext-secrets.mjs --remote --dry-run
```

Token 权限要求：

- **Account → D1 → Edit**（`wrangler d1 execute` 即使只做 `SELECT` 也要求 Edit 权限）。
- 不需要 Workers Scripts 权限。
- 建议单独建一个临时 Token，用完即删；也可以在步骤 6 省略 Token，改用 `npx wrangler login` 走浏览器授权。

---

## 3. `--dry-run` 的预期输出与判断标准

正常输出形如：

```text
共读取 12 条供应商密钥记录
已加密: 9 条，待迁移明文: 3 条
已备份原值到: D:\开发项目\OSSshelf\apps\api\backups\ai-provider-keys-2026-11-09T10-00-00-000Z.json（含明文密钥，请妥善保管且不要提交到仓库）
已生成迁移 SQL: D:\开发项目\OSSshelf\apps\api\encrypt-keys-2026-11-09T10-00-00-000Z.sql
--dry-run：未写入数据库。确认无误后去掉 --dry-run 重新执行。
```

判断“可以正式执行”的四条：

1. `待迁移明文: 0 条` → 脚本会打印“无需迁移”，到此结束，不要继续。
2. `已加密: X 条` 与你的预期相符（说明 `JWT_SECRET` 大概率正确）。若 `已加密: 0` 但库里明显有加密过的数据，说明 `JWT_SECRET` 是错的 → **停止**。
3. 打开生成的 `encrypt-keys-*.sql`：内容只应有 `BEGIN;`、若干条 `UPDATE ai_providers SET api_key_encrypted = '...' WHERE id = '...';`、`COMMIT;`，不应出现 `DELETE` / `DROP` / `ALTER`。
4. 备份 JSON 的 `rows` 条数应等于“待迁移明文”条数。

---

## 4. 正式执行、备份与回滚

### 4.1 正式执行（本地）

```powershell
# 仍在 apps/api 目录，且 JWT_SECRET / Token 已设置
node scripts\encrypt-plaintext-secrets.mjs --remote
```

成功输出：

```text
迁移完成并校验通过：3 条密钥已加密
如需回滚：node scripts/encrypt-plaintext-secrets.mjs --rollback "D:\...\backups\ai-provider-keys-....json"
```

脚本会自动做写后校验（逐行解密）。若校验失败会报错并提示用备份回滚。

### 4.2 只在 D1 控制台粘贴 SQL 的替代做法

适合只想复制 SQL 的场景，但**必须自己保住备份 JSON**：

1. 先按第 3 节跑 `--dry-run`，得到 `apps/api/encrypt-keys-<时间戳>.sql`；
2. 打开该文件，全选、复制到 Cloudflare → D1 → `ossshelf-db` → Console，执行；
   - 若控制台一次只接受一条语句，去掉 `BEGIN;` / `COMMIT;` 后把每条 `UPDATE` 分开执行；
3. 执行完再跑一次 `--dry-run` 复核，应显示 `已加密: 全部，待迁移明文: 0 条`。

> 这条路径没有写后校验，务必以第 3 步复核结果为准。

### 4.3 回滚

```powershell
# 只生成 SQL，不写库（适合去控制台粘贴）
node scripts\encrypt-plaintext-secrets.mjs --remote --rollback backups\ai-provider-keys-<时间戳>.json --dry-run

# 直接回滚
node scripts\encrypt-plaintext-secrets.mjs --remote --rollback backups\ai-provider-keys-<时间戳>.json
```

回滚前脚本会校验备份的 `table` / `column`，并比对 `secretFingerprint`：如果当前 `JWT_SECRET` 与备份时不一致会直接拒绝执行。

### 4.4 备份文件怎么处理

- 位置：`apps/api/backups/ai-provider-keys-<时间戳>.json`；自定义用 `--backup <path>`。
- **含明文密钥**。仓库 `.gitignore` 已忽略 `backups/`、`encrypt-keys-*.sql`、`rollback-*.sql`。
- 确认迁移稳定后，删除备份与 SQL 文件，或转存到加密介质；绝对不要提交、不要发到聊天工具。

---

## 5. 不本地跑：GitHub Actions 手动触发

工作流已落地：`.github/workflows/encrypt-secrets.yml`，**只能手动触发**，不会随 push 运行。

### 5.1 触发前确认

- 仓库 Secrets 已有：`JWT_SECRET`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`
  （加密脚本用的 `JWT_SECRET` 直接读 GitHub Secrets，**不需要你在页面上填写任何密钥**）。
- 建议在仓库 Settings → Environments → `production` 配置 Required reviewers，让正式执行多一道人工确认。

### 5.2 在仓库 Actions 页面如何触发

1. 打开仓库 → **Actions** → 左侧选择 **Encrypt plaintext AI keys** → 右侧 **Run workflow**。
2. Branch 选 `main`，`mode` 三选一：

   | mode                | 会发生什么                                     |
   | ------------------- | ---------------------------------------------- |
   | `dry-run`（默认）   | 只读查询 + 生成备份/SQL，**不写库**            |
   | `migrate`           | 正式加密写库，写后自动逐行校验                 |
   | `rollback`          | 按 `backup_file` 指定的备份还原                |

3. `backup_file` 只在 `rollback` 时填，例如 `apps/api/backups/ai-provider-keys-2026-11-09T10-00-00-000Z.json`。
4. `confirm` 勾选框：`dry-run` 不用勾；`migrate` / `rollback` **必须勾选**，否则工作流直接报错退出。
5. 点 **Run workflow**，进入运行详情看日志；执行结束后在页面底部 **Artifacts** 下载 `key-migration-output`。

### 5.3 dry-run 结果怎么看

日志里应依次出现：

```text
共读取 N 条供应商密钥记录
已加密: X 条，待迁移明文: Y 条
已备份原值到: /home/runner/work/.../apps/api/backups/ai-provider-keys-<ts>.json（含明文密钥，请妥善保管且不要提交到仓库）
已生成迁移 SQL: /home/runner/work/.../apps/api/encrypt-keys-<ts>.sql
--dry-run：未写入数据库。确认无误后去掉 --dry-run 重新执行。
```

判断“可以正式执行”（四条同时满足）：

1. `待迁移明文: 0 条` → 无需迁移，到此为止；
2. `已加密: X` 与预期相符；若库里明显有加密数据却显示 `已加密: 0`，说明 `JWT_SECRET` 不匹配，**禁止**继续；
3. 下载的 `encrypt-keys-*.sql` 只含 `BEGIN;` / `UPDATE ai_providers SET api_key_encrypted = ...` / `COMMIT;`，没有 `DELETE` / `DROP` / `ALTER`；
4. 备份 JSON 的 `rows` 条数等于 `待迁移明文` 数量。

确认无误后，再以 `mode=migrate` + 勾选 `confirm` 触发一次。`migrate` 成功时日志会输出 `迁移完成并校验通过：N 条密钥已加密`。

### 5.4 工作流的安全约束

- Token / `JWT_SECRET` 只通过 `env:` 注入，不写命令行参数、不 `echo`、不开 `set -x`；
- 备份 artifact **含明文密钥**，`retention-days: 1`，下载后立即删除；
- 不要 `cat` 备份 JSON，否则明文会进 Actions 日志；
- `environment: production` + Required reviewers 可防止误触发正式执行；
- 同一时间只允许一个运行（`concurrency`），避免两次迁移叠加。

---

## 附：最短路径清单

**在 GitHub Actions 操作（推荐，免本地环境）：**

1. Actions → Encrypt plaintext AI keys → Run workflow → `mode=dry-run` → 运行
2. 看日志 `已加密 / 待迁移明文`，下载 artifact 检查 SQL 只有 UPDATE
3. 确认无误 → 再跑一次 `mode=migrate` 并勾选 `confirm`
4. 备份 artifact 用完即删；不要提交任何生成的 JSON/SQL

**在本地操作：**

1. `apps/api` 下设置 `JWT_SECRET` / Token → `node scripts\encrypt-plaintext-secrets.mjs --remote --dry-run`
2. 同上判断 → 去掉 `--dry-run` 执行 → 看到“迁移完成并校验通过”
3. 备份 JSON 妥善保存/销毁；`.gitignore` 已挡住误提交
