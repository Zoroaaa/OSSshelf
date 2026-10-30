/**
 * useEditPreview.ts
 * 审批前预计算编辑类工具的 diff。
 *
 * 新链路使用 needsApproval，工具尚未执行，后端无法返回 diff；
 * 因此在前端用与后端相同的算法在本地复算，失败时降级为不展示预览（不阻塞审批）。
 */

import { useEffect, useMemo, useState } from 'react';
import { fileContentApi } from '@/services/api';
import type { PreviewDiff } from '../types';

const PREVIEW_TOOLS = new Set(['edit_file_content', 'append_to_file', 'find_and_replace']);
const MAX_SOURCE_BYTES = 64 * 1024;
const PREVIEW_CHARS = 500;

interface EditOperation {
  operation?: string;
  oldValue?: string;
  newValue?: string;
  position?: number;
}

function applyEdits(original: string, args: Record<string, unknown>): { content: string; changes: number } {
  let content = original;
  let changes = 0;

  const pushChange = () => {
    changes++;
  };

  const edits = Array.isArray(args.edits) ? (args.edits as EditOperation[]) : [];
  if (edits.length > 0) {
    for (const edit of edits) {
      switch (edit.operation) {
        case 'replace':
          if (edit.oldValue && edit.newValue !== undefined && content.includes(edit.oldValue)) {
            content = content.replace(edit.oldValue, edit.newValue);
            pushChange();
          }
          break;
        case 'append':
          if (edit.newValue) {
            content += `\n${edit.newValue}`;
            pushChange();
          }
          break;
        case 'insert':
          if (edit.newValue !== undefined) {
            const position = Math.max(0, Math.min(edit.position ?? 0, content.length));
            content = content.slice(0, position) + edit.newValue + content.slice(position);
            pushChange();
          }
          break;
        case 'delete':
          if (edit.oldValue && content.includes(edit.oldValue)) {
            content = content.replace(edit.oldValue, '');
            pushChange();
          }
          break;
        default:
          break;
      }
    }
    return { content, changes };
  }

  if (typeof args.content === 'string') {
    content = args.addNewline === false ? original + args.content : `${original}\n${args.content}`;
    pushChange();
    return { content, changes };
  }

  const find = typeof args.find === 'string' ? args.find : '';
  const replace = typeof args.replace === 'string' ? args.replace : '';
  if (find && replace) {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const matches = original.match(regex);
    changes = matches ? matches.length : 0;
    content = original.replace(regex, replace);
  }

  return { content, changes };
}

export function useEditPreview(
  toolName: string,
  args: Record<string, unknown> | undefined,
  enabled: boolean
): PreviewDiff | null {
  const [diff, setDiff] = useState<PreviewDiff | null>(null);
  const argsKey = args ? JSON.stringify(args) : '';
  // 用序列化结果作为稳定依赖：args 每次 render 都是新对象，直接进依赖会导致重复请求
  const parsedArgs = useMemo(() => {
    if (!argsKey) return undefined;
    try {
      return JSON.parse(argsKey) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, [argsKey]);

  useEffect(() => {
    if (!enabled || !parsedArgs || !PREVIEW_TOOLS.has(toolName)) {
      setDiff(null);
      return;
    }

    const fileId = typeof parsedArgs.fileId === 'string' ? parsedArgs.fileId : '';
    if (!fileId) {
      setDiff(null);
      return;
    }

    let cancelled = false;
    setDiff(null);

    fileContentApi
      .getRaw(fileId)
      .then((response) => {
        if (cancelled) return;
        const original = response.data?.data?.content ?? '';
        if (!original || original.length > MAX_SOURCE_BYTES) return;
        const { content, changes } = applyEdits(original, parsedArgs);
        if (changes === 0) return;
        setDiff({
          before: original.slice(0, PREVIEW_CHARS),
          after: content.slice(0, PREVIEW_CHARS),
          totalChanges: changes,
        });
      })
      .catch(() => {
        // 无权限/非文本文件：不展示预览，不影响审批
      });

    return () => {
      cancelled = true;
    };
  }, [toolName, parsedArgs, enabled]);

  return diff;
}
