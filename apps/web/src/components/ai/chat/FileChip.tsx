/**
 * FileChip.tsx
 * 文件芯片按钮组件（优化版）
 *
 * 功能:
 * - 展示文件图标、名称、大小
 * - 点击跳转文件预览
 * - 优化的视觉层次和交互体验
 */

import { File, FolderOpen, FileText, Image, ExternalLink, HardDrive } from 'lucide-react';
import type { AgentFile } from '../types';

interface FileChipProps {
  file: AgentFile;
  onClick: () => void;
}

export function FileChip({ file, onClick }: FileChipProps) {
  const getIcon = (mime: string | null) => {
    if (file.isFolder) return <FolderOpen className="h-4 w-4 text-amber-500" />;
    if (!mime) return <File className="h-4 w-4 text-slate-500" />;
    if (mime.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
    if (mime.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    if (mime.startsWith('text/') || mime.includes('document'))
      return <FileText className="h-4 w-4 text-slate-600" />;
    return <File className="h-4 w-4 text-slate-400" />;
  };

  const getIconBg = (mime: string | null) => {
    if (file.isFolder) return 'from-amber-100 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/20';
    if (!mime) return 'from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700';
    if (mime.startsWith('image/')) return 'from-blue-100 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/20';
    if (mime.includes('pdf')) return 'from-red-100 to-rose-50 dark:from-red-900/30 dark:to-rose-900/20';
    if (mime.startsWith('text/') || mime.includes('document'))
      return 'from-slate-100 to-gray-50 dark:from-slate-800 dark:to-gray-900/30';
    return 'from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700';
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  };

  return (
    <button
      onClick={onClick}
      className="group/chip flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-gradient-to-br hover:from-violet-50/50 hover:to-purple-50/50 dark:hover:from-violet-900/20 dark:hover:to-purple-900/10 transition-all duration-300 text-left shadow-sm hover:shadow-md hover:shadow-violet-500/5 active:scale-[0.98] w-full sm:w-auto min-w-0"
    >
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${getIconBg(file.mimeType)} flex items-center justify-center group-hover/chip:shadow-md transition-all duration-300 group-hover/chip:scale-105`}
      >
        {getIcon(file.mimeType)}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[180px] group-hover/chip:text-violet-700 dark:group-hover/chip:text-violet-300 transition-colors">
          {file.name}
        </p>
        {file.size > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <HardDrive className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{formatSize(file.size)}</span>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 opacity-0 group-hover/chip:opacity-100 transition-all duration-200 translate-x-2 group-hover/chip:translate-x-0">
        <ExternalLink className="h-4 w-4 text-violet-500" />
      </div>
    </button>
  );
}
