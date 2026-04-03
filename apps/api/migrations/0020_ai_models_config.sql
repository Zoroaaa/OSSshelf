-- 0020_ai_models_config.sql
-- AI模型配置表
-- 支持多模型接入（Workers AI + 自定义API）

CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'workers_ai', -- workers_ai, openai_compatible, anthropic, custom
    model_id TEXT NOT NULL, -- 模型标识符，如 @cf/meta/llama-3.1-8b-instruct 或 gpt-4
    api_endpoint TEXT, -- 自定义API端点
    api_key_encrypted TEXT, -- 加密存储的API密钥
    is_active INTEGER NOT NULL DEFAULT 1, -- 是否为当前激活模型
    capabilities TEXT NOT NULL DEFAULT '["chat","completion"]', -- 模型能力：chat, completion, embedding, vision
    max_tokens INTEGER DEFAULT 4096,
    temperature REAL DEFAULT 0.7,
    system_prompt TEXT DEFAULT '你是OSSshelf文件管理系统的智能助手。你可以帮助用户查询、分析和管理他们的文件。',
    config_json TEXT DEFAULT '{}', -- 额外配置（JSON格式）
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_models_user_active ON ai_models(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_user_provider ON ai_models(user_id, provider);

-- AI会话历史表
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    model_id TEXT, -- 使用的模型ID
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON ai_chat_sessions(user_id, updated_at DESC);

-- AI消息记录表
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    sources TEXT, -- 引用的文件来源（JSON数组）
    token_count INTEGER,
    model_used TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON ai_chat_messages(session_id, created_at);

-- AI使用统计表
CREATE TABLE IF NOT EXISTS ai_usage_stats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD格式
    request_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE CASCADE,
    UNIQUE(user_id, model_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_stats_user_date ON ai_usage_stats(user_id, date DESC);
