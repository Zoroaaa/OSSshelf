/**
 * SharePage.tsx  — Phase 6
 * 路由 /share/:shareId       → DownloadSharePage（文件/文件夹下载分享）
 * 路由 /upload/:uploadToken  → UploadLinkPage（无账号上传）
 */

import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { shareApi, type ShareChildFile, type UploadLinkInfo } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/ui/FileIcon';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { ShareFilePreview } from '@/components/share/ShareFilePreview';
import {
  Download,
  Lock,
  Clock,
  AlertCircle,
  HardDrive,
  ShieldCheck,
  FolderOpen,
  Archive,
  CheckSquare,
  Square,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  File,
  Eye,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
export default function SharePage() {
  const { shareId, uploadToken } = useParams<{ shareId?: string; uploadToken?: string }>();
  if (uploadToken) return <UploadLinkPage token={uploadToken} />;
  if (shareId) return <DownloadSharePage shareId={shareId} />;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Common shell
// ─────────────────────────────────────────────────────────────────────────────
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
          <HardDrive className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm">OSSshelf</span>
        <span className="text-muted-foreground text-sm ml-1">· {title}</span>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-4">{children}</div>
      </main>
      <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
        Powered by OSSshelf · 多厂商 OSS 文件管理系统
      </footer>
    </div>
  );
}

function PasswordPrompt({ isWrong, onSubmit }: { isWrong: boolean; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <div className="bg-card border rounded-xl p-8 space-y-5">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Lock className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">需要访问密码</h1>
        <p className="text-sm text-muted-foreground">该内容已加密，请输入密码继续</p>
      </div>
      <div className="space-y-3">
        <Input
          type="password"
          placeholder="输入访问密码"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit(pw)}
          autoFocus
        />
        {isWrong && (
          <p className="text-xs text-red-500 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> 密码错误，请重试
          </p>
        )}
        <Button className="w-full" onClick={() => onSubmit(pw)} disabled={!pw.trim()}>
          <ShieldCheck className="h-4 w-4 mr-2" /> 验证密码
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DownloadSharePage
// ─────────────────────────────────────────────────────────────────────────────
function DownloadSharePage({ shareId }: { shareId: string }) {
  const [enteredPw, setEnteredPw] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<{
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['share-public', shareId, enteredPw],
    queryFn: () => shareApi.get(shareId, enteredPw).then((r) => r.data),
    enabled: !!shareId,
    retry: false,
  });

  const share = data?.data;
  const errCode = (error as any)?.response?.data?.error?.code;
  const isExpired = errCode === 'SHARE_EXPIRED';
  const isExhausted = errCode === 'SHARE_DOWNLOAD_LIMIT_EXCEEDED';
  const needsPw = !isExpired && !isExhausted && !share && !isLoading && enteredPw === undefined;
  const wrongPw = !isExpired && !isExhausted && !share && !isLoading && enteredPw !== undefined;

  const isFolder = share?.file?.isFolder ?? false;
  const children: ShareChildFile[] = share?.children ?? [];
  const fileChildren = children.filter((c) => !c.isFolder);
  const allSelected = fileChildren.length > 0 && fileChildren.every((c) => selectedIds.has(c.id));

  const canPreviewFile = (mimeType: string | null) => {
    if (!mimeType) return false;
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      mimeType === 'application/pdf' ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript' ||
      mimeType === 'application/typescript'
    );
  };

  const trigger = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(fileChildren.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  return (
    <Shell title="文件分享">
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>加载中...</p>
        </div>
      )}

      {isExpired && (
        <StatusCard
          icon={<Clock className="h-7 w-7 text-amber-500" />}
          bg="bg-amber-500/10"
          title="链接已过期"
          desc="这个分享链接已超过有效期，无法访问。"
        />
      )}
      {isExhausted && (
        <StatusCard
          icon={<AlertCircle className="h-7 w-7 text-red-500" />}
          bg="bg-red-500/10"
          title="下载次数已达上限"
          desc="该分享链接的下载次数已用完。"
        />
      )}

      {(needsPw || wrongPw) && <PasswordPrompt isWrong={wrongPw} onSubmit={(pw) => setEnteredPw(pw)} />}

      {/* Single file */}
      {share && !isFolder && (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          {share.file?.mimeType?.startsWith('image/') ? (
            <div
              className="bg-muted/30 border-b flex items-center justify-center p-6 min-h-[180px] cursor-pointer"
              onClick={() =>
                setPreviewFile({
                  id: shareId,
                  name: share.file!.name,
                  size: share.file!.size,
                  mimeType: share.file!.mimeType,
                })
              }
            >
              <img
                src={shareApi.previewUrl(shareId, enteredPw)}
                alt={decodeFileName(share.file.name)}
                className="max-h-48 max-w-full object-contain rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          ) : (
            <div className="bg-muted/30 border-b flex items-center justify-center py-10">
              <FileIcon mimeType={share.file?.mimeType} isFolder={false} size="lg" />
            </div>
          )}
          <div className="p-5 space-y-4">
            <div>
              <h1 className="font-semibold text-base break-all">{decodeFileName(share.file?.name)}</h1>
              <ShareMeta share={share} />
            </div>
            <div className="flex gap-2">
              {canPreviewFile(share.file?.mimeType ?? null) && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    setPreviewFile({
                      id: shareId,
                      name: share.file!.name,
                      size: share.file!.size,
                      mimeType: share.file!.mimeType,
                    })
                  }
                >
                  <Eye className="h-4 w-4 mr-2" /> 预览
                </Button>
              )}
              <Button
                className={canPreviewFile(share.file?.mimeType ?? null) ? 'flex-1' : 'w-full'}
                onClick={() => trigger(shareApi.downloadUrl(shareId, enteredPw), share.file!.name)}
              >
                <Download className="h-4 w-4 mr-2" /> 下载
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Folder */}
      {share && isFolder && (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <div className="p-5 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="h-5 w-5 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-semibold text-base break-all">{decodeFileName(share.file?.name)}</h1>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  <span>{children.length} 个项目</span>
                  <ShareMeta share={share} inline />
                </div>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          {fileChildren.length > 0 && (
            <div className="px-5 py-2.5 border-b bg-muted/20 flex items-center justify-between gap-3 flex-wrap">
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {allSelected ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {allSelected ? '取消全选' : '全选'}
                {selectedIds.size > 0 && <span className="text-primary font-medium">（已选 {selectedIds.size}）</span>}
              </button>
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      trigger(shareApi.zipUrl(shareId, enteredPw, [...selectedIds]), `${share.file!.name}.zip`)
                    }
                  >
                    <Archive className="h-3 w-3" /> 下载所选 ({selectedIds.size})
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => trigger(shareApi.zipUrl(shareId, enteredPw), `${share.file!.name}.zip`)}
                >
                  <Archive className="h-3.5 w-3.5" /> 全部 ZIP
                </Button>
              </div>
            </div>
          )}

          {/* List */}
          {children.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">文件夹为空</div>
          ) : (
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {children.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors group"
                >
                  {!child.isFolder ? (
                    <button
                      onClick={() => toggleOne(child.id)}
                      className="flex-shrink-0 text-muted-foreground hover:text-primary"
                    >
                      {selectedIds.has(child.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <div className="w-4 flex-shrink-0" />
                  )}

                  <FileIcon mimeType={child.mimeType} isFolder={child.isFolder} size="sm" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate font-medium">{decodeFileName(child.name)}</p>
                    <p className="text-xs text-muted-foreground">
                      {child.isFolder ? '文件夹' : formatBytes(child.size)}
                      <span className="mx-1.5">·</span>
                      {formatDate(child.updatedAt)}
                    </p>
                  </div>

                  {!child.isFolder && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canPreviewFile(child.mimeType) && (
                        <button
                          onClick={() =>
                            setPreviewFile({
                              id: child.id,
                              name: child.name,
                              size: child.size,
                              mimeType: child.mimeType,
                            })
                          }
                          className="flex-shrink-0 p-1.5 rounded hover:bg-accent"
                          title="预览"
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                      <button
                        onClick={() => trigger(shareApi.childDownloadUrl(shareId, child.id, enteredPw), child.name)}
                        className="flex-shrink-0 p-1.5 rounded hover:bg-accent"
                        title="下载"
                      >
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {previewFile && (
        <ShareFilePreview
          shareId={shareId}
          file={previewFile}
          password={enteredPw}
          isChildFile={previewFile.id !== shareId}
          onClose={() => setPreviewFile(null)}
          onDownload={() => {
            if (previewFile.id === shareId) {
              trigger(shareApi.downloadUrl(shareId, enteredPw), previewFile.name);
            } else {
              trigger(shareApi.childDownloadUrl(shareId, previewFile.id, enteredPw), previewFile.name);
            }
          }}
        />
      )}
    </Shell>
  );
}

function StatusCard({ icon, bg, title, desc }: { icon: React.ReactNode; bg: string; title: string; desc: string }) {
  return (
    <div className="bg-card border rounded-xl p-8 text-center space-y-4">
      <div className={`w-14 h-14 rounded-full ${bg} flex items-center justify-center mx-auto`}>{icon}</div>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      </div>
    </div>
  );
}

function ShareMeta({ share, inline = false }: { share: any; inline?: boolean }) {
  const items = [
    share.file?.size != null && !share.file.isFolder && formatBytes(share.file.size),
    share.expiresAt && `过期 ${formatDate(share.expiresAt)}`,
    share.downloadLimit != null && `剩余 ${Math.max(0, share.downloadLimit - share.downloadCount)} 次`,
    share.hasPassword && '已加密',
  ].filter(Boolean);

  if (inline)
    return (
      <>
        {items.map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </>
    );

  return (
    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
      {items.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UploadLinkPage
// ─────────────────────────────────────────────────────────────────────────────
interface UploadEntry {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

function UploadLinkPage({ token }: { token: string }) {
  const [enteredPw, setEnteredPw] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['upload-link', token, enteredPw],
    queryFn: () => shareApi.getUploadLink(token, enteredPw).then((r) => r.data),
    enabled: !!token,
    retry: false,
  });

  const linkInfo: UploadLinkInfo | undefined = data?.data;
  const errCode = (error as any)?.response?.data?.error?.code;
  const isExpired = errCode === 'SHARE_EXPIRED';
  const needsPw = !isExpired && !linkInfo && !isLoading && enteredPw === undefined;
  const wrongPw = !isExpired && !linkInfo && !isLoading && enteredPw !== undefined;

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    setEntries((prev) => [
      ...prev,
      ...arr
        .filter((f) => !prev.some((e) => e.file.name === f.name && e.file.size === f.size))
        .map((f) => ({ file: f, status: 'pending' as const, progress: 0 })),
    ]);
  };

  const handleUploadAll = async () => {
    if (entries.every((e) => e.status !== 'pending')) return;
    setIsUploading(true);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || entry.status !== 'pending') continue;
      setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'uploading' } : e)));
      try {
        await shareApi.uploadViaLink(token, entry.file, enteredPw, (pct) => {
          setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, progress: pct } : e)));
        });
        setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'done', progress: 100 } : e)));
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message ?? err?.message ?? '上传失败';
        setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'error', error: msg } : e)));
      }
    }
    setIsUploading(false);
  };

  const pendingCount = entries.filter((e) => e.status === 'pending').length;
  const doneCount = entries.filter((e) => e.status === 'done').length;

  return (
    <Shell title="文件上传">
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>加载中...</p>
        </div>
      )}
      {isExpired && (
        <StatusCard
          icon={<Clock className="h-7 w-7 text-amber-500" />}
          bg="bg-amber-500/10"
          title="链接已过期"
          desc="这个上传链接已超过有效期，无法访问。"
        />
      )}
      {(needsPw || wrongPw) && <PasswordPrompt isWrong={wrongPw} onSubmit={(pw) => setEnteredPw(pw)} />}

      {linkInfo && (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="p-5 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">上传到：{linkInfo.folderName}</p>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  <span>最大 {formatBytes(linkInfo.maxUploadSize)}</span>
                  {linkInfo.maxUploadCount != null && (
                    <span>剩余 {Math.max(0, linkInfo.maxUploadCount - linkInfo.uploadCount)} 次</span>
                  )}
                  {linkInfo.expiresAt && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> 过期 {formatDate(linkInfo.expiresAt)}
                    </span>
                  )}
                  {linkInfo.allowedMimeTypes?.length && <span>限 {linkInfo.allowedMimeTypes.join(', ')}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            className="p-5 border-b"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            <button
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
              className="w-full rounded-lg border-2 border-dashed border-border hover:border-primary/60 transition-colors py-8 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <File className="h-7 w-7 opacity-40" />
              <span className="text-sm font-medium">点击或拖放文件到此处</span>
              <span className="text-xs opacity-60">支持多文件同时上传</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {/* Queue */}
          {entries.length > 0 && (
            <div className="divide-y max-h-64 overflow-y-auto">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-shrink-0 w-4">
                    {entry.status === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {entry.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                    {entry.status === 'uploading' && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                    {entry.status === 'pending' && <File className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{decodeFileName(entry.file.name)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground">{formatBytes(entry.file.size)}</p>
                      {entry.status === 'uploading' && (
                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${entry.progress}%` }}
                          />
                        </div>
                      )}
                      {entry.status === 'error' && <p className="text-xs text-red-500 truncate">{entry.error}</p>}
                      {entry.status === 'done' && <p className="text-xs text-emerald-500">上传成功</p>}
                    </div>
                  </div>
                  {entry.status === 'pending' && !isUploading && (
                    <button
                      onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}
                      className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="p-5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {entries.length === 0
                ? '尚未选择文件'
                : `${doneCount > 0 ? `${doneCount} 个已完成` : ''}${pendingCount > 0 ? `${doneCount > 0 ? '，' : ''}${pendingCount} 个待上传` : ''}`}
            </p>
            <Button onClick={handleUploadAll} disabled={pendingCount === 0 || isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 上传中...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" /> 开始上传{pendingCount > 0 && ` (${pendingCount})`}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </Shell>
  );
}
