/**
 * SystemConfigPanel.tsx
 * AI 系统配置：分组导航 + 搜索 + 行式表单项
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import type { AiModel, AiSystemConfigItem } from '@/services/api';

interface SystemConfigPanelProps {
  systemConfigs: AiSystemConfigItem[];
  configLoading: boolean;
  models: AiModel[];
  visionModels: AiModel[];
  modelCapabilityMap: Record<string, 'chat' | 'vision' | 'embedding'>;
  onRefetch: () => void;
  onUpdate: (params: { key: string; value: unknown }) => void;
  onReset: (key: string) => void;
  isUpdatePending: boolean;
  isResetPending: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  model: '全局回退模型',
  parameter: '模型参数',
  agent: 'Agent 配置',
  tool: '工具配置',
  feature: '功能开关',
  rag: 'RAG 配置',
  retry: '重试与超时',
  quota: '配额与限流',
  prompt: '提示词模板',
};

const CATEGORY_ORDER = ['model', 'parameter', 'agent', 'tool', 'feature', 'rag', 'retry', 'quota', 'prompt'];
const ADVANCED_CATEGORY = '__advanced__';

function getCurrentValue(config: AiSystemConfigItem): string {
  if (config.valueType === 'string') return config.stringValue ?? config.defaultValue ?? '';
  if (config.valueType === 'number') return String(config.numberValue ?? config.defaultValue ?? '');
  if (config.valueType === 'boolean') return String(config.booleanValue);
  return config.jsonValue ?? config.defaultValue ?? '';
}

function isModified(config: AiSystemConfigItem): boolean {
  return getCurrentValue(config) !== config.defaultValue;
}

export function SystemConfigPanel({
  systemConfigs,
  configLoading,
  models,
  visionModels,
  modelCapabilityMap,
  onRefetch,
  onUpdate,
  onReset,
  isUpdatePending,
  isResetPending,
}: SystemConfigPanelProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('model');
  const [expandedAdvanced, setExpandedAdvanced] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const config of systemConfigs) next[config.key] = getCurrentValue(config);
    setDrafts(next);
  }, [systemConfigs]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return systemConfigs;
    return systemConfigs.filter(
      (config) =>
        config.label.toLowerCase().includes(keyword) ||
        config.key.toLowerCase().includes(keyword) ||
        (config.description ?? '').toLowerCase().includes(keyword)
    );
  }, [systemConfigs, search]);

  const normalConfigs = filtered.filter((config) => !config.ui?.advanced && config.isEditable !== false);
  const advancedConfigs = filtered.filter((config) => config.ui?.advanced || config.isEditable === false);

  const categories = useMemo(() => {
    const present = new Set(normalConfigs.map((config) => config.category));
    return CATEGORY_ORDER.filter((category) => present.has(category));
  }, [normalConfigs]);

  const visibleCategory = search.trim()
    ? (categories[0] ?? ADVANCED_CATEGORY)
    : categories.includes(activeCategory)
      ? activeCategory
      : (categories[0] ?? ADVANCED_CATEGORY);

  const categoryConfigs = search.trim()
    ? normalConfigs
    : normalConfigs.filter((config) => config.category === visibleCategory);

  const commitValue = (config: AiSystemConfigItem) => {
    if (!config.isEditable) return;
    const draft = drafts[config.key] ?? '';
    const ui = config.ui;

    if (config.valueType === 'number') {
      const number = Number(draft);
      if (!Number.isFinite(number)) {
        setErrors((prev) => ({ ...prev, [config.key]: '请输入有效数字' }));
        return;
      }
      if (ui?.min !== undefined && number < ui.min) {
        setErrors((prev) => ({ ...prev, [config.key]: `不能小于 ${ui.min}` }));
        return;
      }
      if (ui?.max !== undefined && number > ui.max) {
        setErrors((prev) => ({ ...prev, [config.key]: `不能大于 ${ui.max}` }));
        return;
      }
      setErrors((prev) => {
        const next = { ...prev };
        delete next[config.key];
        return next;
      });
      onUpdate({ key: config.key, value: number });
      return;
    }

    if (config.valueType === 'string') {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[config.key];
        return next;
      });
      onUpdate({ key: config.key, value: draft });
    }
  };

  const renderControl = (config: AiSystemConfigItem) => {
    const ui = config.ui;
    const value = drafts[config.key] ?? getCurrentValue(config);
    const error = errors[config.key];

    if (!config.isEditable) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <code className="px-2 py-1 bg-muted rounded font-mono">{getCurrentValue(config) || '(空)'}</code>
        </div>
      );
    }

    if (config.valueType === 'boolean') {
      return (
        <button
          type="button"
          onClick={() => onUpdate({ key: config.key, value: !config.booleanValue })}
          disabled={isUpdatePending}
          className={cn(
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
            config.booleanValue ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
              config.booleanValue ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </button>
      );
    }

    if (config.key.startsWith('ai.default_model.')) {
      const capability = modelCapabilityMap[config.key];
      const options =
        capability === 'vision'
          ? visionModels
          : capability === 'embedding'
            ? models.filter((model) => model.capabilities.includes('embedding'))
            : models.filter((model) => model.capabilities.includes('chat'));
      return (
        <select
          value={value}
          onChange={(event) => onUpdate({ key: config.key, value: event.target.value })}
          disabled={isUpdatePending}
          className="w-full sm:w-72 px-2 py-1.5 text-xs border rounded-lg bg-background"
        >
          <option value={config.defaultValue}>{config.defaultValue}（默认）</option>
          {value && value !== config.defaultValue && !options.some((model) => model.modelId === value) && (
            <option value={value}>{value}（当前）</option>
          )}
          {options
            .filter((model) => model.modelId !== config.defaultValue)
            .map((model) => (
              <option key={model.id} value={model.modelId}>
                {model.name} · {model.modelId}
              </option>
            ))}
        </select>
      );
    }

    if (ui?.multiline) {
      return (
        <div className="w-full">
          <textarea
            value={value}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [config.key]: event.target.value }))}
            onBlur={() => commitValue(config)}
            rows={ui.rows ?? 4}
            className="w-full px-3 py-2 text-xs border rounded-lg bg-background font-mono"
          />
          {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
        </div>
      );
    }

    return (
      <div className="w-full sm:w-64">
        <div className="flex items-center gap-1.5">
          <input
            type={config.valueType === 'number' ? 'number' : 'text'}
            value={value}
            min={ui?.min}
            max={ui?.max}
            step={ui?.step}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [config.key]: event.target.value }))}
            onBlur={() => commitValue(config)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitValue(config);
            }}
            className={cn(
              'flex-1 min-w-0 px-2.5 py-1.5 text-xs border rounded-lg bg-background font-mono',
              error && 'border-red-400'
            )}
          />
          {ui?.unit && <span className="text-[11px] text-muted-foreground flex-shrink-0">{ui.unit}</span>}
        </div>
        {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
        {ui?.min !== undefined && ui?.max !== undefined && !error && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            范围 {ui.min} - {ui.max}
          </p>
        )}
      </div>
    );
  };

  const renderConfigRow = (config: AiSystemConfigItem) => (
    <div
      key={config.key}
      className={cn(
        'flex flex-col sm:flex-row sm:items-start gap-2 p-3 rounded-lg border bg-card',
        isModified(config) && 'border-primary/30 bg-primary/[0.02]'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium">{config.label}</span>
          {isModified(config) && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary">已修改</span>
          )}
          {!config.isEditable && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">只读</span>
          )}
        </div>
        {config.description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{config.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{config.key}</p>
      </div>
      <div className="flex items-start gap-1.5 sm:max-w-[50%]">
        {renderControl(config)}
        {isModified(config) && config.isEditable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => onReset(config.key)}
            disabled={isResetPending}
            title="重置为默认值"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">系统配置</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            以下配置对全部用户生效；功能级模型请在「索引与处理」中设置。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索配置项"
              className="w-40 sm:w-56 bg-transparent text-xs focus:outline-none"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onRefetch} disabled={configLoading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-48 flex-shrink-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar">
            {categories.map((category) => {
              const count = normalConfigs.filter((config) => config.category === category).length;
              return (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors',
                    visibleCategory === category
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <span>{CATEGORY_LABELS[category] || category}</span>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px]',
                      visibleCategory === category ? 'bg-primary-foreground/20' : 'bg-muted'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {advancedConfigs.length > 0 && (
              <button
                onClick={() => setExpandedAdvanced(!expandedAdvanced)}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent whitespace-nowrap"
              >
                <span className="flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5" />
                  只读参数
                </span>
                {expandedAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {search.trim() ? (
            filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">没有匹配的配置项</div>
            ) : (
              <>
                {normalConfigs.map(renderConfigRow)}
                {advancedConfigs.map(renderConfigRow)}
              </>
            )
          ) : (
            <>
              {categoryConfigs.map(renderConfigRow)}
              {expandedAdvanced && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs text-muted-foreground px-1">只读参数由系统维护，仅供排查。</p>
                  {advancedConfigs.map(renderConfigRow)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
