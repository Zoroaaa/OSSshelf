import { describe, it, expect } from 'vitest';
import {
  normalizeEntryName,
  normalizeParentId,
  pathPrefix,
  trimTrailingSlash,
  isSameOrDescendantPath,
} from './pathUtils';

describe('pathUtils', () => {
  describe('normalizeEntryName', () => {
    it('去除首尾空白', () => {
      expect(normalizeEntryName('  a.txt  ')).toBe('a.txt');
    });

    it('拒绝空名、. / ..、路径分隔符与控制字符', () => {
      expect(() => normalizeEntryName('   ')).toThrow();
      expect(() => normalizeEntryName('.')).toThrow();
      expect(() => normalizeEntryName('..')).toThrow();
      expect(() => normalizeEntryName('a/b.txt')).toThrow();
      expect(() => normalizeEntryName('a\\b.txt')).toThrow();
      expect(() => normalizeEntryName('a\u0001b')).toThrow();
    });

    it('拒绝超长名称', () => {
      expect(() => normalizeEntryName('a'.repeat(256))).toThrow();
    });
  });

  describe('normalizeParentId', () => {
    it('空值归一为 null', () => {
      expect(normalizeParentId(null)).toBeNull();
      expect(normalizeParentId(undefined)).toBeNull();
      expect(normalizeParentId('  ')).toBeNull();
    });

    it('拒绝含分隔符的父级标识', () => {
      expect(() => normalizeParentId('a/b')).toThrow();
      expect(() => normalizeParentId('a\\b')).toThrow();
      expect(normalizeParentId(' folder-1 ')).toBe('folder-1');
    });
  });

  describe('pathPrefix / trimTrailingSlash', () => {
    it('根目录前缀为 /', () => {
      expect(pathPrefix('/')).toBe('/');
      expect(pathPrefix('')).toBe('/');
    });

    it('普通目录补尾斜杠', () => {
      expect(pathPrefix('/docs')).toBe('/docs/');
      expect(pathPrefix('/docs/')).toBe('/docs/');
      expect(trimTrailingSlash('/docs///')).toBe('/docs');
    });
  });

  describe('isSameOrDescendantPath', () => {
    it('识别自身与子孙', () => {
      expect(isSameOrDescendantPath('/a/b', '/a/b')).toBe(true);
      expect(isSameOrDescendantPath('/a/b/c', '/a/b')).toBe(true);
    });

    it('不把同名前缀目录误判为子孙', () => {
      expect(isSameOrDescendantPath('/a/bc', '/a/b')).toBe(false);
      expect(isSameOrDescendantPath('/a', '/a/b')).toBe(false);
    });
  });
});
