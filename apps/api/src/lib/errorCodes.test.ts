import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES } from '@osshelf/shared';

/**
 * 错误码一致性守卫。
 *
 * 背景：ERROR_CODES 曾用 Record<string, ErrorInfo> 声明，任意字符串都能通过类型检查，
 * 导致 26 个未登记错误码在运行时取到 undefined，AppError 构造直接抛 TypeError，
 * 最终把本应是 403/404 的业务错误降级成纯文本 500。这里用静态扫描把问题拦在测试阶段。
 */

const SRC_DIR = path.resolve(process.cwd(), 'src');

function listSourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      result.push(full);
    }
  }
  return result;
}

const sourceFiles = listSourceFiles(SRC_DIR);
const definedKeys = new Set(Object.keys(ERROR_CODES));

describe('错误码一致性', () => {
  it('throwAppError / new AppError 引用的错误码必须已登记', () => {
    const missing: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const patterns = [/throwAppError\(\s*'([A-Z][A-Z0-9_]*)'/g, /new AppError\(\s*'([A-Z][A-Z0-9_]*)'/g];
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
          const code = match[1];
          if (code && !definedKeys.has(code)) {
            missing.push(`${path.relative(SRC_DIR, file)}: ${code}`);
          }
        }
      }
    }

    expect(missing, `以下错误码未在 packages/shared 的 ERROR_CODES 中登记：\n${missing.join('\n')}`).toEqual([]);
  });

  it('ERROR_CODES.XXX 的直接引用必须已登记', () => {
    const missing: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const match of content.matchAll(/ERROR_CODES\.([A-Z][A-Z0-9_]*)/g)) {
        const code = match[1];
        if (code && !definedKeys.has(code)) {
          missing.push(`${path.relative(SRC_DIR, file)}: ${code}`);
        }
      }
    }

    expect(missing, `以下错误码引用不存在：\n${missing.join('\n')}`).toEqual([]);
  });

  it('响应体 error.code 必须是字符串，不能直接塞 ERROR_CODES 配置对象', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      // 只允许 code: ERROR_CODES.X.code；不允许 code: ERROR_CODES.X, / }
      const pattern = /code:\s*ERROR_CODES\.[A-Z][A-Z0-9_]*\s*[,}]/g;
      for (const match of content.matchAll(pattern)) {
        offenders.push(`${path.relative(SRC_DIR, file)}: ${match[0]}`);
      }
    }

    expect(offenders, `以下位置把错误码对象当字符串返回：\n${offenders.join('\n')}`).toEqual([]);
  });
});
