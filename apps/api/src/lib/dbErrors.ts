/**
 * dbErrors.ts — 数据库约束错误识别
 *
 * 迁移 119 为 files 增加了「命名空间 + 父目录 + 文件名」的部分唯一索引，
 * 各写入路径需要区分该约束冲突与其他数据库错误。
 * 本模块不依赖任何业务模块，便于错误中间件直接复用。
 */

/** 迁移 119 中的文件名唯一索引名 */
export const FILE_NAME_UNIQUE_INDEX = 'uniq_files_name_per_parent_active';

function collectErrorText(error: unknown, depth = 0): string {
  if (!error || depth > 4) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const e = error as { message?: unknown; cause?: unknown };
  return `${typeof e.message === 'string' ? e.message : ''} ${collectErrorText(e.cause, depth + 1)}`;
}

/**
 * 判断是否为「同目录同名」唯一约束冲突（迁移 119）。
 * D1/SQLite 对表达式索引的报错形如：
 *   UNIQUE constraint failed: index 'uniq_files_name_per_parent_active'
 * Drizzle 会把原始错误包在 cause 中，因此需要沿 cause 链取文本。
 */
export function isFileNameConflictError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();
  return text.includes(FILE_NAME_UNIQUE_INDEX) || /unique constraint failed:\s*files\.name/.test(text);
}
