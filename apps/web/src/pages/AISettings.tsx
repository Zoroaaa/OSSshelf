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
import { useParams, useNavigate } from 'react-router-dom';
import {
  Cpu,
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
  CheckCircle,
  MessageSquare,
  AlertTriangle,
  Zap,
  Database,
  Layers,
  Sliders,
  X,
  FileText,
  Sparkles,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  ModelCard,
  ModelFormModal,
  ProvidersSection,
  IndexProcessingTab,
  VectorsTable,
  AdvancedConfigPanel,
  ProviderManageModal,
} from '@/components/ai/settings';
import { aiApi, type AiModel, type AiProviderItem, type AiSystemConfigItem } from '@/services/api';
import type { AIIndexTask, AISummarizeTask, AITagsTask, AIIndexStats } from '@/services/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type TabType = 'models' | 'providers' | 'index' | 'vectors' | 'advanced' | 'memory';

export function AISettings() {
  const { tab: urlTab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>((urlTab as TabType) || 'models');
  const [showAddModal, setShowAddModal] = useState(false);

  const handleTabChange = (tabId: TabType) => {
    setActiveTab(tabId);
    navigate(`/ai-settings/${tabId}`, { replace: true });
  };
  const [showProviderModal, setShowProviderModal] = useState(false);
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

  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string>('');
  const [memoryPage, setMemoryPage] = useState(1);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);

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

  const { data: allProviders = [] } = useQuery<AiProviderItem[]>({
    queryKey: ['ai-all-providers'],
    queryFn: () => aiApi.config.getAiProviders().then((r) => r.data.data ?? []),
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
    mutationFn: (fileId: string) => aiApi.deleteIndex(fileId),
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

  // 向量索引详情相关状态
  const [sampleData, setSampleData] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleViewDetail = async (fileId: string) => {
    setLoadingDetail(true);
    try {
      const res = await aiApi.getIndexSample(fileId);
      setSampleData(res.data.data);
      setShowDetailModal(true);
    } catch (error) {
      toast({ title: '加载失败', description: '无法获取向量索引详情', variant: 'destructive' });
    } finally {
      setLoadingDetail(false);
    }
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

  const { data: memoriesData, isLoading: isLoadingMemories } = useQuery({
    queryKey: ['ai-memories', memoryTypeFilter, memoryPage],
    queryFn: () =>
      aiApi.memories
        .list({ type: memoryTypeFilter || undefined, limit: 20, offset: (memoryPage - 1) * 20 })
        .then((r) => r.data.data),
    staleTime: 30000,
  });

  const deleteMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => aiApi.memories.delete(memoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
      setDeletingMemoryId(null);
    },
    onError: () => {
      setDeletingMemoryId(null);
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
    { id: 'memory', label: '记忆管理', icon: MessageSquare },
    { id: 'advanced', label: '高级配置', icon: Sliders },
  ];

  return (
    <div className="space-y-6">
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-6 py-4 sm:py-5 bg-gradient-to-r from-purple-50 via-white to-pink-50 dark:from-purple-950/30 dark:via-slate-900 dark:to-pink-950/30 border-b shadow-sm rounded-t-lg">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 sm:p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-lg shadow-purple-500/25">
                <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">AI 配置中心</h1>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                  模型管理 · 索引配置 · 向量搜索 · 高级配置
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

          <div className="mt-4">
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
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

      <div className="py-2">
        {activeTab === 'models' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">已配置的模型</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowProviderModal(true)}
                  className="gap-2 flex-1 sm:flex-initial"
                >
                  <Sliders className="h-4 w-4" />
                  管理提供商
                </Button>
                <Button onClick={() => setShowAddModal(true)} className="gap-2 flex-1 sm:flex-initial">
                  <Plus className="h-4 w-4" />
                  添加模型
                </Button>
              </div>
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
              <div className="space-y-8">
                {(() => {
                  // 按 providerId 分组：workers_ai 单独组，有 providerId 的归属对应提供商，其余归 ungrouped
                  const groups: Record<string, AiModel[]> = {};
                  models.forEach((model) => {
                    let key: string;
                    if (model.provider === 'workers_ai') {
                      key = 'workers_ai';
                    } else if (model.providerId) {
                      key = `provider_${model.providerId}`;
                    } else {
                      key = 'openai_compatible_ungrouped';
                    }
                    if (!groups[key]) groups[key] = [];
                    (groups[key] as AiModel[]).push(model);
                  });

                  const getGroupMeta = (key: string): { name: string; description?: string; isSystem?: boolean } => {
                    if (key === 'workers_ai')
                      return { name: 'Cloudflare Workers AI', description: '免费额度，零配置', isSystem: true };
                    if (key === 'openai_compatible_ungrouped')
                      return { name: '其他 OpenAI 兼容 API', description: '手动配置端点' };
                    const providerId = key.replace('provider_', '');
                    const found = allProviders.find((p) => p.id === providerId);
                    return found
                      ? {
                          name: found.name,
                          description: found.description || found.apiEndpoint,
                          isSystem: found.isSystem,
                        }
                      : { name: '未知提供商' };
                  };

                  const sortedKeys = Object.keys(groups).sort((a, b) => {
                    if (a === 'workers_ai') return -1;
                    if (b === 'workers_ai') return 1;
                    if (a === 'openai_compatible_ungrouped') return 1;
                    if (b === 'openai_compatible_ungrouped') return -1;
                    return getGroupMeta(a).name.localeCompare(getGroupMeta(b).name);
                  });

                  return sortedKeys.map((key) => {
                    const groupModels = (groups[key] as AiModel[]).sort(
                      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
                    );
                    const meta = getGroupMeta(key);
                    const activeCount = groupModels.filter((m) => m.isActive).length;

                    return (
                      <div key={key}>
                        <div className="flex items-center gap-3 mb-3 pb-2 border-b">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-semibold">{meta.name}</h3>
                              {meta.isSystem && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500">
                                  系统
                                </span>
                              )}
                              {activeCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
                                  {activeCount} 个激活
                                </span>
                              )}
                            </div>
                            {meta.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{meta.description}</p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {groupModels.length} 个模型
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {groupModels.map((model) => (
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
                              isTesting={
                                testModelMutation.isPending && testModelMutation.variables?.modelId === model.id
                              }
                            />
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
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
            onViewDetail={handleViewDetail}
            onRefresh={() => refetchVectors()}
            onPageChange={setVectorPage}
          />
        )}

        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">AI 记忆管理</h2>
              <div className="flex items-center gap-2">
                <select
                  value={memoryTypeFilter}
                  onChange={(e) => {
                    setMemoryTypeFilter(e.target.value);
                    setMemoryPage(1);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                >
                  <option value="">全部类型</option>
                  <option value="operation">操作记录</option>
                  <option value="preference">用户偏好</option>
                  <option value="path">常用路径</option>
                  <option value="file_ref">文件引用</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['ai-memories'] })}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </Button>
              </div>
            </div>

            {isLoadingMemories ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !memoriesData || memoriesData.items.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-medium mb-2">暂无记忆数据</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  与 AI 对话后，系统会自动提取并保存有价值的记忆信息
                </p>
              </div>
            ) : (
              <>
                <div className="text-sm text-muted-foreground mb-2">共 {memoriesData.total} 条记忆</div>
                <div className="space-y-2">
                  {memoriesData.items.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                    >
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          m.type === 'operation'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : m.type === 'preference'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                              : m.type === 'path'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}
                      >
                        {m.type === 'operation'
                          ? '操作'
                          : m.type === 'preference'
                            ? '偏好'
                            : m.type === 'path'
                              ? '路径'
                              : '引用'}
                      </span>
                      <p className="flex-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{m.summary}</p>
                      <span className="flex-shrink-0 text-[11px] text-slate-400 whitespace-nowrap">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => {
                          if (confirm('确定要删除这条记忆吗？')) {
                            setDeletingMemoryId(m.id);
                            deleteMemoryMutation.mutate(m.id);
                          }
                        }}
                        disabled={deletingMemoryId === m.id && deleteMemoryMutation.isPending}
                        className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-all"
                        title="删除记忆"
                      >
                        {deletingMemoryId === m.id && deleteMemoryMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {memoriesData.total > 20 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={memoryPage <= 1}
                      onClick={() => setMemoryPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {memoryPage} / {Math.ceil(memoriesData.total / 20)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={memoryPage >= Math.ceil(memoriesData.total / 20)}
                      onClick={() => setMemoryPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
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

      {showProviderModal && (
        <ProviderManageModal
          onClose={() => setShowProviderModal(false)}
          onProviderChange={() => {
            queryClient.invalidateQueries({ queryKey: ['ai-models'] });
            queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
          }}
        />
      )}

      {/* 向量索引详情弹窗 */}
      {showDetailModal && sampleData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDetailModal(false)}>
          <div
            className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  向量索引详情
                </h2>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-6">查看文件的向量化详细信息</p>

              <div className="space-y-4">
                {/* 文件基本信息卡片 */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      文件信息
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">文件名:</span>
                        <span className="font-medium truncate ml-2 max-w-[200px]" title={sampleData.file?.name}>
                          {sampleData.file?.name || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">文件类型:</span>
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {sampleData.file?.mimeType || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">索引状态:</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
                          !!sampleData.file?.vectorIndexedAt
                            ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                          {!!sampleData.file?.vectorIndexedAt ? (
                            <>
                              <CheckCircle className="h-3 w-3" />
                              已索引
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3" />
                              未索引
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 索引状态卡片 */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      索引状态
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!!sampleData.file?.vectorIndexedAt ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">索引时间:</span>
                          <span>
                            {sampleData.file?.vectorIndexedAt
                              ? new Date(sampleData.file.vectorIndexedAt).toLocaleString('zh-CN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">文本长度:</span>
                          <span>{sampleData.indexedText?.length?.toLocaleString() || 0} 字符</span>
                        </div>
                        {sampleData.vectorize?.metadata && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">向量元数据:</span>
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate" title={JSON.stringify(sampleData.vectorize.metadata)}>
                              {Object.keys(sampleData.vectorize.metadata).join(', ') || '-'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        该文件尚未建立向量索引
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* 索引文本预览卡片 */}
                {sampleData.indexedText && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        索引文本预览
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted/50 rounded-lg p-4 max-h-[300px] overflow-y-auto border">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                          {sampleData.indexedText.length > 1000
                            ? `${sampleData.indexedText.substring(0, 1000)}...`
                            : sampleData.indexedText}
                        </pre>
                      </div>
                      {sampleData.indexedText.length > 1000 && (
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          已截断显示，完整内容共 {sampleData.indexedText.length.toLocaleString()} 字符
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* 元数据JSON卡片 */}
                {sampleData.vectorize?.metadata && Object.keys(sampleData.vectorize.metadata).length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <details className="cursor-pointer group">
                        <summary className="flex items-center gap-2 list-none">
                          <Layers className="h-4 w-4" />
                          <CardTitle className="text-base inline-flex items-center gap-2 group-hover:text-primary transition-colors">
                            元数据 (JSON)
                            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                          </CardTitle>
                        </summary>
                      </details>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto font-mono border">
                        {JSON.stringify(sampleData.vectorize.metadata, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
