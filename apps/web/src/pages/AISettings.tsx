/**
 * AISettings.tsx
 * AI 配置管理中心
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
  AlertCircle,
  Loader2,
  RefreshCw,
  CheckCircle,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  Zap,
  Database,
  Layers,
  Sliders,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModelCard, ModelFormModal, ProvidersSection, IndexProcessingTab, VectorsTable, TasksCenter, AdvancedConfigPanel } from '@/components/ai/settings';
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

type TabType = 'models' | 'providers' | 'index' | 'vectors' | 'tasks' | 'advanced';

export function AISettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabType>('models');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);

  const [task, setTask] = useState<AIIndexTask | null>(null);
  const [summarizeTask, setSummarizeTask] = useState<AISummarizeTask | null>(null);
  const [tagsTask, setTagsTask] = useState<AITagsTask | null>(null);
  const [stats, setStats] = useState<AIIndexStats | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingSummarize, setIsStartingSummarize] = useState(false);
  const [isStartingTags, setIsStartingTags] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [featureConfig, setFeatureConfig] = useState<{
    summary: string | null;
    imageCaption: string | null;
    imageTag: string | null;
    rename: string | null;
  } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [vectorPage, setVectorPage] = useState(1);
  const [deletingVectorId, setDeletingVectorId] = useState<string | null>(null);

  const [editingConfigKey, setEditingConfigKey] = useState<string | null>(null);
  const [configEditValue, setConfigEditValue] = useState('');

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiApi.config.getModels().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const { data: visionModels = [] } = useQuery({
    queryKey: ['ai-models', 'vision'],
    queryFn: () => aiApi.config.getModels('vision').then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const modelCapabilityMap: Record<string, 'chat' | 'vision'> = {
    'ai.default_model.chat': 'chat',
    'ai.default_model.vision': 'vision',
    'ai.default_model.summary': 'chat',
    'ai.default_model.image_caption': 'vision',
    'ai.default_model.image_tag': 'vision',
    'ai.default_model.rename': 'chat',
  };

  const { data: status } = useQuery({
    queryKey: ['ai-config-status'],
    queryFn: () => aiApi.config.getStatus().then((r) => r.data.data),
    staleTime: 30000,
  });

  const { data: providersData } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiApi.config.getProviders().then((r) => r.data.data),
    staleTime: 300000,
  });

  const {
    data: systemConfigs = [],
    isLoading: configLoading,
    refetch: refetchSystemConfig,
  } = useQuery({
    queryKey: ['ai-system-config'],
    queryFn: () => aiApi.config.getSystemConfig().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

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

  const handleFeatureConfigChange = (feature: string, value: string) => {
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

  const quickActivateMutation = useMutation({
    mutationFn: async (workersAiModelId: string) => {
      const existingModel = models.find((m) => m.provider === 'workers_ai' && m.modelId === workersAiModelId);
      if (existingModel) {
        await aiApi.config.activateModel(existingModel.id);
        return { action: 'activated', modelId: existingModel.id };
      } else {
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
      setShowConfirmDialog(true);
      return;
    }
    executeStartIndex();
  };

  const executeStartIndex = async () => {
    setIsStarting(true);
    setShowConfirmDialog(false);
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
      if (taskType === 'index') await aiApi.cancelIndexTask();
      else if (taskType === 'summarize') await aiApi.cancelSummarizeTask();
      else await aiApi.cancelTagsTask();
      await fetchAllTaskStatus();
    } catch (e: any) {
      console.error('Failed to reset task:', e);
    }
  };

  const handleSaveConfig = (config: AiSystemConfigItem) => {
    let value: string | number | boolean = configEditValue;
    if (config.valueType === 'number') value = Number(configEditValue);
    else if (config.valueType === 'boolean') value = configEditValue === 'true';
    updateSystemConfigMutation.mutate({ key: config.key, value });
  };

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

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {activeTab === 'models' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">已配置的模型</h2>
              <Button onClick={() => setShowAddModal(true)} className="gap-2 w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                添加模型
              </Button>
            </div>

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

        {activeTab === 'providers' && (
          <ProvidersSection
            models={models}
            status={status ?? null}
            providersData={providersData}
            quickActivateMutation={quickActivateMutation}
          />
        )}

        {activeTab === 'index' && (
          <IndexProcessingTab
            isAIAvailable={!!isAIAvailable}
            onSwitchToModels={() => setActiveTab('models')}
            stats={stats}
            featureConfig={featureConfig}
            models={models}
            visionModels={visionModels}
            providersData={providersData}
            configLoading={configLoading}
            isSavingConfig={isSavingConfig}
            task={task}
            summarizeTask={summarizeTask}
            tagsTask={tagsTask}
            isStartingSummarize={isStartingSummarize}
            isStartingTags={isStartingTags}
            onStartSummarize={handleStartSummarize}
            onStartTags={handleStartTags}
            onStartIndex={handleStartIndex}
            onFeatureConfigChange={handleFeatureConfigChange}
          />
        )}

        {activeTab === 'vectors' && (
          <VectorsTable
            vectorsData={vectorsData}
            isLoadingVectors={isLoadingVectors}
            vectorsError={vectorsError as Error | null}
            deletingVectorId={deletingVectorId}
            currentPage={vectorPage}
            totalPages={vectorsData?.pagination.totalPages || 1}
            totalRecords={vectorsData?.pagination.total || 0}
            formatFileSize={formatFileSize}
            onDeleteVector={handleDeleteVector}
            onRefresh={() => refetchVectors()}
            onPageChange={setVectorPage}
          />
        )}

        {activeTab === 'tasks' && (
          <TasksCenter
            task={task}
            summarizeTask={summarizeTask}
            tagsTask={tagsTask}
            stats={stats}
            onCancelTask={handleForceResetTask}
          />
        )}

        {activeTab === 'advanced' && (
          <AdvancedConfigPanel
            systemConfigs={systemConfigs}
            configLoading={configLoading}
            models={models}
            visionModels={visionModels}
            modelCapabilityMap={modelCapabilityMap}
            editingConfigKey={editingConfigKey}
            configEditValue={configEditValue}
            onRefetch={() => refetchSystemConfig()}
            onSave={handleSaveConfig}
            onSetEditingKey={setEditingConfigKey}
            onSetConfigEditValue={setConfigEditValue}
            onUpdateMutation={(params) => updateSystemConfigMutation.mutate(params)}
            onResetMutation={(key) => resetSystemConfigMutation.mutate(key)}
            isUpdatePending={updateSystemConfigMutation.isPending}
            isResetPending={resetSystemConfigMutation.isPending}
          />
        )}
      </div>

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
              <Button onClick={executeStartIndex} disabled={isStarting} className="w-full sm:w-auto">
                {isStarting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                确认开始
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
