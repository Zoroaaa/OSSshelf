-- 0009_ai_config_extended.sql
-- 扩展 AI 配置项，将硬编码值移至数据库配置

-- ═══════════════════════════════════════════════════════════════════════════
-- Agent 配置
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-agent-temperature', 'ai.agent.temperature', 'agent', 'Agent温度参数', 'Agent对话时的温度参数（0-2之间，越低越确定）', 'number', 0.3, '0.3', 1, 14),
    ('cfg-agent-max-tool-calls', 'ai.agent.max_tool_calls', 'agent', '最大工具调用次数', '单次Agent响应中最大工具调用次数', 'number', 20, '20', 1, 15),
    ('cfg-agent-max-idle-rounds', 'ai.agent.max_idle_rounds', 'agent', '最大空转轮数', '连续无新文件信息后自动退出的轮数', 'number', 3, '3', 1, 16),
    ('cfg-agent-image-timeout-ms', 'ai.agent.image_timeout_ms', 'agent', '图片分析超时(ms)', '单张图片分析的超时时间（毫秒）', 'number', 25000, '25000', 1, 20);

-- ═══════════════════════════════════════════════════════════════════════════
-- Tool 配置
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-tool-max-image-size', 'ai.tool.max_image_size_bytes', 'tool', '图片最大大小(字节)', '允许AI分析的图片最大字节数（超过则跳过分析）', 'number', 5242880, '5242880', 1, 21),
    ('cfg-tool-text-chunk-size', 'ai.tool.text_chunk_size', 'tool', '文本分段大小', '读取文件内容时每段的字符数', 'number', 1500, '1500', 1, 22);

-- ═══════════════════════════════════════════════════════════════════════════
-- RAG 配置
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_config (id, key, category, label, description, value_type, number_value, default_value, is_editable, sort_order) VALUES
    ('cfg-rag-max-files', 'ai.rag.max_files', 'rag', 'RAG最大文件数', 'RAG检索时返回的最大文件数', 'number', 5, '5', 1, 27),
    ('cfg-rag-max-context-length', 'ai.rag.max_context_length', 'rag', 'RAG最大上下文长度', 'RAG上下文的最大字符数', 'number', 8000, '8000', 1, 28);
