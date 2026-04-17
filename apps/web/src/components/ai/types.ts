/**
 * types.ts
 * AI Chat 相关共享类型定义
 */

export interface AgentFile {
  id: string;
  name: string;
  path: string;
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
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  toolCalls?: ToolCallEvent[];
  pendingConfirm?: PendingConfirm;
  timestamp: Date;
  isLoading?: boolean;
  aborted?: boolean;
  mentionedFiles?: Array<{ id: string; name: string }>;
}

export interface SseChunk {
  type?: 'reset' | 'plan' | 'plan_step_update';
  content?: string;
  done?: boolean;
  sessionId?: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  reasoning?: boolean;
  toolStart?: boolean;
  toolResult?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  confirmRequest?: boolean;
  confirmId?: string;
  summary?: string;
  plan?: ExecutionPlan;
  stepId?: string;
  status?: string;
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
