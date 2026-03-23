/**
 * GalleryItem.tsx
 * 图库视图文件项组件
 *
 * 功能:
 * - 图库模式展示图片
 * - 图片自适应高度
 * - 删除操作
 */

import { useResponsive } from '@/hooks/useResponsive';
import { filesApi } from '@/services/api';
import { cn, decodeFileName } from '@/utils';
import { Trash2 } from 'lucide-react';
import { ActionBtn } from './ActionBtn';
import type { GalleryItemProps } from '@/types/files';

export function GalleryItem({ file, token, onClick, onDelete, onContextMenu }: GalleryItemProps) {
  const { isMobile } = useResponsive();

  return (
    <div
      className="masonry-item relative rounded-lg overflow-hidden group cursor-pointer"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <img
        src={filesApi.previewUrl(file.id, token)}
        alt={decodeFileName(file.name)}
        className="w-full block object-cover"
        loading="lazy"
      />
      <div
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity flex flex-col justify-end p-2',
          isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <p className="text-white text-xs font-medium truncate">{decodeFileName(file.name)}</p>
        <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
          <ActionBtn title="删除" onClick={onDelete} danger light>
            <Trash2 className="h-3 w-3" />
          </ActionBtn>
        </div>
      </div>
    </div>
  );
}
