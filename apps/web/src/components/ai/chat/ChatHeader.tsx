/**
 * ChatHeader.tsx
 * 聊天页顶部栏：左侧为返回 / 会话历史 / 标题；右侧为模型选择与「更多」菜单。
 *
 * 布局约定：
 * - 低频操作（工具说明、导出、AI 设置）收进「更多」菜单，避免与高频操作同权重平铺
 * - 模型选择在移动端同样可用（不再隐藏）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Info,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/utils';

export interface HeaderModelOption {
  id: string;
  name: string;
  providerName?: string;
  isActive?: boolean;
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
  /** 是否已有会话：未建会话时模型选择只作为下一条对话的默认值 */
  sessionActive?: boolean;
  /** 移动端打开会话历史侧栏（桌面端侧栏常驻，无需此按钮） */
  onToggleSidebar?: () => void;
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
  sessionActive,
  onToggleSidebar,
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(() => models.find((model) => model.id === modelId), [models, modelId]);
  const visibleModels = useMemo(() => {
    const keyword = modelQuery.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(keyword) ||
        (model.providerName ?? '').toLowerCase().includes(keyword)
    );
  }, [models, modelQuery]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) setModelMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [modelMenuOpen]);

  // 关闭菜单时清空搜索词，避免下次打开还残留上次筛选
  useEffect(() => {
    if (!modelMenuOpen) setModelQuery('');
  }, [modelMenuOpen]);

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

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            title="会话历史"
            aria-label="打开会话历史"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

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
          <div className="relative" ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setModelMenuOpen((value) => !value)}
              className={cn(
                'flex h-8 max-w-[132px] items-center gap-1.5 rounded-lg border border-border px-2 text-xs transition-colors sm:max-w-[190px]',
                modelMenuOpen ? 'bg-accent text-foreground' : 'bg-background text-foreground hover:bg-accent'
              )}
              title="切换模型"
              aria-label="切换模型"
              aria-expanded={modelMenuOpen}
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-left">{activeModel?.name ?? '选择模型'}</span>
              <ChevronDown className={cn('h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform', modelMenuOpen && 'rotate-180')} />
            </button>

            {modelMenuOpen && (
              <div className="absolute right-0 top-9 z-dropdown w-[260px] overflow-hidden rounded-xl border border-border bg-popover shadow-popover animate-in fade-in zoom-in-95 duration-150">
                <div className="border-b border-border/70 px-3 pb-2 pt-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    已配置 {models.length} 个可用模型 · {sessionActive ? '仅影响当前对话' : '下一条对话使用此模型'}
                  </p>
                  {models.length > 6 && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-border bg-background px-2">
                      <Search className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      <input
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.target.value)}
                        placeholder="搜索模型或供应商"
                        className="h-7 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="max-h-[280px] overflow-y-auto py-1">
                  {visibleModels.length === 0 && (
                    <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">没有匹配的模型</p>
                  )}
                  {visibleModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        onModelChange?.(model.id);
                        setModelMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent',
                        model.id === modelId && 'bg-primary/5'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-foreground">{model.name}</span>
                          {model.isActive === false && (
                            <span className="flex-shrink-0 rounded-full bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                              已停用
                            </span>
                          )}
                        </span>
                        {model.providerName && (
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {model.providerName}
                          </span>
                        )}
                      </span>
                      {model.id === modelId && <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>

                <div className="border-t border-border/70">
                  <button
                    type="button"
                    onClick={() => {
                      setModelMenuOpen(false);
                      navigate('/ai-settings');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Settings className="h-3 w-3" />
                    管理模型与供应商
                  </button>
                </div>
              </div>
            )}
          </div>
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
            <div className="absolute right-0 top-9 z-dropdown min-w-[176px] rounded-xl border border-border bg-popover py-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-150">
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
