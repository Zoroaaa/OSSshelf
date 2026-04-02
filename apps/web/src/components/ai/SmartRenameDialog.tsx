/**
 * SmartRenameDialog.tsx
 * 智能重命名对话框
 */

import { useState, useEffect } from 'react';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { aiApi, batchApi } from '@/services/api';
import { Button } from '@/components/ui/Button';

interface SmartRenameDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  currentName: string;
  onRenamed?: (newName: string) => void;
}

export function SmartRenameDialog({ open, onClose, fileId, currentName, onRenamed }: SmartRenameDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadSuggestions();
    }
  }, [open, fileId]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await aiApi.suggestRename(fileId);
      if (response.data.success && response.data.data) {
        setSuggestions(response.data.data.suggestions);
        if (response.data.data.suggestions.length > 0) {
          setSelectedName(response.data.data.suggestions[0] || '');
        }
      }
    } catch (e: any) {
      setError(e.response?.data?.error?.message || '获取建议失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRename = async () => {
    if (!selectedName || selectedName === currentName) {
      onClose();
      return;
    }

    setIsRenaming(true);
    try {
      await batchApi.rename([{ fileId, newName: selectedName }]);
      onRenamed?.(selectedName);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error?.message || '重命名失败');
    } finally {
      setIsRenaming(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">智能重命名</h2>
        </div>

        <div className="text-sm text-muted-foreground">当前名称：{currentName}</div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium">AI 建议：</label>
            {suggestions.length > 0 ? (
              <div className="space-y-2">
                {suggestions.map((name) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedName === name ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedName(name)}
                  >
                    <span className="text-sm">{name}</span>
                    {selectedName === name && <Check className="h-4 w-4 text-primary" />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无建议</p>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">自定义名称：</label>
              <input
                type="text"
                value={selectedName}
                onChange={(e) => setSelectedName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleRename} disabled={!selectedName || isRenaming || isLoading}>
            {isRenaming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            确认重命名
          </Button>
        </div>
      </div>
    </div>
  );
}
