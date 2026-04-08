/**
 * AdvancedConfigPanel.tsx
 * 高级系统配置面板组件
 *
 * 功能:
 * - 按分类展示系统配置项
 * - 支持布尔切换、模型选择、文本编辑
 * - 重置为默认值
 */

import { Sliders, RefreshCw, Save, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
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
  model: '🤖 默认模型',
  parameter: '⚙️ 模型参数',
  agent: '🤖 Agent 配置',
  tool: '🔧 工具配置',
  feature: '✨ 功能配置',
  rag: '📚 RAG 配置',
  retry: '🔄 重试策略',
  prompt: '💬 提示词模板',
};

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
  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (systemConfigs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">AI 系统配置</h2>
            <p className="text-sm text-muted-foreground mt-1">调整AI功能的核心参数和默认模型</p>
          </div>
        </div>
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <Sliders className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-base sm:text-lg font-medium mb-2">暂无配置项</h3>
          <p className="text-sm text-muted-foreground">系统配置尚未初始化</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">AI 系统配置</h2>
          <p className="text-sm text-muted-foreground mt-1">调整AI功能的核心参数和默认模型</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefetch} disabled={configLoading}>
          {configLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          刷新
        </Button>
      </div>

      {['model', 'parameter', 'agent', 'tool', 'feature', 'rag', 'retry', 'prompt'].map((category) => {
        const categoryConfigs = systemConfigs.filter((c) => c.category === category);
        if (categoryConfigs.length === 0) return null;

        return (
          <section key={category} className="border rounded-lg p-4 sm:p-6 space-y-4">
            <h3 className="font-medium text-base sm:text-lg flex items-center gap-2">
              {CATEGORY_LABELS[category] || category}
              <span className="text-xs text-muted-foreground font-normal">({categoryConfigs.length} 项)</span>
            </h3>

            <div className="space-y-3">
              {categoryConfigs.map((config) => {
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
                const requiredCapability = modelCapabilityMap[config.key];
                const availableModels = requiredCapability === 'vision' ? visionModels : models;

                const renderInput = () => {
                  if (config.valueType === 'boolean') {
                    return (
                      <button
                        onClick={() => {
                          if (!config.isEditable) return;
                          onUpdateMutation({ key: config.key, value: !config.booleanValue });
                        }}
                        disabled={!config.isEditable || isUpdatePending}
                        className={cn(
                          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
                          config.booleanValue ? 'bg-primary' : 'bg-muted'
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                            config.booleanValue ? 'translate-x-6' : 'translate-x-1'
                          )}
                        />
                      </button>
                    );
                  }

                  if (isModelConfig) {
                    return (
                      <div className="flex items-center gap-2">
                        <select
                          value={currentValue}
                          onChange={(e) => {
                            onUpdateMutation({ key: config.key, value: e.target.value });
                          }}
                          disabled={!config.isEditable || isUpdatePending}
                          className="flex-1 px-3 py-1.5 border rounded bg-background text-sm"
                        >
                          <option value={config.defaultValue}>{config.defaultValue} (系统默认)</option>
                          {availableModels
                            .filter((m) => m.modelId !== config.defaultValue)
                            .map((m) => (
                              <option key={m.id} value={m.modelId}>
                                {m.name} ({m.provider})
                              </option>
                            ))}
                        </select>
                        {currentValue !== config.defaultValue && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onUpdateMutation({
                                key: config.key,
                                value: config.defaultValue,
                              })
                            }
                            disabled={isUpdatePending}
                            title="重置为默认值"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    );
                  }

                  if (isEditing) {
                    return (
                      <div className="flex gap-2">
                        <input
                          type={config.valueType === 'number' ? 'number' : 'text'}
                          value={configEditValue}
                          onChange={(e) => onSetConfigEditValue(e.target.value)}
                          className="flex-1 px-3 py-1.5 border rounded bg-background text-sm font-mono"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onSave(config);
                            if (e.key === 'Escape') onSetEditingKey(null);
                          }}
                        />
                        <Button size="sm" onClick={() => onSave(config)} disabled={isUpdatePending}>
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onSetEditingKey(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <div className="flex items-center gap-2">
                      <code className="px-2.5 py-1.5 bg-muted rounded text-sm font-mono flex-1 min-w-0 truncate">
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
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                  );
                };

                return (
                  <div
                    key={config.key}
                    className={cn('p-3 rounded-lg border space-y-2', !config.isEditable && 'opacity-75')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{config.label}</span>
                          {!config.isEditable && (
                            <span className="px-1.5 py-0.5 bg-muted text-xs rounded text-muted-foreground">
                              系统只读
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">Key: {config.key}</p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {renderInput()}
                        {config.defaultValue !== currentValue && config.isEditable && !isEditing && !isModelConfig && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onResetMutation(config.key)}
                            disabled={isResetPending}
                            title="重置为默认值"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-muted-foreground">
        💡 提示：修改配置后立即生效。如遇问题可点击重置按钮恢复默认值。
      </div>
    </div>
  );
}
