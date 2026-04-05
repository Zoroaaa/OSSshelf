/**
 * aiConfigService.ts
 * AI功能配置管理服务
 *
 * 功能:
 * - 读取AI相关配置项
 * - 初始化默认配置
 * - 提供配置访问接口
 */

import { getDb, aiConfig } from '../../db';
import { eq, and } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';

export interface AiConfigItem {
  id: string;
  key: string;
  category: string;
  label: string;
  description: string | null;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean;
  jsonValue: string | null;
  defaultValue: string;
  isSystem: boolean;
  isEditable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type AiConfigValue = string | number | boolean | object | null;

const CONFIG_CACHE_TTL_MS = 60_000;

let configCache: Map<string, AiConfigItem> | null = null;
let cacheTimestamp = 0;

export async function initializeAiConfig(env: Env): Promise<void> {
  const db = getDb(env.DB);
  const existingConfigs = await db.select().from(aiConfig).all();

  if (existingConfigs.length > 0) {
    logger.info('AiConfig', `已存在 ${existingConfigs.length} 条配置，跳过初始化`);
    return;
  }

  const defaultConfigs: Array<{
    key: string;
    category: string;
    label: string;
    description: string;
    valueType: 'string' | 'number' | 'boolean' | 'json';
    defaultValue: string;
    isEditable: boolean;
    sortOrder: number;
  }> = [
    {
      key: 'ai.default_model.chat',
      category: 'model',
      label: '默认对话模型',
      description: '用于通用对话、问答等场景的默认模型ID',
      valueType: 'string',
      defaultValue: '@cf/meta/llama-3.1-8b-instruct',
      isEditable: true,
      sortOrder: 1,
    },
    {
      key: 'ai.default_model.vision',
      category: 'model',
      label: '默认视觉模型',
      description: '用于图片分析、视觉理解的模型ID（需支持vision能力）',
      valueType: 'string',
      defaultValue: '@cf/llava-hf/llava-1.5-7b-hf',
      isEditable: true,
      sortOrder: 2,
    },
    {
      key: 'ai.default_model.summary',
      category: 'model',
      label: '文件摘要模型',
      description: '专门用于生成文件内容摘要的模型ID',
      valueType: 'string',
      defaultValue: '@cf/meta/llama-3.1-8b-instruct',
      isEditable: true,
      sortOrder: 3,
    },
    {
      key: 'ai.default_model.image_caption',
      category: 'model',
      label: '图片描述模型',
      description: '用于生成图片文字描述的模型ID',
      valueType: 'string',
      defaultValue: '@cf/llava-hf/llava-1.5-7b-hf',
      isEditable: true,
      sortOrder: 4,
    },
    {
      key: 'ai.default_model.image_tag',
      category: 'model',
      label: '图片标签模型',
      description: '用于识别图片内容并生成标签的模型ID',
      valueType: 'string',
      defaultValue: '@cf/llava-hf/llava-1.5-7b-hf',
      isEditable: true,
      sortOrder: 5,
    },
    {
      key: 'ai.default_model.rename',
      category: 'model',
      label: '智能重命名模型',
      description: '用于智能文件命名建议的模型ID',
      valueType: 'string',
      defaultValue: '@cf/meta/llama-3.1-8b-instruct',
      isEditable: true,
      sortOrder: 6,
    },
    {
      key: 'ai.model.max_tokens',
      category: 'parameter',
      label: '最大Token数',
      description: '模型生成的最大token数量',
      valueType: 'number',
      defaultValue: '4096',
      isEditable: true,
      sortOrder: 10,
    },
    {
      key: 'ai.model.temperature',
      category: 'parameter',
      label: '温度参数',
      description: '控制模型输出的随机性（0-2之间，越高越随机）',
      valueType: 'number',
      defaultValue: '0.7',
      isEditable: true,
      sortOrder: 11,
    },
    {
      key: 'ai.vision.max_tokens',
      category: 'parameter',
      label: '视觉模型最大Token数',
      description: '视觉模型分析图片时的最大输出token数',
      valueType: 'number',
      defaultValue: '600',
      isEditable: true,
      sortOrder: 12,
    },
    {
      key: 'ai.summary.content_limit',
      category: 'limit',
      label: '摘要内容长度限制',
      description: '生成摘要时输入文本的最大字符数',
      valueType: 'number',
      defaultValue: '8192',
      isEditable: true,
      sortOrder: 20,
    },
    {
      key: 'ai.rename.content_limit',
      category: 'limit',
      label: '重命名内容长度限制',
      description: '智能重命名时输入文本的最大字符数',
      valueType: 'number',
      defaultValue: '4096',
      isEditable: true,
      sortOrder: 21,
    },
    {
      key: 'ai.request.max_retries',
      category: 'retry',
      label: '最大重试次数',
      description: 'API请求失败后的最大重试次数',
      valueType: 'number',
      defaultValue: '3',
      isEditable: false,
      sortOrder: 30,
    },
    {
      key: 'ai.request.retry_base_delay_ms',
      category: 'retry',
      label: '重试基础延迟(ms)',
      description: '指数退避重试的基础延迟时间（毫秒）',
      valueType: 'number',
      defaultValue: '500',
      isEditable: false,
      sortOrder: 31,
    },
    {
      key: 'ai.request.timeout_ms',
      category: 'retry',
      label: '请求超时时间(ms)',
      description: '单个API请求的超时时间（毫秒）',
      valueType: 'number',
      defaultValue: '30000',
      isEditable: true,
      sortOrder: 32,
    },
    {
      key: 'ai.summary.prompt.default',
      category: 'prompt',
      label: '默认摘要提示词',
      description: '通用文件类型的摘要生成提示词模板',
      valueType: 'string',
      defaultValue: '你是文件助手。请用简洁的中文（不超过3句话）概括文件主要内容。',
      isEditable: true,
      sortOrder: 40,
    },
    {
      key: 'ai.summary.prompt.code',
      category: 'prompt',
      label: '代码摘要提示词',
      description: '代码文件的摘要生成提示词模板',
      valueType: 'string',
      defaultValue: '你是代码分析助手。请概括以下代码的功能、主要类/函数/接口、核心逻辑。（不超过4句话）',
      isEditable: true,
      sortOrder: 41,
    },
    {
      key: 'ai.summary.prompt.markdown',
      category: 'prompt',
      label: 'Markdown摘要提示词',
      description: 'Markdown文档的摘要生成提示词模板',
      valueType: 'string',
      defaultValue: '你是技术文档助手。请概括 Markdown 文档的结构、主要章节和核心内容。（不超过3句话）',
      isEditable: true,
      sortOrder: 42,
    },
    {
      key: 'ai.summary.prompt.data',
      category: 'prompt',
      label: '数据/配置摘要提示词',
      description: 'JSON/YAML/XML等数据配置文件的摘要生成提示词模板',
      valueType: 'string',
      defaultValue: '你是数据分析助手。请概括数据/配置文件的结构、关键字段和主要内容。（不超过3句话）',
      isEditable: true,
      sortOrder: 43,
    },
    {
      key: 'ai.summary.prompt.document',
      category: 'prompt',
      label: '文档摘要提示词（暂未启用）',
      description: '⚠️ 暂未启用：Office/PDF等文档类型暂不支持AI摘要，此配置保留备用',
      valueType: 'string',
      defaultValue: '你是文档分析助手。请概括文档的主题、关键论点和结论。（不超过3句话）',
      isEditable: true,
      sortOrder: 48,
    },
    {
      key: 'ai.summary.prompt.spreadsheet',
      category: 'prompt',
      label: '表格数据摘要提示词（暂未启用）',
      description: '⚠️ 暂未启用：Excel等表格文件暂不支持AI摘要，此配置保留备用',
      valueType: 'string',
      defaultValue: '你是数据分析助手。请概括表格/数据文件的数据类型、关键字段和数据趋势。（不超过3句话）',
      isEditable: true,
      sortOrder: 49,
    },
    {
      key: 'ai.feature.auto_process_enabled',
      category: 'feature',
      label: '启用自动处理',
      description: '上传文件后是否自动执行AI处理（摘要、标签等）',
      valueType: 'boolean',
      defaultValue: 'true',
      isEditable: true,
      sortOrder: 50,
    },
    {
      key: 'ai.feature.vector_index_enabled',
      category: 'feature',
      label: '启用向量索引',
      description: '是否为文件建立向量索引用于语义搜索',
      valueType: 'boolean',
      defaultValue: 'true',
      isEditable: true,
      sortOrder: 51,
    },
  ];

  for (const config of defaultConfigs) {
    await db.insert(aiConfig).values({
      id: crypto.randomUUID(),
      ...config,
      stringValue: config.valueType === 'string' ? config.defaultValue : null,
      numberValue: config.valueType === 'number' ? parseFloat(config.defaultValue) : null,
      booleanValue: config.valueType === 'boolean' ? config.defaultValue === 'true' : false,
      jsonValue: config.valueType === 'json' ? config.defaultValue : null,
    });
  }

  logger.info('AiConfig', `成功初始化 ${defaultConfigs.length} 条默认配置`);
  clearCache();
}

async function loadAllConfigs(env: Env): Promise<Map<string, AiConfigItem>> {
  const now = Date.now();
  if (configCache && now - cacheTimestamp < CONFIG_CACHE_TTL_MS) {
    return configCache;
  }

  const db = getDb(env.DB);
  const configs = await db.select().from(aiConfig).orderBy(aiConfig.sortOrder).all();
  configCache = new Map(configs.map((c) => [c.key, c as AiConfigItem]));
  cacheTimestamp = now;

  return configCache;
}

function clearCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}

export async function getAiConfig(env: Env, key: string): Promise<AiConfigValue> {
  const configs = await loadAllConfigs(env);
  const config = configs.get(key);

  if (!config) {
    logger.warn('AiConfig', `未找到配置项: ${key}`);
    return null;
  }

  switch (config.valueType) {
    case 'string':
      return config.stringValue ?? config.defaultValue;
    case 'number':
      return config.numberValue ?? parseFloat(config.defaultValue);
    case 'boolean':
      return config.booleanValue ?? config.defaultValue === 'true';
    case 'json':
      try {
        return config.jsonValue ? JSON.parse(config.jsonValue) : JSON.parse(config.defaultValue);
      } catch (error) {
        logger.error('AiConfig', `JSON解析失败: ${key}`, { error: String(error) });
        return null;
      }
    default:
      return config.stringValue ?? config.defaultValue;
  }
}

export async function getAiConfigString(env: Env, key: string, fallback?: string): Promise<string> {
  const value = await getAiConfig(env, key);
  return (value as string) || fallback || '';
}

export async function getAiConfigNumber(env: Env, key: string, fallback?: number): Promise<number> {
  const value = await getAiConfig(env, key);
  return (value as number) || fallback || 0;
}

export async function getAiConfigBoolean(env: Env, key: string, fallback?: boolean): Promise<boolean> {
  const value = await getAiConfig(env, key);
  return typeof value === 'boolean' ? value : fallback || false;
}

export async function getAllAiConfigs(env: Env): Promise<AiConfigItem[]> {
  const configs = await loadAllConfigs(env);
  return Array.from(configs.values());
}

export async function getAiConfigsByCategory(env: Env, category: string): Promise<AiConfigItem[]> {
  const allConfigs = await getAllAiConfigs(env);
  return allConfigs.filter((c) => c.category === category);
}

export async function updateAiConfig(env: Env, key: string, value: AiConfigValue): Promise<boolean> {
  const db = getDb(env.DB);

  const existing = await db.select().from(aiConfig).where(eq(aiConfig.key, key)).get();
  if (!existing) {
    logger.error('AiConfig', `更新失败：配置项不存在: ${key}`);
    return false;
  }
  if (!existing.isEditable) {
    logger.error('AiConfig', `更新失败：配置项不可编辑: ${key}`);
    return false;
  }

  let updateData: Record<string, unknown> = {};

  switch (existing.valueType) {
    case 'string':
      updateData = { stringValue: String(value), updatedAt: new Date().toISOString() };
      break;
    case 'number':
      updateData = { numberValue: Number(value), updatedAt: new Date().toISOString() };
      break;
    case 'boolean':
      updateData = { booleanValue: Boolean(value), updatedAt: new Date().toISOString() };
      break;
    case 'json':
      updateData = { jsonValue: JSON.stringify(value), updatedAt: new Date().toISOString() };
      break;
    default:
      updateData = { stringValue: String(value), updatedAt: new Date().toISOString() };
  }

  try {
    await db.update(aiConfig).set(updateData).where(eq(aiConfig.key, key));
    clearCache();
    logger.info('AiConfig', `配置已更新: ${key}`);
    return true;
  } catch (error) {
    logger.error('AiConfig', `更新配置失败: ${key}`, { error: String(error) });
    return false;
  }
}

export async function resetAiConfigToDefault(env: Env, key: string): Promise<boolean> {
  const db = getDb(env.DB);
  const existing = await db.select().from(aiConfig).where(eq(aiConfig.key, key)).get();

  if (!existing) return false;

  let resetData: Record<string, unknown> = {};
  switch (existing.valueType) {
    case 'string':
      resetData = { stringValue: existing.defaultValue, updatedAt: new Date().toISOString() };
      break;
    case 'number':
      resetData = { numberValue: parseFloat(existing.defaultValue), updatedAt: new Date().toISOString() };
      break;
    case 'boolean':
      resetData = { booleanValue: existing.defaultValue === 'true', updatedAt: new Date().toISOString() };
      break;
    case 'json':
      resetData = { jsonValue: existing.defaultValue, updatedAt: new Date().toISOString() };
      break;
    default:
      resetData = { stringValue: existing.defaultValue, updatedAt: new Date().toISOString() };
  }

  try {
    await db.update(aiConfig).set(resetData).where(eq(aiConfig.key, key));
    clearCache();
    logger.info('AiConfig', `配置已重置为默认值: ${key}`);
    return true;
  } catch (error) {
    logger.error('AiConfig', `重置配置失败: ${key}`, { error: String(error) });
    return false;
  }
}
