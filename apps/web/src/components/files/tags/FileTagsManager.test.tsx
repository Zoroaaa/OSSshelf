/**
 * FileTagsManager.test.tsx
 * 标签选择器不能按固定条数截断。
 * 未被任何文件引用的新标签常常排在标签列表末尾，一旦截断就“看不见 = 选不到”，
 * 这里用 12 个标签验证选择器把可选项全部渲染出来。
 */

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTagsManager } from './FileTagsManager';

const mocks = vi.hoisted(() => ({ getUserTags: vi.fn(), getFileTags: vi.fn() }));

vi.mock('@/services/api', () => ({
  permissionsApi: {
    getUserTags: mocks.getUserTags,
    getFileTags: mocks.getFileTags,
    addTag: vi.fn(),
    removeTag: vi.fn(),
    createTag: vi.fn(),
  },
}));

vi.mock('@/components/ui/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const makeTag = (index: number) => ({
  id: `t${index}`,
  fileId: null, // 标签定义行：还没挂到任何文件
  userId: 'u1',
  name: `标签${index}`,
  color: '#6366f1',
  createdAt: '2026-01-01T00:00:00.000Z',
});

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FileTagsManager fileId="f1" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.getUserTags.mockReset();
  mocks.getFileTags.mockReset();
  mocks.getUserTags.mockResolvedValue({ data: { data: Array.from({ length: 12 }, (_, i) => makeTag(i + 1)) } });
  mocks.getFileTags.mockResolvedValue({ data: { data: [] } });
});

describe('FileTagsManager 标签选择器', () => {
  it('标签数超过 10 个时，末尾未被引用的标签也能选到', async () => {
    renderManager();

    await waitFor(() => expect(screen.getByText('标签1')).toBeTruthy());
    expect(screen.getByText('标签10')).toBeTruthy();
    // 旧实现 slice(0, 10)，这两个会被静默截掉
    expect(screen.getByText('标签11')).toBeTruthy();
    expect(screen.getByText('标签12')).toBeTruthy();
  });
});
