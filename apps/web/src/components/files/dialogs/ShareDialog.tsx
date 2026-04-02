/**
 * ShareDialog.tsx — Phase 6 更新
 * 支持：下载分享 + 上传链接两种模式
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Link2, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { decodeFileName } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Download share dialog (original, extended)
// ─────────────────────────────────────────────────────────────────────────────
interface ShareDialogProps {
  fileId: string;
  isFolder?: boolean;
  isPending: boolean;
  onConfirm: (params: { password?: string; expiresAt?: string; downloadLimit?: number }) => void;
  onCancel: () => void;
}

export function ShareDialog({ fileId: _fileId, isFolder, isPending, onConfirm, onCancel }: ShareDialogProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">创建下载分享{isFolder ? '（文件夹）' : ''}</h2>
        </div>
        {isFolder && (
          <p className="text-xs text-muted-foreground mb-4 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg px-3 py-2">
            文件夹分享支持子文件列表浏览和 ZIP 打包下载
          </p>
        )}
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
              placeholder="留空则使用默认（7天）"
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

// ─────────────────────────────────────────────────────────────────────────────
// Upload link dialog (new)
// ─────────────────────────────────────────────────────────────────────────────
interface UploadLinkDialogProps {
  folderId: string;
  folderName: string;
  isPending: boolean;
  onConfirm: (params: {
    password?: string;
    expiresAt?: string;
    maxUploadSize?: number;
    allowedMimeTypes?: string[];
    maxUploadCount?: number;
  }) => void;
  onCancel: () => void;
}

export function UploadLinkDialog({
  folderId: _folderId,
  folderName,
  isPending,
  onConfirm,
  onCancel,
}: UploadLinkDialogProps) {
  const [password, setPassword] = useState('');
  const [expiresDays, setExpiresDays] = useState<number | ''>('');
  const [maxSizeMb, setMaxSizeMb] = useState<number | ''>('');
  const [maxCount, setMaxCount] = useState<number | ''>('');
  const [mimeInput, setMimeInput] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const handleConfirm = () => {
    const expiresAt = expiresDays ? new Date(Date.now() + Number(expiresDays) * 86400000).toISOString() : undefined;
    const allowedMimeTypes = mimeInput.trim()
      ? mimeInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    onConfirm({
      password: password || undefined,
      expiresAt,
      maxUploadSize: maxSizeMb ? Number(maxSizeMb) * 1024 * 1024 : undefined,
      allowedMimeTypes,
      maxUploadCount: maxCount ? Number(maxCount) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <Upload className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">创建上传链接</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          目标文件夹：<span className="font-medium text-foreground">{decodeFileName(folderName)}</span>
          <br />
          生成的链接允许任何人无需登录即可上传文件到此文件夹
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">访问密码（可选）</label>
            <Input placeholder="留空则无需密码" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">有效天数（可选）</label>
            <Input
              type="number"
              min={1}
              placeholder="留空则使用默认（7天）"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value ? Number(e.target.value) : '')}
            />
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setAdvanced(!advanced)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {advanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            高级设置
          </button>

          {advanced && (
            <div className="space-y-3 pt-1 pl-3 border-l-2 border-border">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">单文件大小上限（MB，可选）</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="留空则继承系统上限"
                  value={maxSizeMb}
                  onChange={(e) => setMaxSizeMb(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">最多上传文件数（可选）</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="留空则不限"
                  value={maxCount}
                  onChange={(e) => setMaxCount(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">允许的文件类型（可选）</label>
                <Input
                  placeholder="如 image/*,video/mp4（逗号分隔）"
                  value={mimeInput}
                  onChange={(e) => setMimeInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">留空则继承文件夹类型限制</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? '创建中...' : '创建上传链接'}
          </Button>
        </div>
      </div>
    </div>
  );
}
