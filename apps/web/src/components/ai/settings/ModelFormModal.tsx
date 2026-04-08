/**
 * ModelFormModal.tsx
 * 添加/编辑模型表单弹窗组件
 *
 * 功能:
 * - Workers AI / OpenAI兼容API 两种模式
 * - 基本配置（名称、提供商、模型ID）
 * - 高级设置（上下文长度、Token、温度、系统提示词）
 * - 模型特性（思考模式、函数调用、流式、视觉）
 * - 思考模式详细配置
 * - 能力标签选择
 */

import { useState, useEffect } from 'react';
import { X, Key, Loader2, Brain } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  aiApi,
  type AiModel,
  type AiProvider,
  type AiWorkersAiModel,
  type AiOpenAiModel,
  type AiProviderItem,
} from '@/services/api';

interface ModelFormModalProps {
  model: AiModel | null;
  providersData?: {
    providers: AiProvider[];
    workersAiModels: AiWorkersAiModel[];
    openAiModels: AiOpenAiModel[];
  };
  onClose: () => void;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}

export function ModelFormModal({ model, providersData, onClose, onSubmit, isLoading }: ModelFormModalProps) {
  const [allProviders, setAllProviders] = useState<AiProviderItem[]>([]);
  const [formData, setFormData] = useState({
    name: model?.name || '',
    provider: model?.provider || 'workers_ai',
    providerId: model?.providerId || (null as string | null),
    modelId: model?.modelId || '',
    customModelId: undefined as string | undefined,
    apiEndpoint: model?.apiEndpoint || '',
    apiKey: '',
    capabilities: model?.capabilities || ['chat'],
    temperature: model?.temperature || 0.7,
    systemPrompt: model?.systemPrompt || '',
    isActive: model?.isActive || false,
    supportsThinking: model?.supportsThinking || false,
    thinkingParamFormat: model?.thinkingParamFormat || '',
    thinkingParamName: model?.thinkingParamName || '',
    thinkingEnabledValue: model?.thinkingEnabledValue || '',
    thinkingDisabledValue: model?.thinkingDisabledValue || '',
    thinkingNestedKey: model?.thinkingNestedKey || '',
    disableThinkingForFeatures:
      model?.disableThinkingForFeatures || '["image_caption","image_tag","image_analysis","file_summary"]',
    isReadonly: model?.isReadonly || false,
    sortOrder: model?.sortOrder ?? 0,
  });

  useEffect(() => {
    loadAllProviders();
  }, []);

  const loadAllProviders = async () => {
    try {
      const res = await aiApi.config.getAiProviders();
      if (res.data.success && res.data.data) {
        setAllProviders(res.data.data);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const systemProviders = allProviders.filter((p) => p.isSystem);
  const customProviders = allProviders.filter((p) => !p.isSystem);

  const handleProviderChange = (providerValue: string) => {
    if (providerValue.startsWith('provider_')) {
      const providerId = providerValue.replace('provider_', '');
      const selectedProvider = allProviders.find((p) => p.id === providerId);

      let thinkingConfig: {
        supportsThinking?: boolean;
        thinkingParamFormat?: string;
        thinkingParamName?: string;
        thinkingEnabledValue?: string;
        thinkingDisabledValue?: string;
        thinkingNestedKey?: string;
      } = {};

      if (selectedProvider?.thinkingConfig) {
        try {
          const config = JSON.parse(selectedProvider.thinkingConfig);
          thinkingConfig = {
            supportsThinking: true,
            thinkingParamFormat: config.paramFormat || '',
            thinkingParamName: config.paramName || '',
            thinkingEnabledValue: config.enabledValue?.toString() || '',
            thinkingDisabledValue: config.disabledValue?.toString() || '',
            thinkingNestedKey: config.nestedKey || '',
          };
        } catch (e) {
          console.error('Failed to parse thinking config:', e);
        }
      }

      setFormData({
        ...formData,
        provider: 'openai_compatible',
        providerId: providerId,
        apiEndpoint: selectedProvider?.apiEndpoint || '',
        ...thinkingConfig,
      });
    } else if (providerValue === 'workers_ai') {
      setFormData({
        ...formData,
        provider: 'workers_ai',
        providerId: null,
        apiEndpoint: '',
      });
    } else {
      setFormData({
        ...formData,
        provider: 'openai_compatible',
        providerId: null,
        apiEndpoint: '',
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData = { ...formData };
    if (formData.modelId === '__custom__' && formData.customModelId) {
      submitData.modelId = formData.customModelId;
      submitData.name = formData.customModelId.split('/').pop() || formData.name;
    }
    submitData.providerId = formData.providerId || null;
    onSubmit(submitData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b sticky top-0 bg-card z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">{model ? '编辑模型' : '添加新模型'}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          <div className="space-y-3">
            <h3 className="font-medium text-sm sm:text-base">基本信息</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">模型名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  placeholder="例如：我的 GPT-4"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">提供商 *</label>
                <select
                  value={formData.providerId ? `provider_${formData.providerId}` : formData.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                >
                  <option value="workers_ai">Cloudflare Workers AI</option>
                  {systemProviders.length > 0 && (
                    <optgroup label="系统内置提供商 (OpenAI 兼容)">
                      {systemProviders.map((p) => (
                        <option key={p.id} value={`provider_${p.id}`}>
                          {p.name} {p.isDefault ? '(默认)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {customProviders.length > 0 && (
                    <optgroup label="自定义提供商 (OpenAI 兼容)">
                      {customProviders.map((p) => (
                        <option key={p.id} value={`provider_${p.id}`}>
                          {p.name} {p.isDefault ? '(默认)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="openai_compatible">其他 (OpenAI 兼容 API)</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">选择提供商将自动填入对应的API端点和思考模式配置</p>
              </div>
            </div>

            {formData.provider === 'workers_ai' && providersData?.workersAiModels ? (
              <div>
                <label className="block text-sm font-medium mb-1">选择模型 *</label>
                <select
                  value={formData.modelId || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const selectedModel = providersData.workersAiModels.find((m) => m.id === val);
                    setFormData({
                      ...formData,
                      modelId: val,
                      name: formData.name || selectedModel?.name || formData.name,
                      customModelId: val === '__custom__' ? '' : undefined,
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  required
                >
                  <option value="">请选择一个 Workers AI 模型</option>
                  {providersData.workersAiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id !== '__custom__' ? `(${m.id})` : ''}
                    </option>
                  ))}
                </select>

                {formData.modelId === '__custom__' && (
                  <div className="mt-2">
                    <label className="block text-sm font-medium mb-1">自定义模型 ID（@cf/ 开头）</label>
                    <input
                      type="text"
                      value={formData.customModelId || ''}
                      onChange={(e) => setFormData({ ...formData, customModelId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                      placeholder="@cf/deepseek/deepseek-r1 或 @cf/black-forest-labs/flux-2-klein-4b"
                      required
                    />
                    <p className="mt-1 text-xs">
                      可在{' '}
                      <a
                        href="https://developers.cloudflare.com/workers-ai/models/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Workers AI 模型目录
                      </a>{' '}
                      查看所有可用模型。免费额度：Workers Paid 计划每日约 10,000 neurons 免费，超出按 $0.0001/neuron
                      计费。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">模型 ID *</label>
                  <input
                    type="text"
                    value={formData.modelId}
                    onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                    placeholder="例如：gpt-4o、claude-3-opus-20240229"
                    required
                  />
                  {providersData?.openAiModels && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {providersData.openAiModels.slice(0, 8).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              modelId: m.id,
                              capabilities: m.capabilities.length > 0 ? [...m.capabilities] : ['chat'],
                            })
                          }
                          className={`px-2 py-1 text-xs border rounded transition-colors ${
                            formData.modelId === m.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                          }`}
                          title={m.description}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">API 端点 *</label>
                  <input
                    type="url"
                    value={formData.apiEndpoint}
                    onChange={(e) => setFormData({ ...formData, apiEndpoint: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                    placeholder="https://api.openai.com/v1"
                    required={formData.provider === 'openai_compatible'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    <Key className="h-3 w-3 inline mr-1" />
                    API Key
                  </label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                    placeholder={model?.hasApiKey ? '保持原密钥不变，留空则不修改' : '输入 API Key'}
                  />
                  {model?.hasApiKey && !formData.apiKey && (
                    <p className="text-xs text-muted-foreground mt-1">当前已配置密钥，留空则保持不变</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t">
            <h3 className="font-medium text-sm sm:text-base">高级设置</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">温度 (0-2)</label>
                <input
                  type="number"
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.7 })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  min={0}
                  max={2}
                  step={0.1}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">排序值</label>
                <input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  min={0}
                  step={1}
                />
                <p className="mt-1 text-xs text-muted-foreground">数值越小越靠前</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">系统提示词</label>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                rows={3}
                placeholder="自定义系统提示词..."
              />
            </div>

            <div className="space-y-3 pt-4 border-t">
              <h3 className="font-medium text-sm sm:text-base">模型特性</h3>

              <div className="grid grid-cols-2 gap-3">
                {[{ key: 'supportsThinking', label: '思考模式', desc: '支持深度推理' }].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData[item.key as keyof typeof formData] as boolean}
                      onChange={(e) => setFormData({ ...formData, [item.key]: e.target.checked })}
                      className="rounded"
                    />
                    <div>
                      <span className="text-sm font-medium">{item.label}</span>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">💡 视觉能力和函数调用能力请在下方「模型能力」中选择</p>
            </div>

            {formData.supportsThinking && (
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-medium text-sm sm:text-base flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  思考模式配置
                </h3>

                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-2">💡 什么是思考模式？</p>
                  <p className="text-amber-700 dark:text-amber-300">
                    思考模式（也称推理模式、深度思考）让模型在回答前先进行内部推理，适合复杂问题。
                    不同平台的API参数格式不同，请根据您的模型提供商选择正确的格式。
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">参数格式 *</label>
                  <select
                    value={formData.thinkingParamFormat}
                    onChange={(e) => setFormData({ ...formData, thinkingParamFormat: e.target.value as any })}
                    className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                  >
                    <option value="">请选择参数格式</option>
                    <option value="object">Object (嵌套对象)</option>
                    <option value="boolean">Boolean (布尔值)</option>
                    <option value="string">String (字符串)</option>
                  </select>
                </div>

                {formData.thinkingParamFormat && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border rounded-lg text-xs space-y-2">
                    <p className="font-medium">格式说明：</p>
                    {formData.thinkingParamFormat === 'object' && (
                      <div className="space-y-2">
                        <p>参数值为嵌套对象，需要在请求体中添加类似以下的参数：</p>
                        <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded text-xs overflow-x-auto">
                          {`{
  "model": "your-model",
  "messages": [...],
  "thinking": {
    "type": "enabled"  // 或 "disabled"
  }
}`}
                        </pre>
                        <p className="text-muted-foreground">适用于：火山引擎豆包、智谱GLM、DeepSeek R1 等</p>
                      </div>
                    )}
                    {formData.thinkingParamFormat === 'boolean' && (
                      <div className="space-y-2">
                        <p>参数值为布尔值 true/false：</p>
                        <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded text-xs overflow-x-auto">
                          {`{
  "model": "your-model",
  "messages": [...],
  "enable_thinking": true  // 或 false
}`}
                        </pre>
                        <p className="text-muted-foreground">适用于：阿里通义千问、SiliconFlow 等</p>
                      </div>
                    )}
                    {formData.thinkingParamFormat === 'string' && (
                      <div className="space-y-2">
                        <p>参数值为字符串：</p>
                        <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded text-xs overflow-x-auto">
                          {`{
  "model": "your-model",
  "messages": [...],
  "reasoning_effort": "medium"  // "low" / "medium" / "high"
}`}
                        </pre>
                        <p className="text-muted-foreground">适用于：OpenAI o1/o3 系列模型</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">参数名称 *</label>
                    <input
                      type="text"
                      value={formData.thinkingParamName}
                      onChange={(e) => setFormData({ ...formData, thinkingParamName: e.target.value })}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder="如: thinking, enable_thinking"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      发送到API的参数名，如 <code className="text-primary">thinking</code> 或{' '}
                      <code className="text-primary">enable_thinking</code>
                    </p>
                  </div>

                  {formData.thinkingParamFormat === 'object' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">嵌套键名 *</label>
                      <input
                        type="text"
                        value={formData.thinkingNestedKey}
                        onChange={(e) => setFormData({ ...formData, thinkingNestedKey: e.target.value })}
                        className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                        placeholder="如: type, enabled"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        对象内的键名，如 <code className="text-primary">type</code>
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">启用思考值 *</label>
                    <input
                      type="text"
                      value={formData.thinkingEnabledValue}
                      onChange={(e) => setFormData({ ...formData, thinkingEnabledValue: e.target.value })}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder={
                        formData.thinkingParamFormat === 'boolean'
                          ? 'true'
                          : formData.thinkingParamFormat === 'string'
                            ? 'medium'
                            : 'enabled'
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">启用思考时传递的值</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">禁用思考值 *</label>
                    <input
                      type="text"
                      value={formData.thinkingDisabledValue}
                      onChange={(e) => setFormData({ ...formData, thinkingDisabledValue: e.target.value })}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder={
                        formData.thinkingParamFormat === 'boolean'
                          ? 'false'
                          : formData.thinkingParamFormat === 'string'
                            ? 'low'
                            : 'disabled'
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">禁用思考时传递的值</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">禁用思考的功能</label>
                  <input
                    type="text"
                    value={formData.disableThinkingForFeatures}
                    onChange={(e) => setFormData({ ...formData, disableThinkingForFeatures: e.target.value })}
                    className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                    placeholder='["image_caption","image_tag","image_analysis","file_summary"]'
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    JSON数组格式，这些功能会自动禁用思考模式（如图片标签、文件摘要等）
                  </p>
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                  <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">📋 各平台配置示例：</p>
                  <div className="space-y-3 text-blue-700 dark:text-blue-300 max-h-64 overflow-y-auto">
                    <div>
                      <p className="font-medium">火山引擎豆包 / 字节跳动：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">阿里通义千问 / Qwen：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Boolean</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                            enable_thinking
                          </code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">true</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">false</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">百度文心一言：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Boolean</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                            enable_thinking
                          </code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">true</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">false</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">腾讯混元：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">智谱GLM / ChatGLM：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">DeepSeek R1：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">月之暗面 Kimi：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">xAI Grok：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Object</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">thinking</code>
                        </li>
                        <li>
                          嵌套键名:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">type</code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">enabled</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">disabled</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">OpenAI o1/o3 系列：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: String</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                            reasoning_effort
                          </code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">medium</code> 或{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">high</code>
                        </li>
                        <li>
                          禁用值: <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">low</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">Google Gemini：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: String</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                            thinking_level
                          </code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">high</code>
                        </li>
                        <li>
                          禁用值: <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">low</code>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">SiliconFlow：</p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>参数格式: Boolean</li>
                        <li>
                          参数名称:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                            enable_thinking
                          </code>
                        </li>
                        <li>
                          启用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">true</code>
                        </li>
                        <li>
                          禁用值:{' '}
                          <code className="text-primary bg-blue-100 dark:bg-blue-900/50 px-1 rounded">false</code>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                模型能力 *<span className="text-xs text-muted-foreground ml-1">（决定该模型可用于哪些功能）</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'chat', label: '💬 对话', desc: '文本对话、摘要生成' },
                  { value: 'vision', label: '👁️ 视觉', desc: '图片理解（如 GPT-4o）' },
                  { value: 'embedding', label: '📊 向量', desc: '文本向量化' },
                  { value: 'function_calling', label: '⚡ 函数调用', desc: '工具调用能力' },
                  { value: 'completion', label: '✏️ 补全', desc: '文本补全' },
                ].map((cap) => (
                  <label
                    key={cap.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                      formData.capabilities.includes(cap.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.capabilities.includes(cap.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, capabilities: [...formData.capabilities, cap.value] });
                        } else {
                          setFormData({
                            ...formData,
                            capabilities: formData.capabilities.filter((c) => c !== cap.value),
                          });
                        }
                      }}
                      className="rounded"
                    />
                    <span>{cap.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                💡 图片描述功能需要选择「视觉」能力的模型（如 GPT-4o、Claude 3）
              </p>
            </div>

            {!model && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">设为当前激活模型</span>
              </label>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              取消
            </Button>
            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {model ? '保存修改' : '添加模型'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
