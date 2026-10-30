/**
 * ToolInfoModal.tsx
 * 工具说明弹窗：按分类展示工具清单（数据来自 toolMeta 单一来源）。
 */

import { useEffect } from 'react';
import { Wrench, X } from 'lucide-react';
import { CATEGORY_DESC, groupedToolMeta } from './toolMeta';

interface ToolInfoModalProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS = groupedToolMeta();

export function ToolInfoModal({ open, onClose }: ToolInfoModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const total = GROUPS.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wrench className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">可用工具</p>
            <p className="text-[11px] text-muted-foreground">共 {total} 个 · 写操作会自动弹出确认</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-4">
            {GROUPS.map((group) => (
              <section key={group.category}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">{group.category}</h3>
                  <p className="text-[11px] text-muted-foreground">{CATEGORY_DESC[group.category]}</p>
                  <span className="ml-auto text-[10px] text-muted-foreground">{group.tools.length} 个</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.tools.map((tool) => (
                    <span
                      key={tool.name}
                      className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                      title={tool.name}
                    >
                      {tool.label}
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          提示：复杂任务会自动生成执行计划；涉及写入的操作（创建/编辑/删除/分享/授权等）都需要你确认后执行。
        </div>
      </div>
    </div>
  );
}
