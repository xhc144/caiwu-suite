import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
} from 'antd';
import { queryClient, useSubmission, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable, DimensionSelect } from '@caiwu/ui';
import type { Employee } from '../shared';
import {
  PERSONNEL_BULK_FIELDS,
  PersonnelBulkInputSchema,
  type PersonnelBulkInput,
  type PersonnelBulkPreview,
} from '../shared-personnel';
import { api } from './api';

const initialValue = (field: PersonnelBulkInput['field']): PersonnelBulkInput['value'] => {
  if (field === 'disabled' || field === 'qualificationConfirmed') return false;
  if (field === 'taxKind') return 'resident';
  if (field === 'policy') return 'employment';
  if (field === 'name' || field === 'startDate') return '';
  return null;
};

export default function PersonnelBulkDrawer({
  employees,
  onClose,
  onApplied,
}: {
  employees: Employee[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [field, setField] = useState<PersonnelBulkInput['field']>('departmentId');
  const [value, setValue] = useState<PersonnelBulkInput['value']>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [plan, setPlan] = useState<PersonnelBulkPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const { isSubmitting, submit } = useSubmission();
  const applyMutation = useMutation(api.applyPersonnelBulk.mutationOptions());
  const message = (e: unknown) =>
    e instanceof Error && /[\u3400-\u9fff]/.test(e.message)
      ? e.message
      : '请求失败，请检查本地服务连接后重试';
  useUnsavedChanges({
    title: '人事基本项统一置数',
    dirty,
    version: JSON.stringify({ field, value, onlyEmpty, scope: employees.map((e) => e.id) }),
    save: async () => {
      setError('请先在置数窗口预览并确认修改，再离开本页');
      return false;
    },
    discard: () => {
      if (isSubmitting) throw new Error('正在处理人事置数，请稍候');
      setDirty(false);
      onClose();
    },
  });
  const updateValue = (next: PersonnelBulkInput['value']) => {
    if (isSubmitting) return;
    setValue(next);
    setDirty(true);
    setPlan(null);
    setError('');
  };
  const input = (): PersonnelBulkInput =>
    PersonnelBulkInputSchema.parse({
      employeeIds: employees.map((e) => e.id),
      field,
      value,
      onlyEmpty,
    });
  const preview = () =>
    submit(async () => {
      setPlan(null);
      setError('');
      setDirty(true);
      try {
        setPlan(
          await queryClient.fetchQuery({
            ...api.previewPersonnelBulk.queryOptions(input()),
            staleTime: 0,
          }),
        );
      } catch (e) {
        setError(message(e));
      }
    });
  const apply = () =>
    submit(async () => {
      if (!plan) return;
      setError('');
      try {
        await applyMutation.mutateAsync({ ...input(), hash: plan.hash, confirmed: true });
        setDirty(false);
        void queryClient.invalidateQueries({ queryKey: api.pathKey() });
        onApplied();
        onClose();
      } catch (e) {
        setError(`保存请求失败，输入已保留。请重新预览核对当前资料：${message(e)}`);
      }
    });
  const close = () => {
    if (isSubmitting) return;
    setDirty(false);
    onClose();
  };
  let editor;
  if (field === 'departmentId')
    editor = (
      <DimensionSelect
        aria-label="人事统一部门"
        type="department"
        style={{ width: 240 }}
        disabled={isSubmitting}
        value={typeof value === 'number' ? value : undefined}
        onChange={(v) => updateValue(v ?? null)}
      />
    );
  else if (field === 'disabled' || field === 'qualificationConfirmed')
    editor = (
      <Select
        aria-label="人事统一状态"
        style={{ width: 240 }}
        disabled={isSubmitting}
        value={value === true ? 1 : 0}
        options={[
          { value: 0, label: field === 'disabled' ? '启用' : '未确认' },
          { value: 1, label: field === 'disabled' ? '停用' : '已确认' },
        ]}
        onChange={(v) => updateValue(v === 1)}
      />
    );
  else if (field === 'taxKind' || field === 'policy')
    editor = (
      <Select
        aria-label="人事统一计税方式"
        style={{ width: 240 }}
        disabled={isSubmitting}
        value={typeof value === 'string' ? value : undefined}
        options={
          field === 'taxKind'
            ? [
                { value: 'resident', label: '居民工资薪金' },
                { value: 'nonresident', label: '非居民（工资计算暂不支持）' },
                { value: 'labor', label: '劳务（工资计算暂不支持）' },
                { value: 'bonus', label: '年终奖（工资计算暂不支持）' },
              ]
            : [
                { value: 'employment', label: '按任职月数' },
                { value: 'annual60000', label: '年度六万元资格' },
                { value: 'firstIncome', label: '首次取得工资资格' },
              ]
        }
        onChange={updateValue}
      />
    );
  else if (field === 'qualificationYear')
    editor = (
      <InputNumber
        aria-label="人事统一资格年度"
        min={2019}
        max={2100}
        precision={0}
        disabled={isSubmitting}
        value={typeof value === 'number' ? value : null}
        onChange={(v) => updateValue(v)}
        placeholder="空白表示清除资格年度"
        style={{ width: 240 }}
      />
    );
  else
    editor = (
      <Input
        aria-label="人事统一修改值"
        type={field === 'name' ? 'text' : 'date'}
        disabled={isSubmitting}
        value={typeof value === 'string' ? value : ''}
        maxLength={field === 'name' ? 60 : undefined}
        onChange={(e) => updateValue(e.target.value || (field === 'endDate' ? null : ''))}
        style={{ width: 240 }}
      />
    );
  return (
    <Drawer
      open
      size="large"
      title="人事基本项统一置数"
      closable={!isSubmitting}
      keyboard={!isSubmitting}
      onClose={close}
      extra={
        <Button disabled={isSubmitting} onClick={close}>
          取消
        </Button>
      }
    >
      <p>本次范围共 {employees.length} 人。只修改选定栏目；取消不会修改人员档案。</p>
      <Space wrap>
        <Select
          aria-label="人事置数栏目"
          value={field}
          disabled={isSubmitting}
          options={[...PERSONNEL_BULK_FIELDS]}
          style={{ width: 180 }}
          onChange={(next) => {
            setField(next);
            setValue(initialValue(next));
            setOnlyEmpty(false);
            setDirty(true);
            setPlan(null);
            setError('');
          }}
        />
        {editor}
        {(field === 'endDate' || field === 'qualificationYear') && (
          <Checkbox
            checked={onlyEmpty}
            disabled={isSubmitting}
            onChange={(e) => {
              setOnlyEmpty(e.target.checked);
              setDirty(true);
              setPlan(null);
            }}
          >
            只填空白
          </Checkbox>
        )}
      </Space>
      {(field === 'startDate' || field === 'endDate' || field === 'policy') && (
        <p>已计算工资的任职日期及计税历史继续受原有校验保护；任一人员保存失败时整批不变。</p>
      )}
      <p>
        <Button disabled={isSubmitting || !employees.length} onClick={() => void preview()}>
          预览人事修改
        </Button>
      </p>
      {error && <Alert type="error" showIcon title={error} />}
      {plan && (
        <>
          <p>
            修改栏目：{plan.label}；实际变化 {plan.preview.filter((r) => r.changed).length} 人。
          </p>
          <DataTable
            tableId="payroll.personnel-bulk"
            rowKey="employeeId"
            dataSource={plan.preview}
            columns={[
              { key: 'code', title: '编号', dataIndex: 'code', width: 110 },
              { key: 'name', title: '姓名', dataIndex: 'name', width: 120 },
              { key: 'before', title: '修改前', dataIndex: 'beforeText', width: 180 },
              { key: 'after', title: '修改后', dataIndex: 'afterText', width: 180 },
              {
                key: 'changed',
                title: '变化',
                width: 100,
                render: (_, row) => (row.changed ? '将修改' : '保留原值'),
              },
            ]}
          />
          <Popconfirm
            title="确认仅修改预览所列人员的基本项？"
            okButtonProps={{ disabled: isSubmitting }}
            cancelButtonProps={{ disabled: isSubmitting }}
            // 弹层只确认意图；提交状态由抽屉统一管理，失败后可重新打开确认。
            onConfirm={() => void apply()}
          >
            <Button
              type="primary"
              aria-label="确认人事置数"
              aria-busy={isSubmitting}
              loading={isSubmitting}
              disabled={isSubmitting || !plan.preview.some((r) => r.changed)}
            >
              确认人事置数
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
