/**
 * StorageDashboard.tsx
 * 存储分析仪表板
 *
 * 功能:
 * - 存储空间概览
 * - 类型分布统计
 * - 活跃度热力图
 * - 大文件列表
 */

import { useState, useEffect } from 'react';
import { HardDrive, Activity, File, Loader2 } from 'lucide-react';
import { analyticsApi, type StorageBreakdown, type ActivityHeatmap, type LargeFileItem } from '../../services/api';
import { formatBytes, cn } from '../../utils';
import { StorageBreakdownChart } from './StorageBreakdownChart';
import { ActivityHeatmapChart } from './ActivityHeatmapChart';
import { LargeFilesList } from './LargeFilesList';

export function StorageDashboard() {
  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  const [heatmap, setHeatmap] = useState<ActivityHeatmap | null>(null);
  const [largeFiles, setLargeFiles] = useState<LargeFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'files'>('overview');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [breakdownRes, heatmapRes, largeFilesRes] = await Promise.all([
        analyticsApi.getStorageBreakdown(),
        analyticsApi.getActivityHeatmap(30),
        analyticsApi.getLargeFiles(20),
      ]);

      if (breakdownRes.data.success && breakdownRes.data.data) setBreakdown(breakdownRes.data.data);
      if (heatmapRes.data.success && heatmapRes.data.data) setHeatmap(heatmapRes.data.data);
      if (largeFilesRes.data.success && largeFilesRes.data.data) setLargeFiles(largeFilesRes.data.data);
    } catch (err) {
      setError('加载数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          重试
        </button>
      </div>
    );
  }

  const isUnlimited = !breakdown?.quota || breakdown.quota >= 999999 * 1024 ** 3;
  const usagePercent = isUnlimited ? 0 : Math.min(100, (breakdown!.used / breakdown!.quota) * 100);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 sm:gap-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto no-scrollbar">
        {[
          { key: 'overview', label: '概览', icon: HardDrive },
          { key: 'activity', label: '活跃度', icon: Activity },
          { key: 'files', label: '大文件', icon: File },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={cn(
              'flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0',
              activeTab === tab.key
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <tab.icon className="h-4 w-4 flex-shrink-0" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'overview' && breakdown && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-500 mb-1">已使用空间</div>
              <div className="text-2xl font-bold">{formatBytes(breakdown.used)}</div>
              <div className="text-sm text-gray-400">
                / {isUnlimited ? '无限制' : formatBytes(breakdown.quota)}{!isUnlimited && ` (${usagePercent.toFixed(1)}%)`}
              </div>
              {!isUnlimited && (
                <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-500 mb-1">文件数量</div>
              <div className="text-2xl font-bold">{breakdown.totalFiles.toLocaleString()}</div>
              <div className="text-sm text-gray-400">个文件</div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-500 mb-1">文件夹数量</div>
              <div className="text-2xl font-bold">{breakdown.totalFolders.toLocaleString()}</div>
              <div className="text-sm text-gray-400">个文件夹</div>
            </div>
          </div>

          <StorageBreakdownChart data={breakdown} />
        </div>
      )}

      {activeTab === 'activity' && heatmap && <ActivityHeatmapChart data={heatmap} />}

      {activeTab === 'files' && <LargeFilesList files={largeFiles} />}
    </div>
  );
}
