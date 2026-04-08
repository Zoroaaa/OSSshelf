/**
 * vendorConfig.ts
 * 主流AI厂商配置文档
 *
 * 整理了国内外主流AI厂商的API配置信息
 * 包括：思考模式、函数调用、流式输出、上下文长度等
 */

export interface ThinkingConfig {
  paramFormat: 'object' | 'boolean' | 'string';
  paramName: string;
  enabledValue?: unknown;
  disabledValue?: unknown;
  nestedKey?: string;
}

export interface ConfigFieldMeta {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'enum';
  editable: boolean;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
  minValue?: number;
  maxValue?: number;
  placeholder?: string;
  group: 'basic' | 'thinking' | 'advanced' | 'features';
}

export interface VendorConfig {
  name: string;
  nameEn: string;
  models: ModelConfig[];
  features: {
    thinking: boolean;
    functionCalling: boolean;
    streaming: boolean;
    vision: boolean;
  };
  apiFormat: 'openai_compatible' | 'native';
  specialParams: Record<string, ParamConfig>;
  thinkingConfig?: ThinkingConfig;
  configFields?: ConfigFieldMeta[];
}

export interface ModelConfig {
  id: string;
  name: string;
  contextLength: number;
  maxOutput: number;
  thinking: boolean;
  functionCalling: boolean;
  streaming: boolean;
  vision: boolean;
  specialParams?: Record<string, unknown>;
}

export interface ParamConfig {
  type: string;
  description: string;
  values?: string[];
  properties?: string[];
  default?: unknown;
}

export const COMMON_CONFIG_FIELDS: ConfigFieldMeta[] = [
  {
    key: 'name',
    label: '模型名称',
    description: '自定义模型显示名称',
    type: 'string',
    editable: true,
    required: true,
    placeholder: '输入模型名称',
    group: 'basic',
  },
  {
    key: 'modelId',
    label: '模型ID',
    description: 'API调用时使用的模型标识符',
    type: 'string',
    editable: true,
    required: true,
    placeholder: '如: gpt-4o, claude-3-5-sonnet',
    group: 'basic',
  },
  {
    key: 'apiEndpoint',
    label: 'API端点',
    description: '自定义API端点URL',
    type: 'string',
    editable: true,
    required: false,
    placeholder: 'https://api.openai.com/v1',
    group: 'basic',
  },
  {
    key: 'temperature',
    label: '温度参数',
    description: '控制输出随机性，值越大越随机',
    type: 'number',
    editable: true,
    required: false,
    defaultValue: 0.7,
    minValue: 0,
    maxValue: 2,
    group: 'basic',
  },
  {
    key: 'supportsThinking',
    label: '支持思考模式',
    description: '模型是否支持深度思考/推理模式',
    type: 'boolean',
    editable: true,
    required: false,
    defaultValue: false,
    group: 'features',
  },
  {
    key: 'thinkingParamFormat',
    label: '思考参数格式',
    description: '思考模式参数的格式类型',
    type: 'enum',
    editable: true,
    required: false,
    enumValues: ['object', 'boolean', 'string'],
    group: 'thinking',
  },
  {
    key: 'thinkingParamName',
    label: '思考参数名称',
    description: 'API请求中控制思考模式的参数名',
    type: 'string',
    editable: true,
    required: false,
    placeholder: '如: thinking, enable_thinking',
    group: 'thinking',
  },
  {
    key: 'thinkingEnabledValue',
    label: '启用思考值',
    description: '启用思考模式时的参数值',
    type: 'string',
    editable: true,
    required: false,
    placeholder: '如: enabled, true',
    group: 'thinking',
  },
  {
    key: 'thinkingDisabledValue',
    label: '禁用思考值',
    description: '禁用思考模式时的参数值',
    type: 'string',
    editable: true,
    required: false,
    placeholder: '如: disabled, false',
    group: 'thinking',
  },
  {
    key: 'thinkingNestedKey',
    label: '思考嵌套键',
    description: '当参数格式为object时，嵌套的键名',
    type: 'string',
    editable: true,
    required: false,
    placeholder: '如: type, enabled',
    group: 'thinking',
  },
  {
    key: 'disableThinkingForFeatures',
    label: '禁用思考的功能',
    description: '在这些AI功能中自动禁用思考模式',
    type: 'json',
    editable: true,
    required: false,
    defaultValue: ['image_caption', 'image_tag', 'image_analysis', 'file_summary'],
    group: 'thinking',
  },
  {
    key: 'systemPrompt',
    label: '系统提示词',
    description: '模型的系统提示词/人设',
    type: 'string',
    editable: true,
    required: false,
    placeholder: '你是一个有帮助的AI助手',
    group: 'advanced',
  },
  {
    key: 'isReadonly',
    label: '只读模式',
    description: '标记为只读的模型不可编辑配置',
    type: 'boolean',
    editable: false,
    required: false,
    defaultValue: false,
    group: 'advanced',
  },
];

export const VENDOR_CONFIGS: Record<string, VendorConfig> = {
  baidu: {
    name: '百度文心一言',
    nameEn: 'Baidu ERNIE',
    models: [
      {
        id: 'ernie-4.0-8k',
        name: 'ERNIE 4.0 8K',
        contextLength: 8192,
        maxOutput: 2048,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'ernie-4.0-turbo-8k',
        name: 'ERNIE 4.0 Turbo 8K',
        contextLength: 8192,
        maxOutput: 2048,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'ernie-x1',
        name: 'ERNIE X1 (深度思考)',
        contextLength: 32768,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'ernie-4.5-turbo',
        name: 'ERNIE 4.5 Turbo',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      temperature: {
        type: 'float',
        description: '控制输出随机性，范围(0, 1.0]',
        default: 0.8,
      },
      top_p: {
        type: 'float',
        description: '核采样比例，范围[0, 1.0]',
        default: 0.8,
      },
      penalty_score: {
        type: 'float',
        description: '重复惩罚系数，范围[1.0, 2.0]',
        default: 1.0,
      },
      max_output_tokens: {
        type: 'int',
        description: '最大输出token数，范围[2, 2048]',
        default: 2048,
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      system: {
        type: 'string',
        description: '模型人设设定',
      },
    },
    thinkingConfig: {
      paramFormat: 'boolean',
      paramName: 'enable_thinking',
      enabledValue: true,
      disabledValue: false,
    },
  },

  tencent: {
    name: '腾讯混元',
    nameEn: 'Tencent Hunyuan',
    models: [
      {
        id: 'hunyuan-lite',
        name: '混元 Lite',
        contextLength: 256000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'hunyuan-standard',
        name: '混元 Standard',
        contextLength: 256000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'hunyuan-t1-20250321',
        name: '混元 T1 (深度推理)',
        contextLength: 256000,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'hy-2.0-think',
        name: '混元 2.0 Think',
        contextLength: 256000,
        maxOutput: 128000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      top_p: {
        type: 'float',
        description: '核采样比例',
        default: 0.8,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  alibaba: {
    name: '阿里通义千问',
    nameEn: 'Alibaba Qwen',
    models: [
      {
        id: 'qwen-turbo',
        name: '通义千问 Turbo',
        contextLength: 8192,
        maxOutput: 1500,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'qwen-plus',
        name: '通义千问 Plus',
        contextLength: 32768,
        maxOutput: 2000,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'qwen-max',
        name: '通义千问 Max',
        contextLength: 8192,
        maxOutput: 2000,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'qwq-32b',
        name: 'QwQ 32B (推理模型)',
        contextLength: 32768,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
        specialParams: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
      {
        id: 'qwen3-235b-a22b',
        name: 'Qwen3 235B',
        contextLength: 256000,
        maxOutput: 32768,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          enable_thinking: true,
          thinking_budget: 16384,
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      incremental_output: {
        type: 'bool',
        description: '增量式流式输出',
        default: false,
      },
      enable_thinking: {
        type: 'bool',
        description: '是否启用思考模式',
        default: false,
      },
      thinking_budget: {
        type: 'int',
        description: '最大推理Token数',
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.85,
      },
      top_p: {
        type: 'float',
        description: '核采样比例',
        default: 0.8,
      },
    },
    thinkingConfig: {
      paramFormat: 'boolean',
      paramName: 'enable_thinking',
      enabledValue: true,
      disabledValue: false,
    },
  },

  volcengine: {
    name: '字节火山引擎',
    nameEn: 'Volcengine Doubao',
    models: [
      {
        id: 'doubao-1-5-pro-32k',
        name: '豆包 1.5 Pro 32K',
        contextLength: 32768,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'doubao-seed-1-6-251015',
        name: '豆包 Seed 1.6 (深度思考)',
        contextLength: 256000,
        maxOutput: 32768,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
          reasoning_effort: 'medium',
        },
      },
      {
        id: 'doubao-seed-2-0-pro-260215',
        name: '豆包 Seed 2.0 Pro',
        contextLength: 256000,
        maxOutput: 128000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      thinking: {
        type: 'object',
        description: '思考模式控制',
        values: ['enabled', 'disabled', 'auto'],
      },
      reasoning_effort: {
        type: 'string',
        description: '推理努力程度',
        values: ['minimal', 'low', 'medium', 'high'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  siliconflow: {
    name: '硅基流动',
    nameEn: 'SiliconFlow',
    models: [
      {
        id: 'Qwen/Qwen2.5-7B-Instruct',
        name: 'Qwen2.5 7B',
        contextLength: 32768,
        maxOutput: 2048,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1',
        contextLength: 64000,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
        specialParams: {
          enable_thinking: true,
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      enable_thinking: {
        type: 'bool',
        description: '是否启用思考模式',
        default: false,
      },
      thinking_budget: {
        type: 'int',
        description: '最大推理Token数',
      },
    },
  },

  zhipu: {
    name: '智谱AI',
    nameEn: 'Zhipu GLM',
    models: [
      {
        id: 'glm-4-flash',
        name: 'GLM-4 Flash',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        contextLength: 128000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
      {
        id: 'glm-4.6',
        name: 'GLM-4.6',
        contextLength: 128000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
      {
        id: 'glm-5',
        name: 'GLM-5',
        contextLength: 200000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      thinking: {
        type: 'object',
        description: '思考模式控制',
        values: ['enabled', 'disabled'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.95,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  minimax: {
    name: 'MiniMax',
    nameEn: 'MiniMax',
    models: [
      {
        id: 'MiniMax-Text-01',
        name: 'MiniMax Text 01',
        contextLength: 100192,
        maxOutput: 2048,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'MiniMax-M1',
        name: 'MiniMax M1 (推理模型)',
        contextLength: 100192,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'MiniMax-M2.5',
        name: 'MiniMax M2.5',
        contextLength: 200000,
        maxOutput: 192000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        contextLength: 204800,
        maxOutput: 131072,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.1,
      },
      top_p: {
        type: 'float',
        description: '核采样比例',
        default: 0.95,
      },
      max_tokens: {
        type: 'int',
        description: '最大生成token数',
        default: 2048,
      },
    },
  },

  moonshot: {
    name: '月之暗面',
    nameEn: 'Moonshot Kimi',
    models: [
      {
        id: 'moonshot-v1-8k',
        name: 'Moonshot V1 8K',
        contextLength: 8192,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'moonshot-v1-32k',
        name: 'Moonshot V1 32K',
        contextLength: 32768,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'kimi-k2-thinking',
        name: 'Kimi K2 Thinking',
        contextLength: 128000,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        contextLength: 128000,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      thinking: {
        type: 'object',
        description: '思考模式控制',
        values: ['enabled', 'disabled'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.3,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  openai: {
    name: 'OpenAI',
    nameEn: 'OpenAI',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview (推理模型)',
        contextLength: 128000,
        maxOutput: 32768,
        thinking: true,
        functionCalling: false,
        streaming: true,
        vision: false,
        specialParams: {
          reasoning_effort: 'medium',
        },
      },
      {
        id: 'o3-mini',
        name: 'o3 Mini',
        contextLength: 200000,
        maxOutput: 100000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
        specialParams: {
          reasoning_effort: 'medium',
        },
      },
      {
        id: 'gpt-5',
        name: 'GPT-5',
        contextLength: 256000,
        maxOutput: 32768,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          reasoning_effort: 'medium',
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      reasoning_effort: {
        type: 'string',
        description: '推理努力程度',
        values: ['low', 'medium', 'high'],
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 1.0,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
    },
    thinkingConfig: {
      paramFormat: 'string',
      paramName: 'reasoning_effort',
      enabledValue: 'medium',
      disabledValue: 'low',
    },
  },

  anthropic: {
    name: 'Anthropic Claude',
    nameEn: 'Claude',
    models: [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextLength: 200000,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextLength: 200000,
        maxOutput: 16000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled', budget_tokens: 10000 },
        },
      },
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1',
        contextLength: 200000,
        maxOutput: 32000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking: { type: 'enabled', budget_tokens: 16000 },
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'native',
    specialParams: {
      thinking: {
        type: 'object',
        description: '扩展思考配置',
        properties: ['type', 'budget_tokens'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 1.0,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  google: {
    name: 'Google Gemini',
    nameEn: 'Gemini',
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        contextLength: 1000000,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextLength: 2000000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking_level: 'high',
        },
      },
      {
        id: 'gemini-3',
        name: 'Gemini 3',
        contextLength: 2000000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
        specialParams: {
          thinking_level: 'high',
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'native',
    specialParams: {
      thinking_level: {
        type: 'string',
        description: '思考深度级别',
        values: ['minimal', 'low', 'medium', 'high'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 1.0,
      },
      max_output_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 8192,
      },
    },
    thinkingConfig: {
      paramFormat: 'string',
      paramName: 'thinking_level',
      enabledValue: 'high',
      disabledValue: 'low',
    },
  },

  openrouter: {
    name: 'OpenRouter',
    nameEn: 'OpenRouter',
    models: [
      {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4 (via OpenRouter)',
        contextLength: 200000,
        maxOutput: 16000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'anthropic/claude-opus-4',
        name: 'Claude Opus 4 (via OpenRouter)',
        contextLength: 200000,
        maxOutput: 32000,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o (via OpenRouter)',
        contextLength: 128000,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'openai/o1-preview',
        name: 'o1 Preview (via OpenRouter)',
        contextLength: 128000,
        maxOutput: 32768,
        thinking: true,
        functionCalling: false,
        streaming: true,
        vision: false,
      },
      {
        id: 'google/gemini-2.5-pro-preview',
        name: 'Gemini 2.5 Pro (via OpenRouter)',
        contextLength: 2000000,
        maxOutput: 65536,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: true,
      },
      {
        id: 'deepseek/deepseek-r1',
        name: 'DeepSeek R1 (via OpenRouter)',
        contextLength: 64000,
        maxOutput: 8192,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: true,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
    },
  },

  mistral: {
    name: 'Mistral AI',
    nameEn: 'Mistral',
    models: [
      {
        id: 'mistral-large-latest',
        name: 'Mistral Large',
        contextLength: 128000,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'mistral-medium-latest',
        name: 'Mistral Medium',
        contextLength: 32768,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'mistral-small-latest',
        name: 'Mistral Small',
        contextLength: 32768,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'codestral-latest',
        name: 'Codestral (代码专用)',
        contextLength: 32768,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'mistral-embed',
        name: 'Mistral Embed (嵌入模型)',
        contextLength: 8192,
        maxOutput: 8192,
        thinking: false,
        functionCalling: false,
        streaming: false,
        vision: false,
      },
    ],
    features: {
      thinking: false,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
      prompt_mode: {
        type: 'string',
        description: '提示模式',
        values: ['reasoning', 'none'],
      },
    },
  },

  xai: {
    name: 'xAI Grok',
    nameEn: 'xAI Grok',
    models: [
      {
        id: 'grok-4',
        name: 'Grok 4',
        contextLength: 131072,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'grok-4.1',
        name: 'Grok 4.1',
        contextLength: 131072,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'grok-4-thinking',
        name: 'Grok 4 Thinking (深度思考)',
        contextLength: 131072,
        maxOutput: 16384,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
      {
        id: 'grok-4.1-thinking',
        name: 'Grok 4.1 Thinking (深度思考)',
        contextLength: 131072,
        maxOutput: 16384,
        thinking: true,
        functionCalling: true,
        streaming: true,
        vision: false,
        specialParams: {
          thinking: { type: 'enabled' },
        },
      },
    ],
    features: {
      thinking: true,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      thinking: {
        type: 'object',
        description: '思考模式控制',
        values: ['enabled', 'disabled'],
      },
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 8192,
      },
    },
    thinkingConfig: {
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    },
  },

  groq: {
    name: 'Groq',
    nameEn: 'Groq',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        contextLength: 131072,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'llama-3.3-70b-specdec',
        name: 'Llama 3.3 70B SpecDec',
        contextLength: 8192,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        contextLength: 131072,
        maxOutput: 8192,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'mixtral-8x7b-32768',
        name: 'Mixtral 8x7B',
        contextLength: 32768,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'gemma2-9b-it',
        name: 'Gemma 2 9B IT',
        contextLength: 8192,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
    ],
    features: {
      thinking: false,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
    },
  },

  perplexity: {
    name: 'Perplexity',
    nameEn: 'Perplexity',
    models: [
      {
        id: 'llama-3.1-sonar-large-128k-online',
        name: 'Sonar Large Online (联网搜索)',
        contextLength: 127072,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'llama-3.1-sonar-small-128k-online',
        name: 'Sonar Small Online (联网搜索)',
        contextLength: 127072,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'llama-3.1-sonar-large-128k-chat',
        name: 'Sonar Large Chat',
        contextLength: 127072,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
      {
        id: 'llama-3.1-sonar-small-128k-chat',
        name: 'Sonar Small Chat',
        contextLength: 127072,
        maxOutput: 4096,
        thinking: false,
        functionCalling: true,
        streaming: true,
        vision: false,
      },
    ],
    features: {
      thinking: false,
      functionCalling: true,
      streaming: true,
      vision: false,
    },
    apiFormat: 'openai_compatible',
    specialParams: {
      stream: {
        type: 'bool',
        description: '是否流式输出',
        default: false,
      },
      temperature: {
        type: 'float',
        description: '控制输出随机性',
        default: 0.7,
      },
      max_tokens: {
        type: 'int',
        description: '最大输出token数',
        default: 4096,
      },
    },
  },
};

export function getVendorConfig(vendor: string): VendorConfig | undefined {
  return VENDOR_CONFIGS[vendor];
}

export function getAllVendors(): string[] {
  return Object.keys(VENDOR_CONFIGS);
}

export function getModelConfig(vendor: string, modelId: string): ModelConfig | undefined {
  const vendorConfig = VENDOR_CONFIGS[vendor];
  if (!vendorConfig) return undefined;

  return vendorConfig.models.find((m) => m.id === modelId || modelId.includes(m.id));
}
