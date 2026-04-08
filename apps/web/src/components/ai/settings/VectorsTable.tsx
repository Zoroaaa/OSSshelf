/**
 * VectorsTable.tsx
 * 向量库表格组件
 *
 * 功能:
 * - 展示向量索引列表
 * - 分页
 * - 删除向量操作
 */

import { FileText, Trash2, Loader2, RefreshCw } from 'lucide-react';
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
  onRefresh: () => void;
  onPageChange: (page: number) => void;
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
  onRefresh,
  onPageChange,
}: VectorsTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg sm:text-xl font-semibold">向量索引库</h2>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoadingVectors}>
          {isLoadingVectors ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          刷新
        </Button>
      </div>

      {vectorsError ? <div className="text-red-500 text-sm">{String(vectorsError)}</div> : null}

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">文件名</th>
                <th className="text-left p-3 font-medium">类型</th>
                <th className="text-left p-3 font-medium">大小</th>
                <th className="text-left p-3 font-medium">索引时间</th>
                <th className="text-left p-3 font-medium">摘要</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoadingVectors ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    加载中...
                  </td>
                </tr>
              ) : vectorsData?.vectors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    暂无向量索引数据
                  </td>
                </tr>
              ) : (
                vectorsData?.vectors.map((vector) => (
                  <tr key={vector.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate max-w-[200px]" title={vector.name}>
                          {vector.name}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{vector.mimeType?.split('/')[1] || '未知'}</td>
                    <td className="p-3 text-muted-foreground">{vector.size ? formatFileSize(vector.size) : '-'}</td>
                    <td className="p-3 text-muted-foreground">
                      {vector.vectorIndexedAt ? new Date(vector.vectorIndexedAt).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="p-3">
                      {vector.aiSummary ? (
                        <span className="text-xs text-green-600 dark:text-green-400">已生成</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">无</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => onDeleteVector(vector.id, vector.name)}
                        disabled={deletingVectorId === vector.id}
                      >
                        {deletingVectorId === vector.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">共 {totalRecords} 条记录</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              上一页
            </Button>
            <span>
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
        </div>
      )}
    </div>
  );
}
