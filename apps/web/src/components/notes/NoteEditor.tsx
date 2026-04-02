/**
 * NoteEditor.tsx
 * 笔记编辑器组件
 *
 * 功能:
 * - Markdown 编辑
 * - 实时预览
 * - @用户 提及
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/Button';

interface NoteEditorProps {
  initialContent: string;
  title: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ initialContent, title, onSave, onClose }) => {
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSave = async () => {
    if (!content.trim()) return;
    setIsSaving(true);
    try {
      await onSave(content);
    } finally {
      setIsSaving(false);
    }
  };

  const insertMarkdown = (prefix: string, suffix: string = prefix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = content.substring(0, start) + prefix + selectedText + suffix + content.substring(end);

    setContent(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const renderPreview = (text: string): string => {
    return text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">$1</code>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<span class="text-blue-500">@$1</span>')
      .replace(/\n/g, '<br>');
  };

  const toolbarButtons = [
    { label: 'B', title: '粗体', action: () => insertMarkdown('**') },
    { label: 'I', title: '斜体', action: () => insertMarkdown('*') },
    { label: 'S', title: '删除线', action: () => insertMarkdown('~~') },
    { label: '</>', title: '代码', action: () => insertMarkdown('`') },
    { label: '@', title: '提及用户', action: () => insertMarkdown('@', '') },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {toolbarButtons.map((btn, i) => (
            <button
              key={i}
              onClick={btn.action}
              className="px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-sm font-mono"
              title={btn.title}
            >
              {btn.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`px-3 py-1 rounded text-sm ${
              showPreview ? 'bg-blue-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {showPreview ? '编辑' : '预览'}
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          {showPreview ? (
            <div
              className="prose dark:prose-invert max-w-none h-full overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: renderPreview(content) }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full min-h-[200px] p-2 border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
              placeholder="输入笔记内容...&#10;&#10;支持 Markdown 格式:&#10;**粗体** *斜体* ~~删除线~~ `代码`&#10;@user@example.com 提及用户"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!content.trim() || isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
