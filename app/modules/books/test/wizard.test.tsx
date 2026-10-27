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
      id: 'books-enterprise-cas-2006',
      name: '企业会计准则',
      codeScheme: '4-2-2',
      accountCount: 248,
      description: '正式企业科目',
    },
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
  it('w_xt_kgzb_a2/a3 企业与小企业并列首选，预览203一级45明细，返回切制度保留4-3-3', async () => {
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '企业预览');
    await user.type(screen.getByLabelText('单位名称'), '合成单位');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleName(/企业会计准则/);
    expect(screen.getAllByRole('radio')[1]).toHaveAccessibleName(/小企业会计准则/);
    await user.click(screen.getByRole('radio', { name: /^企业会计准则/ }));
    expect(screen.getByText(/203项一级、45项明细，共248项/)).toBeVisible();
    expect(screen.queryByText(/所选模板有.*待核科目/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.clear(screen.getByLabelText('科目级次'));
    await user.type(screen.getByLabelText('科目级次'), '4-3-3');
    await user.click(screen.getByRole('button', { name: '上一步' }));
    await user.click(screen.getByRole('radio', { name: /^小企业会计准则/ }));
    await user.click(screen.getByRole('radio', { name: /^企业会计准则/ }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('科目级次')).toHaveValue('4-3-3');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('w_xt_kgzb_3 创建响应失败后保留内容，重试沿用同一服务端幂等编号', async () => {
    mock.create.mockRejectedValue(new Error('合成网络响应失败'));
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '重试保留账套');
    await user.type(screen.getByLabelText('单位名称'), '合成重试单位');
    const create = screen.getByRole('button', { name: '创建' });
    await user.click(create);
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    await waitFor(() => expect(create).toBeEnabled());
    expect(screen.getByLabelText('账套名称')).toHaveValue('重试保留账套');
    await user.click(create);
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
    const first = mock.create.mock.calls[0]![0] as { requestKey: string };
    const second = mock.create.mock.calls[1]![0] as { requestKey: string };
    expect(first.requestKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(second).toEqual(first);
  });
  it('w_tzjl_1_new 编辑后还原全部内容，取消直接退出，不弹放弃确认', async () => {
    const { close, user } = mount();
    const name = screen.getByLabelText('账套名称');
    await user.type(name, '暂时修改');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '放弃创建' })).not.toBeInTheDocument();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('w_xt_kgzb_1 慢创建期间上一步、下一步及最终复核均锁定，仍只创建一次', async () => {
    mock.create.mockImplementation(() => new Promise(() => {}));
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '慢请求测试');
    await user.type(screen.getByLabelText('单位名称'), '合成单位');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    for (const name of ['上一步', '下一步', '展开最终复核', '取消'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: 'CNY' }),
      expect.anything(),
    );
  });
  it('快速重复取消只打开一层确认，确认及退场期间不提交，继续编辑后可再次取消', async () => {
    const { close, user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '重复取消');
    await user.type(screen.getByLabelText('单位名称'), '有效取消测试单位');
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled());
    const cancel = screen.getByRole('button', { name: '取消' });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    expect(await screen.findAllByRole('button', { name: '继续编辑' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(cancel).toBeEnabled());
    await user.click(cancel);
    await user.click(await screen.findByRole('button', { name: '放弃创建' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('有效表单在取消确认期间收到程序性创建事件也不调用core创建', async () => {
    mock.create.mockImplementation(() => new Promise(() => {}));
    const { user } = mount();
    await user.type(screen.getByLabelText('账套名称'), '有效表单取消');
    await user.type(screen.getByLabelText('单位名称'), '有效取消单位');
    const create = screen.getByRole('button', { name: '创建' });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(create);
    fireEvent.click(create);
    await user.click(await screen.findByRole('button', { name: '继续编辑' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '继续编辑' })).not.toBeInTheDocument(),
    );
    expect(mock.create).not.toHaveBeenCalled();
    expect(create).toBeEnabled();
  });
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
    expect(screen.getByText('人民币 CNY（当前仅支持人民币本位币）')).toBeVisible();
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
