/**
 * utils/agentMessages.ts
 * AI SDK UIMessage → 现有聊天 UI Message 的映射
 */

import type { UIMessage } from 'ai';
import type { ExecutionPlan, Message, ToolCallEvent } from '@/components/ai/types';

interface MapOptions {
  streaming?: boolean;
}

function getPartType(part: UIMessage['parts'][number]): string {
  return typeof (part as { type?: unknown }).type === 'string' ? ((part as { type: string }).type as string) : '';
}

export function mapUIMessages(uiMessages: UIMessage[], options: MapOptions = {}): Message[] {
  const mapped = uiMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      let content = '';
      let reasoning = '';
      let sources: Message['sources'];
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
            title?: string;
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

          toolCalls.push({
            id: toolPart.toolCallId ?? `${message.id}-${toolCalls.length}`,
            toolName: type.slice(5),
            args: (toolPart.input as Record<string, unknown>) ?? {},
            result: toolPart.output,
            status,
            confirmStatus,
            approvalId: toolPart.approval?.id,
          });

          if (state === 'approval-requested' && toolPart.approval?.id) {
            pendingConfirm = {
              confirmId: toolPart.approval.id,
              toolName: type.slice(5),
              summary: toolPart.title ?? type.slice(5),
              args: (toolPart.input as Record<string, unknown>) ?? {},
            };
          }
          continue;
        }

        if (type === 'data-plan') {
          continue;
        }

        if (type === 'data-sources') {
          sources = (part as { data?: Message['sources'] }).data;
        }
      }

      return {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content,
        reasoning: reasoning || undefined,
        sources,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        pendingConfirm,
        timestamp: new Date(),
        isLoading: false,
      } as Message;
    });

  if (options.streaming) {
    const lastAssistant = [...mapped].reverse().find((message) => message.role === 'assistant');
    if (lastAssistant) lastAssistant.isLoading = true;
  }

  return mapped;
}

export function extractPendingApproval(uiMessages: UIMessage[]): {
  confirmId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
} | null {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const message = uiMessages[i];
    if (!message) continue;
    for (const part of message.parts) {
      const type = getPartType(part);
      if (!type.startsWith('tool-')) continue;

      const toolPart = part as {
        state?: string;
        input?: unknown;
        title?: string;
        approval?: { id: string; approved?: boolean };
      };

      if (toolPart.state === 'approval-requested' && toolPart.approval?.id) {
        return {
          confirmId: toolPart.approval.id,
          toolName: type.slice(5),
          args: (toolPart.input as Record<string, unknown>) ?? {},
          summary: toolPart.title ?? type.slice(5),
        };
      }
    }
  }
  return null;
}

export function extractPlan(uiMessages: UIMessage[]): ExecutionPlan | null {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const message = uiMessages[i];
    if (!message) continue;
    for (const part of message.parts) {
      if (getPartType(part) === 'data-plan') {
        return (part as { data?: ExecutionPlan }).data ?? null;
      }
    }
  }
  return null;
}
