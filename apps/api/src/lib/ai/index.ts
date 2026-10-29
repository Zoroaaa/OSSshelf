/**
 * index.ts
 * AI 模块统一导出
 */

export * from './types';
export { ModelGateway } from './modelGateway';
export { WorkersAiAdapter } from './adapters/workersAiAdapter';
export {
  OpenAiCompatibleAdapter,
  OpenAiCompatibleAdapter as OpenAICompatibleAdapter,
} from './adapters/openAiCompatibleAdapter';
export {
  canGenerateSummary,
  isImageFile,
  isAIConfigured,
  generateFileSummary,
  generateImageTags,
  suggestFileName,
  suggestFileNameFromContent,
  autoProcessFile,
  enqueueAutoProcessFile,
} from './features';
export type { SummaryResult, ImageTagResult, RenameSuggestion } from './features';
export { AgentToolExecutor, TOOL_DEFINITIONS } from './agentTools';
export type { AgentFile, ToolDefinition, ToolCall, ToolResultBase } from './agentTools';
