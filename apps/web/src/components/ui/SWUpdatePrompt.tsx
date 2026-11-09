/**
 * SWUpdatePrompt.tsx
 * Service Worker 新版本就绪提示
 *
 * main.tsx 检测到新版本接管后派发 `ossshelf:sw-update` 事件，
 * 这里展示提示条，由用户确认后刷新页面加载新代码。
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export const SW_UPDATE_EVENT = 'ossshelf:sw-update';

export function SWUpdatePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setVisible(true);
    window.addEventListener(SW_UPDATE_EVENT, handleUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, handleUpdate);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium">新版本已就绪</p>
      <p className="mt-1 text-xs text-muted-foreground">刷新页面即可使用最新版本。</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setVisible(false)}>
          稍后
        </Button>
        <Button size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          刷新
        </Button>
      </div>
    </div>
  );
}
