/**
 * ProviderManageModal.tsx
 * 提供商管理弹窗组件
 *
 * 功能:
 * - 显示所有自定义提供商列表
 * - 添加/编辑/删除提供商
 * - 设置默认提供商
 */

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Edit2,
  Trash2,
  Star,
  Loader2,
  Link,
  FileText,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi, type AiProviderItem, type CreateAiProviderParams } from '@/services/api';

interface ProviderManageModalProps {
  onClose: () => void;
  onProviderChange?: () => void;
}

export function ProviderManageModal({ onClose, onProviderChange }: ProviderManageModalProps) {
  const [providers, setProviders] = useState<AiProviderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<AiProviderItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<CreateAiProviderParams>({
    name: '',
    apiEndpoint: '',
    description: '',
    thinkingConfig: '',
    isDefault: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      const res = await aiApi.config.getAiProviders();
      if (res.data.success && res.data.data) {
        setProviders(res.data.data);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      setIsSubmitting(true);
      if (editingProvider) {
        await aiApi.config.updateAiProvider(editingProvider.id, formData);
      } else {
        await aiApi.config.createAiProvider(formData);
      }
      await loadProviders();
      onProviderChange?.();
      setShowForm(false);
      setEditingProvider(null);
      setFormData({
        name: '',
        apiEndpoint: '',
        description: '',
        thinkingConfig: '',
        isDefault: false,
      });
    } catch (error) {
      console.error('Failed to save provider:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (provider: AiProviderItem) => {
    setEditingProvider(provider);
    setFormData({
      name: provider.name,
      apiEndpoint: provider.apiEndpoint || '',
      description: provider.description || '',
      thinkingConfig: provider.thinkingConfig || '',
      isDefault: provider.isDefault,
    });
    setShowForm(true);
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm('确定要删除此提供商吗？关联的模型将变为自定义类型。')) return;

    try {
      setDeletingId(providerId);
      await aiApi.config.deleteAiProvider(providerId);
      await loadProviders();
      onProviderChange?.();
    } catch (error) {
      console.error('Failed to delete provider:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await aiApi.config.setDefaultProvider(providerId);
      await loadProviders();
      onProviderChange?.();
    } catch (error) {
      console.error('Failed to set default provider:', error);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingProvider(null);
    setFormData({
      name: '',
      apiEndpoint: '',
      description: '',
      thinkingConfig: '',
      isDefault: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b sticky top-0 bg-card z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">管理提供商</h2>
              <p className="text-xs text-muted-foreground mt-1">添加和管理您的AI服务提供商（使用OpenAI兼容API）</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : showForm ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                <p className="text-blue-700 dark:text-blue-300">
                  <strong>提示：</strong>
                  提供商使用OpenAI兼容API格式。添加后，创建模型时可以直接选择此提供商，自动填入API端点。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  提供商名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                  placeholder="如: 火山引擎、智谱AI、DeepSeek"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">API 端点</label>
                <input
                  type="text"
                  value={formData.apiEndpoint}
                  onChange={(e) => setFormData({ ...formData, apiEndpoint: e.target.value })}
                  className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                  placeholder="如: https://api.deepseek.com/v1"
                />
                <p className="text-xs text-muted-foreground mt-1">API的基础URL地址，不包含 /chat/completions 等路径</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                  rows={2}
                  placeholder="可选的描述信息"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">思考模式配置</label>
                <textarea
                  value={formData.thinkingConfig}
                  onChange={(e) => setFormData({ ...formData, thinkingConfig: e.target.value })}
                  className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                  rows={3}
                  placeholder='{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}'
                />
                <p className="text-xs text-muted-foreground mt-1">
                  JSON格式的思考模式配置，包含参数格式、参数名称等。可选字段。
                </p>

                <ThinkingFormatExamples onSelect={(config) => setFormData({ ...formData, thinkingConfig: config })} />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="isDefault" className="text-sm">
                  设为默认提供商
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting || !formData.name.trim()}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : editingProvider ? (
                    '更新'
                  ) : (
                    '创建'
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-muted-foreground">共 {providers.length} 个提供商</span>
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加提供商
                </Button>
              </div>

              {providers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">暂无提供商</p>
                  <p className="text-xs mt-1">点击上方按钮添加您的AI服务提供商</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {providers.map((provider) => (
                    <div
                      key={provider.id}
                      className={`p-3 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                        provider.isSystem
                          ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{provider.name}</span>
                            {provider.isDefault && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded">
                                默认
                              </span>
                            )}
                            {provider.isSystem && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                系统
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {provider.apiEndpoint && (
                              <span className="flex items-center gap-1 truncate max-w-[300px]">
                                <Link className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate font-mono">{provider.apiEndpoint}</span>
                              </span>
                            )}
                          </div>
                          {provider.description && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {provider.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {!provider.isSystem && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSetDefault(provider.id)}
                                title="设为默认"
                              >
                                <Star className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleEdit(provider)}
                                title="编辑"
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-600"
                                onClick={() => handleDelete(provider.id)}
                                disabled={deletingId === provider.id}
                                title="删除"
                              >
                                {deletingId === provider.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-muted-foreground">
                <p className="font-medium mb-1">使用说明：</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>蓝色背景为系统内置提供商，不可编辑或删除</li>
                  <li>添加提供商后，创建模型时可以直接选择，自动填入API端点</li>
                  <li>所有提供商都使用OpenAI兼容API格式</li>
                  <li>删除提供商不会删除关联的模型，模型将变为自定义类型</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ThinkingFormatExamplesProps {
  onSelect: (config: string) => void;
}

const THINKING_FORMATS = [
  {
    id: 'object',
    name: '嵌套对象格式 (object)',
    description: '参数值为嵌套对象，需要在请求体中添加 thinking 参数',
    providers: ['火山引擎豆包', '智谱GLM', 'DeepSeek R1', '月之暗面Kimi', 'xAI Grok'],
    config:
      '{"paramFormat":"object","paramName":"thinking","nestedKey":"type","enabledValue":"enabled","disabledValue":"disabled"}',
    example: `{
  "model": "your-model",
  "messages": [...],
  "thinking": {
    "type": "enabled"
  }
}`,
  },
  {
    id: 'boolean',
    name: '布尔值格式 (boolean)',
    description: '参数值为布尔值 true/false',
    providers: ['阿里通义千问', 'SiliconFlow 硅基流动', '百度文心一言'],
    config: '{"paramFormat":"boolean","paramName":"enable_thinking","enabledValue":true,"disabledValue":false}',
    example: `{
  "model": "your-model",
  "messages": [...],
  "enable_thinking": true
}`,
  },
  {
    id: 'string',
    name: '字符串格式 (string)',
    description: '参数值为字符串，表示推理强度级别',
    providers: ['OpenAI o1/o3 系列'],
    config: '{"paramFormat":"string","paramName":"reasoning_effort","enabledValue":"medium","disabledValue":"low"}',
    example: `{
  "model": "your-model",
  "messages": [...],
  "reasoning_effort": "medium"
}`,
  },
];

function ThinkingFormatExamples({ onSelect }: ThinkingFormatExamplesProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <div className="mt-2 border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          查看三种思考模式格式示例
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="p-3 space-y-4 bg-slate-50/50 dark:bg-slate-900/30">
          {THINKING_FORMATS.map((format) => (
            <div key={format.id} className="border rounded-lg p-3 bg-background">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{format.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{format.description}</p>
                </div>
              </div>

              <div className="mb-2 flex flex-wrap gap-1">
                {format.providers.map((provider) => (
                  <span
                    key={provider}
                    className="px-1.5 py-0.5 text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-800"
                  >
                    {provider}
                  </span>
                ))}
              </div>

              <div className="space-y-2">
                <div className="relative group">
                  <div className="text-[10px] font-medium text-muted-foreground mb-1">请求示例：</div>
                  <pre className="p-2 bg-slate-900 text-slate-100 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {format.example}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(format.example, `${format.id}-example`)}
                    className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-slate-700 hover:bg-slate-600"
                    title="复制示例"
                  >
                    {copiedId === `${format.id}-example` ? (
                      <Check className="h-3.5 w-3.5 text-green-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-slate-300" />
                    )}
                  </button>
                </div>

                <div className="relative group">
                  <div className="text-[10px] font-medium text-muted-foreground mb-1">配置 JSON（点击使用）：</div>
                  <pre
                    className="p-2 bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all cursor-pointer hover:bg-emerald-950/50 transition-colors border border-emerald-200 dark:border-emerald-800"
                    onClick={() => onSelect(format.config)}
                    title="点击填入配置"
                  >
                    {format.config}
                  </pre>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(format.config, `${format.id}-config`);
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-emerald-800 hover:bg-emerald-700"
                    title="复制配置"
                  >
                    {copiedId === `${format.id}-config` ? (
                      <Check className="h-3.5 w-3.5 text-green-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-emerald-300" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelect(format.config)}
                className="mt-2 w-full py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded border border-emerald-200 dark:border-emerald-800 transition-colors"
              >
                使用此格式
              </button>
            </div>
          ))}

          <p className="text-xs text-muted-foreground pt-2 border-t">
            💡 提示：如果您的提供商不在上述列表中，请根据其 API
            文档自行填写配置。不在三种标准格式内的，可以留空或自定义。
          </p>
        </div>
      )}
    </div>
  );
}

export default ProviderManageModal;
