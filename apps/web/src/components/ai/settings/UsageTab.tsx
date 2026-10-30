/**
 * UsageTab.tsx
 * AI 用量与配额面板
 *
 * - 统计范围：全部经网关的 AI 调用 + Agent 对话（统一写入 ai_usage_events）
 * - 请求失败时显式报错，不再静默显示 0
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BarChart3, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { aiApi } from '@/services/api';

const DAY_OPTIONS = [1, 7, 30, 90];

const FEATURE_LABELS: Record<string, string> = {
  chat: '对话',
  summary: '文件摘要',
  file_summary: '文件摘要',
  image_caption: '图片描述',
  image_tag: '图片标签',
  image_analysis: '图片分析',
  rename: '智能重命名',
};

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit <= 0;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={percent >= 90 ? 'text-destructive font-medium' : 'text-muted-foreground'}>
          {formatNumber(used)} / {unlimited ? '不限' : formatNumber(limit)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${percent >= 90 ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${unlimited ? 100 : percent}%` }}
        />
      </div>
    </div>
  );
}

export function UsageTab() {
  const [days, setDays] = useState(7);

  const summaryQuery = useQuery({
    queryKey: ['ai-usage-summary', days],
    queryFn: () => aiApi.usage.getSummary(days).then((res) => res.data.data),
    staleTime: 30_000,
  });

  const quotaQuery = useQuery({
    queryKey: ['ai-usage-quota'],
    queryFn: () => aiApi.usage.getQuota().then((res) => res.data.data),
    staleTime: 30_000,
  });

  const data = summaryQuery.data;
  const totals = data?.totals ?? { inputTokens: 0, outputTokens: 0, requests: 0 };
  const quota = quotaQuery.data;
  const requestError = summaryQuery.error ?? quotaQuery.error;

  const refresh = () => {
    void summaryQuery.refetch();
    void quotaQuery.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">AI 用量</h2>
          <p className="text-xs text-muted-foreground">按真实 token 记账，含对话与全部批量 AI 调用</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            aria-label="统计时间范围"
          >
            {DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                近 {option} 天
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </div>

      {requestError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">用量数据读取失败</p>
            <p className="mt-0.5 text-xs">
              {requestError instanceof Error ? requestError.message : String(requestError)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              若持续失败，请确认数据库已执行 110 迁移（ai_usage_events 表）。
            </p>
          </div>
        </div>
      )}

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

      {quota && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">配额使用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <QuotaBar label="今日 Token" used={quota.usedTokens} limit={quota.tokenLimit} />
            <QuotaBar label="今日请求" used={quota.usedRequests} limit={quota.requestLimit} />
            <QuotaBar label="本分钟请求" used={quota.minuteRequests} limit={quota.minuteLimit} />
            {!quota.allowed && (
              <p className="text-xs text-destructive">
                当前已触发上限：{quota.reason === 'rate_limit' ? '请求过于频繁' : '配额已用完'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            按功能分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : (data?.byFeature?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">暂无用量记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">功能</th>
                    <th className="py-2 pr-3">请求</th>
                    <th className="py-2 pr-3">输入</th>
                    <th className="py-2">输出</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.byFeature.map((row) => (
                    <tr key={row.feature} className="border-b last:border-0">
                      <td className="py-2 pr-3">{featureLabel(row.feature)}</td>
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
          <CardTitle className="text-sm">按模型分布</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.byModel?.length ?? 0) === 0 ? (
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
