/**
 * FileEditor.tsx
 * 文件编辑器主组件
 *
 * 功能:
 * - 根据文件类型选择编辑器
 * - 支持语法高亮
 * - 保存时创建版本快照
 *
 * 审查修复：
 * - P0-01：主容器 z-overlay(50)，注册全局弹窗栈（FAB 自动隐藏）；
 *          保存确认框 z-popover(60) 替代无效类 z-60，消除保存按钮被遮挡。
 * - A-20 ：未保存关闭确认改用全局 confirmAction，移除原生 confirm。
 * - E-03 ：内容加载失败不再直接关闭编辑器，改为内联错误态 + 重试（优雅降级）。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../ui/useToast';
import { ErrorState } from '../ui/AsyncState';
import { confirmAction, useConfirmStore } from '../ui/useConfirm';
import { useDialogRegistration } from '@/lib/dialogStack';
import CodeEditor from './CodeEditor';
import TextEditor from './TextEditor';
import { fileContentApi } from '@/services/api';

interface FileEditorProps {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

const EDITABLE_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'text/css',
  'text/javascript',
  'text/xml',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
];

const LANGUAGE_MAP: Record<string, string> = {
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/html': 'html',
  'text/css': 'css',
  'application/json': 'json',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'text/markdown': 'markdown',
  'text/x-python': 'python',
  'text/x-go': 'go',
  'text/x-rust': 'rust',
  'text/x-java': 'java',
  'text/x-c': 'c',
  'text/x-cpp': 'cpp',
  'text/x-csharp': 'csharp',
  'text/x-php': 'php',
  'text/x-ruby': 'ruby',
  'text/x-shellscript': 'shell',
  'application/x-yaml': 'yaml',
  'application/yaml': 'yaml',
  'text/x-yaml': 'yaml',
  'text/x-sql': 'sql',
  'application/x-sql': 'sql',
};

const FileEditor: React.FC<FileEditorProps> = ({ fileId, fileName, mimeType, onClose, onSaved }) => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const { toast } = useToast();
  const confirmOpen = useConfirmStore((s) => s.options !== null);

  // 注册到全局弹窗栈：编辑器打开时 FAB 隐藏、背景滚动锁生效
  useDialogRegistration(true, `file-editor-${fileId}`);
  // 保存确认框为嵌套弹窗，单独注册（层级递增）
  useDialogRegistration(showSaveDialog, `file-editor-save-${fileId}`);

  const isEditable = mimeType && (mimeType.startsWith('text/') || EDITABLE_MIME_TYPES.includes(mimeType));

  let language = mimeType ? LANGUAGE_MAP[mimeType] || 'plaintext' : 'plaintext';

  const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
  if (language === 'plaintext') {
    const extMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      json: 'json',
      xml: 'xml',
      md: 'markdown',
      markdown: 'markdown',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      sh: 'shell',
      bash: 'shell',
      yml: 'yaml',
      yaml: 'yaml',
      sql: 'sql',
      toml: 'toml',
      ini: 'ini',
      env: 'plaintext',
      txt: 'plaintext',
    };
    if (extMap[fileExt]) {
      language = extMap[fileExt];
    }
  }

  const fetchContent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fileContentApi.getRaw(fileId);
      if (res.data.success && res.data.data) {
        setContent(res.data.data.content);
        setOriginalContent(res.data.data.content);
      } else {
        throw new Error(res.data.error?.message || '加载失败');
      }
    } catch (error) {
      console.error('Failed to load file content:', error);
      // E-03：失败时保留编辑器并显示错误态 + 重试，不再静默关闭
      setLoadError(error instanceof Error ? error.message : '加载文件内容失败');
    } finally {
      setIsLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (!isEditable) {
      setLoadError('此文件类型不支持在线编辑');
      setIsLoading(false);
      return;
    }
    fetchContent();
  }, [fileId, isEditable, fetchContent]);

  const hasChanges = content !== originalContent;

  const handleSave = async () => {
    if (!hasChanges) {
      toast({ title: '内容未变化' });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fileContentApi.update(fileId, {
        content,
        changeSummary: changeSummary || undefined,
      });

      if (res.data.success) {
        toast({ title: '保存成功' });
        setOriginalContent(content);
        setShowSaveDialog(false);
        setChangeSummary('');
        onSaved?.();
      } else {
        throw new Error(res.data.error?.message || '保存失败');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      toast({ title: error instanceof Error ? error.message : '保存失败', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = useCallback(async () => {
    if (hasChanges) {
      const ok = await confirmAction({
        title: '有未保存的更改',
        description: `文件「${fileName}」有未保存的修改，确定要关闭吗？关闭后更改将丢失。`,
        level: 'danger',
        confirmText: '放弃更改并关闭',
        cancelText: '继续编辑',
      });
      if (!ok) return;
    }
    onClose();
  }, [hasChanges, fileName, onClose]);

  // C-02 修复：编辑器自身的 Esc 走 handleClose（含未保存确认），
  // 外层 FilePreview 在检测到编辑器打开时会放弃自己的 Esc 处理，避免竞争。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 若确认框已打开，Esc 交给确认框自身处理（Radix Dialog），避免打断确认流程
      if (confirmOpen) return;
      e.stopPropagation();
      void handleClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleClose, confirmOpen]);

  const isCodeFile = [
    'javascript',
    'typescript',
    'html',
    'css',
    'json',
    'xml',
    'yaml',
    'python',
    'go',
    'rust',
    'java',
    'c',
    'cpp',
    'csharp',
    'php',
    'ruby',
    'shell',
    'sql',
  ].includes(language);

  return (
    <div className="fixed inset-0 bg-black/50 z-overlay flex flex-col">
      <div className="bg-card flex-1 flex flex-col max-w-6xl mx-auto w-full my-4 rounded-lg shadow-overlay overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">{fileName}</h3>
            {hasChanges && <span className="text-xs text-orange-500">未保存</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setShowSaveDialog(true)}
              disabled={!hasChanges || isSaving || Boolean(loadError)}
            >
              保存
            </Button>
            <button
              onClick={handleClose}
              className="p-2 rounded hover:bg-accent touch-target-sm flex items-center justify-center"
              aria-label="关闭编辑器"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : loadError ? (
            <ErrorState title="无法编辑此文件" message={loadError} onRetry={isEditable ? fetchContent : undefined} />
          ) : isCodeFile ? (
            <CodeEditor value={content} onChange={setContent} language={language} />
          ) : (
            <TextEditor value={content} onChange={setContent} />
          )}
        </div>
      </div>

      {showSaveDialog && (
        <div
          className="fixed inset-0 bg-black/30 z-popover flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-dialog-title"
        >
          <div className="bg-card rounded-lg shadow-overlay w-full max-w-md p-4">
            <h4 id="save-dialog-title" className="font-medium mb-3">
              保存更改
            </h4>
            <div className="mb-4">
              <label htmlFor="save-change-summary" className="block text-sm font-medium mb-1">
                变更说明（可选）
              </label>
              <input
                id="save-change-summary"
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                placeholder="例如：修复拼写错误"
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileEditor;
