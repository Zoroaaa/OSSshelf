/**
 * ProviderConnectionModal.tsx
 * 供应商连接 + 模型发现/导入
 *
 * 流程：填连接 → 保存/测试 → 拉取模型 → 勾选导入
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Key, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { aiApi, type AiDiscoveredModel, type AiProviderConnection, type AiProviderPreset } from '@/services/api';

interface ProviderConnectionModalProps {
  preset?: AiProviderPreset | null;
  connection?: AiProviderConnection | null;
  onClose: () => void;
  onSaved: () => void;
}

function formatContext(value?: number): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function formatPrice(value?: number): string | null {
  if (value === undefined) return null;
  return `$${value.toFixed(2)}/M`;
}

const CAPABILITY_LABELS: Record<string, string> = {
  chat: '对话',
  vision: '视觉',
  embedding: '向量',
  function_calling: '工具',
  completion: '补全',
};

export function ProviderConnectionModal({ preset, connection, onClose, onSaved }: ProviderConnectionModalProps) {
  const { toast } = useToast();
  const isCustom = preset?.id === 'custom' || (!preset && !connection?.presetId);

  const [name, setName] = useState(connection?.name || preset?.name || '');
  const [apiEndpoint, setApiEndpoint] = useState(connection?.apiEndpoint || preset?.baseUrl || '');
  const [protocol, setProtocol] = useState<'openai_compatible' | 'anthropic'>(
    (connection?.protocol as 'openai_compatible' | 'anthropic') || preset?.protocol || 'openai_compatible'
  );
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [headersJson, setHeadersJson] = useState('');
  const [clearHeaders, setClearHeaders] = useState(false);
  const [isActive, setIsActive] = useState(connection?.isActive ?? true);

  const [workingConnection, setWorkingConnection] = useState<AiProviderConnection | null>(connection ?? null);
  const [models, setModels] = useState<AiDiscoveredModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyUnadded, setOnlyUnadded] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; latencyMs?: number; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lockedProtocol = (!!preset && preset.id !== 'custom') || !!connection?.presetId;
  const workingConnectionId = workingConnection?.id;

  useEffect(() => {
    if (!workingConnectionId) return;
    let cancelled = false;
    aiApi.config
      .getProviderModels(workingConnectionId)
      .then((res) => {
        if (cancelled) return;
        const result = res.data.data;
        if (result?.models?.length) setModels(result.models);
      })
      .catch(() => {
        // 缓存为空时不自动报错，用户可点「获取模型列表」
      });
    return () => {
      cancelled = true;
    };
  }, [workingConnectionId]);

  const filteredModels = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return models.filter((model) => {
      if (onlyUnadded && model.added) return false;
      if (!keyword) return true;
      return model.id.toLowerCase().includes(keyword) || model.name.toLowerCase().includes(keyword);
    });
  }, [models, search, onlyUnadded]);

  const selectedCount = selected.size;

  const handleClose = () => {
    if (workingConnection) onSaved();
    onClose();
  };

  const saveConnection = async (): Promise<AiProviderConnection> => {
    const payload = {
      ...(preset ? { presetId: preset.id } : {}),
      name: name.trim() || preset?.name || connection?.name || '自定义连接',
      protocol: lockedProtocol ? undefined : protocol,
      apiEndpoint: apiEndpoint.trim(),
      apiKey: apiKey.trim() || undefined,
      clearApiKey: clearApiKey || undefined,
      headers: headersJson.trim() ? (JSON.parse(headersJson) as Record<string, string>) : undefined,
      clearHeaders: clearHeaders || undefined,
      isActive,
    };

    if (workingConnection) {
      const res = await aiApi.config.updateProvider(workingConnection.id, payload);
      const updated = res.data.data;
      if (!updated) throw new Error('保存供应商失败');
      setWorkingConnection(updated);
      return updated;
    }

    const res = await aiApi.config.createProvider(payload);
    const created = res.data.data;
    if (!created) throw new Error('创建供应商失败');
    setWorkingConnection(created);
    return created;
  };

  const handleSaveOnly = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await saveConnection();
      toast({ title: '已保存', description: '供应商连接已保存' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setError(null);
    setIsTesting(true);
    setTestResult(null);
    try {
      const saved = await saveConnection();
      const res = await aiApi.config.testProvider(saved.id);
      const result = res.data.data;
      setTestResult(result ?? null);
      if (result?.valid) {
        toast({ title: '连接成功', description: `可用模型 ${result.modelCount} 个 · ${result.latencyMs}ms` });
      }
    } catch (err) {
      setTestResult({ valid: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDiscover = async (refresh = false) => {
    setError(null);
    setIsDiscovering(true);
    try {
      const saved = await saveConnection();
      const res = await aiApi.config.discoverProviderModels(saved.id, refresh);
      const result = res.data.data;
      setModels(result?.models ?? []);
      if (result?.models?.length) {
        toast({ title: '已获取模型列表', description: `${result.models.length} 个模型` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleImport = async () => {
    setError(null);
    setIsSaving(true);
    try {
      const saved = await saveConnection();
      if (selected.size > 0) {
        const res = await aiApi.config.importProviderModels(saved.id, Array.from(selected));
        const result = res.data.data;
        toast({
          title: '已导入',
          description: `新增 ${result?.created ?? 0} 个，跳过 ${result?.skipped ?? 0} 个`,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllUnadded = () => {
    const ids = filteredModels.filter((model) => !model.added).map((model) => model.id);
    setSelected(new Set(ids));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="p-4 sm:p-5 border-b sticky top-0 bg-card z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">
                {connection ? `配置 ${connection.name}` : preset ? `连接 ${preset.name}` : '添加自定义供应商'}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {preset?.description || connection?.description || 'OpenAI 兼容或 Anthropic 兼容端点'}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8 flex-shrink-0">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">连接信息</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">名称</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  placeholder="供应商名称"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">协议</label>
                <select
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value as 'openai_compatible' | 'anthropic')}
                  disabled={lockedProtocol}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm disabled:opacity-60"
                >
                  <option value="openai_compatible">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic Messages</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Base URL</label>
              <input
                value={apiEndpoint}
                onChange={(event) => setApiEndpoint(event.target.value)}
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm font-mono"
                placeholder="https://api.example.com/v1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                填到 /v1 或 /v3 为止，不要包含 /chat/completions。必须是公网可访问的 https 地址。
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                <Key className="h-3 w-3 inline mr-1" />
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  if (event.target.value) setClearApiKey(false);
                }}
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                placeholder={workingConnection?.hasApiKey ? '已保存，留空保持不变' : '输入 API Key（无鉴权端点可留空）'}
              />
              {workingConnection?.hasApiKey && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(event) => setClearApiKey(event.target.checked)}
                  />
                  清除已保存的 Key
                </label>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              启用此连接（关闭后新增模型时不再列出）
            </label>

            {isCustom && (
              <div>
                <label className="block text-xs font-medium mb-1">自定义请求头（可选）</label>
                <textarea
                  value={headersJson}
                  onChange={(event) => {
                    setHeadersJson(event.target.value);
                    if (event.target.value) setClearHeaders(false);
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-xs font-mono"
                  rows={3}
                  placeholder={
                    workingConnection?.hasHeaders
                      ? '已保存请求头，留空保持不变；填写则覆盖'
                      : '{"HTTP-Referer":"https://example.com"}'
                  }
                />
                {workingConnection?.hasHeaders && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={clearHeaders}
                      onChange={(event) => setClearHeaders(event.target.checked)}
                    />
                    清除已保存的请求头
                  </label>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={isTesting || isDiscovering || isSaving}
              >
                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                测试连接
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDiscover(false)}
                disabled={isDiscovering || isTesting || isSaving}
              >
                {isDiscovering ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                获取模型列表
              </Button>
              {models.length > 0 && (
                <span className="text-xs text-muted-foreground">已缓存 {models.length} 个模型</span>
              )}
            </div>

            {testResult && (
              <div
                className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                  testResult.valid
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                }`}
              >
                {testResult.valid ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                )}
                <span>
                  {testResult.valid ? `连接成功，延迟 ${testResult.latencyMs ?? 0}ms` : testResult.error || '连接失败'}
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{error}</span>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">可用模型</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  勾选要加入的模型；导入后可在「模型」页激活，或指定给具体功能。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索模型"
                    className="w-32 sm:w-40 bg-transparent text-xs focus:outline-none"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDiscover(true)}
                  disabled={isDiscovering || isSaving}
                >
                  {isDiscovering ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyUnadded}
                  onChange={(event) => setOnlyUnadded(event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                仅看未添加
              </label>
              <Button variant="ghost" size="sm" onClick={selectAllUnadded} disabled={filteredModels.length === 0}>
                全选未添加
              </Button>
            </div>

            {isDiscovering ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-sm text-muted-foreground">还没有模型列表</p>
                <p className="text-xs text-muted-foreground mt-1">
                  点「获取模型列表」从供应商拉取；不支持 /models 的供应商可在「模型」页手动填写模型 ID。
                </p>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">没有匹配的模型</div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {filteredModels.map((model) => {
                  const isAdded = !!model.added;
                  const isSelected = selected.has(model.id) || isAdded;
                  const context = formatContext(model.contextWindow);
                  const output = formatContext(model.maxOutputTokens);
                  const price = formatPrice(model.pricing?.input);

                  return (
                    <label
                      key={model.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        isAdded ? 'bg-muted/30 border-border cursor-default' : 'hover:bg-accent/40 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isAdded}
                        onChange={() => toggleSelect(model.id)}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{model.name}</span>
                          {isAdded && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary">已添加</span>
                          )}
                          {model.status === 'deprecated' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300">
                              已弃用
                            </span>
                          )}
                          {model.status === 'beta' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                              Beta
                            </span>
                          )}
                          {model.supportsThinking && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                              思考
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{model.id}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {context && (
                            <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">上下文 {context}</span>
                          )}
                          {output && <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">输出 {output}</span>}
                          {price && (
                            <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded text-[10px]">
                              {price}
                            </span>
                          )}
                          {model.capabilities
                            .filter((capability) => capability !== 'completion')
                            .map((capability) => (
                              <span
                                key={capability}
                                className="px-1.5 py-0.5 bg-accent text-accent-foreground rounded text-[10px]"
                              >
                                {CAPABILITY_LABELS[capability] ?? capability}
                              </span>
                            ))}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 sm:p-5 border-t sticky bottom-0 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            已选 {selectedCount} 个模型{workingConnection?.hasApiKey ? ' · Key 已保存' : ''}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSaveOnly}
              disabled={isSaving || isDiscovering || isTesting}
              className="flex-1 sm:flex-initial"
            >
              仅保存连接
            </Button>
            <Button
              onClick={handleImport}
              disabled={isSaving || isDiscovering || isTesting}
              className="flex-1 sm:flex-initial"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              保存并导入{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
