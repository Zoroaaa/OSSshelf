/**
 * constants/index.ts
 * 共享常量导出
 *
 * ============================================================================
 * 【文件预览功能修改提醒】
 * ============================================================================
 *
 * 修改文件预览相关功能时，必须同步更新以下文件：
 *
 * 配置文件（单一真相来源）:
 *   - packages/shared/src/constants/previewTypes.ts  # 预览类型配置
 *
 * 后端:
 *   - apps/api/src/routes/preview.ts                 # 预览 API
 *
 * 前端 - 文件管理:
 *   - apps/web/src/components/files/FilePreview.tsx  # 文件管理预览组件
 *
 * 前端 - 分享页面:
 *   - apps/web/src/components/share/ShareFilePreview.tsx  # 分享预览组件
 *
 * 前端 - 工具函数:
 *   - apps/web/src/utils/fileTypes.ts               # 文件类型分类
 *   - apps/web/src/components/files/FileIcon.tsx    # 文件图标
 *
 * ============================================================================
 */

export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

export const JWT_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export const SHARE_DEFAULT_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024;

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export const MAX_CONCURRENT_PARTS = 3;

export const TRASH_RETENTION_DAYS = 30;

export const LOGIN_MAX_ATTEMPTS = 5;

export const LOGIN_LOCKOUT_DURATION = 15 * 60 * 1000;

export const DEVICE_SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000;

export const UPLOAD_TASK_EXPIRY = 24 * 60 * 60 * 1000;

export const CODE_HIGHLIGHT_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

export {
  ERROR_CODES,
  type ErrorInfo,
  type ErrorCode,
  getErrorInfo,
  getErrorMessage,
  getHttpStatus,
} from './errorCodes';

// 从 previewTypes.ts 导出所有预览相关常量（单一真相来源）
export * from './previewTypes';

export const TAG_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
];

export const EDITABLE_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
];

/** 在线编辑文件最大大小（1MB），路由层和服务层必须保持一致 */
export const MAX_EDITABLE_SIZE = 1024 * 1024;

export const EDITABLE_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'jsx',
  'ts',
  'tsx',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env',
  'sh',
  'bash',
  'py',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'rb',
  'sql',
  'vue',
  'svelte',
];

export function isEditableFile(mimeType: string | null, fileName: string): boolean {
  if (!mimeType) return false;
  if (EDITABLE_MIME_TYPES.some((t) => mimeType.startsWith(t) || mimeType === t)) return true;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EDITABLE_EXTENSIONS.includes(ext);
}
