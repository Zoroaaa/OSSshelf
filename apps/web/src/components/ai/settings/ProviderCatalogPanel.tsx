/**
 * ProviderCatalogPanel.tsx
 * 供应商目录：预设卡片 + 已连接状态 + 自定义连接
 */

import { useState } from 'react';
import { Cloud, ExternalLink, Plus, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import type { AiProviderConnection, AiProviderPreset } from '@/services/api';

interface ProviderCatalogPanelProps {
  presets: AiProviderPreset[];
  connections: AiProviderConnection[];
  onConnect: (preset: AiProviderPreset) => void;
  onManage: (connection: AiProviderConnection) => void;
  onDelete: (connection: AiProviderConnection) => void;
  onOpenWorkersAi: () => void;
  workersAiModelCount: number;
}

function ProtocolBadge({ protocol }: { protocol: string | null }) {
  if (!protocol) return null;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
      {protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}
    </span>
  );
}

function ProviderLogo({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (logoUrl && !imageFailed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="h-9 w-9 rounded-lg object-contain bg-muted/40 p-1"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function ProviderCatalogPanel({
  presets,
  connections,
  onConnect,
  onManage,
  onDelete,
  onOpenWorkersAi,
  workersAiModelCount,
}: ProviderCatalogPanelProps) {
  const externalPresets = presets.filter((preset) => preset.kind !== 'workers_ai');
  const customConnections = connections.filter(
    (connection) => !connection.presetId || !presets.some((preset) => preset.id === connection.presetId)
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">供应商</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              连接供应商后自动拉取模型列表，模型共享同一份 API Key。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl border bg-card flex flex-col gap-3">
            <div className="flex items-start gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <Cloud className="h-4.5 w-4.5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-sm">Cloudflare Workers AI</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
                    内置
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">零配置，按 Neurons 计费</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-auto pt-2 border-t">
              <span className="text-xs text-muted-foreground">{workersAiModelCount} 个可用模型</span>
              <Button variant="outline" size="sm" onClick={onOpenWorkersAi}>
                浏览模型
              </Button>
            </div>
          </div>

          {externalPresets.map((preset) => {
            const connection = connections.find((item) => item.presetId === preset.id);
            const connected = !!connection;

            return (
              <div
                key={preset.id}
                className={cn(
                  'p-3.5 rounded-xl border bg-card flex flex-col gap-3 transition-colors',
                  connected ? 'border-primary/40 bg-primary/[0.02]' : 'hover:border-border/80'
                )}
              >
                <div className="flex items-start gap-2.5">
                  <ProviderLogo name={preset.name} logoUrl={preset.logoUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm truncate">{preset.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{preset.description}</p>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <ProtocolBadge protocol={preset.protocol} />
                      {connected && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                          已连接
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    {connected ? `${connection.modelCount} 个模型` : '未连接'}
                  </span>
                  <div className="flex items-center gap-1">
                    <a
                      href={preset.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                      title="供应商文档"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {connected ? (
                      <Button variant="outline" size="sm" onClick={() => onManage(connection)} className="h-7 text-xs">
                        管理
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => onConnect(preset)} className="h-7 text-xs">
                        配置
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">自定义连接</h3>
            <p className="text-xs text-muted-foreground mt-0.5">公司网关、本地 Ollama / LM Studio 或其他兼容端点。</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onConnect({
                id: 'custom',
                name: '自定义连接',
                kind: 'openai_compatible',
                protocol: 'openai_compatible',
                baseUrl: '',
                docsUrl: 'https://platform.openai.com/docs/api-reference',
                requiresApiKey: false,
                defaultInput: ['text'],
                description: '自定义 OpenAI / Anthropic 兼容端点',
              })
            }
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </Button>
        </div>

        {customConnections.length === 0 ? (
          <div className="text-center py-6 border-2 border-dashed rounded-lg text-sm text-muted-foreground">
            暂无自定义连接
          </div>
        ) : (
          <div className="space-y-2">
            {customConnections.map((connection) => (
              <div key={connection.id} className="p-3 rounded-xl border bg-card flex items-center gap-3">
                <ProviderLogo name={connection.name} logoUrl={connection.logoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{connection.name}</span>
                    <ProtocolBadge protocol={connection.protocol} />
                    <span className="text-[10px] text-muted-foreground">{connection.modelCount} 个模型</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{connection.apiEndpoint}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onManage(connection)}>
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:text-red-600"
                    onClick={() => onDelete(connection)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
