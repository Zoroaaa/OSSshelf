/**
 * NewFileDialog.tsx
 * 新建文件对话框组件
 *
 * 功能:
 * - 文件名输入
 * - 文件类型选择（扩展名）
 * - 内容编辑区域
 * - 保存路径选择
 */

import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/utils';
import { FileText, Code, FileJson, FileCode, File, ChevronDown } from 'lucide-react';

export interface FileTemplate {
  extension: string;
  label: string;
  mimeType: string;
  icon: React.ReactNode;
  defaultContent?: string;
  category: 'text' | 'code' | 'config' | 'document' | 'web';
}

export const FILE_TEMPLATES: FileTemplate[] = [
  {
    extension: '.txt',
    label: '纯文本',
    mimeType: 'text/plain',
    icon: <FileText className="h-4 w-4" />,
    defaultContent: '',
    category: 'text',
  },
  {
    extension: '.md',
    label: 'Markdown',
    mimeType: 'text/markdown',
    icon: <FileText className="h-4 w-4" />,
    defaultContent: '# 标题\n\n',
    category: 'document',
  },
  {
    extension: '.html',
    label: 'HTML',
    mimeType: 'text/html',
    icon: <Code className="h-4 w-4" />,
    defaultContent:
      '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>文档</title>\n</head>\n<body>\n\n</body>\n</html>',
    category: 'web',
  },
  {
    extension: '.css',
    label: 'CSS',
    mimeType: 'text/css',
    icon: <Code className="h-4 w-4" />,
    defaultContent: '/* 样式表 */\n',
    category: 'web',
  },
  {
    extension: '.js',
    label: 'JavaScript',
    mimeType: 'text/javascript',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '// JavaScript\n',
    category: 'code',
  },
  {
    extension: '.ts',
    label: 'TypeScript',
    mimeType: 'application/typescript',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '// TypeScript\n',
    category: 'code',
  },
  {
    extension: '.jsx',
    label: 'JSX',
    mimeType: 'application/javascript',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent:
      '// JSX Component\nexport default function Component() {\n  return (\n    <div>\n      \n    </div>\n  );\n}\n',
    category: 'code',
  },
  {
    extension: '.tsx',
    label: 'TSX',
    mimeType: 'application/typescript',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent:
      '// TSX Component\ninterface Props {}\n\nexport default function Component({}: Props) {\n  return (\n    <div>\n      \n    </div>\n  );\n}\n',
    category: 'code',
  },
  {
    extension: '.json',
    label: 'JSON',
    mimeType: 'application/json',
    icon: <FileJson className="h-4 w-4" />,
    defaultContent: '{\n  \n}\n',
    category: 'config',
  },
  {
    extension: '.xml',
    label: 'XML',
    mimeType: 'application/xml',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  \n</root>\n',
    category: 'config',
  },
  {
    extension: '.yaml',
    label: 'YAML',
    mimeType: 'application/x-yaml',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# YAML 配置\n',
    category: 'config',
  },
  {
    extension: '.yml',
    label: 'YML',
    mimeType: 'application/x-yaml',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# YAML 配置\n',
    category: 'config',
  },
  {
    extension: '.csv',
    label: 'CSV',
    mimeType: 'text/csv',
    icon: <FileText className="h-4 w-4" />,
    defaultContent: '',
    category: 'document',
  },
  {
    extension: '.py',
    label: 'Python',
    mimeType: 'text/x-python',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# Python\n',
    category: 'code',
  },
  {
    extension: '.java',
    label: 'Java',
    mimeType: 'text/x-java-source',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'public class Main {\n  public static void main(String[] args) {\n    \n  }\n}\n',
    category: 'code',
  },
  {
    extension: '.go',
    label: 'Go',
    mimeType: 'text/x-go',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'package main\n\nfunc main() {\n  \n}\n',
    category: 'code',
  },
  {
    extension: '.rs',
    label: 'Rust',
    mimeType: 'text/x-rust',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'fn main() {\n  \n}\n',
    category: 'code',
  },
  {
    extension: '.c',
    label: 'C',
    mimeType: 'text/x-c',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#include <stdio.h>\n\nint main() {\n  return 0;\n}\n',
    category: 'code',
  },
  {
    extension: '.cpp',
    label: 'C++',
    mimeType: 'text/x-c++',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#include <iostream>\n\nint main() {\n  return 0;\n}\n',
    category: 'code',
  },
  {
    extension: '.h',
    label: 'C Header',
    mimeType: 'text/x-c',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#ifndef _HEADER_H_\n#define _HEADER_H_\n\n\n\n#endif\n',
    category: 'code',
  },
  {
    extension: '.hpp',
    label: 'C++ Header',
    mimeType: 'text/x-c++',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#ifndef _HEADER_HPP_\n#define _HEADER_HPP_\n\n\n\n#endif\n',
    category: 'code',
  },
  {
    extension: '.cs',
    label: 'C#',
    mimeType: 'text/x-csharp',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'using System;\n\nclass Program {\n  static void Main() {\n    \n  }\n}\n',
    category: 'code',
  },
  {
    extension: '.php',
    label: 'PHP',
    mimeType: 'text/x-php',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '<?php\n\n',
    category: 'code',
  },
  {
    extension: '.rb',
    label: 'Ruby',
    mimeType: 'text/x-ruby',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# Ruby\n',
    category: 'code',
  },
  {
    extension: '.swift',
    label: 'Swift',
    mimeType: 'text/x-swift',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'import Foundation\n\n',
    category: 'code',
  },
  {
    extension: '.kt',
    label: 'Kotlin',
    mimeType: 'text/x-kotlin',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'fun main() {\n  \n}\n',
    category: 'code',
  },
  {
    extension: '.scala',
    label: 'Scala',
    mimeType: 'text/x-scala',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: 'object Main extends App {\n  \n}\n',
    category: 'code',
  },
  {
    extension: '.sql',
    label: 'SQL',
    mimeType: 'application/sql',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '-- SQL\n',
    category: 'code',
  },
  {
    extension: '.sh',
    label: 'Shell',
    mimeType: 'application/x-sh',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#!/bin/bash\n\n',
    category: 'code',
  },
  {
    extension: '.bash',
    label: 'Bash',
    mimeType: 'application/x-sh',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '#!/bin/bash\n\n',
    category: 'code',
  },
  {
    extension: '.ps1',
    label: 'PowerShell',
    mimeType: 'application/x-powershell',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# PowerShell\n',
    category: 'code',
  },
  {
    extension: '.vue',
    label: 'Vue',
    mimeType: 'text/x-vue',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent:
      '<template>\n  <div>\n    \n  </div>\n</template>\n\n<script setup lang="ts">\n\n</script>\n\n<style scoped>\n\n</style>\n',
    category: 'code',
  },
  {
    extension: '.svelte',
    label: 'Svelte',
    mimeType: 'text/x-svelte',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '<script lang="ts">\n\n</script>\n\n<main>\n  \n</main>\n\n<style>\n\n</style>\n',
    category: 'code',
  },
  {
    extension: '.scss',
    label: 'SCSS',
    mimeType: 'text/x-scss',
    icon: <Code className="h-4 w-4" />,
    defaultContent: '// SCSS\n',
    category: 'web',
  },
  {
    extension: '.sass',
    label: 'Sass',
    mimeType: 'text/x-sass',
    icon: <Code className="h-4 w-4" />,
    defaultContent: '// Sass\n',
    category: 'web',
  },
  {
    extension: '.less',
    label: 'Less',
    mimeType: 'text/x-less',
    icon: <Code className="h-4 w-4" />,
    defaultContent: '// Less\n',
    category: 'web',
  },
  {
    extension: '.toml',
    label: 'TOML',
    mimeType: 'application/toml',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# TOML 配置\n',
    category: 'config',
  },
  {
    extension: '.ini',
    label: 'INI',
    mimeType: 'text/plain',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '; INI 配置\n',
    category: 'config',
  },
  {
    extension: '.env',
    label: 'Env',
    mimeType: 'text/plain',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent: '# 环境变量\n',
    category: 'config',
  },
  {
    extension: '.gitignore',
    label: 'Gitignore',
    mimeType: 'text/plain',
    icon: <File className="h-4 w-4" />,
    defaultContent: '# Git 忽略文件\n',
    category: 'config',
  },
  {
    extension: '.dockerignore',
    label: 'Dockerignore',
    mimeType: 'text/plain',
    icon: <File className="h-4 w-4" />,
    defaultContent: '# Docker 忽略文件\n',
    category: 'config',
  },
  {
    extension: '.editorconfig',
    label: 'EditorConfig',
    mimeType: 'text/plain',
    icon: <File className="h-4 w-4" />,
    defaultContent:
      '# EditorConfig\nroot = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n',
    category: 'config',
  },
  {
    extension: '.dockerfile',
    label: 'Dockerfile',
    mimeType: 'text/plain',
    icon: <FileCode className="h-4 w-4" />,
    defaultContent:
      'FROM node:20-alpine\n\nWORKDIR /app\n\nCOPY package*.json ./\nRUN npm install\n\nCOPY . .\n\nCMD ["npm", "start"]\n',
    category: 'config',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  text: '文本文件',
  document: '文档',
  code: '代码文件',
  config: '配置文件',
  web: 'Web 开发',
};

const CATEGORY_ORDER = ['text', 'document', 'code', 'web', 'config'];

interface NewFileDialogProps {
  isRoot: boolean;
  name: string;
  content: string;
  selectedExtension: string;
  parentId: string | null;
  onNameChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onExtensionChange: (v: string) => void;
  onParentIdChange: (v: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function NewFileDialog({
  isRoot: _isRoot,
  name,
  content,
  selectedExtension,
  parentId: _parentId,
  onNameChange,
  onContentChange,
  onExtensionChange,
  onParentIdChange: _onParentIdChange,
  onConfirm,
  onCancel,
  loading,
}: NewFileDialogProps) {
  const [showExtensionDropdown, setShowExtensionDropdown] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('text');

  const selectedTemplate = useMemo(() => {
    return FILE_TEMPLATES.find((t) => t.extension === selectedExtension) || FILE_TEMPLATES[0];
  }, [selectedExtension]) as FileTemplate;

  const handleExtensionSelect = useCallback(
    (template: FileTemplate) => {
      onExtensionChange(template.extension);
      if (!name || name === FILE_TEMPLATES.find((t) => t.extension === selectedExtension)?.label) {
        onNameChange(template.label);
      }
      onContentChange(template.defaultContent || '');
      setShowExtensionDropdown(false);
    },
    [name, selectedExtension, onExtensionChange, onNameChange, onContentChange]
  );

  const handleNameWithExtension = useCallback(
    (value: string) => {
      const lastDot = value.lastIndexOf('.');
      if (lastDot > 0) {
        const ext = value.slice(lastDot).toLowerCase();
        const matchingTemplate = FILE_TEMPLATES.find((t) => t.extension === ext);
        if (matchingTemplate && matchingTemplate.extension !== selectedExtension) {
          onExtensionChange(matchingTemplate.extension);
        }
      }
      onNameChange(value);
    },
    [selectedExtension, onExtensionChange, onNameChange]
  );

  const finalFileName = useMemo(() => {
    if (!name.trim()) return '';
    const trimmedName = name.trim();
    if (trimmedName.includes('.')) {
      return trimmedName;
    }
    return `${trimmedName}${selectedExtension}`;
  }, [name, selectedExtension]);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, FileTemplate[]> = {};
    for (const template of FILE_TEMPLATES) {
      const category = template.category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category]!.push(template);
    }
    return groups;
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl w-full max-w-3xl max-h-[90vh] shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">新建文件</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">文件名称</label>
              <Input
                placeholder="输入文件名称"
                value={name}
                onChange={(e) => handleNameWithExtension(e.target.value)}
                autoFocus
              />
            </div>

            <div className="w-48 space-y-1.5">
              <label className="text-sm font-medium">文件类型</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowExtensionDropdown(!showExtensionDropdown)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-md bg-background hover:bg-muted/50 transition-colors text-sm"
                >
                  <span className="flex items-center gap-2">
                    {selectedTemplate.icon}
                    <span>{selectedTemplate.label}</span>
                    <span className="text-muted-foreground text-xs">{selectedTemplate.extension}</span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', showExtensionDropdown && 'rotate-180')} />
                </button>

                {showExtensionDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-xl z-50 max-h-64 overflow-hidden">
                    <div className="flex border-b">
                      {CATEGORY_ORDER.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setActiveCategory(cat)}
                          className={cn(
                            'flex-1 px-2 py-1.5 text-xs font-medium transition-colors',
                            activeCategory === cat
                              ? 'bg-primary/10 text-primary border-b-2 border-primary'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {CATEGORY_LABELS[cat]}
                        </button>
                      ))}
                    </div>
                    <div className="overflow-auto max-h-48">
                      {groupedTemplates[activeCategory]?.map((template) => (
                        <button
                          key={template.extension}
                          type="button"
                          onClick={() => handleExtensionSelect(template)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                            selectedExtension === template.extension ? 'bg-primary/5 text-primary' : 'hover:bg-muted/50'
                          )}
                        >
                          {template.icon}
                          <span className="flex-1">{template.label}</span>
                          <span className="text-muted-foreground text-xs">{template.extension}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {finalFileName && (
            <div className="text-sm text-muted-foreground">
              最终文件名: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{finalFileName}</code>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">文件内容</label>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 border-b flex items-center gap-2 text-xs text-muted-foreground">
                {selectedTemplate.icon}
                <span>{selectedTemplate.mimeType}</span>
              </div>
              <textarea
                className="w-full h-64 p-4 bg-background text-sm font-mono resize-none outline-none focus:ring-0"
                placeholder="在此输入文件内容..."
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">提示: 输入文件名时自动检测扩展名，或直接选择文件类型</div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-muted/30">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={loading || !name.trim()}>
            {loading ? '创建中…' : '创建文件'}
          </Button>
        </div>
      </div>
    </div>
  );
}
