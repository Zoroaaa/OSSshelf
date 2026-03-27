/**
 * Buckets.tsx
 * 存储桶管理页面
 *
 * 功能:
 * - 多厂商存储桶配置
 * - 存储桶增删改查
 * - 存储桶测试与切换
 * - 存储桶配额设置
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bucketsApi, PROVIDER_META, type StorageBucket, type BucketFormData } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { formatBytes } from '@/utils';
import { cn } from '@/utils';
import {
  Plus,
  Trash2,
  Star,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Settings2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Edit3,
  X,
  Save,
  Database,
  Wifi,
  ArrowRightLeft,
} from 'lucide-react';

import { MigrateBucketDialog } from '@/components/files/dialogs';

// ── Provider Badge ────────────────────────────────────────────────────────
function ProviderBadge({ provider }: { provider: StorageBucket['provider'] }) {
  const meta = PROVIDER_META[provider];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Bucket Form ───────────────────────────────────────────────────────────
interface BucketFormProps {
  initial?: StorageBucket | null;
  onSave: (data: BucketFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

function BucketForm({ initial, onSave, onCancel, loading }: BucketFormProps) {
  const isEdit = !!initial;
  const [form, setForm] = useState<BucketFormData>({
    name: initial?.name || '',
    provider: initial?.provider || 'r2',
    bucketName: initial?.bucketName || '',
    endpoint: initial?.endpoint || '',
    region: initial?.region || '',
    accessKeyId: '',
    secretAccessKey: '',
    pathStyle: initial?.pathStyle || false,
    isDefault: initial?.isDefault || false,
    notes: initial?.notes || '',
    storageQuota: initial?.storageQuota ?? null,
  });
  const [storageQuotaInput, setStorageQuotaInput] = useState<string>(
    initial?.storageQuota ? String(Math.round(initial.storageQuota / 1024 ** 3)) : ''
  );
  const [showSecret, setShowSecret] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const meta = PROVIDER_META[form.provider];

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入显示名称';
    if (form.provider === 'telegram') {
      if (!form.accessKeyId.trim()) errs.accessKeyId = '请输入 Bot Token';
      if (!form.bucketName.trim()) errs.bucketName = '请输入 Chat ID';
    } else {
      if (!form.bucketName.trim()) errs.bucketName = '请输入存储桶名称';
      if (!isEdit && !form.accessKeyId.trim()) errs.accessKeyId = '请输入 Access Key ID';
      if (!isEdit && !form.secretAccessKey?.trim()) errs.secretAccessKey = '请输入 Secret Access Key';
      if (meta.regionRequired && !form.region?.trim()) errs.region = '该厂商需要填写区域';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      const data = { ...form };
      // Telegram 不需要 secretAccessKey，使用占位符
      if (data.provider === 'telegram') {
        data.secretAccessKey = 'telegram-no-secret';
      }
      if (isEdit && !data.accessKeyId) delete (data as any).accessKeyId;
      if (isEdit && !data.secretAccessKey) delete (data as any).secretAccessKey;
      onSave(data);
    }
  };

  const field = (
    label: string,
    key: keyof BucketFormData,
    opts?: {
      type?: string;
      placeholder?: string;
      required?: boolean;
      hint?: string;
    }
  ) => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium flex items-center gap-1">
        {label}
        {opts?.required && <span className="text-red-500">*</span>}
      </label>
      <Input
        type={opts?.type || 'text'}
        value={(form[key] as string) || ''}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={opts?.placeholder}
        className={cn(errors[key] && 'border-red-500 focus-visible:ring-red-500')}
      />
      {opts?.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
      {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Provider selector */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          存储厂商 <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            Object.entries(PROVIDER_META) as [
              StorageBucket['provider'],
              (typeof PROVIDER_META)[keyof typeof PROVIDER_META],
            ][]
          ).map(([key, m]) => (
            <button
              key={key}
              type="button"
              onClick={() => setForm((f) => ({ ...f, provider: key }))}
              className={cn(
                'flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 text-xs font-medium transition-all',
                form.provider === key
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:border-border/80 hover:bg-muted/50 text-muted-foreground'
              )}
            >
              <span className="text-lg">{m.icon}</span>
              <span className="text-center leading-tight">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('显示名称', 'name', {
          required: true,
          placeholder: form.provider === 'telegram' ? '如：我的 Telegram 频道' : '如：我的 R2 存储桶',
        })}
        {form.provider === 'telegram' ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1">
              Chat ID <span className="text-red-500">*</span>
            </label>
            <Input
              value={form.bucketName || ''}
              onChange={(e) => setForm((f) => ({ ...f, bucketName: e.target.value }))}
              placeholder="-1001234567890"
              className={cn(errors.bucketName && 'border-red-500 focus-visible:ring-red-500')}
            />
            <p className="text-xs text-muted-foreground">频道/群组 ID，私人频道通常以 -100 开头</p>
            {errors.bucketName && <p className="text-xs text-red-500">{errors.bucketName}</p>}
          </div>
        ) : (
          field('存储桶名称', 'bucketName', { required: true, placeholder: '如：my-bucket-name' })
        )}
      </div>

      {form.provider === 'telegram' ? (
        /* ── Telegram 专属配置区 ────────────────────────────────────── */
        <div className="space-y-4 p-4 rounded-lg border-2 border-[#26A5E4]/30 bg-[#26A5E4]/5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#26A5E4]">
            <span className="text-base">✈️</span> Telegram Bot 配置
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1">
              Bot Token {!isEdit && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={form.accessKeyId || ''}
                onChange={(e) => setForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                placeholder={isEdit ? '留空则保留原有 Token' : '123456789:ABCdefGHIjklMNO...'}
                className={cn('pr-10', errors.accessKeyId && 'border-red-500 focus-visible:ring-red-500')}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">从 @BotFather 获取，格式：&lt;id&gt;:&lt;token&gt;</p>
            {errors.accessKeyId && <p className="text-xs text-red-500">{errors.accessKeyId}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bot API 代理地址（可选）</label>
            <Input
              value={form.endpoint || ''}
              onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
              placeholder="https://api.telegram.org（留空使用默认）"
            />
            <p className="text-xs text-muted-foreground">仅在无法直连 Telegram 时填入自建代理</p>
          </div>
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ 使用须知</p>
            <ul className="text-xs text-amber-600 dark:text-amber-500 space-y-0.5 list-disc list-inside">
              <li>
                单文件上传上限 <strong>50 MB</strong>（Telegram Bot API 限制）
              </li>
              <li>
                请确保 Bot 已被添加为目标频道/群组的<strong>管理员</strong>
              </li>
              <li>
                私人频道 Chat ID 通常以 <code>-100</code> 开头
              </li>
              <li>存储空间由 Telegram 服务器提供，理论无上限</li>
            </ul>
          </div>
        </div>
      ) : (
        /* ── S3 兼容存储配置区 ──────────────────────────────────────── */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">Endpoint URL</label>
              <Input
                value={form.endpoint || ''}
                onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                placeholder={meta.endpointPlaceholder || '留空使用默认'}
                className={cn(errors.endpoint && 'border-red-500')}
              />
              {errors.endpoint && <p className="text-xs text-red-500">{errors.endpoint}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                区域 (Region){meta.regionRequired && <span className="text-red-500">*</span>}
              </label>
              {meta.regions ? (
                <select
                  value={form.region || ''}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  className={cn(
                    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                    'focus:outline-none focus:ring-1 focus:ring-ring',
                    errors.region && 'border-red-500'
                  )}
                >
                  <option value="">选择区域…</option>
                  {meta.regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={form.region || ''}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  placeholder="如：us-east-1（可选）"
                />
              )}
              {errors.region && <p className="text-xs text-red-500">{errors.region}</p>}
            </div>
          </div>

          {/* Credentials */}
          <div className="space-y-3 p-4 rounded-lg bg-muted/40 border">
            <p className="text-sm font-medium text-muted-foreground">访问凭证{isEdit ? '（留空则保留原值）' : ''}</p>
            {field('Access Key ID', 'accessKeyId', {
              required: !isEdit,
              placeholder: isEdit ? '留空则保留原有凭证' : '输入 Access Key ID',
            })}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                Secret Access Key{!isEdit && <span className="text-red-500">*</span>}
              </label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={form.secretAccessKey || ''}
                  onChange={(e) => setForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                  placeholder={isEdit ? '留空则保留原有凭证' : '输入 Secret Access Key'}
                  className={cn('pr-10', errors.secretAccessKey && 'border-red-500')}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.secretAccessKey && <p className="text-xs text-red-500">{errors.secretAccessKey}</p>}
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.pathStyle || false}
                onChange={(e) => setForm((f) => ({ ...f, pathStyle: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm">强制 Path-style URL</span>
              <span className="text-xs text-muted-foreground">（MinIO / B2 等需要）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault || false}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm">设为默认存储桶</span>
            </label>
          </div>
        </>
      )}

      {field('备注（可选）', 'notes', { placeholder: '用途说明或备忘信息' })}

      {/* Storage quota */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">存储限额（可选）</label>
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            min={1}
            value={storageQuotaInput || ''}
            onChange={(e) => {
              const v = e.target.value;
              setStorageQuotaInput(v);
              setForm((f) => ({
                ...f,
                storageQuota: v ? Math.round(parseFloat(v) * 1024 * 1024 * 1024) : null,
              }));
            }}
            placeholder="留空则不限制"
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">GB</span>
          {form.storageQuota && (
            <span className="text-xs text-muted-foreground">≈ {(form.storageQuota / 1024 ** 3).toFixed(1)} GB</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">限制此存储桶的最大使用量（留空则无限制）</p>
      </div>

      {/* Default checkbox — common to all providers */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.isDefault || false}
          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
          className="rounded"
        />
        <span className="text-sm">设为默认存储桶</span>
      </label>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={loading} className="flex-1 sm:flex-none">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isEdit ? '保存修改' : '添加存储桶'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          <X className="h-4 w-4 mr-1.5" /> 取消
        </Button>
      </div>
    </div>
  );
}

// ── Bucket Card ───────────────────────────────────────────────────────────
interface BucketCardProps {
  bucket: StorageBucket;
  onEdit: (b: StorageBucket) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onToggle: (id: string) => void;
  onTest: (id: string) => void;
  onMigrate: (id: string) => void;
  testResult?: { connected: boolean; message: string } | null;
  testLoading?: boolean;
}

function BucketCard({
  bucket,
  onEdit,
  onDelete,
  onSetDefault,
  onToggle,
  onTest,
  onMigrate,
  testResult,
  testLoading,
}: BucketCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = PROVIDER_META[bucket.provider];

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200',
        !bucket.isActive && 'opacity-60',
        bucket.isDefault && 'border-primary/40 bg-primary/[0.02]'
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0 mt-0.5"
          style={{ background: `${meta.color}15` }}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate">{bucket.name}</h3>
            {bucket.isDefault && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                <Star className="h-2.5 w-2.5" /> 默认
              </span>
            )}
            {!bucket.isActive && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                已禁用
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ProviderBadge provider={bucket.provider} />
            <span className="text-xs text-muted-foreground font-mono">{bucket.bucketName}</span>
          </div>
          {bucket.endpoint && (
            <p className="text-xs text-muted-foreground mt-1 truncate font-mono">{bucket.endpoint}</p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 p-1"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Stats bar */}
      <div className="px-4 pb-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Database className="h-3.5 w-3.5" />
          {formatBytes(bucket.storageUsed)}
          {bucket.storageQuota && <span className="opacity-50">/ {formatBytes(bucket.storageQuota)}</span>}
        </span>
        <span>{bucket.fileCount} 个文件</span>
        {bucket.region && <span className="font-mono">{bucket.region}</span>}

        {/* Test result */}
        {testResult && (
          <span
            className={cn(
              'flex items-center gap-1 ml-auto px-2 py-0.5 rounded-full',
              testResult.connected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
            )}
          >
            {testResult.connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {testResult.message}
          </span>
        )}
      </div>

      {/* Expanded actions */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          {bucket.notes && <p className="text-xs text-muted-foreground italic">{bucket.notes}</p>}
          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTest(bucket.id)}
              disabled={testLoading}
              className="text-xs"
            >
              {testLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Wifi className="h-3.5 w-3.5 mr-1.5" />
              )}
              测试连接
            </Button>

            <Button variant="outline" size="sm" onClick={() => onEdit(bucket)} className="text-xs">
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />
              编辑
            </Button>

            {!bucket.isDefault && (
              <Button variant="outline" size="sm" onClick={() => onSetDefault(bucket.id)} className="text-xs">
                <Star className="h-3.5 w-3.5 mr-1.5" />
                设为默认
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => onToggle(bucket.id)} className="text-xs">
              {bucket.isActive ? (
                <>
                  <ToggleRight className="h-3.5 w-3.5 mr-1.5" />
                  禁用
                </>
              ) : (
                <>
                  <ToggleLeft className="h-3.5 w-3.5 mr-1.5" />
                  启用
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onMigrate(bucket.id)}
              className="text-xs"
              title="将此存储桶的文件迁移到另一个存储桶"
            >
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
              迁移文件
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(bucket.id)}
              className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              删除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function Buckets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { connected: boolean; message: string }>>({});
  const [migrateSourceId, setMigrateSourceId] = useState<string | null>(null);

  const { data: buckets = [], isLoading } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
    staleTime: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['buckets'] });

  const createMutation = useMutation({
    mutationFn: (data: BucketFormData) => bucketsApi.create(data),
    onSuccess: () => {
      toast({ title: '存储桶已添加' });
      invalidate();
      setShowForm(false);
    },
    onError: (e: any) =>
      toast({ title: '添加失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BucketFormData> }) => bucketsApi.update(id, data),
    onSuccess: () => {
      toast({ title: '存储桶已更新' });
      invalidate();
      setEditingBucket(null);
    },
    onError: (e: any) =>
      toast({ title: '更新失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => bucketsApi.delete(id),
    onSuccess: () => {
      toast({ title: '已删除存储桶' });
      invalidate();
      setDeleteConfirmId(null);
    },
    onError: (e: any) =>
      toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => bucketsApi.setDefault(id),
    onSuccess: () => {
      toast({ title: '已设为默认存储桶' });
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: '操作失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => bucketsApi.toggle(id),
    onSuccess: (res) => {
      const active = res.data.data?.isActive;
      toast({ title: active ? '已启用存储桶' : '已禁用存储桶' });
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: '操作失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await bucketsApi.test(id);
      const result = res.data.data;
      if (result) {
        setTestResults((prev) => ({ ...prev, [id]: result }));
        toast({
          title: result.connected ? '✅ 连接成功' : '❌ 连接失败',
          description: result.message,
          variant: result.connected ? 'default' : 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: '测试失败', description: e.response?.data?.error?.message, variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">存储桶管理</h1>
          <p className="text-muted-foreground text-sm mt-0.5">管理多厂商、多存储桶的连接配置</p>
        </div>
        <Button
          onClick={() => {
            setShowForm(true);
            setEditingBucket(null);
          }}
          disabled={showForm}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          添加存储桶
        </Button>
      </div>

      {/* Add / Edit Form */}
      {(showForm || editingBucket) && (
        <Card className="border-primary/30 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Settings2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {editingBucket ? `编辑：${editingBucket.name}` : '添加新存储桶'}
                </CardTitle>
                <CardDescription>{editingBucket ? '修改存储桶配置' : '配置 S3 兼容存储桶的连接信息'}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <BucketForm
              initial={editingBucket}
              loading={createMutation.isPending || updateMutation.isPending}
              onCancel={() => {
                setShowForm(false);
                setEditingBucket(null);
              }}
              onSave={(data) => {
                if (editingBucket) {
                  updateMutation.mutate({ id: editingBucket.id, data });
                } else {
                  createMutation.mutate(data);
                }
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Bucket list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          加载中…
        </div>
      ) : buckets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Database className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">暂无存储桶配置</h3>
            <p className="text-sm text-muted-foreground mb-4">添加第一个存储桶来开始管理您的对象存储</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              添加第一个存储桶
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(buckets as StorageBucket[]).map((bucket) => (
            <BucketCard
              key={bucket.id}
              bucket={bucket}
              onEdit={(b) => {
                setEditingBucket(b);
                setShowForm(false);
              }}
              onDelete={(id) => setDeleteConfirmId(id)}
              onSetDefault={(id) => setDefaultMutation.mutate(id)}
              onToggle={(id) => toggleMutation.mutate(id)}
              onTest={handleTest}
              onMigrate={(id) => setMigrateSourceId(id)}
              testResult={testResults[bucket.id] ?? null}
              testLoading={testingId === bucket.id}
            />
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <CardTitle className="text-base text-red-500">确认删除存储桶</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                删除存储桶配置后，该存储桶中的文件记录仍会保留，但将无法通过此系统访问或操作这些文件。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => deleteMutation.mutate(deleteConfirmId!)}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  确认删除
                </Button>
                <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                  取消
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Migrate bucket dialog */}
      {migrateSourceId && (
        <MigrateBucketDialog defaultSourceId={migrateSourceId} onClose={() => setMigrateSourceId(null)} />
      )}

      {/* Info card */}
      <Card className="bg-muted/30 border-muted">
        <CardContent className="pt-5">
          <h4 className="text-sm font-semibold mb-2">支持的存储厂商</h4>
          <div className="flex flex-wrap gap-2">
            {(
              Object.entries(PROVIDER_META) as [
                StorageBucket['provider'],
                (typeof PROVIDER_META)[keyof typeof PROVIDER_META],
              ][]
            ).map(([key, _m]) => (
              <ProviderBadge key={key} provider={key} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            所有支持 S3 兼容 API 的对象存储服务均可通过"自定义 S3 兼容"接入。 凭证将加密存储于数据库中。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
