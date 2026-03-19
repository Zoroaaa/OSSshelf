/**
 * folderPolicy.ts
 * 文件夹上传策略工具
 *
 * 提取自 tasks.ts / presign.ts / files.ts 中的重复逻辑，统一维护
 */

import { eq, and } from 'drizzle-orm';
import { getDb, files } from '../db';

/**
 * 检查目标文件夹是否对指定 MIME 类型开放上传。
 * - 若文件夹未设置限制，返回 allowed: true
 * - 若 mimeType 不在白名单，返回 allowed: false 及允许的类型列表
 */
export async function checkFolderMimeTypeRestriction(
  db: ReturnType<typeof getDb>,
  parentId: string | null | undefined,
  mimeType: string
): Promise<{ allowed: boolean; allowedTypes?: string[] }> {
  if (!parentId) return { allowed: true };

  const parentFolder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, parentId), eq(files.isFolder, true)))
    .get();

  if (!parentFolder || !parentFolder.allowedMimeTypes) {
    return { allowed: true };
  }

  try {
    const allowedTypes: string[] = JSON.parse(parentFolder.allowedMimeTypes);
    if (allowedTypes.length === 0) return { allowed: true };

    const isAllowed = allowedTypes.some((allowed) => {
      if (allowed.endsWith('/*')) {
        return mimeType.startsWith(allowed.slice(0, -1));
      }
      return mimeType === allowed;
    });

    return { allowed: isAllowed, allowedTypes };
  } catch {
    return { allowed: true };
  }
}
