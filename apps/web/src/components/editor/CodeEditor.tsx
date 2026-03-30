/**
 * CodeEditor.tsx
 * 代码编辑器组件
 *
 * 功能:
 * - 语法高亮
 * - 行号显示
 * - 基本编辑功能
 */

import React, { useRef, useEffect } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, language }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, [value]);

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onChange(newValue);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const highlightCode = (code: string, lang: string): string => {
    const keywords: Record<string, string[]> = {
      javascript: [
        'const',
        'let',
        'var',
        'function',
        'return',
        'if',
        'else',
        'for',
        'while',
        'class',
        'import',
        'export',
        'from',
        'async',
        'await',
        'try',
        'catch',
        'throw',
        'new',
        'this',
        'true',
        'false',
        'null',
        'undefined',
      ],
      typescript: [
        'const',
        'let',
        'var',
        'function',
        'return',
        'if',
        'else',
        'for',
        'while',
        'class',
        'import',
        'export',
        'from',
        'async',
        'await',
        'try',
        'catch',
        'throw',
        'new',
        'this',
        'true',
        'false',
        'null',
        'undefined',
        'interface',
        'type',
        'enum',
        'implements',
        'extends',
        'private',
        'public',
        'protected',
        'readonly',
      ],
      python: [
        'def',
        'class',
        'if',
        'else',
        'elif',
        'for',
        'while',
        'return',
        'import',
        'from',
        'as',
        'try',
        'except',
        'finally',
        'with',
        'lambda',
        'True',
        'False',
        'None',
        'and',
        'or',
        'not',
        'in',
        'is',
      ],
      go: [
        'func',
        'package',
        'import',
        'var',
        'const',
        'type',
        'struct',
        'interface',
        'if',
        'else',
        'for',
        'range',
        'return',
        'go',
        'defer',
        'chan',
        'select',
        'case',
        'default',
        'true',
        'false',
        'nil',
      ],
      rust: [
        'fn',
        'let',
        'mut',
        'const',
        'pub',
        'mod',
        'use',
        'struct',
        'enum',
        'impl',
        'trait',
        'if',
        'else',
        'match',
        'for',
        'while',
        'loop',
        'return',
        'self',
        'Self',
        'true',
        'false',
        'Some',
        'None',
        'Ok',
        'Err',
      ],
      java: [
        'public',
        'private',
        'protected',
        'class',
        'interface',
        'extends',
        'implements',
        'static',
        'final',
        'void',
        'return',
        'if',
        'else',
        'for',
        'while',
        'try',
        'catch',
        'throw',
        'new',
        'this',
        'true',
        'false',
        'null',
        'import',
        'package',
      ],
      sql: [
        'SELECT',
        'FROM',
        'WHERE',
        'AND',
        'OR',
        'NOT',
        'IN',
        'LIKE',
        'ORDER',
        'BY',
        'GROUP',
        'HAVING',
        'LIMIT',
        'OFFSET',
        'INSERT',
        'INTO',
        'VALUES',
        'UPDATE',
        'SET',
        'DELETE',
        'CREATE',
        'TABLE',
        'DROP',
        'ALTER',
        'INDEX',
        'JOIN',
        'LEFT',
        'RIGHT',
        'INNER',
        'OUTER',
        'ON',
        'AS',
        'DISTINCT',
        'COUNT',
        'SUM',
        'AVG',
        'MAX',
        'MIN',
      ],
      json: [],
      html: [],
      css: [],
      yaml: [],
      shell: [
        'if',
        'then',
        'else',
        'fi',
        'for',
        'do',
        'done',
        'while',
        'until',
        'case',
        'esac',
        'function',
        'return',
        'exit',
        'echo',
        'export',
        'source',
        'alias',
        'unset',
        'readonly',
        'local',
        'declare',
      ],
    };

    const kw = keywords[lang] || [];
    let highlighted = escapeHtml(code);

    if (kw.length > 0) {
      const kwRegex = new RegExp(`\\b(${kw.join('|')})\\b`, 'g');
      highlighted = highlighted.replace(kwRegex, '<span class="text-purple-600 dark:text-purple-400">$1</span>');
    }

    highlighted = highlighted
      .replace(
        /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
        '<span class="text-green-600 dark:text-green-400">$1</span>'
      )
      .replace(/(\/\/.*$|#.*$)/gm, '<span class="text-gray-500 dark:text-gray-400">$1</span>')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-gray-500 dark:text-gray-400">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="text-orange-600 dark:text-orange-400">$1</span>');

    if (lang === 'html' || lang === 'xml') {
      highlighted = highlighted
        .replace(/(&lt;\/?[\w-]+)/g, '<span class="text-blue-600 dark:text-blue-400">$1</span>')
        .replace(/([\w-]+=)/g, '<span class="text-yellow-600 dark:text-yellow-400">$1</span>');
    }

    if (lang === 'css') {
      highlighted = highlighted
        .replace(/([\w-]+)(?=\s*:)/g, '<span class="text-blue-600 dark:text-blue-400">$1</span>')
        .replace(/(#[\w-]+)/g, '<span class="text-yellow-600 dark:text-yellow-400">$1</span>');
    }

    return highlighted;
  };

  const escapeHtml = (text: string): string => {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const lines = value.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1).join('\n');

  return (
    <div className="relative h-full bg-gray-900 text-gray-100 font-mono text-sm overflow-hidden">
      <div className="absolute top-0 left-0 w-12 h-full bg-gray-800 text-gray-500 text-right pr-2 pt-0 select-none overflow-hidden border-r border-gray-700">
        <pre className="m-0 p-0 leading-6">{lineNumbers}</pre>
      </div>

      <div className="absolute top-0 left-12 right-0 bottom-0 overflow-hidden">
        <pre
          ref={highlightRef}
          className="absolute top-0 left-0 w-full h-full m-0 p-0 leading-6 pointer-events-none whitespace-pre overflow-hidden"
          dangerouslySetInnerHTML={{ __html: highlightCode(value, language) + '\n' }}
        />
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="absolute top-0 left-12 right-0 bottom-0 w-full h-full bg-transparent text-transparent caret-white font-mono text-sm leading-6 resize-none focus:outline-none p-0 m-0 whitespace-pre overflow-auto"
        spellCheck={false}
      />
    </div>
  );
};

export default CodeEditor;
