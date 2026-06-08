/**
 * DirectLinkDialog.tsx
 * 直链管理对话框组件
 *
 * 功能:
 * - 创建/删除文件直链
 * - 设置有效期或永久有效
 * - 复制直链URL
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Link, Copy, Trash2, RefreshCw, ExternalLink, Check, Infinity, Eye, Code, Lightbulb } from 'lucide-react';
import { directLinkApi, type DirectLinkInfo } from '@/services/api';
import { decodeFileName } from '@/utils';

interface DirectLinkDialogProps {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

export function DirectLinkDialog({ fileId, fileName, onClose }: DirectLinkDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [directLink, setDirectLink] = useState<DirectLinkInfo | null>(null);
  const [expiresDays, setExpiresDays] = useState<number | ''>(7);
  const [isPermanent, setIsPermanent] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadDirectLink();
  }, [fileId]);

  const loadDirectLink = async () => {
    setIsLoading(true);
    try {
      const res = await directLinkApi.get(fileId);
      if (res.data.success) {
        setDirectLink(res.data.data ?? null);
        if (res.data.data) {
          if (res.data.data.isPermanent) {
            setIsPermanent(true);
            setExpiresDays('');
          } else if (res.data.data.expiresAt) {
            const days = Math.ceil((new Date(res.data.data.expiresAt).getTime() - Date.now()) / 86400000);
            setExpiresDays(days > 0 ? days : '');
            setIsPermanent(false);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load direct link:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsPending(true);
    try {
      const expiresAt = isPermanent
        ? null
        : expiresDays
          ? new Date(Date.now() + Number(expiresDays) * 86400000).toISOString()
          : undefined;
      const res = await directLinkApi.create(fileId, expiresAt);
      if (res.data.success && res.data.data) {
        setDirectLink(res.data.data);
      }
    } catch (e) {
      console.error('Failed to create direct link:', e);
    } finally {
      setIsPending(false);
    }
  };

  const handleUpdate = async () => {
    if (!directLink) return;
    setIsPending(true);
    try {
      const expiresAt = isPermanent
        ? null
        : expiresDays
          ? new Date(Date.now() + Number(expiresDays) * 86400000).toISOString()
          : undefined;
      const res = await directLinkApi.update(fileId, expiresAt);
      if (res.data.success && res.data.data) {
        setDirectLink(res.data.data);
      }
    } catch (e) {
      console.error('Failed to update direct link:', e);
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async () => {
    if (!directLink) return;
    if (!confirm('确定要删除此直链吗？删除后该链接将立即失效。')) return;
    setIsPending(true);
    try {
      await directLinkApi.delete(fileId);
      setDirectLink(null);
      setIsPermanent(false);
      setExpiresDays(7);
    } catch (e) {
      console.error('Failed to delete direct link:', e);
    } finally {
      setIsPending(false);
    }
  };

  const handleCopy = async () => {
    if (!directLink?.directUrl) return;
    try {
      await navigator.clipboard.writeText(directLink.directUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '永久有效';
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Link className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">文件直链</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-4 break-all">
          文件：<span className="font-medium text-foreground">{decodeFileName(fileName)}</span>
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : directLink ? (
          <div className="space-y-4">
            {/* 1️⃣ 下载链接（原有） */}
            <div className="bg-muted/50 rounded-lg p-3 border">
              <label className="flex items-center gap-2 text-xs font-medium mb-2">
                ⬇️ 下载链接
                <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">直接下载</span>
              </label>
              <div className="flex items-center gap-2">
                <Input readOnly value={directLink.directUrl} className="text-xs font-mono flex-1" />
                <Button size="icon" variant="outline" onClick={handleCopy} title="复制链接">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => window.open(directLink.directUrl, '_blank')}
                  title="在新窗口打开"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 2️⃣ 预览链接（新增） */}
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10 p-3">
              <label className="flex items-center gap-2 text-xs font-medium mb-1.5">
                <Eye className="h-3.5 w-3.5 text-blue-600" />
                预览链接
                <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded font-normal">
                  无需登录
                </span>
              </label>
              <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                用于在线预览文件（支持图片/PDF/视频/音频等格式），可直接在浏览器打开或嵌入iframe
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={directLinkApi.previewUrl(directLink.token)}
                  className="text-xs font-mono flex-1 bg-white dark:bg-slate-800"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(directLinkApi.previewUrl(directLink.token), '预览链接')}
                  title="复制预览链接"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  asChild
                >
                  <a href={directLinkApi.previewUrl(directLink.token)} target="_blank" rel="noopener noreferrer" title="在新窗口预览">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>

            {/* 3️⃣ 信息接口（新增） */}
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10 p-3">
              <label className="flex items-center gap-2 text-xs font-medium mb-1.5">
                <Code className="h-3.5 w-3.5 text-green-600" />
                信息接口
                <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300 px-1.5 py-0.5 rounded font-normal">
                  API调用
                </span>
              </label>
              <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                返回JSON格式的文件元信息（名称、大小、类型、创建时间等），供第三方应用通过API获取
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={directLinkApi.infoUrl(directLink.token)}
                  className="text-xs font-mono flex-1 bg-white dark:bg-slate-800"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(directLinkApi.infoUrl(directLink.token), '信息接口地址')}
                  title="复制信息接口地址"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full mt-2.5"
                asChild
              >
                <a href={directLinkApi.infoUrl(directLink.token)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  测试接口返回结果
                </a>
              </Button>
            </div>

            {/* 💡 使用场景说明卡片 */}
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10 p-3">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-xs font-semibold mb-1.5">💡 使用场景说明</h4>
                  <ul className="text-[11px] space-y-1 text-muted-foreground leading-relaxed">
                    <li>• <strong className="text-foreground">下载链接</strong>: 分享给他人直接下载文件</li>
                    <li>• <strong className="text-foreground">预览链接</strong>: 嵌入到网页iframe或直接在浏览器打开在线预览</li>
                    <li>• <strong className="text-foreground">信息接口</strong>: 第三方应用/脚本通过HTTP请求获取文件元信息（无需认证）</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 过期时间设置 */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>过期时间：</span>
              {directLink.isPermanent ? (
                <span className="flex items-center gap-1 text-green-600 font-medium">
                  <Infinity className="h-3 w-3" />
                  永久有效
                </span>
              ) : (
                <span>{formatDate(directLink.expiresAt)}</span>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="permanent"
                  checked={isPermanent}
                  onChange={(e) => setIsPermanent(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="permanent" className="text-sm font-medium flex items-center gap-1">
                  <Infinity className="h-3 w-3" />
                  永久有效
                </label>
              </div>

              {!isPermanent && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">延长有效期（天）</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      placeholder="输入天数"
                      value={expiresDays}
                      onChange={(e) => setExpiresDays(e.target.value ? Number(e.target.value) : '')}
                      className="flex-1"
                    />
                    <Button onClick={handleUpdate} disabled={isPending || !expiresDays}>
                      {isPending ? '更新中...' : '更新'}
                    </Button>
                  </div>
                </div>
              )}

              {isPermanent && (
                <Button onClick={handleUpdate} disabled={isPending} className="w-full">
                  {isPending ? '更新中...' : '设为永久有效'}
                </Button>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
                <Trash2 className="h-4 w-4 mr-2" />
                删除直链
              </Button>
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">创建直链后，任何人都可以通过该链接直接下载文件，无需登录。</p>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="permanent-new"
                  checked={isPermanent}
                  onChange={(e) => setIsPermanent(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="permanent-new" className="text-sm font-medium flex items-center gap-1">
                  <Infinity className="h-3 w-3" />
                  永久有效
                </label>
              </div>

              {!isPermanent && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">有效期（天）</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="默认 7 天"
                    value={expiresDays}
                    onChange={(e) => setExpiresDays(e.target.value ? Number(e.target.value) : '')}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? '创建中...' : '创建直链'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
