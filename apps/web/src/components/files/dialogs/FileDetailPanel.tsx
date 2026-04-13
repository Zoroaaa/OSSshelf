/**
 * FileDetailPanel.tsx
 * 文件/文件夹详情面板组件
 *
 * 功能:
 * - 展示文件/文件夹的完整元信息
 * - 桌面端居中弹窗，移动端底部弹出
 * - 分区显示基础信息、存储信息、AI 信息、分享状态等
 */

import { useState, useEffect } from 'react';
import type { FileItem } from '@osshelf/shared';
import { MobileDialog } from '@/components/ui/MobileDialog';
import { Button } from '@/components/ui/Button';
import {
  Copy,
  Check,
  Folder,
  FileText,
  Tag,
  Brain,
  Share2,
  HardDrive,
  Clock,
  Hash,
  Info,
  Database,
  ArrowRightLeft,
} from 'lucide-react';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { filesApi, bucketsApi } from '@/services/api';
import { useQuery } from '@tanstack/react-query';

interface FileDetailPanelProps {
  file: FileItem;
  onClose: () => void;
}

interface FileDetailData {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string | null;
  isFolder: boolean;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  bucketId: string | null;
  bucketName: string | null;
  r2Key: string | null;
  currentVersion: number;
  maxVersions: number;
  versionRetentionDays: number;
  aiSummary: string | null;
  aiTags: string[];
  vectorIndexedAt: string | null;
  aiSummaryAt: string | null;
  aiTagsAt: string | null;
  activeShareCount: number;
  childFileCount?: number;
  childFolderCount?: number;
  totalFileCount?: number;
  totalSize?: number;
}

export function FileDetailPanel({ file, onClose }: FileDetailPanelProps) {
  const [detail, setDetail] = useState<FileDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [changingBucket, setChangingBucket] = useState(false);
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);

  const { data: bucketsData } = useQuery({
    queryKey: ['buckets-for-change'],
    queryFn: async () => {
      try {
        const res = await bucketsApi.list();
        return (res.data?.data as Array<{ id: string; name: string }>) || [];
      } catch {
        return [];
      }
    },
    enabled: file.isFolder,
  });

  useEffect(() => {
    loadDetail();
  }, [file.id]);

  const loadDetail = async () => {
    try {
      setLoading(true);
      const res = await filesApi.getFileDetail(file.id);
      if (res.data.success && res.data.data) {
        setDetail(res.data.data);
      }
    } catch (error) {
      console.error('加载文件详情失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleChangeBucket = async (targetBucketId: string) => {
    if (!detail) return;
    setChangingBucket(true);
    try {
      const res = await filesApi.changeFolderBucket(detail.id, targetBucketId);
      if (res.data.success) {
        loadDetail();
        setSelectedBucketId(null);
      }
    } catch (error) {
      console.error('更改存储桶失败:', error);
    } finally {
      setChangingBucket(false);
    }
  };

  return (
    <MobileDialog open={true} onClose={onClose} title="文件详情" mode="sheet" className="sm:max-w-lg">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : detail ? (
        <div className="space-y-6 mt-4 overflow-y-auto max-h-[calc(80vh-8rem)] pr-1">
          {/* 基础信息 */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" />
              基础信息
            </h3>
            <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
              <DetailRow label="文件名" value={detail.name} mono />
              <DetailRow label="类型" value={detail.mimeType || (detail.isFolder ? '文件夹' : '未知')} />
              <DetailRow label="大小" value={formatBytes(detail.size)} />
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">路径</span>
                <div className="flex items-center gap-1 max-w-[60%]">
                  <span className="font-mono text-xs truncate">{detail.path || '/'}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => copyToClipboard(detail.path || '/', 'path')}
                  >
                    {copiedField === 'path' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <DetailRow label="创建时间" value={formatDate(detail.createdAt)} />
              <DetailRow label="更新时间" value={formatDate(detail.updatedAt)} />
              {detail.description && <DetailRow label="描述" value={detail.description} />}
            </div>
          </section>

          {/* 存储信息 */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              存储信息
            </h3>
            <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">存储桶</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-xs">{detail.bucketName || '-'}</span>
                  {detail.isFolder && bucketsData && bucketsData.length >= 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => setSelectedBucketId(selectedBucketId === detail.bucketId ? null : detail.bucketId)}
                      title="更改存储桶"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* 更改存储桶选择器 */}
              {detail.isFolder && selectedBucketId !== null && bucketsData && bucketsData.length >= 1 && (
                <div className="pt-2 border-t space-y-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    选择新存储桶（子文件夹将级联更新）
                  </p>
                  {bucketsData.length <= 1 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      当前仅有 1 个存储桶，请先创建更多存储桶后再更改。
                    </p>
                  ) : (
                    <select
                      className="w-full h-8 px-2 text-xs border rounded-lg bg-background"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleChangeBucket(e.target.value);
                      }}
                    >
                      <option value="" disabled>
                        请选择目标存储桶...
                      </option>
                      {bucketsData
                        .filter((b) => b.id !== detail.bucketId)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {changingBucket && (
                    <div className="flex items-center gap-1.5 text-xs text-primary">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-primary" />
                      正在更新...
                    </div>
                  )}
                </div>
              )}
              {detail.r2Key && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground">R2 Key</span>
                  <div className="flex items-center gap-1 max-w-[60%]">
                    <span className="font-mono text-xs truncate">{detail.r2Key}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => copyToClipboard(detail.r2Key!, 'r2key')}
                    >
                      {copiedField === 'r2key' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              )}
              <DetailRow label="当前版本" value={`${detail.currentVersion} / ${detail.maxVersions}`} />
              <DetailRow label="版本保留天数" value={`${detail.versionRetentionDays} 天`} />
            </div>
          </section>

          {/* 文件夹专属 */}
          {detail.isFolder && detail.childFileCount !== undefined && (
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Folder className="h-4 w-4" />
                文件夹统计
              </h3>
              <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
                <DetailRow label="直接子文件夹" value={`${detail.childFolderCount} 个`} />
                <DetailRow label="直接子文件" value={`${detail.childFileCount} 个`} />
                <DetailRow label="递归总文件数" value={`${detail.totalFileCount ?? 0} 个`} />
                <DetailRow label="递归总体积" value={formatBytes(detail.totalSize ?? 0)} />
              </div>
            </section>
          )}

          {/* AI 信息 */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI 信息
            </h3>
            <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
              {detail.aiSummary ? (
                <div className="py-1">
                  <p className="text-muted-foreground mb-1">AI 摘要</p>
                  <p className={`text-xs leading-relaxed ${detail.aiSummary.length > 100 ? 'line-clamp-3' : ''}`}>
                    {detail.aiSummary}
                  </p>
                  {detail.aiSummary.length > 100 && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs mt-1">
                      展开全部
                    </Button>
                  )}
                  {detail.aiSummaryAt && (
                    <p className="text-xs text-muted-foreground mt-1">生成于 {formatDate(detail.aiSummaryAt)}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-1">暂无 AI 摘要</p>
              )}

              {detail.aiTags && detail.aiTags.length > 0 && (
                <div className="py-1">
                  <p className="text-muted-foreground mb-1">AI 标签</p>
                  <div className="flex flex-wrap gap-1">
                    {detail.aiTags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
                      >
                        <Tag className="h-3 w-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                  {detail.aiTagsAt && (
                    <p className="text-xs text-muted-foreground mt-1">生成于 {formatDate(detail.aiTagsAt)}</p>
                  )}
                </div>
              )}

              <DetailRow
                label="向量索引状态"
                value={detail.vectorIndexedAt ? `已索引 (${formatDate(detail.vectorIndexedAt)})` : '未索引'}
              />
            </div>
          </section>

          {/* 分享状态 */}
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              分享状态
            </h3>
            <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
              <DetailRow
                label="活跃分享数"
                value={`${detail.activeShareCount} 个`}
                highlight={detail.activeShareCount > 0}
              />
            </div>
          </section>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">加载失败</div>
      )}
    </MobileDialog>
  );
}

/** 详情行组件 */
function DetailRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`max-w-[60%] truncate text-right ${mono ? 'font-mono text-xs' : ''} ${highlight ? 'text-primary font-medium' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
