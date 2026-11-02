/**
 * providerPresets.ts
 * AI 供应商预设目录（代码单一事实来源）
 *
 * 设计：
 * - 预设只提供默认值（协议 / BaseURL / 文档 / logo / 元数据 id），
 *   用户连接以 ai_providers 行为准，可覆盖 BaseURL。
 * - 运行时不需要访问 models.dev；模型元数据来自打包快照。
 */

export type AiProtocol = 'openai_compatible' | 'anthropic';
export type AiProviderKind = AiProtocol | 'workers_ai';

export interface ProviderThinkingConfig {
  paramFormat: 'object' | 'boolean' | 'string';
  paramName: string;
  nestedKey?: string;
  enabledValue?: string | boolean;
  disabledValue?: string | boolean;
}

export interface ProviderPreset {
  /** 代码内稳定 id，写入 ai_providers.preset_id */
  id: string;
  name: string;
  kind: AiProviderKind;
  protocol: AiProtocol | null;
  baseUrl: string;
  docsUrl: string;
  logoUrl?: string;
  /** 是否必须填 API Key；本地自定义端点可为 false */
  requiresApiKey: boolean;
  /** models.dev provider id，用于查模型元数据 */
  metadataProviderId?: string;
  defaultInput: string[];
  description: string;
  thinkingConfig?: ProviderThinkingConfig;
}

function logo(providerId: string): string {
  return `https://models.dev/logos/${providerId}.svg`;
}

export const WORKERS_AI_PRESET: ProviderPreset = {
  id: 'workers_ai',
  name: 'Cloudflare Workers AI',
  kind: 'workers_ai',
  protocol: null,
  baseUrl: '',
  docsUrl: 'https://developers.cloudflare.com/workers-ai/models/',
  requiresApiKey: false,
  metadataProviderId: 'cloudflare-workers-ai',
  defaultInput: ['text'],
  description: 'Cloudflare 内置 AI，无需 API Key，按 Neurons 计费',
};

/**
 * 第三方供应商预设。
 * 顺序即 UI 展示顺序：国内常用在前，聚合/海外在后。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  WORKERS_AI_PRESET,
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com',
    docsUrl: 'https://api-docs.deepseek.com/',
    logoUrl: logo('deepseek'),
    requiresApiKey: true,
    metadataProviderId: 'deepseek',
    defaultInput: ['text'],
    description: 'DeepSeek 深度求索，OpenAI 兼容',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs/models',
    logoUrl: logo('openai'),
    requiresApiKey: true,
    metadataProviderId: 'openai',
    defaultInput: ['text', 'image'],
    description: 'OpenAI GPT 系列，OpenAI 兼容',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    logoUrl: logo('anthropic'),
    requiresApiKey: true,
    metadataProviderId: 'anthropic',
    defaultInput: ['text', 'image'],
    description: 'Anthropic Claude，原生 Messages 协议',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    logoUrl: logo('google'),
    requiresApiKey: true,
    metadataProviderId: 'google',
    defaultInput: ['text', 'image'],
    description: 'Google Gemini，走 OpenAI 兼容端点',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/',
    logoUrl: logo('siliconflow'),
    requiresApiKey: true,
    metadataProviderId: 'siliconflow-cn',
    defaultInput: ['text'],
    description: 'SiliconFlow 模型聚合平台',
    thinkingConfig: {
      paramFormat: 'boolean',
      paramName: 'enable_thinking',
      enabledValue: true,
      disabledValue: false,
    },
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs',
    logoUrl: logo('moonshotai'),
    requiresApiKey: true,
    metadataProviderId: 'moonshotai-cn',
    defaultInput: ['text'],
    description: 'Moonshot AI / Kimi',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/',
    logoUrl: logo('zhipuai'),
    requiresApiKey: true,
    metadataProviderId: 'zhipuai',
    defaultInput: ['text', 'image'],
    description: '智谱 GLM 系列',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'alibaba',
    name: '阿里通义千问',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    logoUrl: logo('alibaba'),
    requiresApiKey: true,
    metadataProviderId: 'alibaba-cn',
    defaultInput: ['text', 'image'],
    description: '阿里云百炼 / 通义千问',
    thinkingConfig: {
      paramFormat: 'boolean',
      paramName: 'enable_thinking',
      enabledValue: true,
      disabledValue: false,
    },
  },
  {
    id: 'volcengine',
    name: '火山引擎豆包',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    docsUrl: 'https://www.volcengine.com/docs/82379',
    logoUrl: logo('volcengine'),
    requiresApiKey: true,
    metadataProviderId: 'volcengine',
    defaultInput: ['text', 'image'],
    description: '字节跳动火山方舟 / 豆包',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.io/anthropic/v1',
    docsUrl: 'https://platform.minimaxi.com/document',
    logoUrl: logo('minimax'),
    requiresApiKey: true,
    metadataProviderId: 'minimax',
    defaultInput: ['text'],
    description: 'MiniMax，使用 Anthropic 兼容端点',
  },
  {
    id: 'baidu',
    name: '百度千帆',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html',
    requiresApiKey: true,
    defaultInput: ['text'],
    description: '百度智能云千帆（OpenAI 兼容 v2）',
    thinkingConfig: {
      paramFormat: 'boolean',
      paramName: 'enable_thinking',
      enabledValue: true,
      disabledValue: false,
    },
  },
  {
    id: 'tencent',
    name: '腾讯混元',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    docsUrl: 'https://cloud.tencent.com/document/product/1729',
    requiresApiKey: true,
    defaultInput: ['text'],
    description: '腾讯云混元（OpenAI 兼容）',
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://docs.x.ai/docs/models',
    logoUrl: logo('xai'),
    requiresApiKey: true,
    metadataProviderId: 'xai',
    defaultInput: ['text', 'image'],
    description: 'xAI Grok 系列',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    logoUrl: logo('mistral'),
    requiresApiKey: true,
    metadataProviderId: 'mistral',
    defaultInput: ['text'],
    description: 'Mistral AI',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/docs/models',
    logoUrl: logo('groq'),
    requiresApiKey: true,
    metadataProviderId: 'groq',
    defaultInput: ['text'],
    description: 'Groq 高速推理',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
    logoUrl: logo('openrouter'),
    requiresApiKey: true,
    metadataProviderId: 'openrouter',
    defaultInput: ['text', 'image'],
    description: 'OpenRouter 模型聚合平台',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    kind: 'openai_compatible',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.perplexity.ai',
    docsUrl: 'https://docs.perplexity.ai/',
    logoUrl: logo('perplexity'),
    requiresApiKey: true,
    metadataProviderId: 'perplexity',
    defaultInput: ['text'],
    description: 'Perplexity 联网搜索模型（部分账号不支持模型列表）',
  },
];

const REFERENCE_PROVIDER_PRESETS = PROVIDER_PRESETS.filter((preset) => preset.id !== 'workers_ai');

export function getProviderPreset(id: string | null | undefined): ProviderPreset | undefined {
  if (!id) return undefined;
  const normalized = id.startsWith('vendor-') ? id.slice('vendor-'.length) : id;
  return PROVIDER_PRESETS.find((preset) => preset.id === normalized);
}

export function getReferenceProviderPresets(): ProviderPreset[] {
  return REFERENCE_PROVIDER_PRESETS;
}

export function presetLogoUrl(preset: ProviderPreset | undefined): string | undefined {
  if (!preset) return undefined;
  return preset.logoUrl;
}

export function presetThinkingConfigJson(preset: ProviderPreset | undefined): string | undefined {
  if (!preset?.thinkingConfig) return undefined;
  return JSON.stringify(preset.thinkingConfig);
}

export function isPresetProtocol(value: string): value is AiProtocol {
  return value === 'openai_compatible' || value === 'anthropic';
}
