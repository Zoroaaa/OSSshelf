/**
 * StorageBreakdownChart.tsx
 * 存储类型分布图表
 */

import { FileText, Image, Video, Music, Archive, File, Folder } from 'lucide-react';
import type { StorageBreakdown } from '../../services/api';
import { formatBytes, cn } from '../../utils';

interface StorageBreakdownChartProps {
  data: StorageBreakdown;
}

const TYPE_ICONS: Record<string, typeof File> = {
  image: Image,
  video: Video,
  audio: Music,
  application: Archive,
  text: FileText,
  folder: Folder,
};

const TYPE_COLORS: Record<string, string> = {
  image: 'bg-pink-500',
  video: 'bg-purple-500',
  audio: 'bg-blue-500',
  application: 'bg-orange-500',
  text: 'bg-green-500',
  folder: 'bg-yellow-500',
  other: 'bg-gray-500',
};

export function StorageBreakdownChart({ data }: StorageBreakdownChartProps) {
  const totalSize = data.byType.reduce((sum, t) => sum + t.size, 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold mb-4">存储分布</h3>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="h-8 rounded-full overflow-hidden flex">
            {data.byType.map((type) => {
              const percent = totalSize > 0 ? (type.size / totalSize) * 100 : 0;
              if (percent < 1) return null;
              return (
                <div
                  key={type.type}
                  className={cn(TYPE_COLORS[type.type] || TYPE_COLORS.other, 'h-full')}
                  style={{ width: `${percent}%` }}
                  title={`${type.type}: ${formatBytes(type.size)} (${percent.toFixed(1)}%)`}
                />
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {data.byType.map((type) => {
              const Icon = TYPE_ICONS[type.type] || File;
              const percent = totalSize > 0 ? (type.size / totalSize) * 100 : 0;
              return (
                <div key={type.type} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className={cn('p-1.5 rounded', TYPE_COLORS[type.type] || TYPE_COLORS.other)}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{type.type}</div>
                    <div className="text-xs text-gray-500">
                      {formatBytes(type.size)} • {type.count} 个
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">{percent.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full md:w-64">
          <h4 className="text-sm font-medium text-gray-500 mb-2">按文件类型</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.byMimeType.slice(0, 10).map((mime) => (
              <div key={mime.mimeType} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-600 dark:text-gray-300" title={mime.mimeType}>
                  {mime.mimeType}
                </span>
                <span className="text-gray-400 ml-2">{formatBytes(mime.size)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
