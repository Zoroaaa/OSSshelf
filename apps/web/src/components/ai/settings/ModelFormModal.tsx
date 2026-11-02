/**
 * ModelFormModal.tsx
 * 添加/编辑模型
 *
 * 外部模型只选供应商 + 模型；Endpoint / API Key 在供应商连接里维护。
 */

import { useEffect, useMemo, useState } from 'react';
import { Brain, Key, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  aiApi,
  type AiDiscoveredModel,
  type AiModel,
  type AiProviderConnection,
  type AiWorkersAiCatalogModel,
  type CreateAiModelParams,
} from '@/services/api';

interface ModelFormModalProps {
  model: AiModel | null;
  connections: AiProviderConnection[];
  workersAiModels: AiWorkersAiCatalogModel[];
  onClose: () => void;
  onSubmit: (data: CreateAiModelParams) => void;
  isLoading: boolean;
}

const CAPABILITIES: Array<{ value: string; label: string; desc: string }> = [
  { value: 'chat', label: '对话', desc: '文本对话、摘要生成' },
  { value: 'vision', label: '视觉', desc: '图片理解' },
  { value: 'function_calling', label: '函数调用', desc: '工具调用' },
  { value: 'completion', label: '补全', desc: '文本补全' },
  { value: 'embedding', label: '向量', desc: '文本向量化' },
];

function formatContext(value?: number): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export function ModelFormModal({
  model,
  connections,
  workersAiModels,
  onClose,
  onSubmit,
  isLoading,
}: ModelFormModalProps) {
  const editing = !!model;
  const defaultConnection =
    connections.find((connection) => connection.isDefault) ?? connections.find((c) => c.isActive);
  const initialWorkers = model ? model.provider === 'workers_ai' || !model.providerId : !defaultConnection;

  const [providerId, setProviderId] = useState<string | null>(
    initialWorkers ? null : (model?.providerId ?? defaultConnection?.id ?? null)
  );
  const [modelId, setModelId] = useState(model?.modelId ?? '');
  const [manualModelId, setManualModelId] = useState('');
  const [name, setName] = useState(model?.name ?? '');
  const [capabilities, setCapabilities] = useState<string[]>(model?.capabilities ?? ['chat']);
  const [temperature, setTemperature] = useState(model?.temperature ?? 0.7);
  const [systemPrompt, setSystemPrompt] = useState(model?.systemPrompt ?? '');
  const [supportsThinking, setSupportsThinking] = useState(model?.supportsThinking ?? false);
  const [thinkingParamFormat, setThinkingParamFormat] = useState(model?.thinkingParamFormat ?? '');
  const [thinkingParamName, setThinkingParamName] = useState(model?.thinkingParamName ?? '');
  const [thinkingNestedKey, setThinkingNestedKey] = useState(model?.thinkingNestedKey ?? '');
  const [thinkingEnabledValue, setThinkingEnabledValue] = useState(model?.thinkingEnabledValue ?? '');
  const [thinkingDisabledValue, setThinkingDisabledValue] = useState(model?.thinkingDisabledValue ?? '');
  const [sortOrder, setSortOrder] = useState(model?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(model?.isActive ?? false);

  const [contextWindow, setContextWindow] = useState<number | undefined>(model?.contextWindow);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | undefined>(model?.maxOutputTokens);
  const [inputModalities, setInputModalities] = useState<string[]>(model?.inputModalities ?? ['text']);

  const [availableModels, setAvailableModels] = useState<AiDiscoveredModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isWorkersAi = !providerId;

  useEffect(() => {
    if (!providerId) {
      setAvailableModels([]);
      return;
    }

    let cancelled = false;
    setIsLoadingModels(true);
    aiApi.config
      .getProviderModels(providerId)
      .then((res) => {
        if (!cancelled) setAvailableModels(res.data.data?.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setAvailableModels([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const selectedMetadata = useMemo(
    () => availableModels.find((item) => item.id === modelId),
    [availableModels, modelId]
  );

  const handleModelIdChange = (value: string) => {
    setModelId(value);
    const metadata = availableModels.find((item) => item.id === value);
    if (!metadata) return;

    if (!name || name === modelId) setName(metadata.name);
    setCapabilities(metadata.capabilities);
    setContextWindow(metadata.contextWindow);
    setMaxOutputTokens(metadata.maxOutputTokens);
    setInputModalities(metadata.inputModalities);
    setSupportsThinking(metadata.supportsThinking);
  };

  const toggleCapability = (capability: string) => {
    setCapabilities((prev) =>
      prev.includes(capability) ? prev.filter((item) => item !== capability) : [...prev, capability]
    );
  };

  const effectiveModelId = isWorkersAi && modelId === '__manual__' ? manualModelId.trim() : modelId.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!effectiveModelId) return;
    const payload: CreateAiModelParams = {
      name: name.trim() || undefined,
      provider: isWorkersAi ? 'workers_ai' : undefined,
      providerId: isWorkersAi ? null : providerId,
      modelId: effectiveModelId,
      capabilities,
      temperature,
      systemPrompt: systemPrompt.trim() || undefined,
      isActive: editing ? undefined : isActive,
      supportsThinking,
      thinkingParamFormat: thinkingParamFormat as CreateAiModelParams['thinkingParamFormat'],
      thinkingParamName: thinkingParamName || undefined,
      thinkingEnabledValue: thinkingEnabledValue || undefined,
      thinkingDisabledValue: thinkingDisabledValue || undefined,
      thinkingNestedKey: thinkingNestedKey || undefined,
      sortOrder,
      contextWindow,
      maxOutputTokens,
      inputModalities,
    };
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b sticky top-0 bg-card z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">{editing ? '编辑模型' : '添加模型'}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5">
          <div className="space-y-3">
            <h3 className="font-medium text-sm sm:text-base">基本信息</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">供应商 *</label>
                <select
                  value={providerId ?? '__workers__'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setProviderId(value === '__workers__' ? null : value);
                    setModelId('');
                    setAvailableModels([]);
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                >
                  <option value="__workers__">Cloudflare Workers AI（内置）</option>
                  {connections
                    .filter((connection) => connection.isActive || connection.id === providerId)
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                        {connection.isDefault ? '（默认）' : ''}
                      </option>
                    ))}
                </select>
                {connections.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">还没有供应商连接，请先到「供应商」页配置。</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">模型名称</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  placeholder="选择模型后自动填充"
                />
              </div>
            </div>

            {isWorkersAi ? (
              <div>
                <label className="block text-sm font-medium mb-1">选择模型 *</label>
                <select
                  value={modelId}
                  onChange={(event) => {
                    const value = event.target.value;
                    handleModelIdChange(value);
                    const item = workersAiModels.find((model) => model.id === value);
                    if (item) {
                      if (!name) setName(item.name);
                      if (item.capabilities.length > 0) setCapabilities(item.capabilities);
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  required
                >
                  <option value="">请选择 Workers AI 模型</option>
                  {modelId && modelId !== '__manual__' && !workersAiModels.some((item) => item.id === modelId) && (
                    <option value={modelId}>{modelId}（当前）</option>
                  )}
                  {workersAiModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.id})
                    </option>
                  ))}
                  <option value="__manual__">手动输入模型 ID…</option>
                </select>

                {modelId === '__manual__' && (
                  <div className="mt-2">
                    <input
                      value={manualModelId}
                      onChange={(event) => setManualModelId(event.target.value)}
                      className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                      placeholder="@cf/deepseek/deepseek-r1"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      模型 ID 需以 @cf/ 开头，可在 Cloudflare Workers AI 模型目录中查找。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">模型 ID *</label>
                <input
                  value={modelId}
                  onChange={(event) => handleModelIdChange(event.target.value)}
                  list="provider-model-options"
                  className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                  placeholder={isLoadingModels ? '正在加载模型列表...' : '选择或手动输入模型 ID'}
                  required
                />
                <datalist id="provider-model-options">
                  {availableModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  未拉取到列表时可手动填写；供应商连接会复用同一份 API Key。
                </p>
              </div>
            )}

            {selectedMetadata && (
              <div className="p-3 rounded-lg border bg-muted/30 text-xs space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {formatContext(selectedMetadata.contextWindow) && (
                    <span className="px-1.5 py-0.5 bg-background rounded">
                      上下文 {formatContext(selectedMetadata.contextWindow)}
                    </span>
                  )}
                  {formatContext(selectedMetadata.maxOutputTokens) && (
                    <span className="px-1.5 py-0.5 bg-background rounded">
                      输出 {formatContext(selectedMetadata.maxOutputTokens)}
                    </span>
                  )}
                  {selectedMetadata.pricing?.input !== undefined && (
                    <span className="px-1.5 py-0.5 bg-background rounded">
                      输入 ${selectedMetadata.pricing.input.toFixed(2)}/M
                    </span>
                  )}
                  {selectedMetadata.pricing?.output !== undefined && (
                    <span className="px-1.5 py-0.5 bg-background rounded">
                      输出 ${selectedMetadata.pricing.output.toFixed(2)}/M
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">元数据来源：{selectedMetadata.source}</p>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t">
            <h3 className="font-medium text-sm sm:text-base">模型能力</h3>
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.filter((capability) => !(capability.value === 'embedding' && !isWorkersAi)).map(
                (capability) => (
                  <label
                    key={capability.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                      capabilities.includes(capability.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={capabilities.includes(capability.value)}
                      onChange={() => toggleCapability(capability.value)}
                      className="rounded"
                    />
                    <span>{capability.label}</span>
                  </label>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              向量嵌入固定使用 Workers AI，以匹配现有 Vectorize 索引维度。
            </p>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <h3 className="font-medium text-sm sm:text-base">高级设置</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">温度 (0-2)</label>
                <input
                  type="number"
                  value={temperature}
                  onChange={(event) => setTemperature(parseFloat(event.target.value) || 0.7)}
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
                  value={sortOrder}
                  onChange={(event) => setSortOrder(parseInt(event.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  min={0}
                  step={1}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">系统提示词</label>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                rows={3}
                placeholder="自定义系统提示词..."
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={supportsThinking}
                onChange={(event) => setSupportsThinking(event.target.checked)}
                className="rounded"
              />
              <span className="text-sm">支持思考模式</span>
              <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            </label>

            {supportsThinking && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">参数格式</label>
                    <select
                      value={thinkingParamFormat}
                      onChange={(event) => setThinkingParamFormat(event.target.value as typeof thinkingParamFormat)}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                    >
                      <option value="">使用供应商默认</option>
                      <option value="object">Object</option>
                      <option value="boolean">Boolean</option>
                      <option value="string">String</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">参数名称</label>
                    <input
                      value={thinkingParamName}
                      onChange={(event) => setThinkingParamName(event.target.value)}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder="thinking / enable_thinking"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">启用值</label>
                    <input
                      value={thinkingEnabledValue}
                      onChange={(event) => setThinkingEnabledValue(event.target.value)}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder="enabled / true"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">禁用值</label>
                    <input
                      value={thinkingDisabledValue}
                      onChange={(event) => setThinkingDisabledValue(event.target.value)}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder="disabled / false"
                    />
                  </div>
                </div>
                {thinkingParamFormat === 'object' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">嵌套键名</label>
                    <input
                      value={thinkingNestedKey}
                      onChange={(event) => setThinkingNestedKey(event.target.value)}
                      className="w-full px-3 py-1.5 border rounded bg-background text-sm font-mono"
                      placeholder="type"
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">留空则使用供应商预设的思考参数格式。</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? '收起元数据' : '展开元数据（上下文 / 输出 / 输入模态）'}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">上下文窗口</label>
                  <input
                    type="number"
                    value={contextWindow ?? ''}
                    onChange={(event) =>
                      setContextWindow(event.target.value ? parseInt(event.target.value) : undefined)
                    }
                    className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">最大输出</label>
                  <input
                    type="number"
                    value={maxOutputTokens ?? ''}
                    onChange={(event) =>
                      setMaxOutputTokens(event.target.value ? parseInt(event.target.value) : undefined)
                    }
                    className="w-full px-3 py-1.5 border rounded bg-background text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium mb-1">输入模态</label>
                  <div className="flex gap-2">
                    {['text', 'image', 'audio', 'video'].map((modality) => (
                      <label key={modality} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={inputModalities.includes(modality)}
                          onChange={() =>
                            setInputModalities((prev) =>
                              prev.includes(modality) ? prev.filter((item) => item !== modality) : [...prev, modality]
                            )
                          }
                        />
                        {modality}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!editing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">设为当前激活模型</span>
              </label>
            )}
          </div>

          {model?.hasApiKey !== undefined && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Key className="h-3.5 w-3.5" />
              密钥由供应商连接统一管理
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              取消
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !effectiveModelId || (!isWorkersAi && !providerId)}
              className="w-full sm:w-auto"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editing ? '保存修改' : '添加模型'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
