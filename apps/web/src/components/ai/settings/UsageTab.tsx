/**
 * UsageTab.tsx
 * AI 用量与成本面板
 */

import { useQuery } from '@tanstack/react-query';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { aiApi } from '@/services/api';

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function UsageTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-usage-summary'],
    queryFn: () => aiApi.usage.getSummary(7).then((res) => res.data.data),
    staleTime: 30_000,
  });

  const totals = data?.totals ?? { inputTokens: 0, outputTokens: 0, requests: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">AI 用量（近 7 天）</h2>
          <p className="text-xs text-muted-foreground">按真实 token 记账，用于配额与成本观测</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">请求数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatNumber(totals.requests)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">输入 Token</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatNumber(totals.inputTokens)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">输出 Token</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatNumber(totals.outputTokens)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            按模型分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : (data?.byModel?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">暂无用量记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">模型</th>
                    <th className="py-2 pr-3">请求</th>
                    <th className="py-2 pr-3">输入</th>
                    <th className="py-2">输出</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.byModel.map((row) => (
                    <tr key={row.modelId} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs truncate max-w-[240px]">{row.modelId}</td>
                      <td className="py-2 pr-3">{formatNumber(row.requests)}</td>
                      <td className="py-2 pr-3">{formatNumber(row.inputTokens)}</td>
                      <td className="py-2">{formatNumber(row.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">按天</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.byDay?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">暂无记录</div>
          ) : (
            <div className="space-y-1">
              {data!.byDay.map((row) => (
                <div key={row.day} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{row.day}</span>
                  <span>
                    {formatNumber(row.inputTokens)} in / {formatNumber(row.outputTokens)} out · {row.requests} 次
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
