/**
 * useFileContextMenu.ts
 * 右键菜单逻辑 Hook
 *
 * 功能:
 * - 文件右键菜单项生成
 * - 背景右键菜单项生成
 */

import { useCallback } from 'react';
import { useContextMenuState, ContextMenuItem } from '@/components/ui/ContextMenu';
import type { FileItem } from '@osshelf/shared';
import type { FileContextMenuCallbacks, BackgroundContextMenuCallbacks } from '@/types/files';
import {
  Eye,
  Download,
  Share2,
  Tag,
  Shield,
  Settings,
  Pencil,
  FolderInput,
  Copy,
  Scissors,
  Trash2,
  RefreshCw,
  CheckSquare,
  Upload,
  FolderPlus,
  Clipboard,
  Link2,
} from 'lucide-react';

export function useFileContextMenu() {
  const { openContextMenu, ContextMenuComponent } = useContextMenuState();

  const getFileContextMenuItems = useCallback(
    (file: FileItem, callbacks: FileContextMenuCallbacks): ContextMenuItem[] => {
      return [
        {
          id: 'open',
          label: file.isFolder ? '打开文件夹' : '打开',
          icon: <Eye className="h-4 w-4" />,
          action: () => callbacks.onOpen(file),
        },
        { id: 'divider1', label: '', divider: true },
        {
          id: 'download',
          label: '下载',
          icon: <Download className="h-4 w-4" />,
          action: () => callbacks.onDownload(file),
          disabled: file.isFolder,
        },
        {
          id: 'share',
          label: file.isFolder ? '分享文件夹' : '分享',
          icon: <Share2 className="h-4 w-4" />,
          action: () => callbacks.onShare(file),
        },
        {
          id: 'uploadLink',
          label: '创建上传链接',
          icon: <Link2 className="h-4 w-4" />,
          action: () => callbacks.onUploadLink?.(file),
          disabled: !file.isFolder,
        },
        {
          id: 'tags',
          label: '标签管理',
          icon: <Tag className="h-4 w-4" />,
          action: () => callbacks.onTags(file),
        },
        {
          id: 'permissions',
          label: '权限管理',
          icon: <Shield className="h-4 w-4" />,
          action: () => callbacks.onPermissions(file),
        },
        {
          id: 'folderSettings',
          label: '文件夹设置',
          icon: <Settings className="h-4 w-4" />,
          action: () => callbacks.onFolderSettings(file),
          disabled: !file.isFolder,
        },
        { id: 'divider2', label: '', divider: true },
        {
          id: 'rename',
          label: '重命名',
          icon: <Pencil className="h-4 w-4" />,
          shortcut: 'F2',
          action: () => callbacks.onRename(file),
        },
        {
          id: 'move',
          label: '移动到...',
          icon: <FolderInput className="h-4 w-4" />,
          action: () => callbacks.onMove(file),
        },
        {
          id: 'copy',
          label: '复制',
          icon: <Copy className="h-4 w-4" />,
          shortcut: 'Ctrl+C',
          action: () => callbacks.onCopy(file),
        },
        {
          id: 'cut',
          label: '剪切',
          icon: <Scissors className="h-4 w-4" />,
          shortcut: 'Ctrl+X',
          action: () => callbacks.onCut(file),
        },
        { id: 'divider3', label: '', divider: true },
        {
          id: 'delete',
          label: '移入回收站',
          icon: <Trash2 className="h-4 w-4" />,
          danger: true,
          action: () => callbacks.onDelete(file),
        },
      ];
    },
    []
  );

  const getBackgroundContextMenuItems = useCallback((callbacks: BackgroundContextMenuCallbacks): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: 'refresh',
        label: '刷新',
        icon: <RefreshCw className="h-4 w-4" />,
        action: () => callbacks.onRefresh(),
      },
      { id: 'divider1', label: '', divider: true },
      {
        id: 'selectAll',
        label: '全选',
        icon: <CheckSquare className="h-4 w-4" />,
        shortcut: 'Ctrl+A',
        action: () => callbacks.onSelectAll(),
      },
      {
        id: 'upload',
        label: '上传文件',
        icon: <Upload className="h-4 w-4" />,
        shortcut: 'Ctrl+U',
        action: () => callbacks.onUpload(),
      },
      {
        id: 'newFolder',
        label: '新建文件夹',
        icon: <FolderPlus className="h-4 w-4" />,
        shortcut: 'Ctrl+Shift+N',
        action: () => callbacks.onNewFolder(),
      },
    ];

    if (callbacks.hasClipboard && callbacks.clipboardCount > 0) {
      items.push(
        { id: 'divider2', label: '', divider: true },
        {
          id: 'paste',
          label: `粘贴 (${callbacks.clipboardCount} 个项目)`,
          icon: <Clipboard className="h-4 w-4" />,
          shortcut: 'Ctrl+V',
          action: () => callbacks.onPaste(),
        }
      );
    }

    return items;
  }, []);

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      file: FileItem | undefined,
      fileCallbacks: FileContextMenuCallbacks,
      bgCallbacks: BackgroundContextMenuCallbacks
    ) => {
      if (file) {
        openContextMenu(e, getFileContextMenuItems(file, fileCallbacks));
      } else {
        openContextMenu(e, getBackgroundContextMenuItems(bgCallbacks));
      }
    },
    [openContextMenu, getFileContextMenuItems, getBackgroundContextMenuItems]
  );

  return {
    ContextMenuComponent,
    getFileContextMenuItems,
    getBackgroundContextMenuItems,
    handleContextMenu,
  };
}
