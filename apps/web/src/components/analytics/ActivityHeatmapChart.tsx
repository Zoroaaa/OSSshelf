/**
 * ActivityHeatmapChart.tsx
 * 活跃度热力图
 */

import type { ActivityHeatmap } from '../../services/api';
import { cn } from '../../utils';

interface ActivityHeatmapChartProps {
  data: ActivityHeatmap;
}

export function ActivityHeatmapChart({ data }: ActivityHeatmapChartProps) {
  const maxActivity = Math.max(...data.heatmap.map((d) => d.uploads + d.downloads + d.deletes), 1);

  const getIntensity = (value: number) => {
    const ratio = value / maxActivity;
    if (ratio === 0) return 'bg-gray-100 dark:bg-gray-800';
    if (ratio < 0.25) return 'bg-green-200 dark:bg-green-900';
    if (ratio < 0.5) return 'bg-green-400 dark:bg-green-700';
    if (ratio < 0.75) return 'bg-green-600 dark:bg-green-500';
    return 'bg-green-800 dark:bg-green-400';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">活跃度热力图</h3>
        <span className="text-sm text-gray-500">过去 {data.days} 天</span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.summary.totalUploads}</div>
          <div className="text-sm text-gray-500">上传</div>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded-lg">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{data.summary.totalDownloads}</div>
          <div className="text-sm text-gray-500">下载</div>
        </div>
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded-lg">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{data.summary.totalDeletes}</div>
          <div className="text-sm text-gray-500">删除</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {data.heatmap.map((day) => {
            const total = day.uploads + day.downloads + day.deletes;
            const date = new Date(day.date);
            const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

            return (
              <div
                key={day.date}
                className="flex flex-col items-center"
                title={`${dateStr}: 上传 ${day.uploads}, 下载 ${day.downloads}, 删除 ${day.deletes}`}
              >
                <div
                  className={cn(
                    'w-3 h-3 rounded-sm cursor-pointer transition-transform hover:scale-125',
                    getIntensity(total)
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 text-xs text-gray-500">
        <span>少</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-sm bg-gray-100 dark:bg-gray-800" />
          <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900" />
          <div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700" />
          <div className="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500" />
          <div className="w-3 h-3 rounded-sm bg-green-800 dark:bg-green-400" />
        </div>
        <span>多</span>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-500 mb-2">最近活动</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {data.heatmap
            .filter((d) => d.uploads > 0 || d.downloads > 0 || d.deletes > 0)
            .slice(-10)
            .reverse()
            .map((day) => (
              <div key={day.date} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">
                  {new Date(day.date).toLocaleDateString('zh-CN')}
                </span>
                <div className="flex gap-3 text-xs">
                  {day.uploads > 0 && <span className="text-blue-500">↑ {day.uploads}</span>}
                  {day.downloads > 0 && <span className="text-green-500">↓ {day.downloads}</span>}
                  {day.deletes > 0 && <span className="text-red-500">× {day.deletes}</span>}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
