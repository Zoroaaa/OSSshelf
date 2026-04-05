/**
 * AISettings.tsx
 * AI 配置管理中心（完整版）
 *
 * 功能:
 * - 模型配置管理（Workers AI / OpenAI兼容API）
 * - 向量索引管理（批量索引/单文件索引）
 * - AI摘要批量生成
 * - AI标签+描述批量生成
 * - 统计数据展示
 * - PC端 + 移动端响应式适配
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu,
  Plus,
  Trash2,
  X,
  Key,
  Cloud,
  Zap,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Database,
  RefreshCw,
  CheckCircle,
  XCircle,
  Square,
  FileText,
  Image as ImageIcon,
  File,
  Play,
  MessageSquare,
  BarChart3,
  Settings2,
  Tags,
  Type,
  Layers,
  Sliders,
  RotateCcw,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModelCard } from '@/components/ai';
import {
  aiApi,
  type AiModel,
  type AiProvider,
  type AiWorkersAiModel,
  type AiOpenAiModel,
  type AiSystemConfigItem,
} from '@/services/api';
import type { AIIndexTask, AISummarizeTask, AITagsTask, AIIndexStats } from '@/services/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/utils';

type TabType = 'models' | 'providers' | 'index' | 'tasks' | 'vectors' | 'advanced';

export function AISettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabType>('models');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);

  // 索引任务状态
  const [task, setTask] = useState<AIIndexTask | null>(null);
  const [summarizeTask, setSummarizeTask] = useState<AISummarizeTask | null>(null);
  const [tagsTask, setTagsTask] = useState<AITagsTask | null>(null);
  const [stats, setStats] = useState<AIIndexStats | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingSummarize, setIsStartingSummarize] = useState(false);
  const [isStartingTags, setIsStartingTags] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showIndexWarning, setShowIndexWarning] = useState(false);

  // 功能级模型配置状态
  const [featureConfig, setFeatureConfig] = useState<{
    summary: string | null;
    imageCaption: string | null;
    imageTag: string | null;
    rename: string | null;
  } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // 向量库状态
  const [vectorPage, setVectorPage] = useState(1);
  const [deletingVectorId, setDeletingVectorId] = useState<string | null>(null);

  // 系统配置状态
  const [editingConfigKey, setEditingConfigKey] = useState<string | null>(null);
  const [configEditValue, setConfigEditValue] = useState<string>('');

  // 查询模型列表
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiApi.config.getModels().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  // 查询有vision能力的模型（用于图片相关配置）
  const { data: visionModels = [] } = useQuery({
    queryKey: ['ai-models', 'vision'],
    queryFn: () => aiApi.config.getModels('vision').then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  // 模型能力映射：配置key -> 需要的能力
  const modelCapabilityMap: Record<string, 'chat' | 'vision'> = {
    'ai.default_model.chat': 'chat',
    'ai.default_model.vision': 'vision',
    'ai.default_model.summary': 'chat',
    'ai.default_model.image_caption': 'vision',
    'ai.default_model.image_tag': 'vision',
    'ai.default_model.rename': 'chat',
  };

  // 查询AI状态
  const { data: status } = useQuery({
    queryKey: ['ai-config-status'],
    queryFn: () => aiApi.config.getStatus().then((r) => r.data.data),
    staleTime: 30000,
  });

  // 查询可用提供商和模型
  const { data: providersData } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiApi.config.getProviders().then((r) => r.data.data),
    staleTime: 300000,
  });

  // 查询系统配置
  const {
    data: systemConfigs = [],
    isLoading: configLoading,
    refetch: refetchSystemConfig,
  } = useQuery({
    queryKey: ['ai-system-config'],
    queryFn: () => aiApi.config.getSystemConfig().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  // 模型操作 mutations
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof aiApi.config.createModel>[0]) => aiApi.config.createModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
      setShowAddModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ modelId, data }: { modelId: string; data: Parameters<typeof aiApi.config.updateModel>[1] }) =>
      aiApi.config.updateModel(modelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
      setEditingModel(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (modelId: string) => aiApi.config.deleteModel(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
    },
  });

  // 向量库查询
  const {
    data: vectorsData,
    isLoading: isLoadingVectors,
    error: vectorsError,
    refetch: refetchVectors,
  } = useQuery({
    queryKey: ['ai-vectors', vectorPage],
    queryFn: () => aiApi.getVectors({ page: vectorPage, pageSize: 20 }).then((r) => r.data.data),
    staleTime: 30000,
  });

  // 删除向量
  const deleteVectorMutation = useMutation({
    mutationFn: (fileId: string) => aiApi.deleteVector(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-vectors'] });
      setDeletingVectorId(null);
    },
    onError: () => {
      setDeletingVectorId(null);
    },
  });

  const handleDeleteVector = async (fileId: string, fileName: string) => {
    if (!confirm(`确定要删除文件 "${fileName}" 的向量索引吗？`)) return;
    setDeletingVectorId(fileId);
    deleteVectorMutation.mutate(fileId);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 测试模型连接
  const [testResult, setTestResult] = useState<{
    modelId: string;
    valid: boolean;
    response?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  const testModelMutation = useMutation({
    mutationFn: async (data: { modelId?: string; provider?: string; apiEndpoint?: string; apiKey?: string }) => {
      const result = await aiApi.config.testModel(data);
      const dataResult = result.data.data;
      return {
        modelId: data.modelId || 'temp',
        valid: dataResult?.valid ?? false,
        response: dataResult?.response,
        latencyMs: dataResult?.latencyMs,
        error: dataResult?.error,
      };
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
  });

  // 功能模型配置
  const { data: featureConfigData } = useQuery({
    queryKey: ['ai-feature-config'],
    queryFn: () => aiApi.config.getFeatureConfig().then((r) => r.data.data),
    staleTime: 30000,
  });

  useEffect(() => {
    if (featureConfigData) {
      setFeatureConfig(featureConfigData as typeof featureConfig);
    }
  }, [featureConfigData]);

  const saveFeatureConfigMutation = useMutation({
    mutationFn: (data: typeof featureConfig) =>
      aiApi.config.saveFeatureConfig(data as Parameters<typeof aiApi.config.saveFeatureConfig>[0]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-feature-config'] });
    },
  });

  // 系统配置操作 mutations
  const updateSystemConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => aiApi.config.updateSystemConfig(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-system-config'] });
      setEditingConfigKey(null);
    },
  });

  const resetSystemConfigMutation = useMutation({
    mutationFn: (key: string) => aiApi.config.resetSystemConfig(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-system-config'] });
    },
  });

  // 功能模型配置变更处理
  const handleFeatureConfigChange = (feature: keyof NonNullable<typeof featureConfig>, value: string) => {
    if (!featureConfig) return;
    const newConfig = { ...featureConfig, [feature]: value === '__default__' ? null : value };
    setFeatureConfig(newConfig);
    setIsSavingConfig(true);
    saveFeatureConfigMutation.mutate(newConfig, {
      onSettled: () => setIsSavingConfig(false),
    });
  };

  const activateMutation = useMutation({
    mutationFn: (modelId: string) => aiApi.config.activateModel(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
    },
  });

  // 快速启用 Workers AI 模型（一键添加并激活）
  const quickActivateMutation = useMutation({
    mutationFn: async (workersAiModelId: string) => {
      // 检查是否已存在该模型
      const existingModel = models.find((m) => m.provider === 'workers_ai' && m.modelId === workersAiModelId);

      if (existingModel) {
        // 已存在则直接激活
        await aiApi.config.activateModel(existingModel.id);
        return { action: 'activated', modelId: existingModel.id };
      } else {
        // 不存在则创建并激活
        const createResult = await aiApi.config.createModel({
          name: providersData?.workersAiModels.find((m) => m.id === workersAiModelId)?.name || workersAiModelId,
          provider: 'workers_ai',
          modelId: workersAiModelId,
          isActive: true,
          capabilities: ['chat'],
        });
        return { action: 'created', modelId: createResult.data.data?.id };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
    },
  });

  // 获取索引状态数据
  useEffect(() => {
    fetchAllTaskStatus();
    fetchStats();
  }, []);

  const fetchAllTaskStatus = async () => {
    try {
      const [indexRes, summarizeRes, tagsRes] = await Promise.all([
        aiApi.getIndexStatus(),
        aiApi.getSummarizeTask(),
        aiApi.getTagsTask(),
      ]);

      if (indexRes.data.success && indexRes.data.data) setTask(indexRes.data.data);
      if (summarizeRes.data.success && summarizeRes.data.data) setSummarizeTask(summarizeRes.data.data);
      if (tagsRes.data.success && tagsRes.data.data) setTagsTask(tagsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch task status:', error);
    }
  };

  // 任务状态自动轮询：当有任务运行时，每3秒刷新一次
  useEffect(() => {
    const isAnyTaskRunning = [task, summarizeTask, tagsTask].some((t) => t && t.status === 'running');

    if (!isAnyTaskRunning) return;

    const interval = setInterval(fetchAllTaskStatus, 10000);
    return () => clearInterval(interval);
  }, [task?.status, summarizeTask?.status, tagsTask?.status]);

  const fetchStats = async () => {
    try {
      const response = await aiApi.getIndexStats();
      if (response.data.success && response.data.data) setStats(response.data.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  // 索引操作函数
  const handleStartSummarize = async () => {
    setIsStartingSummarize(true);
    try {
      const response = await aiApi.summarizeBatch();
      if (response.data.success && response.data.data) setSummarizeTask(response.data.data.task);
    } catch (e: any) {
      console.error('Failed to start summarize:', e);
    } finally {
      setIsStartingSummarize(false);
    }
  };

  const handleStartTags = async () => {
    setIsStartingTags(true);
    try {
      const response = await aiApi.tagsBatch();
      if (response.data.success && response.data.data) setTagsTask(response.data.data.task);
    } catch (e: any) {
      console.error('Failed to start tags:', e);
    } finally {
      setIsStartingTags(false);
    }
  };

  const handleStartIndex = async () => {
    if (stats && (stats.editable.noSummary > 0 || stats.image.noTags > 0)) {
      setShowIndexWarning(true);
      return;
    }
    await executeStartIndex();
  };

  const executeStartIndex = async () => {
    setIsStarting(true);
    setShowIndexWarning(false);
    setShowConfirmDialog(false);
    try {
      const response = await aiApi.indexAll();
      if (response.data.success && response.data.data) setTask(response.data.data.task);
    } catch (e: any) {
      console.error('Failed to start index:', e);
    } finally {
      setIsStarting(false);
    }
  };

  const handleForceResetTask = async (taskType: 'index' | 'summarize' | 'tags') => {
    try {
      if (taskType === 'index') {
        await aiApi.cancelIndexTask();
      } else if (taskType === 'summarize') {
        await aiApi.cancelSummarizeTask();
      } else {
        await aiApi.cancelTagsTask();
      }
      await fetchAllTaskStatus();
    } catch (e: any) {
      console.error('Failed to reset task:', e);
    }
  };

  const handleSaveConfig = (config: AiSystemConfigItem) => {
    let value: string | number | boolean = configEditValue;

    if (config.valueType === 'number') {
      value = Number(configEditValue);
    } else if (config.valueType === 'boolean') {
      value = configEditValue === 'true';
    }

    updateSystemConfigMutation.mutate({ key: config.key, value });
  };

  // 渲染任务进度条
  const renderTaskProgress = (
    taskData: AIIndexTask | AISummarizeTask | AITagsTask | null,
    taskType?: 'index' | 'summarize' | 'tags'
  ) => {
    if (!taskData || taskData.status === 'idle') return null;

    const progress = taskData.total > 0 ? (taskData.processed / taskData.total) * 100 : 0;

    return (
      <div className="space-y-2 mt-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {taskData.status === 'running' && (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium">处理中...</span>
              </>
            )}
            {taskData.status === 'completed' && (
              <>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">已完成</span>
              </>
            )}
            {taskData.status === 'failed' && (
              <>
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">失败</span>
              </>
            )}
            {taskData.status === 'cancelled' && (
              <>
                <Square className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">已取消</span>
              </>
            )}
          </div>
          {/* 所有非 idle 和 completed 状态都显示操作按钮 */}
          {taskType && taskData.status !== 'completed' && (
            <Button variant="outline" size="sm" onClick={() => handleForceResetTask(taskType)} className="text-xs">
              {taskData.status === 'running' ? '取消' : '清除'}
            </Button>
          )}
        </div>

        {/* 进度条 */}
        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            进度: {taskData.processed} / {taskData.total}
          </span>
          {taskData.failed > 0 && <span className="text-red-500">失败: {taskData.failed}</span>}
        </div>
      </div>
    );
  };

  // 渲染统计卡片
  const renderStatsCard = (
    title: string,
    icon: React.ReactNode,
    total: number,
    items: Array<{ label: string; count: number; color?: string }>,
    actionButton?: React.ReactNode
  ) => (
    <div className="border rounded-lg p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h4 className="font-medium text-sm sm:text-base truncate">{title}</h4>
        </div>
        <span className="text-xl sm:text-2xl font-bold flex-shrink-0">{total}</span>
      </div>

      <div className="space-y-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground truncate mr-2">{item.label}</span>
            <span className={`font-medium flex-shrink-0 ${item.color || ''}`}>{item.count}</span>
          </div>
        ))}
      </div>

      {actionButton}
    </div>
  );

  const isAIAvailable = status?.configured;

  const tabs: { id: TabType; label: string; icon: typeof Cpu; badge?: number }[] = [
    { id: 'models', label: '模型', icon: Cpu, badge: models.length },
    { id: 'providers', label: '可用模型', icon: Zap },
    { id: 'index', label: '索引与处理', icon: Database },
    { id: 'vectors', label: '向量库', icon: Layers },
    { id: 'tasks', label: '任务中心', icon: BarChart3 },
    { id: 'advanced', label: '高级配置', icon: Sliders },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* 页面标题 - 固定在顶部 */}
      <div className="flex-shrink-0 bg-gradient-to-r from-purple-50 via-white to-pink-50 dark:from-purple-950/30 dark:via-slate-900 dark:to-pink-950/30 border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 sm:p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-lg shadow-purple-500/25">
                <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">AI 配置中心</h1>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                  模型管理 · 索引配置 · 任务监控
                </p>
              </div>
            </div>

            {/* 快捷操作按钮 */}
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  fetchAllTaskStatus();
                  fetchStats();
                  queryClient.invalidateQueries({ queryKey: ['ai-models'] });
                  queryClient.invalidateQueries({ queryKey: ['ai-config-status'] });
                  queryClient.invalidateQueries({ queryKey: ['ai-feature-config'] });
                }}
                className="gap-2 text-xs sm:text-sm"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">刷新</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/ai-chat')}
                className="gap-2 text-xs sm:text-sm"
              >
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">AI 对话</span>
                <span className="sm:hidden">对话</span>
              </Button>
            </div>
          </div>

          {/* 状态卡片 - 响应式 */}
          {status && (
            <div className="mt-4 p-3 sm:p-4 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-2">
                  {status.configured ? (
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                  )}
                  <span className="font-medium text-sm sm:text-base">
                    {status.configured ? '✅ AI 已就绪' : '⚠️ AI 未配置'}
                  </span>
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">
                  已配置 {status.totalModels} 个模型 · 当前：{status.activeModel?.name || '默认 Workers AI'}
                </div>
              </div>
            </div>
          )}

          {/* 标签页导航 - 移动端滚动 */}
          <div className="mt-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab.id
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                    {tab.badge !== undefined && tab.badge > 0 && activeTab !== tab.id && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                          activeTab === tab.id ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区 - 可滚动 */}
      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* ========== 模型管理标签页 ========== */}
        {activeTab === 'models' && (
          <div className="space-y-4">
            {/* 操作栏 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">已配置的模型</h2>
              <Button onClick={() => setShowAddModal(true)} className="gap-2 w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                添加模型
              </Button>
            </div>

            {/* 模型列表 */}
            {modelsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <Cpu className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-medium mb-2">暂无配置的模型</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  点击上方按钮添加您的第一个 AI 模型，或使用 Cloudflare Workers AI 免费模型
                </p>
                <Button onClick={() => setShowAddModal(true)} className="w-full sm:w-auto max-w-xs">
                  <Plus className="h-4 w-4 mr-2" />
                  添加模型
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {models.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    isExpanded={expandedModelId === model.id}
                    onToggleExpand={() => setExpandedModelId(expandedModelId === model.id ? null : model.id)}
                    onEdit={() => setEditingModel(model)}
                    onDelete={() => {
                      if (confirm('确定要删除这个模型吗？')) deleteMutation.mutate(model.id);
                    }}
                    onActivate={() => activateMutation.mutate(model.id)}
                    isActivating={activateMutation.isPending}
                    onTest={(modelId) => testModelMutation.mutate({ modelId })}
                    testResult={testResult}
                    isTesting={testModelMutation.isPending && testModelMutation.variables?.modelId === model.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========== 可用模型标签页 ========== */}
        {activeTab === 'providers' && providersData && (
          <div className="space-y-6 sm:space-y-8">
            {/* Cloudflare Workers AI */}
            <section className="border rounded-lg p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Cloud className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg sm:text-xl font-semibold">Cloudflare Workers AI</h2>
                <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full font-medium">
                  免费
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Cloudflare 内置的 AI 服务，无需配置 API 密钥即可使用</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {providersData.workersAiModels
                  .filter((m) => m.id !== '__custom__')
                  .map((m) => {
                    const isAdded = models.some((model) => model.provider === 'workers_ai' && model.modelId === m.id);
                    const isActive = status?.activeModel?.modelId === m.id;
                    const isPending = quickActivateMutation.isPending;

                    return (
                      <div
                        key={m.id}
                        className={cn(
                          'p-3 sm:p-4 border rounded-lg transition-colors relative',
                          isActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                        )}
                      >
                        {isActive && (
                          <div className="absolute top-2 right-2">
                            <CheckCircle className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0 pr-6">
                            <h3 className="font-medium text-sm sm:text-base truncate">{m.name}</h3>
                            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{m.id}</p>
                            <p className="text-xs sm:text-sm text-muted-foreground mt-2 line-clamp-2">
                              {m.description}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1 flex-shrink-0">
                            {m.capabilities.map((cap) => (
                              <span
                                key={cap}
                                className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full"
                              >
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t">
                          <Button
                            size="sm"
                            variant={isActive ? 'default' : 'outline'}
                            className="w-full"
                            disabled={isPending}
                            onClick={() => quickActivateMutation.mutate(m.id)}
                          >
                            {isPending ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                处理中...
                              </>
                            ) : isActive ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                当前使用中
                              </>
                            ) : isAdded ? (
                              <>
                                <Play className="h-3 w-3 mr-1" />
                                切换到此模型
                              </>
                            ) : (
                              <>
                                <Plus className="h-3 w-3 mr-1" />
                                快速启用
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>

            {/* OpenAI 兼容 API */}
            <section className="border rounded-lg p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Zap className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg sm:text-xl font-semibold">OpenAI 兼容 API</h2>
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full font-medium">
                  需要配置
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                支持 OpenAI、Anthropic Claude、Google Gemini、通义千问等所有兼容 API
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {providersData.openAiModels.map((m) => (
                  <div key={m.id} className="p-3 sm:p-4 border rounded-lg hover:border-primary/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-medium text-sm sm:text-base">{m.name}</h3>
                          <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">
                            {m.provider}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{m.id}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-2 line-clamp-2">{m.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {m.capabilities.map((cap) => (
                        <span key={cap} className="px-2 py-0.5 bg-accent text-accent-foreground text-xs rounded-full">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ========== 索引与处理标签页 ========== */}
        {activeTab === 'index' && (
          <div className="space-y-6">
            {!isAIAvailable && (
              <div className="border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">AI 功能未配置</p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      请先在「模型」标签页添加并激活一个 AI 模型，或在 Cloudflare Dashboard 中配置 AI 和 Vectorize 绑定
                    </p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => setActiveTab('models')}>
                      前往配置模型
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {isAIAvailable && (
              <>
                {/* 功能模型配置 */}
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
                    {/* 文件摘要模型 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        {
                          key: 'summary' as const,
                          label: '文件摘要',
                          icon: <FileText className="h-4 w-4" />,
                          desc: '生成文件内容摘要',
                          capability: 'chat',
                          defaultModel: '@cf/meta/llama-3.1-8b-instruct',
                        },
                        {
                          key: 'imageCaption' as const,
                          label: '图片描述',
                          icon: <ImageIcon className="h-4 w-4" />,
                          desc: '生成图片文字描述',
                          capability: 'vision',
                          defaultModel: '@cf/llava-hf/llava-1.5-7b-hf',
                        },
                        {
                          key: 'imageTag' as const,
                          label: '图片标签',
                          icon: <Tags className="h-4 w-4" />,
                          desc: '识别图片内容标签',
                          capability: 'vision',
                          defaultModel: '@cf/llava-hf/llava-1.5-7b-hf',
                        },
                        {
                          key: 'rename' as const,
                          label: '智能重命名',
                          icon: <Type className="h-4 w-4" />,
                          desc: '智能建议文件名',
                          capability: 'chat',
                          defaultModel: '@cf/meta/llama-3.1-8b-instruct',
                        },
                      ].map((item) => (
                        <div key={item.key} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-primary">{item.icon}</span>
                            <span className="font-medium text-sm">{item.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                          <select
                            value={featureConfig?.[item.key] || '__default__'}
                            onChange={(e) => handleFeatureConfigChange(item.key, e.target.value)}
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

                {/* 处理建议 */}
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">💡 建议处理顺序</p>
                  <ol className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                    <li>批量生成可编辑文件摘要（提升文本文件语义理解）</li>
                    <li>批量生成图片标签+描述（增强图片搜索能力）</li>
                    <li>执行一键索引（建立完整向量索引）</li>
                  </ol>
                </div>

                {/* 统计卡片网格 - 响应式 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {renderStatsCard(
                    '可编辑文件',
                    <FileText className="h-5 w-5 text-blue-500" />,
                    stats?.editable.total || 0,
                    [
                      { label: '未生成摘要', count: stats?.editable.noSummary || 0, color: 'text-amber-600' },
                      { label: '未索引', count: stats?.editable.notIndexed || 0, color: 'text-red-600' },
                    ],
                    <div className="pt-3 border-t mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handleStartSummarize}
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
                      {renderTaskProgress(summarizeTask, 'summarize')}
                    </div>
                  )}

                  {renderStatsCard(
                    '图片文件',
                    <ImageIcon className="h-5 w-5 text-green-500" />,
                    stats?.image.total || 0,
                    [
                      { label: '未生成标签', count: stats?.image.noTags || 0, color: 'text-amber-600' },
                      { label: '未索引', count: stats?.image.notIndexed || 0, color: 'text-red-600' },
                    ],
                    <div className="pt-3 border-t mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handleStartTags}
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
                      {renderTaskProgress(tagsTask, 'tags')}
                    </div>
                  )}

                  {renderStatsCard('其他文件', <File className="h-5 w-5 text-gray-500" />, stats?.other.total || 0, [
                    { label: '未索引', count: stats?.other.notIndexed || 0, color: 'text-red-600' },
                  ])}
                </div>

                {/* 一键索引区域 */}
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
                      onClick={() => setShowConfirmDialog(true)}
                      disabled={task?.status === 'running'}
                      className="w-full sm:w-auto"
                    >
                      <Database className="h-4 w-4 mr-2" />
                      一键生成索引
                    </Button>
                  </div>

                  {renderTaskProgress(task, 'index')}
                </div>
              </>
            )}
          </div>
        )}

        {/* ========== 向量库标签页 ========== */}
        {activeTab === 'vectors' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-semibold">向量索引库</h2>
              <Button variant="outline" size="sm" onClick={() => refetchVectors()} disabled={isLoadingVectors}>
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
                          <td className="p-3 text-muted-foreground">
                            {vector.size ? formatFileSize(vector.size) : '-'}
                          </td>
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
                              onClick={() => handleDeleteVector(vector.id, vector.name)}
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

            {vectorsData && vectorsData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">共 {vectorsData.pagination.total} 条记录</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={vectorPage === 1}
                    onClick={() => setVectorPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <span>
                    {vectorPage} / {vectorsData.pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={vectorPage === vectorsData.pagination.totalPages}
                    onClick={() => setVectorPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== 任务中心标签页 ========== */}
        {activeTab === 'tasks' && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-semibold">任务监控中心</h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 索引任务 */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-500" />
                  <h3 className="font-medium">索引任务</h3>
                </div>
                {task && task.status !== 'idle' ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      状态：
                      <span
                        className={`font-medium ${
                          task.status === 'running'
                            ? 'text-blue-600'
                            : task.status === 'completed'
                              ? 'text-green-600'
                              : task.status === 'failed'
                                ? 'text-red-600'
                                : 'text-amber-600'
                        }`}
                      >
                        {task.status === 'running'
                          ? '运行中'
                          : task.status === 'completed'
                            ? '已完成'
                            : task.status === 'failed'
                              ? '失败'
                              : '已取消'}
                      </span>
                    </div>
                    {renderTaskProgress(task, 'index')}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground py-4 text-center">当前无索引任务</div>
                )}
              </div>

              {/* 摘要任务 */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-purple-500" />
                  <h3 className="font-medium">摘要生成任务</h3>
                </div>
                {summarizeTask && summarizeTask.status !== 'idle' ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      状态：
                      <span
                        className={`font-medium ${
                          summarizeTask.status === 'running'
                            ? 'text-blue-600'
                            : summarizeTask.status === 'completed'
                              ? 'text-green-600'
                              : summarizeTask.status === 'failed'
                                ? 'text-red-600'
                                : 'text-amber-600'
                        }`}
                      >
                        {summarizeTask.status === 'running'
                          ? '运行中'
                          : summarizeTask.status === 'completed'
                            ? '已完成'
                            : summarizeTask.status === 'failed'
                              ? '失败'
                              : '已取消'}
                      </span>
                    </div>
                    {renderTaskProgress(summarizeTask, 'summarize')}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground py-4 text-center">当前无摘要任务</div>
                )}
              </div>

              {/* 标签任务 */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-green-500" />
                  <h3 className="font-medium">标签生成任务</h3>
                </div>
                {tagsTask && tagsTask.status !== 'idle' ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      状态：
                      <span
                        className={cn(
                          'font-medium',
                          tagsTask.status === 'running' && 'text-blue-600',
                          tagsTask.status === 'completed' && 'text-green-600',
                          tagsTask.status === 'failed' && 'text-red-600',
                          tagsTask.status === 'cancelled' && 'text-amber-600'
                        )}
                      >
                        {tagsTask.status === 'running'
                          ? '运行中'
                          : tagsTask.status === 'completed'
                            ? '已完成'
                            : tagsTask.status === 'failed'
                              ? '失败'
                              : '已取消'}
                      </span>
                    </div>
                    {renderTaskProgress(tagsTask, 'tags')}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground py-4 text-center">当前无标签任务</div>
                )}
              </div>
            </div>

            {/* 总览统计 */}
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
        )}

        {/* ========== 高级配置标签页 ========== */}
        {activeTab === 'advanced' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">AI 系统配置</h2>
                <p className="text-sm text-muted-foreground mt-1">调整AI功能的核心参数和默认模型</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchSystemConfig()} disabled={configLoading}>
                {configLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                刷新
              </Button>
            </div>

            {configLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : systemConfigs.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <Sliders className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-medium mb-2">暂无配置项</h3>
                <p className="text-sm text-muted-foreground">系统配置尚未初始化</p>
              </div>
            ) : (
              <>
                {/* 按分类分组显示配置 */}
                {['model', 'parameter', 'limit', 'retry', 'prompt', 'feature'].map((category) => {
                  const categoryConfigs = systemConfigs.filter((c) => c.category === category);
                  if (categoryConfigs.length === 0) return null;

                  const categoryLabels: Record<string, string> = {
                    model: '🤖 默认模型',
                    parameter: '⚙️ 模型参数',
                    limit: '📏 内容限制',
                    retry: '🔄 重试策略',
                    prompt: '💬 提示词模板',
                    feature: '✨ 功能开关',
                  };

                  return (
                    <section key={category} className="border rounded-lg p-4 sm:p-6 space-y-4">
                      <h3 className="font-medium text-base sm:text-lg flex items-center gap-2">
                        {categoryLabels[category] || category}
                        <span className="text-xs text-muted-foreground font-normal">({categoryConfigs.length} 项)</span>
                      </h3>

                      <div className="space-y-3">
                        {categoryConfigs.map((config) => {
                          const isEditing = editingConfigKey === config.key;
                          const currentValue =
                            config.valueType === 'string'
                              ? (config.stringValue ?? '')
                              : config.valueType === 'number'
                                ? String(config.numberValue ?? '')
                                : config.valueType === 'boolean'
                                  ? String(config.booleanValue)
                                  : (config.jsonValue ?? '');

                          const isModelConfig = config.key.startsWith('ai.default_model.');
                          const requiredCapability = modelCapabilityMap[config.key];
                          const availableModels = requiredCapability === 'vision' ? visionModels : models;
                          const selectedModel = availableModels.find((m) => m.modelId === currentValue);

                          const renderInput = () => {
                            if (config.valueType === 'boolean') {
                              return (
                                <button
                                  onClick={() => {
                                    if (!config.isEditable) return;
                                    updateSystemConfigMutation.mutate({
                                      key: config.key,
                                      value: !config.booleanValue,
                                    });
                                  }}
                                  disabled={!config.isEditable || updateSystemConfigMutation.isPending}
                                  className={cn(
                                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
                                    config.booleanValue ? 'bg-primary' : 'bg-muted'
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                                      config.booleanValue ? 'translate-x-6' : 'translate-x-1'
                                    )}
                                  />
                                </button>
                              );
                            }

                            if (isModelConfig) {
                              return (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={currentValue}
                                    onChange={(e) => {
                                      const newValue = e.target.value;
                                      updateSystemConfigMutation.mutate({
                                        key: config.key,
                                        value: newValue,
                                      });
                                    }}
                                    disabled={!config.isEditable || updateSystemConfigMutation.isPending}
                                    className="flex-1 px-3 py-1.5 border rounded bg-background text-sm"
                                  >
                                    <option value={config.defaultValue}>
                                      {config.defaultValue} (系统默认)
                                    </option>
                                    {availableModels
                                      .filter((m) => m.modelId !== config.defaultValue)
                                      .map((m) => (
                                        <option key={m.id} value={m.modelId}>
                                          {m.name} ({m.provider})
                                        </option>
                                      ))}
                                  </select>
                                  {currentValue !== config.defaultValue && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        updateSystemConfigMutation.mutate({
                                          key: config.key,
                                          value: config.defaultValue,
                                        })
                                      }
                                      disabled={updateSystemConfigMutation.isPending}
                                      title="重置为默认值"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              );
                            }

                            if (isEditing) {
                              return (
                                <div className="flex gap-2">
                                  <input
                                    type={config.valueType === 'number' ? 'number' : 'text'}
                                    value={configEditValue}
                                    onChange={(e) => setConfigEditValue(e.target.value)}
                                    className="flex-1 px-3 py-1.5 border rounded bg-background text-sm font-mono"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveConfig(config);
                                      if (e.key === 'Escape') setEditingConfigKey(null);
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveConfig(config)}
                                    disabled={updateSystemConfigMutation.isPending}
                                  >
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setEditingConfigKey(null)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              );
                            }

                            return (
                              <div className="flex items-center gap-2">
                                <code className="px-2.5 py-1.5 bg-muted rounded text-sm font-mono flex-1 min-w-0 truncate">
                                  {currentValue || '(空)'}
                                </code>
                                {config.isEditable && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingConfigKey(config.key);
                                      setConfigEditValue(currentValue);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                )}
                              </div>
                            );
                          };

                          return (
                            <div
                              key={config.key}
                              className={cn('p-3 rounded-lg border space-y-2', !config.isEditable && 'opacity-75')}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{config.label}</span>
                                    {!config.isEditable && (
                                      <span className="px-1.5 py-0.5 bg-muted text-xs rounded text-muted-foreground">
                                        系统只读
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">Key: {config.key}</p>
                                </div>

                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {renderInput()}
                                  {config.defaultValue !== currentValue &&
                                    config.isEditable &&
                                    !isEditing &&
                                    !isModelConfig && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => resetSystemConfigMutation.mutate(config.key)}
                                        disabled={resetSystemConfigMutation.isPending}
                                        title="重置为默认值"
                                      >
                                        <RotateCcw className="h-3 w-3" />
                                      </Button>
                                    )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-muted-foreground">
                  💡 提示：修改配置后立即生效。如遇问题可点击重置按钮恢复默认值。
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 添加/编辑模型弹窗 */}
      {(showAddModal || editingModel) && (
        <ModelFormModal
          model={editingModel}
          providersData={providersData}
          onClose={() => {
            setShowAddModal(false);
            setEditingModel(null);
          }}
          onSubmit={(data) => {
            if (editingModel) {
              updateMutation.mutate({ modelId: editingModel.id, data });
            } else {
              createMutation.mutate(data as any);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* 确认索引对话框 */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowConfirmDialog(false)} />
          <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-lg mx-4 p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="font-semibold text-base sm:text-lg">确认生成全量索引</h4>
            </div>

            <div className="space-y-3 text-sm">
              <p>此操作将为所有未建立索引的文件生成向量索引，用于语义搜索功能。</p>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-2">
                <p className="font-medium text-amber-800 dark:text-amber-200">⚠️ 重要提示：</p>
                <ul className="text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                  <li>此操作将处理您的所有文件数据</li>
                  <li>任务将在后台异步执行，可能需要较长时间</li>
                  <li>大量文件可能消耗 AI API 配额</li>
                  <li>索引期间可随时查看进度</li>
                </ul>
              </div>
              <p className="text-muted-foreground">确认后，系统将在后台自动处理所有文件。</p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)} className="w-full sm:w-auto">
                取消
              </Button>
              <Button onClick={handleStartIndex} disabled={isStarting} className="w-full sm:w-auto">
                {isStarting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                确认开始
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 索引警告对话框 */}
      {showIndexWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowIndexWarning(false)} />
          <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-lg mx-4 p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="font-semibold text-base sm:text-lg">建议先完成预处理</h4>
            </div>

            <div className="space-y-3 text-sm">
              <p>检测到以下文件尚未完成AI预处理，直接索引可能影响搜索质量：</p>

              <div className="space-y-2">
                {stats?.editable.noSummary && stats.editable.noSummary > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="font-medium text-amber-800 dark:text-amber-200">
                      📄 {stats.editable.noSummary} 个可编辑文件未生成摘要
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      建议先批量生成摘要，提升语义理解质量
                    </p>
                  </div>
                )}

                {stats?.image.noTags && stats.image.noTags > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="font-medium text-amber-800 dark:text-amber-200">
                      🖼️ {stats.image.noTags} 个图片未生成标签
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      建议先批量生成标签，增强图片搜索能力
                    </p>
                  </div>
                )}
              </div>

              <p className="text-muted-foreground">您也可以选择直接索引，系统将使用文件名作为索引内容。</p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowIndexWarning(false)} className="w-full sm:w-auto">
                返回处理
              </Button>
              <Button onClick={executeStartIndex} disabled={isStarting} className="w-full sm:w-auto">
                {isStarting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                直接索引
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 添加/编辑模型表单弹窗
function ModelFormModal({
  model,
  providersData,
  onClose,
  onSubmit,
  isLoading,
}: {
  model: AiModel | null;
  providersData?: {
    providers: AiProvider[];
    workersAiModels: AiWorkersAiModel[];
    openAiModels: AiOpenAiModel[];
  };
  onClose: () => void;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: model?.name || '',
    provider: model?.provider || 'workers_ai',
    modelId: model?.modelId || '',
    customModelId: undefined as string | undefined,
    apiEndpoint: model?.apiEndpoint || '',
    apiKey: '',
    capabilities: model?.capabilities || ['chat'],
    maxTokens: model?.maxTokens || 4096,
    temperature: model?.temperature || 0.7,
    systemPrompt: model?.systemPrompt || '',
    isActive: model?.isActive || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData = { ...formData };
    if (formData.modelId === '__custom__' && formData.customModelId) {
      submitData.modelId = formData.customModelId;
      submitData.name = formData.customModelId.split('/').pop() || formData.name;
    }
    onSubmit(submitData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b sticky top-0 bg-card z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">{model ? '编辑模型' : '添加新模型'}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {/* 基本信息 */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm sm:text-base">基本信息</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">模型名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  placeholder="例如：我的 GPT-4"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">提供商 *</label>
                <select
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value as any })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                >
                  <option value="workers_ai">Cloudflare Workers AI</option>
                  <option value="openai_compatible">OpenAI 兼容 API</option>
                </select>
              </div>
            </div>

            {/* 模型选择 */}
            {formData.provider === 'workers_ai' && providersData?.workersAiModels ? (
              <div>
                <label className="block text-sm font-medium mb-1">选择模型 *</label>
                <select
                  value={formData.modelId || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const selectedModel = providersData.workersAiModels.find((m) => m.id === val);
                    setFormData({
                      ...formData,
                      modelId: val,
                      name: formData.name || selectedModel?.name || formData.name,
                      customModelId: val === '__custom__' ? '' : undefined,
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  required
                >
                  <option value="">请选择一个 Workers AI 模型</option>
                  {providersData.workersAiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id !== '__custom__' ? `(${m.id})` : ''}
                    </option>
                  ))}
                </select>

                {formData.modelId === '__custom__' && (
                  <div className="mt-2">
                    <label className="block text-xs text-muted mb-1">自定义模型 ID（@cf/ 开头）</label>
                    <input
                      type="text"
                      value={formData.customModelId || ''}
                      onChange={(e) => setFormData({ ...formData, customModelId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                      placeholder="@cf/deepseek/deepseek-r1 或 @cf/black-forest-labs/flux-2-klein-4b"
                      required
                    />
                    <p className="mt-1 text-xs text-muted">
                      可在{' '}
                      <a
                        href="https://developers.cloudflare.com/workers-ai/models/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Workers AI 模型目录
                      </a>{' '}
                      查看所有可用模型。免费额度：Workers Paid 计划每日约 10,000 neurons 免费，超出按 $0.0001/neuron
                      计费。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">模型 ID *</label>
                  <input
                    type="text"
                    value={formData.modelId}
                    onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                    placeholder="例如：gpt-4o、claude-3-opus-20240229"
                    required
                  />
                  {providersData?.openAiModels && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {providersData.openAiModels.slice(0, 8).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              modelId: m.id,
                              capabilities: m.capabilities.length > 0 ? [...m.capabilities] : ['chat'],
                            })
                          }
                          className={`px-2 py-1 text-xs border rounded transition-colors ${
                            formData.modelId === m.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                          }`}
                          title={m.description}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">API 端点 *</label>
                  <input
                    type="url"
                    value={formData.apiEndpoint}
                    onChange={(e) => setFormData({ ...formData, apiEndpoint: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background font-mono text-sm"
                    placeholder="https://api.openai.com/v1"
                    required={formData.provider === 'openai_compatible'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    <Key className="h-3 w-3 inline mr-1" />
                    API Key
                  </label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                    placeholder={model?.hasApiKey ? '保持原密钥不变，留空则不修改' : '输入 API Key'}
                  />
                  {model?.hasApiKey && !formData.apiKey && (
                    <p className="text-xs text-muted-foreground mt-1">当前已配置密钥，留空则保持不变</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 高级设置 */}
          <div className="space-y-3 pt-4 border-t">
            <h3 className="font-medium text-sm sm:text-base">高级设置</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">最大 Token (K)</label>
                <input
                  type="number"
                  value={Math.round(formData.maxTokens / 1000)}
                  onChange={(e) => setFormData({ ...formData, maxTokens: (parseInt(e.target.value) || 4) * 1000 })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  min={1}
                  max={128}
                />
                <p className="text-xs text-muted-foreground mt-1">输入值单位为 K，如 4 表示 4K tokens</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">温度 (0-2)</label>
                <input
                  type="number"
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.7 })}
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  min={0}
                  max={2}
                  step={0.1}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">系统提示词</label>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                rows={3}
                placeholder="自定义系统提示词..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                模型能力 *<span className="text-xs text-muted-foreground ml-1">（决定该模型可用于哪些功能）</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'chat', label: '💬 对话', desc: '文本对话、摘要生成' },
                  { value: 'vision', label: '👁️ 视觉', desc: '图片理解（如 GPT-4o）' },
                  { value: 'embedding', label: '📊 向量', desc: '文本向量化' },
                  { value: 'function_calling', label: '⚡ 函数调用', desc: '工具调用能力' },
                  { value: 'completion', label: '✏️ 补全', desc: '文本补全' },
                ].map((cap) => (
                  <label
                    key={cap.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                      formData.capabilities.includes(cap.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.capabilities.includes(cap.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, capabilities: [...formData.capabilities, cap.value] });
                        } else {
                          setFormData({
                            ...formData,
                            capabilities: formData.capabilities.filter((c) => c !== cap.value),
                          });
                        }
                      }}
                      className="rounded"
                    />
                    <span>{cap.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                💡 图片描述功能需要选择「视觉」能力的模型（如 GPT-4o、Claude 3）
              </p>
            </div>

            {!model && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">设为当前激活模型</span>
              </label>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              取消
            </Button>
            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {model ? '保存修改' : '添加模型'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
