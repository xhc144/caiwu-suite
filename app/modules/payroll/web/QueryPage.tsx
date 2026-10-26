import { memo, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import { queryClient, usePermission } from '@caiwu/web-kit';
import {
  DataTable,
  FilterBar,
  MoneyInput,
  PageContainer,
  PeriodPicker,
  exportToExcel,
  type DataColumn,
} from '@caiwu/ui';
import { SalaryQuerySchema } from '../shared';
import { api } from './api';
import { usePayrollFilters } from './filters';
type Filters = { category: number; from: number; to: number; conditions: string; run: number };
export default function QueryPage() {
  const [values, set] = usePayrollFilters({
    category: 0,
    from: 202601,
    to: 202601,
    conditions: '[]',
    run: 0,
  });
  const text = JSON.stringify(values),
    filters = useMemo(() => JSON.parse(text) as Filters, [text]);
  const setter = useRef(set);
  setter.current = set;
  const update = useCallback((v: Partial<Filters>) => setter.current(v), []);
  return <QueryContent filters={filters} update={update} />;
}
const fields = [
  { value: 'code', label: '编号' },
  { value: 'name', label: '姓名' },
  { value: 'department', label: '部门' },
  { value: 'startDate', label: '任职日期' },
  { value: 'gross', label: '应发' },
  { value: 'deductions', label: '扣款' },
  { value: 'taxAmount', label: '个税' },
  { value: 'net', label: '实发' },
];
const textOps = [
    { value: 'contains', label: '含有' },
    { value: 'notContains', label: '不含有' },
    { value: 'equals', label: '等于' },
  ],
  numberOps = [
    { value: 'equals', label: '等于' },
    { value: 'gt', label: '大于' },
    { value: 'gte', label: '大于等于' },
    { value: 'lt', label: '小于' },
    { value: 'lte', label: '小于等于' },
  ];
const QueryContent = memo(function QueryContent({
  filters,
  update,
}: {
  filters: Filters;
  update: (v: Partial<Filters>) => void;
}) {
  const categories = useQuery(api.categories.queryOptions());
  const [form] = Form.useForm();
  const canExport = usePermission('payroll.export');
  let conditions: unknown = [],
    jsonError = false;
  try {
    conditions = JSON.parse(filters.conditions);
  } catch {
    jsonError = true;
  }
  const candidate = {
    categoryId: filters.category || categories.data?.[0]?.id || 1,
    from: filters.from,
    to: filters.to,
    conditions,
  };
  const parsed = SalaryQuerySchema.safeParse(candidate),
    input = parsed.success ? parsed.data : { ...candidate, conditions: [] };
  const q = useQuery({
    ...api.querySalary.queryOptions(input),
    enabled: !jsonError && parsed.success && filters.run > 0,
  });
  type Row = NonNullable<typeof q.data>[number];
  const columns: DataColumn<Row>[] = [
    { key: 'period', title: '期间', dataIndex: 'period', width: 100 },
    { key: 'code', title: '编号', dataIndex: ['employee', 'code'], width: 110 },
    { key: 'name', title: '姓名', dataIndex: ['employee', 'name'], width: 130 },
    { key: 'department', title: '部门', dataIndex: ['employee', 'departmentName'], width: 130 },
    ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map((key, i) => ({
      key,
      title: ['应发', '扣款', '个税', '实发'][i]!,
      dataIndex: key,
      money: true,
      sorter: (a: Row, b: Row) => (a[key] === b[key] ? 0 : a[key] > b[key] ? 1 : -1),
    })),
    {
      key: 'source',
      title: '来源批次',
      width: 110,
      render: (_, r) => <Link to={`/m/payroll?id=${r.batchId}`}>打开工资 {r.batchId}</Link>,
    },
  ];
  const output = async () => {
    if (!parsed.success || jsonError) return;
    const rows = await queryClient.fetchQuery({
      ...api.exportQuery.queryOptions(parsed.data),
      staleTime: 0,
    });
    await exportToExcel({
      fileName: '工资综合查询',
      columns: [
        { title: '期间', value: (r: Row) => r.period },
        { title: '编号', value: (r) => r.employee.code },
        { title: '姓名', value: (r) => r.employee.name },
        { title: '部门', value: (r) => r.employee.departmentName },
        ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map((key, i) => ({
          title: ['应发', '扣款', '个税', '实发'][i]!,
          money: true,
          value: (r: Row) => r[key],
        })),
      ],
      rows,
    });
  };
  return (
    <PageContainer
      title="工资综合查询"
      subtitle="仅使用允许的字段和操作符；无效条件会阻止执行并保留在地址中。所有条件按“并且”组合。"
      extra={<Link to="/m/payroll">返回工资管理</Link>}
    >
      <FilterBar
        key={candidate.categoryId}
        form={form}
        initialValues={{
          category: candidate.categoryId,
          from: filters.from,
          to: filters.to,
          conditions: parsed.success ? parsed.data.conditions : [],
        }}
        onSearch={(v: { category: number; from: number; to: number; conditions: unknown[] }) =>
          update({
            category: v.category,
            from: v.from,
            to: v.to,
            conditions: JSON.stringify(v.conditions ?? []),
            run: Date.now(),
          })
        }
        onReset={() => update({ conditions: '[]', run: 0 })}
      >
        <Form.Item name="category" label="类别">
          <Select
            style={{ width: 150 }}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="from" label="开始期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <PeriodPicker />
        </Form.Item>
        <Form.List name="conditions">
          {(items, { add, remove }) => (
            <Space orientation="vertical">
              {items.map((item) => (
                <Condition key={item.key} index={item.name} remove={() => remove(item.name)} />
              ))}
              <Button onClick={() => add({ field: 'name', operator: 'contains', value: '' })}>
                添加查询条件
              </Button>
            </Space>
          )}
        </Form.List>
      </FilterBar>
      {(jsonError || (!parsed.success && filters.run > 0)) && (
        <Alert
          type="error"
          title={
            jsonError
              ? '查询条件格式无效，原条件已保留；请修正或明确重置查询'
              : '查询条件不兼容：金额只允许数值比较，日期须为 YYYY-MM-DD；原条件已保留，请修正字段、操作符或值'
          }
        />
      )}
      {q.error && <Alert type="error" title={q.error.message} />}
      {canExport && (
        <Button disabled={!q.data || !parsed.success || jsonError} onClick={() => void output()}>
          导出查询 Excel
        </Button>
      )}
      <DataTable<Row>
        tableId="payroll.query"
        rowKey={(r) => `${r.batchId}:${r.employeeId}`}
        columns={columns}
        dataSource={parsed.success && !jsonError ? (q.data ?? []) : []}
        loading={q.isLoading && filters.run > 0}
      />
    </PageContainer>
  );
});
function Condition({ index, remove }: { index: number; remove: () => void }) {
  const form = Form.useFormInstance();
  const field = (Form.useWatch(['conditions', index, 'field'], form) ??
    form.getFieldValue(['conditions', index, 'field']) ??
    'name') as string;
  const isText = ['code', 'name', 'department'].includes(field ?? ''),
    isDate = field === 'startDate';
  return (
    <Space wrap>
      <Form.Item name={[index, 'field']} label="字段">
        <Select
          aria-label={`条件字段${index + 1}`}
          style={{ width: 130 }}
          options={fields}
          onChange={(value) => {
            const text = ['code', 'name', 'department'].includes(value);
            form.setFieldValue(['conditions', index, 'operator'], text ? 'contains' : 'equals');
            form.setFieldValue(
              ['conditions', index, 'value'],
              text ? '' : value === 'startDate' ? '2026-01-01' : 0,
            );
          }}
        />
      </Form.Item>
      <Form.Item name={[index, 'operator']} label="操作符">
        <Select
          aria-label={`条件操作符${index + 1}`}
          style={{ width: 130 }}
          options={isText ? textOps : numberOps}
        />
      </Form.Item>
      <Form.Item name={[index, 'value']} label="条件值">
        {isText ? (
          <Input aria-label={`条件值${index + 1}`} />
        ) : isDate ? (
          <Input type="date" aria-label={`条件值${index + 1}`} />
        ) : (
          <MoneyInput aria-label={`条件值${index + 1}`} />
        )}
      </Form.Item>
      <Button onClick={remove}>移除条件</Button>
    </Space>
  );
}
