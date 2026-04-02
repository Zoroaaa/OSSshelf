# Changelog

All notable changes to this project will be documented in this file.

## [v4.0.0] - 2026-04-02

### Added - 邮件通知系统

#### 核心功能

- **注册邮箱验证（6位验证码）**
  - 新用户注册后自动发送6位数字验证码邮件
  - 验证码有效期10分钟
  - 首个注册用户（管理员）自动验证
  - 未验证用户显示提示横幅
  - API: POST /api/auth/verify-code, POST /api/auth/resend-verification

- **密码重置流程（6位验证码）**
  - 忘记密码发送6位验证码邮件
  - 验证码有效期10分钟
  - 防邮箱枚举攻击（无论邮箱是否存在都返回200）
  - API: POST /api/auth/forgot-password, POST /api/auth/reset-password

- **邮箱更换功能（6位验证码）**
  - 更换邮箱需要验证新邮箱
  - 发送6位验证码到新邮箱
  - 验证码有效期10分钟
  - 旧邮箱收到更换成功通知
  - API: POST /api/auth/change-email, POST /api/auth/verify-code

- **邮件偏好设置**
  - 用户可自定义邮件通知偏好
  - 支持5种通知类型：@提及、分享接收、配额警告、AI完成、系统通知
  - 所有邮件发送都检查用户偏好
  - API: GET /api/auth/email-preferences, PUT /api/auth/email-preferences

- **管理面板邮件配置**
  - Resend API 配置界面
  - 发件人地址和名称设置
  - 发送测试邮件功能
  - 群发系统公告（支持按角色筛选）
  - API: GET/PUT /api/admin/email/config, POST /api/admin/email/test, POST /api/admin/email/broadcast

#### 安全增强

- **JWT失效机制**
  - 密码修改后自动更新 `passwordChangedAt`
  - 密码重置后自动更新 `passwordChangedAt`
  - 登录时检查JWT是否失效
  - 失效后自动清除会话并要求重新登录

- **验证码安全**
  - 6位随机数字验证码
  - 验证码一次性使用机制
  - 验证码10分钟有效期
  - 重发验证码限流（1分钟1次）
  - 验证码明文存储（短有效期，无需哈希）

- **邮件模板**
  - 3套精美邮件模板（注册验证/密码重置/更换邮箱）
  - 不同验证类型使用不同配色方案
  - 响应式设计，移动端友好

#### 数据库变更

- 新增迁移文件 `0018_email.sql`
  - 新增 `email_tokens` 表（存储6位验证码）
    - `code` 字段存储验证码（明文，10分钟有效期）
    - 支持3种类型：verify_email、reset_password、change_email
  - `users` 表新增 `email_verified` 字段
  - `users` 表新增 `email_preferences` 字段
  - `users` 表新增 `password_changed_at` 字段

#### 前端页面

- 新增/更新页面
  - `VerifyEmail.tsx` - 邮箱验证码输入页（6位验证码输入框）
  - `ForgotPassword.tsx` - 忘记密码页面（发送验证码）
  - `ResetPassword.tsx` - 重置密码页面（验证码+新密码）
  - `EmailConfig.tsx` - 管理面板邮件配置页面

- 新增组件
  - `EmailVerificationBanner.tsx` - 未验证用户提示横幅
  - `EmailPreferencesForm` - 邮件偏好设置表单
  - `EmailChangeForm` - 更换邮箱表单

- 功能集成
  - 登录页面添加"忘记密码"链接
  - 设置页面新增"邮箱设置"选项卡
  - 管理面板新增"邮件配置"选项卡
  - MainLayout 集成验证提示横幅

#### 邮件模板

- 5个精美邮件模板
  - 验证邮箱模板（紫色渐变主题）
  - 重置密码模板（粉红渐变主题）
  - 更换邮箱确认模板（蓝色渐变主题）
  - 密码变更通知模板
  - 系统通知模板

#### 环境变量变更

- `PUBLIC_URL` 从必填改为可选
  - 不再用于邮件验证链接
  - 仅用于文件直接访问链接生成

### Changed

- **邮件通知控制**
  - 所有邮件发送都检查用户偏好设置
  - 密码修改通知映射到 `system` 偏好
  - 重置密码成功通知映射到 `system` 偏好
  - 邮箱更换成功通知映射到 `system` 偏好

- **审计日志**
  - 新增审计类型：`admin.email_config_update`
  - 新增审计类型：`admin.email_test`
  - 新增审计类型：`admin.email_broadcast`

### Improved

- **用户体验**
  - 邮箱验证状态清晰展示
  - 邮件发送结果实时反馈
  - 密码强度实时指示
  - 验证链接过期友好提示

- **安全性**
  - 所有安全相关邮件不受偏好设置影响
  - 密码变更后强制重新登录
  - 防止邮箱枚举攻击

### Fixed

- 修复密码修改后未更新 `passwordChangedAt` 的问题
- 修复邮件链接使用localhost的问题
- 修复重置密码成功通知未检查邮件偏好的问题
- 修复邮箱更换成功通知未检查邮件偏好的问题

### Technical Details

- **技术栈**
  - Resend API（邮件服务）
  - Cloudflare KV（配置存储）
  - Cloudflare D1（Token存储）
  - SHA-256（Token哈希）

- **性能优化**
  - 邮件配置KV缓存
  - Token哈希索引优化
  - 邮件模板预编译

- **代码质量**
  - TypeScript严格模式
  - 完整的类型定义
  - 错误处理完善
  - 代码注释清晰

## [v3.8.0] - 2026-04-02

### Added

- 收藏夹功能
  - 快速收藏/取消收藏文件和文件夹
  - 侧边栏「收藏」入口，快捷访问收藏文件
  - 文件列表支持收藏图标显示
  - API: POST/DELETE /api/files/:id/star
- 存储分析 Dashboard
  - 存储空间分布统计（按文件类型、MIME 类型）
  - 活跃度热力图（上传/下载/删除活动统计）
  - 大文件排行 Top 20
  - 存储趋势分析（按天统计上传量）
  - 存储桶统计
  - API: GET /api/analytics/\*
- 通知系统
  - 实时通知铃铛（PC端侧边栏底部、移动端顶部栏）
  - 通知列表弹窗（向上/向下展开自适应）
  - 支持已读/未读状态管理
  - 支持全部标记已读、删除通知
  - 通知类型：share_received、mention、permission_granted、ai_complete、system
  - API: GET /api/notifications, PUT /api/notifications/:id/read, DELETE /api/notifications/:id
- FTS5 全文搜索
  - 基于 SQLite FTS5 的全文搜索引擎
  - 支持 unicode61 中文分词
  - 搜索文件名、描述、AI 摘要
  - 前端搜索栏 FTS5 开关（桌面端 + 移动端）
  - 数据库迁移：0016_fts5.sql（虚拟表 + 同步触发器）

### Changed

- 数据库结构扩展
  - 新增迁移文件 0015_notifications.sql（notifications 表）
  - 新增迁移文件 0016_fts5.sql（files_fts 虚拟表）
- 前端组件优化
  - NotificationBell 支持 align 和 direction 属性
  - NotificationList API 调用已启用

### Improved

- 搜索性能提升：FTS5 全文搜索替代 LIKE 查询
- 用户体验：通知铃铛位置优化（PC端侧边栏、移动端顶部栏）

## [v3.7.0] - 2026-04-01

### Added

- AI 功能集成（基于 Cloudflare AI）
  - 文件摘要生成：自动为文本文件生成内容摘要
  - 图片智能描述：自动识别图片内容并生成描述
  - 图片标签生成：使用 ResNet-50 模型自动生成图片标签
  - 智能重命名建议：根据文件内容智能推荐文件名
  - 语义搜索：基于 Vectorize 实现语义相似文件搜索
  - 向量索引管理：支持批量索引、增量索引、索引状态查询
- 移动端页面排版优化
  - 新增移动端底部操作栏（MobileFilesToolbar）
  - 新增移动端搜索面板（MobileSearchPanel）
  - 优化移动端底部导航（MobileBottomNav）
  - 改进视图切换、排序、浮动操作按钮交互
  - 增强移动端触摸体验和响应式布局
- 预览组件拆分重构
  - 将 FilePreview 拆分为独立预览组件
  - 新增 filepreview 目录，包含 12 个独立预览组件
  - ImagePreview、VideoPreview、AudioPreview
  - PdfPreview、MarkdownPreview、CodePreview
  - OfficePreview、CsvPreview、ZipPreview
  - FontPreview、EpubPreview
  - 新增 previewUtils 工具函数

### Changed

- 数据库结构扩展
  - files 表新增 ai_summary、ai_summary_at 字段
  - files 表新增 ai_tags、ai_tags_at 字段
  - files 表新增 vector_indexed_at 字段
  - files 表新增 is_starred 字段
  - 新增迁移文件 0014_ai_features.sql

### Improved

- AI 功能自动触发：上传文件后自动生成摘要/标签
- 语义搜索支持中文和多语言
- 移动端交互体验优化

## [v3.6.0] - 2026-03-31

### Added

- 权限系统 v2：用户组管理、权限继承、时效性权限
  - 新增用户组（user_groups）和组成员（group_members）表
  - 支持为用户或组授予文件权限
  - 权限支持设置过期时间
  - 权限继承：子文件自动继承父文件夹权限
  - 递归 CTE 权限解析算法
  - KV 权限缓存层
- RESTful v1 API：标准化 API 接口
  - `/api/v1/files` - 文件管理 API
  - `/api/v1/folders` - 文件夹管理 API
  - `/api/v1/shares` - 分享管理 API
  - `/api/v1/search` - 搜索 API
  - `/api/v1/me` - 当前用户 API
- OpenAPI 文档：自动生成 API 文档
  - 访问 `/api/v1/openapi.json` 获取 OpenAPI 规范
  - 访问 `/api/v1/docs` 查看 Swagger UI
- Webhook 通知：文件事件订阅
  - 支持订阅文件上传、删除、更新等事件
  - HMAC-SHA256 签名验证
  - Webhook 管理界面

### Changed

- 权限管理界面重构
  - 支持选择用户或组进行授权
  - 显示权限来源（显式/继承）
  - 显示继承路径提示

### Improved

- 权限解析性能优化：使用递归 CTE 一次性查询整条祖先链
- API 文档完善：所有 v1 API 端点有完整的请求/响应 schema

## [v3.5.0] - 2026-03-30

### Added

- API Keys 管理：支持创建、管理 API 密钥，实现程序化访问
  - 支持 6 种权限范围：文件读取、文件写入、分享读取、分享管理、存储桶查看、API Keys 管理
  - 支持设置密钥过期时间
  - 完整的 API Key 使用文档
- 文件笔记面板：为文件添加评论和笔记
  - 支持 @提及其他用户
  - 支持笔记回复（嵌套评论）
  - 支持删除笔记和回复
- 文件编辑功能：直接在系统内创建和编辑文本文件
  - 支持多种文本格式（代码、配置文件、Markdown 等）
  - 编辑时自动创建版本快照

### Changed

- 文件版本控制功能重构
  - 仅支持可编辑的文本文件类型（代码、配置、Markdown 等）
  - 图片、视频、音频等二进制文件不再支持版本控制
  - 版本存储优化：每次编辑生成独立的存储路径，确保历史版本内容不被覆盖
  - 版本恢复功能修复：正确恢复到指定版本内容

### Improved

- 版本历史 UI 优化：仅对可编辑文件显示版本历史按钮
- 右键菜单优化：版本历史选项仅对可编辑文件显示

## [v3.4.0] - 2026-03-27

### Added

- 大幅强化文件预览功能
- 预览大小限制从 10MB 提升至 30MB
- 新增 EPUB 电子书预览（目录导航、翻页、键盘快捷键）
- 新增字体文件预览（TTF/OTF/WOFF/WOFF2）
- 新增 ZIP 压缩包内容列表预览（文件树、压缩统计）
- CSV 表格增强预览（搜索、排序、分页）
- PowerPoint 幻灯片本地预览
- PDF 分页预览与缩放控制
- Excel 多工作表切换与样式保留预览

### Improved

- 优化预览窗口大小控制（小/中/大/全屏）
- 统一预览类型配置（previewTypes.ts）
- 预览组件性能优化

## [v3.3.0] - 2026-03-24

### Added

- 文件版本控制功能
- 增强 Markdown 文件预览
- 新增 Excel 文件预览
- 后端错误码统一管理

## [v3.2.0] - 2026-03-23

### Added

- 直接创建文件功能
- 文件直链功能
- 分享页面预览功能

### Improved

- 优化移动端排版
- 其他细节优化

## [v3.1.0] - 2026-03-20

### Added

- 支持文件夹生成分享链接
- 支持指定文件夹生成上传链接给无账号人员上传文件
- 支持 Telegram 分片上传
- 存储桶迁移功能

### Improved

- 其他功能细节优化调整

## [v2.1.0] - 2026-03-19

### Added

- Telegram 存储支持

### Improved

- 优化 WebDAV 在 Windows 资源管理器等场景的使用
- 优化其他一系列功能

## [v1.1.0] - 2026-03-17

### Added

- 初始版本发布
