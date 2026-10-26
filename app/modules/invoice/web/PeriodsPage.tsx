import { today, periodOfDate } from '@caiwu/core';
import { useInvoiceFilters } from './useInvoiceFilters';
import { Alert, Button, Form, Popconfirm, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient, usePermission } from '@caiwu/web-kit';
import { FilterBar, PageContainer, PeriodPicker } from '@caiwu/ui';
import { api } from './api';
import { Nav, QueryError } from './common';
export default function PeriodsPage() {
  const [filters, setFilters] = useInvoiceFilters({ period: periodOfDate(today()) });
  const query = useQuery(api.periods.queryOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: api.periods.queryKey() });
  const close = useMutation(api.close.mutationOptions({ onSuccess: () => void refresh() }));
  const reopen = useMutation(api.reopen.mutationOptions({ onSuccess: () => void refresh() }));
  const canClose = usePermission('invoice.close'),
    canReopen = usePermission('invoice.reopen');
  const r = query.data?.rows.find((r) => r.period === filters.period);
  const input = { period: filters.period, expectedRevision: r?.revision ?? 0, confirmed: true };
  return (
    <PageContainer title="发票结账">
      <Nav />
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item label="发票月份" name="period">
          <PeriodPicker />
        </Form.Item>
      </FilterBar>
      <QueryError error={query.error} retry={query.refetch} />
      <Alert
        type="warning"
        title="仅锁定发票模块月份，不关闭整个账务期间"
        description="结账后，开票日期或确认日期位于该月的发票不能录入、修改、删除、审核、制证或撤销。反结账将重新允许这些操作，仍受来源凭证审核和账务期间保护。"
      />
      {query.isSuccess && (
        <>
          <p>
            账套启用月份：{query.data.startPeriod}；所选 {filters.period}：
            {r?.closed ? '已结账' : '未结账'}
          </p>
          <Space>
            {canClose && !r?.closed && (
              <Popconfirm
                title={`确认锁定 ${filters.period} 发票数据？`}
                onConfirm={() => close.mutate(input)}
              >
                <Button loading={close.isPending}>结账</Button>
              </Popconfirm>
            )}
            {canReopen && !!r?.closed && (
              <Popconfirm
                title={`确认取消 ${filters.period} 发票月锁定？`}
                onConfirm={() => reopen.mutate(input)}
              >
                <Button loading={reopen.isPending}>反结账</Button>
              </Popconfirm>
            )}
          </Space>
        </>
      )}
    </PageContainer>
  );
}
