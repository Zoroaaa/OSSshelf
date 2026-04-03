/**
 * ModelCard.tsx
 * 模型配置卡片组件
 *
 * 功能:
 * - 展示模型信息
 * - 展开/收起详情
 * - 操作按钮（编辑/删除/激活/测试）
 */

import { useState } from 'react';
import { Cloud, Zap, Cpu, Edit2, Trash2, Check, ChevronDown, ChevronUp, Loader2, PlayCircle, XCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AiModel } from '@/services/api';

interface ModelCardProps {
  model: AiModel;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
  isActivating: boolean;
  onTest?: (modelId: string) => void;
  testResult?: {
    modelId: string;
    valid: boolean;
    response?: string;
    latencyMs?: number;
    error?: string;
  } | null;
  isTesting?: boolean;
}

export function ModelCard({
  model,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onActivate,
  isActivating,
  onTest,
  testResult,
  isTesting,
}: ModelCardProps) {
  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'workers_ai':
        return <Cloud className="h-4 w-4 text-orange-500" />;
      case 'openai_compatible':
        return <Zap className="h-4 w-4 text-blue-500" />;
      default:
        return <Cpu className="h-4 w-4" />;
    }
  };

  const currentTestResult = testResult?.modelId === model.id ? testResult : null;

  return (
    <div className={`border rounded-lg transition-all ${model.isActive ? 'border-primary bg-primary/5' : 'hover:border-primary/30'}`}>
      <div className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {getProviderIcon(model.provider)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-sm sm:text-base truncate">{model.name}</h3>
                {model.isActive && (
                  <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full font-medium flex-shrink-0">
                    使用中
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">
                {model.modelId} · {model.provider === 'workers_ai' ? 'Workers AI' : '自定义 API'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {!model.isActive && (
              <Button variant="outline" size="sm" onClick={onActivate} disabled={isActivating} className="text-xs">
                {isActivating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span className="ml-1 hidden sm:inline">激活</span>
              </Button>
            )}
            {onTest && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTest(model.id)}
                disabled={isTesting}
                className="text-xs"
              >
                {isTesting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <PlayCircle className="h-3 w-3" />
                )}
                <span className="ml-1 hidden sm:inline">测试</span>
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8">
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 text-red-500 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onToggleExpand} className="h-8 w-8">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* 测试结果展示 */}
        {currentTestResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            currentTestResult.valid
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {currentTestResult.valid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-300">连接成功</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="font-medium text-red-700 dark:text-red-300">连接失败</span>
                </>
              )}
              {currentTestResult.latencyMs && (
                <span className="text-xs text-muted-foreground ml-auto">
                  响应时间: {currentTestResult.latencyMs}ms
                </span>
              )}
            </div>
            {currentTestResult.response && (
              <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded text-xs">
                <p className="line-clamp-3">{currentTestResult.response}</p>
              </div>
            )}
            {currentTestResult.error && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{currentTestResult.error}</p>
            )}
          </div>
        )}

        {isExpanded && (
          <div className="mt-4 pt-4 border-t space-y-2 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-muted-foreground">提供商：</span>
                <span className="font-medium">{model.provider}</span>
              </div>
              <div>
                <span className="text-muted-foreground">最大 Token：</span>
                <span className="font-medium">{model.maxTokens.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">温度：</span>
                <span className="font-medium">{model.temperature}</span>
              </div>
              <div>
                <span className="text-muted-foreground">API Key：</span>
                <span className="font-medium">{model.hasApiKey ? '已配置' : '未配置'}</span>
              </div>
            </div>
            {model.apiEndpoint && (
              <div>
                <span className="text-muted-foreground">API 端点：</span>
                <span className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">{model.apiEndpoint}</span>
              </div>
            )}
            {model.systemPrompt && (
              <div>
                <span className="text-muted-foreground">系统提示词：</span>
                <p className="mt-1 text-xs bg-muted p-2 rounded max-h-20 overflow-y-auto">{model.systemPrompt}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">能力：</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {model.capabilities.map((cap) => (
                  <span key={cap} className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}