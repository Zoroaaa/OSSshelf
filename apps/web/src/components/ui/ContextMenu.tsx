/**
 * ContextMenu.tsx
 * 右键菜单组件
 *
 * 功能:
 * - 右键弹出菜单
 * - 支持子菜单
 * - 支持分隔线
 * - 支持图标和快捷键显示
 * - 点击外部自动关闭
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/utils';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  submenu?: ContextMenuItem[];
  action?: () => void;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (!isOpen) {
      setSubmenuOpen(null);
      return;
    }

    const adjustPosition = () => {
      const menuWidth = 200;
      const menuHeight = items.length * 36;
      const padding = 8;

      let x = position.x;
      let y = position.y;

      if (x + menuWidth + padding > window.innerWidth) {
        x = window.innerWidth - menuWidth - padding;
      }
      if (y + menuHeight + padding > window.innerHeight) {
        y = window.innerHeight - menuHeight - padding;
      }

      setAdjustedPosition({ x: Math.max(padding, x), y: Math.max(padding, y) });
    };

    adjustPosition();
  }, [isOpen, position, items.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] max-w-[280px] bg-popover border rounded-lg shadow-lg py-1 animate-in fade-in-0 zoom-in-95"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {items.map((item) => (
        <MenuItem
          key={item.id}
          item={item}
          onClose={onClose}
          onSubmenuOpen={setSubmenuOpen}
          submenuOpen={submenuOpen}
        />
      ))}
    </div>
  );
}

interface MenuItemProps {
  item: ContextMenuItem;
  onClose: () => void;
  onSubmenuOpen: (id: string | null) => void;
  submenuOpen: string | null;
}

function MenuItem({ item, onClose, onSubmenuOpen, submenuOpen }: MenuItemProps) {
  const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });
  const itemRef = useRef<HTMLDivElement>(null);

  if (item.divider) {
    return <div className="my-1 border-t" />;
  }

  const handleClick = () => {
    if (item.disabled || item.submenu) return;
    item.action?.();
    onClose();
  };

  const handleMouseEnter = () => {
    if (item.submenu && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      setSubmenuPosition({ x: rect.right, y: rect.top });
      onSubmenuOpen(item.id);
    }
  };

  const handleMouseLeave = () => {
    if (item.submenu && submenuOpen !== item.id) {
      onSubmenuOpen(null);
    }
  };

  return (
    <>
      <div
        ref={itemRef}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors',
          item.disabled
            ? 'opacity-50 cursor-not-allowed'
            : item.danger
              ? 'text-destructive hover:bg-destructive/10'
              : 'hover:bg-accent',
          submenuOpen === item.id && 'bg-accent'
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
        <span className="flex-1 truncate">{item.label}</span>
        {item.shortcut && <span className="text-xs text-muted-foreground ml-auto">{item.shortcut}</span>}
        {item.submenu && (
          <svg className="w-3 h-3 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>

      {item.submenu && submenuOpen === item.id && (
        <div
          className="fixed z-[10000] min-w-[160px] bg-popover border rounded-lg shadow-lg py-1 animate-in fade-in-0 zoom-in-95"
          style={{ left: submenuPosition.x, top: submenuPosition.y }}
          onMouseEnter={() => onSubmenuOpen(item.id)}
          onMouseLeave={() => onSubmenuOpen(null)}
        >
          {item.submenu.map((subItem) => (
            <div
              key={subItem.id}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors',
                subItem.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : subItem.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'hover:bg-accent'
              )}
              onClick={() => {
                if (!subItem.disabled) {
                  subItem.action?.();
                  onClose();
                }
              }}
            >
              {subItem.icon && <span className="w-4 h-4 flex-shrink-0">{subItem.icon}</span>}
              <span className="flex-1 truncate">{subItem.label}</span>
              {subItem.shortcut && <span className="text-xs text-muted-foreground">{subItem.shortcut}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function useContextMenuState() {
  const [state, setState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    items: ContextMenuItem[];
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    items: [],
  });

  const openContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      items,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    isOpen: state.isOpen,
    position: state.position,
    items: state.items,
    openContextMenu,
    closeContextMenu,
    ContextMenuComponent: () => (
      <ContextMenu isOpen={state.isOpen} position={state.position} items={state.items} onClose={closeContextMenu} />
    ),
  };
}
