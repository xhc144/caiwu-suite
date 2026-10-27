import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { ConfigProvider, Modal } from 'antd';
import { unsavedPages, type UnsavedPage } from '@caiwu/web-kit';
import SettingsPage from './SettingsPage';

const state = vi.hoisted(() => ({
  calls: 0,
  session: {
    token: 'token',
    bookId: 'book',
    user: { name: '管理员' },
    book: { product: 'chengben', templateName: '测试制度' },
  },
}));
vi.mock('@caiwu/web-kit', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePermission: () => true,
  useRequiredSession: () => state.session,
  sessionStore: { get: () => state.session, set: vi.fn() },
  coreApi: { auth: { me: { queryOptions: () => ({ queryKey: ['me'] }) } } },
  queryClient: {
    cancelQueries: async () => undefined,
    clear: vi.fn(),
    fetchQuery: async () => ({
      user: state.session.user,
      book: { ...state.session.book, product: 'qingsong' },
    }),
  },
}));
vi.mock('./api', () => ({
  api: {
    switchProduct: {
      mutationOptions: () => ({
        mutationFn: async () => {
          state.calls++;
        },
      }),
    },
  },
}));
beforeEach(() => {
  state.calls = 0;
  unsavedPages.pages.clear();
});
afterEach(async () => {
  await act(async () => {
    Modal.destroyAll();
  });
  unsavedPages.pages.clear();
  cleanup();
});
function Location() {
  return <output aria-label="当前地址">{useLocation().pathname}</output>;
}
function setup() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <MemoryRouter initialEntries={['/m/workbench/settings']}>
          <SettingsPage />
          <Location />
        </MemoryRouter>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}
async function changeProduct() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '产品形态' }));
  await click(await screen.findByTitle('轻松会计'));
  await click(screen.getByRole('button', { name: '切换产品形态' }));
  await click(await screen.findByRole('button', { name: '已保存内容，确认切换' }));
}
function dirty(save: UnsavedPage['save'], discard?: UnsavedPage['discard']) {
  return unsavedPages.register({
    bookId: 'book',
    tabKey: '/voucher',
    title: '未保存凭证',
    dirty: true,
    version: 1,
    save,
    discard,
  });
}
describe('w_main1 产品切换的共享未保存保护', () => {
  it('仅列出真实未保存页面，取消后不提交产品切换', async () => {
    dirty(async () => false);
    unsavedPages.register({
      bookId: 'book',
      tabKey: '/clean',
      title: '已保存页面',
      dirty: false,
      save: async () => true,
    });
    setup();
    await changeProduct();
    const prompt = await screen.findByRole('dialog', { name: '有未保存内容' });
    expect(within(prompt).getByText('未保存凭证')).toBeVisible();
    expect(within(prompt).queryByText('已保存页面')).not.toBeInTheDocument();
    await click(within(prompt).getByRole('button', { name: /取\s*消/ }));
    await waitFor(() =>
      expect(
        screen.getByText('切换已取消，或仍有内容未保存。请检查相关页面后重试。'),
      ).toBeVisible(),
    );
    expect(state.calls).toBe(0);
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/m/workbench/settings');
  });
  it('保存确实清除修改后才提交；保存期间仍脏则不切换', async () => {
    const save = vi.fn(async () => false);
    dirty(save);
    setup();
    await changeProduct();
    const prompt = await screen.findByRole('dialog', { name: '有未保存内容' });
    await click(within(prompt).getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(state.calls).toBe(0);
    cleanup();
    unsavedPages.pages.clear();
    await act(async () => {
      Modal.destroyAll();
    });
    const page = {
      bookId: 'book',
      tabKey: '/voucher',
      title: '未保存凭证',
      dirty: true,
      version: 1,
      save: async () => {
        registration.update({ ...page, dirty: false });
        return true;
      },
    };
    const registration = unsavedPages.register(page);
    setup();
    await changeProduct();
    await click(
      within(await screen.findByRole('dialog', { name: '有未保存内容' })).getByRole('button', {
        name: '保存并继续',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('当前地址')).toHaveTextContent('/home'));
    expect(state.calls).toBe(1);
  });
  it('明确放弃修改会调用放弃回调，随后才能切换', async () => {
    const discard = vi.fn();
    dirty(async () => false, discard);
    setup();
    await changeProduct();
    const prompt = await screen.findByRole('dialog', { name: '有未保存内容' });
    await click(within(prompt).getByRole('button', { name: '放弃修改并继续' }));
    await waitFor(() => expect(screen.getByLabelText('当前地址')).toHaveTextContent('/home'));
    expect(discard).toHaveBeenCalledOnce();
    expect(state.calls).toBe(1);
  });
});
