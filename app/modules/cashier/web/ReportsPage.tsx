import { Form, Input, Select, Button, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { balanceSide, formatMoney, periodStartDate } from '@caiwu/core';
import { useCurrentPeriod } from '@caiwu/web-kit';
import { DataTable, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { safeSum } from '../shared';
import { api } from './api';
import { CashierNav, QueryState, printRows } from './common';

export default function ReportsPage() {
  const [filters, setFilters] = useUrlFilters({ accountId: 0, from: '', to: '' });
  const period = useCurrentPeriod();
  const accounts = useQuery(api.accounts.queryOptions({}));
  const a = accounts.data?.find((a) => a.id === (filters.accountId || accounts.data?.[0]?.id));
  const list = useQuery(api.documents.queryOptions({ accountId: a?.id }, { enabled: !!a }));
  const from = filters.from || period?.startDate || '';
  const to = filters.to || period?.endDate || '';
  const invalid = from > to || (!!a && from < periodStartDate(a.period));
  const opening = safeSum([
    a?.opening ?? 0,
    ...(list.data ?? []).filter((d) => d.date < from).map((d) => d.signed),
  ]);
  let balance = opening;
  const rows = (list.data ?? [])
    .filter((d) => d.date >= from && d.date <= to)
    .map((d) => {
      balance = safeSum([balance, d.signed]);
      return {
        ...d,
        balance,
        receipt: d.direction === 'receipt' ? d.amount : 0,
        payment: d.direction === 'payment' ? d.amount : 0,
      };
    });
  const receipt = safeSum(rows.map((r) => r.receipt));
  const payment = safeSum(rows.map((r) => r.payment));
  return (
    <PageContainer
      title="出纳日记账"
      subtitle="按账户逐笔列示本位币期初、收付与期末；账户之间不混加"
    >
      <CashierNav />
      <FilterBar<{ accountId?: number; from?: string; to?: string }>
        key={`${a?.id}-${from}-${to}`}
        initialValues={{ accountId: a?.id, from, to }}
        onSearch={(v) =>
          setFilters({ accountId: v.accountId ?? 0, from: v.from ?? '', to: v.to ?? '' })
        }
      >
        <Form.Item name="accountId" label="日记账账户">
          <Select
            style={{ width: 180 }}
            options={accounts.data?.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
        <Form.Item name="from" label="开始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="结束日期">
          <Input type="date" />
        </Form.Item>
      </FilterBar>
      {invalid ? (
        <Alert type="error" title="日期范围不合法：开始日期应在出纳启用后，且不晚于结束日期" />
      ) : (
        <QueryState
          loading={accounts.isLoading || (!!a && list.isLoading)}
          error={accounts.error ?? list.error}
          retry={list.refetch}
        >
          <Alert
            type="info"
            title={`${a?.name ?? '请选择账户'} ${a?.currency ?? ''} · 期初 ${formatMoney(opening)} · 收款 ${formatMoney(receipt)} · 付款 ${formatMoney(payment)} · 期末 ${balanceSide(balance, 'debit').side} ${formatMoney(Math.abs(balance))}`}
          />
          <DataTable
            tableId="cashier.journal"
            rowKey="id"
            dataSource={rows}
            exportName="出纳日记账"
            columns={[
              { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
              { key: 'number', title: '单号', dataIndex: 'number', width: 130 },
              { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
              { key: 'receipt', title: '收款', dataIndex: 'receipt', money: true },
              { key: 'payment', title: '付款', dataIndex: 'payment', money: true },
              { key: 'balance', title: '余额（借正贷负）', dataIndex: 'balance', money: true },
            ]}
          />
          <Button
            disabled={!a}
            onClick={() =>
              printRows(
                `出纳日记账 ${a?.name} ${a?.currency} ${from} 至 ${to}`,
                ['日期', '单号', '摘要', '收款', '付款', '余额（借正贷负）'],
                [
                  ['', '', '期初', 0, 0, opening],
                  ...rows.map((r) => [
                    r.date,
                    r.number,
                    r.summary,
                    r.receipt,
                    r.payment,
                    r.balance,
                  ]),
                  ['', '', '合计／期末', receipt, payment, balance],
                ],
              )
            }
          >
            打印日记账
          </Button>
        </QueryState>
      )}
    </PageContainer>
  );
}
