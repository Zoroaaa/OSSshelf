/**
 * SharePage.tsx
 * 公开分享页面
 *
 * 功能:
 * - 访问分享链接
 * - 密码验证
 * - 预览分享文件
 * - 下载分享文件
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { shareApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/ui/FileIcon';
import { formatBytes, formatDate } from '@/utils';
import { Download, Lock, Clock, AlertCircle, HardDrive, ShieldCheck } from 'lucide-react';

export default function SharePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [password, setPassword] = useState('');
  const [enteredPassword, setEnteredPassword] = useState<string | undefined>(undefined);

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ['share-public', shareId, enteredPassword],
    queryFn: () => shareApi.get(shareId!, enteredPassword).then((r) => r.data),
    enabled: !!shareId,
    retry: false,
  });

  const share = data?.data as any;
  const errorCode = (error as any)?.response?.data?.error?.code;
  const isExpired = errorCode === 'SHARE_EXPIRED';
  const isExhausted = errorCode === 'SHARE_DOWNLOAD_LIMIT_EXCEEDED';

  const downloadUrl = shareApi.downloadUrl(shareId!, enteredPassword);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = share?.file?.name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePasswordSubmit = () => {
    setEnteredPassword(password);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal header */}
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
          <HardDrive className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm">OSSshelf</span>
        <span className="text-muted-foreground text-sm ml-1">· 文件分享</span>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          {/* Loading */}
          {isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>加载中...</p>
            </div>
          )}

          {/* Expired */}
          {isExpired && (
            <div className="bg-card border rounded-xl p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
                <Clock className="h-7 w-7 text-amber-500" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">链接已过期</h1>
                <p className="text-sm text-muted-foreground mt-1">这个分享链接已超过有效期，无法访问。</p>
              </div>
            </div>
          )}

          {/* Exhausted */}
          {isExhausted && (
            <div className="bg-card border rounded-xl p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">下载次数已达上限</h1>
                <p className="text-sm text-muted-foreground mt-1">该分享链接的下载次数已用完。</p>
              </div>
            </div>
          )}

          {/* Password prompt */}
          {!isExpired && !isExhausted && !share && !isLoading && (
            <div className="bg-card border rounded-xl p-8 space-y-5">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Lock className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-lg font-semibold">需要访问密码</h1>
                <p className="text-sm text-muted-foreground">该文件已加密，请输入密码继续</p>
              </div>
              <div className="space-y-3">
                <Input
                  type="password"
                  placeholder="输入访问密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                  autoFocus
                />
                {isError && enteredPassword !== undefined && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    密码错误，请重试
                  </p>
                )}
                <Button className="w-full" onClick={handlePasswordSubmit} disabled={!password.trim()}>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  验证密码
                </Button>
              </div>
            </div>
          )}

          {/* File card */}
          {share && (
            <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
              {/* Preview area for images */}
              {share.file?.mimeType?.startsWith('image/') && (
                <div className="bg-muted/30 border-b flex items-center justify-center p-6 min-h-[180px]">
                  <img
                    src={`/api/share/${shareId}/preview${enteredPassword ? `?password=${encodeURIComponent(enteredPassword)}` : ''}`}
                    alt={share.file.name}
                    className="max-h-48 max-w-full object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}

              {/* Non-image icon area */}
              {!share.file?.mimeType?.startsWith('image/') && (
                <div className="bg-muted/30 border-b flex items-center justify-center py-10">
                  <FileIcon mimeType={share.file?.mimeType} isFolder={false} size="lg" />
                </div>
              )}

              {/* File info */}
              <div className="p-5 space-y-4">
                <div>
                  <h1 className="font-semibold text-base break-all">{share.file?.name}</h1>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    {share.file?.size != null && <span>{formatBytes(share.file.size)}</span>}
                    {share.expiresAt && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        过期 {formatDate(share.expiresAt)}
                      </span>
                    )}
                    {share.downloadLimit != null && (
                      <span className="flex items-center gap-0.5">
                        <Download className="h-3 w-3" />
                        剩余 {Math.max(0, share.downloadLimit - share.downloadCount)} 次
                      </span>
                    )}
                    {share.hasPassword && (
                      <span className="flex items-center gap-0.5">
                        <Lock className="h-3 w-3" />
                        已加密
                      </span>
                    )}
                  </div>
                </div>

                <Button className="w-full" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  下载文件
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
        Powered by OSSshelf · 多厂商 OSS 文件管理系统
      </footer>
    </div>
  );
}
