/**
 * shared 类型与数据库 schema 的编译期对齐守卫（方案 2.5）。
 * 前端/后端共用 @osshelf/shared 的 FilePermission、DownloadTask；
 * 这里要求它们的字段集合与 schema.ts 的 $inferSelect 完全一致——
 * 任何一边加/删字段而另一边没跟上，`pnpm typecheck` 立即报错。
 * 运行期只做一次空断言，真正的检查发生在类型层。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { FilePermission, DownloadTask } from '@osshelf/shared';
import type { filePermissions, downloadTasks } from './schema';

describe('shared 类型 ↔ schema 字段集合一致', () => {
  it('FilePermission', () => {
    expectTypeOf<keyof FilePermission>().toEqualTypeOf<keyof typeof filePermissions.$inferSelect>();
  });

  it('DownloadTask', () => {
    expectTypeOf<keyof DownloadTask>().toEqualTypeOf<keyof typeof downloadTasks.$inferSelect>();
  });
});
