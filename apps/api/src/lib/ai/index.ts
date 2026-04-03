/**
 * index.ts
 * AI 模块统一导出
 */

export * from './types';
export { ModelGateway } from './modelGateway';
export { RagEngine } from './ragEngine';
export { WorkersAiAdapter } from './adapters/workersAiAdapter';
export { OpenAiCompatibleAdapter, OpenAiCompatibleAdapter as OpenAICompatibleAdapter } from './adapters/openAiCompatibleAdapter';
export {
  canGenerateSummary,
  isImageFile,
  isAIConfigured,
  generateFileSummary,
  generateImageTags,
  suggestFileName,
  suggestFileNameFromContent,
  autoProcessFile,
} from './features';
export type { SummaryResult, ImageTagResult, RenameSuggestion } from './features';
