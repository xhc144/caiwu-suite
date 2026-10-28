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
  Modal,
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
  DIMENSION_TYPES,
  type VoucherLineInput,
} from '@caiwu/core';
import {
  queryClient,
  usePermission,
  useAccounts,
  useHotkey,
  useUnsavedChanges,
  useDimensionItems,
} from '@caiwu/web-kit';
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
import { type PrintJob } from '@caiwu/print';
import { printPayrollJob } from './print-job';
import PayrollPrintPreview from './PayrollPrintPreview';
import {
  DEFAULT_FIELDS,
  TAX_RULE,
  TaxInputSchema,
  type Batch,
  type Category,
  type Employee,
  type Field,
  type Formula,
  type RowInput,
  type SalaryRow,
  type TaxInput,
} from '../shared';
import { api } from './api';
import type { VoucherMapping } from '../shared-voucher';
import VoucherAuxiliaryFields from './VoucherAuxiliaryFields';
import RevokeVoucher from './RevokeVoucher';
import { usePayrollFilters } from './filters';
import BulkDrawer from './BulkDrawer';
import ExcelImportDrawer from './ExcelImportDrawer';
import TransferOriginNotice from './TransferOriginNotice';
import PersonnelBulkDrawer from './PersonnelBulkDrawer';
import PersonnelBasicBulkDrawer from './PersonnelBasicBulkDrawer';
import DepartmentManager from './DepartmentManager';
import SalaryGrid from './SalaryGrid';
import { useMoneyDrafts } from './money-drafts';
import HistoryDrawer from './HistoryDrawer';
import HistoryTaxSettings from './HistoryTaxSettings';
import PersonnelExtras, {
  PersonnelFieldEditor,
  PersonnelDelete,
  PersonnelOutput,
} from './PersonnelExtras';
import QuantityInput from './QuantityInput';
import { useQuantityDrafts } from './quantity-drafts';
import ClosingOptions from './ClosingOptions';

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
  const [bulk, setBulk] = useState<'selected' | 'filtered' | null>(null);
  const [basicBulk, setBasicBulk] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [details, setDetails] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [basicFields, setBasicFields] = useState(false);
  const [currentId, setCurrentId] = useState<number>();
  const [locate, setLocate] = useState('');
  const [locateError, setLocateError] = useState('');
  const filtered = (list.data ?? []).filter(
    (e) =>
      (!filters.department || e.departmentId === filters.department) &&
      (!filters.keyword || `${e.code} ${e.name}`.includes(filters.keyword)),
  );
  const current = filtered.find((e) => e.id === currentId) ?? filtered[0];
  const moveRecord = (step: number) => {
    const index = filtered.findIndex((e) => e.id === current?.id);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + step))];
    if (next) setCurrentId(next.id);
  };
  const browsing =
    !editing && !details && !deleting && !basicFields && !bulk && !basicBulk && !department;
  useHotkey(
    'Ctrl+Q',
    () => document.querySelector<HTMLInputElement>('[aria-label="定位人员"]')?.focus(),
    { enabled: browsing },
  );
  useHotkey(
    'Ctrl+Home',
    () => {
      if (filtered[0]) setCurrentId(filtered[0].id);
    },
    { enabled: browsing, allowInInput: false },
  );
  useHotkey(
    'Ctrl+End',
    () => {
      const last = filtered[filtered.length - 1];
      if (last) setCurrentId(last.id);
    },
    { enabled: browsing, allowInInput: false },
  );
  useHotkey('ArrowUp', () => moveRecord(-1), { enabled: browsing, allowInInput: false });
  useHotkey('ArrowDown', () => moveRecord(1), { enabled: browsing, allowInInput: false });
  useHotkey('Ctrl+A', () => setEditing('new'), {
    enabled: browsing && canEdit,
    allowInInput: false,
  });
  useHotkey(
    'Ctrl+D',
    () => {
      if (current) setDeleting(current);
    },
    { enabled: browsing && canEdit, allowInInput: false },
  );
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
      width: 360,
      render: (_, r) =>
        canEdit && (
          <Space wrap>
            <Button onClick={() => setEditing(r)}>修改 / 停用</Button>
            <Button onClick={() => setDetails(r)}>基本资料 / 任职</Button>
            <Button danger onClick={() => setDeleting(r)}>
              删除
            </Button>
          </Space>
        ),
    },
  ];
  return (
    <PageContainer
      title="人事档案"
      subtitle="修改编号保留内部标识与历史；使用停用保留人员。无需录入证件号码。"
      extra={
        canEdit && (
          <>
            <Button onClick={() => setDepartment(true)}>部门管理</Button>
            <Button onClick={() => setBasicFields(true)}>基本资料栏目</Button>
            <Button
              disabled={!filtered.some((e) => selected.includes(e.id))}
              onClick={() => setBasicBulk(true)}
            >
              自定义资料统一置数（所选）
            </Button>
            <Button
              disabled={!filtered.some((e) => selected.includes(e.id))}
              onClick={() => setBulk('selected')}
            >
              人事统一置数（所选）
            </Button>
            <Button disabled={!filtered.length} onClick={() => setBulk('filtered')}>
              人事统一置数（筛选结果）
            </Button>
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
      <Space wrap style={{ marginBottom: 12 }}>
        <Button loading={list.isFetching} onClick={() => void list.refetch()}>
          刷新人事档案
        </Button>
        <Input.Search
          aria-label="定位人员"
          placeholder="输入人员编号或姓名定位"
          value={locate}
          onChange={(e) => setLocate(e.target.value)}
          onSearch={() => {
            const found = filtered.find(
              (e) => e.code === locate.trim() || e.name === locate.trim(),
            );
            if (found) {
              setLocateError('');
              setCurrentId(found.id);
              setDetails(found);
            } else setLocateError('当前筛选范围没有该人员，请核对完整编号或姓名。');
          }}
          enterButton="定位查询"
        />
        <Button disabled={!filtered.length} onClick={() => setCurrentId(filtered[0]!.id)}>
          首记录
        </Button>
        <Button
          disabled={!filtered.length || filtered[0]?.id === (currentId ?? filtered[0]?.id)}
          onClick={() =>
            setCurrentId(
              filtered[Math.max(0, filtered.findIndex((e) => e.id === currentId) - 1)]!.id,
            )
          }
        >
          上一记录
        </Button>
        <Button
          disabled={!filtered.length || filtered[filtered.length - 1]?.id === currentId}
          onClick={() =>
            setCurrentId(
              filtered[
                Math.min(
                  filtered.length - 1,
                  Math.max(
                    0,
                    filtered.findIndex((e) => e.id === currentId),
                  ) + 1,
                )
              ]!.id,
            )
          }
        >
          下一记录
        </Button>
        <Button
          disabled={!filtered.length}
          onClick={() => setCurrentId(filtered[filtered.length - 1]!.id)}
        >
          末记录
        </Button>
        <Typography.Text>当前人员：{current?.name ?? '无'}</Typography.Text>
        <Button
          disabled={!current || !canEdit}
          onClick={() => {
            if (current) setEditing(current);
          }}
        >
          修改当前人员
        </Button>
        <PersonnelOutput
          ids={filtered.filter((e) => selected.includes(e.id)).map((e) => e.id)}
          hotkeys={browsing}
        />
      </Space>
      {locateError && <Alert type="warning" title={locateError} />}
      <DataTable
        tableId="payroll.employees"
        rowKey="id"
        columns={columns}
        loading={list.isLoading}
        dataSource={filtered}
        onRow={(record) => ({
          onClick: () => setCurrentId(record.id),
          style: record.id === current?.id ? { backgroundColor: '#e6f4ff' } : undefined,
        })}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys.map(Number)),
        }}
      />
      {editing && <EmployeeEditor employee={editing} onClose={() => setEditing(null)} />}
      {details && <PersonnelExtras employee={details} onClose={() => setDetails(null)} />}
      {deleting && <PersonnelDelete employee={deleting} onClose={() => setDeleting(null)} />}
      {basicFields && <PersonnelFieldEditor onClose={() => setBasicFields(false)} />}
      {basicBulk && (
        <PersonnelBasicBulkDrawer
          employees={filtered.filter((e) => selected.includes(e.id))}
          onClose={() => setBasicBulk(false)}
        />
      )}
      {department && <DepartmentManager onClose={() => setDepartment(false)} />}
      {bulk && (
        <PersonnelBulkDrawer
          employees={
            bulk === 'filtered' ? filtered : filtered.filter((e) => selected.includes(e.id))
          }
          onClose={() => setBulk(null)}
          onApplied={() => {
            void refresh();
          }}
        />
      )}
    </PageContainer>
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
  const inFlight = useRef(false);
  const save = useMutation(
    api.saveEmployee.mutationOptions({
      onError: () => {
        void refresh();
      },
      onSuccess: () => {
        setDirty(false);
        void refresh();
        onClose();
      },
    }),
  );
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const v = await form.validateFields();
      await save.mutateAsync({
        ...v,
        endDate: v.endDate || null,
        qualificationYear: v.qualificationYear ?? null,
        ...(employee === 'new' ? {} : { id: employee.id, revision: employee.revision }),
      });
    } finally {
      inFlight.current = false;
    }
  };
  useHotkey('Ctrl+S', () => void submit().catch(() => {}));
  useUnsavedChanges({
    title: employee === 'new' ? '新增人事档案' : `${employee.name}的人事档案`,
    dirty: dirty || save.isPending,
    save: submit,
    discard: () => {
      if (inFlight.current) throw new Error('人事档案正在保存，请等待完成后再离开');
      setDirty(false);
      onClose();
    },
  });
  const close = () => {
    if (inFlight.current) return;
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
          onClick={() => void submit().catch(() => {})}
        >
          保存员工
        </Button>
      }
    >
      <Form
        form={form}
        disabled={save.isPending}
        layout="vertical"
        initialValues={
          employee === 'new'
            ? { startDate: '2026-01-01', taxKind: 'resident', policy: 'employment' }
            : employee
        }
        onValuesChange={() => setDirty(true)}
      >
        <ErrorState error={save.error} />
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
  const canConfigureTax = usePermission('payroll.tax.configure');
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
          category === 'new'
            ? { fields: DEFAULT_FIELDS, formulas: [], disabled: false, taxMode: 'builtin' }
            : { taxMode: 'builtin', ...category }
        }
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item name="name" label="工资类别名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="disabled" valuePropName="checked">
          <Checkbox>停用类别</Checkbox>
        </Form.Item>
        <Form.Item name="taxMode" label="计税方式">
          <Select
            disabled={!canConfigureTax}
            options={[
              { value: 'builtin', label: '按工资期间适用内置税制' },
              { value: 'custom', label: '使用本类别唯一自定义计税公式' },
            ]}
          />
        </Form.Item>
        <Alert
          type="info"
          title="自定义计税由会计人员核对适用税制和公式，须有计税参数权限。仅勾选一条计税公式，目标选备查计算栏目；结果以分表示，并由实发工资统一扣除一次。自定义方式不代表使用或确认官方内置税表。"
        />
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
                      onChange={(kind) => {
                        if (kind === 'quantity' || kind === 'basic')
                          form.setFieldValue(['fields', f.name, 'role'], 'memo');
                      }}
                      options={[
                        { value: 'money', label: '金额录入' },
                        { value: 'calculated', label: '计算项' },
                        { value: 'quantity', label: '数量录入' },
                        { value: 'basic', label: '人事基本项' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'unit']} label="单位">
                    <Input style={{ width: 90 }} maxLength={20} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'width']} label="显示宽度">
                    <InputNumber min={60} max={600} precision={0} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'description']} label="栏目说明">
                    <Input style={{ width: 150 }} maxLength={200} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'basicSource']} label="基本项来源">
                    <Select
                      allowClear
                      style={{ width: 120 }}
                      options={[
                        { value: 'code', label: '人员编号' },
                        { value: 'name', label: '姓名' },
                        { value: 'departmentName', label: '部门名称' },
                        { value: 'startDate', label: '任职日期' },
                        { value: 'endDate', label: '离职日期' },
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
        <Typography.Title level={5}>工资计算公式</Typography.Title>
        <Alert
          type="info"
          title="数量最多保留六位小数，按栏目单位参与公式；金额变量仍以分计算。例如 hours * rate，hours 为工时、rate 为每小时金额，可得到整数分工资。数量及人事基本项须设为备查，人事资料不能直接参与算术。"
        />
        <Alert
          type="info"
          title="支持稳定变量、算术、比较、and/or/not 逻辑分组，以及 abs、min、max、sum、round、trunc、floor、ceil、sign、mod、if/iif。金额变量与结果以分计算，如 base * 0.1；round(base,-2) 四舍五入到整元。条件非零时执行，if 与逻辑运算仅计算实际分支。个税按上方明确选择的方式计算。"
          description="日期函数为本版约定：today() 返回工资期末日期（YYYYMMDD 整数）；daybefore(日期,天数)、monthbefore(日期,月数) 返回前推日期，月末取目标月最后一天，参数须为非负整数。日期值不作金额使用，建议放在执行条件内，例如 today() >= 20260101。原版静态资料只列出函数及语法校验，未载明参数语义。"
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
                    <Form.Item name={[f.name, 'tax']} valuePropName="checked">
                      <Checkbox disabled={!canConfigureTax}>本类别计税公式</Checkbox>
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
      <HistoryTaxSettings />
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
  const [closingOptionsOpen, setClosingOptionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gridDirty, setGridDirty] = useState(false);
  const changeFilters = (next: Partial<SalaryFilters>) => {
    if (gridDirty) {
      window.alert('请先保存或放弃表格修改，再切换工资批次或筛选条件。');
      return;
    }
    setFilters(next);
  };
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
  const [printPreview, setPrintPreview] = useState<{ job: PrintJob; pages: number } | null>(null);
  const [printError, setPrintError] = useState('');
  const output = async (mode: 'excel' | 'print' | 'preview') => {
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
          money: f.kind !== 'quantity' && f.kind !== 'basic',
          value: (r: SalaryRow) =>
            f.kind === 'quantity'
              ? (r.calculatedQuantities?.[f.key] ?? '0')
              : f.kind === 'basic'
                ? String(f.basicSource ? (r.employee[f.basicSource] ?? '') : '')
                : (r.calculatedValues[f.key] ?? 0),
        })),
      ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map((k, i) => ({
        title: ['应发', '扣款', '个税', '实发'][i]!,
        money: true,
        value: (r: SalaryRow) => r[k],
      })),
    ];
    if (mode === 'excel')
      await exportToExcel({ fileName: `工资条-${data.period}`, columns, rows: data.rows });
    else {
      const fresh = await queryClient.fetchQuery({
        ...api.printReport.queryOptions({
          mode: 'slips',
          report: {
            categoryId: data.category.id,
            from: data.period,
            to: data.period,
            employeeIds: data.rows.map((row) => row.employeeId),
            columns: ['gross'],
            kind: 'table',
          },
        }),
        staleTime: 0,
      });
      if (mode === 'preview') setPrintPreview(fresh);
      else await printPayrollJob(fresh.job);
    }
  };
  const runOutput = (mode: 'excel' | 'print' | 'preview') => {
    setPrintError('');
    void output(mode).catch((error: unknown) =>
      setPrintError(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <PageContainer
      title="工资管理"
      subtitle="工资批次仅计算及制证；无银行付款或税务申报操作。"
      extra={
        canEdit && (
          <Button type="primary" disabled={gridDirty} onClick={() => setEditing('new')}>
            新增工资批次
          </Button>
        )
      }
    >
      {!independent && (
        <>
          <FilterBar initialValues={filters} onSearch={(v) => changeFilters({ ...v, id: 0 })}>
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
                      changeFilters({ id: r.id });
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
            {canEdit && canCalculate && b.calculated && (
              <Button disabled={gridDirty} onClick={() => setHistoryOpen(true)}>
                前期更正 / 更正记录
              </Button>
            )}
            {canEdit && !b.vouchers.length && !b.closed && (
              <Button disabled={gridDirty} onClick={() => setEditing(b)}>
                编辑工资
              </Button>
            )}
            {canCalculate && !b.vouchers.length && !b.closed && (
              <Button
                aria-label="计算工资"
                aria-busy={calculate.isPending}
                disabled={calculate.isPending || gridDirty}
                loading={calculate.isPending}
                onClick={() => calculate.mutate({ id: b.id, revision: b.revision })}
              >
                计算工资
              </Button>
            )}
            {canEdit && !b.vouchers.length && !b.closed && (
              <Button disabled={gridDirty} onClick={() => setBulkOpen(true)}>
                统一置数 / 粘贴
              </Button>
            )}
            {canEdit && !b.vouchers.length && !b.closed && (
              <Button disabled={gridDirty} onClick={() => setImportOpen(true)}>
                Excel 工资转入
              </Button>
            )}
            {canClose && !b.closed && (
              <Popconfirm
                title="确认冻结本期工资并按传递栏目建立下月？"
                onConfirm={() => close.mutate({ id: b.id, revision: b.revision, confirmed: true })}
              >
                <Button disabled={gridDirty} loading={close.isPending}>
                  工资结账
                </Button>
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
            {((canClose && !b.closed) || (canReopen && b.closed)) && (
              <Button disabled={gridDirty} onClick={() => setClosingOptionsOpen(true)}>
                {b.closed ? '保留下月反结账' : '已有下月合并传递'}
              </Button>
            )}
            {canVoucher && (
              <Button disabled={gridDirty} onClick={() => setVoucher(true)}>
                凭证设置与生成
              </Button>
            )}
            {canExport && (
              <>
                <Button disabled={gridDirty} onClick={() => runOutput('excel')}>
                  导出所选工资条
                </Button>
                <Button disabled={gridDirty} onClick={() => runOutput('preview')}>
                  预览所选工资条
                </Button>
                <Button disabled={gridDirty} onClick={() => runOutput('print')}>
                  打印所选工资条
                </Button>
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
          <TransferOriginNotice batchId={b.id} />
          <SalaryGrid
            key={b.id}
            batch={b}
            department={filters.department}
            person={filters.person}
            selected={selected}
            onSelectionChange={setSelected}
            onDirtyChange={setGridDirty}
            onExplain={setExplaining}
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
      {closingOptionsOpen && b && (
        <ClosingOptions
          key={`${b.id}.${b.revision}`}
          batch={b}
          onClose={() => setClosingOptionsOpen(false)}
        />
      )}
      {importOpen && b && (
        <ExcelImportDrawer
          batch={b}
          onClose={() => setImportOpen(false)}
          onSaved={() => void refresh()}
        />
      )}
      {voucher && b && <VoucherEditor key={b.id} batch={b} onClose={() => setVoucher(false)} />}
      {historyOpen && b && (
        <HistoryDrawer key={b.id} batch={b} onClose={() => setHistoryOpen(false)} />
      )}
      {printError && <Alert type="error" title={printError} />}
      {printPreview && (
        <PayrollPrintPreview output={printPreview} onClose={() => setPrintPreview(null)} />
      )}
      {explaining && (
        <Drawer
          open
          title={`${explaining.employee.name} 计税计算说明`}
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
  const [category, setEditingCategory] = useState(
    () =>
      categories.find((c) => c.id === categoryId) ?? (batch === 'new' ? undefined : batch.category),
  );
  const [period, setPeriod] = useState(batch === 'new' ? defaultPeriod : batch.period);
  const [rows, setRows] = useState<RowInput[]>(batch === 'new' ? [] : batch.rows);
  const [dirty, setDirty] = useState(false);
  const moneyDrafts = useMoneyDrafts();
  const quantityDrafts = useQuantityDrafts();
  const quantityKeys = rows.flatMap((row) =>
    (category?.fields ?? [])
      .filter((f) => f.kind === 'quantity' && !f.disabled)
      .map((f) => `${row.employeeId}.${f.key}`),
  );
  const invalidQuantity = quantityDrafts.invalidFor(quantityKeys);
  const moneyKeys = rows.flatMap((row) => [
    ...(category?.fields ?? [])
      .filter((f) => f.kind === 'money' && !f.disabled)
      .map((f) => `${row.employeeId}.values.${f.key}`),
    ...Object.keys(taxLabels).map((k) => `${row.employeeId}.tax.${k}`),
  ]);
  const invalidMoney = moneyDrafts.invalidFor(moneyKeys);
  const hasInvalidMoney = Object.keys(invalidMoney).length > 0;
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
    if (!moneyDrafts.validate(moneyKeys)) return;
    if (!quantityDrafts.validate(quantityKeys)) return;
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
      {Object.keys(invalidQuantity).length > 0 && (
        <Alert
          type="error"
          title="数量格式无效，请输入最多六位小数；整批工资尚未提交。"
          description={Object.values(invalidQuantity).join('；')}
        />
      )}
      {category && categories.find((c) => c.id === category.id)?.revision !== category.revision && (
        <Alert type="warning" title="工资结构已变化，当前草稿已保留；请核对后重新打开编辑窗口。" />
      )}
      {hasInvalidMoney && (
        <Alert
          type="error"
          showIcon
          title="金额格式无效，请修正后再保存；整批工资尚未提交。"
          description={Object.values(invalidMoney).join('；')}
        />
      )}
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
              setEditingCategory(categories.find((c) => c.id === id));
              setRows([]);
              moneyDrafts.clear();
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
        title={
          category?.taxMode === 'custom'
            ? '本类别按自定义计税公式计算，公式只读取工资栏目。下方扣除及期初资料不自动改变自定义公式结果；需要参与公式的依据请定义为工资备查金额栏目，并在公式中引用。'
            : period < 201901
              ? '历史工资按实际取得月份录入。专项、其他扣除及减免按当月数填写；2019年前无专项附加或年度期初累计，同月跨类别扣除保持一致。'
              : '专项/附加/其他/减免是本单位本年截至本月累计数；期初只填本单位未进入本系统的当年历史，不含系统内批次或其他单位。税前专项扣除与工资个人扣款分别录入。同月跨类别累计扣除须一致。'
        }
      />
      {rows.map((r, i) => (
        <div key={r.employeeId} style={{ border: '1px solid #ddd', padding: 12, marginTop: 12 }}>
          <Typography.Title level={5}>
            {employees.data?.find((e) => e.id === r.employeeId)?.name ?? r.employeeId}
          </Typography.Title>
          <Space wrap>
            {category?.fields
              .filter((f) => f.kind === 'quantity' && !f.disabled)
              .map((f) => (
                <label key={f.key}>
                  {f.unit ? `${f.name}（${f.unit}）` : f.name}
                  <QuantityInput
                    aria-label={`${r.employeeId}-${f.key}`}
                    disabled={saving}
                    value={r.quantities?.[f.key]}
                    draftText={quantityDrafts.text(`${r.employeeId}.${f.key}`)}
                    status={
                      invalidQuantity[`${r.employeeId}.${f.key}`] !== undefined
                        ? 'error'
                        : undefined
                    }
                    onDraftChange={(text) => {
                      if (!inFlight.current) {
                        quantityDrafts.observe(`${r.employeeId}.${f.key}`, text);
                        setDirty(true);
                      }
                    }}
                    onChange={(value) =>
                      patch(i, (row) => {
                        const quantities = { ...row.quantities };
                        if (value === undefined) delete quantities[f.key];
                        else quantities[f.key] = value;
                        const { quantities: _old, ...rest } = row;
                        return Object.keys(quantities).length ? { ...rest, quantities } : rest;
                      })
                    }
                  />
                </label>
              ))}
            {category?.fields
              .filter((f) => f.kind === 'money' && !f.disabled)
              .map((f) => (
                <label key={f.key}>
                  {f.name}
                  <MoneyInput
                    resetKey={moneyDrafts.resetKey}
                    disabled={saving}
                    aria-label={`${r.employeeId}-${f.key}`}
                    status={
                      invalidMoney[`${r.employeeId}.values.${f.key}`] !== undefined
                        ? 'error'
                        : undefined
                    }
                    aria-invalid={invalidMoney[`${r.employeeId}.values.${f.key}`] !== undefined}
                    draftText={moneyDrafts.text(`${r.employeeId}.values.${f.key}`)}
                    onDraftStateChange={(state) => {
                      if (inFlight.current) return;
                      moneyDrafts.observe(`${r.employeeId}.values.${f.key}`, state);
                      if (state && !state.valid) setDirty(true);
                    }}
                    value={r.values[f.key] ?? 0}
                    onChange={(v) =>
                      patch(i, (r) => ({ ...r, values: { ...r.values, [f.key]: v ?? 0 } }))
                    }
                  />
                </label>
              ))}
          </Space>
          <details>
            <summary style={{ cursor: 'pointer', padding: 8 }}>计税依据、扣除及期初税额</summary>
            <Space wrap>
              {(Object.keys(taxLabels) as (keyof typeof taxLabels)[]).map((k) => (
                <label key={k}>
                  {taxLabels[k]}
                  <MoneyInput
                    resetKey={moneyDrafts.resetKey}
                    disabled={saving}
                    aria-label={`${r.employeeId}-${k}`}
                    allowNegative={false}
                    status={
                      invalidMoney[`${r.employeeId}.tax.${k}`] !== undefined ? 'error' : undefined
                    }
                    aria-invalid={invalidMoney[`${r.employeeId}.tax.${k}`] !== undefined}
                    draftText={moneyDrafts.text(`${r.employeeId}.tax.${k}`)}
                    onDraftStateChange={(state) => {
                      if (inFlight.current) return;
                      moneyDrafts.observe(`${r.employeeId}.tax.${k}`, state);
                      if (state && !state.valid) setDirty(true);
                    }}
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
            {category?.taxMode === 'custom'
              ? '已核对自定义计税公式及本次工资资料'
              : period < 201901
                ? '已核对本月扣除及历史适用税制'
                : '已核对本单位累计扣除、专项附加资格和期初税额'}
          </Checkbox>
          <Popconfirm
            disabled={saving}
            title="从本次编辑范围移除该员工？保存前可取消整个编辑。"
            onConfirm={() => {
              if (inFlight.current) return;
              setRows(rows.filter((_, j) => j !== i));
              moneyDrafts.forget(`${r.employeeId}.`);
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
  const q = useQuery({
    ...api.mapping.queryOptions({ categoryId: batch.categoryId }),
    refetchOnMount: 'always',
  });
  if (q.isLoading || (!q.isFetchedAfterMount && q.isFetching))
    return (
      <Drawer open size="large" title="工资凭证设置与生成" onClose={onClose}>
        <Spin />
      </Drawer>
    );
  if (q.error && q.data === undefined)
    return (
      <Drawer open size="large" title="工资凭证设置与生成" onClose={onClose}>
        <ErrorState error={q.error} />
      </Drawer>
    );
  return (
    <VoucherEditorLoaded
      batch={batch}
      latestMapping={q.data ?? null}
      latestError={q.error}
      onClose={onClose}
    />
  );
}
function VoucherEditorLoaded({
  batch,
  latestMapping,
  latestError,
  onClose,
}: {
  batch: Batch;
  latestMapping: VoucherMapping | null;
  latestError: { message: string } | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<VoucherMapping>();
  const { byId } = useAccounts();
  const { byId: auxiliaryById } = useDimensionItems();
  const [mappingSnapshot, setMappingSnapshot] = useState(latestMapping);
  const [categorySnapshot] = useState(batch.category);
  const mappingInFlight = useRef<Promise<boolean> | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const [kind, setKind] = useState<'payment' | 'allocation'>('payment'),
    [date, setDate] = useState(periodEndDate(batch.period));
  const [plan, setPlan] = useState<{
    hash: string;
    lines: VoucherLineInput[];
    aggregated?: boolean;
    originalLineCount?: number;
    debit: number;
    credit: number;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const save = useMutation(api.saveMapping.mutationOptions());
  const saveMappingDraft = (): Promise<boolean> => {
    if (mappingInFlight.current) return mappingInFlight.current;
    setMappingSaving(true);
    const pending = (async () => {
      try {
        const values = await form.validateFields();
        const saved = await save.mutateAsync({
          categoryId: batch.categoryId,
          mapping: {
            ...values,
            rules: values.rules ?? [],
            auxiliaries: values.auxiliaries ?? [],
            revision: mappingSnapshot?.revision ?? 0,
          },
        });
        setMappingSnapshot(saved);
        form.setFieldsValue(saved);
        setPlan(null);
        setMappingDirty(false);
        queryClient.setQueryData(api.mapping.queryKey({ categoryId: batch.categoryId }), saved);
        void refresh();
        return true;
      } catch {
        return false;
      } finally {
        mappingInFlight.current = null;
        setMappingSaving(false);
      }
    })();
    mappingInFlight.current = pending;
    return pending;
  };
  const discardMapping = () => {
    if (mappingInFlight.current) return;
    form.resetFields();
    setMappingDirty(false);
    onClose();
  };
  useUnsavedChanges({
    title: `${batch.period} ${categorySnapshot.name} 凭证设置`,
    dirty: mappingDirty,
    save: saveMappingDraft,
    discard: discardMapping,
  });
  useHotkey('Ctrl+S', () => {
    if (mappingDirty) void saveMappingDraft();
  });
  const closeMapping = () => {
    if (mappingInFlight.current) return;
    if (mappingDirty) setCloseRequested(true);
    else onClose();
  };
  const generate = useMutation(
    api.generate.mutationOptions({
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
    <Drawer open size="large" title="工资凭证设置与生成" onClose={closeMapping}>
      <Modal
        title="凭证设置尚未保存"
        open={closeRequested}
        onCancel={() => {
          if (!mappingSaving) setCloseRequested(false);
        }}
        footer={null}
        destroyOnHidden
      >
        <p>当前凭证设置已修改，请保存、放弃或继续编辑。</p>
        <Space>
          <Button disabled={mappingSaving} onClick={() => setCloseRequested(false)}>
            继续编辑凭证设置
          </Button>
          <Button danger disabled={mappingSaving} onClick={discardMapping}>
            放弃并关闭凭证设置
          </Button>
          <Button
            type="primary"
            loading={mappingSaving}
            onClick={() => {
              void saveMappingDraft().then((saved) => {
                if (saved) onClose();
              });
            }}
          >
            保存并关闭凭证设置
          </Button>
        </Space>
      </Modal>
      <ErrorState error={latestError} />
      <ErrorState error={save.error} />
      {(latestMapping?.revision ?? 0) !== (mappingSnapshot?.revision ?? 0) && (
        <Alert
          type="warning"
          title="凭证设置已变化，当前编辑内容已保留；重新打开前请先核对并保存或放弃。"
        />
      )}
      {batch.category.revision !== categorySnapshot.revision && (
        <Alert type="warning" title="工资结构已变化，当前编辑栏目已保留；请核对后重新打开。" />
      )}
      <Form
        form={form}
        disabled={mappingSaving || working || generate.isPending}
        layout="vertical"
        initialValues={
          mappingSnapshot ?? {
            amountField: 'gross',
            allocationField: 'department',
            rules: [],
            auxiliaries: [],
          }
        }
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
          <Select options={[{ value: 'department', label: '部门' }]} />
        </Form.Item>
        <Typography.Title level={5}>自定义工资项映射</Typography.Title>
        <p>
          同种凭证增加规则后，该种凭证完整按下列规则生成；未设规则的种类沿用上方标准设置。每条规则按所选栏目金额同时记借方、贷方。指定部门覆盖同栏目的全部部门规则，多个栏目分别计入，请避免重复选取已含在汇总额中的明细。
        </p>
        <Form.List name="rules">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <div key={key} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 12 }}>
                  <Space wrap align="start">
                    <Form.Item
                      {...rest}
                      name={[name, 'kind']}
                      label="适用凭证"
                      rules={[{ required: true }]}
                    >
                      <Select
                        style={{ width: 140 }}
                        options={[
                          { value: 'payment', label: '工资发放' },
                          { value: 'allocation', label: '工资分配' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, 'field']}
                      label="工资金额栏目"
                      rules={[{ required: true }]}
                    >
                      <Select
                        style={{ width: 200 }}
                        options={[
                          { value: 'gross', label: '应发合计' },
                          { value: 'net', label: '实发合计' },
                          { value: 'deductions', label: '扣款合计' },
                          { value: 'taxAmount', label: '个人所得税' },
                          ...categorySnapshot.fields
                            .filter((f) => !f.disabled && f.kind !== 'quantity')
                            .map((f) => ({
                              value: f.key,
                              label: `${f.name}（${f.kind === 'calculated' ? '计算项' : '录入项'}）`,
                            })),
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, 'departmentId']}
                      label="适用部门（留空为全部）"
                    >
                      <DimensionSelect type="department" allowClear style={{ width: 180 }} />
                    </Form.Item>
                  </Space>
                  <Space wrap align="start">
                    <Form.Item
                      {...rest}
                      name={[name, 'debitAccountId']}
                      label="借方科目"
                      rules={[{ required: true }]}
                    >
                      <AccountSelect style={{ width: 260 }} />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, 'creditAccountId']}
                      label="贷方科目"
                      rules={[{ required: true }]}
                    >
                      <AccountSelect style={{ width: 260 }} />
                    </Form.Item>
                    <Button
                      danger
                      onClick={() => {
                        remove(name);
                        setPlan(null);
                        setMappingDirty(true);
                      }}
                    >
                      删除规则
                    </Button>
                  </Space>
                </div>
              ))}
              <Button
                onClick={() => {
                  add({
                    kind: 'payment',
                    field: 'net',
                    debitAccountId: form.getFieldValue('payableAccountId'),
                    creditAccountId: form.getFieldValue('bankAccountId'),
                  });
                  setPlan(null);
                  setMappingDirty(true);
                }}
              >
                增加工资项映射
              </Button>
            </>
          )}
        </Form.List>
        <VoucherAuxiliaryFields
          employees={batch.snapshots.map((r) => r.employee)}
          onChange={() => {
            setPlan(null);
            setMappingDirty(true);
          }}
        />
        <Button loading={mappingSaving} onClick={() => void saveMappingDraft()}>
          保存凭证设置
        </Button>
        <Popconfirm
          title="确认放弃本次凭证设置修改？"
          disabled={mappingSaving || !mappingDirty}
          onConfirm={discardMapping}
        >
          <Button disabled={mappingSaving || !mappingDirty}>放弃凭证设置修改</Button>
        </Popconfirm>
      </Form>
      <p>
        按人员工资快照和辅助设置生成。负额以原借贷方向红字记入；超过999条时按科目、辅助、方向及正负分别汇总。标准分配：借费用、贷应付；标准发放：借应付、贷实发/个税/个人扣款。生成后为待审核。
      </p>
      <Space wrap>
        <Select
          aria-label="凭证种类"
          disabled={mappingSaving || working || generate.isPending}
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
          disabled={mappingSaving || working || generate.isPending}
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPlan(null);
          }}
        />
        <Button
          loading={working}
          disabled={mappingDirty || mappingSaving || generate.isPending}
          onClick={() => void preview()}
        >
          预览凭证
        </Button>
      </Space>
      {plan && (
        <>
          {plan.aggregated && (
            <Alert
              type="info"
              title={`原始 ${plan.originalLineCount} 条分录已按科目及辅助核算合并为 ${plan.lines.length} 条，工资明细保留。`}
            />
          )}
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
              {
                key: 'auxiliary',
                title: '辅助核算',
                width: 260,
                render: (_, line) =>
                  DIMENSION_TYPES.flatMap((type) => {
                    const id = line.dimensions?.[type.id];
                    const item = id == null ? null : auxiliaryById.get(id);
                    return item ? [`${type.name}：${item.code} ${item.name}`] : [];
                  }).join('；'),
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
          <RevokeVoucher
            disabled={mappingDirty || mappingSaving || working || generate.isPending}
            id={batch.id}
            revision={batch.revision}
            kind={v.kind as 'payment' | 'allocation'}
            onSuccess={() => {
              void refresh();
              onClose();
            }}
          />
        </p>
      ))}
    </Drawer>
  );
}
