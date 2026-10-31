/**
 * utils/agentMessages.ts
 * AI SDK UIMessage → 现有聊天 UI Message 的映射
 *
 * 关键约定（这些字段以前都在映射层被丢弃，导致 UI 显示错误）：
 * - 时间：优先读服务端写入的 metadata.createdAt，缺失时用进程内稳定缓存
 * - 中断：读 metadata.aborted
 * - 来源：从文件类工具的输出派生，不依赖后端 data-part
 * - 计划：从 update_plan 工具调用派生，不依赖后端 data-part
 */

import type { UIMessage } from 'ai';
import type { ExecutionPlan, ExecutionPlanStep, Message, ToolCallEvent } from '@/components/ai/types';
import { summarizeToolCall } from '@/components/ai/chat/toolMeta';

interface MapOptions {
  streaming?: boolean;
}

interface MessageMetadata {
  createdAt?: string;
  aborted?: boolean;
}

const SOURCE_TOOL_NAMES = new Set([
  'search_files',
  'search_content',
  'smart_search',
  'filter_files',
  'search_by_tag',
  'get_similar_files',
  'get_recent_files',
  'list_folder',
  'get_starred_files',
]);

/** 无 metadata 的历史消息：首次映射时间固定下来，避免每帧都变成"现在" */
const fallbackTimestamps = new Map<string, Date>();

const MAX_SOURCES = 6;

type FileLike = { id?: unknown; name?: unknown; isFolder?: unknown; mimeType?: unknown; score?: unknown };

function getPartType(part: UIMessage['parts'][number]): string {
  return typeof (part as { type?: unknown }).type === 'string' ? ((part as { type: string }).type as string) : '';
}

function readMetadata(message: UIMessage): MessageMetadata {
  const raw = message.metadata;
  return raw && typeof raw === 'object' ? (raw as MessageMetadata) : {};
}

function resolveTimestamp(message: UIMessage): Date {
  const createdAt = readMetadata(message).createdAt;
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const cached = fallbackTimestamps.get(message.id);
  if (cached) return cached;
  const now = new Date();
  fallbackTimestamps.set(message.id, now);
  return now;
}

function isFileLike(value: unknown): value is FileLike {
  return Boolean(value) && typeof value === 'object' && typeof (value as FileLike).id === 'string';
}

/** 从工具输出里提取可引用的文件（去重、限量） */
function collectSources(calls: ToolCallEvent[]): Message['sources'] {
  const sources: NonNullable<Message['sources']> = [];
  const seen = new Set<string>();

  const push = (file: FileLike) => {
    if (typeof file.id !== 'string' || typeof file.name !== 'string') return;
    if (seen.has(file.id) || sources.length >= MAX_SOURCES) return;
    seen.add(file.id);
    sources.push({
      id: file.id,
      name: file.name,
      isFolder: file.isFolder === true,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : null,
      score: typeof file.score === 'number' ? file.score : undefined,
    });
  };

  for (const call of calls) {
    if (call.status !== 'done' || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as Record<string, unknown>;
    if (Array.isArray(result.files)) {
      for (const file of result.files) if (isFileLike(file)) push(file);
    } else if (isFileLike(result)) {
      push(result);
    } else {
      if (isFileLike(result.fileA)) push(result.fileA);
      if (isFileLike(result.fileB)) push(result.fileB);
    }
  }

  return sources.length > 0 ? sources : undefined;
}

function normalizeStep(raw: unknown, index: number): ExecutionPlanStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const step = raw as { id?: unknown; description?: unknown; toolHint?: unknown; status?: unknown };
  if (typeof step.description !== 'string') return null;
  const status =
    step.status === 'done' || step.status === 'running' || step.status === 'skipped' ? step.status : 'pending';
  return {
    id: typeof step.id === 'string' ? step.id : `step-${index + 1}`,
    description: step.description,
    toolHint: typeof step.toolHint === 'string' ? step.toolHint : undefined,
    status,
  };
}

function extractPlanFromToolCalls(toolCalls: ToolCallEvent[]): ExecutionPlan | undefined {
  let plan: ExecutionPlan | undefined;

  for (const call of toolCalls) {
    if (call.toolName !== 'update_plan' || !call.args) continue;
    const goal = typeof call.args.goal === 'string' ? call.args.goal : '';
    const rawSteps = Array.isArray(call.args.steps) ? call.args.steps : [];
    const steps = rawSteps.map(normalizeStep).filter((step): step is ExecutionPlanStep => Boolean(step));
    if (!goal || steps.length === 0) continue;
    plan = { goal, steps, estimatedToolCalls: steps.length };
  }

  return plan;
}

export function mapUIMessages(uiMessages: UIMessage[], options: MapOptions = {}): Message[] {
  const mapped = uiMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      let content = '';
      let reasoning = '';
      let pendingConfirm: Message['pendingConfirm'];
      const toolCalls: ToolCallEvent[] = [];

      for (const part of message.parts) {
        const type = getPartType(part);

        if (type === 'text') {
          content += (part as { text?: string }).text ?? '';
          continue;
        }

        if (type === 'reasoning') {
          reasoning += (part as { text?: string }).text ?? '';
          continue;
        }

        if (type.startsWith('tool-')) {
          const toolPart = part as {
            toolCallId?: string;
            state?: string;
            input?: unknown;
            output?: unknown;
            approval?: { id: string; approved?: boolean };
          };

          const state = toolPart.state ?? '';
          const status: ToolCallEvent['status'] =
            state === 'output-available'
              ? 'done'
              : state === 'output-error'
                ? 'error'
                : state === 'approval-requested'
                  ? 'pending_confirm'
                  : 'running';

          const confirmStatus: ToolCallEvent['confirmStatus'] =
            state === 'approval-requested'
              ? 'pending'
              : state === 'output-denied'
                ? 'cancelled'
                : state === 'approval-responded'
                  ? 'confirmed'
                  : undefined;

          const toolName = type.slice(5);
          const args = (toolPart.input as Record<string, unknown>) ?? {};

          toolCalls.push({
            id: toolPart.toolCallId ?? `${message.id}-${toolCalls.length}`,
            toolName,
            args,
            result: toolPart.output,
            status,
            confirmStatus,
            approvalId: toolPart.approval?.id,
          });

          if (state === 'approval-requested' && toolPart.approval?.id) {
            pendingConfirm = {
              confirmId: toolPart.approval.id,
              toolName,
              summary: summarizeToolCall(toolName, args),
              args,
            };
          }
          continue;
        }
      }

      const metadata = readMetadata(message);
      const plan = message.role === 'assistant' ? extractPlanFromToolCalls(toolCalls) : undefined;
      const sourceCalls = toolCalls.filter((call) => SOURCE_TOOL_NAMES.has(call.toolName));
      const sources = collectSources(sourceCalls);

      return {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content,
        reasoning: reasoning || undefined,
        sources,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        pendingConfirm,
        plan,
        timestamp: resolveTimestamp(message),
        aborted: Boolean(metadata.aborted),
        isLoading: false,
      } as Message;
    });

  if (options.streaming) {
    const lastAssistant = [...mapped].reverse().find((message) => message.role === 'assistant');
    if (lastAssistant) lastAssistant.isLoading = true;
  }

  // 只保留最后一个计划：模型每次 update_plan 都会新建一条工具调用，
  // 全部渲染会在长对话里堆出多个进度条
  const lastPlanIndex = mapped.reduce((last, message, index) => (message.plan ? index : last), -1);
  if (lastPlanIndex >= 0) {
    mapped.forEach((message, index) => {
      if (index !== lastPlanIndex) message.plan = undefined;
    });
  }

  return mapped;
}
