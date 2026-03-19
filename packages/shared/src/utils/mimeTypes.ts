export const MIME_TYPE_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',

  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',

  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp',
  '.m2ts': 'video/mp2t',

  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.mpg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',

  '.pdf': 'application/pdf',

  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',

  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.gzip': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',

  '.exe': 'application/x-msdownload',
  '.msi': 'application/x-msi',
  '.dmg': 'application/x-apple-diskimage',
  '.pkg': 'application/x-newton-compatible-pkg',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream',
  '.app': 'application/octet-stream',
  '.appimage': 'application/x-executable',

  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.r': 'text/x-r',
  '.sql': 'application/sql',
  '.ps1': 'application/x-powershell',
  '.bat': 'application/x-msdos-program',
  '.cmd': 'application/x-msdos-program',

  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.env': 'text/plain',
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
  '.editorconfig': 'text/plain',

  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

export function getMimeTypeFromExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return null;
  }
  const ext = fileName.slice(lastDot).toLowerCase();
  return MIME_TYPE_MAP[ext] || null;
}

export function inferMimeType(fileName: string, providedMimeType?: string | null): string {
  if (providedMimeType && providedMimeType !== 'application/octet-stream') {
    return providedMimeType;
  }

  const inferredType = getMimeTypeFromExtension(fileName);
  if (inferredType) {
    return inferredType;
  }

  return 'application/octet-stream';
}

export const INSTALLER_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msi',
  'application/x-apple-diskimage',
  'application/x-newton-compatible-pkg',
  'application/vnd.debian.binary-package',
  'application/x-rpm',
  'application/vnd.android.package-archive',
  'application/x-executable',
];

export function isInstallerMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return INSTALLER_MIME_TYPES.includes(mimeType);
}

export const INSTALLER_EXTENSIONS = [
  '.exe',
  '.msi',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.ipa',
  '.app',
  '.appimage',
];

export function isInstallerExtension(fileName: string): boolean {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = fileName.slice(lastDot).toLowerCase();
  return INSTALLER_EXTENSIONS.includes(ext);
}
