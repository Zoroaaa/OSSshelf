-- 0006_ai_features.sql
-- AI 功能相关表

-- ═══════════════════════════════════════════════════════════════════════════
-- AI模型配置表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'workers_ai',
    model_id TEXT NOT NULL,
    api_endpoint TEXT,
    api_key_encrypted TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    capabilities TEXT NOT NULL DEFAULT '["chat","completion"]',
    temperature REAL DEFAULT 0.7,
    system_prompt TEXT DEFAULT '你是OSSshelf文件管理系统的智能助手。你可以帮助用户查询、分析和管理他们的文件。',
    config_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_models_user_active ON ai_models(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_user_provider ON ai_models(user_id, provider);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI会话历史表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    model_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON ai_chat_sessions(user_id, updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI消息记录表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    sources TEXT,
    model_used TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON ai_chat_messages(session_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 批处理任务表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  total       INTEGER NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  completed_at TEXT,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_type ON ai_tasks (user_id, type);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks (status);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI功能配置表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_config (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    value_type TEXT NOT NULL DEFAULT 'string',
    string_value TEXT,
    number_value REAL,
    boolean_value INTEGER DEFAULT 0,
    json_value TEXT,
    default_value TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 1,
    is_editable INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_config_category ON ai_config(category);
CREATE INDEX IF NOT EXISTS idx_ai_config_key ON ai_config(key);

-- 默认模型配置
INSERT INTO ai_config (id, key, category, label, description, value_type, string_value, default_value, is_editable, sort_order) VALUES
    ('cfg-model-chat', 'ai.default_model.chat', 'model', '默认对话模型', '用于通用对话、问答等场景的默认模型ID', 'string', '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-8b-instruct', 1, 1),
    ('cfg-model-vision', 'ai.default_model.vision', 'model', '默认视觉模型', '用于图片分析、视觉理解的模型ID（需支持vision能力）', 'string', '@cf/llava-hf/llava-1.5-7b-hf', '@cf/llava-hf/llava-1.5-7b-hf', 1, 2),
    ('cfg-model-summary', 'ai.default_model.summary', 'model', '文件摘要模型', '专门用于生成文件内容摘要的模型ID', 'string', '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-8b-instruct', 1, 3),
    ('cfg-model-image-caption', 'ai.default_model.image_caption', 'model', '图片描述模型', '用于生成图片文字描述的模型ID', 'string', '@cf/llava-hf/llava-1.5-7b-hf', '@cf/llava-hf/llava-1.5-7b-hf', 1, 4),
    ('cfg-model-image-tag', 'ai.default_model.image_tag', 'model', '图片标签模型', '用于识别图片内容并生成标签的模型ID', 'string', '@cf/llava-hf/llava-1.5-7b-hf', '@cf/llava-hf/llava-1.5-7b-hf', 1, 5),
    ('cfg-model-rename', 'ai.default_model.rename', 'model', '智能重命名模型', '用于智能文件命名建议的模型ID', 'string', '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-8b-instruct', 1, 6);

-- 模型参数配置
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-param-temperature', 'ai.model.temperature', 'parameter', '温度参数', '控制模型输出的随机性（0-2之间，越高越随机）', 'number', 0.7, '0.7', 1, 11);

-- 重试策略配置
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-retry-max-retries', 'ai.request.max_retries', 'retry', '最大重试次数', 'API请求失败后的最大重试次数', 'number', 3, '3', 0, 30),
    ('cfg-retry-base-delay', 'ai.request.retry_base_delay_ms', 'retry', '重试基础延迟(ms)', '指数退避重试的基础延迟时间（毫秒）', 'number', 500, '500', 0, 31),
    ('cfg-retry-timeout', 'ai.request.timeout_ms', 'retry', '请求超时时间(ms)', '单个API请求的超时时间（毫秒）', 'number', 30000, '30000', 1, 32);

-- 提示词模板配置
INSERT INTO ai_config (id, key, category, label, description, value_type, string_value, default_value, is_editable, sort_order) VALUES
    ('cfg-prompt-default', 'ai.summary.prompt.default', 'prompt', '默认摘要提示词', '通用文件类型的摘要生成提示词模板', 'string', '你是文件助手。请用简洁的中文（不超过3句话）概括文件主要内容。', '你是文件助手。请用简洁的中文（不超过3句话）概括文件主要内容。', 1, 40),
    ('cfg-prompt-code', 'ai.summary.prompt.code', 'prompt', '代码摘要提示词', '代码文件的摘要生成提示词模板', 'string', '你是代码分析助手。请概括以下代码的功能、主要类/函数/接口、核心逻辑。（不超过4句话）', '你是代码分析助手。请概括以下代码的功能、主要类/函数/接口、核心逻辑。（不超过4句话）', 1, 41),
    ('cfg-prompt-markdown', 'ai.summary.prompt.markdown', 'prompt', 'Markdown摘要提示词', 'Markdown文档的摘要生成提示词模板', 'string', '你是技术文档助手。请概括 Markdown 文档的结构、主要章节和核心内容。（不超过3句话）', '你是技术文档助手。请概括 Markdown 文档的结构、主要章节和核心内容。（不超过3句话）', 1, 42),
    ('cfg-prompt-data', 'ai.summary.prompt.data', 'prompt', '数据/配置摘要提示词', 'JSON/YAML/XML等数据配置文件的摘要生成提示词模板', 'string', '你是数据分析助手。请概括数据/配置文件的结构、关键字段和主要内容。（不超过3句话）', '你是数据分析助手。请概括数据/配置文件的结构、关键字段和主要内容。（不超过3句话）', 1, 43);

-- 功能开关配置
INSERT INTO ai_config (id, key, category, label, description, value_type, boolean_value, default_value, is_editable, sort_order) VALUES
    ('cfg-feature-auto-process', 'ai.feature.auto_process_enabled', 'feature', '启用自动处理', '上传文件后是否自动执行AI处理（摘要、标签等）', 'boolean', 1, 'true', 1, 50),
    ('cfg-feature-vector-index', 'ai.feature.vector_index_enabled', 'feature', '启用向量索引', '是否为文件建立向量索引用于语义搜索', 'boolean', 1, 'true', 1, 51);
