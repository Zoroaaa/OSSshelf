/**
 * ChatHeader.tsx
 * 聊天页面顶部导航栏组件
 *
 * 功能:
 * - 返回文件管理页面按钮
 * - 侧边栏切换按钮
 * - 标题展示
 * - 工具信息按钮（带角标）
 * - 设置入口
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PanelLeftClose, PanelLeft, Sparkles, Settings, Info } from 'lucide-react';

import { cn } from '@/utils';

interface ChatHeaderProps {
  toolCount: number;
  onShowToolInfo: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
}

export function ChatHeader({ toolCount, onShowToolInfo, showSidebar, onToggleSidebar }: ChatHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => navigate('/files')}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="返回文件管理"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleSidebar}
          className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            showSidebar
              ? 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              : 'text-violet-600 bg-violet-50 dark:bg-violet-900/20'
          )}
          title={showSidebar ? '隐藏对话历史' : '显示对话历史'}
        >
          {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">文件管理助手</span>
            <span className="hidden md:inline text-xs text-slate-400 ml-2">· 可直接查询您的文件</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onShowToolInfo}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 transition-colors relative"
          title={`查看全部 ${toolCount} 个可用工具`}
        >
          <Info className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-violet-500 text-[8px] text-white flex items-center justify-center font-bold leading-none">
            {toolCount}
          </span>
        </button>
        <button
          onClick={() => navigate('/ai-settings')}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="AI 设置"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
