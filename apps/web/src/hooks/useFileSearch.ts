/**
 * useFileSearch.ts
 * 文件搜索逻辑 Hook
 *
 * 功能:
 * - 普通搜索
 * - 标签搜索
 * - 递归搜索
 * - 高级搜索
 * - 搜索建议
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '@/services/api';
import type { FileItem } from '@osshelf/shared';
import type { AdvancedSearchCondition, AdvancedSearchLogic } from '@/types/files';

interface UseFileSearchProps {
  folderId: string | null | undefined;
}

export function useFileSearch({ folderId }: UseFileSearchProps) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tagSearchQuery, setTagSearchQuery] = useState<string | null>(null);
  const [recursiveSearch, setRecursiveSearch] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedConditions, setAdvancedConditions] = useState<AdvancedSearchCondition[]>([]);
  const [advancedLogic, setAdvancedLogic] = useState<AdvancedSearchLogic>('and');
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: tagSearchResults } = useQuery<FileItem[]>({
    queryKey: ['tag-search', tagSearchQuery],
    queryFn: async () => {
      if (!tagSearchQuery) return [];
      const res = await searchApi.query({ tags: [tagSearchQuery] });
      return res.data.data?.items ?? [];
    },
    enabled: !!tagSearchQuery,
  });

  const { data: recursiveSearchResults } = useQuery<FileItem[]>({
    queryKey: ['recursive-search', folderId, searchQuery],
    queryFn: async () => {
      if (!searchQuery || !recursiveSearch) return [];
      const res = await searchApi.query({
        query: searchQuery,
        parentId: folderId || undefined,
        recursive: true,
      });
      return res.data.data?.items ?? [];
    },
    enabled: !!searchQuery && recursiveSearch,
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
      setSearchQuery(value);
      if (tagSearchQuery) setTagSearchQuery(null);

      if (value.length >= 2) {
        try {
          const res = await searchApi.suggestions({ q: value, type: 'name' });
          setSearchSuggestions(res.data.data ?? []);
          setShowSuggestions(true);
        } catch {
          setSearchSuggestions([]);
        }
      } else {
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
    recursiveSearch,
    setRecursiveSearch,
    showAdvancedSearch,
    setShowAdvancedSearch,
    advancedConditions,
    setAdvancedConditions,
    advancedLogic,
    setAdvancedLogic,
    searchSuggestions,
    showSuggestions,
    setShowSuggestions,
    tagSearchResults,
    recursiveSearchResults,
    advancedSearchResults,
    handleSearchInput,
    handleSuggestionClick,
    handleTagClick,
    clearTagSearch,
    clearSearch,
  };
}
