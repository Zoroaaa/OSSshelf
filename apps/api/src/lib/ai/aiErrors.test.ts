import { describe, expect, it } from 'vitest';
import { AiError, mapAiError } from './aiErrors';

describe('aiErrors', () => {
  it('classifies auth errors', () => {
    expect(mapAiError({ status: 401, message: 'unauthorized' }).code).toBe('AI_UNAUTHORIZED');
  });

  it('classifies rate limit as retryable', () => {
    const error = mapAiError({ status: 429, message: 'Too Many Requests' });
    expect(error.code).toBe('AI_RATE_LIMIT');
    expect(error.retryable).toBe(true);
  });

  it('classifies context overflow as non-retryable', () => {
    const error = mapAiError(new Error('maximum context length exceeded'));
    expect(error.code).toBe('AI_CONTEXT_OVERFLOW');
    expect(error.retryable).toBe(false);
  });

  it('preserves AiError instances', () => {
    const original = new AiError('AI_TOOL_FAILED', 'boom');
    expect(mapAiError(original)).toBe(original);
  });
});
