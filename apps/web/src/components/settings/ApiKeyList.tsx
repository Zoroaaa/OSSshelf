/**
 * ApiKeyList.tsx
 * API Key 列表组件
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../ui/useToast';
import ApiKeyCreateDialog from './ApiKeyCreateDialog';
import ApiKeyShowOnceDialog from './ApiKeyShowOnceDialog';
import { apiKeysApi, type ApiKey } from '@/services/api';

const SCOPE_LABELS: Record<string, string> = {
  'files:read': '读取文件',
  'files:write': '写入文件',
  'shares:read': '查看分享',
  'shares:write': '管理分享',
  'buckets:read': '查看存储桶',
  'admin:read': '管理员权限',
};

const ApiKeyList: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyData, setNewKeyData] = useState<{ key: string; id: string } | null>(null);
  const { toast } = useToast();

  const fetchKeys = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiKeysApi.list();
      if (res.data.success && res.data.data) {
        setKeys(res.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
      toast({ title: '加载失败', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleDelete = async (keyId: string, keyName: string) => {
    if (!confirm(`确定要删除 API Key "${keyName}" 吗？此操作不可撤销。`)) return;

    try {
      const res = await apiKeysApi.delete(keyId);
      if (res.data.success) {
        toast({ title: 'API Key 已删除' });
        fetchKeys();
      }
    } catch (error) {
      console.error('Failed to delete API key:', error);
      toast({ title: '删除失败', variant: 'destructive' });
    }
  };

  const handleToggleActive = async (keyId: string, currentActive: boolean) => {
    try {
      const res = await apiKeysApi.update(keyId, { isActive: !currentActive });
      if (res.data.success) {
        toast({ title: currentActive ? 'API Key 已禁用' : 'API Key 已启用' });
        fetchKeys();
      }
    } catch (error) {
      console.error('Failed to toggle API key:', error);
      toast({ title: '操作失败', variant: 'destructive' });
    }
  };

  const handleCreated = (keyId: string, key: string) => {
    setNewKeyData({ id: keyId, key });
    setIsCreateOpen(false);
    fetchKeys();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '从未';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">API Keys</h2>
        <Button onClick={() => setIsCreateOpen(true)}>创建 API Key</Button>
      </div>

      {keys.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <p className="text-gray-500">暂无 API Key</p>
          <p className="text-sm text-gray-400 mt-1">创建一个 API Key 用于程序化访问</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className={`bg-white dark:bg-gray-800 rounded-lg border p-4 ${
                !key.isActive || isExpired(key.expiresAt)
                  ? 'border-red-200 dark:border-red-800 opacity-60'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{key.name}</h3>
                    {!key.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded">已禁用</span>
                    )}
                    {isExpired(key.expiresAt) && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded">已过期</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 font-mono mt-1">{key.keyPrefix}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleActive(key.id, key.isActive)}
                    className={`px-3 py-1 text-sm rounded ${
                      key.isActive
                        ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'
                        : 'bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900 dark:hover:bg-green-800'
                    }`}
                  >
                    {key.isActive ? '禁用' : '启用'}
                  </button>
                  <button
                    onClick={() => handleDelete(key.id, key.name)}
                    className="px-3 py-1 text-sm rounded bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900 dark:hover:bg-red-800"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {key.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded"
                  >
                    {SCOPE_LABELS[scope] || scope}
                  </span>
                ))}
              </div>

              <div className="mt-3 text-xs text-gray-500 flex gap-4">
                <span>创建于 {formatDate(key.createdAt)}</span>
                <span>最后使用 {formatDate(key.lastUsedAt)}</span>
                {key.expiresAt && <span>过期时间 {formatDate(key.expiresAt)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isCreateOpen && <ApiKeyCreateDialog onClose={() => setIsCreateOpen(false)} onCreated={handleCreated} />}

      {newKeyData && <ApiKeyShowOnceDialog apiKey={newKeyData.key} onClose={() => setNewKeyData(null)} />}
    </div>
  );
};

export default ApiKeyList;
