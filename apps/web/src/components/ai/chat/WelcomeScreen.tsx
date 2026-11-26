/**
 * WelcomeScreen.tsx
 * 空状态欢迎页：能力标签 + 示例问题。
 */

import { MessageSquare, Sparkles } from 'lucide-react';

interface WelcomeScreenProps {
  suggestedQuestions: string[];
  /** 能力标签由 /api/ai-config/effective 下发，未配置时用内置兜底 */
  capabilityTags?: string[];
  onSelectQuestion: (question: string) => void;
}

const FALLBACK_CAPABILITY_TAGS = ['搜索', '创建', '编辑', '统计', '浏览', '收藏', '分享', '标签', '版本', 'AI'];

export function WelcomeScreen({ suggestedQuestions, capabilityTags, onSelectQuestion }: WelcomeScreenProps) {
  const tags = capabilityTags && capabilityTags.length > 0 ? capabilityTags : FALLBACK_CAPABILITY_TAGS;
  return (
    <div className="flex flex-col items-center justify-center px-2 py-10 text-center sm:py-16">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <MessageSquare className="h-7 w-7 text-primary" />
      </div>
      <h2 className="mb-1 text-xl font-bold text-foreground">文件管理智能助手</h2>
      <p className="mb-3 max-w-sm text-sm text-muted-foreground">
        搜索、创建、整理你的文件，结果可直接点击跳转；复杂任务会自动生成执行计划。
      </p>

      <div className="mb-6 flex max-w-md flex-wrap justify-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestedQuestions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onSelectQuestion(question)}
            className="group flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/40 hover:text-foreground"
          >
            <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
            <span className="leading-relaxed">{question}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
