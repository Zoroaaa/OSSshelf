/**
 * ChatHeader.tsx
 * 聊天页顶部栏：左侧为返回 / 会话历史 / 标题；右侧为模型选择与「更多」菜单。
 *
 * 布局约定：
 * - 低频操作（工具说明、导出、AI 设置）收进「更多」菜单，避免与高频操作同权重平铺
 * - 模型选择在移动端同样可用（不再隐藏）
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Info, Loader2, MoreHorizontal, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/utils';

export interface HeaderModelOption {
  id: string;
  name: string;
}

interface ChatHeaderProps {
  title?: string;
  toolCount: number;
  onShowToolInfo: () => void;
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
  models = [],
  modelId,
  onModelChange,
  onExport,
  exporting,
  connected,
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  return (
    <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => navigate('/files')}
          className="flex h-8 items-center gap-1 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="返回文件管理"
          aria-label="返回文件管理"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden text-xs md:inline">文件</span>
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
            className="h-8 max-w-[112px] rounded-lg border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 sm:max-w-[180px] sm:px-2"
            title="切换模型"
            aria-label="切换模型"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        )}

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              menuOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            title="更多操作"
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-9 z-[120] min-w-[176px] rounded-xl border border-border bg-popover py-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onShowToolInfo();
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Info className="h-3.5 w-3.5" />
                可用工具
                <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {toolCount > 99 ? '99+' : toolCount}
                </span>
              </button>
              {onExport && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onExport();
                  }}
                  disabled={exporting}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  导出 Markdown
                </button>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/ai-settings');
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Settings className="h-3.5 w-3.5" />
                AI 设置
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
