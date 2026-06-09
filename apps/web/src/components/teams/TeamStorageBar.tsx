/**
 * TeamStorageBar.tsx — 团队存储用量可视化
 */

import React from 'react';
import { HardDrive } from 'lucide-react';
import { cn, formatBytes } from '@/utils';
import type { TeamStorageStats } from '@/services/collab';

interface TeamStorageBarProps {
  stats: TeamStorageStats;
}

const TeamStorageBar: React.FC<TeamStorageBarProps> = ({ stats }) => {
  const { storageQuota, storageUsed, usagePercent, fileCount } = stats;
  const barColor = usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 font-medium">
          <HardDrive className="h-4 w-4" /> 团队存储空间
        </div>
        <span className="text-muted-foreground">
          {formatBytes(storageUsed)} / {formatBytes(storageQuota)}
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${Math.min(usagePercent, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>已用 {usagePercent}%</span>
        <span>{fileCount} 个资源</span>
      </div>
    </div>
  );
};

export default TeamStorageBar;
