/**
 * KeyboardShortcutsDialog.tsx
 * 快捷键帮助对话框
 *
 * 功能:
 * - 显示所有可用快捷键
 * - 分类展示
 * - 支持搜索过滤
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Search, X, Keyboard } from 'lucide-react';

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
      { keys: 'Ctrl+/', description: '聚焦搜索框' },
    ],
  },
  {
    title: '导航',
    shortcuts: [
      { keys: '↑', description: '向上移动选择' },
      { keys: '↓', description: '向下移动选择' },
      { keys: 'Esc', description: '取消选择/关闭对话框' },
    ],
  },
  {
    title: '编辑操作',
    shortcuts: [
      { keys: 'Ctrl+C', description: '复制' },
      { keys: 'Ctrl+X', description: '剪切' },
      { keys: 'Ctrl+V', description: '粘贴' },
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">键盘快捷键</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索快捷键..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
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
        </div>

        <div className="p-4 border-t bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">Mac 用户请将 Ctrl 替换为 ⌘ (Command)</p>
        </div>
      </div>
    </div>
  );
}
