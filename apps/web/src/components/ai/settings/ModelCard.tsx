/**
 * ModelCard.tsx
 * 模型配置卡片组件（卡片式布局）
 */

import {
  Cloud,
  Zap,
  Edit2,
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  PlayCircle,
  XCircle,
  CheckCircle,
  Brain,
  Eye,
  MessageSquare,
  Code2,
  BarChart2,
  Key,
  Link,
  Thermometer,
  SortAsc,
  Star,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
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

const CAPABILITY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  chat: {
    label: '对话',
    icon: <MessageSquare className="h-3 w-3" />,
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400',
  },
  vision: {
    label: '视觉',
    icon: <Eye className="h-3 w-3" />,
    color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400',
  },
  embedding: {
    label: '向量',
    icon: <BarChart2 className="h-3 w-3" />,
    color: 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400',
  },
  function_calling: {
    label: '函数',
    icon: <Code2 className="h-3 w-3" />,
    color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400',
  },
  completion: {
    label: '补全',
    icon: <Zap className="h-3 w-3" />,
    color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
  },
};

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs font-medium">{value}</p>
      </div>
    </div>
  );
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
  const currentTestResult = testResult?.modelId === model.id ? testResult : null;
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={`
        group relative rounded-xl border transition-all duration-200 flex flex-col
        ${
          model.isActive
            ? 'border-primary/60 bg-primary/[0.03] shadow-sm shadow-primary/10'
            : 'border-border bg-card hover:border-border/80 hover:shadow-sm'
        }
      `}
    >
      {model.isActive && <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-primary rounded-full" />}

      <div className="p-3 flex flex-col h-full">
        <div className="flex items-start gap-2.5">
          <div
            className={`
            flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center
            ${
              model.provider === 'workers_ai'
                ? 'bg-orange-100 dark:bg-orange-900/30'
                : 'bg-blue-100 dark:bg-blue-900/30'
            }
          `}
          >
            {model.provider === 'workers_ai' ? (
              <Cloud className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            ) : (
              <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{model.name}</span>
              {model.isActive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium flex-shrink-0">
                  <Star className="h-2.5 w-2.5" />
                  使用中
                </span>
              )}
              {model.isReadonly && (
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] flex-shrink-0">
                  只读
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{model.modelId}</p>
          </div>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-popover border rounded-lg shadow-lg py-1">
                  <button
                    onClick={() => {
                      onEdit();
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  {!model.isReadonly && (
                    <button
                      onClick={() => {
                        onDelete();
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {model.supportsThinking && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400">
              <Brain className="h-3 w-3" />
              思考
            </span>
          )}
          {model.capabilities.map((cap) => {
            const cfg = CAPABILITY_CONFIG[cap];
            if (!cfg) return null;
            return (
              <span
                key={cap}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${cfg.color}`}
              >
                {cfg.icon}
                {cfg.label}
              </span>
            );
          })}
        </div>

        {currentTestResult && (
          <div
            className={`
            mt-3 p-3 rounded-lg text-sm border
            ${
              currentTestResult.valid
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }
          `}
          >
            <div className="flex items-center gap-2">
              {currentTestResult.valid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="font-medium text-green-700 dark:text-green-300 text-sm">连接成功</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <span className="font-medium text-red-700 dark:text-red-300 text-sm">连接失败</span>
                </>
              )}
              {currentTestResult.latencyMs && (
                <span className="text-xs text-muted-foreground ml-auto">{currentTestResult.latencyMs}ms</span>
              )}
            </div>
            {currentTestResult.response && (
              <p className="mt-2 text-xs bg-white dark:bg-slate-800 rounded p-2 line-clamp-3">
                {currentTestResult.response}
              </p>
            )}
            {currentTestResult.error && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{currentTestResult.error}</p>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center gap-2">
          {!model.isActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={onActivate}
              disabled={isActivating}
              className="flex-1 h-8 text-xs gap-1"
            >
              {isActivating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              激活
            </Button>
          )}
          {onTest && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTest(model.id)}
              disabled={isTesting}
              className="flex-1 h-8 text-xs gap-1"
            >
              {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
              测试
            </Button>
          )}
          <button
            onClick={onToggleExpand}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <DetailItem
                icon={<Thermometer className="h-3.5 w-3.5" />}
                label="温度"
                value={String(model.temperature)}
              />
              <DetailItem
                icon={<Key className="h-3.5 w-3.5" />}
                label="API Key"
                value={model.hasApiKey ? '已配置 ✓' : '未配置'}
              />
              <DetailItem
                icon={<SortAsc className="h-3.5 w-3.5" />}
                label="排序"
                value={String(model.sortOrder ?? 0)}
              />
            </div>
            {model.apiEndpoint && (
              <div className="flex items-start gap-2">
                <Link className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">API 端点</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded break-all block">{model.apiEndpoint}</code>
                </div>
              </div>
            )}
            {model.systemPrompt && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">系统提示词</p>
                <p className="text-xs bg-muted p-2 rounded max-h-20 overflow-y-auto">{model.systemPrompt}</p>
              </div>
            )}
            {model.supportsThinking && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <Brain className="h-3.5 w-3.5" />
                <span>思考模式：{model.thinkingParamFormat || '已启用'}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
