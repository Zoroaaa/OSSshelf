/**
 * FileChip.tsx
 * 文件芯片按钮组件
 *
 * 功能:
 * - 展示文件图标、名称、大小
 * - 点击跳转文件预览
 */

import { File, FolderOpen, FileText, Image, ExternalLink } from 'lucide-react';
import type { AgentFile } from '../types';

interface FileChipProps {
  file: AgentFile;
  onClick: () => void;
}

export function FileChip({ file, onClick }: FileChipProps) {
  const getIcon = (mime: string | null) => {
    if (file.isFolder) return <FolderOpen className="h-3.5 w-3.5 text-amber-500" />;
    if (!mime) return <File className="h-3.5 w-3.5" />;
    if (mime.startsWith('image/')) return <Image className="h-3.5 w-3.5 text-blue-500" />;
    if (mime.includes('pdf')) return <FileText className="h-3.5 w-3.5 text-red-500" />;
    if (mime.startsWith('text/') || mime.includes('document'))
      return <FileText className="h-3.5 w-3.5 text-slate-500" />;
    return <File className="h-3.5 w-3.5 text-slate-400" />;
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
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-left group w-full sm:w-auto min-w-0"
    >
      {getIcon(file.mimeType)}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{file.name}</p>
        {file.size > 0 && <p className="text-[10px] text-slate-400">{formatSize(file.size)}</p>}
      </div>
      <ExternalLink className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}
