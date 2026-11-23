/**
 * mimeTypes.test.ts — MIME 推断逻辑的契约测试
 * MIME 是分享/预览/Content-Type 的共同依赖，映射一旦被改错会静默影响多个模块，
 * 故对扩展名解析边界（多点文件名、大小写、无扩展名）做守卫。
 */
import { describe, it, expect } from 'vitest';
import { getMimeTypeFromExtension, inferMimeType } from './mimeTypes';

describe('getMimeTypeFromExtension', () => {
  it('常规扩展名返回对应 MIME', () => {
    expect(getMimeTypeFromExtension('photo.png')).toBe('image/png');
    expect(getMimeTypeFromExtension('report.pdf')).toBe('application/pdf');
    expect(getMimeTypeFromExtension('script.sh')).toBe('application/x-sh');
  });

  it('扩展名大小写不敏感', () => {
    expect(getMimeTypeFromExtension('PHOTO.PNG')).toBe('image/png');
    expect(getMimeTypeFromExtension('Doc.Pdf')).toBe('application/pdf');
  });

  it('取最后一段扩展名（tar.gz 归 gzip 而非 tar）', () => {
    expect(getMimeTypeFromExtension('archive.tar.gz')).toBe('application/gzip');
    expect(getMimeTypeFromExtension('backup.tar')).toBe('application/x-tar');
  });

  it('无扩展名或点结尾返回 null', () => {
    expect(getMimeTypeFromExtension('README')).toBeNull();
    expect(getMimeTypeFromExtension('file.')).toBeNull();
    expect(getMimeTypeFromExtension('')).toBeNull();
  });

  it('未知扩展名返回 null', () => {
    expect(getMimeTypeFromExtension('data.unknownext')).toBeNull();
  });

  it('点开头的文件名按扩展名表解析（.gitignore 在表内）', () => {
    expect(getMimeTypeFromExtension('.gitignore')).toBe('text/plain');
    expect(getMimeTypeFromExtension('.env')).toBe('text/plain');
  });
});

describe('inferMimeType', () => {
  it('优先使用调用方提供的 MIME', () => {
    expect(inferMimeType('a.png', 'image/custom')).toBe('image/custom');
  });

  it('provided 为 application/octet-stream 时走扩展名推断', () => {
    expect(inferMimeType('a.png', 'application/octet-stream')).toBe('image/png');
  });

  it('provided 为空时走扩展名推断', () => {
    expect(inferMimeType('a.json', null)).toBe('application/json');
    expect(inferMimeType('a.json', undefined)).toBe('application/json');
  });

  it('无法推断时兜底 application/octet-stream', () => {
    expect(inferMimeType('data.unknownext')).toBe('application/octet-stream');
    expect(inferMimeType('noext', 'application/octet-stream')).toBe('application/octet-stream');
  });
});
