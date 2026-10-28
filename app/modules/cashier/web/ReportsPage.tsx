import { Form, Input, Select, Button, Alert, Checkbox, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  balanceSide,
  formatMoney,
  formatPeriod,
  periodStartDate,
  periodEndDate,
} from '@caiwu/core';
import { useCurrentPeriod } from '@caiwu/web-kit';
import {
  DataTable,
  FilterBar,
  PageContainer,
  PeriodPicker,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { safeSum } from '../shared';
import type { CashSummaryInput } from '../reports-shared';
import { api, type Outputs } from './api';
import { CashierNav, QueryState, printRows } from './common';

const money = (n: number | null | undefined) => (n == null ? '—' : formatMoney(n));

export default function ReportsPage() {
  const [filters, setFilters] = useUrlFilters({ accountId: 0, from: '', to: '', view: 'journal' });
  return (
    <PageContainer
      title={filters.view === 'summary' ? '出纳汇总余额表' : '出纳日记账'}
      subtitle="本位币与原币分别列示，按账户和币种核对收付结余"
    >
      <CashierNav />
      <Space style={{ marginBottom: 16 }}>
        <Button
          type={filters.view !== 'summary' ? 'primary' : 'default'}
          onClick={() => setFilters({ view: 'journal' })}
        >
          日记账
        </Button>
        <Button
          type={filters.view === 'summary' ? 'primary' : 'default'}
          onClick={() => setFilters({ view: 'summary' })}
        >
          汇总余额表
        </Button>
      </Space>
      {filters.view === 'summary' ? (
        <SummaryReport />
      ) : (
        <JournalReport filters={filters} onSearch={setFilters} />
      )}
    </PageContainer>
  );
}

function JournalReport({
  filters,
  onSearch,
}: {
  filters: { accountId: number; from: string; to: string };
  onSearch: (v: { accountId?: number; from?: string; to?: string }) => void;
}) {
  const period = useCurrentPeriod();
  const accounts = useQuery(api.accounts.queryOptions({}));
  const a = accounts.data?.find((a) => a.id === (filters.accountId || accounts.data?.[0]?.id));
  const list = useQuery(api.documents.queryOptions({ accountId: a?.id }, { enabled: !!a }));
  const from = filters.from || period?.startDate || '';
  const to = filters.to || period?.endDate || '';
  const invalid = from > to || (!!a && from < periodStartDate(a.period));
  const foreign = a?.foreignOpening != null;
  const opening = safeSum([
    a?.opening ?? 0,
    ...(list.data ?? []).filter((d) => d.date < from).map((d) => d.signed),
  ]);
  const foreignOpening = foreign
    ? safeSum([
        a.foreignOpening!,
        ...(list.data ?? []).filter((d) => d.date < from).map((d) => d.foreignSigned ?? 0),
      ])
    : null;
  let balance = opening;
  let foreignBalance = foreignOpening;
  const rows = (list.data ?? [])
    .filter((d) => d.date >= from && d.date <= to)
    .map((d) => {
      balance = safeSum([balance, d.signed]);
      if (foreignBalance != null) foreignBalance = safeSum([foreignBalance, d.foreignSigned ?? 0]);
      return {
        ...d,
        balance,
        foreignBalance,
        receipt: d.direction === 'receipt' ? d.amount : 0,
        payment: d.direction === 'payment' ? d.amount : 0,
        foreignReceipt: foreign ? (d.direction === 'receipt' ? d.foreignAmount : 0) : null,
        foreignPayment: foreign ? (d.direction === 'payment' ? d.foreignAmount : 0) : null,
      };
    });
  const receipt = safeSum(rows.map((r) => r.receipt));
  const payment = safeSum(rows.map((r) => r.payment));
  const foreignReceipt = foreign ? safeSum(rows.map((r) => r.foreignReceipt ?? 0)) : null;
  const foreignPayment = foreign ? safeSum(rows.map((r) => r.foreignPayment ?? 0)) : null;
  return (
    <>
      <FilterBar<{ accountId?: number; from?: string; to?: string }>
        key={`${a?.id}-${from}-${to}`}
        initialValues={{ accountId: a?.id, from, to }}
        onSearch={(v) => {
          onSearch({ accountId: v.accountId ?? 0, from: v.from ?? '', to: v.to ?? '' });
          void accounts.refetch();
          void list.refetch();
        }}
      >
        <Form.Item name="accountId" label="日记账账户">
          <Select
            style={{ width: 180 }}
            options={accounts.data?.map((a) => ({ value: a.id, label: `${a.name} ${a.currency}` }))}
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
            title={`${a?.name ?? '请选择账户'} · 本位币期初 ${formatMoney(opening)} · 收款 ${formatMoney(receipt)} · 付款 ${formatMoney(payment)} · 期末 ${balanceSide(balance, 'debit').side} ${formatMoney(Math.abs(balance))}`}
            description={
              foreign
                ? `${a.currency} 原币期初 ${money(foreignOpening)} · 收款 ${money(foreignReceipt)} · 付款 ${money(foreignPayment)} · 期末 ${money(foreignBalance)}`
                : undefined
            }
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
              { key: 'receipt', title: '本位币收款', dataIndex: 'receipt', money: true },
              { key: 'payment', title: '本位币付款', dataIndex: 'payment', money: true },
              {
                key: 'balance',
                title: '本位币余额（借正贷负）',
                dataIndex: 'balance',
                money: true,
              },
              ...(foreign
                ? [
                    { key: 'exchangeRate', title: '汇率', dataIndex: 'exchangeRate', width: 100 },
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
                      key: 'foreignBalance',
                      title: '原币余额（借正贷负）',
                      dataIndex: 'foreignBalance',
                      money: true,
                    },
                  ]
                : []),
            ]}
          />
          <Button
            disabled={!a || rows.length === 0}
            onClick={() =>
              printRows(
                `出纳日记账 ${a?.name} ${a?.currency} ${from} 至 ${to}`,
                [
                  '日期',
                  '单号',
                  '摘要',
                  '本位币收款',
                  '本位币付款',
                  '本位币余额',
                  ...(foreign ? ['汇率', '原币收款', '原币付款', '原币余额'] : []),
                ],
                [
                  ['', '', '期初', 0, 0, opening, ...(foreign ? ['', 0, 0, foreignOpening!] : [])],
                  ...rows.map((r) => [
                    r.date,
                    r.number,
                    r.summary,
                    r.receipt,
                    r.payment,
                    r.balance,
                    ...(foreign
                      ? [
                          r.exchangeRate ?? '',
                          r.foreignReceipt ?? 0,
                          r.foreignPayment ?? 0,
                          r.foreignBalance ?? 0,
                        ]
                      : []),
                  ]),
                  [
                    '',
                    '',
                    '合计／期末',
                    receipt,
                    payment,
                    balance,
                    ...(foreign ? ['', foreignReceipt!, foreignPayment!, foreignBalance!] : []),
                  ],
                ],
              )
            }
          >
            打印日记账
          </Button>
        </QueryState>
      )}
    </>
  );
}

type SummaryRow = Outputs['summary']['rows'][number];
const summaryMoneyColumns: DataColumn<SummaryRow>[] = [
  { key: 'opening', title: '本位币期初', dataIndex: 'opening', money: true },
  { key: 'receipt', title: '本位币本期收款', dataIndex: 'receipt', money: true },
  { key: 'payment', title: '本位币本期付款', dataIndex: 'payment', money: true },
  { key: 'closing', title: '本位币期末', dataIndex: 'closing', money: true },
  { key: 'ytdReceipt', title: '本位币本年收款', dataIndex: 'ytdReceipt', money: true },
  { key: 'ytdPayment', title: '本位币本年付款', dataIndex: 'ytdPayment', money: true },
  { key: 'foreignOpening', title: '原币期初', dataIndex: 'foreignOpening', money: true },
  { key: 'foreignReceipt', title: '原币本期收款', dataIndex: 'foreignReceipt', money: true },
  { key: 'foreignPayment', title: '原币本期付款', dataIndex: 'foreignPayment', money: true },
  { key: 'foreignClosing', title: '原币期末', dataIndex: 'foreignClosing', money: true },
  { key: 'foreignYtdReceipt', title: '原币本年收款', dataIndex: 'foreignYtdReceipt', money: true },
  { key: 'foreignYtdPayment', title: '原币本年付款', dataIndex: 'foreignYtdPayment', money: true },
];

function SummaryReport() {
  const navigate = useNavigate();
  const current = useCurrentPeriod();
  const [filters, setFilters] = useUrlFilters({
    summaryFrom: 0,
    summaryTo: 0,
    includeUnclosed: true as boolean,
  });
  const input: CashSummaryInput = {
    from: filters.summaryFrom || current?.period || 202601,
    to: filters.summaryTo || current?.period || 202601,
    includeUnclosed: filters.includeUnclosed,
  };
  const result = useQuery(api.summary.queryOptions(input, { enabled: !!current, retry: false }));
  const data = result.data;
  const totals =
    data?.currencyTotals.map((r, i) => ({
      ...r,
      accountId: -i - 1,
      name: `${r.currency} 合计`,
      code: '',
      coreName: '',
    })) ?? [];
  return (
    <>
      <FilterBar<CashSummaryInput>
        key={`${input.from}-${input.to}-${input.includeUnclosed}`}
        initialValues={input}
        onSearch={(v) => {
          setFilters({
            summaryFrom: v.from,
            summaryTo: v.to,
            includeUnclosed: v.includeUnclosed ?? false,
          });
          if (
            v.from === input.from &&
            v.to === input.to &&
            (v.includeUnclosed ?? false) === input.includeUnclosed
          )
            void result.refetch();
        }}
      >
        <Form.Item name="from" label="汇总开始期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="to" label="汇总结束期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="includeUnclosed" valuePropName="checked">
          <Checkbox>包含未结账单据</Checkbox>
        </Form.Item>
      </FilterBar>
      <QueryState loading={result.isLoading} error={result.error} retry={result.refetch}>
        {data && (
          <>
            <Alert
              type={data.excludedPeriods.length ? 'warning' : 'info'}
              title={`${formatPeriod(data.from)} 至 ${formatPeriod(data.to)} · ${data.includeUnclosed ? '包含未结账单据' : '仅已结账单据'}`}
              description={
                data.excludedPeriods.length
                  ? `未纳入月份：${data.excludedPeriods.map(formatPeriod).join('、')}；本年累计采用相同范围。本位币汇总可合计，原币仅在同币种内合计。`
                  : '本年累计从该年一月或启用月份起计算。原币仅在同币种内合计；点击明细可查看组成单据。'
              }
            />
            <DataTable
              tableId="cashier.summary"
              rowKey="accountId"
              dataSource={data.rows}
              exportName="出纳汇总余额表"
              columns={[
                { key: 'name', title: '账户', dataIndex: 'name', width: 180 },
                { key: 'code', title: '科目', dataIndex: 'code', width: 100 },
                { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
                ...summaryMoneyColumns,
                {
                  key: 'actions',
                  title: '明细',
                  width: 90,
                  noExport: true,
                  render: (_, r) => (
                    <Button
                      type="link"
                      disabled={data.effectiveTo == null}
                      onClick={() =>
                        void navigate(
                          `/m/cashier/documents?accountId=${r.accountId}&from=${periodStartDate(data.from)}&to=${periodEndDate(data.effectiveTo ?? data.from)}`,
                        )
                      }
                    >
                      查看单据
                    </Button>
                  ),
                },
              ]}
            />
            <DataTable
              tableId="cashier.summary.currency"
              rowKey="currency"
              dataSource={totals}
              exportName="出纳分币种汇总"
              columns={[
                { key: 'currency', title: '币种', dataIndex: 'currency', width: 100 },
                ...summaryMoneyColumns.map((c) => ({ ...c, render: undefined })),
              ]}
            />
            <Alert
              type="info"
              title={`本位币 ${data.baseCurrency} 合计：期初 ${money(data.baseTotal.opening)} · 收款 ${money(data.baseTotal.receipt)} · 付款 ${money(data.baseTotal.payment)} · 期末 ${money(data.baseTotal.closing)} · 本年收款 ${money(data.baseTotal.ytdReceipt)} · 本年付款 ${money(data.baseTotal.ytdPayment)}`}
            />
            <Button
              disabled={!data.rows.length}
              onClick={() =>
                printRows(
                  `出纳汇总余额表 ${formatPeriod(data.from)} 至 ${formatPeriod(data.to)} ${data.includeUnclosed ? '含未结账单据' : '仅已结账单据'}`,
                  ['账户', '科目', '币种', ...summaryMoneyColumns.map((c) => String(c.title))],
                  [...data.rows, ...totals].map((r) => [
                    r.name,
                    r.code,
                    r.currency,
                    r.opening,
                    r.receipt,
                    r.payment,
                    r.closing,
                    r.ytdReceipt,
                    r.ytdPayment,
                    r.foreignOpening ?? '',
                    r.foreignReceipt ?? '',
                    r.foreignPayment ?? '',
                    r.foreignClosing ?? '',
                    r.foreignYtdReceipt ?? '',
                    r.foreignYtdPayment ?? '',
                  ]),
                )
              }
            >
              打印汇总余额表
            </Button>
          </>
        )}
      </QueryState>
    </>
  );
}
