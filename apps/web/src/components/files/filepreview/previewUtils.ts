/**
 * previewUtils.ts
 * 文件预览工具函数
 *
 * 功能:
 * - 代码语言检测和高亮
 * - Excel样式处理
 * - 文件类型判断
 */

import type { CSSProperties } from 'react';
import * as XLSX from 'xlsx';
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

interface ExcelCellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    color?: { rgb?: string; theme?: number };
    sz?: number;
    name?: string;
  };
  fill?: {
    fgColor?: { rgb?: string; theme?: number };
    bgColor?: { rgb?: string; theme?: number };
    patternType?: string;
  };
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
  };
  border?: {
    top?: { style?: string; color?: { rgb?: string } };
    bottom?: { style?: string; color?: { rgb?: string } };
    left?: { style?: string; color?: { rgb?: string } };
    right?: { style?: string; color?: { rgb?: string } };
  };
  numFmt?: string;
}

export function rgbToHex(rgb: string | undefined): string | undefined {
  if (!rgb) return undefined;
  if (rgb.startsWith('#')) return rgb;
  if (rgb.length === 6 && /^[0-9A-Fa-f]{6}$/.test(rgb)) {
    return `#${rgb}`;
  }
  if (rgb.length === 8 && rgb.startsWith('FF')) {
    return `#${rgb.slice(2)}`;
  }
  return undefined;
}

export const THEME_COLORS: Record<number, string> = {
  0: '#FFFFFF',
  1: '#000000',
  2: '#E7E6E6',
  3: '#44546A',
  4: '#5B9BD5',
  5: '#ED7D31',
  6: '#A5A5A5',
  7: '#FFC000',
  8: '#4472C4',
  9: '#70AD47',
};

export function getThemeColor(theme?: number): string | undefined {
  if (theme === undefined) return undefined;
  return THEME_COLORS[theme];
}

export function getExcelCellStyle(cell: XLSX.CellObject, _workbook: XLSX.WorkBook): CSSProperties {
  const styles: CSSProperties = {};
  if (!cell.s) return styles;

  const cellStyle = cell.s as ExcelCellStyle;

  if (cellStyle.font) {
    if (cellStyle.font.bold) styles.fontWeight = 'bold';
    if (cellStyle.font.italic) styles.fontStyle = 'italic';
    if (cellStyle.font.sz) styles.fontSize = `${cellStyle.font.sz}px`;
    if (cellStyle.font.name) styles.fontFamily = cellStyle.font.name;
    if (cellStyle.font.color?.rgb) {
      const color = rgbToHex(cellStyle.font.color.rgb);
      if (color) styles.color = color;
    } else if (cellStyle.font.color?.theme !== undefined) {
      const themeColor = getThemeColor(cellStyle.font.color.theme);
      if (themeColor) styles.color = themeColor;
    }
  }

  if (cellStyle.fill?.patternType && cellStyle.fill.patternType !== 'none') {
    if (cellStyle.fill.fgColor?.rgb) {
      const bgColor = rgbToHex(cellStyle.fill.fgColor.rgb);
      if (bgColor) {
        styles.backgroundColor = bgColor;
      }
    } else if (cellStyle.fill.fgColor?.theme !== undefined) {
      const themeColor = getThemeColor(cellStyle.fill.fgColor.theme);
      if (themeColor) {
        styles.backgroundColor = themeColor;
      }
    }
  }

  if (cellStyle.alignment) {
    if (cellStyle.alignment.horizontal) {
      styles.textAlign = cellStyle.alignment.horizontal as CSSProperties['textAlign'];
    }
    if (cellStyle.alignment.vertical) {
      styles.verticalAlign = cellStyle.alignment.vertical as CSSProperties['verticalAlign'];
    }
    if (cellStyle.alignment.wrapText) {
      styles.whiteSpace = 'pre-wrap';
      styles.wordBreak = 'break-word';
    }
  }

  return styles;
}

export function formatExcelValue(cell: XLSX.CellObject): string {
  if (cell.v === undefined || cell.v === null) return '';
  if (typeof cell.v === 'number') {
    if (cell.w) return cell.w;
    return cell.v.toLocaleString();
  }
  if (cell.v instanceof Date) {
    return cell.v.toLocaleString();
  }
  return String(cell.v);
}

export function renderExcelSheetWithStyles(
  worksheet: XLSX.WorkSheet,
  workbook: XLSX.WorkBook
): { html: string; merges: XLSX.Range[] } {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const merges = worksheet['!merges'] || [];

  const rows: string[] = [];
  rows.push(
    '<table style="border-collapse: collapse; width: 100%; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;">'
  );

  for (let row = range.s.r; row <= range.e.r; row++) {
    const cells: string[] = [];
    cells.push('<tr>');

    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];

      let isMerged = false;
      let rowSpan = 1;
      let colSpan = 1;

      for (const merge of merges) {
        if (row >= merge.s.r && row <= merge.e.r && col >= merge.s.c && col <= merge.e.c) {
          if (row === merge.s.r && col === merge.s.c) {
            rowSpan = merge.e.r - merge.s.r + 1;
            colSpan = merge.e.c - merge.s.c + 1;
          } else {
            isMerged = true;
          }
          break;
        }
      }

      if (isMerged) {
        continue;
      }

      const baseStyle: CSSProperties = {
        border: '1px solid #e5e7eb',
        padding: '6px 10px',
        textAlign: 'left',
        verticalAlign: 'top',
        minWidth: '60px',
        height: '24px',
      };

      const cellStyle = cell ? getExcelCellStyle(cell, workbook) : {};
      const mergedStyle = { ...baseStyle, ...cellStyle };

      const styleStr = Object.entries(mergedStyle)
        .map(([key, value]) => {
          const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          return `${cssKey}: ${value}`;
        })
        .join('; ');

      const value = cell ? formatExcelValue(cell) : '';
      const tag = row === range.s.r ? 'th' : 'td';
      const extraAttrs = rowSpan > 1 ? ` rowspan="${rowSpan}"` : '' + (colSpan > 1 ? ` colspan="${colSpan}"` : '');

      cells.push(`<${tag} style="${styleStr}"${extraAttrs}>${value || '&nbsp;'}</${tag}>`);
    }

    cells.push('</tr>');
    rows.push(cells.join(''));
  }

  rows.push('</table>');
  return { html: rows.join(''), merges };
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
