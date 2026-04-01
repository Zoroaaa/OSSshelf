/**
 * FileEditor.tsx
 * 文件编辑器主组件
 *
 * 功能:
 * - 根据文件类型选择编辑器
 * - 支持语法高亮
 * - 保存时创建版本快照
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../ui/useToast';
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
  'application/x-sh': 'shell',
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
  const [isSaving, setIsSaving] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const { toast } = useToast();

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
      toast({ title: '加载文件失败', variant: 'destructive' });
      onClose();
    } finally {
      setIsLoading(false);
    }
  }, [fileId, toast, onClose]);

  useEffect(() => {
    if (!isEditable) {
      toast({ title: '此文件类型不支持编辑', variant: 'destructive' });
      onClose();
      return;
    }
    fetchContent();
  }, [fileId, isEditable, fetchContent, toast, onClose]);

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

  const handleClose = () => {
    if (hasChanges) {
      if (!confirm('有未保存的更改，确定要关闭吗？')) {
        return;
      }
    }
    onClose();
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

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
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col">
      <div className="bg-white dark:bg-gray-900 flex-1 flex flex-col max-w-6xl mx-auto w-full my-4 rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">{fileName}</h3>
            {hasChanges && <span className="text-xs text-orange-500">未保存</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowSaveDialog(true)} disabled={!hasChanges || isSaving}>
              保存
            </Button>
            <button onClick={handleClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isCodeFile ? (
            <CodeEditor value={content} onChange={setContent} language={language} />
          ) : (
            <TextEditor value={content} onChange={setContent} />
          )}
        </div>
      </div>

      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/30 z-60 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-4">
            <h4 className="font-medium mb-3">保存更改</h4>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">变更说明（可选）</label>
              <input
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
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
