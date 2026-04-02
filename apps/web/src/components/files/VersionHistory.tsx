/**
 * VersionHistory.tsx
 * 文件版本历史组件
 *
 * 功能:
 * - 显示文件版本历史列表
 * - 版本回滚
 * - 版本下载
 * - 版本删除
 * - 版本设置
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { getErrorMessage } from '@/services/errorHandler';
import api from '@/services/api';
import { formatBytes } from '@/utils';
import { FileIcon } from './FileIcon';

interface VersionInfo {
  id: string;
  version: number;
  size: number;
  mimeType: string | null;
  changeSummary: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface VersionHistoryProps {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  onClose: () => void;
  onVersionRestored?: () => void;
}

export function VersionHistory({ fileId, fileName, mimeType, onClose, onVersionRestored }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [maxVersions, setMaxVersions] = useState(10);
  const [versionRetentionDays, setVersionRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    maxVersions: 10,
    versionRetentionDays: 30,
  });

  useEffect(() => {
    loadVersions();
  }, [fileId]);

  const loadVersions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/versions/${fileId}/versions`);
      if (response.data.success) {
        setVersions(response.data.data.versions);
        setCurrentVersion(response.data.data.currentVersion);
        setMaxVersions(response.data.data.maxVersions);
        setVersionRetentionDays(response.data.data.versionRetentionDays);
        setSettingsForm({
          maxVersions: response.data.data.maxVersions,
          versionRetentionDays: response.data.data.versionRetentionDays,
        });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (version: number) => {
    if (!confirm(`确定要恢复到版本 ${version} 吗？这将创建一个新版本。`)) return;

    setActionLoading(`restore-${version}`);
    setError(null);
    try {
      const response = await api.post(`/api/versions/${fileId}/versions/${version}/restore`);
      if (response.data.success) {
        await loadVersions();
        onVersionRestored?.();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownload = async (version: number) => {
    setActionLoading(`download-${version}`);
    try {
      const response = await api.get(`/api/versions/${fileId}/versions/${version}/download`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (version: number) => {
    if (!confirm(`确定要删除版本 ${version} 吗？此操作不可撤销。`)) return;

    setActionLoading(`delete-${version}`);
    setError(null);
    try {
      const response = await api.delete(`/api/versions/${fileId}/versions/${version}`);
      if (response.data.success) {
        await loadVersions();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveSettings = async () => {
    setActionLoading('settings');
    setError(null);
    try {
      const response = await api.patch(`/api/versions/${fileId}/version-settings`, settingsForm);
      if (response.data.success) {
        setMaxVersions(settingsForm.maxVersions);
        setVersionRetentionDays(settingsForm.versionRetentionDays);
        setShowSettings(false);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[80vh] shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <FileIcon mimeType={mimeType} size="md" />
            <div>
              <h2 className="text-lg font-semibold">{fileName}</h2>
              <p className="text-sm text-muted-foreground">版本历史</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
              设置
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="p-4 border-b bg-muted/50">
            <h3 className="font-medium mb-3">版本设置</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">最大版本数</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settingsForm.maxVersions}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maxVersions: parseInt(e.target.value) || 10 })}
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">版本保留天数</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settingsForm.versionRetentionDays}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, versionRetentionDays: parseInt(e.target.value) || 30 })
                  }
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowSettings(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleSaveSettings} disabled={actionLoading === 'settings'}>
                {actionLoading === 'settings' ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        )}

        {error && <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b">{error}</div>}

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无版本历史记录</div>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => {
                const isCurrent = v.version === currentVersion;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isCurrent ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        }`}
                      >
                        {v.version}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">版本 {v.version}</span>
                          {isCurrent && (
                            <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">当前版本</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatBytes(v.size)} · {formatDate(v.createdAt)}
                        </div>
                        {v.changeSummary && <div className="text-sm text-muted-foreground">{v.changeSummary}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(v.version)}
                        disabled={actionLoading?.startsWith('download')}
                      >
                        {actionLoading === `download-${v.version}` ? '下载中...' : '下载'}
                      </Button>
                      {!isCurrent && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestore(v.version)}
                            disabled={actionLoading?.startsWith('restore')}
                          >
                            {actionLoading === `restore-${v.version}` ? '恢复中...' : '恢复'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(v.version)}
                            disabled={actionLoading?.startsWith('delete')}
                          >
                            {actionLoading === `delete-${v.version}` ? '删除中...' : '删除'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t text-sm text-muted-foreground">
          共 {versions.length} 个版本 · 最多保留 {maxVersions} 个版本 · 保留 {versionRetentionDays} 天
        </div>
      </div>
    </div>
  );
}
