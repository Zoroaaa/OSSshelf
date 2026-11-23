// 仅供 schemaDrift.test.ts 使用的最小类型声明：当前 @types/node 尚未收录 node:sqlite（Node ≥22.13 内置）。
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number | bigint };
    };
  }
}
