# OSSshelf 前端 UI 全面审查报告

> **审查基线**：GitHub `Zoroaaa/OSSshelf` 默认分支 `main`，提交 `7da8391`（`fix(audit): 修复对象列表 key 解码与丢失文件明细口径`）
> **拉取方式**：`git fetch origin --prune && git pull --ff-only origin main`，由 `bceec1e` 快进至 `7da8391`
> **审查时间**：2026-11-22
> **审查方式**：5 个专项 Agent 并行静态走查（全局布局与响应式 / 弹窗层级与遮挡 / 核心业务页 / 管理协作页 / 组件一致性与信息架构），主审查方交叉验证关键结论与行号
> **覆盖范围**：桌面（≥1024px）、平板（768–1023px）、移动（<768px）三端；流畅度、视觉美观度、元素协调度、风格统一度、信息架构与页面规划、交互友好度六维度
> **重要说明**：本次为**基于源码的静态审查**，未启动服务、未使用真机/截图。标注的行号均对应基线 `7da8391`。涉及像素溢出、读屏器行为、帧率等动态结论需在修复阶段用真机 / DevTools 复测。

---

## 一、执行摘要

本仓库前端质量基础并不差：集中式 HSL 设计 token、`prefers-reduced-motion` 降级、`touch-visible` 触屏适配类、搜索防抖 + AbortController 竞态保护、路由 `lazy + Suspense` 均已到位。**但存在一处 P0 级全局架构缺陷和一批系统性一致性问题。**

**核心结论（一句话）**：AI 悬浮按钮 `z-[100]` 高于全部业务弹窗的 `z-50`，且隐藏机制只认 `preview-fullscreen` 单一信号，叠加保存确认框的无效类 `z-60`，共同造成"打开文件后 AI 浮层遮挡内容、甚至遮挡保存按钮"；其根因是**全站从未建立层级规范，且已安装的 Radix Dialog 零使用、弹窗全部手写**。

关键数据（去重后）：

| 严重度 | 数量 | 含义 |
|---|---|---|
| **P0 阻断** | 4 | 核心流程不可用 / 数据丢失 / 潜在安全 |
| **P1 严重** | 21 | 主要功能受损、触屏不可用、状态静默失败 |
| **P2 一般** | 33 | 体验、一致性、性能与可访问性缺陷 |
| **P3 优化** | 12 | 打磨项 |
| **合计** | **70** | 已按设备/页面/组件归类，见第五节 |

三个最高价值的系统性根因（一处修复可消除大量问题）：

1. **无统一弹窗/层级基础设施** —— 31+ 处手写 `fixed inset-0` 弹窗、z 值横跨 `z-10 ~ z-[10000]`，Radix Dialog 只装不用。
2. **hover-only 交互未全局适配触屏** —— 项目已有 `.touch-visible`，但 Tags / Teams / AI 聊天 / 笔记等模块遗漏。
3. **自绘渲染器 + 原生 confirm/alert 泛滥** —— 3 套 Markdown、4 份 Spinner、约 47 处原生弹窗，风格与安全双重隐患。

---

## 二、已知问题专项根因分析（P0-01）

### 2.1 现象

移动端 AI 对话相关浮层层级过高，打开文件后仍遮挡内容，甚至遮挡保存按钮。

### 2.2 证据链（层叠关系实测于源码）

| 元素 | 位置 | z-index | 说明 |
|---|---|---|---|
| AI 悬浮按钮 FAB | `components/ai/AIChatWidget.tsx:33` | `z-[100]` | 全局挂载于 `MainLayout.tsx:361`；`/ai-chat` 路由也在 MainLayout 内（`App.tsx:154-156,355,363`），对话页同样显示 |
| FAB 隐藏逻辑 | `AIChatWidget.tsx:19-28` | — | 仅用 MutationObserver 监听 `document.body` 是否含 `preview-fullscreen` class |
| 唯一写入该 class 处 | `FilePreview.tsx:324-326` / 移除 `:328-331` | — | **仅当 `isMobile && file`**（`useResponsive.ts:107`，断点 `max-width:767px`） |
| 业务弹窗通用层级 | `FilePreview.tsx:341`、`FileEditor.tsx:223`、`ShareDialog.tsx:46`、`MigrateBucketDialog.tsx:159`、`NoteEditor.tsx:80` 等 30+ 处 | `z-50` | 全部低于 FAB |
| 保存确认框 | `components/editor/FileEditor.tsx:252` | **`z-60`（无效类）** | Tailwind 3 默认 zIndex scale 仅 0/10/20/30/40/50/auto；`tailwind.config.js:13-118` 未扩展 zIndex → 该类**不生成任何 CSS**，层级完全依赖 DOM 顺序 |
| AI 工具弹窗 | `chat/ToolInfoModal.tsx:33` | `z-[120]` | 高于 FAB、Toast、所有业务弹窗 |
| AI「更多」菜单 | `chat/ChatHeader.tsx:124` | `z-[120]` | 与工具弹窗同值 |
| 消息右键菜单 | `pages/AIChat.tsx:699` | `z-[110]` | 高于全部业务弹窗 |
| Toast | `ui/Toast.tsx:16` | `z-[100]` | 与 FAB 同值，桌面右下角位置重叠，`MainLayout.tsx:358,361` 中 FAB 更靠后 → 盖住 Toast |

### 2.3 三层叠加根因

1. **层级倒挂**：FAB `z-[100]` > 所有业务弹窗 `z-50`。任何弹窗（预览/编辑/分享/迁移/笔记/详情）打开时，FAB 都悬浮于其上，遮挡右下角区域 —— 这是"打开文件后仍遮挡内容"的直接原因。
2. **隐藏机制与弹窗状态脱节**：FAB 只在 `preview-fullscreen` 存在时隐藏，而该 class 仅由 FilePreview 且仅在 <768px 设置。从 AI 对话页 `@` 引用/拖拽打开编辑器、笔记、分享弹窗，或**平板 768–1023px 打开文件预览**（`isMobile=false`）时，FAB 均不隐藏。
3. **保存按钮层级失控**：编辑器"保存"按钮（`FileEditor.tsx:231`）弹出的"保存更改"确认框用无效类 `z-60`（`:252`），无有效 z-index，可被 `z-[100]` FAB、`z-[110]` 右键菜单、`z-[120]` 工具弹窗任意覆盖 —— 这是"遮挡保存按钮"的直接层级根因。

### 2.4 复现场景

1. 移动端 390×844 进入 `/ai-chat` → 点击消息中的文件卡片（`AIChat.tsx:260-284` → `setPreviewFile` → `:726` 内嵌 FilePreview）→ 点"编辑"（`FilePreview.tsx:627-638` 渲染 z-50 编辑器）→ 修改后点"保存" → "保存更改"确认框被浮层覆盖，保存按钮不可点。
2. 平板 900×1200 打开文件预览 → `isMobile=false` 不加全屏 class → `z-[100]` FAB 直接盖在 z-50 预览窗右下角。

### 2.5 同类扩散（同源问题）

- `ContextMenu.tsx:110,190` 用 `z-[9999]/z-[10000]` 极端魔数，键盘打开新弹窗时残留于顶层。
- `VersionHistory.tsx:152` 的 `z-[60]` 版本历史与 `FilePreview` z-50 形成 dialog 套 dialog（`Files.tsx:1878,1885-1890`），FAB 仍盖其上。
- `SWUpdatePrompt.tsx:27` 的 `z-[60]`、`PWAInstallPrompt.tsx:154` 的 `z-50` 均未纳入统一层级。
- `Toast.tsx:69` 关闭按钮 `opacity-0` 仅 hover 可见，触屏无法主动关闭。

---

## 三、按设备视角的问题概览

> 详细逐条清单见第五节（按页面/组件组织）；本节按设备归纳，便于按终端排期。

### 3.1 移动端（<768px）

- **P0** AI 浮层遮挡内容/保存按钮（P0-01）；团队切换器完全依赖 hover，触屏打不开，多团队用户被阻断（P1-09，本节设备维度视为阻断）。
- **P1** Tags 页重命名/删除按钮触屏不可见（C-01）；验证码输入框 328px 在 320px 视口溢出（D-08）；团队工作区 12 栅格挤压、操作列仅 53–62px（D-10）；团队/AI 列表 hover-only 操作不可见（D-09）；笔记卡片操作仅 hover 可见（E-05）。
- **P2** 顶栏安全区与固定 `pt-16` 冲突（B-01）；底栏实高约 90px 而 `main` 仅 `pb-20`（B-02）；批量操作栏、面包屑、分页条、预览底栏横向溢出（C-04/C-11/C-16/C-06）；17 项右键菜单无滚动容器（C-07）；外链分享页点击文件行无响应（C-14）。
- **P3** FAB/PWA 提示与底栏重叠（B-06）；横屏 fixed 栏不避让左右安全区（B-13）；Toast 未叠加 `safe-top`（B-14）。

### 3.2 平板（768–1023px）

- **P1** Files 页顶部工具栏（`hidden md:flex` ≥768）与移动底栏（`lg:hidden` <1024）**同时出现**，控件重复（C-03）；预览时 FAB 不隐藏（P0-01 衍生）；触屏 ListItem 一长排 9 个 28px 按钮常显（C-21）。
- **P2/P3** 无平板专属导航形态，沿用被拉伸的移动底栏（B-03）；"更多"抽屉无 `role=dialog`/Esc/焦点陷阱（B-04）；`100vh`/`100dvh` 混用（B-11）。

### 3.3 桌面（≥1024px）

- **P1** Esc 关闭预览绕过编辑器未保存确认，静默丢数据（C-02）；原生 `confirm()` 操作风格割裂（C-10/D-05）。
- **P2** Toast 与 FAB 右下角重叠（P0-01 衍生）；折叠侧栏 hover 展开覆盖主内容（B-09）；GridItem 点缩略图无响应（C-20）；30+ 手写弹窗无焦点陷阱/滚动锁（A 类）。
- **P3** 侧栏 15 项平铺无分组、用 `<Link>` 无 `aria-current`（E-24）；布局切换时文件网格列数抖动（B-10）。

---

## 四、按维度的问题概览

| 维度 | 现状评价 | 主要短板 |
|---|---|---|
| 流畅度 | 良（lazy/Suspense、防抖、reduced-motion 到位） | 面包屑 N 次串行请求、列表无虚拟化、批量清理 N+1 mutation、SSE 重连定时器泄漏 |
| 视觉美观度 | 中 | 硬编码调色板绕过 token（600+ 处）、字号 5 档并存、emoji 与 lucide 混用 |
| 元素协调度 | 中 | FAB/PWA/Toast/底栏互相压盖、批量栏与预览底栏溢出、双下划线 Tab |
| 风格统一度 | 较差 | 4 套自研弹窗 + Radix 只装不用、47 处原生弹窗、3 套 Markdown、4 份 Spinner |
| 信息架构与页面规划 | 中 | 平板无独立形态、导航平铺无分组、全站静态 document.title、无 404 页、设备管理无入口 |
| 交互体验友好度 | 较差 | 层级倒挂、触屏操作不可见、无焦点陷阱/滚动锁、失败静默、危险操作确认分级缺失 |

---

## 五、问题清单（按页面/组件组织，含复现/影响/原因）

> 严重程度：**P0** 阻断/数据丢失/安全；**P1** 主要功能受损；**P2** 体验与一致性；**P3** 打磨。
> 设备：**M** 移动 / **T** 平板 / **D** 桌面 / **ALL** 全端。

### A 类：层级、遮挡与交互冲突（弹窗基础设施）

| 编号 | 设备 | 页面/组件 | 位置 | 问题描述 | 复现场景 | 影响范围 | 级别 | 可能原因 |
|---|---|---|---|---|---|---|---|---|
| P0-01 | M/T | AI 悬浮按钮 + 全站弹窗 | `AIChatWidget.tsx:19-33`、`FileEditor.tsx:252` | AI FAB z-[100] 高于全部 z-50 弹窗；仅认 `preview-fullscreen` 单一信号隐藏；保存确认框 `z-60` 为无效类 | 见 2.4 节 | 全应用弹窗，写入链路被阻断 | **P0** | 无层级规范；无效 Tailwind 类；隐藏条件与弹窗状态脱节 |
| A-02 | ALL | 全局层级体系 | `AIChatWidget.tsx:33`、`ToolInfoModal.tsx:33`、`ChatHeader.tsx:124`、`AIChat.tsx:699`、`ContextMenu.tsx:110,190`、`Toast.tsx:16` | z 值横跨 z-20~z-[10000]，无语义分层，多浮层靠 DOM 顺序决胜 | 任意多浮层叠加 | 全应用 | **P0** | 从未建立 zIndex token/规范 |
| A-03 | ALL | 弹窗实现范式 | `package.json:17` 依赖 Radix Dialog 但源码零使用；`ShareDialog.tsx:46` 等 31+ 处 | 全部手写 `fixed inset-0`，无 Portal/焦点陷阱/aria-modal/滚动锁/Escape 一致性 | 键盘打开任意弹窗 | 全应用可访问性与健壮性 | **P0** | 依赖已装未采用，无统一基类 |
| A-04 | ALL | 移动端 AI 工具弹窗/菜单 | `ToolInfoModal.tsx:33`、`ChatHeader.tsx:124` | z-[120] 高于 Toast 与全部业务弹窗，无焦点陷阱/滚动锁 | 更多→可用工具 | AI 对话页 | P1 | 手写浮层 + 过高魔数 |
| A-05 | ALL | AI 消息右键菜单 | `pages/AIChat.tsx:699` | z-[110] 手写菜单；打开 FilePreview(z-50) 时若未关闭会残留顶层 | 右键消息→点文件预览 | AI 对话页 | P1 | 魔数层级 + 关闭事件不覆盖弹窗打开 |
| A-06 | M | AI 会话历史抽屉 | `ChatSidebar.tsx:104,110` | 遮罩 z-20、抽屉 z-30，低于 FAB；抽屉打开时 FAB 仍可点跳走 | 移动端点会话历史 | AI 对话页 | P1 | 抽屉层级整体偏低 |
| A-07 | ALL | Toast | `Toast.tsx:16,69` | 与 FAB 同 z-[100] 且桌面位置重叠被盖；关闭按钮 hover 才可见触屏无法关；无 success/warning 变体；TOAST_LIMIT=1 挤掉旧提示 | 桌面右下角触发 toast / 手机点关闭 | 全应用 | P1 | 照搬 shadcn 默认未做触屏适配 |
| A-08 | ALL | 右键菜单 | `ContextMenu.tsx:110,190` | z-[9999]/z-[10000]；仅在 mousedown/Escape/scroll 关闭，键盘开新弹窗时残留 | 右键后按快捷键开弹窗 | 全应用 | P1 | 魔数 + 关闭逻辑不全 |
| A-09 | ALL | 快捷键帮助对话框 | `KeyboardShortcutsDialog.tsx:78` | z-50 手写 div，无 Escape/点外关闭/Portal/焦点陷阱/滚动锁 | 快捷键打开帮助 | 全应用 | P1 | 手写弹窗交互缺失 |
| A-10 | M/D | PWA 安装提示 | `PWAInstallPrompt.tsx:90` | z-40 且 `bottom-20` 与 FAB 位置重叠，安装按钮被 FAB 盖 | 首次安装提示出现 | 全应用 | P1 | 层级低于 FAB + 位置冲突 |
| A-11 | ALL | 团队工作区右键菜单 | `TeamWorkspace.tsx:1064` | 浮层 z-[100]，与 FAB/Toast 同值靠 DOM 顺序 | 团队工作区右键 | 团队页 | P2 | 魔数层级 |
| A-12 | ALL | 预览→版本历史嵌套 | `Files.tsx:1878,1885-1890`、`VersionHistory.tsx:152` | dialog 套 dialog：点历史未关预览，z-50 + z-[60] 并存，FAB 仍盖其上 | 预览内点"历史" | 文件预览 | P1 | 嵌套弹窗无层级递增与关闭管理 |
| A-13 | ALL | 多弹窗并存 | `Files.tsx:1650-1707` | share/folderPicker/uploadLink/detail/migrate 等独立 state 可同时为 true，各自 z-50 | 连续触发多个操作 | 文件页 | P2 | 缺单一弹窗栈管理 |
| A-14 | M/T | 全局右键菜单可用性 | `ContextMenu.tsx:46-62,84-95,108-112` | 依赖鼠标右键，移动端无长按替代；17 项菜单无 max-height/overflow-y，末项不可达 | 手机长按文件 / 点⋮ | 移动文件操作 | P2 | 无触摸适配与滚动容器 |
| A-15 | ALL | Escape 关闭不一致 | `FilePreview.tsx:316-321` 有；`ShareDialog.tsx:46`、`MigrateBucketDialog.tsx:159`、`NoteEditor.tsx:80` 无 | 部分弹窗响应 Escape，部分无 | 键盘用户关闭弹窗 | 全应用 | P2 | 无统一弹窗基类 |
| A-16 | ALL | 滚动锁定不一致 | `MobileDialog.tsx:50,56` 是唯一实现且 cleanup 为空 | 其余 z-50 手写弹窗不锁 body；弹窗内跳转导致锁永不释放 | 弹窗打开后滚动 / 弹窗内跳转 | 全应用 | P1 | 无统一滚动锁与引用计数 |
| A-17 | ALL | 点外部关闭不一致 | `FilePreview.tsx:344` 有；`ShareDialog.tsx:46` 等无 | 关闭行为不统一 | 点击遮罩 | 全应用 | P2 | 无统一弹窗基类 |
| A-18 | ALL | MobileDialog 焦点 | `MobileDialog.tsx:46-70,103-185` | 有 Portal/滚动锁/Escape，但无焦点陷阱与关闭后焦点归还 | 打开基于 MobileDialog 的弹窗 | 全应用 | P1 | 手写组件交互不完整 |
| A-19 | ALL | 危险操作确认分级缺失 | `AISettings.tsx:300-320,353-371,621-624`、`Admin.tsx:284-300`、`TeamList.tsx:58`、`VectorsTable.tsx:198-217` | 清空向量库/记忆、重建索引、群发邮件、删除团队仅原生 confirm，无后果摘要与输入式确认；危险按钮样式无主次 | 管理员执行破坏性操作 | 高权限用户 | P1 | 无 ConfirmDialog 与风险分级策略 |
| A-20 | ALL | 原生弹窗泛滥 | 全站约 47 处（统计见工具核验） | confirm/alert 与自建 Toast/MobileDialog 三套视觉并存，原生弹窗阻塞、移动端突兀且可能被浏览器静默拦截 | 删除文件/团队/API Key | 全应用 | P1 | 缺少共享 ConfirmDialog 服务 |
| A-21 | ALL | 导航层与弹窗层同值 | `index.css:161,165,173,207,214,218,223,233,237`、`MainLayout.tsx:158,198` | 导航 z-40/50 与弹窗 z-50 同值，弹窗未高于导航 | 弹窗打开时导航仍可点 | 全应用 | P2 | 导航层与弹窗层未分离 |
| A-22 | ALL | 离线横幅/SW 更新 | `PWAInstallPrompt.tsx:154`、`SWUpdatePrompt.tsx:27` | 离线横幅 z-50 覆盖 AI 页 header（无 z-index）；SW 更新 z-[60] 高于业务弹窗 | 断网或新版本就绪时 | 全应用 | P2 | 系统提示未纳入统一层级 |

### B 类：全局布局与响应式

| 编号 | 设备 | 页面/组件 | 位置 | 问题描述 | 复现场景 | 影响范围 | 级别 | 可能原因 |
|---|---|---|---|---|---|---|---|---|
| B-01 | M | 顶栏与主内容 | `MainLayout.tsx:158,342`、`index.css:84-86` | 顶栏 `py-2.5` 与 `safe-top` 争用 padding-top，刘海机顶栏约 94px 而 main 固定 `pt-16`(64px) → 约 30px 内容被压；或安全区失效 | iPhone X+ 竖屏 PWA 打开任意页 | 全移动页 | P1 | 安全区与固定高度重复声明，pt-16 硬编码 |
| B-02 | M | 主内容区底部 | `index.css:160-162`、`MainLayout.tsx:342` | `.mobile-nav` 实高约 56+34=90px，`main` 仅 `pb-20`(80px)，末行被盖 | Home 条机型滚到页面底部 | 全移动长列表 | P2 | pb 静态值未叠加 safe-area |
| B-03 | T | 全局导航 | `MainLayout.tsx:158,196-201,341-343`、`MobileBottomNav.tsx:110,151`、`tailwind.config.js:5-13` | 仅用 lg(1024) 二分，无平板形态；5 项底栏被拉伸到 800–1000px，14 项完整导航只能进"更多" | 900px 宽度对比 1280px | 全平板页 | P2 | screens 未扩展，组件未用 md: |
| B-04 | M/T | "更多"抽屉 | `MobileBottomNav.tsx:88-97,150-270` | 原生 div 无 role=dialog/aria-modal/焦点陷阱，Esc 无法关闭，Tab 可到背景 | 点底栏"更多"后按 Esc | 所有用抽屉页 | P2 | 未用 Radix Dialog |
| B-05 | ALL | 首屏主题 | `index.html:45-67`、`main.tsx:19-36`、`index.css:7-13` | 内联 CSS 用 hex token，应用用 HSL 三元组；持久化主题只在 JS 二次应用 → 首屏先按系统着色再翻转 | 系统浅色/用户深色时刷新 | 全站首屏 | P2 | 缺前置主题脚本，两套 token 格式并存 |
| B-06 | M | AI FAB / PWA 提示 | `AIChatWidget.tsx:33`、`PWAInstallPrompt.tsx:90` | `bottom-20` 未含安全区，实高 90px 底栏下 FAB 盖住右下导航项；PWA 提示与 FAB 叠放 | Home 条机型 + 安装提示出现 | 移动底部交互区 | P2 | 多个 fixed 元素各自硬编码偏移与 z |
| B-07 | M | 全屏文件预览 | `FilePreview.tsx:325,341`、`MainLayout.tsx:158` | 预览全屏时隐藏底栏与 FAB，但顶栏未监听 `preview-fullscreen`，与遮罩同 z-50 靠 DOM 顺序覆盖 | 移动打开预览看顶栏是否透出 | 移动预览态 | P3 | 缺统一 fullscreen 层级约定 |
| B-08 | ALL | 滚动锁定冲突 | `MobileBottomNav.tsx:88-97`、`index.css:74` | 直接写 body.style.overflow='hidden'，与全局 overflow-x:hidden 及其它弹窗锁并存，关闭任一层可能提前解锁 | 抽屉打开时再开 Dialog 后关抽屉 | 弹层叠加场景 | P3 | 无引用计数的统一 scroll-lock |
| B-09 | D | 侧边栏折叠 | `MainLayout.tsx:196-204,330-335,341` | 折叠 w-16、hover 展开 w-64，但 main 始终 `lg:pl-16` → 展开覆盖约 192px 内容且无阴影提示 | 折叠后悬停展开点主内容左缘 | 桌面左侧交互 | P3 | hover 预览层未与内容布局联动 |
| B-10 | ALL | 布局切换动画 | `MainLayout.tsx:198,340-343` | 侧栏与 main 同时 transition-all，main padding 插值引发 max-w 容器与 file-grid 列数反复重排抖动 | 反复点折叠按钮 | 流畅度 | P3 | 动画属性过宽，触发网格重排 |
| B-11 | ALL | 视口高度单位 | `MainLayout.tsx:342`、`index.css:79`、`index.html:71` | #root 用 100dvh，main 用 `min-h-[calc(100vh-4rem)]`，两套单位混用 | 移动 Chrome/Safari 地址栏展开时 | 移动视口 | P3 | dvh/vh 未统一 |
| B-12 | M | 触控目标/折叠按钮 | `index.css:124-127`、`MainLayout.tsx:186,330-335` | touch-target-sm 仅 36px；主题按钮 h-9w-9(36px)；折叠按钮 24px 且无 aria-label | 点击顶栏图标 / 读屏识别折叠按钮 | 可访问性 | P3 | 触控尺寸与可访问名称缺失 |
| B-13 | M | 横屏安全区 | `index.html:99-104`、`MainLayout.tsx:158`、`index.css:160-162` | body 处理左右安全区，但 fixed 顶栏/底栏不受 body padding 影响，横屏刘海侧压住导航项 | iPhone 横屏访问 | 横屏导航 | P3 | fixed 元素未加 safe-x |
| B-14 | M | Toast 安全区 | `Toast.tsx:16` | 移动 `fixed top-0 p-4` 未叠加 safe-top，遮住状态栏区域 | 刘海机触发 Toast | 移动可读性 | P3 | 只做 sm: 断点未接安全区 |
| B-15 | ALL | 断点一致性 | `index.css:181-204` vs `MainLayout.tsx:158,196` | 布局层只认 lg，file-grid 用 375/sm/md/lg 四档，网格列数与导航形态切换不同步 | 拖窗口过 640/768/1024px | 风格统一度 | P3 | 断点语义不一致 |

### C 类：核心业务页面

| 编号 | 设备 | 页面/组件 | 位置 | 问题描述 | 复现场景 | 影响范围 | 级别 | 可能原因 |
|---|---|---|---|---|---|---|---|---|
| C-01 | M/T | Tags 页操作按钮 | `Tags.tsx:331,567` | 重命名/删除/移除标签按钮 `opacity-0 group-hover` 且未带 `touch-visible`，触屏完全不可见 | 手机进 /tags 看标签行右侧 | 触屏标签管理不可用 | P1 | 复制桌面写法，遗漏项目已有约定 |
| C-02 | ALL | FilePreview + FileEditor | `FilePreview.tsx:316-332`、`FileEditor.tsx:184-191` | 编辑器有未保存确认，但 FilePreview 全局 Esc 直接 onClose，绕过确认静默丢编辑内容 | 编辑 .md 改动后按 Esc | 数据丢失 | P1 | 两个模态各自注册键盘事件，缺层级仲裁 |
| C-03 | T | Files 工具栏 | `Files.tsx:1066`、`MobileFilesToolbar.tsx:65` | 桌面工具栏 `hidden md:flex`(≥768) 与移动底栏 `lg:hidden`(<1024) 区间重叠，两套控件同时出现 | 900px 打开 /files | 平板文件浏览 | P1 | 断点边界 md/lg 未统一 |
| C-04 | M | Files 批量操作栏 | `Files.tsx:1421-1555` | 5 个带文字按钮无 flex-wrap，窄屏横向溢出 | 360px 勾选文件 | 批量操作可达性 | P2 | 按桌面宽度设计 |
| C-05 | M | FilePreview 底栏 | `FilePreview.tsx:641-717` | 缩放组约 90px + 最多 7 个 40px 按钮约 370px，360px 手机溢出 | 手机预览可编辑文本 | 预览操作可用性 | P2 | 按按钮数线性排列无"更多"折叠 |
| C-06 | ALL | 纯文本预览缩放 | `FilePreview.tsx:553-560` | zoom 设在外层 style，内层 `text-sm` 固定字号覆盖继承，缩放按钮无效但按钮仍显示 | 打开 .txt 点放大 | 文本预览功能 | P2 | 固定字号类覆盖内联百分比 |
| C-07 | M | 文件右键菜单 | `ContextMenu.tsx:46-62,84-95,108-112`、`useFileContextMenu.tsx:44-153` | 17 项菜单高度约 612px，无 max-height/overflow，滚动时菜单关闭，末项不可达 | 360×640 点⋮后找"移入回收站" | 触屏文件操作 | P2 | 桌面 fixed 定位未做移动抽屉适配 |
| C-08 | ALL | Files 目录导航 | `Files.tsx:212-227` | 面包屑 while 循环内逐级 await，深度 N 产生 N 次串行请求 | 打开 5 层深目录看 Network | 导航流畅度 | P2 | 逐父查询代替后端返回 path |
| C-09 | ALL | 文件列表/搜索 | `FileListContainer.tsx:79-100,107-129`、`useFileSearch.ts:72,83,96`、`GridItem.tsx:135-142` | 无虚拟滚动，单页/搜索最多 100 项、标签搜索无上限；网格 100 项各发一个预览请求 | 网格视图每页 100 或搜索命中大量文件 | 大列表流畅度 | P2 | 依赖分页替代虚拟化，搜索路径无上限 |
| C-10 | M | 确认交互 | `Files.tsx:787,839`、`FileListContainer.tsx:90,118`、`Shares.tsx:159,162` | 大量原生 confirm/alert，与 MobileDialog 风格割裂 | 手机批量删除/删除分享 | 风格统一 | P2 | 历史遗留未迁移 |
| C-11 | M | BreadcrumbNav | `BreadcrumbNav.tsx:37,52,54-65` | flex 无 wrap/overflow-x-auto，deep path 撑破页面；末项是无效 button 且触屏无 title 提示 | 手机进多级子目录 | 目录导航可读性 | P2 | 按桌面长路径设计 |
| C-12 | ALL | FilePreview 初始化 | `FilePreview.tsx:207-277` | 打开一次预览触发 getInfo + getPresignedPreviewUrl(失败回退) + filesApi.get + getRaw(失败 fetch) 共 3–4 请求 | 预览任意文件看 Network | 预览流畅度 | P2 | 元信息与内容接口拆分未聚合 |
| C-13 | ALL | FilePreview 模态层 | `FilePreview.tsx:337-350` | 无 role=dialog/aria-modal/aria-label，无焦点陷阱与焦点返还 | 键盘打开预览后 Tab | 可访问性 | P2 | 自绘模态未接无障碍能力 |
| C-14 | M | SharePage 文件夹视图 | `SharePage.tsx:381-386,422` | 文件行 `cursor-pointer` 且整行 onClick 但点击无响应（仅文件夹生效），必须点操作区小图标 | 手机打开文件夹分享链接点文件 | 外链核心路径 | P2 | 复用文件夹导航点击未补文件预览 |
| C-15 | ALL | Tags 分页 | `Tags.tsx:615-618`、`Pagination.tsx:4,70-80` | `TAG_PAGE_SIZE as 20` 强转，实际 limit=10；每页条数下拉仅 20/50/100 且回调为空 | /tags 看底部分页 | 分页信息正确性 | P2 | 通用分页类型未适配业务 limit |
| C-16 | M | Pagination | `Pagination.tsx:63-90,95,109,130` | h-7w-7(28px) 低于 44px，4 箭头 + 5 页码窄屏溢出 | 手机翻到中间页 | 分页可用性 | P2 | 桌面尺寸平移 |
| C-17 | ALL | Trash 页 | `Trash.tsx:102-105` | "N 个文件等待清理"用当前页 items.length（上限 50）而非 query 的 total | 回收站 120 项时显示 50 | 信息准确性 | P2 | 未用已有 total 字段 |
| C-18 | ALL | Shares 清理失效链接 | `Shares.tsx:161-163,187-189` | ids.forEach 逐条 mutate，N 条产生 N 个 DELETE + N 次列表重取，无并发限制与部分失败反馈 | 30 个失效链接点清理 | 请求风暴 | P2 | 缺批量 API（Tags 已有 batchApi.delete） |
| C-19 | ALL | Dashboard 最近上传 | `Dashboard.tsx:160-165` | 每行是文件但点击只跳所在文件夹，不预览、不高亮 | 首页点"最近上传"某文件 | 首页到文件效率 | P2 | 未用 `?preview=<id>` 深链（Files 已支持） |
| C-20 | D | GridItem 网格视图 | `GridItem.tsx:126-131,218` | 桌面点图片/图标区无反应，只有点文件名才打开；移动分支整卡可点 | 桌面网格视图点缩略图 | 交互一致性 | P2 | onClick 下移到文字区忘补图片区 |
| C-21 | T | ListItem 操作列 | `ListItem.tsx:221-264`、`ActionBtn.tsx:26` | 768–1023 走桌面分支，触屏下 9 个 28px 按钮常显挤压文件名 | 触屏平板竖屏进 /files | 平板触控体验 | P2 | 触控适配只覆盖 <768 |
| C-22 | ALL | Starred 页 | `Starred.tsx:21-25` | list starred 无 limit/无分页，收藏多时全量渲染无虚拟化 | 收藏大量文件 | 流畅度 | P3 | 未复用 Files 分页方案 |
| C-23 | ALL | 文件名解码 | `Starred.tsx:75`、`Tags.tsx:549`、`Shares.tsx:356` | 直接用 file.name，其余页用 decodeFileName，特殊字符显示不一致 | 含特殊字符文件名 | 信息一致性 | P3 | 未统一解码 |
| C-24 | ALL | Files 分页重置 | `Files.tsx:285-287,798-801` | currentPage 仅在 folderId 变化时重置，切换排序后停留原页可能空结果 | 翻到第 3 页后改排序 | 分页正确性 | P3 | 重置依赖漏 sortBy/sortOrder |
| C-25 | ALL | FilePreview 默认值 | `FilePreview.tsx:95-100,213-214` | 移动端初始化 zoom=75/windowSize=fullscreen，但文件变化时重置为 100/medium | 移动打开预览 | 默认值失效 | P3 | 副作用覆盖初始化 |
| C-26 | M | 外链上传页 | `SharePage.tsx:559-574` | handleUploadAll 用 for...await 串行上传，无并发（主 Files 用 runWithConcurrency(files,3)） | 手机外链多文件上传 | 上传耗时 | P3 | 未复用并发工具 |
| C-27 | ALL | 标签/权限/文件夹弹窗 | `Files.tsx:1899-1970` | 三个弹窗手写 fixed inset-0 max-w-md，同页 RenameDialog 已用 MobileDialog | 文件页打开多个管理弹窗 | 风格统一 | P3 | 迁移不彻底 |
| C-28 | ALL | FilePreview AI 提示 | `FilePreview.tsx:141,160` | 摘要/标签生成失败用 alert()，与 toast 体系不一致 | AI 摘要失败 | 风格统一 | P3 | 历史遗留 |

### D 类：管理与协作页面

| 编号 | 设备 | 页面/组件 | 位置 | 问题描述 | 复现场景 | 影响范围 | 级别 | 可能原因 |
|---|---|---|---|---|---|---|---|---|
| D-01 | M/T | Teams 团队切换器 | `pages/Teams.tsx:71-105` | 完全依赖 CSS hover：按钮无 onClick，下拉用 opacity-0 invisible group-hover，触屏无 hover 根本打不开；键盘也无法 Tab 打开 | 手机/平板多团队账号进团队页点团队名 | 多团队用户核心操作阻断 | **P0** | group-hover 代替受控状态，无 aria-expanded |
| D-02 | ALL | TeamWorkspace 批量删除 | `TeamWorkspace.tsx:683-700`/`:231,235,898,911` | 先弹总确认，再 forEach 每项 handleRemoveFile 内部又弹 confirm，N 个文件弹 N+1 次；中途取消造成部分删除 | 勾选 5 个文件删除 | 数据一致性 | P1 | 复用单文件处理器实现批量 |
| D-03 | ALL | 管理表单弹窗 | `ModelFormModal.tsx:163-165`、`ProviderConnectionModal.tsx:222-224`、`TeamInviteDialog.tsx:63-64`、`ApiKeyCreateDialog.tsx:80-81`、`WebhookCreateDialog.tsx:145-146`、`AISettings.tsx:1201-1255` | 手写 fixed inset-0，无 role=dialog/aria-modal/焦点陷阱/Escape | 键盘打开添加模型/邀请成员 | 关键表单可访问性 | P1 | 各功能点各自实现 |
| D-04 | ALL | AISettings 写操作 | `AISettings.tsx:176-204,399-448,482-488,500-529,570-614` | 大量 mutation 无 onError；catch 仅 console.error；失败时界面无反馈 | 断网/500 时保存/激活/测试模型 | AI 配置写操作 | P1 | 只写 onSuccess，异常处理散落 |
| D-05 | ALL | SystemConfigPanel | `SystemConfigPanel.tsx:104-140,222-250` | commitValue 仅处理 number/string，json 类型落通用输入框但失焦不触发 onUpdate，改动静默丢弃 | 修改 JSON 类型系统配置后刷新 | 管理员 JSON 配置不可用 | P1 | 渲染分支与提交分支类型集合不一致 |
| D-06 | M | 验证码输入 | `ResetPassword.tsx:210-226`、`VerifyEmail.tsx:186-202`、`Settings.tsx:187-204`、`AuthLayout.tsx:17` | 6 位验证码 48px×6+gap=328px，320px 视口内层仅 256px 可用 → 溢出，末位不可点 | 320px 手机验证邮箱/重置密码 | 关键认证流程 | P1 | 固定像素宽未做窄屏降级 |
| D-07 | M/T | 团队/AI 列表操作 | `TeamWorkspace.tsx:848,959`、`TeamResourceMountDialog.tsx:360`、`TeamDetail.tsx:401`、`AISettings.tsx:1125` | 删除/卸载用 opacity-0 group-hover 无 touch-visible，触屏不可见 | 手机进团队工作区/AI 记忆管理 | 触屏管理不可用 | P1 | 样式约定未全局推广 |
| D-08 | M | TeamWorkspace 列表 | `TeamWorkspace.tsx:745-765,792-795,848` | 名称6/大小1.5/权限1.5/操作2/日期1 的 grid-cols-12，320–375px 下操作列仅 53–62px 容纳 3–4 个 28px 按钮 | 手机团队工作区默认列表视图 | 移动团队文件管理 | P1 | 复用桌面 12 栅格未切卡片 |
| D-09 | ALL | Webhook/授权反馈 | `WebhookList.tsx:57-63`、`GlobalPermissions.tsx:136-163`、`Settings.tsx:428-448` | toggle mutation 无 onError；批量授权 Promise.all 部分失败只显示首条错误、无成功/失败数 | 4 个授权 2 个失败 | 权限矩阵/Webhook | P1 | 批量操作缺结果聚合 |
| D-10 | ALL | Tab 栏可发现性 | `Admin.tsx:98`、`Settings.tsx:424`、`Permissions.tsx:85`、`AISettings.tsx:721`、`StorageDashboard.tsx:77` | 主 Tab 用 overflow-x-auto no-scrollbar，移动端后续标签在视口外且无任何滚动提示 | 手机打开管理员面板 | 全站导航可发现性 | P2 | 隐藏滚动条无替代 affordance |
| D-11 | ALL | 非法 tab 参数 | `Admin.tsx:59`、`Settings.tsx:344`、`AISettings.tsx:74`、`Permissions.tsx:38` | activeTab 由 URL 强转无校验，非法 tab 时渲染条件全 false → 主体空白 | 访问 /admin/foo 或过期收藏链接 | 管理页健壮性 | P2 | 缺白名单校验与默认回退 |
| D-12 | ALL | 样式令牌混用 | `ApiKeyList.tsx:108,125-175`、`ApiKeyCreateDialog.tsx:94,128`、`StorageDashboard.tsx:102-131`、`NotificationList.tsx:128` | 硬编码 bg-white/dark:bg-gray-800 等调色板色值，邻页用语义 token | API Keys 与 Webhooks 标签间切换 | 设置模块视觉统一 | P2 | 早期组件未随 token 迁移 |
| D-13 | M/T | Webhook URL | `WebhookList.tsx:150-158` | 长 URL 无 truncate/break-all，同排 3 按钮被挤出 | 手机看长回调 URL | Webhook 移动可用性 | P2 | 未对不可控长度输入截断 |
| D-14 | ALL | 图标按钮可访问名 | `WebhookList.tsx:179-211`、`VectorsTable.tsx:134-142` | 测试/启停/删除等纯图标按钮无 aria-label | 读屏浏览 Webhook 列表 | 键盘/读屏用户 | P2 | 图标按钮未强制可访问名称 |
| D-15 | M | EmailVerificationBanner | `EmailVerificationBanner.tsx:43-52`、`Admin.tsx:810-842` | 单行 flex justify-between 无 flex-col/wrap；text-amber-900/700 无 dark 变体，暗色对比度不足 | 375px 未验证邮箱登录 / 暗色模式 | 顶部提示条可读性 | P2 | 缺响应式断点与暗色配色 |
| D-16 | ALL | Toggle 开关 | `Settings.tsx:316-330`、`SystemConfigPanel.tsx:158-173` | 自绘 button 无 role=switch/aria-checked/aria-label，邮件偏好开关无可见标签 | 读屏浏览邮件通知偏好 | 配置可访问性 | P2 | 未用 Radix Switch 或补 ARIA |
| D-17 | ALL | 可点击 div | `Admin.tsx:512-543`、`NotificationList.tsx:160-167`、`TeamWorkspace.tsx:753-763` | 只有 onClick，无 role=button/tabIndex/onKeyDown | 键盘打开日志详情/通知/排序 | 可访问性 | P2 | div 模拟控件未补语义 |
| D-18 | ALL | 表单标签关联 | `Admin.tsx:296-326`、`Settings.tsx:186,251-252,461,668,724`、`ResetPassword.tsx:204,209`、`ModelFormModal.tsx:181-263`、`TeamInviteDialog.tsx:93-134` | label 无 htmlFor、input 无 id；验证码 6 输入框无可访问名；placeholder 充当标签 | 读屏填写重置密码 | 表单可访问性 | P2 | 无 label-input 关联约束 |
| D-19 | ALL | ModelFormModal 校验 | `ModelFormModal.tsx:136-138` | effectiveModelId 为空直接 return，无错误文案/字段高亮 | 手动模型 ID 模式清空后提交 | 模型配置可用性 | P2 | 原生 required 对动态字段无效 |
| D-20 | ALL | Admin 配额编辑 | `Admin.tsx:244-247,252-265` | 字节/1024³ 后 Math.round，1.5GB 显示 2；保存无校验，负数/NaN 可能落入 999999999 哨兵值 | 设 1.5GB 配额 / 输入 -5 | 配额数据准确性 | P2 | 展示四舍五入且无范围校验 |
| D-21 | ALL | 供应商 Base URL | `ProviderConnectionModal.tsx:269-279` | 提示要求 https 公网地址但保存无格式/协议校验（对比 WebhookCreateDialog 有校验） | 填 localhost:1234 直接保存成功 | AI 供应商配置 | P2 | 提示与校验未同步 |
| D-22 | ALL | 危险按钮视觉层级 | `VectorsTable.tsx:198-217`、`Tasks.tsx:380-412` | "删除选中(N)"与"清空向量库(全部)"同款 outline text-destructive；任务清空操作无主次无确认 | 批量删向量后误点清空 | 误操作风险 | P2 | 危险等级未映射样式与确认 |
| D-23 | ALL | NotificationBell SSE | `NotificationBell.tsx:87-103` | 断线后 setTimeout 递归重连未在 cleanup 清理，卸载后仍重连并 setState；固定 5s 无退避 | SSE 断开时切到无该组件页 | 内存泄漏/后台请求 | P2 | 重连定时器脱离 effect 生命周期 |
| D-24 | M | Tasks 批量按钮 | `Tasks.tsx:380-412` | 移动端隐藏文字只留图标，无 aria-label/title；清空/删除无确认 | 手机上传任务页顶部 5 个图标按钮 | 任务管理可用性 | P2 | 响应式隐藏未保留可访问名 |
| D-25 | ALL | 设备管理入口 | `Settings.tsx:1-11`、`DeviceManager.tsx:62` | DeviceManager 已实现但全仓库无导入，用户无入口；当前设备判定逻辑不可靠 | 设置页找"已登录设备" | 账户安全功能不可达 | P2 | 功能完成未注册入口（IA 断点） |
| D-26 | ALL | 批量授权语义 | `GlobalPermissions.tsx:136-163,212-230,351` | 校验只用 toast 无字段级错误；Promise.all 部分失败无明细；搜索结果只渲染前 5 条无提示，≥2 字符无提示 | 搜 1 字符无结果 / 8 个匹配只显 5 | 授权流程 | P2 | 缺分页/计数 UI 与字段级校验 |
| D-27 | ALL | 确认体系不统一 | `ApiKeyList.tsx:49`、`ApiKeyShowOnceDialog.tsx:38,101-142`、`WebhookList.tsx:82` | 原生 confirm 与自定义卡片混用；ApiKey 关闭有一次确认而 Webhook 密钥展示无确认即关，保护强度不一 | Webhook 密钥未保存直接关闭 | 密钥安全与风格 | P2 | 无全局确认服务 |
| D-28 | ALL | 图标语言 | `AISettings.tsx:705-711`、`Permissions.tsx:95,101` | lucide 与 emoji 混用、状态重复图标；激活 Tab 同时 border-b-2 与绝对定位下划线出现双线 | AI 配置与权限页切换 | 视觉统一 | P3 | 渐进开发未做视觉走查 |
| D-29 | ALL | 密码找回反馈 | `ForgotPassword.tsx:58-59`、`ResetPassword.tsx:313-317` | emerald-500/10 底上 text-white 图标对比度低；内联固定文案与后端真实错误可能矛盾 | 密码不符合规则失败却提示验证码错误 | 反馈准确性 | P3 | 颜色未适配、错误文案硬编码 |

### E 类：组件一致性、设计系统与信息架构

| 编号 | 设备 | 页面/组件 | 位置 | 问题描述 | 复现场景 | 影响范围 | 级别 | 可能原因 |
|---|---|---|---|---|---|---|---|---|
| E-01 | ALL | Markdown 渲染 | `DraftPreview.tsx:67,91-130`、`NoteEditor.tsx:59-69,117`、`NoteCard.tsx:137,184`、`AssistantContent.tsx:376`、`MarkdownPreview.tsx:45` | 3 套实现（react-markdown + 2 手写正则）；草稿不支持表格/删除线/公式，与 AI 回复排版不同 | 同一段含表格 Markdown 分别作 AI 回复与草稿 | 一致性/重复造轮子 | P1 | 审批预览怕引依赖而手写 |
| E-02 | ALL | XSS 风险 | `DraftPreview.tsx:67,92-125`、`NoteEditor.tsx:61-68,117`、`NoteCard.tsx:137,184` | dangerouslySetInnerHTML：草稿直接拼 HTML（href 未转义）；NoteEditor 只转义 < > 未转义 &，实体形式标签会被解码执行；NoteCard 缺 contentHtml 时注入原始 content | 笔记输入 HTML 实体标签 / AI 草稿含 `<img onerror>` | 安全/内容可信度 | P1 | 自绘渲染器 + 未净化 innerHTML |
| E-03 | ALL | FileEditor 加载失败 | `FileEditor.tsx:134-137` | getRaw 失败后 toast destructive 并直接 onClose 关闭编辑器，无错误占位/重试 | 网络波动/文件过大 | 违反"失败优雅降级"偏好 | P1 | catch 把失败当不可恢复 |
| E-04 | ALL | CodeEditor 高亮 | `CodeEditor.tsx:307` | 数字高亮正则在关键字 span 插入后执行，匹配 class 中的 600/400 再次包裹 span，破坏属性结构 | JS 代码输入 const x=1 | 语法高亮失真 | P1 | 多轮正则替换未跳过已生成 HTML |
| E-05 | M | NoteCard | `NoteCard.tsx:55-56,76-132` | 回复/置顶/编辑/删除由 onMouseEnter/Leave 控制，触屏不可见（同文件 :168 已加 touch-visible，主操作遗漏） | 手机查看文件笔记 | 移动笔记不可用 | P1 | 桌面 hover 直接复用到触屏 |
| E-06 | ALL | ContextMenu 可访问性 | `ContextMenu.tsx:163-186,196-216,255-257` | 菜单项 div onClick 无 role=menuitem/tabIndex/方向键；useContextMenuState 每次渲染返回内联组件类型导致重挂载、子菜单状态丢失 | 键盘打开文件项右键菜单 | 可访问性/渲染稳定性 | P1 | 未用 Radix DropdownMenu，内联组件工厂 |
| E-07 | ALL | ChatSidebar | `ChatSidebar.tsx:221-230,296-319` | 会话项是 div onClick 无 tabIndex/role/键盘 handler；重命名/删除 hover-only 未 touch-visible；按钮 h-7(28px) | 键盘打开 AI 页无法切换会话；手机无法重命名/删除会话 | 可访问性+触屏 | P1 | div 冒充可点击元素 |
| E-08 | ALL | 状态呈现 | `FilePreview.tsx:462-468`、`NotePanel.tsx:43-45,177-181`、`MarkdownPreview.tsx:44,82-85` | 预览失败无重试按钮；笔记失败只弹 toast 且 notes 为空→显示"暂无笔记"（失败伪装空态）；Markdown textContent 为 null 永久"加载中" | 断网打开文件或笔记面板 | 优雅降级 | P2 | 状态机缺 error 态，无统一 AsyncState |
| E-09 | ALL | 设计 token | `tailwind.config.js:13-118`、`index.css:6-53` | 只定义 colors/borderRadius/animation，缺 spacing/fontSize/boxShadow/zIndex token；字号 text-[10/11/12/13/14px] 五档并存 | 同信息层级相邻处 13px/11px/10px | 视觉节奏不统一 | P2 | 设计系统只做颜色层 |
| E-10 | ALL | Badge/Tabs/Skeleton | `ui/`（仅 12 文件）；`AISettings.tsx:738,1095`、`Buckets.tsx:51,450`、`ListItem.tsx:184-204`、`Permissions.tsx:95` | ui/ 下无 Badge/Tabs/Skeleton，30+ 处内联胶囊标签尺寸/内边距/配色各异；手写 Tab 无 role=tablist | 对比文件列表与 AI 配置的标签 | 风格漂移+语义缺失 | P2 | 组件层未抽象 |
| E-11 | ALL | LoadingSpinner | `LazyComponents.tsx:3-7`、`App.tsx:51`、`FileDetailPanel.tsx:194`、`VersionHistory.tsx:217`、`FileEditor.tsx:196`、`Downloads.tsx:260` | 同一 Spinner 复制 5+ 份，配色 border-blue-500 vs border-primary 不一致 | 切页与打开编辑器两种颜色转圈 | 加载态观感 | P2 | LoadingSpinner 定义未导出 |
| E-12 | ALL | 非法 Tailwind 类 | `MainLayout.tsx:190`、`CatalogSnapshotCard.tsx:70`、`ProviderCatalogPanel.tsx:82`、`StorageAuditTab.tsx:349` | h-4.5 w-4.5、ml-5.5 不在默认 scale 也无配置 → 空 CSS，图标回落 24px | 移动顶栏主题图标偏大 | 尺寸失控 | P2 | 误以为存在 4.5/5.5 档，无类名 lint |
| E-13 | ALL | 硬编码调色板 | `DiffPreview.tsx:29-102`、`Admin.tsx`（65 处）、`StorageAuditTab.tsx`（98 处）、`FileEditor.tsx:224-261`、`NoteEditor.tsx:81-124` | 大面积绕过 HSL token 用 slate/gray/blue 硬编码并逐项手写 dark: | 切深色模式灰阶与卡片主色不同系 | 主题一致性 | P2 | 历史组件先于设计系统 |
| E-14 | ALL | AI 回复渲染 | `AssistantContent.tsx:376` vs `MarkdownPreview.tsx:9-10,46-47` | remark-math/rehype-katex 已装仅用于文件预览，AI 回复只挂 remarkGfm+rehypeHighlight，公式显示原始 $...$ | AI 输出 $E=mc^2$ | 数学内容不可读 | P2 | 两渲染入口插件未对齐 |
| E-15 | M/T | 代码块复制/消息操作 | `AssistantContent.tsx:241,244`、`MessageBubble.tsx:206` | 代码块 bg-slate-900 且复制按钮 opacity-0 仅 group-hover；消息操作栏 hover-only，触屏需 500ms 长按 discoverability 差 | 手机看 AI 回复代码块复制按钮不可见 | 触屏功能缺失 | P2 | 复用桌面 hover，未用 .touch-visible |
| E-16 | ALL | Composer 长度校验 | `Composer.tsx:54,228-240,256,340`、`AIChat.tsx:686` | maxLength=15000 只用于计数变红，textarea 无 maxLength 属性，canSend 仅判断 !sessionLoading → 超限仍可发送 | 粘贴 16000 字点发送 | 后端压力/截断 | P2 | 校验只展示未约束 |
| E-17 | ALL | @提及下拉 | `Composer.tsx:296-333,131-153` | 有方向键但无 role=listbox/option，textarea 无 aria-expanded/activedescendant | 读屏输入 @文 按方向键听不到候选 | 键盘/读屏不可用 | P2 | 自绘下拉未补 ARIA |
| E-18 | M | DiffPreview | `AssistantContent.tsx:254-257`、`DiffPreview.tsx:54` | grid-cols-2 双栏在 <768px 每列约 150px，text-xs font-mono + truncate 无横向滚动，代码难读 | 手机确认 AI 文件编辑审批 | 审批信息难辨 | P2 | 未按响应式做单栏降级 |
| E-19 | ALL | 折叠组件 | `ToolCallCard.tsx:114-144`、`ReasoningSection.tsx:42-57`、`PlanProgressBar.tsx:31-59`、`DiffPreview.tsx:37-50` | 4 个展开/收起按钮无 aria-expanded（ChatHeader 已正确使用） | 读屏无法得知展开状态 | 可访问性 | P3 | 未统一抽象 Disclosure |
| E-20 | ALL | 状态条/进度条 | `StatusStrip.tsx:34`、`ErrorBanner.tsx:19`、`PlanProgressBar.tsx:44-52` | 状态条无 role=status/aria-live，错误条无 role=alert，进度条无 role=progressbar/aria-valuenow | 断网重连读屏无播报 | 可访问性 | P3 | 纯视觉状态未接 live region |
| E-21 | ALL | CodeEditor 行号 | `CodeEditor.tsx:333-335` vs `:293-298` | 行号栏 pre 未参与 handleScroll 同步，滚动后行号与代码错位 | 打开 100+ 行代码向下滚 | 编辑体验 | P2 | 遗漏行号容器 scrollTop 同步 |
| E-22 | ALL | CodeEditor 高亮方案 | `CodeEditor.tsx:54-322` | 手写 200+ 行正则高亮，highlight.js 已是依赖且被 AssistantContent/MarkdownPreview 使用 | 对比编辑器与预览同一段代码高亮 | 重复造轮子 | P2 | 编辑器未接统一高亮 |
| E-23 | ALL | document.title | `index.html:42`、`App.tsx:77-373`（全文件无 document.title） | 所有页面共用静态标题，标签页/历史/读屏无法区分 | 同时打开回收站/AI 配置/团队三标签 | IA/可访问性 | P2 | 未做路由级 title 管理 |
| E-24 | D | 侧边栏导航 | `MainLayout.tsx:55-69,83,222-260`、`MobileBottomNav.tsx:218` | 15 项平铺无分组（文件/协作/系统/管理混排），用 Link 非 NavLink 无 aria-current；折叠按钮 24px 无 aria-label | 找"AI 配置"需逐行扫 | IA/可访问性 | P2 | 导航是扁平数组未分组 |
| E-25 | ALL | 快捷键体系 | `KeyboardShortcutsDialog.tsx:41,49,78-131`、`MainLayout.tsx:126-152` | 帮助写"Ctrl+/ 聚焦搜索"但全仓库无 / 快捷键；写"Esc 关闭对话框"但自身无 Escape；实现用 e.key==='?' 而多数键盘 Ctrl+/ 产生 '/' | 按 Ctrl+/ 无反应；帮助面板 Esc 关不掉 | 交互可信度 | P2 | 文档与实现分离 |
| E-26 | ALL | 低对比度文本 | `ChatSidebar.tsx:211`、`Admin.tsx`、`StorageAuditTab.tsx:112,361,461` | text-[10px] text-muted-foreground/70~50，估算对比度约 2.7:1 低于 AA 4.5:1 | 侧栏分组标题、管理页辅助文字发灰 | 可读性 | P2 | 用降透明度弱化未定义语义 token |
| E-27 | ALL | 触控目标 | `MessageBubble.tsx:209-234`、`Composer.tsx:257`、`ChatSidebar.tsx:118-151,243-258`、`ContextMenu.tsx:163-186` | 高频图标按钮 p-1+14px 图标（22–28px）或 h-8w-8(32px)，低于 WCAG 2.5.8 的 44px；项目已有 .touch-target 但极少用 | 手机点消息复制/发送常点不中 | 触屏易用性 | P2 | 工具类未纳入组件默认 |
| E-28 | ALL | 路由兜底 | `App.tsx:372` | path="*" 直接 Navigate 到 /，无效 URL 静默跳转无提示 | 手输 /file、/settingss | IA 反馈 | P3 | 未设计 404 页 |
| E-29 | ALL | 滚动恢复 | `App.tsx:77-373` | 无路由级滚动恢复（仅 AI 聊天内部自存 scrollPositionsRef） | 文件页滚到 80 项开预览后返回回顶部 | 交互体验 | P2 | 未用 ScrollRestoration |
| E-30 | ALL | 面包屑语义 | `BreadcrumbNav.tsx:37,52-65` | nav 无 aria-label；末项是 onClick 无效 button（可 Tab 聚焦但无动作），应为 span aria-current | Tab 到最后一级按 Enter 无反应 | 可访问性 | P3 | 用 button 统一渲染所有层级 |

---

## 六、优化方案（按优先级排序）

### P0 —— 立即修复（阻断/数据/安全）

1. **修复 AI 浮层遮挡保存按钮**（P0-01）
   - `AIChatWidget.tsx:33` 将 FAB 层级降到 overlay 之下（如 `z-30`），并订阅全局弹窗栈：`activeDialogs.length > 0` 即隐藏，替换 `AIChatWidget.tsx:19-28` 的 MutationObserver 方案。
   - `FileEditor.tsx:252` 将无效类 `z-60` 改为规范 token（如 `z-[60]` / `z-overlay`）。
   - 平板断点纳入隐藏条件，修复 768–1023px 预览被盖。
2. **建立 zIndex 语义 token + 统一弹窗基类**（A-02/A-03）
   - 在 `tailwind.config.js:13` extend 中定义 `zIndex`：`dropdown:25 / sticky:40 / overlay:50 / popover:60 / toast:70 / system:80`，禁用 `z-[9999]/z-[10000]` 魔数。
   - 基于已安装的 `@radix-ui/react-dialog` 封装 `AppDialog`，集中 Portal/Overlay/Content/焦点陷阱/Escape/点外关闭/滚动锁（引用计数）/`aria-modal`；迁移 31+ 手写弹窗。
   - zustand 维护 `activeDialogs: string[]`，FAB 与系统提示订阅。
3. **修复团队切换器触屏阻断**（D-01）：`Teams.tsx:71-105` 改为受控 state 或 Radix DropdownMenu，按钮绑 `onClick`/`aria-expanded`，支持 Enter/Space 与触屏。
4. **消除编辑数据丢失**（C-02）：`FilePreview.tsx:316-332` 的 Esc 感知 `showEditor`，编辑器打开时交由 FileEditor 自身的 `handleClose` 处理未保存确认。
5. **消除笔记 XSS**（E-02）：所有 `dangerouslySetInnerHTML` 经 `rehype-sanitize` 或 DOMPurify 净化；NoteEditor 补 `&` 转义。

### P1 —— 本迭代内修复

6. **触屏可达性专项**（C-01/D-07/E-05/E-15/E-07）：全仓扫描 `opacity-0 group-hover:opacity-100`，统一补 `.touch-visible`；封装 `<RowActions>` 避免遗漏。会话项/右键菜单项/消息操作改语义化 `<button>` 并补 ARIA。
7. **统一确认服务**（A-19/A-20/D-02/D-27）：封装 `useConfirm()` + `ConfirmDialog`（info/warn/danger/critical 分级）；critical 级加影响数量摘要与输入式确认；一次性替换约 47 处原生 confirm/alert；TeamWorkspace 批量删除改为单次批量 mutation。
8. **写操作反馈全覆盖**（D-04/D-09）：所有 mutation 强制 `onError` toast，批量操作返回成功/失败计数，catch 禁止只 console.error。
9. **断点统一**（C-03/B-03）：`MobileFilesToolbar.tsx:65` 的 `lg:hidden` 改 `md:hidden`（或桌面工具栏改 `hidden lg:flex`）；引入 `md:` 平板导航形态，768–1023px 不再拉伸移动底栏。
10. **失败优雅降级**（E-03/E-08）：抽象 `AsyncState`（loading 骨架 / empty 引导 / error+重试）；FileEditor 加载失败保留面板并给重试，NotePanel 区分失败与空，FilePreview 错误页加重试。
11. **内容渲染统一**（E-01/E-14）：以 react-markdown + remark-gfm/remark-math + rehype-highlight/rehype-katex 为唯一实现，替换 2 套手写渲染器。
12. **表单与配置正确性**（D-05/D-06/D-19/D-20/D-21）：commitValue 覆盖 json；验证码输入改 `grid grid-cols-6` / `flex-1 min-w-0`；ModelFormModal 补字段级错误；配额校验范围；Base URL 协议校验。
13. **代码编辑器正确性**（E-04/E-21）：数字高亮改为一次性分词跳过已生成 HTML；行号容器纳入 scrollTop 同步。

### P2 —— 体验与规范化

14. **流畅度**：面包屑改后端一次返回 path（C-08）；列表/搜索引入虚拟滚动或搜索上限（C-09）；批量清理改批量 API 或 runWithConcurrency（C-18）；NotificationBell 清理重连定时器（D-23）。
15. **设计系统收敛**（E-09/E-10/E-11/E-12/E-13/E-26）：补齐 fontSize/boxShadow/zIndex/spacing token；新增 Badge/Tabs/Skeleton/Spinner 共享组件；修复 h-4.5 等非法类；迁移硬编码调色板；定义 `--muted-foreground-subtle` 替代降透明度。
16. **信息架构治理**（E-23/E-24/E-25/E-28/E-29/D-25）：路由级 document.title；侧栏按领域分组改 NavLink；快捷键文档与实现统一为单一常量表；独立 404 页；ScrollRestoration；设备管理补设置入口。
17. **可访问性补齐**（D-14/D-16/D-17/D-18/E-17/E-19/E-20）：role=switch、aria-label、label-input 关联、listbox ARIA、aria-expanded、aria-live、progressbar。
18. **视觉与溢出**：Tab 栏滚动提示（D-10）；Webhook URL 截断（D-13）；批量栏/预览底栏/面包屑/分页窄屏折叠（C-04/C-05/C-11/C-16）；Toast 变体与安全区（A-07/B-14）；主题前置脚本（B-05）。

### P3 —— 打磨

19. 统一图标语言去 emoji 重复、修复双下划线、低对比度图标、DiffPreview 文案与行数一致、文件名解码统一、移动预览默认值、外链上传并发、收藏分页、路由滚动细节等（D-28/D-29/E-19/E-20/E-30/C-22~C-28）。

---

## 七、验收标准

### 7.1 已知问题回归（必须全部通过）

| 场景 | 通过条件 |
|---|---|
| 任意弹窗打开（预览/编辑/分享/迁移/笔记/详情） | 375 / 390 / 810 / 900 / 1024 / 1440px 六档下 FAB 均不可见不可点；弹窗内容无被覆盖控件 |
| 编辑文件→点保存 | "保存更改"确认框完整可见，保存/取消可点，焦点在确认框内，Tab 不逃逸背景 |
| 平板打开预览 | 弹窗右下角无 FAB 覆盖；关闭后 FAB 恢复 |
| 桌面右下触发 Toast | Toast 完整显示且高于 FAB，关闭按钮可点 |
| 右键菜单打开后触发新弹窗 | 右键菜单自动关闭，不残留顶层 |
| Escape / 点遮罩 / 滚轮 | 每个弹窗一致：Escape 关闭、点遮罩关闭、背景不滚动 |

### 7.2 三端通用量化标准

| 维度 | 验收标准 |
|---|---|
| 断点覆盖 | 320/375/768/900/1024/1440px 实测，导航形态明确无重叠；768–1023px 有专属策略；文件页工具栏实例数恰好为 1 |
| 无横向溢出 | 三端各主要页 `scrollWidth <= clientWidth`，含横屏刘海机；溢出页面数 = 0 |
| 安全区 | 顶/底/横屏左右四向 safe-area 生效；FAB、PWA 提示、动作条不与底栏重叠；首屏最高元素 top ≥ 顶栏 bottom+8px，末元素 bottom ≤ 底栏 top-8px |
| 触屏可见与尺寸 | `@media (hover:none)` 下行内操作按钮 opacity=1 可见率 100%；高频触控目标 ≥44×44px |
| 可访问性 | 模态 role/aria-modal/焦点陷阱/焦点归还覆盖率 100%，Tab 逃逸 0；开关 role=switch；label-input 关联率 100%；图标按钮可访问名 100% |
| 失败反馈 | 写操作 mutation onError 覆盖率 100%；仅 console.error 无用户反馈分支 = 0；AsyncState error+重试覆盖率 100% |
| 确认分级 | 原生 confirm/alert 残留 = 0；critical 操作影响摘要+输入式确认覆盖率 100%；批量确认弹窗数 = 1 |
| 层级规范 | `z-[9999]`/`z-[10000]`/裸 `z-[100/110/120]`/`z-60` 无效类残留 = 0；全部弹窗经统一基类 |
| 性能 | 进入 N 层目录面包屑请求 ≤1；单次预览首屏请求 ≤2；100 项网格中端机滚动 ≥50fps；卸载后遗留定时器/请求 = 0 |
| 风格与 IA | 共享渲染器实现数 = 1；dangerouslySetInnerHTML 净化率 100%；document.title 路由覆盖 100%；404 页存在；硬编码调色板存量下降 ≥70%，新增 = 0 |
| 主题与动画 | 用户主题≠系统主题首屏无明暗跳变；token 格式统一 HSL；prefers-reduced-motion 下动画 ≤0.01ms |

> **动态复测建议**：本次为静态审查，修复后请用真机（iPhone 刘海屏、Home 条机型、触屏平板）与 Chrome DevTools 设备模式，按第七节逐条走查；涉及读屏器（NVDA/VoiceOver）项需人工验证。

---

## 八、正面项（已做对，勿回退）

- 集中式 HSL 设计 token 与 darkMode class 切换机制。
- `prefers-reduced-motion` 全局动画降级；`viewport-fit=cover` 与安全区工具类齐全。
- 搜索防抖 + AbortController + 序号丢弃过期响应，无竞态错乱。
- 路由 `lazy + Suspense`；AI 聊天会话滚动位置记忆；Composer @搜索 300ms 防抖。
- `MobileDialog.tsx` 已实现 Portal/手势关闭/Escape/底部面板适配，可作为统一弹窗基类基础（需补焦点陷阱与 cleanup）。
- 页面级信息架构（文件/收藏/标签/回收站/分享/下载各自独立路由）清晰；Dashboard 骨架屏合理。
- `Trash.tsx`/`RenameDialog.tsx` 等已正确使用 `.touch-visible`，可作为触屏适配范本。
