import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { SearchResult } from '../shared';
import SearchPage from './SearchPage';
const requests = vi.hoisted(
  () =>
    new Map<
      string,
      (value: { results: SearchResult[]; denied: string[]; period: number }) => void
    >(),
);
vi.mock('@caiwu/web-kit', () => ({ usePermission: () => true }));
vi.mock('./context', () => ({
  useWorkbenchContext: () => ({
    entries: [],
    scope: 'book-a:user-a',
    manifests: { isError: false },
  }),
}));
vi.mock('./api', () => ({
  api: {
    search: {
      queryOptions: ({ term }: { term: string }) => ({
        queryKey: ['search', term],
        queryFn: () => new Promise((resolve) => requests.set(term, resolve)),
      }),
    },
  },
}));
afterEach(() => {
  cleanup();
  requests.clear();
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('combobox', { name: '全局搜索关键词' });
}
const result = (title: string): SearchResult => ({
  key: title,
  category: '科目',
  title,
  detail: '匹配信息',
  to: '/m/ledgers/detail?account=1001&from=202601&to=202601&dims=',
});
describe('搜索请求竞争', () => {
  it('防抖且旧词晚返回不覆盖新词，输入上限64，卸载后不回填', async () => {
    const input = setup();
    expect(input).toHaveAttribute('maxlength', '64');
    fireEvent.change(input, { target: { value: '旧词' } });
    expect(requests.has('旧词')).toBe(false);
    await waitFor(() => expect(requests.has('旧词')).toBe(true));
    fireEvent.change(input, { target: { value: '新词' } });
    await waitFor(() => expect(requests.has('新词')).toBe(true));
    await act(async () => {
      requests.get('新词')!({ results: [result('新结果')], denied: [], period: 202601 });
    });
    expect(await screen.findByText('新结果')).toBeVisible();
    await act(async () => {
      requests.get('旧词')!({ results: [result('旧结果')], denied: [], period: 202601 });
    });
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument();
    expect(screen.getByText('新结果')).toBeVisible();
    fireEvent.change(input, { target: { value: '未返回' } });
    await waitFor(() => expect(requests.has('未返回')).toBe(true));
    cleanup();
    await act(async () => {
      requests.get('未返回')!({ results: [result('卸载结果')], denied: [], period: 202601 });
    });
    expect(screen.queryByText('卸载结果')).not.toBeInTheDocument();
  });
  it('新输入等待期间不显示旧财务结果', async () => {
    const input = setup();
    fireEvent.change(input, { target: { value: '第一词' } });
    await waitFor(() => expect(requests.has('第一词')).toBe(true));
    await act(async () => {
      requests.get('第一词')!({ results: [result('敏感旧结果')], denied: [], period: 202601 });
    });
    expect(await screen.findByText('敏感旧结果')).toBeVisible();
    fireEvent.change(input, { target: { value: '第二词' } });
    expect(screen.queryByText('敏感旧结果')).not.toBeInTheDocument();
  });
});
