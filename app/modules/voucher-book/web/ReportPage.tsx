import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert, Button, Checkbox, Empty, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@caiwu/core';
import { notify, queryClient, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import { printHtml } from '@caiwu/print';
import { DataTable, PageContainer, exportToExcel, type DataColumn } from '@caiwu/ui';
import { reportTotals, reportExcelAmount, type SummaryInput } from '../shared';
import { tAccountHtml, summaryHtml, reportCaption } from './report-print';
import { api } from './api';
import { Filters, useBookFilters } from './filters';

export default function ReportPage() {
  const filters = useBookFilters();
  const isT = useLocation().pathname.endsWith('/t-account');
  const navigate = useNavigate();
  const level = filters.values.level === 'root' ? 'root' : 'leaf';
  const foreign = filters.values.foreign === '1';
  const status = filters.values.scope || 'filter';
  const setting = (key: 'scope' | 'level' | 'foreign', value: string) =>
    filters.set({ [key]: value });
  const canExport = usePermission('voucher-book.export');
  const canPrint = usePermission('voucher-book.print');
  const types = useVoucherTypes();
  const [printing, setPrinting] = useState(false);
  const filter = {
    ...(filters.filter ?? {}),
    statuses:
      status === 'filter'
        ? (filters.filter?.statuses ?? ['pending', 'audited', 'posted'])
        : status === 'all'
          ? (['pending', 'audited', 'posted'] as const)
          : status === 'unposted'
            ? (['pending', 'audited'] as const)
            : (['posted'] as const),
  };
  const reportInput = {
    filter: { ...filter, statuses: [...filter.statuses] },
    level,
    foreign,
  } satisfies SummaryInput;
  const caption = reportCaption(
    reportInput.filter,
    types.find((t) => t.id === filter.voucherTypeId)?.code,
  );
  const sum = useQuery(
    api.summary.queryOptions(reportInput, { enabled: !isT && !!filters.filter }),
  );
  const t = useQuery(
    api.tAccount.queryOptions(reportInput.filter, {
      enabled: isT && !!filters.filter && !!filters.filter.accountCode,
    }),
  );
  type SummaryRow = NonNullable<typeof sum.data>[number];
  type TRow = NonNullable<typeof t.data>[number];
  const sumCols: DataColumn<SummaryRow>[] = [
    { key: 'code', title: '科目编码', dataIndex: 'code', width: 140 },
    { key: 'name', title: '科目名称', dataIndex: 'name', width: 230 },
    { key: 'currency', title: '币种', dataIndex: 'currency', width: 90 },
    { key: 'debit', title: '借方合计', dataIndex: 'debit', money: true },
    { key: 'credit', title: '贷方合计', dataIndex: 'credit', money: true },
    ...(foreign
      ? [
          { key: 'fcDebit', title: '原币借方', dataIndex: 'fcDebit', money: true },
          { key: 'fcCredit', title: '原币贷方', dataIndex: 'fcCredit', money: true },
        ]
      : []),
  ];
  const tCols: DataColumn<TRow>[] = [
    { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
    {
      key: 'number',
      title: '字号',
      width: 120,
      render: (_, r) => (
        <a
          href={`/m/voucher-book?id=${r.voucherId}`}
          onClick={(e) => {
            e.preventDefault();
            void navigate(`/m/voucher-book?id=${r.voucherId}`);
          }}
        >
          {r.displayNo}
        </a>
      ),
    },
    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
    {
      key: 'account',
      title: '科目',
      render: (_, r) => `${r.accountCode} ${r.accountName}`,
      width: 170,
    },
    {
      key: 'amount',
      title: '金额',
      money: true,
      render: (_, r) => formatMoney(r.debit !== 0 ? r.debit : r.credit),
    },
  ];
  const download = async () => {
    if (!filters.filter) return;
    if (isT) {
      const rows = await queryClient.fetchQuery({
        ...api.tAccountExport.queryOptions(reportInput.filter),
        staleTime: 0,
      });
      if (!rows.length) {
        notify.warning('该条件范围内没有单据输入，请调整范围后导出');
        return;
      }
      const total = reportTotals(rows);
      await exportToExcel({
        fileName: '丁字帐户',
        title: caption,
        columns: [
          { title: '日期', value: (r) => r.date },
          { title: '字号', value: (r) => r.displayNo },
          { title: '摘要', value: (r) => r.summary },
          { title: '科目编码', value: (r) => r.accountCode },
          { title: '科目名称', value: (r) => r.accountName },
          { title: '借方', value: (r) => reportExcelAmount(r.debit), money: true },
          { title: '贷方', value: (r) => reportExcelAmount(r.credit), money: true },
        ],
        rows: [
          ...rows,
          { date: '', displayNo: '', summary: '合计', accountCode: '', accountName: '', ...total },
        ],
      });
    } else {
      const rows = await queryClient.fetchQuery({
        ...api.summaryExport.queryOptions(reportInput),
        staleTime: 0,
      });
      await exportToExcel({
        fileName: '凭证科目汇总',
        title: caption,
        columns: [
          { title: '科目编码', value: (r) => r.code },
          { title: '名称', value: (r) => r.name },
          { title: '币种', value: (r) => r.currency },
          { title: '借方', value: (r) => reportExcelAmount(r.debit), money: true },
          { title: '贷方', value: (r) => reportExcelAmount(r.credit), money: true },
          { title: '原币借方', value: (r) => reportExcelAmount(r.fcDebit), money: true },
          { title: '原币贷方', value: (r) => reportExcelAmount(r.fcCredit), money: true },
        ],
        rows,
      });
    }
  };
  const debitRows = t.data?.filter((r) => r.debit !== 0) ?? [],
    creditRows = t.data?.filter((r) => r.credit !== 0) ?? [];
  const totals = reportTotals(t.data ?? []);
  const print = async () => {
    if (!filters.filter) return;
    setPrinting(true);
    try {
      const html = isT
        ? tAccountHtml(
            await queryClient.fetchQuery({
              ...api.tAccountPrint.queryOptions(reportInput.filter),
              staleTime: 0,
            }),
            caption,
          )
        : summaryHtml(
            await queryClient.fetchQuery({
              ...api.summaryPrint.queryOptions(reportInput),
              staleTime: 0,
            }),
            caption,
            foreign,
          );
      await printHtml({ title: isT ? '丁字帐户' : '凭证科目汇总', html, orientation: 'landscape' });
    } catch (error) {
      notify.warning(error instanceof Error ? error.message : '打印失败，请重试');
    } finally {
      setPrinting(false);
    }
  };
  return (
    <PageContainer
      title={isT ? '丁字帐户' : '凭证科目汇总'}
      subtitle="仅统计当前范围的凭证分录，剔除草稿和作废；原币按币种分别汇总，不含期初余额"
    >
      <Filters {...filters} />
      {(sum.isError || t.isError) && (
        <Alert type="error" title="查询失败" description={(sum.error ?? t.error)?.message} />
      )}
      <Space wrap style={{ margin: '12px 0' }}>
        <span>凭证范围</span>
        <Select
          aria-label="凭证范围"
          value={status}
          onChange={(v) => setting('scope', v)}
          options={[
            { value: 'filter', label: '按筛选状态' },
            { value: 'all', label: '全部' },
            { value: 'unposted', label: '未过账' },
            { value: 'posted', label: '已过账' },
          ]}
        />
        {!isT && (
          <>
            <Select
              aria-label="汇总级次"
              value={level}
              onChange={(v) => setting('level', v)}
              options={[
                { value: 'leaf', label: '明细科目' },
                { value: 'root', label: '一级科目' },
              ]}
            />
            <Checkbox
              checked={foreign}
              onChange={(e) => setting('foreign', e.target.checked ? '1' : '0')}
            >
              按币种展开原币
            </Checkbox>
          </>
        )}
        {canExport && (
          <Button
            onClick={() => void download()}
            disabled={!filters.filter || (isT && !filter.accountCode)}
          >
            导出当前范围
          </Button>
        )}
        {canPrint && (
          <Button
            loading={printing}
            disabled={!filters.filter || (isT && !filter.accountCode)}
            onClick={() => void print()}
          >
            打印当前范围
          </Button>
        )}
      </Space>
      <p>
        期间 {filter.periodFrom ?? '全部'} 至 {filter.periodTo ?? '全部'}；凭证类型{' '}
        {filter.voucherTypeId ?? '全部'}；号段 {filter.numberFrom ?? '不限'} 至{' '}
        {filter.numberTo ?? '不限'}
      </p>
      {isT ? (
        !filter.accountCode ? (
          <Alert title="必须先选择科目" type="info" />
        ) : (
          <>
            <Space align="start" style={{ width: '100%' }}>
              <div>
                <h4>借方 合计 {formatMoney(totals.debit)}</h4>
                <DataTable
                  scroll={{ x: undefined }}
                  style={{ maxWidth: '100%', overflowX: 'auto' }}
                  tableId="voucher-book.t.debit"
                  rowKey="id"
                  columns={tCols}
                  dataSource={debitRows}
                  loading={t.isLoading}
                />
              </div>
              <div>
                <h4>贷方 合计 {formatMoney(totals.credit)}</h4>
                <DataTable
                  scroll={{ x: undefined }}
                  style={{ maxWidth: '100%', overflowX: 'auto' }}
                  tableId="voucher-book.t.credit"
                  rowKey="id"
                  columns={tCols}
                  dataSource={creditRows}
                  loading={t.isLoading}
                />
              </div>
            </Space>
            {!t.isLoading && !t.data?.length && <Empty description="该条件范围内没有单据输入" />}
          </>
        )
      ) : (
        <DataTable
          tableId="voucher-book.summary"
          rowKey={(r) => `${r.code}:${r.currency}`}
          columns={sumCols}
          dataSource={sum.data ?? []}
          loading={sum.isLoading}
        />
      )}
    </PageContainer>
  );
}
