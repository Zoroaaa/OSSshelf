/**
 * TeamCreateDialog.tsx
 * 创建团队对话框
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi } from '@/services/collab';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/utils';

interface TeamCreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

const TeamCreateDialog: React.FC<TeamCreateDialogProps> = ({ onClose, onCreated }) => {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => teamsApi.create(data).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '团队已创建' });
      onCreated();
    },
    onError: (e: any) => {
      const message = e.response?.data?.error?.message;
      if (message) {
        toast({ title: '创建失败', description: message, variant: 'destructive' });
      } else {
        toast({ title: '创建失败', variant: 'destructive' });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = '团队名称不能为空';
    } else if (name.length > 50) {
      newErrors.name = '团队名称不能超过50个字符';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">创建团队</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              团队名称 <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="例如：产品研发组"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">描述（可选）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述此团队的用途..."
              className="w-full min-h-[80px] px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/200</p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TeamCreateDialog;
