/**
 * workersAiModels.ts
 * Workers AI 内置兜底模型清单
 *
 * 线上目录优先由 workersAiCatalog 拉取；未配置凭据或同步失败时使用本清单。
 * 仅承载静态数据，不含调用逻辑。
 */

export interface WorkersAiFallbackModel {
  id: string;
  name: string;
  capabilities: string[];
  description: string;
}

export const WORKERS_AI_FALLBACK_MODELS: WorkersAiFallbackModel[] = [
  {
    id: '__custom__',
    name: '自定义模型 (输入任意 @cf/ 模型 ID)',
    capabilities: ['chat', 'vision'],
    description:
      '手动输入任意 Cloudflare Workers AI 模型 ID，如 @cf/deepseek/deepseek-r1、@cf/black-forest-labs/flux-2-klein-4b 等。支持所有 Workers AI 目录中的模型。',
  },

  // ========== 旗舰/高参数大模型 ==========
  {
    id: '@cf/moonshotai/kimi-k2.5',
    name: 'Kimi K2.5 🌟',
    capabilities: ['chat', 'vision', 'function_calling'],
    description:
      'Moonshot AI前沿开源模型，256K超长上下文，支持多轮工具调用、视觉输入和结构化输出，Agent场景首选（推荐）',
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (OpenAI) 🌟',
    capabilities: ['chat', 'function_calling'],
    description: 'OpenAI开源权重模型，专为推理和Agent任务设计，生产级通用高推理场景首选',
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B MoE (Meta) 🌟',
    capabilities: ['chat', 'vision', 'function_calling'],
    description: 'Meta最新Llama 4原生多模态MoE架构(16专家)，文本+图像理解业界领先',
  },
  {
    id: '@cf/nvidia/nemotron-3-120b-a12b',
    name: 'Nemotron 3 Super 120B (NVIDIA) 🌟',
    capabilities: ['chat', 'function_calling'],
    description: 'NVIDIA混合MoE架构(120B总参/12B激活)，面向多Agent系统和专业Agent AI优化',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B Instruct FP8 (Meta)',
    capabilities: ['chat', 'function_calling'],
    description: 'Meta Llama 3.3 70B参数FP8量化加速版，复杂推理任务首选，支持函数调用',
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B MoE (Google) 🌟',
    capabilities: ['chat', 'vision', 'function_calling'],
    description: 'Google最智能开源模型家族，基于Gemini 3研究构建，256K上下文，内置思考模式+视觉+函数调用',
  },
  {
    id: '@cf/zai-org/glm-4.7-flash',
    name: 'GLM-4.7 Flash (智谱AI) 🌟',
    capabilities: ['chat', 'function_calling'],
    description: '智谱AI高效多语言模型，131K上下文，100+语言支持，多轮工具调用优化',
  },
  {
    id: '@cf/qwen/qwen3-30b-a3b-fp8',
    name: 'Qwen3 30B MoE (通义千问)',
    capabilities: ['chat', 'function_calling'],
    description: '阿里Qwen3最新一代MoE模型(30B总参/3B激活)，推理+指令遵循+Agent能力全面突破',
  },
  {
    id: '@cf/mistral/mistral-small-3.1-24b-instruct',
    name: 'Mistral Small 3.1 24B (Mistral AI)',
    capabilities: ['chat', 'vision', 'function_calling'],
    description: 'Mistral AI顶级文本+视觉双优模型，128K长上下文，速度与智能的最佳平衡',
  },

  // ========== 推理/思考模式模型 ==========
  {
    id: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill Qwen 32B',
    capabilities: ['chat'],
    description: 'DeepSeek R1蒸馏推理模型，数学/代码/逻辑推理能力强，超越o1-mini（推荐）',
  },
  {
    id: '@cf/qwq-32b',
    name: 'QwQ 32B (通义千问推理)',
    capabilities: ['chat'],
    description: 'Qwen系列专用推理模型，深度思考能力媲美DeepSeek-R1和OpenAI o1-mini',
  },

  // ========== 中等参数模型 ==========
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct (Meta)',
    capabilities: ['chat'],
    description: 'Meta经典8B指令微调模型，多语言对话通用性强，速度快成本低',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fast',
    name: 'Llama 3.1 8B Fast (Meta)',
    capabilities: ['chat'],
    description: 'Llama 3.1 8B极速版，60K上下文，延迟敏感场景首选',
  },
  {
    id: '@cf/google/gemma-3-12b-it',
    name: 'Gemma 3 12B (Google)',
    capabilities: ['chat', 'vision'],
    description: 'Google多模态模型，128K上下文，140+语言支持，文本生成与图像理解全能',
  },
  {
    id: '@cf/meta/llama-3.2-3b-instruct',
    name: 'Llama 3.2 3B Instruct (Meta)',
    capabilities: ['chat'],
    description: '轻量级3B模型，适合边缘部署和高吞吐量场景',
  },
  {
    id: '@cf/ibm/granite-4.0-h-micro',
    name: 'Granite 4.0 Micro (IBM)',
    capabilities: ['chat', 'function_calling'],
    description: 'IBM指令遵循和函数调用领先模型，适合RAG和多Agent工作流',
  },

  // ========== 多模态视觉模型 ==========
  {
    id: '@cf/meta/llama-3.2-11b-vision-instruct',
    name: 'Llama 3.2 11B Vision (Meta)',
    capabilities: ['vision'],
    description: 'Meta原生视觉指令模型，图像识别、图像推理、图注生成全能',
  },
  {
    id: '@cf/llava-hf/llava-1.5-7b-hf',
    name: 'LLaVA 1.5 7B Vision',
    capabilities: ['vision'],
    description: '经典多模态视觉语言模型，图片内容理解与描述生成',
  },

  // ========== 嵌入/向量化模型 ==========
  {
    id: '@cf/baai/bge-m3',
    name: 'BGE-M3 Embedding',
    capabilities: ['embedding'],
    description: '多语言多粒度嵌入模型(1024维)，语义搜索核心推荐',
  },
  {
    id: '@cf/baai/bge-large-en-v1.5',
    name: 'BGE-Large EN Embedding',
    capabilities: ['embedding'],
    description: '英文专用大规模嵌入模型(1024维)，英文语义搜索优化',
  },
  {
    id: '@cf/qwen/qwen3-embedding-0.6b',
    name: 'Qwen3 Embedding 0.6B',
    capabilities: ['embedding'],
    description: '通义千问最新嵌入模型(1024维)，中英双语优化，支持4096 tokens',
  },
  {
    id: '@cf/google/embeddinggemma-300m',
    name: 'EmbeddingGemma 300M (Google)',
    capabilities: ['embedding'],
    description: 'Google轻量级嵌入模型(768维)，100+语言支持，搜索检索优化',
  },
];
