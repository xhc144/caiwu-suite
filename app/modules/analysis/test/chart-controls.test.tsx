import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import type { PropsWithChildren } from 'react';
import type * as WebKit from '@caiwu/web-kit';
import type * as Print from '@caiwu/print';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  fetchQuery: vi.fn(),
  print: vi.fn(),
  setOption: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('echarts', () => ({
  init: () => ({ setOption: mocks.setOption, dispose: mocks.dispose, resize: vi.fn() }),
}));
vi.mock('@caiwu/web-kit', async (original) => ({
  ...(await original<typeof WebKit>()),
  usePermission: mocks.permission,
  queryClient: { fetchQuery: mocks.fetchQuery },
}));
vi.mock('@caiwu/print', async (original) => ({
  ...(await original<typeof Print>()),
  printHtml: mocks.print,
}));
vi.mock('../web/api', () => ({
  api: { printAllowed: { queryOptions: (kind: string) => ({ queryKey: ['printAllowed', kind] }) } },
}));
import AnalysisChart from '../web/AnalysisChart';

function TestApp({ children }: PropsWithChildren) {
  return (
    <ConfigProvider button={{ autoInsertSpace: false }} theme={{ token: { motion: false } }}>
      <App>{children}</App>
    </ConfigProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockReturnValue(true);
  mocks.fetchQuery.mockResolvedValue(true);
  mocks.print.mockResolvedValue(undefined);
});

describe('w_fx_demo_tx 图形控件实际交互', () => {
  it('转换坐标后可恢复，独立打印实际复核权限并采用所选彩色模式；取消不打印', async () => {
    const user = userEvent.setup();
    render(
      <AnalysisChart
        labels={['一月', '二月']}
        values={[12345, -6789]}
        title="测试期间分析"
        description="2026年1至2月"
      />,
      { wrapper: TestApp },
    );
    await user.click(screen.getByRole('button', { name: /^坐标转换$/ }));
    expect(screen.getByText('数值横轴、项目纵轴')).toBeVisible();
    expect(mocks.setOption.mock.lastCall?.[0].xAxis).toEqual({ type: 'value', name: '元' });
    await user.click(screen.getByRole('button', { name: /^恢复坐标$/ }));
    expect(screen.getByText('项目横轴、数值纵轴')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^独立打印图形$/ }));
    const dialog = await screen.findByRole('dialog', { name: /^选择图形打印颜色$/ });
    await user.click(within(dialog).getByRole('radio', { name: /^彩色$/ }));
    await user.click(within(dialog).getByRole('button', { name: /^打印图形$/ }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledOnce());
    expect(mocks.fetchQuery).toHaveBeenCalledWith({
      queryKey: ['printAllowed', 'trend'],
      staleTime: 0,
    });
    expect(mocks.print.mock.lastCall?.[0].html).toContain('data-color-mode="color"');
    expect(mocks.print.mock.lastCall?.[0].html).toContain('2026年1至2月');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^独立打印图形$/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: /^选择图形打印颜色$/ })).getByRole(
        'button',
        {
          name: /^取消$/,
        },
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.print).toHaveBeenCalledOnce();
  });
  it('负数饼图禁用打印与坐标转换，没有导出权限时不显示打印操作', async () => {
    const user = userEvent.setup();
    const view = render(<AnalysisChart labels={['负数']} values={[-1]} />, { wrapper: TestApp });
    await user.click(screen.getByRole('combobox', { name: /^图形$/ }));
    await user.click(screen.getByText('饼图', { exact: true }));
    expect(screen.getByText('含负数时无法绘制饼图，请选择柱图或折线图')).toBeVisible();
    expect(screen.getByRole('button', { name: /^坐标转换$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^独立打印图形$/ })).toBeDisabled();
    mocks.permission.mockReturnValue(false);
    view.rerender(<AnalysisChart labels={['负数']} values={[-1]} />);
    expect(screen.queryByRole('button', { name: /^独立打印图形$/ })).not.toBeInTheDocument();
  });
});
