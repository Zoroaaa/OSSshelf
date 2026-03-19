/**
 * search.service.ts
 * 文件搜索业务逻辑服务
 *
 * 功能:
 * - 关键词搜索
 * - 高级条件搜索
 * - 搜索建议
 * - 最近搜索记录
 */

import { eq, and, isNull, like, gte, lte, inArray, or, desc, SQL } from 'drizzle-orm';
import { getDb, files, fileTags, storageBuckets } from '../db';
import type { Env } from '../types/env';

export interface SearchParams {
  query?: string;
  parentId?: string | null;
  recursive?: boolean;
  tags?: string[];
  mimeType?: string;
  minSize?: number;
  maxSize?: number;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  isFolder?: boolean;
  bucketId?: string;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface AdvancedSearchParams {
  conditions: Array<{
    field: 'name' | 'mimeType' | 'size' | 'createdAt' | 'updatedAt' | 'tags';
    operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
    value: string | number | string[];
  }>;
  logic: 'and' | 'or';
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

async function getAllDescendantFolderIds(db: ReturnType<typeof getDb>, parentFolderId: string): Promise<Set<string>> {
  const folderIds = new Set<string>([parentFolderId]);
  const queue = [parentFolderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const childFolders = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.parentId, currentId), eq(files.isFolder, true), isNull(files.deletedAt)))
      .all();

    for (const folder of childFolders) {
      if (!folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        queue.push(folder.id);
      }
    }
  }

  return folderIds;
}

export async function searchFiles(
  db: ReturnType<typeof getDb>,
  userId: string,
  params: SearchParams
) {
  const {
    query,
    parentId,
    recursive,
    tags,
    mimeType,
    minSize,
    maxSize,
    createdAfter,
    createdBefore,
    updatedAfter,
    updatedBefore,
    isFolder,
    bucketId,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    page = 1,
    limit = 50,
  } = params;

  const conditions: SQL[] = [eq(files.userId, userId), isNull(files.deletedAt)];

  if (parentId !== undefined) {
    if (parentId && recursive) {
      const folderIds = await getAllDescendantFolderIds(db, parentId);
      const folderIdArray = Array.from(folderIds);
      if (folderIdArray.length > 0) {
        conditions.push(inArray(files.parentId, folderIdArray));
      }
    } else {
      conditions.push(parentId ? eq(files.parentId, parentId) : isNull(files.parentId));
    }
  }

  if (query) {
    conditions.push(like(files.name, `%${query}%`));
  }

  if (mimeType) {
    if (mimeType.endsWith('/*')) {
      const prefix = mimeType.slice(0, -1);
      conditions.push(like(files.mimeType, `${prefix}%`));
    } else {
      conditions.push(eq(files.mimeType, mimeType));
    }
  }

  if (isFolder !== undefined) {
    conditions.push(eq(files.isFolder, isFolder));
  }

  if (bucketId) {
    conditions.push(eq(files.bucketId, bucketId));
  }

  if (minSize !== undefined) {
    conditions.push(gte(files.size, minSize));
  }

  if (maxSize !== undefined) {
    conditions.push(lte(files.size, maxSize));
  }

  if (createdAfter) {
    conditions.push(gte(files.createdAt, createdAfter));
  }

  if (createdBefore) {
    conditions.push(lte(files.createdAt, createdBefore));
  }

  if (updatedAfter) {
    conditions.push(gte(files.updatedAt, updatedAfter));
  }

  if (updatedBefore) {
    conditions.push(lte(files.updatedAt, updatedBefore));
  }

  let results = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .all();

  if (tags && tags.length > 0) {
    const fileIdsWithTag = await db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, tags)))
      .all();

    const fileIdSet = new Set(fileIdsWithTag.map((t) => t.fileId));
    results = results.filter((f) => fileIdSet.has(f.id));
  }

  results.sort((a, b) => {
    let aVal: string | number = a[sortBy] ?? '';
    let bVal: string | number = b[sortBy] ?? '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
  });

  const total = results.length;
  const offset = (page - 1) * limit;
  const paginatedResults = results.slice(offset, offset + limit);

  const bucketIds = [...new Set(paginatedResults.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  for (const bid of bucketIds) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bid)).get();
    if (b) bucketMap[b.id] = { id: b.id, name: b.name, provider: b.provider };
  }

  const fileIds = paginatedResults.map((f) => f.id);
  const allTags =
    fileIds.length > 0
      ? await db
          .select()
          .from(fileTags)
          .where(and(eq(fileTags.userId, userId), inArray(fileTags.fileId, fileIds)))
          .all()
      : [];

  const tagsByFile: Record<string, typeof allTags> = {};
  for (const tag of allTags) {
    if (!tagsByFile[tag.fileId]) tagsByFile[tag.fileId] = [];
    tagsByFile[tag.fileId].push(tag);
  }

  const itemsWithMeta = paginatedResults.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
    tags: tagsByFile[f.id] || [],
  }));

  const aggregations = {
    types: {} as Record<string, number>,
    mimeTypes: {} as Record<string, number>,
    sizeRange: { min: 0, max: 0 },
  };

  for (const f of results) {
    if (!f.isFolder) {
      const type = f.mimeType?.split('/')[0] || 'other';
      aggregations.types[type] = (aggregations.types[type] || 0) + 1;
      aggregations.mimeTypes[f.mimeType || 'unknown'] = (aggregations.mimeTypes[f.mimeType || 'unknown'] || 0) + 1;
    }
  }

  const sizes = results.filter((f) => !f.isFolder).map((f) => f.size);
  aggregations.sizeRange = {
    min: sizes.length > 0 ? Math.min(...sizes) : 0,
    max: sizes.length > 0 ? Math.max(...sizes) : 0,
  };

  return {
    items: itemsWithMeta,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    aggregations,
  };
}

export async function advancedSearch(
  db: ReturnType<typeof getDb>,
  userId: string,
  params: AdvancedSearchParams
) {
  const { conditions: searchConditions, logic, sortBy, sortOrder, page, limit } = params;

  const allFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const evaluateCondition = (file: typeof files.$inferSelect, condition: (typeof searchConditions)[0]): boolean => {
    const { field, operator, value } = condition;
    let fieldValue: unknown;

    if (field === 'tags') {
      return true;
    }

    fieldValue = file[field as keyof typeof file];

    switch (operator) {
      case 'contains':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().includes(value.toLowerCase())
        );
      case 'equals':
        return fieldValue === value;
      case 'startsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().startsWith(value.toLowerCase())
        );
      case 'endsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().endsWith(value.toLowerCase())
        );
      case 'gt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case 'gte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'lt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case 'lte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue as string);
      default:
        return false;
    }
  };

  let filteredFiles = allFiles;

  const tagConditions = searchConditions.filter((c) => c.field === 'tags');
  const otherConditions = searchConditions.filter((c) => c.field !== 'tags');

  if (otherConditions.length > 0) {
    filteredFiles = filteredFiles.filter((file) => {
      const results = otherConditions.map((cond) => evaluateCondition(file, cond));
      return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
    });
  }

  if (tagConditions.length > 0) {
    for (const tagCond of tagConditions) {
      const tagNames = Array.isArray(tagCond.value) ? tagCond.value : [tagCond.value as string];
      const filesWithTags = await db
        .select({ fileId: fileTags.fileId })
        .from(fileTags)
        .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, tagNames)))
        .all();

      const fileIdSet = new Set(filesWithTags.map((t) => t.fileId));
      filteredFiles = filteredFiles.filter((f) => fileIdSet.has(f.id));
    }
  }

  const sortField = sortBy || 'createdAt';
  const order = sortOrder || 'desc';
  filteredFiles.sort((a, b) => {
    let aVal: string | number = a[sortField] ?? '';
    let bVal: string | number = b[sortField] ?? '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (order === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
  });

  const total = filteredFiles.length;
  const offset = ((page || 1) - 1) * (limit || 50);
  const paginatedResults = filteredFiles.slice(offset, offset + (limit || 50));

  return {
    items: paginatedResults,
    total,
    page: page || 1,
    limit: limit || 50,
    totalPages: Math.ceil(total / (limit || 50)),
  };
}

export async function getSearchSuggestions(
  db: ReturnType<typeof getDb>,
  userId: string,
  query: string,
  type: 'name' | 'tags' | 'mime'
) {
  if (type === 'name' && query.length >= 2) {
    const results = await db
      .select({ name: files.name })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), like(files.name, `${query}%`)))
      .limit(10)
      .all();

    const suggestions = [...new Set(results.map((r) => r.name))];
    return suggestions;
  }

  if (type === 'tags') {
    const allTags = await db.select({ name: fileTags.name }).from(fileTags).where(eq(fileTags.userId, userId)).all();

    const uniqueTags = [...new Set(allTags.map((t) => t.name))];
    const filtered = query ? uniqueTags.filter((t) => t.toLowerCase().includes(query.toLowerCase())) : uniqueTags;

    return filtered.slice(0, 20);
  }

  if (type === 'mime') {
    const results = await db
      .select({ mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const mimeTypes = [...new Set(results.map((r) => r.mimeType).filter(Boolean))] as string[];
    const filtered = query ? mimeTypes.filter((m) => m.toLowerCase().includes(query.toLowerCase())) : mimeTypes;

    return filtered.slice(0, 20);
  }

  return [];
}

export async function getRecentFiles(
  db: ReturnType<typeof getDb>,
  userId: string,
  limit: number
) {
  const recentFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .orderBy(desc(files.updatedAt))
    .limit(limit)
    .all();

  return recentFiles;
}
