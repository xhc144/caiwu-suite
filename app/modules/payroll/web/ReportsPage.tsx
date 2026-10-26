import { memo, useCallback, useMemo, useRef } from 'react';
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
import { ReportInputSchema } from '../shared';
import { api } from './api';
import { usePayrollFilters } from './filters';
type Filters = {
  category: number;
  from: number;
  to: number;
  department: number;
  persons: string;
  columns: string;
  kind: string;
  run: number;
};
export default function ReportsPage() {
  const [values, set] = usePayrollFilters({
    category: 0,
    from: 202601,
    to: 202601,
    department: 0,
    persons: '',
    columns: 'gross,deductions,taxAmount,net',
    kind: 'table',
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
  const candidate = {
    categoryId: category?.id ?? 1,
    from: filters.from,
    to: filters.to,
    departmentId: filters.department || undefined,
    employeeIds: filters.persons.split(',').filter(Boolean).map(Number),
    columns: filters.columns.split(',').filter(Boolean),
    kind: filters.kind,
  };
  const parsed = ReportInputSchema.safeParse(candidate),
    input = parsed.success ? parsed.data : { ...candidate, kind: 'table' as const };
  const q = useQuery({
    ...api.report.queryOptions(input),
    enabled: parsed.success && filters.run > 0,
  });
  const canExport = usePermission('payroll.export'),
    data = q.data;
  type Row = NonNullable<typeof data>['rows'][number];
  const columns: DataColumn<Row>[] = [
    { key: 'label', title: '人员 / 部门', dataIndex: 'label', width: 240 },
    { key: 'period', title: '期间', dataIndex: 'period', width: 180 },
    ...(data?.columns ?? []).map((c) => ({
      key: c.key,
      title: c.name,
      dataIndex: ['values', c.key],
      money: true,
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
  const output = async (print: boolean) => {
    if (!parsed.success) return;
    const fresh = await queryClient.fetchQuery({
      ...api.exportReport.queryOptions(parsed.data),
      staleTime: 0,
    });
    const cols: ExcelColumn<Row>[] = [
      { title: '人员 / 部门', value: (r) => r.label },
      { title: '期间', value: (r) => r.period },
      ...fresh.columns.map((c) => ({
        title: c.name,
        money: true,
        value: (r: Row) => r.values[c.key] ?? 0,
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
          employeeIds: candidate.employeeIds,
          selectedColumns: candidate.columns,
        }}
        onSearch={(v: Filters & { employeeIds: number[]; selectedColumns: string[] }) =>
          update({
            category: v.category,
            from: v.from,
            to: v.to,
            department: v.department,
            kind: v.kind,
            persons: (v.employeeIds ?? []).join(','),
            columns: (v.selectedColumns ?? []).join(','),
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
      </FilterBar>
      {filters.run > 0 && !parsed.success && (
        <Alert type="error" title={parsed.error.issues.map((i) => i.message).join('；')} />
      )}
      {q.error && <Alert type="error" title={q.error.message} />}
      {canExport && (
        <Space>
          <Button disabled={!data} onClick={() => void output(false)}>
            导出报表 Excel
          </Button>
          <Button disabled={!data} onClick={() => void output(true)}>
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
          {data.columns.map((c) => `${c.name} ${formatMoney(data.totals[c.key] ?? 0)}`).join('；')}
        </Typography.Paragraph>
      )}
      {data && (
        <Typography.Paragraph>
          来源批次：
          {data.sourceBatches.map((id) => (
            <Link key={id} to={`/m/payroll?id=${id}`}>
              {' '}
              {id}{' '}
            </Link>
          ))}
        </Typography.Paragraph>
      )}
      {filters.kind === 'cash' && (
        <Alert
          type="info"
          title="票面逐人分解后合并，面额数量×面额＋余款＝实发；负实发会阻止计算。此表不执行取现或银行发薪。"
        />
      )}
    </PageContainer>
  );
});
