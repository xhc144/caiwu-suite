import type * as WebKit from '@caiwu/web-kit';
import { App, ConfigProvider } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Wizard from '../web/Wizard';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  templates: [
    {
      id: 'books-small-business',
      name: '小企业会计准则',
      codeScheme: '4-2-2',
      accountCount: 66,
      description: 'small-appendix.pdf第1—3页',
    },
  ],
}));
vi.mock('@caiwu/web-kit', async (original) => ({
  ...(await original<typeof WebKit>()),
  coreApi: {
    books: {
      templates: {
        queryOptions: () => ({
          queryKey: ['wizard-templates'],
          queryFn: async () => mock.templates,
        }),
      },
      create: { mutationOptions: () => ({ mutationFn: mock.create }) },
    },
  },
}));

beforeEach(() => {
  mock.create.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState({ idx: 0 }, '', '/');
});
function mount() {
  const close = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}>
      <App>
        <QueryClientProvider client={client}>
          <Wizard onClose={close} onCreated={vi.fn()} />
        </QueryClientProvider>
      </App>
    </ConfigProvider>,
  );
  return { close, user: userEvent.setup() };
}

describe('w_tzjl_1_new / w_xt_kgzb_a1—5 / w_xt_kgzb_1 向导确认', () => {
  it('取消未编辑的向导不提交；编辑后退出有确认，继续编辑保留内容，确认放弃不产生创建请求', async () => {
    const { close, user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '取消测试');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(close).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '继续编辑' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '继续编辑' })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('账套名称')).toHaveValue('取消测试');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '放弃创建' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('空名称、空单位不能离开第一步或提交；当前仅支持人民币提示可见', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText('请输入1—60字账套名称')).toBeVisible());
    await waitFor(() => expect(screen.getByText('请输入1—100字单位名称')).toBeVisible());
    expect(screen.getByText(/人民币 CNY/)).toBeVisible();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('w_xt_kgzb_a1 浏览器后退取消离开时恢复原位置，保留未提交内容', async () => {
    history.replaceState({ idx: 2 }, '', '/');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '后退保留');
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText('账套名称')).toHaveValue('后退保留');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('未提交内容的刷新触发浏览器确认；快速重复提交只调用一次core创建', async () => {
    mock.create.mockImplementation(() => new Promise(() => {}));
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '测试账套');
    await user.type(screen.getByLabelText('单位名称'), '测试单位');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const button = screen.getByRole('button', { name: '创建' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  });
});
