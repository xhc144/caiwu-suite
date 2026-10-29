import { memo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { balanceSide, formatMoney } from '@caiwu/core';
import {
  queryClient,
  showError,
  useAccounts,
  usePermission,
  useRequiredSession,
  useHotkey,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  ActionAlert,
  DataTable,
  FilterBar,
  PageContainer,
  PeriodPicker,
  type DataColumn,
} from '@caiwu/ui';
import { SHORTCUT_NAMES, ShortcutSchema, TrendFilterSchema, type TrendRow } from '../shared';
import { api } from './api';
import AnalysisChart from './AnalysisChart';
import ResultEditor, { type ResultDraft } from './ResultEditor';
import {
  downloadWorkbook,
  NoPermission,
  printTable,
  ReportError,
  useReportFilters,
} from './common';

type FormValues = {
  accountId?: number;
  period: number;
  mode: string;
  metric: string;
  scope: string;
  includeUnposted: boolean;
  average: boolean;
  ratio: boolean;
};
export default memo(TrendPage);

function TrendPage() {
  const session = useRequiredSession();
  const { byId, byCode } = useAccounts();
  const canView = usePermission('analysis.view');
  const canEdit = usePermission('analysis.definition.edit');
  const canExport = usePermission('analysis.export');
  const [filters, setFilters] = useReportFilters({
    accountCode: '',
    period: session.book.startPeriod,
    mode: 'annual',
    metric: 'debit',
    scope: 'operating',
    includeUnposted: false as boolean,
    average: true as boolean,
    ratio: true as boolean,
  });
  const [kind, setKind] = useState<keyof typeof SHORTCUT_NAMES>('other');
  const shortcuts = useQuery({ ...api.shortcuts.queryOptions(), enabled: canView });
  const save = useMutation(
    api.saveShortcut.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: api.shortcuts.queryKey() }),
    }),
  );
  const parsed = TrendFilterSchema.safeParse(filters);
  const input = parsed.success
    ? parsed.data
    : { accountCode: '', period: session.book.startPeriod };
  const query = useQuery({ ...api.trend.queryOptions(input), enabled: canView && parsed.success });
  const report = query.data;
  const [exporting, setExporting] = useState(false);
  const [resultDraft, setResultDraft] = useState<ResultDraft>();
  const chartHost = useRef<HTMLDivElement>(null);
  useHotkey(
    'Ctrl+P',
    () => {
      const choice = chartHost.current?.querySelector<HTMLInputElement>('[aria-label="图形"]');
      choice?.scrollIntoView({ block: 'center' });
      choice?.focus();
    },
    { enabled: !resultDraft },
  );
  const metricName =
    filters.metric === 'balance'
      ? '期末余额'
      : filters.metric === 'credit'
        ? '贷方发生额'
        : '借方发生额';
  const chartLabels: string[] = [];
  const chartValues: number[] = [];
  if (report) {
    if (filters.mode === 'annual') {
      for (let i = 0; i < 12; i++) {
        if (!report.rows.some((r) => r.months[i] != null)) continue;
        chartLabels.push(`${i + 1}月`);
        chartValues.push(report.rows.reduce((n, r) => n + (r.months[i] ?? 0), 0));
      }
    } else
      for (const row of report.rows) {
        chartLabels.push(`${row.accountCode} ${row.accountName}`);
        chartValues.push(row.current);
      }
  }
  const trendLink = (r: TrendRow, month?: number) => {
    const p =
      month == null ? report!.filter.period : Math.trunc(report!.filter.period / 100) * 100 + month;
    const from =
      month == null && filters.mode === 'annual'
        ? Math.max(report!.startPeriod, Math.trunc(p / 100) * 100 + 1)
        : p;
    return `/m/ledgers/detail?${new URLSearchParams({ account: r.accountCode, from: String(from), to: String(month == null && filters.mode === 'annual' ? Math.trunc(p / 100) * 100 + 12 : p), dims: '{}', includeUnposted: filters.includeUnposted ? '1' : '0', excludeClosingKind: filters.scope === 'operating' ? 'pnl' : '' })}`;
  };
  const moneyLink = (r: TrendRow, amount: number, month?: number) => (
    <Link to={trendLink(r, month)}>{formatMoney(amount)}</Link>
  );
  const columns: DataColumn<TrendRow>[] = [
    { key: 'code', title: '科目编码', dataIndex: 'accountCode', width: 100 },
    { key: 'name', title: '科目名称', dataIndex: 'accountName', width: 180 },
    ...(filters.mode === 'annual'
      ? Array.from({ length: 12 }, (_, i): DataColumn<TrendRow> => ({
          key: `m-${i}`,
          title: `${i + 1}月`,
          width: 130,
          render: (_, r) =>
            r.months[i] == null ? '早于启用期间' : moneyLink(r, r.months[i]!, i + 1),
        }))
      : [
          {
            key: 'current',
            title: '本月数',
            width: 130,
            render: (_: unknown, r: TrendRow) => moneyLink(r, r.current),
          },
        ]),
    {
      key: 'ytd',
      title: filters.metric === 'balance' ? '末月余额（不累加余额）' : '本年累计',
      width: 190,
      render: (_, r) => moneyLink(r, r.ytd),
    },
    ...(filters.average
      ? [
          {
            key: 'average',
            title: '月均（四舍五入到分）',
            dataIndex: 'average',
            money: true,
            width: 170,
          },
        ]
      : []),
    ...(filters.ratio
      ? [
          {
            key: 'ratio',
            title: '占比',
            width: 190,
            render: (_: unknown, r: TrendRow) =>
              r.ratio == null ? '无法计算：基数为零' : `${r.ratio}%`,
          },
        ]
      : []),
    { key: 'ledger', title: '原始总账末月数', dataIndex: 'ledgerCurrent', money: true, width: 150 },
    {
      key: 'adjustment',
      title: '减：损益结转影响',
      dataIndex: 'pnlAdjustment',
      money: true,
      width: 160,
    },
    ...(filters.metric === 'balance'
      ? [
          {
            key: 'side',
            title: '余额方向',
            width: 90,
            render: (_: unknown, r: TrendRow) => balanceSide(r.current, r.direction).side,
          },
        ]
      : []),
  ];
  const doExport = async () => {
    if (!parsed.success) return;
    setExporting(true);
    try {
      const result = await queryClient.fetchQuery({
        ...api.exportTrend.queryOptions(parsed.data),
        staleTime: 0,
      });
      queryClient.setQueryData(api.trend.queryKey(input), result.report);
      downloadWorkbook(result.base64, `科目分析-${result.report.filter.period}`);
    } finally {
      setExporting(false);
    }
  };
  const doPrint = async () => {
    if (!report) return;
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
    const months =
      report.filter.mode === 'annual'
        ? Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
        : ['本月数'];
    await printTable(
      '科目分析',
      `${report.filter.period}；${metricName}；${report.filter.scope === 'operating' ? '经营分析：排除损益结转' : '原始总账'}；${report.filter.includeUnposted ? '含未过账' : '仅已过账'}；分母 ${formatMoney(report.denominator)}；快照 ${report.generatedAt}`,
      [
        '科目',
        '名称',
        ...months,
        '本年累计 / 末月余额',
        ...(filters.average ? ['月均'] : []),
        ...(filters.ratio ? ['占比'] : []),
        '总账末月数',
        '损益结转影响',
      ],
      report.rows.map((r) => [
        r.accountCode,
        r.accountName,
        ...(report.filter.mode === 'annual'
          ? r.months.map((n) => (n == null ? '早于启用期间' : formatMoney(n)))
          : [formatMoney(r.current)]),
        formatMoney(r.ytd),
        ...(filters.average ? [formatMoney(r.average)] : []),
        ...(filters.ratio ? [r.ratio == null ? '无法计算：基数为零' : `${r.ratio}%`] : []),
        formatMoney(r.ledgerCurrent),
        formatMoney(r.pnlAdjustment),
      ]),
    );
  };
  return (
    <PageContainer
      title="科目年度 / 月度分析"
      subtitle="末级科目真实发生和余额 · 可配置便捷入口"
      extra={<Link to="/m/analysis/aging">账龄分析</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <Space wrap>
            <label htmlFor="analysis-shortcut">便捷入口</label>
            <Select
              id="analysis-shortcut"
              aria-label="便捷入口"
              value={kind}
              style={{ width: 140 }}
              options={ShortcutSchema.options.map((value) => ({
                value,
                label: SHORTCUT_NAMES[value],
              }))}
              onChange={(value) => {
                setKind(value);
                const code = shortcuts.data?.find((s) => s.kind === value)?.account_code;
                setFilters({ accountCode: code ?? '' });
              }}
            />
            <span>
              {shortcuts.data?.find((s) => s.kind === kind)?.account_code ??
                '尚未配置，请选择本账套科目'}
            </span>
            {canEdit && (
              <Button
                disabled={!parsed.success}
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    kind,
                    accountCode: filters.accountCode,
                    expectedRevision: shortcuts.data?.find((s) => s.kind === kind)?.revision ?? 0,
                  })
                }
              >
                将当前科目用于此入口
              </Button>
            )}
          </Space>
          <FilterBar<FormValues>
            key={`${JSON.stringify(filters)}-${byCode.get(filters.accountCode)?.id ?? ''}`}
            initialValues={{ ...filters, accountId: byCode.get(filters.accountCode)?.id }}
            onSearch={(v) =>
              setFilters({
                period: v.period,
                mode: v.mode,
                metric: v.metric,
                scope: v.scope,
                accountCode: v.accountId ? (byId.get(v.accountId)?.code ?? '') : '',
                includeUnposted: !!v.includeUnposted,
                average: !!v.average,
                ratio: !!v.ratio,
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
            <Form.Item name="period" label="期间">
              <PeriodPicker />
            </Form.Item>
            <Form.Item name="mode" label="分析">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'annual', label: '年度 1–12月' },
                  { value: 'monthly', label: '所选月' },
                ]}
              />
            </Form.Item>
            <Form.Item name="metric" label="指标">
              <Select
                style={{ width: 120 }}
                options={[
                  { value: 'debit', label: '借方发生额' },
                  { value: 'credit', label: '贷方发生额' },
                  { value: 'balance', label: '余额' },
                ]}
              />
            </Form.Item>
            <Form.Item name="scope" label="口径">
              <Select
                style={{ width: 130 }}
                options={[
                  { value: 'operating', label: '经营分析' },
                  { value: 'ledger', label: '原始总账' },
                ]}
              />
            </Form.Item>
            <Form.Item name="includeUnposted" valuePropName="checked">
              <Checkbox>包含未过账</Checkbox>
            </Form.Item>
            <Form.Item name="average" valuePropName="checked">
              <Checkbox>月均</Checkbox>
            </Form.Item>
            <Form.Item name="ratio" valuePropName="checked">
              <Checkbox>比例</Checkbox>
            </Form.Item>
          </FilterBar>
          <Alert
            type="info"
            title="经营分析不含报告年度内的损益结转凭证，年初余额承接原始总账。"
            description="依据凭证的损益结转标记，不按摘要或来源猜测。期初原值保留；年中启用前的月度明细无法还原，显示说明。本年累计发生额含期初本年累计；发生额月均=本年累计÷截至月份数（年度为12），余额月均=可查询月份的月末余额平均；余额不逐月累加。占比=本行数÷所选末级科目合计（年度用本年累计，月度用本月数）。"
          />
          {filters.accountCode && !parsed.success && (
            <ActionAlert
              type="error"
              title="筛选条件无效"
              description={parsed.error.issues.map((e) => e.message).join('；')}
            />
          )}
          {!filters.accountCode && (
            <Alert type="info" title="请选择科目，或配置当前便捷入口后查询" />
          )}
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          {shortcuts.isError && (
            <ReportError error={shortcuts.error} retry={() => void shortcuts.refetch()} />
          )}
          <Space wrap>
            {canEdit && (
              <Button
                disabled={!report || query.isFetching}
                onClick={() => {
                  if (report)
                    void queryClient
                      .fetchQuery({
                        ...api.results.trend.queryOptions(report.filter),
                        staleTime: 0,
                      })
                      .then((sheet) =>
                        setResultDraft({
                          revision: 0,
                          name: `${report.filter.accountCode}-${report.filter.period}-${report.filter.mode === 'annual' ? '年度分析' : '月度分析'}`,
                          sheet,
                        }),
                      )
                      .catch(showError);
                }}
              >
                编辑并保存结果
              </Button>
            )}
            <Link to="/m/analysis/results">已保存分析结果</Link>
            <Link to="/m/analysis/custom">自定义分析表</Link>
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
              <p>
                当前指标：{metricName}；占比分母：{formatMoney(report.denominator)}；
                {report.denominator === 0
                  ? '无法计算：基数为零；请检查科目或期间'
                  : '按所选末级科目合计计算'}
                ；快照：{report.generatedAt}
              </p>
              <div ref={chartHost}>
                <AnalysisChart
                  labels={chartLabels}
                  values={chartValues}
                  title={`${filters.accountCode} ${filters.period} 科目分析图形`}
                  description={`${metricName}；${filters.scope === 'operating' ? '经营口径' : '原始总账'}；${filters.includeUnposted ? '包含未过账' : '仅已过账'}`}
                />
              </div>
            </>
          )}
          {resultDraft && (
            <ResultEditor initial={resultDraft} onClose={() => setResultDraft(undefined)} />
          )}
          <DataTable<TrendRow>
            tableId="analysis.trend"
            rowKey="accountCode"
            columns={columns}
            dataSource={report?.rows ?? []}
            loading={query.isFetching}
            locale={{ emptyText: '选择科目及期间后查询；无发生额的末级科目保留零值' }}
          />
        </>
      )}
    </PageContainer>
  );
}
