# OSSShelf v4.0 增强优化方案

> 基于对 v3.8.0 代码库的完整审阅，针对三大核心方向提出可落地执行方案：邮件通知集成、双因素认证、React Native 移动端 App。

---

## 目录

1. [现状诊断总结](#0-现状诊断总结)
2. [邮件通知：Resend 集成](#1-邮件通知resend-集成)
3. [安全加固：双因素认证（TOTP）](#2-安全加固双因素认证totp)
4. [移动端：React Native App](#3-移动端react-native-app)
5. [综合执行大纲](#4-综合执行大纲)

---

## 0. 现状诊断总结

| 模块         | 现状评估                                                | 主要问题                                                                                              |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **邮件通知** | 纯站内通知系统（v3.8.0），用户离线时无任何触达手段      | 注册无验证邮件；忘记密码无重置流程（依赖管理员手动操作）；更换邮箱/密码无安全确认；系统通知无邮件推送 |
| **账户安全** | JWT + bcrypt，登录限流 5 次/15 分钟，API Key scope 控制 | 无第二因素认证；账号被盗后无任何阻断机制                                                              |
| **移动端**   | Web 已做响应式优化（v3.7.0），MobileBottomNav 等组件    | 无原生 App；无系统相册直传；无后台下载；无离线缓存；无推送通知；Web 在移动端体验受浏览器限制          |

---

## 1. 邮件通知：Resend 集成

### 1.1 需求定位

当前用户注册后直接激活，无邮件验证；忘记密码需管理员介入；更换邮箱/密码无安全二次确认；站内通知用户不打开应用就看不到。以上问题的根因都是缺少邮件通道。

### 1.2 数据库结构

```sql
-- migration: 0017_email.sql

-- 邮件验证 Token（注册验证、密码重置、邮箱更换）
CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,          -- 目标邮箱（更换邮箱时为新邮箱）
  type        TEXT NOT NULL,          -- verify_email | reset_password | change_email
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256(token)，明文仅在邮件中出现一次
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_email_tokens_user    ON email_tokens(user_id, type);
CREATE INDEX idx_email_tokens_expires ON email_tokens(expires_at);

-- users 表新增字段
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_preferences TEXT NOT NULL DEFAULT '{}';
-- email_preferences JSON:
-- { mention: true, share_received: true, quota_warning: true, security_alert: true, system: true }
```

### 1.3 邮件服务封装

```typescript
// apps/api/src/lib/emailService.ts

interface ResendConfig {
  apiKey: string;
  fromAddress: string; // 如 noreply@mail.yourdomain.com
  fromName: string; // 如 OSSShelf
}

// 配置存 KV key: "config:resend"，支持管理面板热更新，无需重部署
export async function getResendConfig(kv: KVNamespace): Promise<ResendConfig | null>;

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const config = await getResendConfig(env.KV);
  if (!config) return { success: false, error: 'Email not configured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromAddress}>`,
      to,
      subject,
      html,
    }),
  });
  return { success: res.ok };
}

// 邮件模板函数（返回 HTML 字符串，统一品牌样式）
export const emailTemplates = {
  verifyEmail: (name: string, link: string) => string,
  resetPassword: (name: string, link: string) => string,
  changeEmail: (name: string, newEmail: string, link: string) => string,
  passwordChanged: (name: string, ip: string, time: string) => string,
  systemNotify: (name: string, title: string, body: string, link?: string) => string,
};
```

### 1.4 后端路由结构

**注册验证（6位验证码）**

```
POST /api/auth/register
  → 创建用户（email_verified=0）
  → 生成 6位验证码（TTL 10分钟）
  → 发送验证码邮件
  → 返回 { requireEmailVerification: true }

POST /api/auth/verify-code { email, code, type: 'verify_email' }
  → 验证验证码 → 设置 email_verified=1 → 返回成功

POST /api/auth/resend-verification
  → 限流：同邮箱 1 分钟内只能发 1 次（KV 控制）
  → 重新发送验证码邮件
```

**未验证用户限制**：登录后若 `email_verified=0`，前端展示验证提示横幅，核心功能（上传、分享）受限，但可以浏览文件。

**忘记密码（6位验证码）**

```
POST /api/auth/forgot-password { email }
  → 查用户 → 生成 6位验证码（TTL 10分钟）
  → 发送验证码邮件
  → 无论邮箱是否存在，始终返回 200（防止邮箱枚举）

POST /api/auth/reset-password { email, code, newPassword }
  → 验证验证码 → 更新密码 → 标记验证码已使用
  → 发送「密码已更改」安全通知邮件
  → 使该用户所有现有 JWT 失效（users 表加 password_changed_at，JWT 验证时比对）
```

**更换邮箱（6位验证码）**

```
POST /api/auth/change-email { newEmail, password }
  → 验证当前密码
  → 检查 newEmail 未被其他账号占用
  → 生成 6位验证码（TTL 10分钟），绑定 newEmail
  → 向 newEmail 发送验证码邮件

POST /api/auth/verify-code { email, code, type: 'change_email' }
  → 验证验证码 → 更新 users.email → 发送「邮箱已更改」通知到旧邮箱
```

**更换密码**

```
POST /api/auth/change-password { currentPassword, newPassword }
  → 验证 currentPassword
  → 更新密码 + 更新 password_changed_at
  → 发送「密码已更改」安全通知邮件（含 IP、时间）
```

**系统通知邮件**

复用现有 `createNotification()` 函数，在写入 `notifications` 表后，同步检查用户 `email_preferences`，若对应类型开启则调用 `sendEmail()`：

```typescript
// lib/notificationService.ts（现有逻辑扩展）
export async function createNotification(env, userId, type, title, body, data?) {
  // 1. 写入 notifications 表（现有逻辑）
  // 2. 查用户 email_preferences + email
  // 3. 若对应 type 已开启 → sendEmail（ctx.waitUntil，不阻塞响应）
}
```

触发邮件通知的系统事件（用户可在个人设置中逐项开关）：

| 事件                      | 默认开启       |
| ------------------------- | -------------- |
| 被 @提及                  | ✅             |
| 收到文件分享              | ✅             |
| 存储配额超过 90%          | ✅             |
| 安全告警（密码/邮箱变更） | ✅（不可关闭） |
| AI 处理完成               | ❌             |
| 系统公告（管理员群发）    | ✅             |

### 1.5 管理面板配置

```
GET  /api/admin/email/config         -- 查看当前 Resend 配置（apiKey 脱敏显示）
PUT  /api/admin/email/config         -- 保存配置到 KV
POST /api/admin/email/test           -- 发送测试邮件到管理员自己的邮箱
POST /api/admin/email/broadcast      -- 向所有用户或指定用户群发系统公告邮件
```

### 1.6 前端组件规划

```
apps/web/src/
├── pages/
│   ├── VerifyEmail.tsx              -- 验证邮箱落地页（从邮件链接跳转）
│   ├── ForgotPassword.tsx           -- 忘记密码表单
│   └── ResetPassword.tsx            -- 重置密码表单（token 来自 URL）
├── components/
│   ├── auth/
│   │   └── EmailVerificationBanner.tsx  -- 顶部未验证提示横幅
│   └── settings/
│       └── EmailPreferences.tsx     -- 个人设置：通知偏好开关
└── (admin)
    └── EmailConfig.tsx              -- 管理面板：Resend 配置 + 测试 + 群发
```

---

## 2. 安全加固：双因素认证（TOTP）

### 2.1 需求定位

邮件通知建立了基础账户安全（密码重置有验证、变更有通知），但账号被盗后仍无第二道门。TOTP 是目前最成熟的无服务器 2FA 方案，与 Workers 运行时完全兼容。

### 2.2 数据库结构

```sql
-- migration: 0018_2fa.sql

ALTER TABLE users ADD COLUMN totp_secret TEXT;           -- AES-GCM 加密存储（用 ENCRYPTION_KEY）
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT;
-- totp_backup_codes JSON: 8 个恢复码的 bcrypt hash 数组
-- 使用一个即从数组中删除，用完需重新生成

-- 信任设备（「记住此设备 30 天」）
CREATE TABLE IF NOT EXISTS trusted_devices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL UNIQUE,  -- SHA-256(userId + userAgent + ip + salt)
  name        TEXT,                  -- 用户自定义设备名
  last_used   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_trusted_devices_user    ON trusted_devices(user_id);
CREATE INDEX idx_trusted_devices_expires ON trusted_devices(expires_at);
```

### 2.3 认证流程

```
正常登录（2FA 未开启）：邮箱 + 密码 → JWT  ← 现有流程不变

登录（2FA 已开启）：
  POST /api/auth/login
    → 邮箱 + 密码验证通过
    → 检查请求设备是否在 trusted_devices 且未过期
    → 是：直接颁发 JWT（跳过 2FA）
    → 否：返回 { requireTotp: true, tempToken: <JWT 5 分钟有效> }

  POST /api/auth/totp/verify { tempToken, code, trustDevice? }
    → 验证 tempToken 未过期
    → 验证 TOTP code（otpauth 包，允许 ±1 步容差）
    → code 无效时尝试 backup_codes（bcrypt 比对，匹配则删除已用码）
    → 验证通过 → 颁发正式 JWT
    → trustDevice=true → 写入 trusted_devices（TTL 30 天）
```

### 2.4 后端路由

```
apps/api/src/routes/auth2fa.ts

POST /api/auth/2fa/setup
  → 生成 TOTP secret（otpauth.TOTP）
  → AES-GCM 加密后暂存 KV（TTL 10min，key=2fa:setup:{userId}）
  → 返回 { otpauthUri, secret（明文，仅此一次） }

POST /api/auth/2fa/enable { code }
  → 从 KV 取 setup secret → 验证 code 是否正确
  → 正确：secret 写入 users.totp_secret（加密），totp_enabled=1
  → 生成 8 个备用恢复码 → bcrypt hash 后存 users.totp_backup_codes
  → 返回明文备用恢复码（仅此一次）
  → 发送「2FA 已开启」安全通知邮件

POST /api/auth/2fa/disable { code }
  → 需提供当前有效 TOTP code 或 backup code 才能关闭
  → 清除 totp_secret、totp_enabled=0、清空 totp_backup_codes
  → 删除该用户所有 trusted_devices
  → 发送「2FA 已关闭」安全通知邮件

POST /api/auth/2fa/backup-codes/regenerate { code }
  → 需提供当前有效 TOTP code
  → 生成新的 8 个恢复码，旧码全部作废
  → 返回新明文恢复码

GET    /api/auth/2fa/trusted-devices         -- 列出信任设备
DELETE /api/auth/2fa/trusted-devices/:id     -- 撤销指定设备
```

### 2.5 关键实现要点

**Secret 加密存储**

```typescript
// lib/crypto.ts（现有文件扩展）
// users.totp_secret 存储格式：base64(iv) + ':' + base64(ciphertext)
// 使用 ENCRYPTION_KEY + AES-GCM 加密，防止 D1 泄露直接得到 TOTP secret
export async function encryptTotpSecret(secret: string, key: string): Promise<string>;
export async function decryptTotpSecret(encrypted: string, key: string): Promise<string>;
```

**TOTP 验证**

```typescript
import * as OTPAuth from 'otpauth'; // 纯 JS，Workers 兼容

const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(plainSecret), period: 30 });
const delta = totp.validate({ token: code, window: 1 }); // ±1 步容差，约 ±30 秒
// delta !== null → 验证通过
```

**防重放**：TOTP code 验证通过后，将 `${userId}:${code}` 写入 KV，TTL 90 秒，同一 code 在窗口内直接拒绝。

### 2.6 前端组件规划

```
apps/web/src/components/auth/
├── TwoFactorSetup.tsx       -- 设置向导（3步：扫码 → 验证 → 保存备用码）
├── TwoFactorVerify.tsx      -- 登录时弹出的 TOTP 输入框
├── TwoFactorDisable.tsx     -- 关闭 2FA 确认弹窗
├── BackupCodesDisplay.tsx   -- 备用恢复码展示（含复制/下载）
└── TrustedDevicesList.tsx   -- 已信任设备列表 + 撤销按钮

apps/web/src/pages/
└── Login.tsx                -- 现有页面扩展：检测 requireTotp → 显示 TwoFactorVerify
```

---

## 3. 移动端：React Native App

### 3.1 技术选型依据

| 方案                | 复用现有代码                   | 原生能力                        | 构建复杂度            |
| ------------------- | ------------------------------ | ------------------------------- | --------------------- |
| React Native (Expo) | 部分（API 调用层、类型、常量） | ✅ 系统相册、后台下载、推送通知 | 低（Expo 托管工作流） |
| Flutter             | ❌                             | ✅                              | 高（全新技术栈）      |
| PWA                 | Web 代码复用                   | ❌ 后台下载、推送受限           | 极低但能力上限低      |

选 **Expo (React Native)**。可复用：`packages/shared` 常量、API 调用封装（`services/`）、TypeScript 类型定义。不可复用：所有 UI 组件（Web 基于 DOM，RN 基于 View/Text）。

### 3.2 仓库结构

```
ossshelf/
├── apps/
│   ├── api/           ← 不变
│   ├── web/           ← 不变
│   └── mobile/        ← 新增，Expo managed workflow
│       ├── app/                  -- Expo Router 文件路由
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   └── forgot-password.tsx
│       │   ├── (app)/
│       │   │   ├── _layout.tsx   -- Tab 导航
│       │   │   ├── files/
│       │   │   │   ├── index.tsx        -- 文件列表
│       │   │   │   └── [id]/index.tsx   -- 文件详情/预览
│       │   │   ├── starred.tsx          -- 收藏夹
│       │   │   ├── search.tsx           -- 搜索
│       │   │   └── settings/
│       │   │       ├── index.tsx        -- 设置首页
│       │   │       ├── profile.tsx      -- 个人资料
│       │   │       ├── security.tsx     -- 安全（2FA 管理）
│       │   │       ├── notifications.tsx -- 通知偏好
│       │   │       └── storage.tsx      -- 存储桶查看
│       ├── components/
│       ├── hooks/
│       ├── services/             -- 引用 packages/shared/src/services/
│       └── app.json
├── packages/
│   └── shared/
│       └── src/
│           ├── constants/        ← 已有，直接复用
│           ├── types/            ← 新增，从 Web 迁移
│           └── services/         ← 新增，平台无关 API 层
```

### 3.3 核心功能范围（对齐 Web 端）

#### 3.3.1 文件浏览与管理

```
文件列表：
  - 列表/网格切换（AsyncStorage 记忆偏好）
  - 文件夹导航（面包屑路径）
  - 长按多选 + 批量操作（移动、删除、下载）
  - 下拉刷新

文件操作（长按菜单 / 右滑）：
  - 重命名、移动、删除（进回收站）
  - 收藏/取消收藏
  - 复制分享链接
  - 查看详情（大小、时间、Hash）

搜索：
  - 全局搜索（FTS5 + 语义搜索，复用 /api/search）
  - 搜索历史（AsyncStorage 本地缓存）
```

#### 3.3.2 上传

```
上传入口（FAB 展开）：
  - 从系统相册选取（expo-image-picker）
  - 从文件 App 选取（expo-document-picker）
  - 拍照直传（expo-camera）

上传实现：
  - 小文件（< 100MB）：直接 FormData POST
  - 大文件（≥ 100MB）：复用现有分片上传 API，进度展示
  - 后台上传：expo-background-fetch + expo-task-manager，切后台继续上传

自动备份（可选，手动开启）：
  - 监听相册新增（expo-media-library）
  - 仅 Wi-Fi / 仅充电时 上传配置
```

#### 3.3.3 下载与预览

```
预览（App 内）：
  - 图片：react-native-fast-image（手势缩放）
  - 视频/音频：expo-av（音频支持后台播放）
  - PDF：react-native-pdf
  - 文本/代码：ScrollView + 等宽字体
  - 其他格式：expo-sharing 调系统 App

下载：
  - expo-file-system 下载 + 进度条
  - 图片/视频保存到系统相册（expo-media-library.saveToLibraryAsync）
  - 文档保存到文件 App（expo-sharing）
  - 后台下载（expo-background-fetch）
```

#### 3.3.4 分享

```
- 查看/创建/撤销分享链接
- 设置密码、过期时间、下载次数
- 复制链接（Clipboard）
- 通过系统分享菜单分享（expo-sharing）
```

#### 3.3.5 Push 通知

```
- 接入 Expo Push Notification Service（EPNS）
- App 启动时注册 Token → POST /api/push/register
- 退出登录时注销 Token → DELETE /api/push/unregister
- 点击通知深链到对应页面（Expo Router 深链）

支持的推送事件：
  - 被 @提及
  - 收到文件分享
  - 存储配额告警
  - 安全告警（密码/邮箱变更、2FA 状态变更）
```

#### 3.3.6 安全功能

```
- 生物识别解锁（expo-local-authentication，FaceID / 指纹）
  → App 切回前台时触发
- 2FA 设置（调用相同 API，原生 UI）
- 修改密码、更换邮箱入口
- 已信任设备列表（可从手机端撤销）
```

### 3.4 后端补充（为 App 新增的 API）

```sql
-- migration: 0019_push_tokens.sql
CREATE TABLE IF NOT EXISTS push_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,   -- Expo Push Token
  platform    TEXT NOT NULL,          -- ios | android
  device_name TEXT,
  last_used   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
```

```
POST   /api/push/register   { token, platform, deviceName }
DELETE /api/push/unregister { token }
```

```typescript
// lib/pushNotifier.ts
export async function sendPushNotification(
  env: Env,
  userId: string,
  title: string,
  body: string,
  data?: object
): Promise<void> {
  const tokens = await db.select()...where(eq(pushTokens.userId, userId));
  if (!tokens.length) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default' }))
    ),
  });
}
```

`createNotification()` 扩展后同时触发三条通道：

```typescript
ctx.waitUntil(
  Promise.all([
    // 站内通知（已有）
    // sendEmail(...)       ← Phase 1 新增
    // sendPushNotification(...)  ← Phase 3 新增
  ])
);
```

### 3.5 共享代码策略

```typescript
// packages/shared/src/services/apiClient.ts
// 平台无关的 fetch 封装：
// - Web：从 cookie 读 JWT
// - RN：从 AsyncStorage 读 JWT
// 通过依赖注入 getToken() 函数区分，不引入平台判断代码

export function createApiClient(config: { baseUrl: string; getToken: () => Promise<string | null> }) {
  return {
    get:    (path, params?) => ...,
    post:   (path, body?)  => ...,
    put:    (path, body?)  => ...,
    delete: (path)         => ...,
  };
}
```

### 3.6 前端界面结构

```
Tab 导航（底部 4 Tab）：
  📁 文件     -- 主文件浏览器（默认 Tab）
  🔍 搜索     -- 全局搜索
  ⭐ 收藏     -- 收藏夹
  👤 我的     -- 个人设置、安全、通知偏好、退出

文件操作 FAB（右下角浮动按钮）：
  展开 → 相册 / 文件 App / 拍照 / 新建文件夹

文件预览：
  全屏模态页（Expo Router modal）
  顶部：文件名 + 关闭
  底部操作栏：下载 / 分享 / 收藏 / 更多
```

---

## 4. 综合执行大纲

### Phase 1：邮件通知（v4.1.0）

**目标：账户核心操作全部有邮件闭环**

```
Week 1:
  ✅ 基础邮件服务：
     - 数据库迁移：0017_email.sql（email_tokens、users 新字段）
     - lib/emailService.ts（Resend 封装 + 5 个邮件模板）
     - KV 存储 Resend 配置（支持管理面板热更新）
     - 管理面板：EmailConfig.tsx（配置 + 测试发送 + 群发）

Week 2:
  ✅ 注册邮件验证：
     - 注册路由修改（发验证邮件，email_verified=0）
     - GET /api/auth/verify-email 端点
     - POST /api/auth/resend-verification 端点（KV 1分钟限流）
     - 前端：VerifyEmail.tsx + EmailVerificationBanner.tsx

Week 3:
  ✅ 忘记密码 + 更换密码/邮箱：
     - POST /api/auth/forgot-password（发送6位验证码）
     - POST /api/auth/reset-password（验证码+新密码）
     - POST /api/auth/change-email + POST /api/auth/verify-code
     - POST /api/auth/change-password（含安全通知邮件）
     - users.password_changed_at → JWT 失效机制
     - 前端：ForgotPassword.tsx + ResetPassword.tsx + EmailPreferences.tsx
```

### Phase 2：双因素认证（v4.2.0）

**目标：账户安全第二道门**

```
Week 4:
  ✅ TOTP 核心实现：
     - 数据库迁移：0018_2fa.sql（users 字段、trusted_devices 表）
     - lib/crypto.ts 扩展（TOTP secret AES-GCM 加密/解密）
     - routes/auth2fa.ts（setup/enable/disable/verify/backup-codes/trusted-devices）
     - otpauth 集成 + KV 防重放

Week 5:
  ✅ 前端 2FA 流程：
     - TwoFactorSetup.tsx（3步向导：扫码 → 验证 → 备用码）
     - TwoFactorVerify.tsx（登录第二步 TOTP 输入）
     - TwoFactorDisable.tsx + BackupCodesDisplay.tsx
     - TrustedDevicesList.tsx（设置 → 安全 Tab）
     - Login.tsx 扩展：检测 requireTotp → 跳转验证步骤
     - 联动 Phase 1：开启/关闭 2FA 发安全通知邮件
```

### Phase 3：React Native App（v4.3.0 - v4.5.0）

**目标：核心功能对齐 Web 端，原生体验**

```
Week 6-7（基础架构 + 认证）:
  ✅ 项目初始化：
     - Expo managed workflow 初始化（apps/mobile/）
     - pnpm workspace 接入
     - packages/shared/src/services/ 抽离 API 层（Web + RN 共用）
     - Expo Router 路由结构搭建
     - createApiClient（AsyncStorage JWT 方案）
  ✅ 认证流程：
     - 登录、注册（含邮件验证提示）
     - 忘记密码（原生表单，复用 Phase 1 API）
     - 2FA 验证（TwoFactorVerify RN 版，复用 Phase 2 API）
     - 生物识别解锁（expo-local-authentication）

Week 8-9（文件核心功能）:
  ✅ 文件浏览：
     - 文件列表（FlatList，列表/网格切换）
     - 文件夹导航 + 面包屑
     - 长按多选 + 批量操作 Bottom Sheet
     - 下拉刷新
  ✅ 文件预览：
     - 图片（react-native-fast-image + 手势缩放）
     - 视频/音频（expo-av）
     - PDF（react-native-pdf）
     - 文本/代码（ScrollView）
     - 其他：expo-sharing 调系统 App

Week 10-11（上传 + 下载 + 分享）:
  ✅ 上传：
     - expo-image-picker + expo-document-picker + expo-camera
     - 分片上传（大文件）+ 进度展示
     - 后台上传（expo-background-fetch + expo-task-manager）
     - 相册自动备份（可选，手动开启）
  ✅ 下载：
     - expo-file-system 下载 + 进度条
     - 保存到相册 / 文件 App
  ✅ 分享：
     - 查看/创建/撤销分享链接
     - 系统分享菜单（expo-sharing）

Week 12（Push 通知 + 设置 + 上架）:
  ✅ Push 通知：
     - 数据库迁移：0019_push_tokens.sql
     - lib/pushNotifier.ts（Expo Push API）
     - POST /api/push/register + DELETE /api/push/unregister
     - App 启动注册 Token，退出时注销
     - 深链跳转（点通知进对应页面）
  ✅ 设置页完善：
     - 个人资料编辑
     - 安全（2FA 管理、信任设备、修改密码、更换邮箱）
     - 通知偏好（Push + 邮件开关）
     - 存储桶查看（新增/删除引导到 Web 端）
  ✅ 上架准备：
     - app.json 配置（图标、启动屏、权限说明）
     - iOS TestFlight + Android Internal Testing
```

---

### 数据库迁移总览

| 编号 | 文件名            | 涉及功能                                                    | Phase   |
| ---- | ----------------- | ----------------------------------------------------------- | ------- |
| 0017 | `email.sql`       | email_tokens、users.email_verified、users.email_preferences | Phase 1 |
| 0018 | `2fa.sql`         | users.totp\_\*、trusted_devices                             | Phase 2 |
| 0019 | `push_tokens.sql` | push_tokens                                                 | Phase 3 |

---

### 新增目录结构

```
apps/
├── mobile/                        ← 新增（Phase 3）
│   ├── app/
│   │   ├── (auth)/login.tsx
│   │   ├── (auth)/forgot-password.tsx
│   │   └── (app)/
│   │       ├── files/
│   │       ├── search.tsx
│   │       ├── starred.tsx
│   │       └── settings/
│   ├── components/
│   ├── hooks/
│   └── app.json

apps/api/src/
├── lib/
│   ├── emailService.ts            ← Phase 1
│   └── pushNotifier.ts            ← Phase 3
└── routes/
    ├── auth2fa.ts                 ← Phase 2
    └── push.ts                    ← Phase 3

apps/web/src/
├── pages/
│   ├── VerifyEmail.tsx            ← Phase 1
│   ├── ForgotPassword.tsx         ← Phase 1
│   └── ResetPassword.tsx          ← Phase 1
└── components/
    ├── auth/
    │   ├── EmailVerificationBanner.tsx  ← Phase 1
    │   ├── TwoFactorSetup.tsx           ← Phase 2
    │   ├── TwoFactorVerify.tsx          ← Phase 2
    │   └── TrustedDevicesList.tsx       ← Phase 2
    ├── settings/
    │   └── EmailPreferences.tsx         ← Phase 1
    └── admin/
        └── EmailConfig.tsx              ← Phase 1

packages/shared/src/
├── types/                         ← Phase 3（从 Web 迁移）
│   ├── file.ts
│   ├── share.ts
│   └── user.ts
└── services/                      ← Phase 3（平台无关 API 层）
    ├── apiClient.ts
    ├── filesService.ts
    ├── searchService.ts
    └── authService.ts
```

---

> **当前版本：v3.8.0**
>
> **v4 目标**：邮件通知（注册验证 + 忘记密码 + 安全通知）→ 2FA 双因素认证（TOTP + 信任设备）→ React Native App（文件浏览 + 上传下载 + Push 通知）
>
> **预计版本序列**：v4.1.0（邮件）→ v4.2.0（2FA）→ v4.3.0（App 基础架构 + 认证）→ v4.4.0（App 文件核心）→ v4.5.0（App Push + 上架）
>
> **未规划进 v4 的方向**（留给 v5 评估）：Office 在线编辑、自动化规则引擎、多租户工作区、客户端加密
