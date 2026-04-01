/**
 * CsvPreview.tsx
 * CSV表格预览组件
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/Button';

interface CsvPreviewProps {
  resolvedUrl: string;
  onLoadError: () => void;
}

export function CsvPreview({ resolvedUrl, onLoadError }: CsvPreviewProps) {
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvSortColumn, setCsvSortColumn] = useState<number | null>(null);
  const [csvSortAsc, setCsvSortAsc] = useState(true);
  const [csvSearchTerm, setCsvSearchTerm] = useState('');
  const [csvCurrentPage, setCsvCurrentPage] = useState(1);
  const [csvPageSize, setCsvPageSize] = useState(50);

  const loadCsvPreview = useCallback(async () => {
    setCsvLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const text = await response.text();
      const result = Papa.parse<string[]>(text, {
        skipEmptyLines: true,
      });
      if (result.data && result.data.length > 0) {
        const headers = result.data[0] || [];
        const rows = result.data.slice(1);
        setCsvHeaders(headers);
        setCsvRows(rows);
        setCsvCurrentPage(1);
      }
    } catch (err) {
      console.error('CSV preview error:', err);
      onLoadError();
    } finally {
      setCsvLoading(false);
    }
  }, [resolvedUrl, onLoadError]);

  const handleCsvSort = useCallback(
    (columnIndex: number) => {
      if (csvSortColumn === columnIndex) {
        setCsvSortAsc(!csvSortAsc);
      } else {
        setCsvSortColumn(columnIndex);
        setCsvSortAsc(true);
      }
    },
    [csvSortColumn, csvSortAsc]
  );

  const filteredCsvRows = useMemo(() => {
    if (!csvSearchTerm) return csvRows;
    return csvRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(csvSearchTerm.toLowerCase())));
  }, [csvRows, csvSearchTerm]);

  const sortedCsvRows = useMemo(() => {
    if (csvSortColumn === null) return filteredCsvRows;
    return [...filteredCsvRows].sort((a, b) => {
      const aVal = a[csvSortColumn] || '';
      const bVal = b[csvSortColumn] || '';
      const comparison = aVal.localeCompare(bVal, undefined, { numeric: true });
      return csvSortAsc ? comparison : -comparison;
    });
  }, [filteredCsvRows, csvSortColumn, csvSortAsc]);

  const paginatedCsvRows = useMemo(() => {
    const start = (csvCurrentPage - 1) * csvPageSize;
    return sortedCsvRows.slice(start, start + csvPageSize);
  }, [sortedCsvRows, csvCurrentPage, csvPageSize]);

  const totalCsvPages = Math.ceil(sortedCsvRows.length / csvPageSize);

  useEffect(() => {
    loadCsvPreview();
  }, [loadCsvPreview]);

  return (
    <div className="w-full h-full flex flex-col relative">
      {csvLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
          <div className="text-muted-foreground text-sm">正在加载表格...</div>
        </div>
      )}
      {csvHeaders.length > 0 ? (
        <>
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <span className="text-sm text-muted-foreground">CSV 表格 - {csvRows.length} 行数据</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="搜索..."
                value={csvSearchTerm}
                onChange={(e) => {
                  setCsvSearchTerm(e.target.value);
                  setCsvCurrentPage(1);
                }}
                className="h-7 w-40 px-2 text-xs border rounded bg-background"
              />
              <select
                value={csvPageSize}
                onChange={(e) => {
                  setCsvPageSize(Number(e.target.value));
                  setCsvCurrentPage(1);
                }}
                className="h-7 px-2 text-xs border rounded bg-background"
              >
                <option value={20}>20行/页</option>
                <option value={50}>50行/页</option>
                <option value={100}>100行/页</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  {csvHeaders.map((header, index) => (
                    <th
                      key={index}
                      onClick={() => handleCsvSort(index)}
                      className="border border-border px-3 py-2 text-left cursor-pointer hover:bg-muted/50 select-none"
                    >
                      <div className="flex items-center gap-1">
                        {header}
                        {csvSortColumn === index && <span className="text-xs">{csvSortAsc ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedCsvRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-muted/30">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border border-border px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalCsvPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 border-t bg-muted/30">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCsvCurrentPage((p) => Math.max(1, p - 1))}
                disabled={csvCurrentPage <= 1}
                className="h-7"
              >
                上一页
              </Button>
              <span className="text-xs text-muted-foreground">
                {csvCurrentPage} / {totalCsvPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCsvCurrentPage((p) => Math.min(totalCsvPages, p + 1))}
                disabled={csvCurrentPage >= totalCsvPages}
                className="h-7"
              >
                下一页
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
        </div>
      )}
    </div>
  );
}
