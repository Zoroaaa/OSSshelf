-- 112_ai_provider_connections.sql
-- AI 配置改造：连接信息从 ai_models 上移到 ai_providers
--
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN 与 DROP COLUMN，SQLite 不支持
--    IF [NOT] EXISTS，重跑会报 duplicate column name / no such column。
--    请勿在控制台手工执行本文件，只能依赖 d1_migrations 记录保证不重跑。
--    若曾手工执行过片段导致 duplicate 错误，修复步骤见 docs/runbooks/d1-112-repair.md。
--
-- 目标：
-- 1. ai_providers = 用户级连接（protocol + base_url + encrypted key）
-- 2. ai_models = 模型元数据 + 能力路由，不再重复存 endpoint/key
-- 3. 修正旧的系统预设协议/地址，并迁移为每个用户自己的连接
-- 4. 功能级模型统一到 ai_feature_config

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 增列
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE ai_providers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai_compatible';
ALTER TABLE ai_providers ADD COLUMN api_key_encrypted TEXT;
ALTER TABLE ai_providers ADD COLUMN preset_id TEXT;
ALTER TABLE ai_providers ADD COLUMN logo_url TEXT;
ALTER TABLE ai_providers ADD COLUMN headers_json TEXT;
ALTER TABLE ai_providers ADD COLUMN discovered_models_json TEXT;
ALTER TABLE ai_providers ADD COLUMN models_synced_at TEXT;
ALTER TABLE ai_providers ADD COLUMN default_input TEXT NOT NULL DEFAULT '["text"]';

ALTER TABLE ai_models ADD COLUMN context_window INTEGER;
ALTER TABLE ai_models ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN input_modalities TEXT DEFAULT '["text"]';
ALTER TABLE ai_models ADD COLUMN pricing_json TEXT;
ALTER TABLE ai_models ADD COLUMN metadata_source TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 修正旧的系统预设（必须在复制给用户之前）
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE ai_providers SET protocol = 'anthropic', api_endpoint = 'https://api.anthropic.com/v1'
WHERE id = 'vendor-anthropic';

UPDATE ai_providers SET protocol = 'openai_compatible', api_endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai'
WHERE id = 'vendor-google';

UPDATE ai_providers SET protocol = 'anthropic', api_endpoint = 'https://api.minimax.io/anthropic/v1'
WHERE id = 'vendor-minimax';

UPDATE ai_providers SET protocol = 'openai_compatible', api_endpoint = 'https://qianfan.baidubce.com/v2'
WHERE id = 'vendor-baidu';

UPDATE ai_providers SET protocol = 'openai_compatible'
WHERE id IN (
  'vendor-tencent', 'vendor-alibaba', 'vendor-volcengine', 'vendor-zhipu',
  'vendor-moonshot', 'vendor-siliconflow', 'vendor-deepseek', 'vendor-openai',
  'vendor-mistral', 'vendor-xai', 'vendor-groq', 'vendor-perplexity', 'vendor-openrouter'
);

-- vendor-deepseek -> deepseek，vendor-openai -> openai，供代码预设匹配
UPDATE ai_providers SET preset_id = replace(id, 'vendor-', '') WHERE is_system = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 没有 provider 的历史外部模型：按 (user, endpoint) 建用户级连接
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_providers (
  id, user_id, name, protocol, api_endpoint, api_key_encrypted, preset_id, logo_url,
  headers_json, discovered_models_json, models_synced_at, default_input, description,
  thinking_config, is_system, is_default, is_active, sort_order, created_at, updated_at
)
SELECT
  'legacy-' || lower(hex(randomblob(6))),
  m.user_id,
  '自定义连接',
  CASE WHEN lower(m.api_endpoint) LIKE '%anthropic%' THEN 'anthropic' ELSE 'openai_compatible' END,
  m.api_endpoint,
  MAX(m.api_key_encrypted),
  CASE
    WHEN m.api_endpoint LIKE '%api.deepseek.com%' THEN 'deepseek'
    WHEN m.api_endpoint LIKE '%api.openai.com%' THEN 'openai'
    WHEN m.api_endpoint LIKE '%api.anthropic.com%' THEN 'anthropic'
    WHEN m.api_endpoint LIKE '%generativelanguage.googleapis.com%' THEN 'google'
    WHEN m.api_endpoint LIKE '%api.x.ai%' THEN 'xai'
    WHEN m.api_endpoint LIKE '%api.mistral.ai%' THEN 'mistral'
    WHEN m.api_endpoint LIKE '%api.groq.com%' THEN 'groq'
    WHEN m.api_endpoint LIKE '%openrouter.ai%' THEN 'openrouter'
    WHEN m.api_endpoint LIKE '%api.perplexity.ai%' THEN 'perplexity'
    WHEN m.api_endpoint LIKE '%api.siliconflow%' THEN 'siliconflow'
    WHEN m.api_endpoint LIKE '%api.moonshot%' THEN 'moonshot'
    WHEN m.api_endpoint LIKE '%open.bigmodel.cn%' THEN 'zhipu'
    WHEN m.api_endpoint LIKE '%dashscope.aliyuncs.com%' THEN 'alibaba'
    WHEN m.api_endpoint LIKE '%ark.cn-beijing.volces.com%' THEN 'volcengine'
    WHEN m.api_endpoint LIKE '%api.minimax%' THEN 'minimax'
    ELSE NULL
  END,
  NULL, NULL, NULL, NULL, '["text"]', NULL, NULL,
  0, 0, 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM ai_models m
WHERE m.provider <> 'workers_ai'
  AND m.provider_id IS NULL
  AND m.api_endpoint IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ai_providers p
    WHERE p.user_id = m.user_id
      AND p.api_endpoint = m.api_endpoint
      AND p.is_system = 0
  )
GROUP BY m.user_id, m.api_endpoint;

UPDATE ai_models
SET provider_id = (
  SELECT p.id FROM ai_providers p
  WHERE p.user_id = ai_models.user_id
    AND p.api_endpoint = ai_models.api_endpoint
    AND p.is_system = 0
  ORDER BY p.created_at DESC
  LIMIT 1
)
WHERE provider_id IS NULL
  AND provider <> 'workers_ai'
  AND api_endpoint IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 引用系统预设的历史模型：为每个用户复制一条自己的连接
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_providers (
  id, user_id, name, protocol, api_endpoint, api_key_encrypted, preset_id, logo_url,
  headers_json, discovered_models_json, models_synced_at, default_input, description,
  thinking_config, is_system, is_default, is_active, sort_order, created_at, updated_at
)
SELECT
  'legacy-' || lower(hex(randomblob(6))),
  m.user_id,
  sp.name,
  sp.protocol,
  sp.api_endpoint,
  MAX(m.api_key_encrypted),
  sp.preset_id,
  sp.logo_url,
  sp.headers_json,
  NULL, NULL,
  sp.default_input,
  sp.description,
  sp.thinking_config,
  0, 0, 1, sp.sort_order,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM ai_models m
JOIN ai_providers sp ON sp.id = m.provider_id
WHERE sp.is_system = 1
  AND NOT EXISTS (
    SELECT 1 FROM ai_providers p
    WHERE p.user_id = m.user_id
      AND p.preset_id = sp.preset_id
      AND p.is_system = 0
  )
GROUP BY m.user_id, sp.id;

UPDATE ai_models
SET provider_id = (
  SELECT p.id FROM ai_providers p
  WHERE p.user_id = ai_models.user_id
    AND p.preset_id = (
      SELECT sp.preset_id FROM ai_providers sp WHERE sp.id = ai_models.provider_id
    )
    AND p.is_system = 0
  ORDER BY p.created_at DESC
  LIMIT 1
)
WHERE provider_id IN (SELECT id FROM ai_providers WHERE is_system = 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 已有用户级连接但没 Key：从引用它的模型回填
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE ai_providers
SET api_key_encrypted = (
  SELECT MAX(m.api_key_encrypted) FROM ai_models m
  WHERE m.provider_id = ai_providers.id
    AND m.api_key_encrypted IS NOT NULL
)
WHERE api_key_encrypted IS NULL
  AND user_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 删除已无模型引用的系统预设
-- ═══════════════════════════════════════════════════════════════════════════
DELETE FROM ai_providers
WHERE is_system = 1
  AND id NOT IN (SELECT provider_id FROM ai_models WHERE provider_id IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 功能级模型配置去重：把 ai_config 的非默认值复制到 ai_feature_config
--    （仅复制给尚无该 feature 配置的用户）
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_feature_config (id, user_id, feature, model_id, updated_at)
SELECT lower(hex(randomblob(16))), u.id, 'summary', c.string_value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN ai_config c ON c.key = 'ai.default_model.summary'
WHERE c.string_value IS NOT NULL
  AND c.string_value <> c.default_value
  AND NOT EXISTS (SELECT 1 FROM ai_feature_config f WHERE f.user_id = u.id AND f.feature = 'summary');

INSERT INTO ai_feature_config (id, user_id, feature, model_id, updated_at)
SELECT lower(hex(randomblob(16))), u.id, 'image_caption', c.string_value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN ai_config c ON c.key = 'ai.default_model.image_caption'
WHERE c.string_value IS NOT NULL
  AND c.string_value <> c.default_value
  AND NOT EXISTS (SELECT 1 FROM ai_feature_config f WHERE f.user_id = u.id AND f.feature = 'image_caption');

INSERT INTO ai_feature_config (id, user_id, feature, model_id, updated_at)
SELECT lower(hex(randomblob(16))), u.id, 'image_tag', c.string_value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN ai_config c ON c.key = 'ai.default_model.image_tag'
WHERE c.string_value IS NOT NULL
  AND c.string_value <> c.default_value
  AND NOT EXISTS (SELECT 1 FROM ai_feature_config f WHERE f.user_id = u.id AND f.feature = 'image_tag');

INSERT INTO ai_feature_config (id, user_id, feature, model_id, updated_at)
SELECT lower(hex(randomblob(16))), u.id, 'rename', c.string_value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN ai_config c ON c.key = 'ai.default_model.rename'
WHERE c.string_value IS NOT NULL
  AND c.string_value <> c.default_value
  AND NOT EXISTS (SELECT 1 FROM ai_feature_config f WHERE f.user_id = u.id AND f.feature = 'rename');

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 删除模型上的连接字段
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE ai_models DROP COLUMN api_endpoint;
ALTER TABLE ai_models DROP COLUMN api_key_encrypted;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 索引
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_ai_providers_user_preset ON ai_providers(user_id, preset_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_user_provider_model ON ai_models(user_id, provider_id, model_id);
