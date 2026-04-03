/**
 * SuggestedQuestions.tsx
 * 建议问题卡片组件
 *
 * 功能:
 * - 展示预设问题
 * - 点击填充输入框
 */

import { Sparkles } from 'lucide-react';

interface SuggestedQuestionsProps {
  questions: string[];
  onSelect: (question: string) => void;
}

export function SuggestedQuestions({ questions, onSelect }: SuggestedQuestionsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
      {questions.map((question, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(question)}
          className="p-4 text-left border rounded-lg hover:bg-accent transition-colors text-sm group"
        >
          <Sparkles className="h-4 w-4 mb-2 text-purple-500 group-hover:scale-110 transition-transform" />
          {question}
        </button>
      ))}
    </div>
  );
}
