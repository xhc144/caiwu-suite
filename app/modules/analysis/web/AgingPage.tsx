import { memo, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { balanceSide, formatMoney, periodEndDate } from '@caiwu/core';
import {
  useAccounts,
  usePermission,
  useRequiredSession,
  queryClient,
  showError,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  ActionAlert,
  DataTable,
  FilterBar,
  PageContainer,
  type DataColumn,
} from '@caiwu/ui';
import {
  AgingFilterSchema,
  DEFAULT_BOUNDS,
  type AgingLot,
  type AgingReport,
  type AgingRow,
} from '../shared';
import { api } from './api';
import {
  downloadWorkbook,
  ledgerLink,
  NoPermission,
  printTable,
  ReportError,
  useReportFilters,
} from './common';

type FormValues = {
  accountId?: number;
  cutoff: string;
  bounds: string;
  direction: string;
  groupBy: string;
  includeUnposted: boolean;
  hideZero: boolean;
};
export default memo(AgingPage);

function AgingPage() {
  const session = useRequiredSession();
  const { byId, byCode } = useAccounts();
  const canView = usePermission('analysis.aging.view');
  const canEdit = usePermission('analysis.definition.edit');
  const canExport = usePermission('analysis.export');
  const [filters, setFilters] = useReportFilters({
    accountCode: '',
    cutoff: periodEndDate(session.book.startPeriod),
    bounds: '',
    direction: 'receivable',
    groupBy: 'partner',
    includeUnposted: false as boolean,
    hideZero: true as boolean,
  });
  const config = useQuery({ ...api.config.queryOptions(), enabled: canView });
  const bounds = filters.bounds
    ? filters.bounds.split(',').map((n) => (n.trim() === '' ? NaN : Number(n)))
    : (config.data?.bounds ?? DEFAULT_BOUNDS);
  const parsed = AgingFilterSchema.safeParse({ ...filters, bounds });
  const input = parsed.success ? parsed.data : { accountCode: '', cutoff: filters.cutoff };
  const query = useQuery({
    ...api.aging.queryOptions(input),
    enabled: canView && parsed.success && !config.isPending,
  });
  const [details, setDetails] = useState<AgingRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const save = useMutation(
    api.saveConfig.mutationOptions({
      onSuccess: (result) => queryClient.setQueryData(api.config.queryKey(), result),
    }),
  );
  const report = query.data;
  const doExport = async () => {
    if (!parsed.success) return;
    setExporting(true);
    try {
      const result = await queryClient.fetchQuery({
        ...api.exportAging.queryOptions(parsed.data),
        staleTime: 0,
      });
      queryClient.setQueryData(api.aging.queryKey(input), result.report);
      downloadWorkbook(result.base64, `账龄分析-${result.report.filter.cutoff}`);
    } finally {
      setExporting(false);
    }
  };
  const doPrint = async () => {
    if (!report) return;
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('aging'), staleTime: 0 });
    const amounts = (r: {
      buckets: number[];
      unaged: number;
      future: number;
      reverse: number;
      closing: number;
    }) => [...r.buckets, r.unaged, r.future, r.reverse, r.closing].map((n) => formatMoney(n));
    await printTable(
      '账龄分析',
      `截止 ${report.filter.cutoff}；${report.filter.includeUnposted ? '含未过账' : '仅已过账'}；${report.filter.direction === 'receivable' ? '应收' : '应付'}；借正贷负；本位币 ${report.baseCurrency}；快照 ${report.generatedAt}`,
      [
        '科目',
        '辅助项',
        '交易币种',
        ...report.bucketLabels,
        '期初未分龄',
        '未来业务日期',
        '反向余额',
        '同截止余额',
      ],
      [
        ...report.rows.map((r) => [r.accountCode, r.groupName, r.currency, ...amounts(r)]),
        ['合计', '', '', ...amounts(report.totals)],
      ],
    );
  };
  const columns: DataColumn<AgingRow>[] = [
    {
      key: 'account',
      title: '科目',
      width: 170,
      render: (_, r) => `${r.accountCode} ${r.accountName}`,
    },
    { key: 'group', title: '辅助项', dataIndex: 'groupName', width: 180 },
    { key: 'currency', title: '交易币种', dataIndex: 'currency', width: 90 },
    ...(report?.bucketLabels ?? []).map((title, i): DataColumn<AgingRow> => ({
      key: `bucket-${i}`,
      title,
      money: true,
      dataIndex: ['buckets', i],
    })),
    { key: 'unaged', title: '期初未分龄', dataIndex: 'unaged', money: true },
    { key: 'future', title: '未来业务日期', dataIndex: 'future', money: true },
    { key: 'reverse', title: '预收 / 预付（反向）', dataIndex: 'reverse', money: true },
    {
      key: 'closing',
      title: '同截止余额（借正贷负）',
      dataIndex: 'closing',
      width: 210,
      render: (_, r) => (
        <Button
          type="link"
          onClick={() => setDetails(r)}
          aria-label={`核销明细 ${r.groupName} ${r.currency}`}
        >
          {formatMoney(r.closing)}
        </Button>
      ),
    },
    {
      key: 'side',
      title: '余额方向',
      width: 90,
      render: (_, r) =>
        balanceSide(r.closing, filters.direction === 'payable' ? 'credit' : 'debit').side,
    },
    {
      key: 'detail',
      title: '操作',
      width: 100,
      render: (_, r) => report && <Link to={ledgerLink(r, report)}>明细账</Link>,
    },
  ];
  return (
    <PageContainer
      title="账龄分析"
      subtitle="按实际期初和分录计算 · FIFO 核销 · 同截止日总账核对"
      extra={<Link to="/m/analysis">科目分析</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <FilterBar<FormValues>
            key={`${JSON.stringify(filters)}-${config.data?.revision}-${byCode.get(filters.accountCode)?.id ?? ''}`}
            initialValues={{
              accountId: byCode.get(filters.accountCode)?.id,
              ...filters,
              bounds: bounds.join(','),
            }}
            onSearch={(v) =>
              setFilters({
                accountCode: v.accountId ? (byId.get(v.accountId)?.code ?? '') : '',
                cutoff: v.cutoff,
                bounds: v.bounds,
                direction: v.direction,
                groupBy: v.groupBy,
                includeUnposted: !!v.includeUnposted,
                hideZero: !!v.hideZero,
              })
            }
          >
            <Form.Item
              name="accountId"
              label="科目"
              rules={[{ required: true, message: '请选择科目' }]}
            >
              <AccountSelect leafOnly={false} includeDisabled style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="cutoff" label="截止日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="direction" label="往来方向">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'receivable', label: '应收' },
                  { value: 'payable', label: '应付' },
                ]}
              />
            </Form.Item>
            <Form.Item name="groupBy" label="按辅助项">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'partner', label: '客供' },
                  { value: 'project', label: '客供+项目' },
                  { value: 'department', label: '客供+部门' },
                  { value: 'person', label: '客供+个人' },
                  { value: 'none', label: '科目汇总' },
                ]}
              />
            </Form.Item>
            <Form.Item name="bounds" label="区间上限（天）" rules={[{ required: true }]}>
              <Input style={{ width: 220 }} placeholder="30,60,90,180,365" />
            </Form.Item>
            <Form.Item name="includeUnposted" valuePropName="checked">
              <Checkbox>包含未过账</Checkbox>
            </Form.Item>
            <Form.Item name="hideZero" valuePropName="checked">
              <Checkbox>余额为零隐藏</Checkbox>
            </Form.Item>
          </FilterBar>
          <Alert
            type="info"
            showIcon
            title="口径说明"
            description="凭证日期≤截止日才纳入；账龄天数=截止日−业务日期（未填取凭证日期），当日为0天，区间含两端且连续。先核销期初，再按业务日期先进先出；期初缺历史日期的残额单列未分龄。客供、末级科目、交易币种之间不互相核销；所有金额均折合本位币、借正贷负。未来业务日期和反向余额单列。账龄保留全部结转，便于核对原始总账。"
          />
          {config.isError && (
            <ReportError error={config.error} retry={() => void config.refetch()} />
          )}
          {filters.accountCode && !parsed.success && (
            <ActionAlert
              type="error"
              title="筛选条件无效"
              description={parsed.error.issues.map((e) => e.message).join('；')}
            />
          )}
          {!filters.accountCode && (
            <Alert type="info" title="请选择科目后查询账龄；可选择上级科目，系统只累计末级数据" />
          )}
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <Space wrap>
            {canEdit && (
              <Button
                disabled={!parsed.success || !config.data}
                loading={save.isPending}
                onClick={() =>
                  save.mutate({ bounds, expectedRevision: config.data?.revision ?? 0 })
                }
              >
                保存当前区间为默认
              </Button>
            )}
            {canExport && (
              <>
                <Button
                  disabled={!report || query.isFetching}
                  loading={exporting}
                  onClick={() => void doExport().catch(showError)}
                >
                  导出 Excel
                </Button>
                <Button
                  disabled={!report || query.isFetching}
                  onClick={() => void doPrint().catch(showError)}
                >
                  打印
                </Button>
              </>
            )}
            <Button
              disabled={!parsed.success}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              刷新分析
            </Button>
          </Space>
          {report && (
            <>
              <p data-testid="aging-reconciliation">
                同截止日总账：{formatMoney(report.totals.ledger)}；账龄合计：
                {formatMoney(report.totals.closing)}；核对差额：
                {formatMoney(report.totals.difference)}。快照：{report.generatedAt}
              </p>
              <span>
                已分龄：{formatMoney(report.totals.buckets.reduce((a, b) => a + b, 0))}
                ；期初未分龄：{formatMoney(report.totals.unaged)}；未来业务日期：
                {formatMoney(report.totals.future)}；反向余额：{formatMoney(report.totals.reverse)}
              </span>
            </>
          )}
          <DataTable<AgingRow>
            tableId="analysis.aging"
            rowKey="key"
            columns={columns}
            dataSource={report?.rows ?? []}
            loading={query.isFetching || config.isPending}
            locale={{
              emptyText: filters.accountCode
                ? '当前筛选没有往来余额，可调整日期、隐藏零余额或未过账选项'
                : '选择科目后查询',
            }}
          />
          {report && (
            <DataTable<AgingReport['controls'][number]>
              tableId="analysis.aging.control"
              rowKey="key"
              columns={[
                { key: 'account', title: '核对科目', dataIndex: 'accountCode', width: 100 },
                { key: 'group', title: '辅助项', dataIndex: 'groupName', width: 180 },
                {
                  key: 'allocated',
                  title: '各币种账龄有符号合计',
                  dataIndex: 'allocated',
                  money: true,
                },
                {
                  key: 'ledger',
                  title: '同截止日总账（非月末）',
                  dataIndex: 'ledger',
                  money: true,
                },
                { key: 'difference', title: '差额', dataIndex: 'difference', money: true },
              ]}
              dataSource={report.controls}
            />
          )}
          <Drawer
            title="FIFO 核销明细"
            open={!!details}
            onClose={() => setDetails(null)}
            size={900}
            destroyOnHidden
          >
            <p>
              {details?.groupName} · {details?.currency}
              。本表使用正向敞口：应收借方为正、应付贷方为正。负额为回款/付款或红字冲减，按业务日期核销最早敞口。核销后的负向残额为预收/预付；科目汇总仍按客供分别核销。期初优先；业务日期相同按凭证日期、凭证ID、行ID排序。
            </p>
            <DataTable<AgingLot>
              tableId="analysis.aging.lots"
              rowKey={(r, i) => String(r.lineId ?? `opening-${i}`)}
              columns={[
                { key: 'group', title: '核销组', dataIndex: 'groupName', width: 180 },
                {
                  key: 'voucher',
                  title: '凭证',
                  width: 110,
                  render: (_, r) =>
                    r.voucherId ? (
                      <Link to={`/m/voucher-entry/edit?id=${r.voucherId}`}>{r.voucherNo}</Link>
                    ) : (
                      '期初未分龄'
                    ),
                },
                { key: 'date', title: '凭证日期', dataIndex: 'date', width: 110 },
                { key: 'biz', title: '业务日期', dataIndex: 'bizDate', width: 110 },
                { key: 'amount', title: '原始正向金额', dataIndex: 'amount', money: true },
                { key: 'remaining', title: '核销后剩余敞口', dataIndex: 'remaining', money: true },
              ]}
              dataSource={details?.lots ?? []}
            />
          </Drawer>
        </>
      )}
    </PageContainer>
  );
}
