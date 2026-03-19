/**
 * ShareDialog.tsx
 * 创建分享链接对话框组件
 *
 * 功能:
 * - 设置访问密码
 * - 设置有效期
 * - 设置下载次数限制
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ShareDialogProps {
  fileId: string;
  isPending: boolean;
  onConfirm: (params: { password?: string; expiresAt?: string; downloadLimit?: number }) => void;
  onCancel: () => void;
}

export function ShareDialog({ fileId: _fileId, isPending, onConfirm, onCancel }: ShareDialogProps) {
  const [password, setPassword] = useState('');
  const [expiresDays, setExpiresDays] = useState<number | ''>('');
  const [downloadLimit, setDownloadLimit] = useState<number | ''>('');

  const handleConfirm = () => {
    const expiresAt = expiresDays ? new Date(Date.now() + Number(expiresDays) * 86400000).toISOString() : undefined;
    onConfirm({
      password: password || undefined,
      expiresAt,
      downloadLimit: downloadLimit ? Number(downloadLimit) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-4">创建分享链接</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">访问密码（可选）</label>
            <Input placeholder="留空则不设密码" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">有效天数（可选）</label>
            <Input
              type="number"
              min={1}
              placeholder="留空则使用默认"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value ? Number(e.target.value) : '')}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">下载次数限制（可选）</label>
            <Input
              type="number"
              min={1}
              placeholder="留空则不限次数"
              value={downloadLimit}
              onChange={(e) => setDownloadLimit(e.target.value ? Number(e.target.value) : '')}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? '创建中...' : '创建并复制链接'}
          </Button>
        </div>
      </div>
    </div>
  );
}
