/**
 * ProviderCatalogPanel.tsx
 * 供应商目录：预设卡片 + 已连接状态 + 自定义连接
 */

import { useMemo, useState } from 'react';
import { Cloud, ExternalLink, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import type { AiCatalogProvider, AiProviderConnection, AiProviderPreset } from '@/services/api';

interface ProviderCatalogPanelProps {
  presets: AiProviderPreset[];
  connections: AiProviderConnection[];
  catalogProviders: AiCatalogProvider[];
  onConnect: (preset: AiProviderPreset) => void;
  onManage: (connection: AiProviderConnection) => void;
  onDelete: (connection: AiProviderConnection) => void;
  onOpenWorkersAi: () => void;
  workersAiModelCount: number;
}

/** npm 包名推断协议：Anthropic SDK 走 Anthropic Messages，其余按 OpenAI 兼容处理 */
function inferProtocol(npm?: string): 'openai_compatible' | 'anthropic' {
  return npm?.includes('anthropic') ? 'anthropic' : 'openai_compatible';
}

/** 把 models.dev 目录项转成预设结构，复用现有连接弹窗的预填逻辑 */
function catalogItemToPreset(item: AiCatalogProvider): AiProviderPreset {
  return {
    id: item.id,
    name: item.name,
    kind: inferProtocol(item.npm),
    protocol: inferProtocol(item.npm),
    baseUrl: item.api ?? '',
    docsUrl: item.doc ?? '',
    logoUrl: item.logoUrl,
    requiresApiKey: item.env.length > 0,
    defaultInput: ['text'],
    description: `models.dev · ${item.modelCount} 个模型${item.hasPreset ? '（已有内置预设）' : ''}`,
    // 目录项的协议是推断值，允许用户在弹窗里修正
    isCatalogBased: true,
  };
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
  catalogProviders,
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

  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const presetIds = useMemo(() => new Set(presets.map((preset) => preset.id)), [presets]);
  const filteredCatalog = useMemo(() => {
    const keyword = catalogQuery.trim().toLowerCase();
    // 默认隐藏已有内置预设的项，避免与上方预设卡片重复；搜索时全量匹配
    const source = keyword
      ? catalogProviders
      : catalogProviders.filter((item) => !presetIds.has(item.id));
    const list = keyword
      ? source.filter(
          (item) =>
            item.name.toLowerCase().includes(keyword) ||
            item.id.toLowerCase().includes(keyword)
        )
      : source;
    return catalogExpanded ? list : list.slice(0, 24);
  }, [catalogProviders, catalogQuery, catalogExpanded, presetIds]);
  const catalogTotal = catalogQuery.trim()
    ? catalogProviders.filter(
        (item) =>
          item.name.toLowerCase().includes(catalogQuery.trim().toLowerCase()) ||
          item.id.toLowerCase().includes(catalogQuery.trim().toLowerCase())
      ).length
    : catalogProviders.filter((item) => !presetIds.has(item.id)).length;

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
                      {connected && connection.securityWarnings?.length > 0 && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          title="该连接使用非 https 或私有网络端点，建议尽快更换为公网 https 地址"
                        >
                          端点风险
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

      {catalogProviders.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">models.dev 供应商目录</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                可选 {catalogTotal} 家未在上方预设中的供应商，自动填入端点与协议；模型列表在连接后获取。
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 w-full sm:w-56">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                value={catalogQuery}
                onChange={(event) => {
                  setCatalogQuery(event.target.value);
                  setCatalogExpanded(false);
                }}
                placeholder="搜索供应商（含已预设）"
                className="w-full bg-transparent text-xs focus:outline-none"
              />
            </div>
          </div>

          {filteredCatalog.length === 0 ? (
            <div className="text-center py-5 border-2 border-dashed rounded-lg text-sm text-muted-foreground">
              没有匹配的供应商
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {filteredCatalog.map((item) => (
                <div key={item.id} className="p-2.5 rounded-lg border bg-card flex items-center gap-2.5">
                  <ProviderLogo name={item.name} logoUrl={item.logoUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-xs truncate">{item.name}</span>
                      {item.hasPreset && (
                        <span className="px-1 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">已预设</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {item.modelCount} 个模型 · {inferProtocol(item.npm) === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" onClick={() => onConnect(catalogItemToPreset(item))}>
                    配置
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!catalogExpanded && catalogTotal > 24 && (
            <Button variant="ghost" size="sm" onClick={() => setCatalogExpanded(true)}>
              显示全部 {catalogTotal} 家
            </Button>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">自定义连接</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              公司网关或其他公网 https 兼容端点（不支持本机/私有网络地址）。
            </p>
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
                    {connection.securityWarnings?.length > 0 && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                        title="该连接使用非 https 或私有网络端点，建议尽快更换为公网 https 地址"
                      >
                        端点风险
                      </span>
                    )}
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
