/**
 * StatsCard.tsx
 * 统计信息卡片组件
 *
 * 功能:
 * - 展示文件统计信息
 * - 支持自定义操作按钮
 */

import type { ReactNode } from 'react';

interface StatItem {
  label: string;
  count: number;
  color?: string;
}

interface StatsCardProps {
  title: string;
  icon: ReactNode;
  total: number;
  items: StatItem[];
  actionButton?: ReactNode;
}

export function StatsCard({ title, icon, total, items, actionButton }: StatsCardProps) {
  return (
    <div className="border rounded-lg p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h4 className="font-medium text-sm sm:text-base truncate">{title}</h4>
        </div>
        <span className="text-xl sm:text-2xl font-bold flex-shrink-0">{total}</span>
      </div>

      <div className="space-y-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground truncate mr-2">{item.label}</span>
            <span className={`font-medium flex-shrink-0 ${item.color || ''}`}>{item.count}</span>
          </div>
        ))}
      </div>

      {actionButton}
    </div>
  );
}
