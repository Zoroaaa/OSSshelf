/**
 * VectorsTable.tsx
 * 向量库卡片式组件
 *
 * 功能:
 * - 展示向量索引列表（卡片式布局，移动端友好）
 * - 分页
 * - 删除向量操作
 */

import { FileText, Trash2, Loader2, RefreshCw, Calendar, HardDrive, FileType, Sparkles, Eye } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface VectorItem {
  id: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  vectorIndexedAt?: string | null;
  aiSummary?: string | null;
}

interface VectorsTableProps {
  vectorsData?: {
    vectors: VectorItem[];
    pagination: { total: number; totalPages: number };
  } | null;
  isLoadingVectors: boolean;
  vectorsError: Error | null;
  deletingVectorId: string | null;
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  formatFileSize: (bytes: number) => string;
  onDeleteVector: (fileId: string, fileName: string) => void;
  onViewDetail?: (fileId: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
}

function VectorCard({
  vector,
  formatFileSize,
  onDelete,
  onViewDetail,
  isDeleting,
}: {
  vector: VectorItem;
  formatFileSize: (bytes: number) => string;
  onDelete: (fileId: string, fileName: string) => void;
  onViewDetail?: (fileId: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
          <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate" title={vector.name}>
            {vector.name}
          </h3>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileType className="h-3 w-3" />
              {vector.mimeType?.split('/')[1] || '未知'}
            </span>
            {vector.size && (
              <span className="inline-flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                {formatFileSize(vector.size)}
              </span>
            )}
            {vector.vectorIndexedAt && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(vector.vectorIndexedAt).toLocaleDateString('zh-CN')}
              </span>
            )}
          </div>

          {vector.aiSummary && (
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <Sparkles className="h-3 w-3 text-green-500" />
              <span className="text-green-600 dark:text-green-400">已生成摘要</span>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="flex-shrink-0 h-8 w-8 p-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
          onClick={() => onViewDetail?.(vector.id)}
          title="查看索引详情"
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-shrink-0 h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={() => onDelete(vector.id, vector.name)}
          disabled={isDeleting}
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function VectorsTable({
  vectorsData,
  isLoadingVectors,
  vectorsError,
  deletingVectorId,
  currentPage,
  totalPages,
  totalRecords,
  formatFileSize,
  onDeleteVector,
  onViewDetail,
  onRefresh,
  onPageChange,
}: VectorsTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">向量索引库</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            共 {totalRecords} 个文件已索引
            <span className="ml-1 opacity-60">（Vectorize 实际条目数因分块通常更多）</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoadingVectors}>
          {isLoadingVectors ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          刷新
        </Button>
      </div>

      {vectorsError && (
        <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-sm">
          {String(vectorsError)}
        </div>
      )}

      {isLoadingVectors ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      ) : vectorsData?.vectors.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-xl">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-base font-medium mb-2">暂无向量索引数据</h3>
          <p className="text-sm text-muted-foreground">索引文件后将在此显示</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vectorsData?.vectors.map((vector) => (
            <VectorCard
              key={vector.id}
              vector={vector}
              formatFileSize={formatFileSize}
              onDelete={onDeleteVector}
              onViewDetail={onViewDetail}
              isDeleting={deletingVectorId === vector.id}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
