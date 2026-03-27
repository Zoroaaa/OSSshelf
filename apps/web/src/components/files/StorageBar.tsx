import { formatBytes } from '@/utils';
import { cn } from '@/utils';

interface StorageBarProps {
  used: number;
  quota: number;
  className?: string;
}

export function StorageBar({ used, quota, className }: StorageBarProps) {
  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const barColor = percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>存储空间</span>
        <span>{percent.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatBytes(used)} / {formatBytes(quota)}
      </p>
    </div>
  );
}
