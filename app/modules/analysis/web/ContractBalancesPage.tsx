import { useState } from 'react';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatMoney, periodEndDate } from '@caiwu/core';
import { queryClient, showError, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { DataTable, DimensionSelect, FilterBar, PageContainer, type DataColumn } from '@caiwu/ui';
import { ContractFilterSchema } from '../contracts';
import { api } from './api';
import {
  downloadWorkbook,
  NoPermission,
  printTable,
  ReportError,
  useReportFilters,
} from './common';

export default function ContractBalancesPage() {
  const session = useRequiredSession();
  const start = `${Math.floor(session.book.startPeriod / 100)}-${String(session.book.startPeriod % 100).padStart(2, '0')}-01`;
  const canView = usePermission('analysis.contract.view');
  const canExport = usePermission('analysis.export');
  const [filters, setFilters] = useReportFilters({
    signedFrom: '1900-01-01',
    signedTo: '2099-12-31',
    from: start,
    to: periodEndDate(session.book.startPeriod),
    partnerId: 0,
    kind: 'all',
  });
  const parsed = ContractFilterSchema.safeParse({
    ...filters,
    partnerId: filters.partnerId || undefined,
  });
  const input = parsed.success
    ? parsed.data
    : { signedFrom: '1900-01-01', signedTo: '2099-12-31', from: start, to: start };
  const query = useQuery({
    ...api.contracts.report.queryOptions(input),
    enabled: canView && parsed.success,
  });
  const [exporting, setExporting] = useState(false);
  const report = query.data;
  const columns: DataColumn<NonNullable<typeof report>['rows'][number]>[] = [
    {
      key: 'code',
      title: '合同号',
      render: (_, r) => <Link to={`/m/analysis/contracts?id=${r.id}`}>{r.code}</Link>,
    },
    { key: 'name', title: '合同名称', dataIndex: 'name' },
    { key: 'partner', title: '客供', dataIndex: 'partnerName' },
    { key: 'signed', title: '签订日期', dataIndex: 'signed_date' },
    { key: 'kind', title: '类型', render: (_, r) => (r.kind === 'receipt' ? '收款' : '付款') },
    ...(['amount', 'opening', 'current', 'cumulative', 'remaining'] as const).map((key, i) => ({
      key,
      title: ['合同金额', '期初收付', '本期收付', '累计收付', '未完成金额'][i]!,
      dataIndex: key,
      money: true,
    })),
    { key: 'due', title: '到期日 / 逾期天数', render: () => '未知' },
    { key: 'description', title: '合同说明', dataIndex: 'description' },
  ];
  const doExport = async () => {
    if (!parsed.success) return;
    setExporting(true);
    try {
      const result = await queryClient.fetchQuery({
        ...api.contracts.export.queryOptions(parsed.data),
        staleTime: 0,
      });
      queryClient.setQueryData(api.contracts.report.queryKey(input), result.report);
      downloadWorkbook(result.base64, `合同账款-${result.report.filter.to}`);
    } finally {
      setExporting(false);
    }
  };
  const doPrint = async () => {
    if (!report) return;
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('contracts'), staleTime: 0 });
    await printTable(
      '合同账款查询',
      `收付 ${report.filter.from} 至 ${report.filter.to}；仅明确关联的已过账分录；期初截至启用日 ${report.openingDate}；本位币 ${report.baseCurrency}；原始到期日和逾期天数未知；快照 ${report.generatedAt}`,
      [
        '合同号',
        '名称',
        '客供',
        '合同金额',
        '期初收付',
        '本期收付',
        '累计收付',
        '未完成',
        '到期日',
      ],
      report.rows.map((r) => [
        r.code,
        r.name,
        r.partnerName,
        ...[r.amount, r.opening, r.current, r.cumulative, r.remaining].map((v) => formatMoney(v)),
        '未知',
      ]),
    );
  };
  return (
    <PageContainer
      title="合同账款查询"
      extra={<Link to="/m/analysis/contracts">合同档案管理</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <FilterBar<typeof filters>
            key={JSON.stringify(filters)}
            initialValues={{ ...filters, partnerId: filters.partnerId || undefined }}
            onSearch={(v) => setFilters({ ...v, partnerId: v.partnerId ?? 0 })}
          >
            <Form.Item name="signedFrom" label="签订开始">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="signedTo" label="签订结束">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="from" label="收付开始">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="to" label="收付截止">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="partnerId" label="客供">
              <DimensionSelect type="partner" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="kind" label="收付款类型">
              <Select
                style={{ width: 120 }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'receipt', label: '收款' },
                  { value: 'payment', label: '付款' },
                ]}
              />
            </Form.Item>
          </FilterBar>
          <Alert
            type="info"
            title="仅统计明确关联的整条已过账现金银行分录。累计=启用日前期初收付款+截至收付截止日的关联金额；未完成=合同金额−累计，超收付保留负数。原始到期日未知，无法计算逾期天数。签订日期与收付款期间分别筛选。"
          />
          {!parsed.success && (
            <Alert
              type="error"
              title="筛选条件无效"
              description={parsed.error.issues.map((i) => i.message).join('；')}
            />
          )}
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          {report && parsed.success && !query.isError && (
            <>
              <Space>
                <Button
                  disabled={!canExport || exporting}
                  aria-busy={exporting}
                  onClick={() => void doExport().catch(showError)}
                >
                  导出合同Excel
                </Button>
                <Button disabled={!canExport} onClick={() => void doPrint().catch(showError)}>
                  打印合同账款
                </Button>
              </Space>
              <p data-testid="contract-totals">
                合同金额：{formatMoney(report.totals.amount)}；本期收付：
                {formatMoney(report.totals.current)}；累计收付：
                {formatMoney(report.totals.cumulative)}；未完成：
                {formatMoney(report.totals.remaining)}
              </p>
              <DataTable
                tableId="analysis-contract-balances"
                rowKey="id"
                dataSource={report.rows}
                columns={columns}
                loading={query.isFetching}
              />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
