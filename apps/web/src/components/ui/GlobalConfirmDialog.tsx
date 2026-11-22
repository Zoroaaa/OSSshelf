/**
 * GlobalConfirmDialog.tsx
 * 全局确认对话框（审查报告 A-19 / A-20）
 *
 * 挂载在 App 根节点，读取 useConfirmStore 的确认请求并以统一 AppDialog 呈现。
 * 危险级别提供视觉分级；critical 级需输入指定文本才能确认。
 */

import { useEffect, useState } from 'react';
import { AlertCircle, AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AppDialog } from '@/components/ui/AppDialog';
import { useConfirmStore, type ConfirmLevel } from '@/components/ui/useConfirm';

const LEVEL_META: Record<ConfirmLevel, { icon: typeof Info; accent: string; buttonClass: string }> = {
  info: { icon: Info, accent: 'text-primary', buttonClass: '' },
  warn: { icon: AlertCircle, accent: 'text-amber-500', buttonClass: '' },
  danger: {
    icon: AlertTriangle,
    accent: 'text-destructive',
    buttonClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  },
  critical: {
    icon: AlertOctagon,
    accent: 'text-destructive',
    buttonClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  },
};

export function GlobalConfirmDialog() {
  const options = useConfirmStore((s) => s.options);
  const close = useConfirmStore((s) => s.close);
  const [input, setInput] = useState('');

  useEffect(() => {
    setInput('');
  }, [options]);

  if (!options) return null;

  const level = options.level ?? 'warn';
  const meta = LEVEL_META[level];
  const Icon = meta.icon;
  const needInput = level === 'critical' && Boolean(options.requireInput);
  const canConfirm = !needInput || input.trim() === options.requireInput;

  return (
    <AppDialog
      open
      onClose={() => close(false)}
      stackId="global-confirm-dialog"
      title={options.title}
      widthClass="max-w-md"
      showClose={false}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            {options.cancelText ?? '取消'}
          </Button>
          <Button className={meta.buttonClass} disabled={!canConfirm} onClick={() => close(true)}>
            {options.confirmText ?? (level === 'info' ? '知道了' : '确认')}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className={`shrink-0 ${meta.accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-3">
          {options.description && <p className="text-sm leading-relaxed">{options.description}</p>}
          {options.impact && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {options.impact}
            </div>
          )}
          {needInput && (
            <div className="space-y-1.5">
              <label htmlFor="confirm-input" className="block text-sm font-medium">
                请输入 <code className="rounded bg-muted px-1 py-0.5">{options.requireInput}</code> 以确认
              </label>
              <input
                id="confirm-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={options.requireInput}
                autoComplete="off"
              />
            </div>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
