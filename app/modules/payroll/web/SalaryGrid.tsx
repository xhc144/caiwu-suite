import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Space, Typography } from 'antd';
import { queryClient, useHotkey, usePermission, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable, MoneyInput, MoneyText, type DataColumn } from '@caiwu/ui';
import type { Batch, RowInput, SalaryRow } from '../shared';
import { api } from './api';
import { useMoneyDrafts } from './money-drafts';

type GridRow = {
  employeeId: number;
  code: string;
  name: string;
  departmentId: number | undefined;
  departmentName: string;
  input: RowInput;
  snapshot: SalaryRow | undefined;
};
const copyRows = (rows: RowInput[]) =>
  rows.map((row) => ({ ...row, values: { ...row.values }, tax: { ...row.tax } }));

/** 输入始终基于完整批次；筛选和分页只改变显示，保存不会移除看不见的人员。 */
export default function SalaryGrid({
  batch,
  department,
  person,
  selected,
  onSelectionChange,
  onDirtyChange,
  onExplain,
}: {
  batch: Batch;
  department?: number;
  person?: string;
  selected: number[];
  onSelectionChange: (ids: number[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onExplain: (row: SalaryRow) => void;
}) {
  const people = useQuery(api.salaryEmployees.queryOptions());
  const canEdit = usePermission('payroll.salary.edit');
  const [draft, setDraft] = useState(() => ({ base: batch, rows: copyRows(batch.rows) }));
  const [saving, setSaving] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const mutation = useMutation(api.saveBatch.mutationOptions());
  const moneyDrafts = useMoneyDrafts();
  const clearMoneyDrafts = moneyDrafts.clear;
  const moneyKeys = draft.rows.flatMap((row) =>
    draft.base.category.fields
      .filter((f) => f.kind === 'money' && !f.disabled)
      .map((f) => `${row.employeeId}.${f.key}`),
  );
  const invalidMoney = moneyDrafts.invalidFor(moneyKeys);
  const hasInvalidMoney = Object.keys(invalidMoney).length > 0;
  const version = JSON.stringify({ rows: draft.rows, invalid: invalidMoney });
  const dirty = JSON.stringify(draft.rows) !== JSON.stringify(draft.base.rows) || hasInvalidMoney;
  const editable = canEdit && !batch.closed && !batch.vouchers.length;
  const changedElsewhere = batch.revision !== draft.base.revision;

  useEffect(() => {
    if (!dirty && !inFlight.current && draft.base !== batch) {
      setDraft({ base: batch, rows: copyRows(batch.rows) });
      clearMoneyDrafts();
    }
  }, [batch, dirty, draft.base, clearMoneyDrafts]);
  useLayoutEffect(() => {
    onDirtyChange(dirty || saving);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const discard = () => {
    if (inFlight.current) return;
    setDraft({ base: batch, rows: copyRows(batch.rows) });
    moneyDrafts.clear();
    mutation.reset();
  };
  const saveDraft = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (!moneyDrafts.validate(moneyKeys)) return Promise.resolve(false);
    if (!dirty) return Promise.resolve(true);
    if (!editable) return Promise.resolve(false);
    setSaving(true);
    const pending = (async () => {
      try {
        const saved = await mutation.mutateAsync({
          id: draft.base.id,
          revision: draft.base.revision,
          period: draft.base.period,
          categoryId: draft.base.categoryId,
          categoryRevision: draft.base.category.revision,
          rows: draft.rows,
        });
        setDraft({ base: saved, rows: copyRows(saved.rows) });
        clearMoneyDrafts();
        queryClient.setQueryData(api.batch.queryKey({ id: saved.id }), saved);
        void queryClient.invalidateQueries({ queryKey: api.pathKey() });
        return true;
      } catch {
        // 业务错误由公共请求层提示；保留所有输入及原版本，用户可重试或明确放弃。
        void queryClient.invalidateQueries({ queryKey: api.batch.queryKey({ id: batch.id }) });
        return false;
      } finally {
        inFlight.current = null;
        setSaving(false);
      }
    })();
    inFlight.current = pending;
    return pending;
  };
  useUnsavedChanges({
    title: `${batch.period} ${batch.category.name} 工资表`,
    dirty,
    version,
    save: saveDraft,
    discard,
  });
  useHotkey('Ctrl+S', () => void saveDraft(), { enabled: editable && dirty });

  const allRows: GridRow[] = draft.rows.map((input) => {
    const snapshot = draft.base.snapshots.find((row) => row.employeeId === input.employeeId);
    const employee = snapshot?.employee ?? people.data?.find((e) => e.id === input.employeeId);
    return {
      employeeId: input.employeeId,
      code: employee?.code ?? '',
      name: employee?.name ?? `人员 ${input.employeeId}`,
      departmentId: employee?.departmentId,
      departmentName: employee?.departmentName ?? '',
      input,
      snapshot,
    };
  });
  const visibleRows = allRows.filter(
    (row) =>
      (!department || row.departmentId === department) &&
      (!person || `${row.code} ${row.name}`.includes(person)),
  );
  const pendingCalculation = dirty || !draft.base.calculated;
  const columns: DataColumn<GridRow>[] = [
    { key: 'code', title: '编号', dataIndex: 'code', width: 110 },
    { key: 'name', title: '姓名', dataIndex: 'name', width: 110 },
    { key: 'department', title: '部门', dataIndex: 'departmentName', width: 120 },
    ...draft.base.category.fields
      .filter((field) => field.visible && !field.disabled)
      .map((field): DataColumn<GridRow> => ({
        key: field.key,
        title: field.name,
        width: 155,
        render: (_, row) =>
          field.kind === 'money' ? (
            editable ? (
              <MoneyInput
                resetKey={moneyDrafts.resetKey}
                draftText={moneyDrafts.text(`${row.employeeId}.${field.key}`)}
                aria-label={`工资-${row.employeeId}-${field.key}`}
                value={row.input.values[field.key] ?? null}
                disabled={saving}
                status={
                  invalidMoney[`${row.employeeId}.${field.key}`] !== undefined ? 'error' : undefined
                }
                aria-invalid={invalidMoney[`${row.employeeId}.${field.key}`] !== undefined}
                onDraftStateChange={(state) => {
                  if (inFlight.current) return;
                  moneyDrafts.observe(`${row.employeeId}.${field.key}`, state);
                }}
                onChange={(value) => {
                  if (inFlight.current) return;
                  setDraft((current) => ({
                    ...current,
                    rows: current.rows.map((input) => {
                      if (input.employeeId !== row.employeeId) return input;
                      const values = { ...input.values };
                      if (value == null) delete values[field.key];
                      else values[field.key] = value;
                      return { ...input, values };
                    }),
                  }));
                }}
              />
            ) : (
              <MoneyText value={row.input.values[field.key]} />
            )
          ) : pendingCalculation ? (
            '待重算'
          ) : (
            <MoneyText value={row.snapshot?.calculatedValues[field.key]} />
          ),
      })),
    ...(['gross', 'deductions', 'taxAmount', 'net'] as const).map(
      (key, i): DataColumn<GridRow> => ({
        key,
        title: ['应发', '扣款', '个税', '实发'][i]!,
        width: 120,
        render: (_, row) =>
          pendingCalculation ? '待重算' : <MoneyText value={row.snapshot?.[key]} />,
      }),
    ),
    {
      key: 'detail',
      title: '计算说明',
      width: 120,
      render: (_, row) => (
        <Button
          disabled={pendingCalculation || !row.snapshot}
          onClick={() => row.snapshot && onExplain(row.snapshot)}
        >
          查看解释
        </Button>
      ),
    },
  ];
  return (
    <section aria-label="工资逐格编辑" data-testid="payroll-salary-grid">
      <Space wrap style={{ marginBottom: 8 }}>
        <Typography.Text>
          {editable
            ? '金额单位：元；可直接在工资金额单元格输入，Tab 切换。'
            : '金额单位：元；本批工资为只读。'}
        </Typography.Text>
        {editable && (
          <>
            <Button
              type="primary"
              aria-label="保存表格工资"
              aria-busy={saving}
              loading={saving}
              disabled={!dirty || saving}
              onClick={() => void saveDraft()}
            >
              保存表格工资
            </Button>
            <Popconfirm title="确认放弃表格中尚未保存的工资修改？" onConfirm={discard}>
              <Button disabled={!dirty || saving}>放弃表格修改</Button>
            </Popconfirm>
          </>
        )}
      </Space>
      {dirty && (
        <Alert
          type="warning"
          showIcon
          title="表格有未保存修改，请先保存后再计算、置数或制证；保存包含筛选范围外的原有人员。"
        />
      )}
      {dirty && changedElsewhere && (
        <Alert
          type="warning"
          title="本批工资已被其他操作修改。当前输入已保留；请核对后放弃本地修改并重新录入。"
        />
      )}
      {mutation.error && <Alert type="error" showIcon title={mutation.error.message} />}
      {hasInvalidMoney && (
        <Alert
          type="error"
          showIcon
          title="金额格式无效，请修正后再保存；整批工资尚未提交。"
          description={Object.values(invalidMoney).join('；')}
        />
      )}
      {people.error && <Alert type="error" showIcon title={people.error.message} />}
      <DataTable<GridRow>
        tableId="payroll.salary"
        rowKey="employeeId"
        loading={people.isLoading}
        dataSource={visibleRows}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        rowSelection={{
          selectedRowKeys: selected,
          preserveSelectedRowKeys: true,
          onChange: (keys) => onSelectionChange(keys.map(Number)),
        }}
      />
    </section>
  );
}
