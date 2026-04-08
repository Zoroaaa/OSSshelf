/**
 * ProvidersSection.tsx
 * 可用模型列表组件
 *
 * 功能:
 * - Cloudflare Workers AI 模型展示和快速启用
 * - OpenAI 兼容 API 模型展示
 */

import { Cloud, Zap, CheckCircle, Loader2, Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import type { AiModel, AiWorkersAiModel, AiOpenAiModel, AiConfigStatus } from '@/services/api';

interface ProvidersSectionProps {
  models: AiModel[];
  status?: AiConfigStatus | null;
  providersData?: {
    workersAiModels: AiWorkersAiModel[];
    openAiModels: AiOpenAiModel[];
  };
  quickActivateMutation: {
    isPending: boolean;
    mutate: (workersAiModelId: string) => void;
  };
}

export function ProvidersSection({ models, status, providersData, quickActivateMutation }: ProvidersSectionProps) {
  if (!providersData) return null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="border rounded-lg p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Cloud className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg sm:text-xl font-semibold">Cloudflare Workers AI</h2>
          <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full font-medium">
            免费
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Cloudflare 内置的 AI 服务，无需配置 API 密钥即可使用</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {providersData.workersAiModels
            .filter((m) => m.id !== '__custom__')
            .map((m) => {
              const isAdded = models.some((model) => model.provider === 'workers_ai' && model.modelId === m.id);
              const isActive = status?.activeModel?.modelId === m.id;
              const isPending = quickActivateMutation.isPending;

              return (
                <div
                  key={m.id}
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
                      <h3 className="font-medium text-sm sm:text-base truncate">{m.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{m.id}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-2 line-clamp-2">{m.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      {m.capabilities.map((cap) => (
                        <span key={cap} className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full">
                          {cap}
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
                      onClick={() => quickActivateMutation.mutate(m.id)}
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
      </section>

      <section className="border rounded-lg p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Zap className="h-5 w-5 text-blue-500" />
          <h2 className="text-lg sm:text-xl font-semibold">OpenAI 兼容 API</h2>
          <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full font-medium">
            需要配置
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          支持 OpenAI、Anthropic Claude、Google Gemini、通义千问等所有兼容 API
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {providersData.openAiModels.map((m) => (
            <div key={m.id} className="p-3 sm:p-4 border rounded-lg hover:border-primary/50 transition-colors">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-medium text-sm sm:text-base">{m.name}</h3>
                    <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">{m.provider}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{m.id}</p>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-2 line-clamp-2">{m.description}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {m.capabilities.map((cap) => (
                  <span key={cap} className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
