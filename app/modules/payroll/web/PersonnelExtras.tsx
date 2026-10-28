import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { queryClient, usePermission, useUnsavedChanges, useHotkey } from '@caiwu/web-kit';
import { exportToExcel, type ExcelColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import type { Employee } from '../shared';
import type { EmploymentSpell, HrField, HrFields, HrProfile } from '../shared-hr';
import { api } from './api';

const refresh = () => queryClient.invalidateQueries({ queryKey: api.pathKey() });

export default function PersonnelExtras({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const q = useQuery(api.hrProfile.queryOptions({ id: employee.id }));
  const fields = useQuery(api.hrFields.queryOptions());
  if ((q.error && !q.data) || (fields.error && !fields.data))
    return (
      <Drawer open title="基本资料 / 任职记录" onClose={onClose}>
        <Alert type="error" title={(q.error ?? fields.error)?.message} />
      </Drawer>
    );
  if (!q.data || !fields.data)
    return (
      <Drawer open title="基本资料 / 任职记录" onClose={onClose}>
        <Spin />
      </Drawer>
    );
  return (
    <ProfileEditor
      key={q.data.employeeId}
      employee={employee}
      profile={q.data}
      fields={fields.data.fields}
      onClose={onClose}
    />
  );
}

function ProfileEditor({
  employee,
  profile: latestProfile,
  fields: latestFields,
  onClose,
}: {
  employee: Employee;
  profile: HrProfile;
  fields: HrField[];
  onClose: () => void;
}) {
  const [profile] = useState(latestProfile);
  const [fields] = useState(latestFields);
  const [spells, setSpells] = useState<EmploymentSpell[]>(profile.employmentSpells);
  const [values, setValues] = useState(profile.basicValues);
  const [dirty, setDirty] = useState(false);
  const saving = useRef(false);
  const save = useMutation(
    api.saveHrProfile.mutationOptions({
      onError: () => {
        void queryClient.invalidateQueries({
          queryKey: api.hrProfile.queryOptions({ id: employee.id }).queryKey,
        });
        void queryClient.invalidateQueries({ queryKey: api.hrFields.queryOptions().queryKey });
      },
    }),
  );
  const submit = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      await save.mutateAsync({ ...profile, employmentSpells: spells, basicValues: values });
      setDirty(false);
      await refresh();
      onClose();
    } finally {
      saving.current = false;
    }
  };
  useUnsavedChanges({
    title: `${employee.name}的基本资料`,
    dirty: dirty || save.isPending,
    save: submit,
    discard: () => {
      if (saving.current) throw new Error('基本资料正在保存，请等待完成后再离开');
      setDirty(false);
      onClose();
    },
  });
  useHotkey('Ctrl+S', () => void submit().catch(() => {}));
  const close = () => {
    if (saving.current) return;
    if (!dirty || window.confirm('基本资料尚未保存，确认放弃修改？')) onClose();
  };
  const editSpell = (index: number, patch: Partial<EmploymentSpell>) => {
    if (saving.current) return;
    setSpells((old) => old.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  return (
    <Drawer
      open
      title="基本资料 / 任职记录"
      size={720}
      onClose={close}
      maskClosable={!save.isPending}
      extra={
        <Button
          type="primary"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => void submit().catch(() => {})}
        >
          保存基本资料
        </Button>
      }
    >
      <Typography.Paragraph>
        {employee.code} {employee.name}
      </Typography.Paragraph>
      {(latestProfile.employeeRevision !== profile.employeeRevision ||
        latestProfile.fieldsRevision !== profile.fieldsRevision) && (
        <Alert
          type="warning"
          title="人员或基本资料栏目已变化，当前输入已保留。请核对后关闭并重新打开。"
        />
      )}
      <Alert
        type="info"
        title="任职段不允许重叠；同一个月多次任职只计一个月。已计算工资使用的任职月数不能被覆盖。"
      />
      {save.error && (
        <Alert type="error" title={save.error.message} description="输入已保留，请核对后重试。" />
      )}
      <Typography.Title level={5}>任职记录</Typography.Title>
      {spells.map((spell, index) => (
        <Space key={index} wrap style={{ display: 'flex', marginBottom: 12 }}>
          <label>
            任职日期{' '}
            <Input
              aria-label={`任职开始${index + 1}`}
              type="date"
              value={spell.startDate}
              disabled={save.isPending}
              onChange={(e) => editSpell(index, { startDate: e.target.value })}
              style={{ width: 170 }}
            />
          </label>
          <label>
            离职日期{' '}
            <Input
              aria-label={`任职结束${index + 1}`}
              type="date"
              value={spell.endDate ?? ''}
              disabled={save.isPending}
              onChange={(e) => editSpell(index, { endDate: e.target.value || null })}
              style={{ width: 170 }}
            />
          </label>
          <Button
            danger
            disabled={spells.length === 1 || save.isPending}
            onClick={() => {
              setSpells((old) => old.filter((_, i) => i !== index));
              setDirty(true);
            }}
          >
            移除第{index + 1}段
          </Button>
        </Space>
      ))}
      <Button
        disabled={save.isPending || spells.length >= 30}
        onClick={() => {
          setSpells((old) => [...old, { startDate: '', endDate: null }]);
          setDirty(true);
        }}
      >
        增加任职记录
      </Button>
      <Typography.Title level={5}>自定义基本资料</Typography.Title>
      {!fields.some((f) => !f.disabled) && (
        <Typography.Paragraph>
          尚未设置自定义栏目，可在人事页“基本资料栏目”中增加。
        </Typography.Paragraph>
      )}
      {fields
        .filter((f) => !f.disabled)
        .map((field) => (
          <label key={field.key} style={{ display: 'block', marginBottom: 12 }}>
            {field.name}
            {field.required ? '（必填）' : ''}
            <Input
              aria-label={`基本资料-${field.key}`}
              type={field.kind === 'date' ? 'date' : 'text'}
              value={values[field.key] ?? ''}
              maxLength={200}
              disabled={save.isPending}
              onChange={(e) => {
                setValues((old) => ({ ...old, [field.key]: e.target.value }));
                setDirty(true);
              }}
            />
          </label>
        ))}
    </Drawer>
  );
}

export function PersonnelFieldEditor({ onClose }: { onClose: () => void }) {
  const q = useQuery(api.hrFields.queryOptions());
  if (q.error && !q.data)
    return (
      <Drawer open title="基本资料栏目" onClose={onClose}>
        <Alert type="error" title={q.error.message} />
      </Drawer>
    );
  if (!q.data)
    return (
      <Drawer open title="基本资料栏目" onClose={onClose}>
        <Spin />
      </Drawer>
    );
  return <FieldEditor initial={q.data} onClose={onClose} />;
}

function FieldEditor({
  initial: latestInitial,
  onClose,
}: {
  initial: HrFields;
  onClose: () => void;
}) {
  const [initial] = useState(latestInitial);
  const [fields, setFields] = useState<HrField[]>(initial.fields);
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const save = useMutation(
    api.saveHrFields.mutationOptions({
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: api.hrFields.queryOptions().queryKey });
      },
      onSuccess: () => {
        setDirty(false);
        void refresh();
        onClose();
      },
    }),
  );
  const change = (index: number, patch: Partial<HrField>) => {
    if (inFlight.current) return;
    setFields((old) => old.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    setDirty(true);
  };
  const close = () => {
    if (inFlight.current) return;
    if (!dirty || window.confirm('基本资料栏目尚未保存，确认放弃？')) onClose();
  };
  const submit = () => {
    if (inFlight.current) return inFlight.current;
    const running = save
      .mutateAsync({ revision: initial.revision, fields })
      .then(() => {})
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = running;
    return running;
  };
  useUnsavedChanges({
    title: '基本资料栏目',
    dirty: dirty || save.isPending,
    save: submit,
    discard: () => {
      if (inFlight.current) throw new Error('基本资料栏目正在保存，请等待完成后再离开');
      setDirty(false);
      onClose();
    },
  });
  useHotkey('Ctrl+S', () => {
    if (dirty) void submit().catch(() => {});
  });
  return (
    <Drawer
      open
      title="基本资料栏目"
      size={800}
      onClose={close}
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => void submit().catch(() => {})}
        >
          保存基本资料栏目
        </Button>
      }
    >
      <Alert
        type="info"
        title="变量保存后保持稳定；已有内容的栏目使用停用保留资料。支持文字及日期栏目。"
      />
      {latestInitial.revision !== initial.revision && (
        <Alert type="warning" title="基本资料栏目已变化，当前输入已保留；请关闭后重新打开核对。" />
      )}
      {save.error && <Alert type="error" title={save.error.message} description="输入已保留。" />}
      {fields.map((field, index) => (
        <Space key={index} wrap style={{ display: 'flex', marginTop: 12 }}>
          <Input
            aria-label={`基本栏目变量${index + 1}`}
            value={field.key}
            disabled={save.isPending}
            onChange={(e) => change(index, { key: e.target.value })}
            placeholder="变量，如position"
            style={{ width: 150 }}
          />
          <Input
            aria-label={`基本栏目名称${index + 1}`}
            value={field.name}
            disabled={save.isPending}
            onChange={(e) => change(index, { name: e.target.value })}
            placeholder="栏目名称"
            style={{ width: 150 }}
          />
          <Select
            aria-label={`基本栏目类型${index + 1}`}
            value={field.kind}
            disabled={save.isPending}
            options={[
              { value: 'text', label: '文字' },
              { value: 'date', label: '日期' },
            ]}
            onChange={(kind) => change(index, { kind })}
            style={{ width: 100 }}
          />
          <Checkbox
            checked={field.required}
            disabled={save.isPending}
            onChange={(e) => change(index, { required: e.target.checked })}
          >
            必填
          </Checkbox>
          <Checkbox
            checked={field.disabled}
            disabled={save.isPending}
            onChange={(e) => change(index, { disabled: e.target.checked })}
          >
            停用
          </Checkbox>
          <Button
            danger
            disabled={save.isPending}
            onClick={() => {
              setFields((old) => old.filter((_, i) => i !== index));
              setDirty(true);
            }}
          >
            移除
          </Button>
        </Space>
      ))}
      <Button
        style={{ marginTop: 16 }}
        disabled={save.isPending || fields.length >= 20}
        onClick={() => {
          setFields((old) => [
            ...old,
            { key: '', name: '', kind: 'text', required: false, disabled: false },
          ]);
          setDirty(true);
        }}
      >
        增加基本栏目
      </Button>
    </Drawer>
  );
}

export function PersonnelDelete({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const q = useQuery(
    api.previewEmployeeDelete.queryOptions({ id: employee.id, revision: employee.revision }),
  );
  const remove = useMutation(
    api.deleteEmployee.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer open title="删除人员确认" onClose={onClose} size={600}>
      <Typography.Paragraph>
        {employee.code} {employee.name}
      </Typography.Paragraph>
      {q.isLoading && <Spin />}
      {(q.error || remove.error) && (
        <Alert
          type="error"
          title={(q.error ?? remove.error)?.message}
          description="人员没有成功删除，请刷新引用后重试。"
        />
      )}
      {q.data && (
        <>
          <Alert
            type={q.data.allowed ? 'warning' : 'error'}
            title={
              q.data.allowed
                ? '该人员没有工资引用，删除后基本资料和任职记录一并移除。'
                : '人员已被工资、历史快照或凭证设置引用，不能删除；可使用停用保留历史。'
            }
          />
          <Table
            rowKey="id"
            pagination={false}
            dataSource={q.data.references}
            columns={[
              { title: '引用批次', dataIndex: 'id' },
              { title: '工资期间', dataIndex: 'period' },
              { title: '计算状态', render: (_, row) => (row.calculated ? '已计算' : '待计算') },
            ]}
          />
          {q.data.archiveReferences.map((label) => (
            <Typography.Paragraph key={label}>{label}</Typography.Paragraph>
          ))}
          <Popconfirm
            title={`确认删除 ${employee.code} ${employee.name}？`}
            onConfirm={() =>
              remove.mutate({
                id: employee.id,
                revision: employee.revision,
                hash: q.data!.hash,
                confirmed: true,
              })
            }
          >
            <Button danger loading={remove.isPending} disabled={!q.data.allowed}>
              确认删除人员
            </Button>
          </Popconfirm>
          <Button onClick={() => void q.refetch()}>刷新引用</Button>
        </>
      )}
    </Drawer>
  );
}

export function PersonnelOutput({ ids, hotkeys = true }: { ids: number[]; hotkeys?: boolean }) {
  const allowed = usePermission('payroll.export');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const output = async (print: boolean) => {
    if (busy) return;
    if (!ids.length) {
      setError('请先选中要另存或打印的人员。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await queryClient.fetchQuery({
        ...api.exportPersonnel.queryOptions({ ids }),
        staleTime: 0,
      });
      type Row = (typeof result.rows)[number];
      const columns: ExcelColumn<Row>[] = [
        { title: '人员编号', value: (r) => r.code },
        { title: '姓名', value: (r) => r.name },
        { title: '部门', value: (r) => r.departmentName },
        { title: '状态', value: (r) => (r.disabled ? '停用' : '启用') },
        {
          title: '任职记录',
          value: (r) =>
            r.employmentSpells.map((s) => `${s.startDate}—${s.endDate ?? '在职'}`).join('；'),
        },
        ...result.fields.map((f) => ({
          title: f.name,
          value: (r: Row) => r.basicValues[f.key] ?? '',
        })),
      ];
      if (!print) await exportToExcel({ fileName: '人事档案', columns, rows: result.rows });
      else
        await printHtml({
          title: '人事档案',
          orientation: 'landscape',
          html: `<h2>人事档案</h2><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${result.rows.map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(c.value(r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : '输出失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  useHotkey('Ctrl+P', () => void output(true), { enabled: allowed && hotkeys });
  if (!allowed) return null;
  return (
    <Space wrap>
      <Button disabled={!ids.length || busy} loading={busy} onClick={() => void output(false)}>
        另存人事档案
      </Button>
      <Button disabled={!ids.length || busy} onClick={() => void output(true)}>
        打印人事档案
      </Button>
      {error && <Alert type="error" title={error} />}
    </Space>
  );
}
