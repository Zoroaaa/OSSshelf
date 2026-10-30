/**
 * index.ts
 * AI 模块统一导出
 *
 * 仅保留外部实际引用的入口，其余能力请直接从具体模块导入，
 * 避免出现"导出但无人使用"的死代码。
 */

export { ModelGateway } from './modelGateway';
export { WorkersAiAdapter } from './adapters/workersAiAdapter';
