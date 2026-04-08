/**
 * ToolInfoModal.tsx
 * 工具说明弹窗组件
 *
 * 功能:
 * - 展示全部AI工具，按分类展示
 * - 使用技巧说明
 */

import {
  X,
  Wrench,
  Sparkles,
  Search,
  FileText,
  FolderOpen,
  BarChart3,
  Tag,
  Share2,
  Clock,
  StickyNote,
  Shield,
  HardDrive,
  Settings,
  Brain,
} from 'lucide-react';

interface ToolMeta {
  label: string;
  icon: React.ReactNode;
  category: string;
}

interface ToolCategory {
  key: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  desc: string;
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    key: '搜索发现',
    icon: <Search className="h-4 w-4" />,
    color: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    desc: '智能搜索、文件过滤、标签检索、重复检测',
  },
  {
    key: '内容理解',
    icon: <FileText className="h-4 w-4" />,
    color: 'text-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    border: 'border-violet-200 dark:border-violet-800',
    desc: '读取文件、图片分析、元数据提取、AI摘要/标签',
  },
  {
    key: '目录导航',
    icon: <FolderOpen className="h-4 w-4" />,
    color: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    desc: '浏览文件夹、目录树、路径导航、存储概览',
  },
  {
    key: '统计分析',
    icon: <BarChart3 className="h-4 w-4" />,
    color: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    desc: '存储统计、活动趋势、配额信息、类型分布',
  },
  {
    key: '文件操作',
    icon: <FileText className="h-4 w-4" />,
    color: 'text-orange-500',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800',
    desc: '创建/编辑/重命名/移动/复制/删除/收藏文件',
  },
  {
    key: '标签管理',
    icon: <Tag className="h-4 w-4" />,
    color: 'text-pink-500',
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    border: 'border-pink-200 dark:border-pink-800',
    desc: '添加/移除/合并标签、自动打标、批量标签',
  },
  {
    key: '分享链接',
    icon: <Share2 className="h-4 w-4" />,
    color: 'text-cyan-500',
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    border: 'border-cyan-200 dark:border-cyan-800',
    desc: '创建分享链接、直链、上传链接、权限控制',
  },
  {
    key: '版本管理',
    icon: <Clock className="h-4 w-4" />,
    color: 'text-indigo-500',
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    border: 'border-indigo-200 dark:border-indigo-800',
    desc: '查看历史版本、恢复版本、版本对比',
  },
  {
    key: '笔记备注',
    icon: <StickyNote className="h-4 w-4" />,
    color: 'text-yellow-600',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    desc: '为文件添加/编辑/删除备注',
  },
  {
    key: '权限管理',
    icon: <Shield className="h-4 w-4" />,
    color: 'text-red-500',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    desc: '文件权限、文件夹访问级别、用户组管理',
  },
  {
    key: '存储管理',
    icon: <HardDrive className="h-4 w-4" />,
    color: 'text-slate-500',
    bg: 'bg-slate-100 dark:bg-slate-800',
    border: 'border-slate-300 dark:border-slate-700',
    desc: '存储桶列表、详情、默认设置、文件迁移',
  },
  {
    key: '系统管理',
    icon: <Settings className="h-4 w-4" />,
    color: 'text-gray-500',
    bg: 'bg-gray-50 dark:bg-gray-900/20',
    border: 'border-gray-200 dark:border-gray-700',
    desc: '用户画像、API密钥、Webhook、审计日志',
  },
  {
    key: 'AI增强',
    icon: <Brain className="h-4 w-4" />,
    color: 'text-purple-500',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    desc: 'AI摘要、AI标签、向量索引、RAG问答、智能命名',
  },
];

interface ToolInfoModalProps {
  open: boolean;
  onClose: () => void;
  toolMeta: Record<string, ToolMeta>;
}

export function ToolInfoModal({ open, onClose, toolMeta }: ToolInfoModalProps) {
  if (!open) return null;

  const totalTools = Object.keys(toolMeta).length;

  const toolsByCategory = TOOL_CATEGORIES.map((cat) => ({
    ...cat,
    tools: Object.entries(toolMeta)
      .filter(([, v]) => v.category === cat.key)
      .map(([name, v]) => ({ name, ...v })),
  }));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Wrench className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">AI 工具集</h2>
              <p className="text-xs text-slate-400">共 {totalTools} 个工具 · 13 个功能模块</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {toolsByCategory.map((cat) => (
            <div key={cat.key} className={`rounded-xl border ${cat.border} ${cat.bg} overflow-hidden`}>
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/50">
                <span className={cat.color}>{cat.icon}</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{cat.key}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{cat.tools.length}个工具</span>
              </div>
              <div className="px-4 py-2">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">{cat.desc}</p>
                <div className="flex flex-wrap gap-1.5">
                  {cat.tools.map((t) => (
                    <span
                      key={t.name}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/60 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300"
                    >
                      <span className={cat.color}>{t.icon}</span>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-4 mt-2">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">使用技巧</span>
            </div>
            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
              <li>• 用自然语言描述需求，AI会自动选择最合适的工具</li>
              <li>
                • 支持<strong>创建文件</strong>："帮我记一下明天要去开会，存到备忘录"
              </li>
              <li>
                • 支持<strong>编辑文件</strong>："把配置文件里的端口改成8080"
              </li>
              <li>
                • 支持<strong>收藏/分享</strong>："收藏这个项目文件夹"、"创建分享链接"
              </li>
              <li>
                • 支持<strong>RAG问答</strong>："我的合同里违约金怎么规定的？"
              </li>
              <li>• 危险操作（删除、修改）需要您确认后才会执行</li>
            </ul>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">OSSshelf AI Agent Tools v2.0</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
