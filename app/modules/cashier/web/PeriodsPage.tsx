import { Alert, Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatPeriod } from '@caiwu/core';
import { usePermission } from '@caiwu/web-kit';
import { DataTable, PageContainer } from '@caiwu/ui';
import { api, refresh } from './api';
import { CashierNav, QueryState, useCashierConfirm } from './common';

export default function PeriodsPage() {
  const result = useQuery(api.periods.queryOptions(undefined, { retry: false }));
  const close = useMutation(api.closePeriod.mutationOptions({ onSuccess: () => void refresh() }));
  const reopen = useMutation(api.reopenPeriod.mutationOptions({ onSuccess: () => void refresh() }));
  const canClose = usePermission('cashier.period.close');
  const canReopen = usePermission('cashier.period.reopen');
  const [confirm, holder] = useCashierConfirm();
  const data = result.data;
  const busy = result.isFetching || close.isPending || reopen.isPending;
  return (
    <PageContainer
      title="出纳结账与反结账"
      subtitle="按月保存出纳收付结余；总账期间与凭证状态由账务人员维护"
    >
      <CashierNav />
      <QueryState loading={result.isLoading} error={result.error} retry={result.refetch}>
        {data && (
          <>
            <Alert
              type="info"
              title={`当前出纳月份：${formatPeriod(data.current)}`}
              description="结账后该月单据、凭证生成/撤销及勾账操作将锁定；不要求全部单据生成凭证。十二月结账建立下一年只读出纳期初。"
            />
            {data.rollover && (
              <Alert
                type="warning"
                title="本次结账将建立下一年度出纳期初"
                description="逐账户以本年期末结余结转，不改写账务期初。"
              />
            )}
            <DataTable
              tableId="cashier.period.preview"
              rowKey="accountId"
              dataSource={data.rows}
              columns={[
                { key: 'name', title: '账户', dataIndex: 'name', width: 200 },
                { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
                { key: 'opening', title: '月初余额', dataIndex: 'opening', money: true },
                { key: 'receipt', title: '本月收款', dataIndex: 'receipt', money: true },
                { key: 'payment', title: '本月付款', dataIndex: 'payment', money: true },
                { key: 'closing', title: '月末余额', dataIndex: 'closing', money: true },
                {
                  key: 'foreignOpening',
                  title: '原币月初',
                  dataIndex: 'foreignOpening',
                  money: true,
                },
                {
                  key: 'foreignReceipt',
                  title: '原币收款',
                  dataIndex: 'foreignReceipt',
                  money: true,
                },
                {
                  key: 'foreignPayment',
                  title: '原币付款',
                  dataIndex: 'foreignPayment',
                  money: true,
                },
                {
                  key: 'foreignClosing',
                  title: '原币月末',
                  dataIndex: 'foreignClosing',
                  money: true,
                },
              ]}
            />
            <Space wrap>
              <Button disabled={busy} onClick={() => void result.refetch()}>
                刷新期间预览
              </Button>
              {canClose && (
                <Button
                  type="primary"
                  aria-busy={close.isPending}
                  disabled={busy || !data.rows.length}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `结账 ${formatPeriod(data.current)}`,
                        content: `保存以上账户余额并锁定本月业务。${data.rollover ? '同时建立下一年出纳期初；后续年度发生业务后不能跨年反结账。' : ''}`,
                        confirmText: '出纳结账',
                      })
                    )
                      close.mutate({
                        period: data.current,
                        snapshot: data.snapshot,
                        confirmed: true,
                      });
                  }}
                >
                  结账当前出纳月份
                </Button>
              )}
              {canReopen && (
                <Button
                  danger
                  aria-busy={reopen.isPending}
                  disabled={busy || data.lastClosed == null || data.reopenBlocked}
                  onClick={async () => {
                    if (
                      data.lastClosed != null &&
                      (await confirm({
                        title: `反结账 ${formatPeriod(data.lastClosed)}`,
                        content: `只取消最近一个月的出纳结账，保留所有单据、凭证和勾账。${data.reopenRemovesYear ? '将删除此次十二月结账衍生的下一年出纳年初数；后续年度有业务历史时禁止执行。' : ''}需要修改业务时还须核对总账期间是否开放。`,
                        confirmText: '出纳反结账',
                      }))
                    )
                      reopen.mutate({
                        period: data.lastClosed,
                        snapshot: data.snapshot,
                        confirmed: true,
                      });
                  }}
                >
                  反结账最近出纳月份
                </Button>
              )}
            </Space>
            {data.reopenBlocked && (
              <Alert
                type="warning"
                title="后续年度已有业务历史，禁止跨年反结账"
                description="保留备份并核对后续年度；此处不会删除单据。"
              />
            )}
            <DataTable
              tableId="cashier.period.history"
              rowKey="period"
              dataSource={data.history}
              columns={[
                {
                  key: 'period',
                  title: '期间',
                  dataIndex: 'period',
                  width: 140,
                  render: (_, r) => formatPeriod(r.period),
                },
                {
                  key: 'status',
                  title: '出纳状态',
                  render: (_, r) => (r.closed ? '已结账' : '已反结账'),
                  width: 140,
                },
                { key: 'at', title: '结账时间', dataIndex: 'closed_at', width: 220 },
              ]}
            />
          </>
        )}
      </QueryState>
      {holder}
    </PageContainer>
  );
}
