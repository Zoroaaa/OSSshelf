/**
 * KeyboardShortcutsDialog.tsx
 * 快捷键帮助对话框
 *
 * 功能:
 * - 显示所有可用快捷键
 * - 分类展示
 * - 支持搜索过滤
 *
 * A-09/E-25：迁移到 AppDialog，复用 Radix 的 role=dialog、aria-modal、
 * Escape 关闭、焦点陷阱与关闭后焦点归还；同时移除未实现的快捷键描述。
 */

import { useMemo, useState } from 'react';
import { AppDialog } from '@/components/ui/AppDialog';
import { Input } from '@/components/ui/Input';
import { Search } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: {
    keys: string;
    description: string;
  }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '文件操作',
    shortcuts: [
      { keys: 'Ctrl+N', description: '新建文件夹' },
      { keys: 'Ctrl+U', description: '上传文件' },
      { keys: 'Ctrl+A', description: '全选' },
      { keys: 'Delete', description: '删除选中项' },
      { keys: 'F2', description: '重命名' },
      { keys: 'Enter', description: '打开文件/文件夹' },
    ],
  },
  {
    title: '视图切换',
    shortcuts: [
      { keys: 'Ctrl+G', description: '网格视图' },
      { keys: 'Ctrl+L', description: '列表视图' },
      // E-25：原「Ctrl+/ 聚焦搜索框」全仓库无实现，移除以免误导
    ],
  },
  {
    title: '导航',
    shortcuts: [
      { keys: '↑', description: '向上移动选择' },
      { keys: '↓', description: '向下移动选择' },
      // E-25：迁移到 AppDialog 后自身 Escape 关闭有效，文案与实现保持一致
      { keys: 'Esc', description: '关闭对话框' },
    ],
  },
];

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return SHORTCUT_GROUPS;

    return SHORTCUT_GROUPS.map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter(
        (s) =>
          s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.keys.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    })).filter((group) => group.shortcuts.length > 0);
  }, [searchQuery]);

  return (
    <AppDialog open={isOpen} onClose={onClose} title="键盘快捷键" widthClass="max-w-lg">
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索快捷键..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>

        {filteredGroups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">没有找到匹配的快捷键</div>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{group.title}</h3>
                <div className="space-y-1">
                  {group.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-accent/50"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">{shortcut.keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center border-t pt-3">
          Mac 用户请将 Ctrl 替换为 ⌘ (Command)
        </p>
      </div>
    </AppDialog>
  );
}
