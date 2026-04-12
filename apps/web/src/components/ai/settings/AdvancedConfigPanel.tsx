/**
 * AdvancedConfigPanel.tsx
 * 高级系统配置面板组件
 *
 * 功能:
 * - 按分类展示系统配置项
 * - 支持布尔切换、模型选择、文本编辑
 * - 重置为默认值
 * - PC端双列紧凑布局，移动端单列自适应
 */

import { Sliders, RefreshCw, Save, RotateCcw, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import { useState } from 'react';
import type { AiSystemConfigItem, AiModel } from '@/services/api';

interface AdvancedConfigPanelProps {
  systemConfigs: AiSystemConfigItem[];
  configLoading: boolean;
  models: AiModel[];
  visionModels: AiModel[];
  modelCapabilityMap: Record<string, 'chat' | 'vision'>;
  editingConfigKey: string | null;
  configEditValue: string;
  onRefetch: () => void;
  onSave: (config: AiSystemConfigItem) => void;
  onSetEditingKey: (key: string | null) => void;
  onSetConfigEditValue: (value: string) => void;
  onUpdateMutation: (params: { key: string; value: unknown }) => void;
  onResetMutation: (key: string) => void;
  isUpdatePending: boolean;
  isResetPending: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  model: '默认模型',
  parameter: '模型参数',
  agent: 'Agent 配置',
  tool: '工具配置',
  feature: '功能配置',
  rag: 'RAG 配置',
  retry: '重试策略',
  prompt: '提示词模板',
};

function ConfigItem({
  config,
  models,
  editingConfigKey,
  configEditValue,
  onSetEditingKey,
  onSetConfigEditValue,
  onSave,
  onUpdateMutation,
  onResetMutation,
  isUpdatePending,
  isResetPending,
}: {
  config: AiSystemConfigItem;
  models: AiModel[];
  editingConfigKey: string | null;
  configEditValue: string;
  onSetEditingKey: (key: string | null) => void;
  onSetConfigEditValue: (value: string) => void;
  onSave: (config: AiSystemConfigItem) => void;
  onUpdateMutation: (params: { key: string; value: unknown }) => void;
  onResetMutation: (key: string) => void;
  isUpdatePending: boolean;
  isResetPending: boolean;
}) {
  const isEditing = editingConfigKey === config.key;
  const currentValue =
    config.valueType === 'string'
      ? (config.stringValue ?? '')
      : config.valueType === 'number'
        ? String(config.numberValue ?? '')
        : config.valueType === 'boolean'
          ? String(config.booleanValue)
          : (config.jsonValue ?? '');

  const isModelConfig = config.key.startsWith('ai.default_model.');
  const isModified = config.defaultValue !== currentValue;

  const renderValue = () => {
    if (config.valueType === 'boolean') {
      return (
        <button
          onClick={() => {
            if (!config.isEditable) return;
            onUpdateMutation({ key: config.key, value: !config.booleanValue });
          }}
          disabled={!config.isEditable || isUpdatePending}
          className={cn(
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
            config.booleanValue ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
              config.booleanValue ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </button>
      );
    }

    if (isModelConfig) {
      return (
        <div className="flex items-center gap-2 w-full min-w-0">
          <select
            value={currentValue}
            onChange={(e) => onUpdateMutation({ key: config.key, value: e.target.value })}
            disabled={!config.isEditable || isUpdatePending}
            className="flex-1 min-w-0 px-2 py-1 text-xs border rounded bg-background truncate"
          >
            <option value={config.defaultValue}>{config.defaultValue}</option>
            {models
              .filter((m) => m.modelId !== config.defaultValue)
              .map((m) => (
                <option key={m.id} value={m.modelId}>
                  {m.name}
                </option>
              ))}
          </select>
          {isModified && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdateMutation({ key: config.key, value: config.defaultValue })}
              disabled={isUpdatePending}
              className="h-6 px-2 flex-shrink-0"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      );
    }

    if (isEditing) {
      return (
        <div className="flex items-center gap-1.5 w-full min-w-0">
          <input
            type={config.valueType === 'number' ? 'number' : 'text'}
            value={configEditValue}
            onChange={(e) => onSetConfigEditValue(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 text-xs border rounded bg-background font-mono"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(config);
              if (e.key === 'Escape') onSetEditingKey(null);
            }}
          />
          <Button
            size="sm"
            onClick={() => onSave(config)}
            disabled={isUpdatePending}
            className="h-6 px-2 flex-shrink-0"
          >
            <Save className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSetEditingKey(null)} className="h-6 w-6 p-0 flex-shrink-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5 w-full min-w-0">
        <code className="flex-1 min-w-0 px-2 py-1 bg-muted rounded text-xs font-mono truncate">
          {currentValue || '(空)'}
        </code>
        {config.isEditable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onSetEditingKey(config.key);
              onSetConfigEditValue(currentValue);
            }}
            className="h-6 px-2 flex-shrink-0"
          >
            编辑
          </Button>
        )}
        {isModified && config.isEditable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onResetMutation(config.key)}
            disabled={isResetPending}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        'p-2.5 rounded-lg border transition-colors',
        !config.isEditable && 'opacity-60 bg-muted/20',
        isModified && 'border-primary/40 bg-primary/[0.02]'
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs font-medium truncate">{config.label}</span>
          {!config.isEditable && (
            <span className="px-1 py-0.5 bg-muted text-[9px] rounded text-muted-foreground flex-shrink-0">只读</span>
          )}
          {isModified && (
            <span className="px-1 py-0.5 bg-primary/10 text-[9px] rounded text-primary flex-shrink-0">已修改</span>
          )}
        </div>
        {config.valueType === 'boolean' && renderValue()}
      </div>
      {config.valueType !== 'boolean' && renderValue()}
      <p className="text-[9px] text-muted-foreground mt-1 truncate">{config.description}</p>
    </div>
  );
}

export function AdvancedConfigPanel({
  systemConfigs,
  configLoading,
  models,
  visionModels,
  modelCapabilityMap,
  editingConfigKey,
  configEditValue,
  onRefetch,
  onSave,
  onSetEditingKey,
  onSetConfigEditValue,
  onUpdateMutation,
  onResetMutation,
  isUpdatePending,
  isResetPending,
}: AdvancedConfigPanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['model', 'parameter']));

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  if (configLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">加载配置中...</p>
      </div>
    );
  }

  if (systemConfigs.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">AI 系统配置</h2>
            <p className="text-xs text-muted-foreground mt-0.5">调整AI功能的核心参数</p>
          </div>
        </div>
        <div className="text-center py-10 border-2 border-dashed rounded-lg">
          <Sliders className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">系统配置尚未初始化</p>
        </div>
      </div>
    );
  }

  const categories = ['model', 'parameter', 'agent', 'tool', 'feature', 'rag', 'retry', 'prompt'];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">AI 系统配置</h2>
          <p className="text-xs text-muted-foreground mt-0.5">调整AI功能的核心参数</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefetch} disabled={configLoading}>
          {configLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="space-y-2">
        {categories.map((category) => {
          const categoryConfigs = systemConfigs.filter((c) => c.category === category);
          if (categoryConfigs.length === 0) return null;

          const isExpanded = expandedCategories.has(category);

          return (
            <div key={category} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{CATEGORY_LABELS[category] || category}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                    {categoryConfigs.length}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {categoryConfigs.map((config) => {
                    const requiredCapability = modelCapabilityMap[config.key];
                    const availableModels = requiredCapability === 'vision' ? visionModels : models;

                    return (
                      <ConfigItem
                        key={config.key}
                        config={config}
                        models={availableModels}
                        editingConfigKey={editingConfigKey}
                        configEditValue={configEditValue}
                        onSetEditingKey={onSetEditingKey}
                        onSetConfigEditValue={onSetConfigEditValue}
                        onSave={onSave}
                        onUpdateMutation={onUpdateMutation}
                        onResetMutation={onResetMutation}
                        isUpdatePending={isUpdatePending}
                        isResetPending={isResetPending}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
        💡 修改后立即生效，如遇问题可点击重置按钮恢复默认值
      </div>
    </div>
  );
}
