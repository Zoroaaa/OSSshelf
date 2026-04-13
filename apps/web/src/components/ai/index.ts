/**
 * AI 组件导出
 */

// 文件详情页AI功能组件
export { AISummaryCard } from './AISummaryCard';
export { ImageTagsDisplay } from './ImageTagsDisplay';
export { SmartRenameDialog } from './SmartRenameDialog';
export { AIChatWidget } from './AIChatWidget';

// 聊天页面可复用组件
export {
  ToolCallCard,
  ReasoningSection,
  AssistantContent,
  ToolInfoModal,
  ChatSidebar,
  ChatHeader,
  WelcomeScreen,
} from './chat';

// 设置页面可复用组件
export {
  ModelCard,
  TaskProgress,
  StatsCard,
  ModelFormModal,
  ProvidersSection,
  IndexProcessingTab,
  VectorsTable,
  AdvancedConfigPanel,
} from './settings';

// 类型导出
export type { Message, ToolCallEvent, SseChunk, AgentFile } from './types';
