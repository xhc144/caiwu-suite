import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import HomePage from './HomePage';

const state = vi.hoisted(() => ({
  active: true,
  permission: true,
  reads: 0,
  period: undefined as number | undefined,
  pending: 1,
  audited: 0,
  fail: false,
}));
vi.mock('@caiwu/web-kit', () => ({
  usePermission: () => state.permission,
  useTab: () => ({ active: state.active }),
  getBusinessError: () => null,
}));
vi.mock('./FeatureMap', () => ({ FeatureMap: () => null }));
vi.mock('./guidance', () => ({ useGuidance: () => ({ dismissed: true }) }));
vi.mock('./context', () => ({
  useWorkbenchContext: () => ({
    session: {
      user: { name: '会计' },
      book: {
        name: '测试账套',
        orgName: '测试单位',
        product: 'qingsong',
        codeScheme: [4, 2, 2],
        startPeriod: 202601,
      },
    },
    scope: 'book:user',
    entries: [],
    manifests: { isError: false, isPending: false },
  }),
}));
vi.mock('./api', () => ({
  api: {
    overview: {
      queryOptions: ({ period }: { period?: number }) => ({
        queryKey: ['overview', period],
        queryFn: async () => {
          state.reads++;
          if (state.fail) throw new Error('SQLITE_ERROR: voucher table missing');
          state.period = period;
          return {
            current: { period: 202601 },
            selected: { period: period ?? 202601, status: 'open' },
            periods: [{ period: 202601 }, { period: 202602 }],
            counts: { pending: state.pending, audited: state.audited },
            scope: '本期间凭证',
          };
        },
      }),
    },
    preferences: {
      queryOptions: () => ({
        queryKey: ['preferences'],
        queryFn: async () => ({ favorites: [], guided: true }),
      }),
    },
    savePreferences: { mutationOptions: () => ({ mutationFn: async () => undefined }) },
  },
}));
afterEach(cleanup);
beforeEach(() =>
  Object.assign(state, {
    active: true,
    permission: true,
    reads: 0,
    period: undefined,
    pending: 1,
    audited: 0,
    fail: false,
  }),
);
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home?period=202602']}>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}
describe('w_main1 已打开标签的待办统计', () => {
  it('即使缓存仍新鲜，离开后审核并重新激活也真实读取待过账数，并保留选中期间', async () => {
    const { container, update } = setup();
    await screen.findByRole('button', { name: '处理待审核凭证' });
    const values = () =>
      [...container.querySelectorAll('.ant-statistic-content-value')].map((el) => el.textContent);
    expect(values()).toEqual(['1', '0']);
    expect(state.period).toBe(202602);
    const before = state.reads;
    state.active = false;
    update();
    expect(state.reads).toBe(before);
    state.pending = 0;
    state.audited = 1;
    state.active = true;
    update();
    await waitFor(() => expect(values()).toEqual(['0', '1']));
    expect(state.reads).toBeGreaterThan(before);
    expect(state.period).toBe(202602);
  });
  it('读取失败给出中文操作提示，不显示数据库或协议错误', async () => {
    state.fail = true;
    setup();
    expect(await screen.findByText('无法连接本地服务，请检查服务后重试')).toBeVisible();
    expect(screen.queryByText(/SQLITE_ERROR|voucher table/)).not.toBeInTheDocument();
  });
  it('没有统计权限时不请求，也不伪造待办为零', async () => {
    state.permission = false;
    const { container } = setup();
    expect(screen.getByText('没有工作台统计权限')).toBeVisible();
    expect(container.querySelector('.ant-statistic')).toBeNull();
    expect(state.reads).toBe(0);
  });
});
