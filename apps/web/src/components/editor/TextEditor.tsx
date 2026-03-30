/**
 * TextEditor.tsx
 * 纯文本编辑器组件
 *
 * 功能:
 * - 简单文本编辑
 * - 自动换行
 */

import React from 'react';

interface TextEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const TextEditor: React.FC<TextEditorProps> = ({ value, onChange }) => {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-full p-4 font-mono text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none focus:outline-none border-none"
      placeholder="输入内容..."
      spellCheck={false}
      wrap="soft"
    />
  );
};

export default TextEditor;
