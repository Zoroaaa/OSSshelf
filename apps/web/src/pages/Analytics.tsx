/**
 * Analytics.tsx
 * 存储分析页面
 */

import { StorageDashboard } from '@/components/analytics';

export default function Analytics() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">存储分析</h1>
        <p className="text-muted-foreground text-sm mt-0.5">存储空间使用情况与文件活动统计</p>
      </div>
      <StorageDashboard />
    </div>
  );
}
