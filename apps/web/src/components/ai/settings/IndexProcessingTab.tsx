/**
 * IndexProcessingTab.tsx
 * 索引与处理标签页组件
 *
 * 功能:
 * - AI未配置警告提示
 * - 功能模型配置（摘要/图片描述/图片标签/智能重命名）
 * - 处理建议
 * - 统计卡片网格（使用 StatsCard）
 * - 一键索引区域（使用 TaskProgress）
 */

import {
  AlertCircle,
  Settings2,
  Loader2,
  FileText,
  Image as ImageIcon,
  File,
  Tags,
  Type,
  Play,
  Database,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatsCard } from './StatsCard';
import { TaskProgress } from './TaskProgress';
import type { AIIndexTask, AISummarizeTask, AITagsTask, AIIndexStats, AiModel } from '@/services/api';

interface IndexProcessingTabProps {
  isAIAvailable: boolean;
  onSwitchToModels: () => void;
  stats: AIIndexStats | null;
  featureConfig: {
    summary: string | null;
    imageCaption: string | null;
    imageTag: string | null;
    rename: string | null;
  } | null;
  models: AiModel[];
  visionModels: AiModel[];
  providersData?: {
    workersAiModels: Array<{ id: string; name: string; capabilities: string[] }>;
  };
  configLoading: boolean;
  isSavingConfig: boolean;
  task: AIIndexTask | null;
  summarizeTask: AISummarizeTask | null;
  tagsTask: AITagsTask | null;
  isStartingSummarize: boolean;
  isStartingTags: boolean;
  onStartSummarize: () => void;
  onStartTags: () => void;
  onStartIndex: () => void;
  onFeatureConfigChange: (feature: string, value: string) => void;
}

export function IndexProcessingTab({
  isAIAvailable,
  onSwitchToModels,
  stats,
  featureConfig,
  models,
  visionModels: _visionModels,
  providersData,
  configLoading,
  isSavingConfig,
  task,
  summarizeTask,
  tagsTask,
  isStartingSummarize,
  isStartingTags,
  onStartSummarize,
  onStartTags,
  onStartIndex,
  onFeatureConfigChange,
}: IndexProcessingTabProps) {
  if (!isAIAvailable) {
    return (
      <div className="space-y-6">
        <div className="border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">AI 功能未配置</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                请先在「模型」标签页添加并激活一个 AI 模型，或在 Cloudflare Dashboard 中配置 AI 和 Vectorize 绑定
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={onSwitchToModels}>
                前往配置模型
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const FEATURE_ITEMS = [
    {
      key: 'summary' as const,
      label: '文件摘要',
      icon: <FileText className="h-4 w-4" />,
      desc: '生成文件内容摘要',
      capability: 'chat',
    },
    {
      key: 'imageCaption' as const,
      label: '图片描述',
      icon: <ImageIcon className="h-4 w-4" />,
      desc: '生成图片文字描述',
      capability: 'vision',
    },
    {
      key: 'imageTag' as const,
      label: '图片标签',
      icon: <Tags className="h-4 w-4" />,
      desc: '识别图片内容标签',
      capability: 'vision',
    },
    {
      key: 'rename' as const,
      label: '智能重命名',
      icon: <Type className="h-4 w-4" />,
      desc: '智能建议文件名',
      capability: 'chat',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="border rounded-lg p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg sm:text-xl font-semibold">功能模型配置</h2>
          {isSavingConfig && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          为不同 AI 功能选择专用模型，留空则使用默认模型或当前激活模型
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURE_ITEMS.map((item) => (
              <div key={item.key} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-primary">{item.icon}</span>
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
                <select
                  value={featureConfig?.[item.key] || '__default__'}
                  onChange={(e) => onFeatureConfigChange(item.key, e.target.value)}
                  disabled={configLoading}
                  className="w-full px-2 py-1.5 border rounded bg-background text-sm"
                >
                  <option value="__default__">使用默认模型</option>
                  <optgroup label="已添加的自定义模型">
                    {models
                      .filter((m) => m.capabilities?.includes(item.capability))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.isActive ? ' ✓' : ''}
                        </option>
                      ))}
                  </optgroup>
                  {providersData?.workersAiModels
                    .filter((m) => m.capabilities.includes(item.capability))
                    .map((m) => (
                      <option key={`wa-${m.id}`} value={m.id}>
                        Workers AI: {m.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-3 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
            💡 提示：图片描述和图片标签都需要支持 vision 能力的模型（如 LLaVA、GPT-4 Vision 等）
          </div>
        </div>
      </section>

      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">💡 建议处理顺序</p>
        <ol className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
          <li>批量生成可编辑文件摘要（提升文本文件语义理解）</li>
          <li>批量生成图片标签+描述（增强图片搜索能力）</li>
          <li>执行一键索引（建立完整向量索引）</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard
          title="可编辑文件"
          icon={<FileText className="h-5 w-5 text-blue-500" />}
          total={stats?.editable.total || 0}
          items={[
            { label: '未生成摘要', count: stats?.editable.noSummary || 0, color: 'text-amber-600' },
            { label: '未索引', count: stats?.editable.notIndexed || 0, color: 'text-red-600' },
          ]}
          actionButton={
            <div className="pt-3 border-t mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onStartSummarize}
                disabled={isStartingSummarize || summarizeTask?.status === 'running'}
              >
                {isStartingSummarize || summarizeTask?.status === 'running' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    批量生成摘要
                  </>
                )}
              </Button>
              {summarizeTask && summarizeTask.status !== 'idle' && (
                <TaskProgress task={summarizeTask} onCancel={() => {}} />
              )}
            </div>
          }
        />

        <StatsCard
          title="图片文件"
          icon={<ImageIcon className="h-5 w-5 text-green-500" />}
          total={stats?.image.total || 0}
          items={[
            { label: '未生成标签', count: stats?.image.noTags || 0, color: 'text-amber-600' },
            { label: '未索引', count: stats?.image.notIndexed || 0, color: 'text-red-600' },
          ]}
          actionButton={
            <div className="pt-3 border-t mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onStartTags}
                disabled={isStartingTags || tagsTask?.status === 'running'}
              >
                {isStartingTags || tagsTask?.status === 'running' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    批量生成标签
                  </>
                )}
              </Button>
              {tagsTask && tagsTask.status !== 'idle' && <TaskProgress task={tagsTask} onCancel={() => {}} />}
            </div>
          }
        />

        <StatsCard
          title="其他文件"
          icon={<File className="h-5 w-5 text-gray-500" />}
          total={stats?.other.total || 0}
          items={[{ label: '未索引', count: stats?.other.notIndexed || 0, color: 'text-red-600' }]}
        />
      </div>

      <div className="border rounded-lg p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex-1">
            <p className="font-medium flex items-center gap-2 text-base sm:text-lg">
              <Database className="h-5 w-5" />
              语义搜索索引
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              为所有文件建立向量索引，支持智能语义搜索。建议先完成摘要和标签生成后再执行。
            </p>
          </div>
          <Button
            variant="default"
            onClick={onStartIndex}
            disabled={task?.status === 'running'}
            className="w-full sm:w-auto"
          >
            <Database className="h-4 w-4 mr-2" />
            一键生成索引
          </Button>
        </div>

        {task && task.status !== 'idle' && <TaskProgress task={task} onCancel={() => {}} />}
      </div>

      {stats && (
        <div className="border rounded-lg p-4 sm:p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            文件处理总览
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-blue-600">
                {(stats.editable.total || 0) + (stats.image.total || 0) + (stats.other.total || 0)}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">总文件数</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-green-600">
                {stats.editable.noSummary + stats.image.noTags}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">待处理</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-amber-600">
                {stats.editable.notIndexed + stats.image.notIndexed + stats.other.notIndexed}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">待索引</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-purple-600">
                {Math.round(
                  ((stats.editable.total -
                    stats.editable.notIndexed +
                    stats.image.total -
                    stats.image.notIndexed +
                    stats.other.total -
                    stats.other.notIndexed) /
                    (stats.editable.total + stats.image.total + stats.other.total || 1)) *
                    100
                )}
                %
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">完成率</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
