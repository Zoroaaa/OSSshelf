-- 121_ai_vision_timeout_config.sql
-- 新增视觉请求独立超时配置项。
-- 配置行必须由迁移落地，不能依赖 initializeAiConfig 运行时插入：
-- 部署后首批并发请求会把"缺失配置"同时补写，key 唯一约束冲突会让 /system-config 直接 500。
-- 幂等：已存在该 key（历史手工补齐）时跳过。

INSERT INTO ai_config (
    id, key, category, label, description, value_type,
    string_value, number_value, boolean_value, json_value,
    default_value, is_editable, sort_order
)
SELECT
    'cfg-request-vision-timeout',
    'ai.request.vision_timeout_ms',
    'retry',
    '视觉请求超时时间(ms)',
    '图片理解请求（含流式输出）的超时时间；截图/大图较慢，默认 120 秒',
    'number',
    NULL,
    120000,
    0,
    NULL,
    '120000',
    1,
    31
WHERE NOT EXISTS (
    SELECT 1 FROM ai_config WHERE key = 'ai.request.vision_timeout_ms'
);
