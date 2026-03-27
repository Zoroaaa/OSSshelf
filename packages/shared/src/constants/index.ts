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

export const DEFAULT_STORAGE_QUOTA = 10 * 1024 * 1024 * 1024;

export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/x-m4a'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  text: ['text/plain', 'text/html', 'text/css', 'text/javascript', 'text/markdown', 'text/csv'],
  code: ['application/json', 'application/xml', 'application/x-yaml', 'application/x-sh'],
  archive: [
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
  ],
};

export const FILE_TYPE_ICONS: Record<string, string> = {
  'image/': 'image',
  'video/': 'video',
  'audio/': 'audio',
  'application/pdf': 'pdf',
  'application/zip': 'archive',
  'application/x-': 'code',
  'text/': 'text',
};

export const JWT_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export const WEBDAV_SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000;

export const SHARE_DEFAULT_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024;

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export const MAX_CONCURRENT_PARTS = 3;

export const THUMBNAIL_SIZES = {
  small: 128,
  medium: 256,
  large: 512,
};

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

export const API_ROUTES = {
  AUTH: {
    REGISTER: '/api/auth/register',
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    DEVICES: '/api/auth/devices',
    SESSIONS: '/api/auth/sessions',
  },
  FILES: {
    LIST: '/api/files',
    CREATE: '/api/files',
    GET: (id: string) => `/api/files/${id}`,
    UPDATE: (id: string) => `/api/files/${id}`,
    DELETE: (id: string) => `/api/files/${id}`,
    UPLOAD: '/api/files/upload',
    DOWNLOAD: (id: string) => `/api/files/${id}/download`,
    PREVIEW: (id: string) => `/api/files/${id}/preview`,
    BATCH: '/api/files/batch',
    SEARCH: '/api/files/search',
    TAGS: '/api/files/tags',
  },
  SHARE: {
    CREATE: '/api/share',
    GET: (id: string) => `/api/share/${id}`,
    DOWNLOAD: (id: string) => `/api/share/${id}/download`,
  },
  TASKS: {
    UPLOAD: '/api/tasks/upload',
    DOWNLOAD: '/api/tasks/download',
  },
  WEBDAV: '/dav',
} as const;

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

export const AUDIT_ACTIONS = {
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_REGISTER: 'user.register',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  FILE_UPLOAD: 'file.upload',
  FILE_DOWNLOAD: 'file.download',
  FILE_DELETE: 'file.delete',
  FILE_MOVE: 'file.move',
  FILE_RENAME: 'file.rename',
  FOLDER_CREATE: 'folder.create',
  SHARE_CREATE: 'share.create',
  SHARE_ACCESS: 'share.access',
  BUCKET_CREATE: 'bucket.create',
  BUCKET_UPDATE: 'bucket.update',
  BUCKET_DELETE: 'bucket.delete',
  ADMIN_USER_UPDATE: 'admin.user_update',
  ADMIN_CONFIG_CHANGE: 'admin.config_change',
} as const;

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
