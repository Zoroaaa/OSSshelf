/**
 * previewUtils.ts
 * 文件预览工具函数
 *
 * 功能:
 * - 代码语言检测和高亮
 * - 文件类型判断
 */

import hljs from 'highlight.js';

export const CODE_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  r: 'r',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  toml: 'toml',
  ini: 'ini',
  env: 'bash',
};

export const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'swift',
  'kt',
  'scala',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'json',
  'xml',
  'yaml',
  'yml',
  'css',
  'scss',
  'less',
  'html',
  'vue',
  'dockerfile',
  'makefile',
  'toml',
  'ini',
  'env',
]);

export function getLanguageFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CODE_LANGUAGE_MAP[ext] || 'plaintext';
}

export function isCodeFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CODE_EXTENSIONS.has(ext);
}

export function highlightCode(code: string, language: string): string {
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}

export type WindowSize = 'small' | 'medium' | 'large' | 'fullscreen';

export const WINDOW_SIZE_CONFIG: Record<WindowSize, { width: string; height: string; maxWidth: string }> = {
  small: { width: '60vw', height: '70vh', maxWidth: '800px' },
  medium: { width: '80vw', height: '85vh', maxWidth: '1200px' },
  large: { width: '90vw', height: '90vh', maxWidth: '1600px' },
  fullscreen: { width: '100vw', height: '100vh', maxWidth: '100vw' },
};

export interface ZipTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  compressedSize: number;
  children: ZipTreeNode[];
  level: number;
}
