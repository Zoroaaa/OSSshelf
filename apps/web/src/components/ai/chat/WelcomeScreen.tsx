/**
 * WelcomeScreen.tsx
 * 聊天空状态欢迎页组件
 *
 * 功能:
 * - 欢迎标题和描述
 * - 能力标签展示
 * - 建议问题卡片（点击填充输入框）
 */

import { MessageSquare, Sparkles } from 'lucide-react';

interface WelcomeScreenProps {
  suggestedQuestions: string[];
  onSelectQuestion: (question: string) => void;
}

const CAPABILITY_TAGS = ['搜索', '创建', '编辑', '统计', '浏览', '收藏', '分享', '标签', '版本', 'AI'];

export function WelcomeScreen({ suggestedQuestions, onSelectQuestion }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/20">
        <MessageSquare className="h-7 w-7 text-white" />
      </div>
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">文件管理智能助手</h2>
      <p className="text-sm text-slate-400 mb-2 max-w-sm">可以搜索文件、查看统计、浏览文件夹，结果可直接点击跳转</p>
      <div className="flex flex-wrap gap-1.5 justify-center mb-6 max-w-sm">
        {CAPABILITY_TAGS.map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs border border-violet-200 dark:border-violet-700"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestedQuestions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSelectQuestion(q)}
            className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-xs text-slate-600 dark:text-slate-400 group"
          >
            <Sparkles className="h-3 w-3 text-violet-500 mb-1.5 group-hover:scale-110 transition-transform" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
