import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, parseHeaders, parseHeadersJson } from './providerService';

describe('providerService URL handling', () => {
  it('strips trailing slashes and endpoint suffixes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com/v1/models')).toBe('https://api.example.com/v1');
  });

  it('accepts local http endpoints', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });

  it('rejects empty, invalid and non-http URLs', () => {
    expect(() => normalizeBaseUrl('')).toThrow();
    expect(() => normalizeBaseUrl('not-a-url')).toThrow();
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow();
  });
});

describe('providerService headers', () => {
  it('accepts a normal header object', () => {
    expect(parseHeaders({ 'HTTP-Referer': 'https://example.com' })).toEqual({
      'HTTP-Referer': 'https://example.com',
    });
  });

  it('rejects forbidden headers and non-string values', () => {
    expect(() => parseHeaders({ Host: 'example.com' })).toThrow();
    expect(() => parseHeaders({ 'X-Test': 123 })).toThrow();
  });

  it('returns null for empty input', () => {
    expect(parseHeaders(null)).toBeNull();
  });

  it('parses stored header JSON safely', () => {
    expect(parseHeadersJson('{"X-Test":"1"}')).toEqual({ 'X-Test': '1' });
    expect(parseHeadersJson('not-json')).toBeUndefined();
    expect(parseHeadersJson(null)).toBeUndefined();
  });
});
