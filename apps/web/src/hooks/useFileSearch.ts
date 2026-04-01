/**
 * useFileSearch.ts
 * 文件搜索逻辑 Hook
 *
 * 功能:
 * - 关键词搜索（始终递归搜索子目录）
 * - 标签搜索
 * - 高级搜索
 * - 搜索建议
 * - 搜索防抖优化
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi, aiApi } from '@/services/api';
import type { FileItem } from '@osshelf/shared';
import type { AdvancedSearchCondition, AdvancedSearchLogic } from '@/types/files';

const SEARCH_DEBOUNCE_MS = 500;

interface UseFileSearchProps {
  folderId: string | null | undefined;
}

export function useFileSearch({ folderId }: UseFileSearchProps) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tagSearchQuery, setTagSearchQuery] = useState<string | null>(null);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedConditions, setAdvancedConditions] = useState<AdvancedSearchCondition[]>([]);
  const [advancedLogic, setAdvancedLogic] = useState<AdvancedSearchLogic>('and');
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    aiApi
      .getStatus()
      .then((res) => {
        setAiConfigured(res.data.data?.configured ?? false);
      })
      .catch(() => {
        setAiConfigured(false);
      });
  }, []);

  const { data: searchResults } = useQuery<FileItem[]>({
    queryKey: ['search', folderId, searchQuery, semanticSearch],
    queryFn: async () => {
      if (!searchQuery) return [];
      const res = await searchApi.query({
        query: searchQuery,
        parentId: folderId || undefined,
        semantic: semanticSearch,
        hybrid: semanticSearch,
      });
      return res.data.data?.items ?? [];
    },
    enabled: !!searchQuery,
  });

  const { data: tagSearchResults } = useQuery<FileItem[]>({
    queryKey: ['tag-search', tagSearchQuery],
    queryFn: async () => {
      if (!tagSearchQuery) return [];
      const res = await searchApi.query({ tags: [tagSearchQuery] });
      return res.data.data?.items ?? [];
    },
    enabled: !!tagSearchQuery,
  });

  const { data: advancedSearchResults } = useQuery<FileItem[]>({
    queryKey: ['advanced-search', advancedConditions, advancedLogic],
    queryFn: async () => {
      if (advancedConditions.length === 0) return [];
      const res = await searchApi.advanced({
        conditions: advancedConditions,
        logic: advancedLogic,
      });
      return res.data.data?.items ?? [];
    },
    enabled: advancedConditions.length > 0 && showAdvancedSearch,
  });

  const handleSearchInput = useCallback(
    async (value: string) => {
      setSearchInput(value);
      if (tagSearchQuery) setTagSearchQuery(null);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (value.length >= 2) {
        debounceTimerRef.current = setTimeout(() => {
          setSearchQuery(value);
        }, SEARCH_DEBOUNCE_MS);

        try {
          const res = await searchApi.suggestions({ q: value, type: 'name' });
          setSearchSuggestions(res.data.data ?? []);
          setShowSuggestions(true);
        } catch {
          setSearchSuggestions([]);
        }
      } else {
        setSearchQuery('');
        setSearchSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [tagSearchQuery]
  );

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setSearchInput(suggestion);
    setSearchQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  const handleTagClick = useCallback((tagName: string) => {
    setTagSearchQuery(tagName);
    setSearchQuery(tagName);
    setSearchInput(tagName);
  }, []);

  const clearTagSearch = useCallback(() => {
    setTagSearchQuery(null);
    setSearchQuery('');
    setSearchInput('');
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setTagSearchQuery(null);
    setShowSuggestions(false);
  }, []);

  return {
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    tagSearchQuery,
    setTagSearchQuery,
    showAdvancedSearch,
    setShowAdvancedSearch,
    advancedConditions,
    setAdvancedConditions,
    advancedLogic,
    setAdvancedLogic,
    searchSuggestions,
    showSuggestions,
    setShowSuggestions,
    searchResults,
    tagSearchResults,
    advancedSearchResults,
    handleSearchInput,
    handleSuggestionClick,
    handleTagClick,
    clearTagSearch,
    clearSearch,
    semanticSearch,
    setSemanticSearch,
    aiConfigured,
  };
}
