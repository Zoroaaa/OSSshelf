# 前后端分离 → 单 Worker + Workers Builds 实施手册

适用场景：当前「前端部署在 Cloudflare Pages、后端部署在独立 Worker」，目标是把两者合并到**一个 Worker**（静态资源用 `[assets]` 承载、API 用同一 Worker 的 fetch 处理），并把部署入口换成 **Workers Builds（连接 GitHub）**。

阅读方式：第 1 节决定做不做，第 2 节按顺序执行，第 3 节是踩坑对照表，第 4 节是上线前后的勾选清单，第 5 节说明哪些结果只能去 Cloudflare 控制台看。

---

## 1. 先判断值不值得做

「合并成单 Worker」和「改用 Workers Builds」是**两个独立决策**，不要捆绑。它们的收益来源完全不同。

| 决策 | 解决的问题 | 代价 |
| --- | --- | --- |
| 合并成单 Worker | 前端与 API 跨域、两个部署单元版本不同步、预览/生产域名两套配置 | 失去 Pages 的按 PR 预览、Pages Functions（`functions/`、`_routes.json`）、需要自己处理 SPA 回退与路由优先级。注意 `_headers` / `_redirects` **不是**损失：Workers 静态资源同样支持这两份文件（见 Step 4） |
| 改用 Builds | 不再需要 CI/本机执行 `wrangler deploy`，部署由 Cloudflare 侧完成，凭据不出仓库 | 构建环境不透明（命令在云端跑）、构建配置在 Dashboard 里不可版本化、构建失败排查要跳平台、构建分钟消耗 |

### 1.1 只做「合并」，不换 Builds

满足以下全部条件时，保留现有 CI 的 `wrangler deploy` 更稳：

- 现有 CI 已经能稳定执行「构建 → 部署」，且你依赖 CI 里的**部署闸门**（例如数据库迁移成功才发版）。
- 你的前端是纯静态 SPA，没有 Pages Functions / 边缘中间件。
- 你不需要「push 之后云端自动构建」。

做法：只改 wrangler 配置（加 `[assets]`）、改前端 baseURL 为同源，部署仍走 CI。改动面最小，回滚路径也最短。

### 1.2 只做「Builds」，不合并

**不推荐**。Builds 部署的是一个 Worker；如果前端还在 Pages，你会得到「一个 Pages 项目 + 一个 Builds Worker」两套流水线，仍然要处理跨域和版本错位——把最大的成本留下了。

例外：后端 Worker 的体积/构建已经复杂度很高（依赖 native 模块、需要特殊构建镜像），你想先把后端交给 Builds，前端暂留 Pages。此时必须同步维护两份 CORS 与两个域名。

### 1.3 都做（默认推荐）

满足以下任意一条，就直接做完整方案：

- 你还没有稳定的自动部署，部署靠本机 `wrangler deploy`。
- 你希望前端与 API **原子发布**（一次部署同时更新两者，不存在前端已更新、API 未更新的窗口）。
- 你要减少「域名 + CORS + cookie + PUBLIC_URL」这类跨域配置的长期维护成本。

前置否决条件（出现任一条就不要做静态 assets 合并）：

- 前端需要 SSR / 边缘渲染（应当迁到 Workers 运行时，而不是 `[assets]`）。
- 前端依赖 Pages 的按 PR 预览环境做评审流程。
- 前端依赖 Pages Functions（`functions/` 目录、`_routes.json`），且没有精力在 Worker 里重写。（`_headers` / `_redirects` 不构成否决条件：Workers 静态资源原生支持，迁移时原样保留即可。）

### 1.4 成本预估（用于决策，不是排期）

- 配置改动：1 个 wrangler 文件 + 1 段前端 baseURL 逻辑 + 1 个 workflow。
- 一次性风险点：路由优先级（`/api` 被 SPA 吃掉）、域名切换窗口、Durable Object 命名空间、库内密文的加密密钥。
- 长期收益：单一域名、单一 CORS 策略、单一版本号、单一回滚动作。

---

## 2. 实施步骤

每步格式：**做什么 / 为什么 / 怎么验证**。顺序不可随意调换——后面的步骤依赖前面的目录结构与路由已确定。

### Step 0 盘点现状（不改代码）

**做什么**

1. 确认前端构建产物是**纯静态**：`npm run build` 后产物目录只有 `.html` / `.js` / `.css` / 静态资源，没有 server entry。
2. 列出后端 Worker 当前处理的**全部顶级路径前缀**（示例：`/api`、`/dav`、`/agents`、`/cron`、`/health`、WebSocket 入口）。
3. 列出前端产物目录里的声明式文件：`_headers`、`_redirects`（Workers 静态资源**同样支持**，迁移时保留并核对路径），以及 Pages 专用的 `_routes.json`、`functions/`、`404.html`。
4. 记录当前线上访问域名、自定义域、以及 Worker 绑定的 D1 / KV / R2 / Vectorize / Queue / Durable Object。
5. 记录当前 `JWT_SECRET` 是否被用于**加密库内数据**（不是只签 token）。

**为什么**：第 5 项决定了「换 Worker / 换密钥」会不会导致数据不可读——这是唯一可能造成不可逆损失的点，必须先确认。第 2 项决定 `run_worker_first` 覆盖范围，漏一个前缀就会出现「接口返回 HTML」的诡异故障。

**怎么验证**：把上述清单写成一张表放进 issue/PR 描述。三项以上靠记忆而不是查配置，就说明盘点没做完。

### Step 1 决定 wrangler 配置的存放方式：入库 vs 构建期生成

**做什么**：二选一，不要混用。

| 方案 | 适用 | 做法 |
| --- | --- | --- |
| A. 配置入库（推荐） | 单环境，或环境数量少且可一文件一环境 | `wrangler.toml` 提交进仓库，D1/KV/Vectorize/Queue 的 **id 写死** |
| B. 构建期生成 | 多环境、id 不便公开、需要同一份模板覆盖 dev/staging/prod | CI/Builds 在部署前用脚本生成 `wrangler.toml` |

**为什么**

- 资源 **id 是标识符不是密钥**（`database_id`、`kv id`、`index_name`、`queue name`），入库不构成泄露；真正不能入库的是 token、加密密钥、第三方 API key。
- 方案 B 的失败模式很隐蔽：脚本只在 CI 或只在 Builds 里跑，本地 `wrangler dev` 与线上读到的绑定就可能不一致；一地改完忘记改另一地，症状是「本地正常、线上某个绑定是空的」。
- 方案 B 还有一个致命组合：如果生成脚本只写了部分绑定，部署会**用不完整配置覆盖线上 Worker**，把 `[assets]`、队列消费者、cron 全部弄丢。

**怎么验证**

```bash
# 在 wrangler.toml 所在目录执行；先构建前端，否则 assets 目录不存在会先报 ENOENT
npx wrangler deploy --dry-run
```

输出必须同时满足：

- `Read N files from the assets directory ...`（N > 0）；
- 绑定表里 D1 / KV / Queue / DO / Vectorize / AI 全部出现；
- 没有 `no wrangler.toml found` 或 `Could not resolve ... binding`。

若必须用方案 B，把「生成脚本输出路径与 `wrangler deploy` 读取路径一致」写成断言（脚本用自身 `import.meta.url` 推导仓库根，不要依赖 `process.cwd()`），并在 CI 里加一步 `test -f <path>/wrangler.toml`。

### Step 2 加 `[assets]` 与 SPA 回退

**做什么**

```toml
[assets]
directory = "../web/dist"          # 相对 wrangler.toml 所在目录，不是相对仓库根
not_found_handling = "single-page-application"
run_worker_first = ["/api", "/api/*", "/dav", "/dav/*", "/agents", "/agents/*", "/cron", "/cron/*", "/health"]
```

**为什么**

- `directory` 是**相对配置文件**的路径。把它当「相对仓库根」写，是 monorepo 里最常见的 404/构建失败来源。
- `run_worker_first` 决定哪些请求先进入 Worker 代码；未命中的请求由静态资源处理，最后落到 SPA 回退（返回 `index.html`）。
- **裸路径必须与通配符同时列**：`/api/*` 不匹配 `/api` 本身。只写通配符时，浏览器直接访问 `/api`（没有尾斜杠）会被 SPA 回退吃掉，返回 HTML，前端拿到 `<!doctype html>` 当作 JSON 解析失败。
- `/dav`、`/agents` 这类非 `/api` 前缀如果漏掉，症状同理但更难定位（WebDAV 客户端报 405，WebSocket 握手返回 HTML）。

**怎么验证**

```bash
# 1) 接口路径不得返回 HTML
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<worker-domain>/api
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<worker-domain>/api/health

# 2) 前端深链必须回退到 index.html
curl -s https://<worker-domain>/some/spa/route | head -c 100

# 3) 静态资源直出
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<worker-domain>/assets/<hash>.js
```

`/api` 返回 `200 application/json` 且 body 不是 HTML，才算过。注意先部署一次再验证——`--dry-run` 不会验证路由。

### Step 3 处理根路径与静态资源的冲突

**做什么**：把后端原本挂在 `/` 的响应（JSON 欢迎页、重定向、版本信息）挪到 `/api` 或 `/api/...`；`/health` 作为专用健康检查保留在 `run_worker_first` 里。

**为什么**：`/` 是 SPA 的入口。Worker 若先拦 `/`，用户打开站点看到的是 JSON；若交给 assets，监控又拿不到健康状态。两者只能各占一条路径，不能共享 `/`。

**怎么验证**

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<worker-domain>/        # 200 text/html
curl -s https://<worker-domain>/health                                                # 200 JSON
curl -s https://<worker-domain>/api                                                   # 200 JSON
```

### Step 4 处理 `_headers` / `_redirects` 与 Pages 专用文件

**做什么**：逐个处理，先分清「Workers 支持」和「只有 Pages 支持」两类。

| 文件/目录 | 在 Workers + assets 下的处理 |
| --- | --- |
| `_headers` | **保留**。Workers 静态资源原生支持：放到静态资源目录（框架的 `public/` 即可，构建时复制进 `dist`），部署后由 Workers 解析，不对外暴露。只作用于**静态资源响应** |
| `_redirects` | **保留**，但要删掉 SPA 代理规则 `/*  /index.html 200`——`not_found_handling = "single-page-application"` 已经负责回退，两者叠加会把「不存在的静态资源」也变成 200 HTML |
| `_routes.json` | 删除。它只对 Pages Functions 生效；Workers 用 `run_worker_first` 表达同样的意图 |
| `functions/` | 迁成 Worker 路由；无法迁移就说明前置条件不满足（见 1.3 否决条件） |
| `404.html` | 删除或忽略。SPA 模式下发的是 `index.html` |

**为什么**

- 这两份文件的官方支持情况是**支持**，不是「Workers 不支持」：见 Workers → Static Assets → [Headers](https://developers.cloudflare.com/workers/static-assets/headers/)（2026-09 更新）与 [Redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)（2026-08 更新）。旧经验里「只有 Pages 支持」的结论已经过期。
- 但有两条边界必须记住，否则会误判为「文件不生效」：
  1. **不作用于 Worker 代码生成的响应**。官方原文：`Custom headers defined in the _headers file are not applied to responses generated by your Worker code`，并明确点名 `assets.run_worker_first`。所以 `/api`、`/dav`、`/agents` 这些前缀下的响应头必须在 Worker 里 `new Response()` 时自己设。
  2. **`_redirects` 先于 `_headers` 执行**；同一条请求同时命中两者时，重定向优先。
- `_redirects` 的 `200` 是「代理/重写」，官方支持；正因如此，`/*  /index.html 200` 会把**所有**未命中的静态路径都变成 200 的 HTML（包括 `/missing.js`），把 404 掩盖成 200，且与 `not_found_handling` 重复。删掉这条，回退策略只保留一处真相。
- 匹配语法（两文件一致）：`*` splat 全局匹配、只允许一个；`:placeholder` 取单段；`_headers` 单条规则最多 100 条、每行 2000 字符；同一 header 被多条规则命中时**值会用逗号拼接**——这意味着 `/assets/*` 的 `Cache-Control` 与 `/*` 的 `Cache-Control` 不能同时存在，否则得到 `max-age=0, must-revalidate, max-age=31536000, immutable` 这种自相矛盾的值。

**推荐 `_headers` 写法（SPA + PWA 的通用三件套）**

```
# HTML 入口：每次回源校验，发版后立即拿到新 HTML
/index.html
  Cache-Control: public, max-age=0, must-revalidate

/
  Cache-Control: public, max-age=0, must-revalidate

# Service Worker 脚本：一旦被缓存，新 SW 永远装不上
/sw.js
  Cache-Control: no-store

# 带内容哈希的构建产物：长缓存 + immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

它解决的具体问题：

- **PWA 更新不生效**：浏览器对 SW 脚本有 24 小时缓存上限且会做字节比对，`no-store` 是唯一可靠做法；否则用户会长期停留在旧 SW，旧 SW 又继续吐旧 `index.html`，表现为「部署成功但用户看不到新版本」。
- **首屏拿到旧 HTML**：`index.html` 引用的 hash 文件名每次发版都变；HTML 一旦被长缓存，用户会引用已经不存在的 chunk，控制台 404、页面白屏。`max-age=0, must-revalidate` 保证拿到新 HTML 再加载新 chunk。
- **静态资源重复下载**：`/assets/*` 文件名含 hash，内容不可变，可以放心 `immutable` 一年。

不要用 `/*` 给全站设 `Cache-Control`：它必然与 `/assets/*` 同时命中，同名字段被逗号拼接后得到一个自相矛盾的值。深链（SPA 回退返回的 HTML）不需要额外规则——默认的 `public, max-age=0, must-revalidate` 本来就是安全值。

**怎么验证**

```bash
# 1) 文件确实进了产物目录（public/ 会被原样复制）
pnpm build:web && ls dist/_headers

# 2) 部署后按路径验证（_headers 必须在线上才生效）
curl -sI https://<worker-domain>/sw.js | grep -i cache-control        # no-store
curl -sI https://<worker-domain>/assets/<hash>.js | grep -i cache-control  # immutable
curl -sI https://<worker-domain>/ | grep -i cache-control             # max-age=0, must-revalidate

# 3) 确认没有把 Worker 前缀写进 _headers 的预期里
#    /api /dav /agents /cron /health 的响应头由 Worker 代码负责，_headers 对它们无效
```

发布新版本后，用无痕窗口打开站点，DevTools → Application → Service Workers 确认 SW 已更新（`activated and is running`），Network 面板确认 `index.html` 返回 200 而非 `from disk cache`。

### Step 5 同源改造与 CORS 保留策略

**做什么**

1. 前端 API baseURL 改为**相对路径或空字符串**（`''`），请求变成同源 `/api/...`。
2. 删除构建配置里的 `VITE_API_URL`（本地 `.env`、CI 变量、Builds 环境变量三处都要查）。
3. **保留** CORS 中间件与 `CORS_ORIGINS`，默认留空。

**为什么**

- 同源后浏览器不再发跨域请求，CORS 对网页端已无用；但 API 还可能被 **WebDAV 客户端、移动 App、脚本、旧书签**直接跨域调用。删掉中间件等于悄悄破坏了这些入口。
- 默认空值语义应为「只允许同源」，而不是「允许所有来源」。上线前确认实现里的空值分支是收紧而不是放开。
- `VITE_API_URL` 残留的破坏力被低估：它是**构建期**注入，构建面板里还留着旧 Worker 域名时，产物里会被写死成 `https://old-api.workers.dev/api`，于是「同源改造」白做，表现为 CORS 报错或直接连到旧后端。

**怎么验证**

```bash
# 1) 产物里不得残留任何硬编码 API 域名
grep -rn "workers.dev\|https://.*\/api" <dist目录> | grep -v "sourceMappingURL"

# 2) 同源请求正常
curl -s -o /dev/null -w "%{http_code}\n" https://<worker-domain>/api/health

# 3) 跨域预检仍按白名单工作（把 allowed origin 换成你的白名单域名）
curl -s -o /dev/null -D - -X OPTIONS https://<worker-domain>/api/health \
  -H "Origin: https://allowed.example.com" -H "Access-Control-Request-Method: GET" | grep -i access-control
```

### Step 6 对齐 Builds 的根目录、构建命令、部署命令

**做什么**：先确定「wrangler 配置文件在哪」，Builds 的根目录必须等于该目录。

| 仓库结构 | Builds 根目录 | 构建命令示例 | 部署命令 |
| --- | --- | --- | --- |
| 单包，`wrangler.toml` 在仓库根 | `/` | `pnpm install --frozen-lockfile && pnpm build` | `npx wrangler deploy` |
| monorepo，配置在 `apps/api`，前端在 `apps/web` | `apps/api` | `cd ../.. && pnpm install --frozen-lockfile && pnpm build:web` | `npx wrangler deploy` |
| monorepo，但 Builds 根目录被迫为 `/` | `/` | `pnpm install --frozen-lockfile && pnpm build:web` | `npx wrangler deploy -c apps/api/wrangler.toml` |

**为什么**

- 构建命令里的 `cd` 是**从根目录开始算**的，不是从仓库根算的。`apps/api` 往上一层是 `apps`，再往上一层才是仓库根；写成 `cd ..` 会在 `apps` 下找 `pnpm-lock.yaml`，找不到就直接失败。
- 反过来，如果根目录写成 `/` 却用 `cd ../..`，目录会跑到**仓库外**，构建必挂。
- `wrangler deploy` 默认只读**当前工作目录**的 `wrangler.toml`。根目录与配置文件目录不一致时，必须显式 `-c/--config`，否则报 `no wrangler.toml found`。
- 更稳的写法是避免相对 `cd`：用 `pnpm --dir ../.. install` 或 `pnpm -w`，层级算错时会得到「目录不存在」而不是「在错误目录里跑对了命令」。

**怎么验证**（不要只靠肉眼数层级）

```bash
# 在配置所在目录本地重放 Builds 的构建命令，确认落点正确
cd apps/api && cd ../.. && pwd && ls pnpm-lock.yaml

# 构建产物必须落在 assets.directory 指向的位置
ls -la apps/web/dist | head
```

### Step 7 用构建监视路径挡住 push 自动部署

**做什么**：Builds → Settings → Build watch paths：

- Include：`__none__`（或任何不可能存在的路径）
- Exclude：`*`

**为什么**：默认行为是「push 就构建部署」。一旦 push 会自动部署，Step 8 的顺序保护就失效了——代码可能在 Actions 迁移**之前**就已上线，新代码跑在旧表结构上。线上表现是随机 500，且日志看不出原因。

语义要点（以 Cloudflare 当前文档为准）：

- Exclude 优先于 Include，所以「排除 `*`」可以挡掉一切 push；
- 单次 push 变更文件 ≥3000 或 commit ≥20 时，监视路径会被绕过；
- **手动构建与 Deploy Hook 不受监视路径限制**——这正是我们只保留 Hook 一条部署入口的依据。

**怎么验证**：push 一个真实提交，观察 Cloudflare → 该 Worker → Builds → Build history：

- 不应因这次 push 新增记录（或新增一条被 skip 的记录）；
- then 手动/由 Hook 触发的构建必须正常出现，证明「挡 push 不挡 Hook」。

不要用 Dashboard 的「Disable builds」总开关来达到这个目的：它会连带隐藏/关闭构建配置，与 Deploy Hook 的交互不稳定，一旦关掉就把 Hook 也关了。

### Step 8 用 Deploy Hook 保证「迁移成功后才部署」

**做什么**：GitHub Actions 保留「预检 → 应用迁移」，**迁移成功后**再 POST Deploy Hook；Hook 步骤要显式检查变量存在，缺失就 `exit 1`。

```yaml
- name: Trigger deploy
  if: success()
  env:
    CF_BUILDS_DEPLOY_HOOK: ${{ secrets.CF_BUILDS_DEPLOY_HOOK }}
  run: |
    if [ -z "$CF_BUILDS_DEPLOY_HOOK" ]; then
      echo "::error::缺少 CF_BUILDS_DEPLOY_HOOK，迁移已应用但代码未更新"
      exit 1
    fi
    curl -fsS -X POST "$CF_BUILDS_DEPLOY_HOOK" -H "Content-Type: application/json" \
      -w "\nHTTP %{http_code}\n"
```

**为什么**

- 顺序是这套方案唯一的正确性保证：**先迁移、后上线**。反过来会有一段时间新代码读旧 schema。
- `curl` 不加 `-f` 时，4xx/5xx 也会以 0 退出码「成功」，CI 变绿而实际没触发部署。`-fsS` 让失败暴露。
- 迁移已应用但 Hook 失败，是一个**必须人工介入**的中间态（数据库已前进、代码未更新）。把它显式标成 error，比静默成功安全。

**怎么验证**

1. 故意让迁移步骤失败一次（或临时把迁移文件名改错），确认 Hook 步骤被跳过；
2. 恢复后跑通一次，确认 Hook 步骤有 2xx 输出；
3. 记下 Hook 响应里返回的构建标识（若有），用于到 Builds 侧对账。

### Step 9 secrets 分层：三处各管一件事

**做什么**：明确三类凭据的归属，同一值**不要在两处配置**。

| 类别 | 存放位置 | 放什么 | 特性 |
| --- | --- | --- | --- |
| Worker 运行时密钥 | Dashboard → Worker → Settings → Variables and Secrets（或 `wrangler secret put`） | `JWT_SECRET`、用于加密库内数据的密钥、上游服务 token | 加密存储、不可读回；**新 Worker/新环境首次部署必须手工注入** |
| 构建期变量 | Workers Builds → Build variables | 前端 `VITE_*` 等需要打进 bundle 的值 | 明文进入构建产物；同源后应尽量少 |
| CI 凭据 | GitHub Actions secrets | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、Deploy Hook URL | 只给 Actions 用，不进构建产物 |

**为什么**

- **GitHub Actions secrets ≠ Builds 构建期变量**。这是两个独立存储。同一值在两处各配一遍，必然漂移：改了 GitHub 那边，Builds 里还是旧值，而只有其中一处生效，排查时两边都「看起来是对的」。
- 同源改造后，构建期变量通常**只剩**真正需要进 bundle 的东西；`API_URL` 这类应删掉而不是留空。
- 删掉「每次部署都 `wrangler secret put`」的步骤后，**新环境/重建 Worker 的首次部署会缺密钥**。这不是回归，而是把一次性动作显式化：新环境必须先手工注入，否则登录、加密链路会在运行时直接失败。
- `wrangler secret put` 每次执行都会**创建新版本并立即部署**——放在 CI 里等于每次多一次发版，别把它当配置同步手段。

**怎么验证**

```bash
# 列出当前 Worker 的 secret 名称（值不可读回）
npx wrangler secret list

# 运行时冒烟：能登录即说明 JWT_SECRET 存在且被使用；能读取既有加密记录才说明密钥正确
curl -s -o /dev/null -w "%{http_code}\n" https://<worker-domain>/api/auth/registration-config
```

清单化校验：三张表里**每个值只出现在一处**；`grep` 仓库确认没有任何密钥字样落入代码或文档；确认 Builds 变量里没有 `API_URL` 类残留。

### Step 10 域名切换

**做什么**

1. 先在 `https://<worker>.workers.dev` 完成全部验证（SPA 深链、`/api`、`/dav`、WebSocket、`/health`、cron 触发）。
2. 再把自定义域从 Pages 解绑、绑到 Worker；不要先删 Pages 项目。
3. 若保留跨域调用，更新 `CORS_ORIGINS` 为最终域名；`PUBLIC_URL` 设为最终域名（若代码需要生成绝对链接；同源场景可留空，但必须确认代码有「用请求 Origin 兜底」的分支）。
4. 前端若注册过 Service Worker，发布一个 **kill switch**（取消注册 + 清缓存）后再切域名。

**为什么**

- 自定义域同时只能绑一个目标。先绑定再验证，等于把回滚窗口关掉一半。
- Service Worker 缓存是切换后最常见的「看到旧页面」原因：旧 SW 拦截请求并返回缓存里的旧 `index.html`，新部署看起来没生效。用户侧表现是「清缓存才好」，不要误判为部署失败。
- cookie 若设了 `Domain`，跨子域切换会失效；同域内切换不受影响。

**怎么验证**

```bash
curl -I https://<自定义域>/                      # 200，content-type: text/html
curl -I https://<自定义域>/api/health            # 200，application/json
curl -I https://<自定义域>/dav/ | head -n 1      # 401/207 而非 404/405
```

浏览器侧：无痕窗口打开，确认 Network 面板里没有 `workers.dev` 的跨域请求；DevTools → Application → Service Workers 确认旧 SW 已注销。

### Step 11 回滚路径

**做什么**：准备两条回滚，不要只准备一条。

1. **代码回滚（首选）**：回滚 Worker 到上一个版本。
   - Dashboard → Worker → Deployments → 选择上一版本 → Rollback；
   - 或 `wrangler rollback [version-id]`。
2. **架构回滚**：把自定义域切回 Pages 项目。前提是 Pages 项目与 DNS 记录在切换后至少保留一个观察期（建议跨越一次完整发布 + 一个低峰时段）。

**为什么**

- 单 Worker 的代码回滚是原子的：前端与 API 一起回到上一个版本，不会再出现「前端旧、API 新」的错位。
- 但**数据库迁移不可回滚**。所以回滚只对「代码与 schema 向后兼容」的窗口有效。任何破坏性迁移（删列、改类型、改语义）都必须拆成「先加后用后删」两步，否则代码回滚后仍然 500。

**怎么验证**：在灰度阶段做一次演练——回滚一个版本、确认站点可用、再滚回来。没演练过的回滚路径，等同于没有。

### Step 12 收尾清理

**做什么**：切换稳定后尽快做，避免旧链路继续生效：

- 断开 Pages 项目的 GitHub 连接（否则 push 会顺带发布未验收的前端），或直接删除项目；
- 删除构建期已无用的变量；
- 删除 CI 里已冗余的步骤（每次创建 Vectorize 索引 / 建 Queue / 写 secret）；
- 删除仓库里的生成脚本，并确认**没有任何构建命令还引用它**（Cloudflare 面板里的命令也算）；
- 更新 README / 部署文档 / 架构图里的域名、Worker 名、部署方式描述。

**为什么**：留着 Pages 的 Git 连接是典型的「两条流水线同时跑」，线上版本取决于谁先构建完；留着生成脚本 + 删了脚本却忘改面板，是下一次构建必挂的定时炸弹。

**怎么验证**：`grep -rn` 旧 Worker 名、旧 Pages 域名、旧脚本名、旧环境变量名，四处都应为 0 命中（历史文档/CHANGELOG 可保留但要标注为历史）。

---

## 3. 坑清单

每条按「症状 → 根因 → 正确做法」写。前 13 条来自一次真实的 Pages + Workers 合并迁移。

### 3.1 根目录与 `cd ..` 层级算错

- **症状**：Builds 构建秒失败，日志停在 `pnpm install`，提示找不到 lockfile 或 `No package.json found`。
- **根因**：把「上一级目录」当成仓库根。`apps/api` 的上一层是 `apps`，不是仓库根；若根目录又是 `/`，`cd ../..` 会跑到仓库外。
- **正确做法**：根目录 = wrangler 配置文件所在目录；从该目录数层级到仓库根（`apps/api` → 仓库根是 `../..`，`apps` → 是 `..`）。更稳的是用 `pnpm --dir ../.. install` / `pnpm -w`，让层级错误变成「目录不存在」而不是静默跑错目录。

### 3.2 生成脚本被删后构建命令仍引用它

- **症状**：构建日志 `Cannot find module '/home/runner/work/.../scripts/generate-wrangler.mjs'`（或 MODULE_NOT_FOUND）。
- **根因**：配置从「构建期生成」切换到「入库」时，只改了仓库里的 workflow，Cloudflare 面板里的构建命令仍是旧的那一段。
- **正确做法**：删脚本的那次改动，必须同时改 Cloudflare 面板的构建命令；把「面板配置」当作需要同步的代码来对待，并在文档里写明当前命令原文。

### 3.3 `wrangler.toml` 在 gitignore 里，Builds 检出后没有配置

- **症状**：构建到部署阶段报 `no wrangler.toml found`，或触发 autoconfig 生成一个错误的配置并提 PR。
- **根因**：本地用 `.gitignore` 挡住了配置（历史上因为要注入 id），而 Builds 只看到仓库内容。
- **正确做法**：配置要么入库（推荐，id 属标识符可直接写死），要么在构建命令里**显式生成**并保证生成路径等于部署读取路径。二者只能选一，不能「本地有、云端没有」。

### 3.4 GitHub Actions secrets 被当成 Builds 构建期变量

- **症状**：CI 里 `VITE_*` 正常，线上前端仍请求旧域名；或反过来，本地构建正常、云端构建产物里的变量为空。
- **根因**：GitHub Actions secrets 只注入到 Actions 的 job；Workers Builds 是另一套构建环境，只读 Builds 面板里的变量。
- **正确做法**：选一处作为唯一来源。前端需要进 bundle 的值 → Builds 变量；CI 自己用的凭据 → Actions secrets。同一值不要两处都配，否则必然漂移且难以发现。

### 3.5 监视路径为 `*` 时 push 即构建，顺序保护失效

- **症状**：数据库迁移还没跑完，新版本已经上线，接口随机 500；或者同一次 push 出现两次部署。
- **根因**：Builds 默认「push → 构建 → 部署」，与 Actions 里的 Deploy Hook 形成两条部署路径。
- **正确做法**：监视路径 Include 填不可能存在的路径（如 `__none__`）、Exclude 填 `*`，只保留 Deploy Hook 一条入口。注意单次 push ≥3000 文件或 ≥20 commit 会绕过监视路径，超大推送要拆。

### 3.6 Dashboard 的 Worker 名与配置里的 `name` 不一致

- **症状**：部署成功但流量没变化；或控制台出现两个 Worker，一个在收流量、一个在被部署。
- **根因**：`wrangler deploy` 按配置里的 `name` 定位脚本，Dashboard 上的名字只是显示；两者不同就是两个不同的 Worker。
- **正确做法**：改名必须在 Cloudflare 侧和仓库配置里同一次完成，并核对自定义域、Deploy Hook、cron、队列消费者都挂在新名下。

### 3.7 改名撞上 Durable Object 命名空间与 `JWT_SECRET`

- **症状**：改名后 WebSocket 会话全部「消失」；或换 `JWT_SECRET` 后，库里的密文全部解不开（表现为上游 API 调用 401/解密异常）。
- **根因**：① Durable Object 命名空间与 Worker 名绑定，改名等于换命名空间，旧名下的对象数据不会被新脚本读到；② 若 `JWT_SECRET`（或派生密钥）参与**加密存储数据**，它就不只是签名密钥，换值等于让历史密文永久不可解。
- **正确做法**：改名视为「迁移」而非「重命名」——提前导出/接受 DO 数据丢失；`JWT_SECRET` 只轮换一次并配套写一个「用旧密钥解密、新密钥重加密」的脚本与备份，否则不要轮换。任何加密密钥都要在文档里标注「变更影响存量数据」。

### 3.8 删掉 Worker 级 secret 注入步骤，新环境首次部署起不来

- **症状**：新环境/重建 Worker 后，登录 500、加密相关接口全挂，但日志只说「未定义」。
- **根因**：secret 是 Worker 级绑定，跨部署持久，但不跨 Worker/环境；CI 里删掉 `wrangler secret put` 后，没有任何环节会创建它们。
- **正确做法**：把「首次部署手工注入 secret」写进部署文档的固定步骤，并配一条冒烟请求（能拿到配置/能登录）作为验收。日常部署不应再执行 `secret put`（每次都会多发一版）。

### 3.9 Pages 仍连着 GitHub，push 会发布未验收的前端

- **症状**：后端迁移失败、部署被挡住，但用户看到的前端已经变了；或同一 commit 前端/后端版本不一致。
- **根因**：Pages 项目的 Git 集成仍在，push 即构建，与 Worker 的部署闸门无关。
- **正确做法**：切换完成、观察期结束后立即断开 Pages 的 Git 连接或删除项目。切换期间如需保留回滚，至少关掉自动部署。

### 3.10 Service Worker 缓存导致切换后看到旧页面

- **症状**：部署成功、版本号已更新，浏览器仍显示旧界面；无痕窗口正常。
- **根因**：旧 Service Worker 拦截请求并返回缓存中的旧 `index.html` 与旧资源清单。
- **正确做法**：切换前保留/新增一个 kill switch 版本（注销 SW + 清缓存），切换后至少观察一个发布周期；验证时用无痕窗口 + Application 面板确认 SW 状态。

### 3.11 `/api` 裸路径被 SPA 回退吃掉

- **症状**：`/api/health` 正常，`/api` 返回 HTML；前端报 `Unexpected token '<'`。
- **根因**：`run_worker_first` 里的 `/api/*` 不匹配 `/api` 本身。
- **正确做法**：裸路径与通配符同时列（`/api`、`/api/*`，其余前缀同理）。验收时对**每个前缀的两种形式**都 curl 一遍。

### 3.12 前端 `VITE_API_URL` 残留导致同源构建拼出错误地址

- **症状**：产物里出现旧 Worker 域名；请求跨域被拦，或直接打到已下线的旧服务。
- **根因**：该变量是**构建期**注入，面板/`.env` 里还留着旧值，代码里又有 `baseURL = import.meta.env.VITE_API_URL`。
- **正确做法**：删除变量 + 代码 baseURL 留空/相对路径；构建后 `grep` 产物确认没有硬编码域名。三处（本地 `.env`、CI、Builds 面板）都要查。

### 3.13 同源改造后把 CORS 一起删了

- **症状**：网页端正常，WebDAV 客户端、移动 App、第三方脚本全部跨域失败。
- **根因**：把「浏览器不再跨域」误判为「不需要 CORS」。
- **正确做法**：保留中间件与 `CORS_ORIGINS`，空值语义设为「仅同源」；白名单只加确定需要的来源。

### 3.14 配置里的表归属写错（TOML 层级）

- **症状**：`wrangler deploy` 报未知字段，或某个绑定在部署后不存在。
- **根因**：TOML 中 `[assets]` 之后出现的裸键属于 assets 表；顶层键（如 `upload_source_maps`、`name`）写在它后面会被解析进错误的表。
- **正确做法**：顶层键统一放文件前部；`[assets]` 及其子项集中在后部；改完用 `wrangler deploy --dry-run` 看绑定表，不要靠肉眼读 TOML。

### 3.15 `--dry-run` 先因 assets 目录不存在而失败

- **症状**：`ENOENT ... dist`，被误判为配置错误。
- **根因**：dry-run 也会读取 `[assets] directory` 并统计文件。
- **正确做法**：先构建前端再 dry-run；把它写成一条固定脚本（`build:web && wrangler deploy --dry-run`）作为提交前校验。

### 3.16 空提交推不触发 workflow

- **症状**：想让流水线重跑，`git commit --allow-empty` 推送后没有任何 run。
- **根因**：workflow 的 `paths` 过滤对「0 个变更文件」不匹配，空提交不满足任何路径模式。
- **正确做法**：改一个真实文件（哪怕是注释）再推；或直接在上一次 run 上 rerun。

### 3.17 写了 `_headers` 却不生效

- **症状**：`dist/_headers` 明明存在，线上 `/sw.js` 仍是旧的 `Cache-Control`；或给 `/api` 配的响应头完全没出现。
- **根因**：① 文件没放在**静态资源目录**（框架的 `public/` 或 `[assets] directory`），构建后不在产物里；② 目标路径被 `run_worker_first` 命中，响应由 Worker 代码生成——官方明确 `_headers` 不作用于 Worker 生成的响应。
- **正确做法**：`_headers` 放 `public/`，构建后 `ls dist/_headers` 确认被复制；只把它用于静态资源（HTML、`/assets/*`、`/sw.js`、图标）；Worker 前缀的响应头在 `new Response()` 时自己设。部署后用 `curl -sI` 逐条核对。

### 3.18 `_redirects` 里的 SPA 规则把 404 变成 200

- **症状**：请求不存在的 `/missing.js` 返回 200 且 `content-type: text/html`；监控里 404 指标归零，缓存/CDN 行为异常。
- **根因**：`/*  /index.html 200` 是「代理/重写」规则（Workers 支持 `200`），优先于其它静态匹配，把所有未命中路径都改写成 HTML；而 `not_found_handling = "single-page-application"` 已经做过同样的事。
- **正确做法**：删掉这条规则，SPA 回退只保留 `not_found_handling` 一处真相。其余真实重定向（`301`/`302`）保留，注意它先于 `_headers` 执行。

---

## 4. 切换前后检查清单

### 4.1 动手前

- [ ] 前端构建产物确认为纯静态，且产物目录与 `[assets] directory` 一致
- [ ] 后端全部顶级路由前缀已列全（含 WebDAV / WebSocket / 健康检查 / cron）
- [ ] 已确认 `JWT_SECRET` 是否参与库内数据加密（若是，禁止随意轮换）
- [ ] 已记录 D1 / KV / R2 / Vectorize / Queue / DO 的 id 与名称
- [ ] 声明式文件已逐项决定：`_headers`（保留并核对路径）、`_redirects`（删掉 `/* /index.html 200`）、`_routes.json` / `functions/` / `404.html`（删除或迁移）
- [ ] 已决定配置入库还是构建期生成（不混用）
- [ ] 已规划回滚：Pages 项目保留期、DNS 记录、自定义域切换顺序

### 4.2 落地时

- [ ] `wrangler deploy --dry-run` 通过：assets 文件数 > 0、绑定表完整
- [ ] `run_worker_first` 覆盖所有前缀，且**裸路径与通配符**都列了
- [ ] `/` 返回 HTML、`/health` 返回 JSON、`/api` 返回 JSON
- [ ] 构建命令层级已用本地重放验证（`pwd` + `ls lockfile`），未依赖肉眼数 `..`
- [ ] Builds 根目录 = 配置文件目录；部署命令能找到 `wrangler.toml`
- [ ] 监视路径为「Include `__none__` / Exclude `*`」，未使用 Disable builds 总开关
- [ ] Deploy Hook 步骤失败会 `exit 1`，`curl` 带 `-f`
- [ ] 三类凭据各归其位，无重复配置
- [ ] 新环境首次部署的 secret 注入步骤已写入文档
- [ ] 前端产物内无硬编码 API 域名（`grep` 通过）
- [ ] Pages 的 Git 自动部署已关闭或已计划关闭

### 4.3 切换后

- [ ] `workers.dev` 域名全链路验证通过（SPA 深链、API、WebDAV、WebSocket、cron）
- [ ] 自定义域已切换，`content-type` 与状态码符合预期
- [ ] `dist/_headers` 存在，且 `/sw.js` 返回 `no-store`、`/assets/*` 返回 `immutable`、`/` 与 `/index.html` 为 `max-age=0, must-revalidate`
- [ ] 无 `workers.dev` 跨域请求残留（浏览器 Network 面板）
- [ ] 旧 Service Worker 已注销，无痕窗口看到新版本
- [ ] 登录、加密数据读取、上游 API 调用三项冒烟通过
- [ ] Actions run 全绿，Hook 步骤返回 2xx
- [ ] Cloudflare Build history 中有由 Deploy Hook 触发的成功构建
- [ ] Active deployment 的时间晚于 Hook 执行时间，且对应目标 commit
- [ ] 完成一次回滚演练并滚回
- [ ] Pages 项目已断开 Git / 已删除
- [ ] 仓库内旧域名、旧 Worker 名、旧脚本名、旧变量名 `grep` 为 0

---

## 5. 可观测性：哪些必须去 Cloudflare 看

### 5.1 GitHub 侧能看到什么

- Actions 各步骤的成功/失败（含迁移预检、迁移应用、Hook 的退出码）；
- Hook 的 HTTP 状态码（前提是 curl 带了 `-w` / `-f`）；
- **看不到**：Builds 的构建日志、构建失败原因、构建耗时、最终上线的版本号。

因此「Actions 全绿」只证明**迁移成功 + Hook 被接受**，不证明部署成功。不要把这两件事合并成一个结论。

### 5.2 Cloudflare 侧必须核对的字段

| 位置 | 字段 | 判断标准 |
| --- | --- | --- |
| Worker → Builds → Build history | **Triggered by** | 应为 `Deploy hook`（或手动），**不应是 `Push`**——若是 Push，说明监视路径没挡住 |
| 同上 | Status | `Success`；失败必看日志里第一步错误的命令原文 |
| 同上 | Commit | 应等于目标 commit 的短 sha |
| 同上 | Duration / 时间戳 | 应晚于 Actions 里迁移步骤的完成时间 |
| Worker → Deployments / Version history | **Active deployment** | 时间应晚于 Hook 执行时间；版本 id 与 Builds 那次构建对应 |
| 同上 | Source / Author / Created | Source 对 Builds 部署常显示为通用的 deployment 来源，**不要只靠它判断来源**，用时间戳 + Build history 的 Triggered by 交叉验证 |
| Worker → Logs | 运行时错误 | 首屏、登录、加密读取三类请求无 5xx |

### 5.3 命令行核对

```bash
# 当前生效版本（Active deployment）
npx wrangler deployments status

# 历史部署（Created / Source / Version）
npx wrangler deployments list

# 实时日志（观察首屏、登录、DB 报错）
npx wrangler tail

# 迁移是否真的应用了
npx wrangler d1 migrations list <DB_NAME> --remote
```

`deployments list` 里的 **Source 字段对 Builds 部署通常显示为 `Unknown (deployment)`**，对 `wrangler secret put` 则显示 `Secret Change`。这与「部署来源」不是同一回事，别用它反推是谁触发的部署。

### 5.4 三个常见误判

1. **把 Hook 2xx 当成部署成功**：Hook 只表示「构建已入队」。必须再看 Build history 的 Status。
2. **把 `deployments list` 最新一条当成这次构建**：注意时间戳时区与排序，用 `Created` 与 Actions 的完成时间对齐。
3. **把「清缓存后正常」当成缓存问题收工**：Service Worker 未注销会持续复发，必须确认 SW 已注销而不只是清了浏览器缓存。
