import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Button, Form, Select, Space, Typography } from 'antd';
import { formatMoney } from '@caiwu/core';
import { queryClient, usePermission } from '@caiwu/web-kit';
import {
  DataTable,
  DimensionSelect,
  FilterBar,
  PageContainer,
  PeriodPicker,
  exportToExcel,
  type DataColumn,
  type ExcelColumn,
} from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import { CASH_DENOMINATIONS } from '../shared';
import { PayrollReportInputSchema } from '../shared-report';
import { api } from './api';
import { usePayrollFilters } from './filters';
import type { PayrollPrintMode } from '../shared-print';
import type { PrintJob } from '@caiwu/print';
import PrintLayoutEditor from './PrintLayoutEditor';
import PayrollPrintPreview from './PayrollPrintPreview';
import { printPayrollJob } from './print-job';
type Filters = {
  category: number;
  additionalCategories: string;
  from: number;
  to: number;
  department: number;
  persons: string;
  columns: string;
  kind: string;
  cashField: string;
  denominations: string;
  run: number;
};
export default function ReportsPage() {
  const [values, set] = usePayrollFilters({
    category: 0,
    additionalCategories: '',
    from: 202601,
    to: 202601,
    department: 0,
    persons: '',
    columns: 'gross,deductions,taxAmount,net',
    kind: 'table',
    cashField: 'net',
    denominations: CASH_DENOMINATIONS.join(','),
    run: 0,
  });
  const text = JSON.stringify(values),
    filters = useMemo(() => JSON.parse(text) as Filters, [text]);
  const setter = useRef(set);
  setter.current = set;
  const update = useCallback((v: Partial<Filters>) => setter.current(v), []);
  return <ReportContent filters={filters} update={update} />;
}
const ReportContent = memo(function ReportContent({
  filters,
  update,
}: {
  filters: Filters;
  update: (v: Partial<Filters>) => void;
}) {
  const categories = useQuery(api.categories.queryOptions()),
    people = useQuery(api.salaryEmployees.queryOptions());
  const category = categories.data?.find(
    (c) => c.id === (filters.category || categories.data?.[0]?.id),
  );
  const selectedDenominations =
    filters.denominations === 'none'
      ? []
      : filters.denominations.split(',').filter(Boolean).map(Number);
  const candidate = {
    categoryId: category?.id ?? 1,
    additionalCategoryIds: filters.additionalCategories.split(',').filter(Boolean).map(Number),
    from: filters.from,
    to: filters.to,
    departmentId: filters.department || undefined,
    employeeIds: filters.persons.split(',').filter(Boolean).map(Number),
    columns: filters.columns === '[]' ? [] : filters.columns.split(',').filter(Boolean),
    kind: filters.kind,
    cashField: filters.cashField,
    denominations: filters.kind === 'cash' ? selectedDenominations : CASH_DENOMINATIONS,
  };
  const parsed = PayrollReportInputSchema.safeParse(candidate),
    input = parsed.success ? parsed.data : { ...candidate, kind: 'table' as const };
  const q = useQuery({
    ...api.report.queryOptions(input),
    enabled: parsed.success && filters.run > 0,
  });
  const canExport = usePermission('payroll.export'),
    data = q.data;
  const canConfigure = usePermission('payroll.salary.edit');
  const [printMode, setPrintMode] = useState<PayrollPrintMode>('table');
  const [configure, setConfigure] = useState(false),
    [preview, setPreview] = useState<{ job: PrintJob; pages: number } | null>(null);
  const [outputError, setOutputError] = useState(''),
    [working, setWorking] = useState(false);
  type Row = NonNullable<typeof data>['rows'][number];
  const columns: DataColumn<Row>[] = [
    { key: 'label', title: '人员 / 部门', dataIndex: 'label', width: 240 },
    { key: 'period', title: '期间', dataIndex: 'period', width: 180 },
    {
      key: 'categoryNames',
      title: '工资类别',
      width: 180,
      render: (_: unknown, row: Row) => row.categoryNames.join('、'),
      exportValue: (row: Row) => row.categoryNames.join('、'),
    },
    ...(data?.columns ?? []).map((c) => ({
      key: c.key,
      title: c.name,
      dataIndex: ['values', c.key],
      money: c.kind === 'money',
      render:
        c.kind === 'quantity'
          ? (_: unknown, row: Row) => row.quantities[c.key] ?? '0'
          : c.kind === 'basic'
            ? (_: unknown, row: Row) => row.basicValues[c.key] ?? ''
            : undefined,
      exportValue:
        c.kind === 'quantity'
          ? (row: Row) => row.quantities[c.key] ?? '0'
          : c.kind === 'basic'
            ? (row: Row) => row.basicValues[c.key] ?? ''
            : undefined,
    })),
    ...(filters.kind === 'cash'
      ? (data?.rows[0]?.notes ?? []).map((n) => ({
          key: `unit${n.unit}`,
          title: `${formatMoney(n.unit)}元（张）`,
          width: 110,
          render: (_: unknown, r: Row) => r.notes.find((x) => x.unit === n.unit)?.count ?? 0,
          exportValue: (r: Row) => r.notes.find((x) => x.unit === n.unit)?.count ?? 0,
        }))
      : []),
    ...(filters.kind === 'cash'
      ? [{ key: 'remainder', title: '余款', dataIndex: 'remainder', money: true }]
      : []),
  ];
  const output = async (print: boolean, showPreview = false) => {
    if (!parsed.success) return;
    if (print && filters.kind !== 'cash') {
      const fresh = await queryClient.fetchQuery({
        ...api.printReport.queryOptions({ report: parsed.data, mode: printMode }),
        staleTime: 0,
      });
      if (showPreview) setPreview(fresh);
      else await printPayrollJob(fresh.job);
      return;
    }
    const fresh = await queryClient.fetchQuery({
      ...api.exportReport.queryOptions(parsed.data),
      staleTime: 0,
    });
    const cols: ExcelColumn<Row>[] = [
      { title: '人员 / 部门', value: (r) => r.label },
      { title: '期间', value: (r) => r.period },
      { title: '工资类别', value: (r) => r.categoryNames.join('、') },
      ...(fresh.cashColumn ? [{ title: '票面工资栏目', value: () => fresh.cashColumn!.name }] : []),
      ...fresh.columns.map((c) => ({
        title: c.name,
        money: c.kind === 'money',
        value: (r: Row) =>
          c.kind === 'quantity'
            ? (r.quantities[c.key] ?? '0')
            : c.kind === 'basic'
              ? (r.basicValues[c.key] ?? '')
              : (r.values[c.key] ?? 0),
      })),
      ...(filters.kind === 'cash'
        ? (fresh.rows[0]?.notes ?? []).map((n) => ({
            title: `${formatMoney(n.unit)}元（张）`,
            value: (r: Row) => r.notes.find((x) => x.unit === n.unit)?.count ?? 0,
          }))
        : []),
      ...(filters.kind === 'cash'
        ? [{ title: '余款', money: true, value: (r: Row) => r.remainder }]
        : []),
    ];
    const title =
      {
        table: '工资表',
        department: '部门工资汇总表',
        cumulative: '人员累计汇总表',
        cash: '票面计算表',
      }[filters.kind] ?? '工资报表';
    if (!print) await exportToExcel({ fileName: title, columns: cols, rows: fresh.rows });
    else
      await printHtml({
        title,
        orientation: 'landscape',
        html: `<h3>${escapeHtml(title)}</h3><table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${fresh.rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(c.money ? formatMoney(c.value(r) as number) : c.value(r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      });
  };
  const runOutput = (print: boolean, showPreview = false) => {
    setWorking(true);
    setOutputError('');
    void output(print, showPreview)
      .catch((error: unknown) =>
        setOutputError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setWorking(false));
  };
  return (
    <PageContainer
      title="工资报表"
      subtitle="从真实计算快照汇总；仅所选人员和部门参与输出。"
      extra={<Link to="/m/payroll">返回工资管理</Link>}
    >
      <FilterBar
        key={category?.id}
        initialValues={{
          ...filters,
          category: category?.id,
          additionalCategoryIds: candidate.additionalCategoryIds,
          employeeIds: candidate.employeeIds,
          selectedColumns: candidate.columns,
          selectedDenominations,
        }}
        onSearch={(
          v: Filters & {
            employeeIds: number[];
            additionalCategoryIds: number[];
            selectedColumns: string[];
            selectedDenominations: number[];
          },
        ) =>
          update({
            category: v.category,
            additionalCategories: (v.additionalCategoryIds ?? []).join(','),
            from: v.from,
            to: v.to,
            department: v.department,
            kind: v.kind,
            persons: (v.employeeIds ?? []).join(','),
            columns: (v.selectedColumns ?? []).join(',') || '[]',
            cashField: v.cashField ?? filters.cashField,
            denominations: (v.selectedDenominations ?? selectedDenominations).join(',') || 'none',
            run: Date.now(),
          })
        }
      >
        <Form.Item name="category" label="类别">
          <Select
            style={{ width: 140 }}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="additionalCategoryIds" label="合并其它类别">
          <Select
            mode="multiple"
            aria-label="合并其它工资类别"
            style={{ minWidth: 220 }}
            options={(categories.data ?? [])
              .filter((c) => c.id !== category?.id)
              .map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="from" label="开始期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="department" label="部门">
          <DimensionSelect type="department" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="kind" label="报表">
          <Select
            style={{ width: 160 }}
            options={[
              { value: 'table', label: '工资表' },
              { value: 'department', label: '部门汇总' },
              { value: 'cumulative', label: '人员累计汇总' },
              { value: 'cash', label: '票面计算' },
            ]}
          />
        </Form.Item>
        <Form.Item name="employeeIds" label="所选人员">
          <Select
            mode="multiple"
            aria-label="报告人员"
            style={{ minWidth: 260 }}
            showSearch
            optionFilterProp="label"
            options={(people.data ?? []).map((e) => ({
              value: e.id,
              label: `${e.code} ${e.name}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="selectedColumns" label="汇总栏目">
          <Select
            mode="multiple"
            style={{ minWidth: 280 }}
            options={[
              { value: 'gross', label: '应发' },
              { value: 'deductions', label: '扣款' },
              { value: 'taxAmount', label: '个税' },
              { value: 'net', label: '实发' },
              ...(category?.fields ?? []).map((f) => ({ value: f.key, label: f.name })),
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(previous, next) => previous.kind !== next.kind}>
          {({ getFieldValue }) =>
            getFieldValue('kind') === 'cash' && (
              <>
                <Form.Item name="cashField" label="票面工资栏目">
                  <Select
                    style={{ width: 180 }}
                    options={[
                      { value: 'net', label: '实发' },
                      { value: 'gross', label: '应发' },
                      { value: 'deductions', label: '扣款' },
                      { value: 'taxAmount', label: '个税' },
                      ...(category?.fields ?? []).map((f) => ({ value: f.key, label: f.name })),
                    ]}
                  />
                </Form.Item>
                <Form.Item name="selectedDenominations" label="票面面额">
                  <Select
                    mode="multiple"
                    aria-label="票面面额"
                    style={{ minWidth: 280 }}
                    options={CASH_DENOMINATIONS.map((unit) => ({
                      value: unit,
                      label: `${formatMoney(unit)}元`,
                    }))}
                  />
                </Form.Item>
              </>
            )
          }
        </Form.Item>
      </FilterBar>
      {filters.run > 0 && !parsed.success && (
        <Alert type="error" title={parsed.error.issues.map((i) => i.message).join('；')} />
      )}
      {q.error && <Alert type="error" title={q.error.message} />}
      {outputError && <Alert type="error" title={outputError} />}
      {candidate.additionalCategoryIds.length > 0 && (
        <Alert
          type="info"
          title="合并报表累计所选类别的已计算快照；个税按各批次已分配税额相加，不重复计算累计扣除。自定义栏目须同名、同类型、同单位。"
        />
      )}
      {canExport && (
        <Space>
          <Button disabled={!data || !parsed.success || working} onClick={() => runOutput(false)}>
            导出报表 Excel
          </Button>
          {filters.kind !== 'cash' && (
            <>
              <label>
                输出格式{' '}
                <Select
                  aria-label="工资打印格式"
                  value={printMode}
                  style={{ width: 140 }}
                  options={[
                    { value: 'table', label: '工资表' },
                    { value: 'slips', label: '工资条' },
                    { value: 'summary', label: '工资汇总表' },
                  ]}
                  onChange={setPrintMode}
                />
              </label>
              {canConfigure && (
                <Button disabled={!category} onClick={() => setConfigure(true)}>
                  设置独立打印格式
                </Button>
              )}
              <Button
                disabled={!data || !parsed.success || working}
                onClick={() => runOutput(true, true)}
              >
                预览报表
              </Button>
            </>
          )}
          <Button disabled={!data || !parsed.success || working} onClick={() => runOutput(true)}>
            打印报表
          </Button>
        </Space>
      )}
      <DataTable<Row>
        tableId={`payroll.report.${filters.kind}`}
        rowKey="key"
        loading={q.isLoading && filters.run > 0}
        dataSource={data?.rows ?? []}
        columns={columns}
      />
      {data && (
        <Typography.Paragraph>
          合计：
          {data.columns
            .filter((c) => c.kind !== 'basic')
            .map(
              (c) =>
                `${c.name} ${c.kind === 'quantity' ? `${data.quantityTotals[c.key] ?? '0'}${c.unit}` : formatMoney(data.totals[c.key] ?? 0)}`,
            )
            .join('；')}
        </Typography.Paragraph>
      )}
      {data && (
        <Typography.Paragraph>
          来源批次：
          {data.sourceDetails.map((source) => (
            <Link key={source.batchId} to={`/m/payroll?id=${source.batchId}`}>
              {' '}
              {source.categoryName} {source.period}（批次{source.batchId}）{' '}
            </Link>
          ))}
        </Typography.Paragraph>
      )}
      {filters.kind === 'cash' && (
        <Alert
          type="info"
          title={`票面工资栏目：${data?.cashColumn?.name ?? '待查询'}。逐人逐期分解后合并，面额数量×面额＋余款＝所选栏目金额；负金额会阻止计算。此表不执行取现或银行发薪。`}
        />
      )}
      {configure && category && (
        <PrintLayoutEditor
          category={category}
          mode={printMode}
          onClose={() => setConfigure(false)}
        />
      )}
      {preview && <PayrollPrintPreview output={preview} onClose={() => setPreview(null)} />}
    </PageContainer>
  );
});
