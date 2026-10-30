/**
 * ProvidersSection.tsx
 * 可用模型列表组件
 *
 * 数据来源:
 * - Cloudflare Workers AI 官方模型目录（配置 CF_ACCOUNT_ID / CF_API_TOKEN 后实时同步，
 *   含 context_window / price 等参数；未配置时回退内置兜底清单并显式提示）
 * - OpenAI 兼容 API 不再维护静态模型清单，改为在「添加模型」表单中手动填写
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Cloud, Loader2, Play, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import { aiApi } from '@/services/api';
import type { AiModel, AiWorkersAiCatalogModel, AiConfigStatus } from '@/services/api';

const PROPERTY_LABELS: Record<string, string> = {
  context_window: '上下文',
  max_output_tokens: '最大输出',
  max_input_tokens: '最大输入',
  max_tokens: '最大 Tokens',
  price: '价格',
  pricing: '价格',
  cost: '价格',
  beta: '测试版',
  vision: '视觉',
};

const CAPABILITY_LABELS: Record<string, string> = {
  chat: '对话',
  vision: '视觉',
  embedding: '向量',
  function_calling: '工具调用',
  completion: '补全',
};

function propertyLabel(key: string): string {
  return PROPERTY_LABELS[key] ?? key;
}

interface ProvidersSectionProps {
  models: AiModel[];
  status?: AiConfigStatus | null;
  quickActivateMutation: {
    isPending: boolean;
    mutate: (model: AiWorkersAiCatalogModel) => void;
  };
}

export function ProvidersSection({ models, status, quickActivateMutation }: ProvidersSectionProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ['workers-ai-catalog'],
    queryFn: () => aiApi.config.getWorkersAiModels().then((res) => res.data.data),
    staleTime: 5 * 60_000,
  });

  const catalog = catalogQuery.data;
  const filteredModels = useMemo(() => {
    const list = catalog?.models ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(
      (model) =>
        model.id.toLowerCase().includes(keyword) ||
        model.name.toLowerCase().includes(keyword) ||
        model.description.toLowerCase().includes(keyword)
    );
  }, [catalog?.models, query]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await aiApi.config.getWorkersAiModels(true);
      await queryClient.invalidateQueries({ queryKey: ['workers-ai-catalog'] });
    } finally {
      setRefreshing(false);
    }
  };

  const renderProperty = (property: { key: string; value: string }) => (
    <span key={`${property.key}-${property.value}`} className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
      {propertyLabel(property.key)}: {property.value}
    </span>
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="border rounded-lg p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Cloud className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg sm:text-xl font-semibold">Cloudflare Workers AI</h2>
            {catalog?.source === 'live' ? (
              <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full font-medium">
                实时同步
              </span>
            ) : (
              <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 text-xs rounded-full font-medium">
                内置兜底
              </span>
            )}
            {catalog?.fetchedAt && (
              <span className="text-xs text-muted-foreground">
                更新于 {new Date(catalog.fetchedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-2">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            同步最新目录
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mt-2">
          模型目录来自 Cloudflare 官方 API，卡片展示模型参数（上下文/最大输出等）与官方返回的价格字段。
          未返回价格字段时按 Workers AI 统一计费：$0.011 / 1,000 Neurons，每日 10,000 Neurons 免费额度。
        </p>

        {catalog?.source === 'fallback' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="text-xs text-amber-700 dark:text-amber-300">
              <p className="font-medium">
                {catalog.configured ? '实时目录同步失败，当前展示内置兜底清单' : '当前展示内置兜底清单，可能滞后'}
              </p>
              {catalog.error && <p className="mt-0.5 break-all">原因：{catalog.error}</p>}
              <p className="mt-1">
                在 Worker 环境变量中配置 <code className="font-mono">CF_ACCOUNT_ID</code> 与{' '}
                <code className="font-mono">CF_API_TOKEN</code>
                （权限：Workers AI Read）后，可实时同步官方模型目录及价格字段。
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型名称 / ID / 描述"
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              清除
            </button>
          )}
        </div>

        {catalogQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : catalogQuery.isError ? (
          <div className="mt-4 text-sm text-red-500">
            模型目录读取失败：{catalogQuery.error instanceof Error ? catalogQuery.error.message : '未知错误'}
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">没有匹配的模型</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredModels.map((model) => {
              const isAdded = models.some((item) => item.provider === 'workers_ai' && item.modelId === model.id);
              const isActive = status?.activeModel?.modelId === model.id;
              const isPending = quickActivateMutation.isPending;

              return (
                <div
                  key={model.id}
                  className={cn(
                    'p-3 sm:p-4 border rounded-lg transition-colors relative',
                    isActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                  )}
                >
                  {isActive && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle className="h-5 w-5 text-primary" />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-medium text-sm sm:text-base truncate">{model.name}</h3>
                        {model.beta && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-[10px] text-amber-700 dark:text-amber-300">
                            测试版
                          </span>
                        )}
                        {model.deprecated && (
                          <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[10px] text-red-700 dark:text-red-300">
                            已弃用
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{model.id}</p>
                      {model.task && model.task !== '内置兜底清单' && (
                        <p className="text-[11px] text-muted-foreground mt-1">任务类型：{model.task}</p>
                      )}
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 line-clamp-2">
                        {model.description}
                      </p>

                      {(model.properties.length > 0 || model.pricing) && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {model.pricing && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium">
                              价格: {model.pricing}
                            </span>
                          )}
                          {model.properties.slice(0, 6).map(renderProperty)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      {model.capabilities.map((cap) => (
                        <span key={cap} className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full">
                          {CAPABILITY_LABELS[cap] ?? cap}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t">
                    <Button
                      size="sm"
                      variant={isActive ? 'default' : 'outline'}
                      className="w-full"
                      disabled={isPending}
                      onClick={() => quickActivateMutation.mutate(model)}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          处理中...
                        </>
                      ) : isActive ? (
                        <>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          当前使用中
                        </>
                      ) : isAdded ? (
                        <>
                          <Play className="h-3 w-3 mr-1" />
                          切换到此模型
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3 mr-1" />
                          快速启用
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          💡 需要接入 OpenAI / Claude / Gemini / 通义千问等第三方模型时，请在「模型」页点击「添加模型」，
          选择对应提供商并填写 API 端点与密钥。
        </p>
      </section>
    </div>
  );
}
