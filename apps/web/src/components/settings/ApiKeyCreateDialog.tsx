/**
 * ApiKeyCreateDialog.tsx
 * 创建 API Key 弹窗组件
 */

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../ui/useToast';
import { apiKeysApi } from '@/services/api';

interface ApiKeyCreateDialogProps {
  onClose: () => void;
  onCreated: (id: string, key: string) => void;
}

const SCOPE_OPTIONS = [
  { value: 'files:read', label: '读取文件', description: '列出、下载、搜索文件' },
  { value: 'files:write', label: '写入文件', description: '上传、修改、删除文件' },
  { value: 'shares:read', label: '查看分享', description: '查看分享信息' },
  { value: 'shares:write', label: '管理分享', description: '创建、删除分享' },
  { value: 'buckets:read', label: '查看存储桶', description: '查看存储桶配置' },
];

const ApiKeyCreateDialog: React.FC<ApiKeyCreateDialogProps> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['files:read']);
  const [expiresIn, setExpiresIn] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const handleToggleScope = (scope: string) => {
    setSelectedScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({ title: '请输入名称', variant: 'destructive' });
      return;
    }

    if (selectedScopes.length === 0) {
      toast({ title: '请至少选择一个权限', variant: 'destructive' });
      return;
    }

    setIsCreating(true);

    try {
      let expiresAt: string | undefined;
      if (expiresIn) {
        const days = parseInt(expiresIn, 10);
        const date = new Date();
        date.setDate(date.getDate() + days);
        expiresAt = date.toISOString();
      }

      const res = await apiKeysApi.create({
        name: name.trim(),
        scopes: selectedScopes,
        expiresAt,
      });

      if (res.data.success && res.data.data) {
        onCreated(res.data.data.id, res.data.data.key);
      }
    } catch (error) {
      console.error('Failed to create API key:', error);
      toast({
        title: error instanceof Error ? error.message : '创建失败',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md">
        <form onSubmit={handleSubmit}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold">创建 API Key</h3>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                placeholder="例如：自动化脚本"
                maxLength={100}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">权限</label>
              <div className="space-y-2">
                {SCOPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(option.value)}
                      onChange={() => handleToggleScope(option.value)}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-sm">{option.label}</div>
                      <div className="text-xs text-gray-500">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">过期时间（可选）</label>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
              >
                <option value="">永不过期</option>
                <option value="7">7 天后过期</option>
                <option value="30">30 天后过期</option>
                <option value="90">90 天后过期</option>
                <option value="365">1 年后过期</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isCreating || selectedScopes.length === 0}>
              {isCreating ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApiKeyCreateDialog;
