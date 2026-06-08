import { formatBytes } from '@/utils';
import { cn } from '@/utils';

interface StorageBarProps {
  used: number;
  quota: number;
  className?: string;
}

export function StorageBar({ used, quota, className }: StorageBarProps) {
  const isUnlimited = !quota || quota >= 999999 * 1024 ** 3;
  const percent = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
  const barColor = percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>存储空间</span>
        <span>{isUnlimited ? '∞' : `${percent.toFixed(0)}%`}</span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-300', barColor)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {formatBytes(used)} / {isUnlimited ? '无限制' : formatBytes(quota)}
      </p>
    </div>
  );
}
