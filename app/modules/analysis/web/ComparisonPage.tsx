import { useState } from 'react';
import { Alert, Button, Checkbox, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  queryClient,
  showError,
  usePermission,
  useRequiredSession,
  useSubmission,
} from '@caiwu/web-kit';
import { PageContainer, PeriodPicker } from '@caiwu/ui';
import {
  ComparisonFilterSchema,
  comparisonValueText,
  METHOD_NAMES,
  type ComparisonOptions,
  type ComparisonReport,
} from '../comparison';
import { UNIT_NAMES } from '../custom';
import { api } from './api';
import { downloadWorkbook, NoPermission, printTable, ReportError } from './common';
import ComparisonPanel from './ComparisonPanel';

export default function ComparisonPage() {
  const canView = usePermission('analysis.view'),
    canExport = usePermission('analysis.export');
  const session = useRequiredSession();
  const definitions = useQuery({ ...api.definitions.list.queryOptions(), enabled: canView });
  const [definitionId, setDefinitionId] = useState<number>();
  const activeId = definitionId ?? definitions.data?.[0]?.id;
  const definition = useQuery({
    ...api.definitions.get.queryOptions({ id: activeId ?? 1 }),
    enabled: canView && activeId !== undefined,
  });
  const [method, setMethod] = useState<ComparisonOptions['method']>('trend');
  const [periodFrom, setFrom] = useState(session.book.startPeriod),
    [periodTo, setTo] = useState(session.book.startPeriod);
  const [baselinePeriod, setBaseline] = useState(session.book.startPeriod);
  const [granularity, setGranularity] = useState<ComparisonOptions['granularity']>('month');
  const [aggregation, setAggregation] = useState<ComparisonOptions['aggregation']>('ending');
  const [comparison, setComparison] = useState<ComparisonOptions['comparison']>('previousYear');
  const [trendMode, setTrendMode] = useState<ComparisonOptions['trendMode']>('absolute');
  const [denominatorKey, setDenominator] = useState<number>();
  const [scope, setScope] = useState<ComparisonOptions['scope']>('operating');
  const [includeUnposted, setUnposted] = useState(false);
  const [report, setReport] = useState<ComparisonReport>();
  const [error, setError] = useState<unknown>();
  const { submit, isSubmitting } = useSubmission();
  const calculate = () =>
    submit(async () => {
      const parsed = ComparisonFilterSchema.safeParse({
        definitionId: activeId,
        method,
        periodFrom: method === 'trend' ? periodFrom : periodTo,
        periodTo,
        baselinePeriod,
        granularity,
        aggregation,
        comparison,
        trendMode,
        denominatorKey,
        scope,
        includeUnposted,
      });
      if (!parsed.success) {
        setError(new Error(parsed.error.issues.map((i) => i.message).join('；')));
        return;
      }
      try {
        const result = await queryClient.fetchQuery({
          ...api.comparison.calculate.queryOptions(parsed.data),
          staleTime: 0,
        });
        setReport(result);
        setError(undefined);
      } catch (e) {
        setError(e);
      }
    });
  const exportReport = () =>
    submit(async () => {
      if (!report) return;
      const result = await queryClient.fetchQuery({
        ...api.comparison.export.queryOptions(report.filter),
        staleTime: 0,
      });
      setReport(result.report);
      downloadWorkbook(result.base64, result.report.title);
    });
  const print = () =>
    submit(async () => {
      if (!report) return;
      await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
      await printTable(
        report.title,
        `${report.note}；取数时间 ${report.generatedAt}`,
        [
          '项目编号',
          '项目',
          '单位',
          ...report.columns.flatMap((c) => [
            `${c.label}数值`,
            `${c.label}占比或指数%`,
            `${c.label}增减率%`,
            `${c.label}说明`,
          ]),
          '报告比基期增减',
        ],
        report.rows.map((row) => [
          row.key,
          row.name,
          UNIT_NAMES[row.unit],
          ...row.cells.flatMap((cell) => [
            cell.amount === null ? '未知' : comparisonValueText(cell.amount, row.decimalPlaces),
            cell.ratio ?? '无法计算',
            cell.growth ?? '无法计算',
            cell.reason ?? '',
          ]),
          row.difference === null ? '' : comparisonValueText(row.difference, row.decimalPlaces),
        ]),
      );
    });
  return (
    <PageContainer
      title="结构、比较与趋势分析"
      extra={<Link to="/m/analysis/custom">自定义分析表</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <Space wrap>
            <Select
              aria-label="方法分析表"
              placeholder="请选择分析表"
              value={activeId}
              onChange={(id) => {
                setDefinitionId(id);
                setDenominator(undefined);
              }}
              style={{ minWidth: 220 }}
              options={definitions.data?.map((d) => ({
                value: d.id,
                label: `${d.code} ${d.name}`,
              }))}
            />
            <Select
              aria-label="分析方法"
              value={method}
              onChange={setMethod}
              options={Object.entries(METHOD_NAMES).map(([value, label]) => ({ value, label }))}
            />
            {method === 'trend' && (
              <label>
                开始期间{' '}
                <PeriodPicker
                  aria-label="开始期间"
                  value={periodFrom}
                  onChange={(v) => v && setFrom(v)}
                />
              </label>
            )}
            <label>
              {method === 'trend' ? '结束期间' : '报告期间'}{' '}
              <PeriodPicker
                aria-label={method === 'trend' ? '结束期间' : '报告期间'}
                value={periodTo}
                onChange={(v) => v && setTo(v)}
              />
            </label>
            {method === 'structure' && (
              <Select
                aria-label="结构分析基数项目"
                placeholder="请选择基数项目"
                value={denominatorKey}
                onChange={setDenominator}
                style={{ minWidth: 220 }}
                options={definition.data?.rows.map((r) => ({
                  value: r.key,
                  label: `${r.key} ${r.name}（${UNIT_NAMES[r.unit]}）`,
                }))}
              />
            )}
            {method === 'comparison' && (
              <>
                <Select
                  aria-label="比较基期"
                  value={comparison}
                  onChange={setComparison}
                  options={[
                    { value: 'previousYear', label: '与上年同期' },
                    { value: 'specified', label: '与指定基期' },
                  ]}
                />
                {comparison === 'specified' && (
                  <label>
                    指定基期{' '}
                    <PeriodPicker
                      aria-label="指定基期"
                      value={baselinePeriod}
                      onChange={(v) => v && setBaseline(v)}
                    />
                  </label>
                )}
              </>
            )}
            {method === 'trend' && (
              <>
                <Select
                  aria-label="趋势间隔"
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: 'month', label: '月' },
                    { value: 'quarter', label: '季' },
                    { value: 'year', label: '年' },
                  ]}
                />
                <Select
                  aria-label="趋势比较方式"
                  value={trendMode}
                  onChange={setTrendMode}
                  options={[
                    { value: 'absolute', label: '绝对数比较' },
                    { value: 'fixed', label: '定基比较' },
                    { value: 'chain', label: '环比比较' },
                  ]}
                />
                <Select
                  aria-label="区间取数"
                  value={aggregation}
                  onChange={setAggregation}
                  options={[
                    { value: 'ending', label: '末期值（余额、比例）' },
                    { value: 'sum', label: '逐月合计（发生额）' },
                  ]}
                />
              </>
            )}
            <Select
              aria-label="方法分析口径"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'operating', label: '经营分析（排除损益结转）' },
                { value: 'ledger', label: '原始总账' },
              ]}
            />
            <Checkbox checked={includeUnposted} onChange={(e) => setUnposted(e.target.checked)}>
              包含未过账
            </Checkbox>
            <Button
              type="primary"
              loading={isSubmitting}
              disabled={!activeId}
              onClick={() => void calculate()}
            >
              开始方法分析
            </Button>
          </Space>
          <Alert
            type="info"
            title="季、年按完整自然区间展开；发生额可选逐月合计，余额与比例请选末期值。启用前数据和零基数比例均显示原因。"
          />
          {definitions.isError && (
            <ReportError error={definitions.error} retry={() => void definitions.refetch()} />
          )}
          {definition.isError && (
            <ReportError error={definition.error} retry={() => void definition.refetch()} />
          )}
          {!definitions.isFetching && definitions.data?.length === 0 && (
            <Alert type="info" title="还没有自定义分析表，请先新增并保存分析定义" />
          )}
          {error !== undefined && <ReportError error={error} retry={() => void calculate()} />}
          {report && (
            <>
              {canExport && (
                <Space>
                  <Button
                    loading={isSubmitting}
                    onClick={() => void exportReport().catch(showError)}
                  >
                    重新取数并导出 Excel
                  </Button>
                  <Button loading={isSubmitting} onClick={() => void print().catch(showError)}>
                    打印当前方法结果
                  </Button>
                </Space>
              )}
              <ComparisonPanel report={report} />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
