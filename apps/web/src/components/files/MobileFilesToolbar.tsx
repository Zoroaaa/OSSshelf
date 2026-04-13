/**
 * MobileFilesToolbar.tsx
 * 移动端文件页面底部操作栏
 *
 * 功能:
 * - 视图切换（list/grid）+ 排序（名称/大小）
 * - 浮动操作按钮（新建/上传）
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Grid,
  List,
  SortAsc,
  SortDesc,
  Plus,
  Upload,
  FolderPlus,
  FilePlus,
  X,
  Search,
  SlidersHorizontal,
  Tag,
  Sparkles,
  FolderInput,
} from 'lucide-react';
import { cn } from '@/utils';
import type { ViewMode, SortField } from '@/stores/files';
import type { AdvancedSearchCondition, AdvancedSearchLogic } from '@/types/files';

interface MobileFilesToolbarProps {
  viewMode: ViewMode;
  hasImages: boolean;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  onViewModeChange: (mode: ViewMode) => void;
  onSort: (field: SortField) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onUploadFolder?: () => void;
}

const viewModes: { mode: ViewMode; icon: typeof List; label: string }[] = [
  { mode: 'list', icon: List, label: '列表' },
  { mode: 'grid', icon: Grid, label: '网格' },
];

export function MobileFilesToolbar({
  viewMode,
  hasImages,
  sortBy,
  sortOrder,
  onViewModeChange,
  onSort,
  onNewFile,
  onNewFolder,
  onUpload,
  onUploadFolder,
}: MobileFilesToolbarProps) {
  const [showFabMenu, setShowFabMenu] = useState(false);

  return (
    <>
      <div className="mobile-action-bar lg:hidden">
        {/* 左侧：视图切换 + 排序 */}
        <div className="flex items-center gap-0.5">
          {viewModes.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              className={cn(
                'p-2 rounded-lg transition-colors touch-target-sm',
                viewMode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground'
              )}
              onClick={() => onViewModeChange(mode)}
              title={label}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            className={cn(
              'flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs transition-colors touch-target-sm',
              sortBy === 'name' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
            )}
            onClick={() => onSort('name')}
            title="按名称排序"
          >
            名称
            {sortBy === 'name' &&
              (sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
          </button>
          <button
            className={cn(
              'flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs transition-colors touch-target-sm',
              sortBy === 'size' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
            )}
            onClick={() => onSort('size')}
            title="按大小排序"
          >
            大小
            {sortBy === 'size' &&
              (sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
          </button>
        </div>

        {/* 中间：FAB 按钮 */}
        <button
          className="flex items-center justify-center w-12 h-10 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          onClick={() => setShowFabMenu(!showFabMenu)}
          title="新建/上传"
        >
          {showFabMenu ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>

        {/* 右侧占位，保持 FAB 居中 */}
        <div className="w-[120px]" />
      </div>

      {showFabMenu && (
        <>
          <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setShowFabMenu(false)} />
          <div
            className="fixed bottom-36 left-1/2 z-30 flex flex-col gap-2 lg:hidden"
            style={{ transform: 'translateX(-50%)' }}
          >
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-full shadow-lg border text-sm active:scale-95 transition-transform animate-fade-in"
              style={{ animationDelay: '0ms' }}
              onClick={() => {
                setShowFabMenu(false);
                onNewFile();
              }}
            >
              <FilePlus className="h-4 w-4" />
              新建文件
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-full shadow-lg border text-sm active:scale-95 transition-transform animate-fade-in"
              style={{ animationDelay: '50ms' }}
              onClick={() => {
                setShowFabMenu(false);
                onNewFolder();
              }}
            >
              <FolderPlus className="h-4 w-4" />
              新建文件夹
            </button>
            {onUploadFolder && (
              <button
                className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-full shadow-lg border text-sm active:scale-95 transition-transform animate-fade-in"
                style={{ animationDelay: '100ms' }}
                onClick={() => {
                  setShowFabMenu(false);
                  onUploadFolder();
                }}
              >
                <FolderInput className="h-4 w-4" />
                上传文件夹
              </button>
            )}
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-full shadow-lg text-sm active:scale-95 transition-transform animate-fade-in"
              style={{ animationDelay: '150ms' }}
              onClick={() => {
                setShowFabMenu(false);
                onUpload();
              }}
            >
              <Upload className="h-4 w-4" />
              上传文件
            </button>
          </div>
        </>
      )}
    </>
  );
}

interface MobileSearchPanelProps {
  searchInput: string;
  tagSearchQuery: string | null;
  showAdvancedSearch: boolean;
  advancedLogic: AdvancedSearchLogic;
  advancedConditions: AdvancedSearchCondition[];
  searchSuggestions: string[];
  showSuggestions: boolean;
  showSearchHistory: boolean;
  searchHistoryData: Array<{ id: string; query: string }>;
  aiConfigured: boolean;
  semanticSearch: boolean;
  ftsSearch: boolean;
  onSearchInputChange: (value: string) => void;
  onClearSearch: () => void;
  onToggleAdvancedSearch: () => void;
  onSuggestionClick: (suggestion: string) => void;
  onAdvancedLogicChange: (logic: AdvancedSearchLogic) => void;
  onAddCondition: () => void;
  onRemoveCondition: (idx: number) => void;
  onUpdateCondition: (idx: number, key: 'field' | 'operator' | 'value', value: string) => void;
  onClearConditions: () => void;
  onToggleSemanticSearch: () => void;
  onToggleFtsSearch: () => void;
  onClearTagSearch: () => void;
  onClearHistory: () => void;
  onDeleteHistoryItem: (id: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function MobileSearchPanel({
  searchInput,
  tagSearchQuery,
  showAdvancedSearch,
  advancedLogic,
  advancedConditions,
  searchSuggestions,
  showSuggestions,
  showSearchHistory,
  searchHistoryData,
  aiConfigured,
  semanticSearch,
  ftsSearch,
  onSearchInputChange,
  onClearSearch,
  onToggleAdvancedSearch,
  onSuggestionClick,
  onAdvancedLogicChange,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onClearConditions,
  onToggleSemanticSearch,
  onToggleFtsSearch,
  onClearTagSearch,
  onClearHistory,
  onDeleteHistoryItem,
  onFocus,
  onBlur,
}: MobileSearchPanelProps) {
  return (
    <div className="space-y-2 md:hidden">
      {/* 搜索输入行：输入框 + 搜索模式按钮 + 高级搜索 */}
      <div className="relative flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            className="pl-9 pr-8 h-10 w-full rounded-xl border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder={tagSearchQuery ? `标签: ${tagSearchQuery}` : '搜索文件...'}
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            onBlur={onBlur}
            onFocus={onFocus}
          />
          {(searchInput || tagSearchQuery) && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              onClick={onClearSearch}
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {showSuggestions && searchSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-xl shadow-lg z-50 max-h-48 overflow-auto">
              {searchSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-muted/50 transition-colors"
                  onMouseDown={() => onSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {showSearchHistory &&
            !showSuggestions &&
            searchInput.length === 0 &&
            (searchHistoryData?.length ?? 0) > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-xl shadow-lg z-50 max-h-56 overflow-auto">
                <div className="flex items-center justify-between px-4 py-2 border-b">
                  <span className="text-xs text-muted-foreground">搜索历史</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onMouseDown={onClearHistory}
                  >
                    清空
                  </button>
                </div>
                {searchHistoryData?.map((item) => (
                  <div key={item.id} className="flex items-center group hover:bg-muted/50 transition-colors">
                    <button
                      className="flex-1 px-4 py-3 text-left text-sm"
                      onMouseDown={() => onSuggestionClick(item.query)}
                    >
                      {item.query}
                    </button>
                    <button
                      className="px-3 py-3 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all touch-visible"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onDeleteHistoryItem(item.id);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* 搜索模式图标按钮（与输入框同行） */}
        {aiConfigured && (
          <button
            className={cn(
              'flex-shrink-0 p-2 rounded-lg transition-colors',
              semanticSearch ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={onToggleSemanticSearch}
            title={semanticSearch ? '关闭语义搜索' : '开启语义搜索'}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}
        <button
          className={cn(
            'flex-shrink-0 p-2 rounded-lg transition-colors',
            ftsSearch ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={onToggleFtsSearch}
          title={ftsSearch ? '关闭FTS5全文搜索' : '开启FTS5全文搜索'}
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          className={cn(
            'flex-shrink-0 p-2 rounded-lg transition-colors',
            showAdvancedSearch ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={onToggleAdvancedSearch}
          title="高级搜索"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      {tagSearchQuery && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-xl text-sm">
          <Tag className="h-4 w-4 text-primary" />
          <span className="text-primary font-medium flex-1">{tagSearchQuery}</span>
          <button onClick={onClearTagSearch} className="hover:bg-primary/20 rounded p-1">
            <X className="h-4 w-4 text-primary" />
          </button>
        </div>
      )}

      {showAdvancedSearch && (
        <div className="p-3 bg-muted/30 border rounded-xl space-y-2">
          <div className="flex items-center gap-2">
            <select
              className="h-8 px-2 text-xs border rounded-lg bg-background flex-1"
              value={advancedLogic}
              onChange={(e) => onAdvancedLogicChange(e.target.value as AdvancedSearchLogic)}
            >
              <option value="and">且</option>
              <option value="or">或</option>
            </select>
            <button
              className="h-8 px-3 text-xs border rounded-lg bg-background hover:bg-muted/50"
              onClick={onAddCondition}
            >
              + 添加
            </button>
            {advancedConditions.length > 0 && (
              <button
                className="h-8 px-3 text-xs border rounded-lg bg-background hover:bg-muted/50"
                onClick={onClearConditions}
              >
                清除
              </button>
            )}
          </div>

          {advancedConditions.map((condition, idx) => (
            <div key={idx} className="flex items-center gap-1.5 p-2 bg-background rounded-lg text-xs">
              <select
                className="h-7 px-1.5 border rounded bg-background flex-1"
                value={condition.field}
                onChange={(e) => onUpdateCondition(idx, 'field', e.target.value)}
              >
                <option value="name">文件名</option>
                <option value="mimeType">类型</option>
                <option value="size">大小</option>
                <option value="createdAt">创建时间</option>
                <option value="updatedAt">修改时间</option>
                <option value="tags">标签</option>
              </select>
              <select
                className="h-7 px-1.5 border rounded bg-background flex-1"
                value={condition.operator}
                onChange={(e) => onUpdateCondition(idx, 'operator', e.target.value)}
              >
                <option value="contains">包含</option>
                <option value="equals">等于</option>
                <option value="startsWith">开头是</option>
                <option value="endsWith">结尾是</option>
                {condition.field === 'size' && (
                  <>
                    <option value="gt">大于</option>
                    <option value="lt">小于</option>
                  </>
                )}
              </select>
              <input
                className="h-7 flex-1 px-1.5 border rounded bg-background"
                value={String(condition.value)}
                onChange={(e) => onUpdateCondition(idx, 'value', e.target.value)}
                placeholder="值"
              />
              <button
                className="h-7 w-7 flex items-center justify-center hover:bg-muted rounded"
                onClick={() => onRemoveCondition(idx)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
