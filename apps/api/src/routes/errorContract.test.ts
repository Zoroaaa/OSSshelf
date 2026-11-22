/**
 * errorContract.test.ts — 错误响应契约守卫
 *
 * 背景：路由层曾累计 349 处手写 `return c.json({ success:false, error:{ code, message } })`，
 * 与 `middleware/error.ts` 的标准结构（含 name/requestId/timestamp）不一致。
 * 统一改造完成后，用静态扫描锁住两条规则，防止回潮：
 *   1. 路由里不允许出现手写的失败响应（必须 throwAppError / new AppError）；
 *   2. 错误码不允许写成字面量（必须引用 @osshelf/shared 的 ERROR_CODES，或作为键名传给 throwAppError）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));

const files = fs
  .readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => path.join(ROUTES_DIR, f));

const isCJson = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'json';

function scan(file: string) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handwritten: string[] = [];
  const literalCodes: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression && isCJson(node.expression)) {
      const arg = node.expression.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const success = arg.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'success'
        );
        if (success && success.initializer.kind === ts.SyntaxKind.FalseKeyword) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          handwritten.push(`${path.basename(file)}:${line + 1}`);
        }
      }
    }

    // 返回体里的字面错误码（DB 字段 success:false 之类不会命中 code）
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'code' && ts.isStringLiteral(node.initializer)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      literalCodes.push(`${path.basename(file)}:${line + 1} → '${node.initializer.text}'`);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return { handwritten, literalCodes };
}

const results = files.map((f) => ({ file: f, ...scan(f) }));

describe('错误响应契约', () => {
  it('路由中不存在手写的失败响应（c.json + success:false）', () => {
    const offenders = results.flatMap((r) => r.handwritten);
    expect(offenders).toEqual([]);
  });

  it('错误码不写成字面量（必须走 ERROR_CODES 或作为键名传参）', () => {
    const offenders = results.flatMap((r) => r.literalCodes);
    expect(offenders).toEqual([]);
  });

  it('扫描结果非空（防止解析失败导致空断言通过）', () => {
    expect(files.length).toBeGreaterThan(20);
  });
});
