/**
 * ChatHeader.tsx
 * 聊天页顶部栏：返回、会话历史开关、标题、模型选择、导出、工具说明、设置。
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Info, Loader2, PanelLeft, PanelLeftClose, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/utils';

export interface HeaderModelOption {
  id: string;
  name: string;
}

interface ChatHeaderProps {
  title?: string;
  toolCount: number;
  onShowToolInfo: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  models?: HeaderModelOption[];
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  onExport?: () => void;
  exporting?: boolean;
  connected?: boolean;
}

export function ChatHeader({
  title,
  toolCount,
  onShowToolInfo,
  showSidebar,
  onToggleSidebar,
  models = [],
  modelId,
  onModelChange,
  onExport,
  exporting,
  connected,
}: ChatHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => navigate('/files')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="返回文件管理"
          aria-label="返回文件管理"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            showSidebar ? 'text-muted-foreground hover:bg-accent hover:text-foreground' : 'bg-primary/10 text-primary'
          )}
          title={showSidebar ? '隐藏对话历史' : '显示对话历史'}
          aria-label={showSidebar ? '隐藏对话历史' : '显示对话历史'}
        >
          {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>

        <div className="ml-1 flex min-w-0 items-center gap-2">
          <div className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:flex">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{title || '文件管理助手'}</p>
            <p className="hidden truncate text-[11px] text-muted-foreground md:block">
              {connected === false ? '连接中断，正在重试' : '可直接查询与操作你的文件'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {models.length > 0 && (
          <select
            value={modelId ?? ''}
            onChange={(event) => onModelChange?.(event.target.value)}
            disabled={!connected}
            className="hidden h-8 max-w-[180px] rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 sm:block"
            title="切换模型"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onShowToolInfo}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={`查看全部 ${toolCount} 个可用工具`}
          aria-label="查看可用工具"
        >
          <Info className="h-4 w-4" />
          <span className="absolute right-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
            {toolCount > 99 ? '99+' : toolCount}
          </span>
        </button>

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            title="导出为 Markdown"
            aria-label="导出为 Markdown"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/ai-settings')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="AI 设置"
          aria-label="AI 设置"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
