/**
 * types.ts
 * AI Chat 相关共享类型定义
 */

export interface AgentFile {
  id: string;
  name: string;
  path?: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  createdAt: string;
}

export interface ToolCallEvent {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error' | 'pending_confirm';
  confirmStatus?: 'pending' | 'confirmed' | 'cancelled';
  approvalId?: string;
}

export interface PreviewDiff {
  before: string;
  after: string;
  totalChanges: number;
}

export interface PendingConfirm {
  confirmId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: Array<{ id: string; name: string; isFolder: boolean; mimeType: string | null; score?: number }>;
  toolCalls?: ToolCallEvent[];
  pendingConfirm?: PendingConfirm;
  /** 由 update_plan 工具调用派生 */
  plan?: ExecutionPlan;
  timestamp: Date;
  isLoading?: boolean;
  aborted?: boolean;
  /** 本地乐观消息：已发出但 Agent 连接尚未就绪 */
  pending?: boolean;
  mentionedFiles?: Array<{ id: string; name: string }>;
}

export interface ExecutionPlanStep {
  id: string;
  description: string;
  toolHint?: string;
  dependsOn?: string[];
  status: 'pending' | 'running' | 'done' | 'skipped';
}

export interface ExecutionPlan {
  goal: string;
  steps: ExecutionPlanStep[];
  estimatedToolCalls: number;
}
