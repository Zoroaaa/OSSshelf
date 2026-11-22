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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

/** 同一级菜单内用方向键移动焦点，跳过禁用项（E-06 键盘导航） */
function focusSiblingMenuItem(current: HTMLElement, direction: 'down' | 'up') {
  const menu = current.closest('[role="menu"]');
  if (!menu) return;
  // :scope 限定为当前菜单的直接子项，避免焦点跑到嵌套的子菜单里
  const items = Array.from(menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]')).filter(
    (el) => el.getAttribute('aria-disabled') !== 'true'
  );
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return;
  const nextIndex =
    direction === 'down' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
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

    let isScrollListenerReady = false;

    const handleScroll = () => {
      if (!isScrollListenerReady) return;
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    const scrollTimeout = setTimeout(() => {
      isScrollListenerReady = true;
    }, 100);

    // 打开后把焦点移到第一项，键盘用户可直接用方向键导航（E-06）
    const focusFirstItem = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>(':scope > [role="menuitem"]')?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      clearTimeout(scrollTimeout);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      className="fixed z-popover min-w-[180px] max-w-[280px] bg-popover border rounded-lg shadow-popover py-1 animate-in fade-in-0 zoom-in-95"
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

  // E-06：Enter/Space 触发菜单项，方向键在同层菜单项间移动焦点
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (item.disabled) return;
      if (item.submenu) {
        // 含子菜单的项用键盘触发时展开子菜单，而非直接执行 action
        handleMouseEnter();
        return;
      }
      handleClick();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusSiblingMenuItem(event.currentTarget, event.key === 'ArrowDown' ? 'down' : 'up');
    }
  };

  return (
    <>
      <div
        ref={itemRef}
        role="menuitem"
        tabIndex={item.disabled ? -1 : 0}
        aria-disabled={item.disabled || undefined}
        aria-haspopup={item.submenu ? 'menu' : undefined}
        aria-expanded={item.submenu ? submenuOpen === item.id : undefined}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors focus:outline-none focus-visible:bg-accent',
          item.disabled
            ? 'opacity-50 cursor-not-allowed'
            : item.danger
              ? 'text-destructive hover:bg-destructive/10'
              : 'hover:bg-accent',
          submenuOpen === item.id && 'bg-accent'
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
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
          role="menu"
          aria-orientation="vertical"
          className="fixed z-system min-w-[160px] bg-popover border rounded-lg shadow-popover py-1 animate-in fade-in-0 zoom-in-95"
          style={{ left: submenuPosition.x, top: submenuPosition.y }}
          onMouseEnter={() => onSubmenuOpen(item.id)}
          onMouseLeave={() => onSubmenuOpen(null)}
        >
          {item.submenu.map((subItem) => (
            <div
              key={subItem.id}
              role="menuitem"
              tabIndex={subItem.disabled ? -1 : 0}
              aria-disabled={subItem.disabled || undefined}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors focus:outline-none focus-visible:bg-accent',
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
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!subItem.disabled) {
                    subItem.action?.();
                    onClose();
                  }
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusSiblingMenuItem(event.currentTarget, event.key === 'ArrowDown' ? 'down' : 'up');
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

  // 用 ref 读取最新 state，使菜单组件引用保持稳定，避免每次渲染都重挂载（E-06）
  const stateRef = useRef(state);
  stateRef.current = state;

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

  // 稳定的组件引用：state 变化由父组件重渲染驱动，组件内部通过 ref 读取最新值，
  // 不会因为每次 render 都生成新的内联组件而导致整棵菜单重挂载（E-06）
  const ContextMenuComponent = useMemo(() => {
    const MenuComponent = () => (
      <ContextMenu
        isOpen={stateRef.current.isOpen}
        position={stateRef.current.position}
        items={stateRef.current.items}
        onClose={closeContextMenu}
      />
    );
    MenuComponent.displayName = 'ContextMenuComponent';
    return MenuComponent;
  }, [closeContextMenu]);

  return {
    isOpen: state.isOpen,
    position: state.position,
    items: state.items,
    openContextMenu,
    closeContextMenu,
    ContextMenuComponent,
  };
}
