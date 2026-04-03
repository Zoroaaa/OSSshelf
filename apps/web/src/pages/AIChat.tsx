/**
 * AIChat.tsx
 * AI 智能对话页面 - 升级版
 *
 * 功能:
 * - 流式输出 (SSE)
 * - 会话历史管理
 * - Markdown 渲染
 * - 文件来源引用
 * - 现代化 UI (参考 LobeChat)
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  MessageSquare,
  Send,
  Loader2,
  FileText,
  Image,
  File,
  Sparkles,
  Plus,
  Trash2,
  ExternalLink,
  ChevronLeft,
  Settings,
  StopCircle,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi, type AiChatMessage } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    id: string;
    name: string;
    mimeType: string | null;
    score: number;
  }>;
  timestamp: Date;
  isLoading?: boolean;
}

export function AIChat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(urlSessionId || null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-chat-sessions'],
    queryFn: () => aiApi.chatSession.getSessions().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) {
      loadSession(urlSessionId);
    }
  }, [urlSessionId]);

  const loadSession = async (sessionId: string) => {
    try {
      setIsLoading(true);
      const response = await aiApi.chatSession.getSession(sessionId);
      if (response.data.success && response.data.data) {
        const sessionData = response.data.data;
        setCurrentSessionId(sessionId);
        setMessages(
          sessionData.messages.map((msg: AiChatMessage) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            sources: msg.sources,
            timestamp: new Date(msg.createdAt),
          }))
        );
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, assistantMessage]);

    abortControllerRef.current = new AbortController();

    try {
      let fullContent = '';
      const sources: Message['sources'] = [];

      await aiApi.chatSession.chatStream(input.trim(), {
        sessionId: currentSessionId || undefined,
        maxFiles: 5,
        includeFileContent: false,
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: fullContent } : m)));
          }
          if (chunk.done && chunk.sessionId) {
            setCurrentSessionId(chunk.sessionId);
            if (!urlSessionId) {
              navigate(`/ai-chat/${chunk.sessionId}`, { replace: true });
            }
            queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
          }
        },
        signal: abortControllerRef.current.signal,
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMessageId ? { ...m, content: fullContent, isLoading: false, sources } : m))
      );
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: '抱歉，我遇到了一些问题，无法回答您的问题。请稍后再试。',
                  isLoading: false,
                }
              : m
          )
        );
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    navigate('/ai-chat');
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(`/ai-chat/${sessionId}`);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await aiApi.chatSession.deleteSession(sessionId);
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      if (currentSessionId === sessionId) {
        handleNewChat();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileClick = (fileId: string) => {
    window.open(`/files?highlight=${fileId}`, '_blank');
  };

  const getFileIcon = (mimeType: string | null) => {
    if (!mimeType) return <File className="h-4 w-4" />;
    if (mimeType.startsWith('image/')) return <Image className="h-4 w-4" />;
    if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
      return <FileText className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  const suggestedQuestions = [
    '帮我找一下最近上传的文档',
    '有哪些关于项目的文件？',
    "搜索包含'设计'的图片",
    '帮我整理一下技术文档',
    '分析一下我的文件存储情况',
  ];

  return (
    <div className="h-[calc(100vh-4rem)] lg:h-[calc(100vh)] flex bg-gradient-to-br from-slate-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950 relative">
      {/* 侧边栏 - 会话列表（桌面端默认显示，移动端抽屉式） */}
      {showSidebar && (
        <>
          {/* 移动端遮罩 */}
          <div
            className="lg:hidden fixed inset-0 z-20 bg-black/50"
            onClick={() => setShowSidebar(false)}
          />
          <div className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col lg:relative lg:z-auto fixed inset-y-0 left-0 z-30 lg:static shadow-xl lg:shadow-none">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <Button onClick={handleNewChat} className="w-full gap-2" variant="outline">
              <Plus className="h-4 w-4" />
              新建对话
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无对话记录</p>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full text-left p-3 rounded-lg mb-1 transition-colors group ${
                    session.id === currentSessionId
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent text-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate flex-1">{session.title}</span>
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <p
                    className={`text-xs mt-1 ${session.id === currentSessionId ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                  >
                    {formatDate(session.updatedAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        </>
      )}

      {/* 主聊天区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-3 sm:px-6 py-3 sm:py-4 flex-shrink-0">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Button variant="ghost" size="sm" onClick={() => setShowSidebar(!showSidebar)} className="mr-1 flex-shrink-0">
                <ChevronLeft className={`h-4 w-4 transition-transform ${!showSidebar ? 'rotate-180' : ''}`} />
              </Button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex-shrink-0">
                  <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                </div>
                <div className="min-w-0 hidden sm:block">
                  <h1 className="text-base sm:text-lg font-semibold">AI 智能助手</h1>
                  <p className="text-xs text-muted-foreground">基于您的文件进行智能问答</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {isLoading && (
                <Button variant="outline" size="sm" onClick={handleStop} className="hidden sm:flex">
                  <StopCircle className="h-4 w-4 mr-2" />
                  停止生成
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => navigate('/ai-settings')} className="h-8 w-8 sm:h-9 sm:w-9">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                <div className="p-4 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl mb-6">
                  <MessageSquare className="h-12 w-12 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">开始与 AI 对话</h2>
                <p className="text-muted-foreground mb-8 max-w-md">
                  基于您的文件进行智能问答，AI 会自动检索相关文件并生成答案
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                  {suggestedQuestions.map((question, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(question)}
                      className="p-4 text-left border rounded-lg hover:bg-accent transition-colors text-sm group"
                    >
                      <Sparkles className="h-4 w-4 mb-2 text-purple-500 group-hover:scale-110 transition-transform" />
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-2xl rounded-br-md'
                      : 'bg-white dark:bg-slate-800 border rounded-2xl rounded-bl-md shadow-sm'
                  } px-5 py-4`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {message.role === 'assistant' && (
                        <div className="p-1 bg-gradient-to-br from-purple-500 to-pink-500 rounded">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                      )}
                      <span
                        className={`text-xs font-medium ${message.role === 'user' ? 'text-white/80' : 'text-muted-foreground'}`}
                      >
                        {message.role === 'user' ? '你' : 'AI 助手'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {message.role === 'assistant' && message.content && !message.isLoading && (
                        <button
                          onClick={() => handleCopyMessage(message.id, message.content)}
                          className="p-1 hover:bg-accent rounded transition-colors"
                          title="复制内容"
                        >
                          {copiedMessageId === message.id ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className={`prose prose-sm max-w-none ${message.role === 'user' ? 'prose-invert' : ''} dark:prose-invert`}
                  >
                    {message.role === 'assistant' && message.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                    )}

                    {message.isLoading && (
                      <div className="flex items-center gap-2 mt-2">
                        <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                        <span className="text-sm text-muted-foreground">正在思考...</span>
                      </div>
                    )}
                  </div>

                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        参考文件：
                      </p>
                      <div className="space-y-1">
                        {message.sources.map((source, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleFileClick(source.id)}
                            className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
                          >
                            <div className="text-muted-foreground">{getFileIcon(source.mimeType)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{source.name}</p>
                              <p className="text-xs text-muted-foreground">
                                相关度: {(source.score * 100).toFixed(0)}%
                              </p>
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div
                    className={`text-xs mt-2 ${message.role === 'user' ? 'text-white/70' : 'text-muted-foreground'}`}
                  >
                    {formatDate(message.timestamp.toISOString())}
                  </div>
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入框区域 */}
        <div className="border-t bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-6 py-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="输入您的问题，AI 会基于您的文件进行回答..."
                  className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  rows={1}
                  style={{
                    minHeight: '48px',
                    maxHeight: '120px',
                  }}
                  disabled={isLoading}
                />
              </div>
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl px-6"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              AI 会自动检索您的文件并生成答案 · 按 Enter 发送，Shift+Enter 换行 · 支持流式输出
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
