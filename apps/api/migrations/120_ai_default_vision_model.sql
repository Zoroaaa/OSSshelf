-- 120_ai_default_vision_model.sql
-- 默认视觉模型切换：@cf/llava-hf/llava-1.5-7b-hf 已从 Workers AI 下线（调用返回 410），
-- 统一替换为实测可用的 llama-4-scout。仅替换仍停留在旧默认值的行，用户自选的其他模型不动。

UPDATE ai_config
SET string_value = '@cf/meta/llama-4-scout-17b-16e-instruct',
    default_value = '@cf/meta/llama-4-scout-17b-16e-instruct',
    updated_at = CURRENT_TIMESTAMP
WHERE key IN ('ai.default_model.vision', 'ai.default_model.image_caption', 'ai.default_model.image_tag')
  AND string_value = '@cf/llava-hf/llava-1.5-7b-hf';

UPDATE ai_feature_config
SET model_id = '@cf/meta/llama-4-scout-17b-16e-instruct',
    updated_at = CURRENT_TIMESTAMP
WHERE feature IN ('image_caption', 'image_tag')
  AND model_id = '@cf/llava-hf/llava-1.5-7b-hf';
