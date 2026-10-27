import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  formatMoney,
  periodEndDate,
  VOUCHER_STATUS_LABELS,
  type VoucherLineInput,
} from '@caiwu/core';
import { queryClient, usePermission, useAccounts } from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  FilterBar,
  MoneyInput,
  PageContainer,
  PeriodPicker,
  exportToExcel,
  type DataColumn,
  type ExcelColumn,
} from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import {
  DEFAULT_FIELDS,
  TAX_RULE,
  TaxInputSchema,
  type Batch,
  type Category,
  type Employee,
  type Field,
  type Formula,
  type Mapping,
  type RowInput,
  type SalaryRow,
  type TaxInput,
} from '../shared';
import { api } from './api';
import { usePayrollFilters } from './filters';
import BulkDrawer from './BulkDrawer';

const refresh = () => queryClient.invalidateQueries({ queryKey: api.pathKey() });
function ErrorState({ error }: { error: { message: string } | null }) {
  return error ? <Alert type="error" showIcon title={error.message} /> : null;
}
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'a[href], [role=menuitem], [role=tab], .ant-tabs-tab-remove',
        ) &&
        !window.confirm('有工资资料未保存，确认离开并放弃修改？')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const keyboard = (e: KeyboardEvent) => {
      if (
        ((e.ctrlKey && e.key === 'F4') || (e.altKey && e.key === 'ArrowLeft')) &&
        !window.confirm('有未保存资料，确认离开并放弃修改？')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
}
export default function PayrollPage() {
  const path = useLocation().pathname;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Link to="/m/payroll">工资管理</Link>
        <Link to="/m/payroll/employees">人事档案</Link>
        <Link to="/m/payroll/structure">工资结构与公式</Link>
        <Link to="/m/payroll/tax">计税参数</Link>
        <Link to="/m/payroll/reports">工资报表</Link>
        <Link to="/m/payroll/query">工资综合查询</Link>
      </Space>
      {path.endsWith('/employees') ? (
        <Employees />
      ) : path.endsWith('/structure') ? (
        <Structure />
      ) : path.endsWith('/tax') ? (
        <TaxSettings />
      ) : (
        <Salaries />
      )}
    </Space>
  );
}
function Employees() {
  const [filters, setFilters] = usePayrollFilters({ keyword: '', department: 0 });
  const list = useQuery(api.employees.queryOptions());
  const canEdit = usePermission('payroll.hr.edit');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [department, setDepartment] = useState(false);
  const columns: DataColumn<Employee>[] = [
    { key: 'code', title: '人员编号', dataIndex: 'code', width: 120 },
    { key: 'name', title: '姓名', dataIndex: 'name', width: 120 },
    { key: 'dept', title: '部门', dataIndex: 'departmentName', width: 130 },
    { key: 'start', title: '任职日期', dataIndex: 'startDate', width: 120 },
    { key: 'end', title: '离职日期', dataIndex: 'endDate', width: 120 },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (_, r) => (r.disabled ? '停用' : r.endDate ? '已离职' : '在职'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 120,
      render: (_, r) => canEdit && <Button onClick={() => setEditing(r)}>修改 / 停用</Button>,
    },
  ];
  return (
    <PageContainer
      title="人事档案"
      subtitle="修改编号保留内部标识与历史；使用停用保留人员。无需录入证件号码。"
      extra={
        canEdit && (
          <>
            <Button onClick={() => setDepartment(true)}>新增部门</Button>
            <Button type="primary" onClick={() => setEditing('new')}>
              新增员工
            </Button>
          </>
        )
      }
    >
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item name="keyword" label="编号或姓名">
          <Input />
        </Form.Item>
        <Form.Item name="department" label="部门">
          <DimensionSelect type="department" style={{ width: 180 }} />
        </Form.Item>
      </FilterBar>
      <ErrorState error={list.error} />
      <DataTable
        tableId="payroll.employees"
        rowKey="id"
        columns={columns}
        loading={list.isLoading}
        dataSource={(list.data ?? []).filter(
          (e) =>
            (!filters.department || e.departmentId === filters.department) &&
            (!filters.keyword || `${e.code} ${e.name}`.includes(filters.keyword)),
        )}
      />
      {editing && <EmployeeEditor employee={editing} onClose={() => setEditing(null)} />}
      {department && <DepartmentEditor onClose={() => setDepartment(false)} />}
    </PageContainer>
  );
}
function DepartmentEditor({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<{ code: string; name: string }>();
  const save = useMutation(
    api.createDepartment.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        onClose();
      },
    }),
  );
  return (
    <Drawer
      open
      title="新增 core 部门"
      onClose={onClose}
      extra={
        <Button
          loading={save.isPending}
          onClick={() => void form.validateFields().then((v) => save.mutate(v))}
        >
          保存部门
        </Button>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="code" label="部门编码" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="name" label="部门名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
function EmployeeEditor({
  employee,
  onClose,
}: {
  employee: Employee | 'new';
  onClose: () => void;
}) {
  const [form] = Form.useForm<Employee>();
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  const save = useMutation(
    api.saveEmployee.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  const close = () => {
    if (!dirty || window.confirm('有未保存的人事资料，确认放弃？')) onClose();
  };
  return (
    <Drawer
      open
      title={employee === 'new' ? '新增员工' : '修改员工 / 编号'}
      size={520}
      onClose={close}
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() =>
            void form.validateFields().then((v) =>
              save.mutate({
                ...v,
                endDate: v.endDate || null,
                qualificationYear: v.qualificationYear ?? null,
                ...(employee === 'new' ? {} : { id: employee.id, revision: employee.revision }),
              }),
            )
          }
        >
          保存员工
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          employee === 'new'
            ? { startDate: '2026-01-01', taxKind: 'resident', policy: 'employment' }
            : employee
        }
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item
          name="code"
          label="人员编号"
          rules={[{ required: true, message: '请输入人员编号' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="departmentId" label="部门" rules={[{ required: true }]}>
          <DimensionSelect type="department" />
        </Form.Item>
        <Form.Item name="startDate" label="任职日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="endDate" label="离职日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="taxKind" label="所得类型">
          <Select
            options={[
              { value: 'resident', label: '居民普通工资薪金' },
              { value: 'nonresident', label: '非居民（不支持自动计税）' },
              { value: 'labor', label: '劳务（不支持）' },
              { value: 'bonus', label: '年终奖单独计税（不支持）' },
            ]}
          />
        </Form.Item>
        <Form.Item name="policy" label="减除费用方式">
          <Select
            options={[
              { value: 'employment', label: '5000元 × 本单位任职月份' },
              { value: 'annual60000', label: '全年6万元（2020年第19号条件）' },
              { value: 'firstIncome', label: '当年首次工资（2020年第13号条件）' },
            ]}
          />
        </Form.Item>
        <Alert
          title="优惠方式须按官方条件核对并逐年确认资格；不能仅凭备注启用。全年6万元要求上一完整年度每月同单位扣缴且全年工资不超6万元。首次工资方式要求当年入职前无工资或连续性劳务累计预扣记录。"
          type="info"
        />
        <Form.Item name="qualificationYear" label="资格适用年度">
          <InputNumber min={2019} max={2100} />
        </Form.Item>
        <Form.Item name="qualificationConfirmed" valuePropName="checked">
          <Checkbox>已核对资格与资料，选择该年度优惠方式</Checkbox>
        </Form.Item>
        <Form.Item name="disabled" valuePropName="checked">
          <Checkbox>停用（保留历史）</Checkbox>
        </Form.Item>
      </Form>
    </Drawer>
  );
}
function Structure() {
  const [filters, setFilters] = usePayrollFilters({ keyword: '' });
  const q = useQuery(api.categories.queryOptions());
  const canEdit = usePermission('payroll.salary.edit');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <PageContainer
      title="工资结构与公式"
      subtitle="栏目变量稳定，顺序即公式执行顺序；已使用栏目通过停用保留历史。"
      extra={
        canEdit && (
          <Button type="primary" onClick={() => setEditing('new')}>
            新增工资类别
          </Button>
        )
      }
    >
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item name="keyword" label="类别名称">
          <Input />
        </Form.Item>
      </FilterBar>
      <ErrorState error={q.error} />
      <DataTable<Category>
        tableId="payroll.structure"
        rowKey="id"
        loading={q.isLoading}
        dataSource={(q.data ?? []).filter((c) => c.name.includes(filters.keyword))}
        columns={[
          { key: 'name', title: '工资类别', dataIndex: 'name', width: 180 },
          {
            key: 'fields',
            title: '栏目',
            width: 340,
            render: (_, c) => c.fields.map((f) => `${f.name}(${f.key})`).join('、'),
          },
          { key: 'formulas', title: '公式数量', width: 100, render: (_, c) => c.formulas.length },
          {
            key: 'status',
            title: '状态',
            width: 100,
            render: (_, c) => (c.disabled ? '停用' : '启用'),
          },
          {
            key: 'actions',
            title: '操作',
            width: 120,
            render: (_, c) => canEdit && <Button onClick={() => setEditing(c)}>编辑结构</Button>,
          },
        ]}
      />
      {editing && <CategoryEditor category={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
function CategoryEditor({
  category,
  onClose,
}: {
  category: Category | 'new';
  onClose: () => void;
}) {
  const [form] = Form.useForm<Category>();
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  const save = useMutation(
    api.saveCategory.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer
      open
      size="large"
      title="工资栏目与公式定义"
      onClose={() => {
        if (!dirty || window.confirm('结构未保存，确认放弃？')) onClose();
      }}
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() =>
            void form.validateFields().then((v) =>
              save.mutate({
                ...v,
                ...(category === 'new' ? {} : { id: category.id, revision: category.revision }),
              }),
            )
          }
        >
          保存结构
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          category === 'new' ? { fields: DEFAULT_FIELDS, formulas: [], disabled: false } : category
        }
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item name="name" label="工资类别名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="disabled" valuePropName="checked">
          <Checkbox>停用类别</Checkbox>
        </Form.Item>
        <Typography.Title level={5}>栏目（按显示顺序）</Typography.Title>
        <Form.List name="fields">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space
                  key={f.key}
                  align="start"
                  wrap
                  style={{ borderBottom: '1px solid #ddd', paddingBottom: 8, marginBottom: 8 }}
                >
                  <Form.Item name={[f.name, 'key']} label="稳定变量" rules={[{ required: true }]}>
                    <Input style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'name']} label="栏目名称" rules={[{ required: true }]}>
                    <Input style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'kind']} label="类型">
                    <Select
                      style={{ width: 110 }}
                      options={[
                        { value: 'money', label: '金额录入' },
                        { value: 'calculated', label: '计算项' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'role']} label="计入">
                    <Select
                      style={{ width: 100 }}
                      options={[
                        { value: 'earning', label: '应发' },
                        { value: 'deduction', label: '扣款' },
                        { value: 'memo', label: '备查' },
                      ]}
                    />
                  </Form.Item>
                  {(['visible', 'print', 'carry', 'disabled'] as const).map((k, i) => (
                    <Form.Item
                      key={k}
                      name={[f.name, k]}
                      valuePropName="checked"
                      label={['显示', '打印', '传递', '停用'][i]}
                    >
                      <Checkbox />
                    </Form.Item>
                  ))}
                  <Popconfirm
                    title="确认移除栏目？已使用栏目请停用。"
                    onConfirm={() => remove(f.name)}
                  >
                    <Button danger>移除</Button>
                  </Popconfirm>
                </Space>
              ))}
              <Button
                onClick={() =>
                  add({
                    key: 'item',
                    name: '新栏目',
                    kind: 'money',
                    role: 'earning',
                    visible: true,
                    print: true,
                    carry: false,
                    disabled: false,
                  } satisfies Field)
                }
              >
                增加栏目
              </Button>
            </>
          )}
        </Form.List>
        <Typography.Title level={5}>安全基础公式</Typography.Title>
        <Alert
          type="info"
          title="仅支持稳定变量、数字、+ - * /、括号及 > < >= <= == !=；变量和结果单位为分，常数按分或倍数使用，如 base * 0.1。条件为非零时执行。日期函数尚未支持。个税由唯一内置引擎计算。"
        />
        <Form.List name="formulas">
          {(fields, { add, remove, move }) => (
            <>
              {fields.map((f) => (
                <div key={f.key} style={{ padding: 8, borderBottom: '1px solid #ddd' }}>
                  <Space wrap>
                    <Form.Item
                      name={[f.name, 'name']}
                      label="公式名称"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, 'target']}
                      label="目标变量"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                  </Space>
                  <Form.Item
                    name={[f.name, 'expression']}
                    label="来源表达式"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name={[f.name, 'condition']} label="执行条件">
                    <Input placeholder="留空表示总是执行" />
                  </Form.Item>
                  <Space>
                    <Form.Item name={[f.name, 'enabled']} valuePropName="checked">
                      <Checkbox>启用</Checkbox>
                    </Form.Item>
                    <Button disabled={f.name === 0} onClick={() => move(f.name, f.name - 1)}>
                      上移
                    </Button>
                    <Popconfirm title="删除该计算公式？" onConfirm={() => remove(f.name)}>
                      <Button danger>删除公式</Button>
                    </Popconfirm>
                  </Space>
                </div>
              ))}
              <Button
                onClick={() =>
                  add({
                    name: '',
                    target: '',
                    expression: '',
                    condition: '',
                    enabled: true,
                    tax: false,
                  } satisfies Formula)
                }
              >
                增加公式
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}
function TaxSettings() {
  const q = useQuery(api.taxConfig.queryOptions());
  const can = usePermission('payroll.tax.configure');
  const confirm = useMutation(api.confirmTax.mutationOptions({ onSuccess: () => void refresh() }));
  return (
    <PageContainer
      title="居民工资薪金累计预扣参数"
      subtitle={`参数版本 ${TAX_RULE.version} · 查证日期 ${TAX_RULE.checkedOn}`}
    >
      <FilterBar onSearch={() => void q.refetch()}>
        <Typography.Text>适用范围：居民普通工资薪金</Typography.Text>
      </FilterBar>
      <ErrorState error={q.error} />
      <Alert type="info" title={TAX_RULE.scope} />
      <p>
        月费用5000元按任职月份累计；符合资格的简便方式需在人事档案逐年显式确认。累计收入合并同人同年跨类别工资，累计扣除同月只享一次。历史已分配预扣额与本次计算额分别展示；月度负额留待年度处理，不自动退税。
      </p>
      <p>
        专项附加录入已确认的本单位年内累计金额，支持追补。2023年起婴幼儿/子女教育每名每月2000元、赡养老人每月3000元，分摊和资格有条件；本版不自动根据家庭资料推算额度。大病医疗只能年度汇算，不录入本工资预扣扣除。
      </p>
      <DataTable
        tableId="payroll.tax-rates"
        rowKey="limit"
        dataSource={[
          ['36000', '3%', '0'],
          ['144000', '10%', '2520'],
          ['300000', '20%', '16920'],
          ['420000', '25%', '31920'],
          ['660000', '30%', '52920'],
          ['960000', '35%', '85920'],
          ['以上', '45%', '181920'],
        ].map(([limit, rate, quick]) => ({ limit, rate, quick }))}
        columns={[
          { key: 'limit', title: '累计应纳税所得额上限（元）', dataIndex: 'limit', width: 240 },
          { key: 'rate', title: '预扣率', dataIndex: 'rate', width: 140 },
          { key: 'quick', title: '速算扣除（元）', dataIndex: 'quick', width: 180 },
        ]}
      />
      {TAX_RULE.sources.map((s) => (
        <p key={s.docNo}>
          <a href={s.sourceUrl} target="_blank" rel="noreferrer">
            {s.docNo}
          </a>{' '}
          · 施行 {s.effectiveFrom}
        </p>
      ))}
      <Tag color={q.data?.confirmed ? 'green' : 'orange'}>
        {q.data?.confirmed ? '本账套已确认参数' : '本账套未确认，自动计税被阻止'}
      </Tag>
      {can && (
        <Popconfirm
          title="已核对来源、适用居民身份、所得类型和参数范围？"
          onConfirm={() => confirm.mutate()}
        >
          <Button loading={confirm.isPending}>确认本账套计税参数</Button>
        </Popconfirm>
      )}
    </PageContainer>
  );
}
type SalaryFilters = {
  period: number;
  category: number;
  id: number;
  department: number;
  person: string;
};
function Salaries() {
  const independent = useLocation().pathname.endsWith('/batch');
  const [values, setValues] = usePayrollFilters({
    period: 202601,
    category: 0,
    id: 0,
    department: 0,
    person: '',
  });
  const snapshot = JSON.stringify(values);
  const stable = useMemo(() => JSON.parse(snapshot) as SalaryFilters, [snapshot]);
  const setter = useRef(setValues);
  setter.current = setValues;
  const onFilters = useCallback((next: Partial<SalaryFilters>) => setter.current(next), []);
  return <SalaryContent filters={stable} setFilters={onFilters} independent={independent} />;
}
// 隔离 W0 标签页标题回调的重复父渲染，避免表格布局状态被反复触发。共享壳修复另列 PR。
const SalaryContent = memo(function SalaryContent({
  filters,
  setFilters,
  independent,
}: {
  independent: boolean;
  filters: SalaryFilters;
  setFilters: (next: Partial<SalaryFilters>) => void;
}) {
  const list = useQuery(
    api.batches.queryOptions({
      period: filters.period || undefined,
      categoryId: filters.category || undefined,
    }),
  );
  const categories = useQuery(api.categories.queryOptions());
  const detail = useQuery({
    ...api.batch.queryOptions({ id: filters.id || 1 }),
    enabled: !!filters.id,
  });
  const canEdit = usePermission('payroll.salary.edit'),
    canCalculate = usePermission('payroll.salary.calculate'),
    canVoucher = usePermission('payroll.voucher'),
    canExport = usePermission('payroll.export');
  const [bulkOpen, setBulkOpen] = useState(false);
  const canClose = usePermission('payroll.close'),
    canReopen = usePermission('payroll.reopen');
  const close = useMutation(api.close.mutationOptions({ onSuccess: () => void refresh() }));
  const reopen = useMutation(api.reopen.mutationOptions({ onSuccess: () => void refresh() }));
  const [editing, setEditing] = useState<Batch | 'new' | null>(null),
    [voucher, setVoucher] = useState(false),
    [selected, setSelected] = useState<number[]>([]),
    [explaining, setExplaining] = useState<SalaryRow | null>(null);
  const calculate = useMutation(api.calculate.mutationOptions({ onSuccess: () => void refresh() }));
  const b = detail.data;
  const rows = (b?.snapshots ?? []).filter(
    (r) =>
      (!filters.department || r.employee.departmentId === filters.department) &&
      (!filters.person || `${r.employee.code} ${r.employee.name}`.includes(filters.person)),
  );
  const output = async (mode: 'excel' | 'print') => {
    if (!b) return;
    const data = await queryClient.fetchQuery({
      ...api.exportRows.queryOptions({
        id: b.id,
        employeeIds: selected.filter((id) => rows.some((r) => r.employeeId === id)),
      }),
      staleTime: 0,
    });
    const columns: ExcelColumn<SalaryRow>[] = [
      { title: '编号', value: (r: SalaryRow) => r.employee.code },
      { title: '姓名', value: (r: SalaryRow) => r.employee.name },
      { title: '部门', value: (r: SalaryRow) => r.employee.departmentName },
      ...data.category.fields
        .filter((f) => f.print && !f.disabled)
        .map((f) => ({
          title: f.name,
          money: true,
          value: (r: SalaryRow) => r.calculatedValues[f.key] ?? 0,
        })),
      ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map((k, i) => ({
        title: ['应发', '扣款', '个税', '实发'][i]!,
        money: true,
        value: (r: SalaryRow) => r[k],
      })),
    ];
    if (mode === 'excel')
      await exportToExcel({ fileName: `工资条-${data.period}`, columns, rows: data.rows });
    else
      await printHtml({
        title: `工资条 ${data.period}`,
        html: data.rows
          .map(
            (r) =>
              `<h3>${data.period} ${escapeHtml(data.category.name)} 工资条</h3><table>${columns.map((c) => `<tr><th>${escapeHtml(c.title)}</th><td>${escapeHtml(c.money ? formatMoney(c.value(r) as number) : c.value(r))}</td></tr>`).join('')}</table>`,
          )
          .join('<hr>'),
      });
  };
  const columns: DataColumn<SalaryRow>[] = [
    { key: 'code', title: '编号', dataIndex: ['employee', 'code'], width: 110 },
    { key: 'name', title: '姓名', dataIndex: ['employee', 'name'], width: 110 },
    { key: 'dept', title: '部门', dataIndex: ['employee', 'departmentName'], width: 110 },
    ...(b?.category.fields ?? [])
      .filter((f) => f.visible && !f.disabled)
      .map((f) => ({
        key: f.key,
        title: f.name,
        dataIndex: ['calculatedValues', f.key],
        money: true,
      })),
    ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map((k, i) => ({
      key: k,
      title: ['应发', '扣款', '个税', '实发'][i]!,
      dataIndex: k,
      money: true,
    })),
    {
      key: 'detail',
      title: '计算说明',
      width: 120,
      render: (_, r) => <Button onClick={() => setExplaining(r)}>查看解释</Button>,
    },
  ];
  return (
    <PageContainer
      title="工资管理"
      subtitle="工资批次仅计算及制证；无银行付款或税务申报操作。"
      extra={
        canEdit && (
          <Button type="primary" onClick={() => setEditing('new')}>
            新增工资批次
          </Button>
        )
      }
    >
      {!independent && (
        <>
          <FilterBar initialValues={filters} onSearch={(v) => setFilters({ ...v, id: 0 })}>
            <Form.Item name="period" label="期间">
              <PeriodPicker />
            </Form.Item>
            <Form.Item name="category" label="类别">
              <Select
                allowClear
                style={{ width: 140 }}
                options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
            <Form.Item name="department" label="部门">
              <DimensionSelect type="department" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="person" label="人员">
              <Input placeholder="编号或姓名" />
            </Form.Item>
          </FilterBar>
          <ErrorState error={list.error ?? detail.error ?? categories.error} />
          <DataTable
            tableId="payroll.batches"
            rowKey="id"
            loading={list.isLoading}
            dataSource={list.data ?? []}
            columns={[
              { key: 'id', title: '批次', dataIndex: 'id', width: 90 },
              { key: 'period', title: '期间', dataIndex: 'period', width: 110 },
              {
                key: 'category',
                title: '工资类别',
                width: 160,
                render: (_, r) => categories.data?.find((c) => c.id === r.category_id)?.name,
              },
              {
                key: 'state',
                title: '状态',
                width: 130,
                render: (_, r) => (r.closed ? '已结账' : r.calculated ? '已计算' : '待计算'),
              },
              {
                key: 'open',
                title: '操作',
                width: 120,
                render: (_, r) => (
                  <Button
                    onClick={() => {
                      setFilters({ id: r.id });
                      setSelected([]);
                    }}
                  >
                    打开工资
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      {independent && <ErrorState error={detail.error} />}
      {independent && !filters.id && (
        <Alert type="warning" title="缺少工资批次编号，请返回工资管理选择批次" />
      )}
      {detail.isFetching && <Spin />}
      {b && (
        <>
          <Typography.Title level={5}>
            {b.period} {b.category.name} · 批次 {b.id} ·{' '}
            {b.closed
              ? '已结账'
              : b.vouchers.length
                ? '已锁定'
                : b.calculated
                  ? '已计算'
                  : '待计算'}
          </Typography.Title>
          <Space wrap style={{ marginBottom: 12 }}>
            {canEdit && !b.vouchers.length && !b.closed && (
              <Button onClick={() => setEditing(b)}>编辑工资</Button>
            )}
            {canCalculate && !b.vouchers.length && !b.closed && (
              <Button
                loading={calculate.isPending}
                onClick={() => calculate.mutate({ id: b.id, revision: b.revision })}
              >
                计算工资
              </Button>
            )}
            {canEdit && !b.vouchers.length && !b.closed && (
              <Button onClick={() => setBulkOpen(true)}>统一置数 / 粘贴</Button>
            )}
            {canClose && !b.closed && (
              <Popconfirm
                title="确认冻结本期工资并按传递栏目建立下月？"
                onConfirm={() => close.mutate({ id: b.id, revision: b.revision, confirmed: true })}
              >
                <Button loading={close.isPending}>工资结账</Button>
              </Popconfirm>
            )}
            {canReopen && b.closed && (
              <Popconfirm
                title="确认仅回退最近已结月份及未修改的下月传递数据？"
                onConfirm={() => reopen.mutate({ id: b.id, revision: b.revision, confirmed: true })}
              >
                <Button loading={reopen.isPending}>工资反结账</Button>
              </Popconfirm>
            )}
            {canVoucher && <Button onClick={() => setVoucher(true)}>凭证设置与生成</Button>}
            {canExport && (
              <>
                <Button onClick={() => void output('excel')}>导出所选工资条</Button>
                <Button onClick={() => void output('print')}>打印所选工资条</Button>
              </>
            )}
            {b.vouchers.map((v) => (
              <Link key={v.kind} to={`/m/voucher-entry/edit?id=${v.id}`}>
                {v.kind === 'payment' ? '发放' : '分配'}凭证 {v.number}（
                {VOUCHER_STATUS_LABELS[v.status as keyof typeof VOUCHER_STATUS_LABELS]}）
              </Link>
            ))}
          </Space>
          {!b.calculated && <Alert type="info" title="工资已保存，计算后显示工资及税额快照。" />}
          {b.previous.length > 0 && (
            <>
              <Typography.Title level={5}>
                重算前后对照{!b.calculated ? '（当前修改待重算）' : ''}
              </Typography.Title>
              <DataTable<SalaryRow>
                tableId="payroll.comparison"
                rowKey="employeeId"
                dataSource={b.previous}
                columns={[
                  { key: 'name', title: '人员', dataIndex: ['employee', 'name'], width: 120 },
                  ...(['gross', 'deductions', 'taxAmount', 'net'] as const).flatMap((key, i) => [
                    {
                      key: `old_${key}`,
                      title: `原${['应发', '扣款', '个税', '实发'][i]}`,
                      dataIndex: key,
                      money: true,
                    },
                    {
                      key: `new_${key}`,
                      title: `现${['应发', '扣款', '个税', '实发'][i]}`,
                      money: true,
                      render: (_: unknown, row: SalaryRow) => {
                        const current = b.snapshots.find((r) => r.employeeId === row.employeeId);
                        return current ? formatMoney(current[key]) : '待重算 / 已移除';
                      },
                    },
                  ]),
                ]}
              />
            </>
          )}
          <DataTable<SalaryRow>
            tableId="payroll.salary"
            rowKey="employeeId"
            dataSource={rows}
            columns={columns}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys.map(Number)),
            }}
          />
        </>
      )}
      {editing && (
        <BatchEditor
          batch={editing}
          categories={categories.data ?? []}
          defaultPeriod={b?.period ?? filters.period}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setFilters({ id });
            void refresh();
            setEditing(null);
          }}
        />
      )}
      {bulkOpen && b && (
        <BulkDrawer
          batch={b}
          selected={selected}
          onClose={() => setBulkOpen(false)}
          onSaved={() => void refresh()}
        />
      )}
      {voucher && b && <VoucherEditor key={b.id} batch={b} onClose={() => setVoucher(false)} />}
      {explaining && (
        <Drawer
          open
          title={`${explaining.employee.name} 累计预扣解释`}
          size={580}
          onClose={() => setExplaining(null)}
        >
          <p>同一账套为同一扣缴单位；历史批次的预扣分配额不代表已经向税务机关缴纳。</p>
          <Descriptions
            column={1}
            bordered
            items={Object.entries(explaining.detail).map(([key, value]) => ({
              key,
              label:
                (
                  {
                    version: '税参数版本',
                    income: '累计收入',
                    exempt: '累计免税',
                    months: '任职月数',
                    expense: '累计费用',
                    special: '累计专项',
                    additional: '累计专项附加',
                    other: '累计其他',
                    taxable: '累计应纳税所得额',
                    rate: '预扣率',
                    quick: '速算扣除',
                    relief: '累计减免',
                    cumulativeTax: '累计应预扣税额',
                    openingTax: '期初已扣税',
                    allocatedTax: '历史批次已分配预扣',
                    alreadyWithheld: '累计已扣/分配',
                    currentTax: '本次预扣',
                    refundDeferred: '负额暂不退税',
                  } as Record<string, string>
                )[key] ?? key,
              children:
                typeof value === 'number' && key !== 'months' ? formatMoney(value) : String(value),
            }))}
          />
          {explaining.formulaDetails.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </Drawer>
      )}
    </PageContainer>
  );
});
const taxLabels: Record<keyof Omit<TaxInput, 'confirmed'>, string> = {
  exempt: '本批免税收入',
  special: '累计专项扣除',
  additional: '累计专项附加（不含大病医疗）',
  other: '累计其他扣除',
  relief: '累计减免税额',
  openingIncome: '本年本单位系统外期初收入',
  openingTax: '本年本单位系统外已扣税',
};
function BatchEditor({
  batch,
  categories,
  defaultPeriod,
  onClose,
  onSaved,
}: {
  batch: Batch | 'new';
  categories: Category[];
  defaultPeriod: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const employees = useQuery(api.salaryEmployees.queryOptions());
  const [categoryId, setCategoryId] = useState(
    batch === 'new' ? categories.find((c) => !c.disabled)?.id : batch.categoryId,
  );
  const category = categories.find((c) => c.id === categoryId);
  const [period, setPeriod] = useState(batch === 'new' ? defaultPeriod : batch.period);
  const [rows, setRows] = useState<RowInput[]>(batch === 'new' ? [] : batch.rows);
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  const inFlight = useRef(false),
    mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = useMutation(
    api.saveBatch.mutationOptions({
      onSuccess: (b) => {
        void refresh();
        if (mounted.current) {
          setDirty(false);
          onSaved(b.id);
        }
      },
      onSettled: () => {
        inFlight.current = false;
        if (mounted.current) setSaving(false);
      },
    }),
  );
  const patch = (index: number, fn: (r: RowInput) => RowInput) => {
    if (inFlight.current) return;
    setRows((old) => old.map((r, i) => (i === index ? fn(r) : r)));
    setDirty(true);
  };
  const submit = () => {
    if (!category || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    save.mutate({
      ...(batch === 'new' ? {} : { id: batch.id, revision: batch.revision }),
      period,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows,
    });
  };
  return (
    <Drawer
      open
      title={batch === 'new' ? '新增工资批次' : '编辑工资'}
      size="large"
      closable={!saving}
      keyboard={!saving}
      onClose={() => {
        if (inFlight.current) return;
        if (!dirty || window.confirm('工资尚未保存，确认放弃修改？')) onClose();
      }}
      extra={
        <Button type="primary" disabled={saving} loading={save.isPending} onClick={submit}>
          保存工资
        </Button>
      }
    >
      <ErrorState error={employees.error} />
      <ErrorState error={save.error} />
      <Space wrap>
        <label>
          工资期间{' '}
          <PeriodPicker
            aria-label="工资期间"
            value={period}
            disabled={saving || batch !== 'new'}
            onChange={(v) => {
              if (inFlight.current) return;
              setPeriod(v);
              setDirty(true);
            }}
          />
        </label>
        <label>
          工资类别{' '}
          <Select
            aria-label="工资类别"
            value={categoryId}
            disabled={saving || batch !== 'new'}
            style={{ width: 160 }}
            options={categories
              .filter((c) => !c.disabled)
              .map((c) => ({ value: c.id, label: c.name }))}
            onChange={(id) => {
              if (inFlight.current) return;
              setCategoryId(id);
              setRows([]);
              setDirty(true);
            }}
          />
        </label>
      </Space>
      <p>
        <label>
          添加人员{' '}
          <Select<number>
            aria-label="添加人员"
            disabled={saving}
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            value={undefined}
            placeholder="选择编号、姓名、部门"
            options={(employees.data ?? [])
              .filter((e) => !e.disabled && !rows.some((r) => r.employeeId === e.id))
              .map((e) => ({ value: e.id, label: `${e.code} ${e.name} ${e.departmentName}` }))}
            onChange={(id) => {
              if (inFlight.current) return;
              setRows([...rows, { employeeId: id, values: {}, tax: TaxInputSchema.parse({}) }]);
              setDirty(true);
            }}
          />
        </label>
      </p>
      <Alert
        type="info"
        title="专项/附加/其他/减免是本单位本年截至本月累计数；期初只填本单位未进入本系统的当年历史，不含系统内批次或其他单位。税前专项扣除与工资个人扣款分别录入。同月跨类别累计扣除须一致。"
      />
      {rows.map((r, i) => (
        <div key={r.employeeId} style={{ border: '1px solid #ddd', padding: 12, marginTop: 12 }}>
          <Typography.Title level={5}>
            {employees.data?.find((e) => e.id === r.employeeId)?.name ?? r.employeeId}
          </Typography.Title>
          <Space wrap>
            {category?.fields
              .filter((f) => f.kind === 'money' && !f.disabled)
              .map((f) => (
                <label key={f.key}>
                  {f.name}
                  <MoneyInput
                    disabled={saving}
                    aria-label={`${r.employeeId}-${f.key}`}
                    value={r.values[f.key] ?? 0}
                    onChange={(v) =>
                      patch(i, (r) => ({ ...r, values: { ...r.values, [f.key]: v ?? 0 } }))
                    }
                  />
                </label>
              ))}
          </Space>
          <details>
            <summary style={{ cursor: 'pointer', padding: 8 }}>累计扣除及期初税额</summary>
            <Space wrap>
              {(Object.keys(taxLabels) as (keyof typeof taxLabels)[]).map((k) => (
                <label key={k}>
                  {taxLabels[k]}
                  <MoneyInput
                    disabled={saving}
                    aria-label={`${r.employeeId}-${k}`}
                    allowNegative={false}
                    value={r.tax[k]}
                    onChange={(v) => patch(i, (r) => ({ ...r, tax: { ...r.tax, [k]: v ?? 0 } }))}
                  />
                </label>
              ))}
            </Space>
          </details>
          <Checkbox
            disabled={saving}
            checked={r.tax.confirmed}
            onChange={(e) =>
              patch(i, (r) => ({ ...r, tax: { ...r.tax, confirmed: e.target.checked } }))
            }
          >
            已核对本单位累计扣除、专项附加资格和期初税额
          </Checkbox>
          <Popconfirm
            disabled={saving}
            title="从本次编辑范围移除该员工？保存前可取消整个编辑。"
            onConfirm={() => {
              if (inFlight.current) return;
              setRows(rows.filter((_, j) => j !== i));
              setDirty(true);
            }}
          >
            <Button danger disabled={saving}>
              移除人员
            </Button>
          </Popconfirm>
        </div>
      ))}
    </Drawer>
  );
}
function VoucherEditor({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [form] = Form.useForm<Mapping>();
  const { byId } = useAccounts();
  const q = useQuery(api.mapping.queryOptions({ categoryId: batch.categoryId }));
  const [kind, setKind] = useState<'payment' | 'allocation'>('payment'),
    [date, setDate] = useState(periodEndDate(batch.period));
  const [plan, setPlan] = useState<{
    hash: string;
    lines: VoucherLineInput[];
    debit: number;
    credit: number;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const save = useMutation(
    api.saveMapping.mutationOptions({
      onSuccess: () => {
        setPlan(null);
        setMappingDirty(false);
        void refresh();
      },
    }),
  );
  const generate = useMutation(
    api.generate.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  const revoke = useMutation(
    api.revoke.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  const preview = async () => {
    setWorking(true);
    setPlan(null);
    try {
      const p = await queryClient.fetchQuery({
        ...api.preview.queryOptions({ id: batch.id, revision: batch.revision, kind, date }),
        staleTime: 0,
      });
      setPlan(p);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Drawer open size="large" title="工资凭证设置与生成" onClose={onClose}>
      <ErrorState error={q.error} />
      {q.isLoading ? (
        <Spin />
      ) : (
        <Form
          key={JSON.stringify(q.data)}
          form={form}
          layout="vertical"
          initialValues={q.data ?? { amountField: 'gross', allocationField: 'department' }}
          onValuesChange={() => {
            setPlan(null);
            setMappingDirty(true);
          }}
        >
          <Space wrap>
            {(
              [
                'payableAccountId',
                'bankAccountId',
                'taxAccountId',
                'deductionAccountId',
                'expenseAccountId',
              ] as const
            ).map((k, i) => (
              <Form.Item
                key={k}
                name={k}
                label={
                  [
                    '应付工资科目',
                    '银行或现金科目',
                    '个税贷方科目',
                    '个人扣款贷方科目',
                    '费用分配借方科目',
                  ][i]
                }
                rules={[{ required: true }]}
              >
                <AccountSelect style={{ width: 260 }} />
              </Form.Item>
            ))}
          </Space>
          <Form.Item name="amountField" label="应付工资金额栏目">
            <Select options={[{ value: 'gross', label: '应发金额（工资金额项）' }]} />
          </Form.Item>
          <Form.Item name="allocationField" label="工资分配基本栏目">
            <Select options={[{ value: 'department', label: '部门（core 基本项）' }]} />
          </Form.Item>
          <Button
            loading={save.isPending}
            onClick={() =>
              void form.validateFields().then((mapping) =>
                save.mutate({
                  categoryId: batch.categoryId,
                  mapping: { ...mapping, revision: q.data?.revision ?? 0 },
                }),
              )
            }
          >
            保存凭证设置
          </Button>
        </Form>
      )}
      <p>
        仅支持按部门分配；其他必需辅助维度会阻止生成。分配：借费用、贷应付；发放：借应付、贷实发/个税/个人扣款。生成状态为待审核。
      </p>
      <Space wrap>
        <Select
          aria-label="凭证种类"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPlan(null);
          }}
          options={[
            { value: 'payment', label: '工资发放凭证' },
            { value: 'allocation', label: '工资分配凭证' },
          ]}
        />
        <Input
          aria-label="凭证日期"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPlan(null);
          }}
        />
        <Button
          loading={working}
          disabled={mappingDirty || save.isPending}
          onClick={() => void preview()}
        >
          预览凭证
        </Button>
      </Space>
      {plan && (
        <>
          <DataTable
            tableId="payroll.plan"
            rowKey={(_, i) => i!}
            dataSource={plan.lines}
            columns={[
              { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
              {
                key: 'account',
                title: '科目',
                width: 180,
                render: (_, line) => {
                  const a = byId.get(line.accountId ?? 0);
                  return a ? `${a.code} ${a.name}` : '';
                },
              },
              { key: 'debit', title: '借方', dataIndex: 'debit', money: true },
              { key: 'credit', title: '贷方', dataIndex: 'credit', money: true },
            ]}
          />
          <p>
            借方合计 {formatMoney(plan.debit)} / 贷方合计 {formatMoney(plan.credit)}
          </p>
          <Popconfirm
            title="按本次预览生成待审核工资凭证？"
            onConfirm={() =>
              generate.mutate({
                id: batch.id,
                revision: batch.revision,
                kind,
                date,
                hash: plan.hash,
              })
            }
          >
            <Button type="primary" loading={generate.isPending}>
              确认生成凭证
            </Button>
          </Popconfirm>
        </>
      )}
      {batch.vouchers.map((v) => (
        <p key={v.kind}>
          <Link to={`/m/voucher-entry/edit?id=${v.id}`}>
            {v.number}（{VOUCHER_STATUS_LABELS[v.status as keyof typeof VOUCHER_STATUS_LABELS]}）
          </Link>{' '}
          <Popconfirm
            title="撤销并删除此未审核凭证？已审核或过账会被阻止。"
            onConfirm={() =>
              revoke.mutate({
                id: batch.id,
                revision: batch.revision,
                kind: v.kind as 'payment' | 'allocation',
                confirmed: true,
              })
            }
          >
            <Button danger loading={revoke.isPending}>
              撤销{v.kind === 'payment' ? '发放' : '分配'}凭证
            </Button>
          </Popconfirm>
        </p>
      ))}
    </Drawer>
  );
}
