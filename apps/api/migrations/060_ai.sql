-- 060_ai.sql - AI 功能：模型配置、对话系统、任务队列、配置中心、提供商

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 提供商表 (v4.4.0)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_endpoint TEXT,
  description TEXT,
  thinking_config TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_user_active ON ai_providers(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_providers_user_default ON ai_providers(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_ai_providers_system ON ai_providers(is_system);

-- 系统内置提供商数据
INSERT OR IGNORE INTO ai_providers (id, user_id, name, api_endpoint, description, thinking_config, is_system, is_default, is_active, sort_order, created_at, updated_at)
VALUES 
  ('vendor-baidu', NULL, '百度文心一言', 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop', '百度文心一言大模型', '{"paramFormat":"boolean","paramName":"enable_thinking","enabledValue":true,"disabledValue":false}', 1, 0, 1, 100, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-tencent', NULL, '腾讯混元', 'https://api.hunyuan.cloud.tencent.com/v1', '腾讯混元大模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 99, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-alibaba', NULL, '阿里通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '阿里通义千问大模型', '{"paramFormat":"boolean","paramName":"enable_thinking","enabledValue":true,"disabledValue":false}', 1, 0, 1, 98, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-volcengine', NULL, '字节火山引擎', 'https://ark.cn-beijing.volces.com/api/v3', '字节跳动火山引擎豆包大模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 97, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-zhipu', NULL, '智谱AI', 'https://open.bigmodel.cn/api/paas/v4', '智谱GLM大模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 96, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-minimax', NULL, 'MiniMax', 'https://api.minimax.chat/v1', 'MiniMax大模型', NULL, 1, 0, 1, 95, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-moonshot', NULL, '月之暗面', 'https://api.moonshot.cn/v1', '月之暗面Kimi大模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 94, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-siliconflow', NULL, '硅基流动', 'https://api.siliconflow.cn/v1', '硅基流动模型聚合平台', '{"paramFormat":"boolean","paramName":"enable_thinking","enabledValue":true,"disabledValue":false}', 1, 0, 1, 93, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-deepseek', NULL, 'DeepSeek', 'https://api.deepseek.com/v1', 'DeepSeek深度求索大模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 91, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-openai', NULL, 'OpenAI', 'https://api.openai.com/v1', 'OpenAI GPT系列模型', '{"paramFormat":"string","paramName":"reasoning_effort","enabledValue":"medium","disabledValue":"low"}', 1, 0, 1, 90, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-anthropic', NULL, 'Anthropic Claude', 'https://api.anthropic.com/v1', 'Anthropic Claude系列模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 89, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-google', NULL, 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'Google Gemini系列模型', '{"paramFormat":"string","paramName":"thinking_level","enabledValue":"high","disabledValue":"low"}', 1, 0, 1, 88, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-mistral', NULL, 'Mistral AI', 'https://api.mistral.ai/v1', 'Mistral AI大模型', NULL, 1, 0, 1, 87, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-xai', NULL, 'xAI Grok', 'https://api.x.ai/v1', 'xAI Grok系列模型', '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}', 1, 0, 1, 86, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-groq', NULL, 'Groq', 'https://api.groq.com/openai/v1', 'Groq高速推理平台', NULL, 1, 0, 1, 85, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-perplexity', NULL, 'Perplexity', 'https://api.perplexity.ai', 'Perplexity联网搜索模型', NULL, 1, 0, 1, 84, datetime('now', 'localtime'), datetime('now', 'localtime')),
  ('vendor-openrouter', NULL, 'OpenRouter', 'https://openrouter.ai/api/v1', 'OpenRouter模型聚合平台', NULL, 1, 0, 1, 83, datetime('now', 'localtime'), datetime('now', 'localtime'));

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 模型配置表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'workers_ai',
    provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    model_id TEXT NOT NULL,
    api_endpoint TEXT,
    api_key_encrypted TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    capabilities TEXT NOT NULL DEFAULT '["chat","completion"]',
    temperature REAL DEFAULT 0.7,
    system_prompt TEXT DEFAULT '你是OSSshelf文件管理系统的智能助手。你可以帮助用户查询、分析和管理他们的文件。',
    config_json TEXT DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_models_user_active ON ai_models(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_user_provider ON ai_models(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 会话历史表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    model_id TEXT,
    last_tool_call_count INTEGER NOT NULL DEFAULT 0,
    total_tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON ai_chat_sessions(user_id, updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 消息记录表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    tool_calls TEXT,
    reasoning TEXT,
    sources TEXT,
    model_used TEXT,
    latency_ms INTEGER,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_ai_tasks_completed ON ai_tasks(completed_at) WHERE completed_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 功能配置表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_config (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    value_type TEXT NOT NULL DEFAULT 'string',
    string_value TEXT,
    number_value REAL,
    boolean_value INTEGER DEFAULT 0,
    json_value TEXT,
    value TEXT,
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

-- Agent 配置
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-agent-temperature', 'ai.agent.temperature', 'agent', 'Agent温度参数', 'Agent对话时的温度参数（0-2之间，越低越确定）', 'number', 0.3, '0.3', 1, 14),
    ('cfg-agent-max-tool-calls', 'ai.agent.max_tool_calls', 'agent', '最大工具调用次数', '单次Agent响应中最大工具调用次数', 'number', 20, '20', 1, 15),
    ('cfg-agent-max-idle-rounds', 'ai.agent.max_idle_rounds', 'agent', '最大空转轮数', '连续无新文件信息后自动退出的轮数', 'number', 3, '3', 1, 16),
    ('cfg-agent-image-timeout-ms', 'ai.agent.image_timeout_ms', 'agent', '图片分析超时(ms)', '单张图片分析的超时时间（毫秒）', 'number', 25000, '25000', 1, 20);

-- Agent 最大上下文 Token 数配置 (v4.4.0)
INSERT INTO ai_config (id, user_id, key, value, description, created_at, updated_at)
SELECT 
  lower(hex(randomblob(16))),
  NULL,
  'ai.agent.max_context_tokens',
  '100000',
  'Agent 最大上下文 Token 数，用于裁剪历史消息',
  strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now'),
  strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')
WHERE NOT EXISTS (SELECT 1 FROM ai_config WHERE key = 'ai.agent.max_context_tokens');

-- Tool 配置
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-tool-max-image-size', 'ai.tool.max_image_size_bytes', 'tool', '图片最大大小(字节)', '允许AI分析的图片最大字节数（超过则跳过分析）', 'number', 5242880, '5242880', 1, 21),
    ('cfg-tool-text-chunk-size', 'ai.tool.text_chunk_size', 'tool', '文本分段大小', '读取文件内容时每段的字符数', 'number', 1500, '1500', 1, 22);

-- RAG 配置
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-rag-max-files', 'ai.rag.max_files', 'rag', 'RAG最大文件数', 'RAG检索时返回的最大文件数', 'number', 5, '5', 1, 27),
    ('cfg-rag-max-context-length', 'ai.rag.max_context_length', 'rag', 'RAG最大上下文长度', 'RAG上下文的最大字符数', 'number', 8000, '8000', 1, 28);

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

-- ═══════════════════════════════════════════════════════════════════════════
-- AI 工具确认请求表 (v4.3.0)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_confirm_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirm_user_status ON ai_confirm_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_confirm_expires ON ai_confirm_requests(expires_at);
