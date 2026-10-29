import { describe, expect, it } from 'vitest';
import type { Env } from '../types/env';
import { buildAgentInstanceName, issueWsTicket, verifyWsTicket, WS_TICKET_TTL_MS } from './auth';

const env = { JWT_SECRET: 'test-secret' } as Env;

describe('agent ws ticket', () => {
  it('round-trips a valid ticket', async () => {
    const ticket = await issueWsTicket(env, 'user-1', 'session-1');
    const claims = await verifyWsTicket(env, ticket);
    expect(claims).toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });

  it('rejects a tampered payload', async () => {
    const ticket = await issueWsTicket(env, 'user-1', 'session-1');
    const [, signature] = ticket.split('.');
    const forgedPayload = btoa(`user-2:session-1:${Date.now() + WS_TICKET_TTL_MS}`)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyWsTicket(env, `${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects an expired ticket', async () => {
    const ticket = await issueWsTicket(env, 'user-1', 'session-1');
    const originalNow = Date.now;
    Date.now = () => originalNow() + WS_TICKET_TTL_MS + 1;
    try {
      expect(await verifyWsTicket(env, ticket)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it('builds a stable instance name', () => {
    expect(buildAgentInstanceName('user-1', 'session-1')).toBe('user-1:session-1');
  });
});
