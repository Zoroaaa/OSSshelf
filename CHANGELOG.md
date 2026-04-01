# Changelog

All notable changes to this project will be documented in this file.

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
