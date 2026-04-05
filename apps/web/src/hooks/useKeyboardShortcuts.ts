/**
 * useKeyboardShortcuts.ts
 * 键盘快捷键管理 Hook
 *
 * 功能:
 * - 全局快捷键注册与管理
 * - 组合键支持 (Ctrl/Cmd + Key)
 * - 作用域管理 (全局/文件列表/对话框)
 * - 快捷键冲突检测
 */

import { useEffect, useCallback, useRef } from 'react';

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  action: () => void;
  description: string;
  scope?: 'global' | 'files' | 'modal' | 'input';
  preventDefault?: boolean;
  enabled?: boolean;
}

function matchesShortcut(event: KeyboardEvent, config: ShortcutConfig): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modPressed = isMac ? event.metaKey : event.ctrlKey;

  const needsCtrl = config.ctrl || config.meta;
  const ctrlMatch = needsCtrl ? modPressed : !modPressed;
  const shiftMatch = config.shift ? event.shiftKey : !event.shiftKey;
  const altMatch = config.alt ? event.altKey : !event.altKey;
  const keyMatch =
    event.key.toLowerCase() === config.key.toLowerCase() || event.code.toLowerCase() === config.key.toLowerCase();

  return ctrlMatch && shiftMatch && altMatch && keyMatch;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const shortcutsRef = useRef<ShortcutConfig[]>(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    for (const config of shortcutsRef.current) {
      if (config.enabled === false) continue;

      const scope = config.scope || 'global';
      if (isInputFocused && scope !== 'input') continue;

      if (matchesShortcut(event, config)) {
        if (config.preventDefault !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
        config.action();
        return;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return {
    getShortcutDisplay: (config: ShortcutConfig) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const parts: string[] = [];

      if (config.ctrl || config.meta) {
        parts.push(isMac ? '⌘' : 'Ctrl');
      }
      if (config.shift) parts.push(isMac ? '⇧' : 'Shift');
      if (config.alt) parts.push(isMac ? '⌥' : 'Alt');

      let keyDisplay = config.key.toUpperCase();
      if (config.key === 'ArrowUp') keyDisplay = '↑';
      else if (config.key === 'ArrowDown') keyDisplay = '↓';
      else if (config.key === 'ArrowLeft') keyDisplay = '←';
      else if (config.key === 'ArrowRight') keyDisplay = '→';
      else if (config.key === 'Enter') keyDisplay = '↵';
      else if (config.key === 'Escape') keyDisplay = 'Esc';
      else if (config.key === 'Delete') keyDisplay = 'Del';
      else if (config.key === 'Backspace') keyDisplay = '⌫';

      parts.push(keyDisplay);
      return parts.join(isMac ? '' : '+');
    },
  };
}

export function useFileKeyboardShortcuts({
  onSelectAll,
  onClearSelection,
  onDelete,
  onRename,
  onOpen,
  onNavigateUp,
  onNavigateDown,
  onNewFolder,
  onUpload,
  onToggleGridView,
  onToggleListView,
  onFocusSearch,
  selectedCount,
  hasFiles,
}: {
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onOpen?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
  onToggleGridView?: () => void;
  onToggleListView?: () => void;
  onFocusSearch?: () => void;
  selectedCount: number;
  hasFiles: boolean;
}) {
  const shortcuts: ShortcutConfig[] = [
    {
      key: 'a',
      ctrl: true,
      action: () => onSelectAll?.(),
      description: '全选',
      scope: 'files',
      enabled: hasFiles,
    },
    {
      key: 'Escape',
      action: () => {
        if (selectedCount > 0) {
          onClearSelection?.();
        }
      },
      description: '取消选择',
      scope: 'global',
    },
    {
      key: 'Delete',
      action: () => selectedCount > 0 && onDelete?.(),
      description: '删除',
      scope: 'files',
      enabled: selectedCount > 0,
    },
    {
      key: 'F2',
      action: () => selectedCount === 1 && onRename?.(),
      description: '重命名',
      scope: 'files',
      enabled: selectedCount === 1,
    },
    {
      key: 'Enter',
      action: () => selectedCount === 1 && onOpen?.(),
      description: '打开',
      scope: 'files',
      enabled: selectedCount === 1,
    },
    {
      key: 'ArrowUp',
      action: () => onNavigateUp?.(),
      description: '向上',
      scope: 'files',
      enabled: hasFiles,
    },
    {
      key: 'ArrowDown',
      action: () => onNavigateDown?.(),
      description: '向下',
      scope: 'files',
      enabled: hasFiles,
    },
    {
      key: 'n',
      ctrl: true,
      shift: true,
      action: () => onNewFolder?.(),
      description: '新建文件夹',
      scope: 'files',
    },
    {
      key: 'U',
      ctrl: true,
      action: () => onUpload?.(),
      description: '上传',
      scope: 'files',
    },
    {
      key: 'g',
      ctrl: true,
      action: () => onToggleGridView?.(),
      description: '网格视图',
      scope: 'files',
    },
    {
      key: 'l',
      ctrl: true,
      action: () => onToggleListView?.(),
      description: '列表视图',
      scope: 'files',
    },
    {
      key: '/',
      ctrl: true,
      action: () => onFocusSearch?.(),
      description: '搜索',
      scope: 'global',
    },
  ];

  return useKeyboardShortcuts(shortcuts);
}
