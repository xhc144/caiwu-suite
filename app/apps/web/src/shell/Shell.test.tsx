import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import {
  queryClient,
  sessionStore,
  useRequiredSession,
  useSession,
  unsavedPages,
  type SessionState,
} from '@caiwu/web-kit';
import { Shell } from './Shell';
import type * as WebKit from '@caiwu/web-kit';

const pending = new Map<string, (value: string) => void>();
const logout = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../modules', () => ({ visibleModules: () => [] }));
vi.mock('./Tools', () => ({
  SearchDialog: () => null,
  ShortcutDialog: () => null,
  SessionMonitor: () => null,
}));
vi.mock('./GlobalHotkeys', () => ({ GlobalHotkeys: () => null }));
vi.mock('./TabsHost', () => ({ TabsHost: FinancialPage }));
vi.mock('@caiwu/web-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof WebKit>();
  return {
    ...actual,
    useBootstrap: () => ({ devMode: true }),
    coreApi: {
      auth: {
        me: {
          queryOptions: () => ({
            queryKey: ['me'],
            queryFn: async () => {
              const current = actual.sessionStore.get()!;
              return { book: current.book, user: current.user, currentPeriod: null };
            },
          }),
        },
        logout: { mutationOptions: () => ({ mutationFn: logout }) },
      },
    },
  };
});
function FinancialPage() {
  const session = useRequiredSession();
  const result = useQuery({
    queryKey: ['unscoped-financial-id', 1],
    queryFn: () => new Promise<string>((resolve) => pending.set(session.token, resolve)),
    retry: false,
  });
  return <div>{result.data ?? '等待当前身份数据'}</div>;
}
function Harness() {
  return useSession() ? <Shell devMode /> : <div>登录页</div>;
}
const initial: SessionState = {
  token: 'old-token',
  bookId: 'book-a',
  user: { id: 1, code: 'admin', name: '管理员', isAdmin: true, permissions: [] },
  book: {
    id: 'book-a',
    name: '第一账套',
    orgName: '单位',
    templateId: 'demo',
    templateName: '制度',
    regime: 'enterprise',
    product: 'chengben',
    startPeriod: 202601,
    codeScheme: [4, 2, 2],
    baseCurrency: 'CNY',
    createdAt: '',
  },
};
afterEach(() => {
  cleanup();
  sessionStore.set(null);
  queryClient.clear();
  pending.clear();
  unsavedPages.pages.clear();
  logout.mockClear();
});
describe('会话与财务缓存隔离', () => {
  it('改密最后阶段及异步跳登录期间阻止重入，完成后不再用旧令牌logout', async () => {
    sessionStore.set(initial);
    let finishLogin!: () => void;
    const saved = vi.fn();
    const registration = unsavedPages.register({
      bookId: initial.bookId,
      tabKey: '密码',
      title: '自改密码',
      dirty: true,
      savePhase: 'session',
      save: async (context) =>
        context!.commit(async () => {
          saved();
          registration.update({
            bookId: initial.bookId,
            tabKey: '密码',
            title: '自改密码',
            dirty: false,
            save: async () => true,
          });
          context!.afterLeave(
            () =>
              new Promise<void>((resolve) => {
                finishLogin = () => {
                  sessionStore.set(null);
                  resolve();
                };
              }),
          );
          return { sessionRevoked: true };
        }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('等待当前身份数据');
    fireEvent.keyDown(window, { altKey: true, key: 'x' });
    fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(screen.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
    fireEvent.keyDown(window, { altKey: true, key: 'x' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    await act(async () => {
      finishLogin();
    });
    expect(screen.getByText('登录页')).toBeVisible();
    expect(logout).not.toHaveBeenCalled();
    expect(unsavedPages.isSessionCommitPending(initial.bookId)).toBe(false);
  });
  it('账套/令牌变化撤销旧查询，跨账套同ID晚返回不污染新身份', async () => {
    sessionStore.set(initial);
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Harness />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await waitFor(() => expect(pending.has('old-token')).toBe(true));
    await act(async () =>
      sessionStore.set({
        ...initial,
        token: 'new-token',
        bookId: 'book-b',
        book: { ...initial.book, id: 'book-b', name: '第二账套' },
      }),
    );
    await waitFor(() => expect(pending.has('new-token')).toBe(true));
    await act(async () => pending.get('new-token')!('第二账套数据'));
    expect(await screen.findByText('第二账套数据')).toBeVisible();
    await act(async () => pending.get('old-token')!('旧账套敏感数据'));
    expect(screen.queryByText('旧账套敏感数据')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['unscoped-financial-id', 1])).toBe('第二账套数据');
    await act(async () => sessionStore.set(null));
    expect(screen.getByText('登录页')).toBeVisible();
    expect(queryClient.getQueryData(['unscoped-financial-id', 1])).toBeUndefined();
  });
  it('同令牌用户/权限变化也清除缓存与旧页', async () => {
    sessionStore.set(initial);
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Harness />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await waitFor(() => expect(pending.has('old-token')).toBe(true));
    await act(async () => pending.get('old-token')!('管理员旧数据'));
    expect(await screen.findByText('管理员旧数据')).toBeVisible();
    await act(async () =>
      sessionStore.set({
        ...initial,
        user: { ...initial.user, id: 2, isAdmin: false, permissions: ['workbench.settings'] },
      }),
    );
    expect(screen.queryByText('管理员旧数据')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['unscoped-financial-id', 1])).toBeUndefined();
  });
});
