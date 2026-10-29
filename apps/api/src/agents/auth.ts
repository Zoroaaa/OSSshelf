/**
 * agents/auth.ts
 * Agent WebSocket 鉴权
 *
 * 设计:
 * - 客户端先用 REST 换取短期 ticket（60s，HMAC-SHA256）
 * - WebSocket 连接只携带 ticket，避免长期 JWT 出现在 URL / 日志
 * - onBeforeConnect 校验 ticket 与 DO 名称（userId:sessionId）一致后，注入内部头
 */

import type { Env } from '../types/env';

export const WS_TICKET_TTL_MS = 2 * 60 * 60_000;

const USER_HEADER = 'x-osshelf-user-id';
const SESSION_HEADER = 'x-osshelf-session-id';

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function buildAgentInstanceName(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

export async function issueWsTicket(env: Env, userId: string, sessionId: string): Promise<string> {
  const payload = `${buildAgentInstanceName(userId, sessionId)}:${Date.now() + WS_TICKET_TTL_MS}`;
  const encoded = toBase64Url(encoder.encode(payload));
  const signature = await sign(env.JWT_SECRET, encoded);
  return `${encoded}.${signature}`;
}

export async function verifyWsTicket(env: Env, ticket: string): Promise<{ userId: string; sessionId: string } | null> {
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature) return null;

  const expected = await sign(env.JWT_SECRET, encoded);
  if (!constantTimeEqual(signature, expected)) return null;

  let payload: string;
  try {
    payload = new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }

  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const expiresAt = Number(parts[parts.length - 1]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const sessionId = parts[parts.length - 2];
  const userId = parts.slice(0, parts.length - 2).join(':');
  if (!userId || !sessionId) return null;

  return { userId, sessionId };
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * routeAgentRequest 的 onBeforeConnect 钩子。
 * 校验通过后把身份写入请求头，供 DO 的 onConnect 使用；
 * 模型/工具/用量一律以该身份为准，绝不从模型参数或 body 读取 userId。
 */
export async function verifyAgentConnection(
  request: Request,
  route: { className: string; name: string },
  env: Env
): Promise<Response | Request | void> {
  if (route.className !== 'OSSShelfAgent') {
    return unauthorized('Unknown agent');
  }

  const url = new URL(request.url);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return unauthorized('Missing ticket');

  const claims = await verifyWsTicket(env, ticket);
  if (!claims) return unauthorized('Invalid or expired ticket');

  if (route.name !== buildAgentInstanceName(claims.userId, claims.sessionId)) {
    return unauthorized('Ticket does not match session');
  }

  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, claims.userId);
  headers.set(SESSION_HEADER, claims.sessionId);

  return new Request(request, { headers });
}

export function getVerifiedIdentity(request: Request): { userId: string | null; sessionId: string | null } {
  return {
    userId: request.headers.get(USER_HEADER),
    sessionId: request.headers.get(SESSION_HEADER),
  };
}
