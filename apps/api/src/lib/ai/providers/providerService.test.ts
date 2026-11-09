import { describe, expect, it } from 'vitest';
import {
  analyzeEndpointSecurity,
  isPrivateHostname,
  normalizeBaseUrl,
  parseHeaders,
  parseHeadersJson,
} from './providerService';

describe('providerService URL handling', () => {
  it('strips trailing slashes and endpoint suffixes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com/v1/models')).toBe('https://api.example.com/v1');
  });

  it('rejects non-https endpoints', () => {
    expect(() => normalizeBaseUrl('http://api.example.com/v1')).toThrow(/https/);
  });

  it('rejects local and private network endpoints', () => {
    for (const url of [
      'https://localhost:11434/v1',
      'https://127.0.0.1/v1',
      'https://10.0.0.8/v1',
      'https://172.16.1.1/v1',
      'https://192.168.1.2/v1',
      'https://169.254.169.254/latest',
      'https://[::1]/v1',
      'https://metadata.google.internal/v1',
    ]) {
      expect(() => normalizeBaseUrl(url)).toThrow(/私有网络/);
    }
  });

  it('rejects empty, invalid and unsupported protocols', () => {
    expect(() => normalizeBaseUrl('')).toThrow();
    expect(() => normalizeBaseUrl('not-a-url')).toThrow();
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow();
  });

  it('allows public https endpoints', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('flags legacy insecure endpoints without throwing', () => {
    expect(analyzeEndpointSecurity('http://localhost:11434/v1')).toEqual({
      secure: false,
      warnings: ['insecure_transport', 'private_network'],
    });
    expect(analyzeEndpointSecurity('https://api.example.com/v1')).toEqual({ secure: true, warnings: [] });
    expect(analyzeEndpointSecurity(null)).toEqual({ secure: true, warnings: [] });
  });

  it('detects private hosts', () => {
    expect(isPrivateHostname('192.168.0.1')).toBe(true);
    expect(isPrivateHostname('fc00::1')).toBe(true);
    expect(isPrivateHostname('api.example.com')).toBe(false);
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
