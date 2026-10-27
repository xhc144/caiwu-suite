import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import { Filters, useBookFilters } from './filters';
import { ConfigProvider } from 'antd';

vi.mock('@caiwu/web-kit', () => ({
  useVoucherTypes: () => [{ id: 1, code: '记' }],
  getBusinessError: () => null,
}));
vi.mock('./api', () => ({
  api: {
    creators: {
      queryOptions: () => ({
        queryKey: ['creators'],
        queryFn: async () => [
          { id: 1, code: 'admin', name: '会计甲', disabled: 0 },
          { id: 9, code: 'old', name: '历史会计', disabled: 1 },
        ],
      }),
    },
  },
}));
afterEach(cleanup);
function Harness() {
  const filters = useBookFilters();
  const navigate = useNavigate();
  return (
    <>
      <Filters {...filters} />
      <output aria-label="应用条件">{JSON.stringify(filters.filter)}</output>
      <output aria-label="地址金额">{filters.values.amountFrom}</output>
      <button onClick={() => void navigate('/m/voucher-book?amountFrom=-1&amountTo=100')}>
        外部条件
      </button>
      <button
        onClick={() => {
          window.dispatchEvent(new PopStateEvent('popstate'));
          void navigate(-1);
        }}
      >
        返回条件
      </button>
    </>
  );
}
function setup(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <MemoryRouter initialEntries={[url]}>
          <Harness />
        </MemoryRouter>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}
describe('w_pz_pzxsb 筛选表单', () => {
  it('旧链接显示元、停用制单人姓名；提交金额与综合条件仍使用分，外部导航双向同步', async () => {
    const conditions = JSON.stringify([{ field: 'amount', operator: 'gte', value: '1' }]);
    setup(
      `/m/voucher-book?amountFrom=1&amountTo=12345&creator=9&conditions=${encodeURIComponent(conditions)}`,
    );
    expect(screen.getByLabelText('金额起（元）')).toHaveValue('0.01');
    expect(screen.getByLabelText('金额止（元）')).toHaveValue('123.45');
    expect(screen.getByLabelText('综合查询值1')).toHaveValue('0.01');
    expect(await screen.findByText('历史会计（old，已停用）')).toBeVisible();
    expect(screen.queryByText('制单人ID')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('金额起（元）'), { target: { value: '2.34' } });
    fireEvent.change(screen.getByLabelText('综合查询值1'), { target: { value: '1.23' } });
    fireEvent.click(screen.getByRole('button', { name: /^查询$/ }));
    await waitFor(() => expect(screen.getByLabelText('地址金额')).toHaveTextContent('234'));
    expect(JSON.parse(screen.getByLabelText('应用条件').textContent!)).toMatchObject({
      amountFrom: 234,
      amountTo: 12345,
      createdBy: 9,
      conditions: [{ field: 'amount', operator: 'gte', value: '123' }],
    });
    fireEvent.click(screen.getByRole('button', { name: '外部条件' }));
    await waitFor(() => expect(screen.getByLabelText('金额起（元）')).toHaveValue('-0.01'));
    fireEvent.click(screen.getByRole('button', { name: '返回条件' }));
    await waitFor(() => expect(screen.getByLabelText('金额起（元）')).toHaveValue('2.34'));
    expect(screen.getByLabelText('综合查询值1')).toHaveValue('1.23');
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(screen.getByLabelText('金额起（元）')).toHaveValue(''));
    expect(screen.getByLabelText('地址金额')).toBeEmptyDOMElement();
  });
  it('非法金额和综合条件保持中文错误并阻止查询；不存在的制单人不显示内部编号', async () => {
    setup('/m/voucher-book?creator=987654');
    expect(await screen.findByText('制单人已不存在，请重新选择')).toBeVisible();
    expect(screen.queryByText('987654', { exact: true })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('金额起（元）'), { target: { value: '不是金额' } });
    fireEvent.click(screen.getByRole('button', { name: /^查询$/ }));
    await waitFor(() =>
      expect(screen.getByText('请输入有效金额，例如 0.01 或 -100.00')).toBeVisible(),
    );
    expect(screen.getByLabelText('地址金额')).toBeEmptyDOMElement();
    cleanup();
    setup(
      `/m/voucher-book?conditions=${encodeURIComponent('[{"field":"secret","operator":"eq","value":"x"}]')}`,
    );
    expect(screen.getByLabelText('应用条件')).toHaveTextContent('null');
    expect(screen.getByText('地址栏中的综合条件有误')).toBeVisible();
    expect(screen.queryByText('secret', { exact: true })).not.toBeInTheDocument();
  });
});
