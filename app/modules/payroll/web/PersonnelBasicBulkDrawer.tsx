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
  Typography,
} from 'antd';
import { queryClient, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable } from '@caiwu/ui';
import type { Employee } from '../shared';
import type { HrFields } from '../shared-hr';
import { api } from './api';

export default function PersonnelBasicBulkDrawer({
  employees,
  onClose,
}: {
  employees: Employee[];
  onClose: () => void;
}) {
  const q = useQuery(api.hrFields.queryOptions());
  if (!q.data)
    return (
      <Drawer open title="自定义资料统一置数" onClose={onClose}>
        {q.error ? <Alert type="error" title={q.error.message} /> : <Spin />}
      </Drawer>
    );
  return <Editor employees={employees} initial={q.data} latest={q.data} onClose={onClose} />;
}

function Editor({
  employees,
  initial,
  latest,
  onClose,
}: {
  employees: Employee[];
  initial: HrFields;
  latest: HrFields;
  onClose: () => void;
}) {
  const [schema] = useState(initial);
  const [scope] = useState(employees);
  const [field, setField] = useState(schema.fields.find((f) => !f.disabled)?.key ?? '');
  const [value, setValue] = useState(''),
    [onlyEmpty, setOnlyEmpty] = useState(false);
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState('');
  const [phase, setPhase] = useState<'preview' | 'apply' | null>(null);
  const busy = useRef(false);
  const [preview, setPreview] = useState<{
    hash: string;
    label: string;
    preview: {
      employeeId: number;
      code: string;
      name: string;
      before: string;
      after: string;
      changed: boolean;
    }[];
  } | null>(null);
  const mutation = useMutation(api.applyHrBasicBulk.mutationOptions());
  const selected = schema.fields.find((f) => f.key === field);
  const close = () => {
    if (busy.current) return;
    if (!dirty || window.confirm('自定义资料置数尚未应用，确认放弃输入？')) onClose();
  };
  useUnsavedChanges({
    title: '自定义资料统一置数',
    dirty,
    save: async () => {
      throw new Error('请回到自定义资料统一置数窗口，预览并确认修改后再离开。');
    },
    discard: () => {
      if (!busy.current) {
        setDirty(false);
        onClose();
      }
    },
  });
  const changed = () => {
    if (busy.current) return false;
    setPreview(null);
    setDirty(true);
    setError('');
    return true;
  };
  const input = { employeeIds: scope.map((e) => e.id), field, value, onlyEmpty };
  const inspect = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase('preview');
    setError('');
    setPreview(null);
    try {
      setPreview(
        await queryClient.fetchQuery({
          ...api.previewHrBasicBulk.queryOptions(input),
          staleTime: 0,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败，输入已保留');
    } finally {
      busy.current = false;
      setPhase(null);
    }
  };
  const apply = async () => {
    if (busy.current || !preview) return;
    busy.current = true;
    setPhase('apply');
    setError('');
    try {
      await mutation.mutateAsync({ ...input, hash: preview.hash, confirmed: true });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: api.pathKey() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，输入已保留');
    } finally {
      busy.current = false;
      setPhase(null);
    }
  };
  return (
    <Drawer
      open
      title="自定义资料统一置数"
      size={820}
      onClose={close}
      extra={
        <Button disabled={phase !== null} onClick={close}>
          取消
        </Button>
      }
    >
      <Typography.Paragraph>
        修改范围：{scope.map((e) => `${e.code} ${e.name}`).join('、')}。范围外人员保留原资料。
      </Typography.Paragraph>
      {latest.revision !== schema.revision && (
        <Alert type="warning" title="基本资料栏目已变化，输入已保留；请关闭后重新打开核对。" />
      )}
      <Space wrap>
        <Select
          aria-label="自定义置数栏目"
          value={field || undefined}
          disabled={phase !== null}
          options={schema.fields
            .filter((f) => !f.disabled)
            .map((f) => ({ value: f.key, label: f.name }))}
          onChange={(next) => {
            if (changed()) {
              setField(next);
              setValue('');
            }
          }}
          style={{ width: 180 }}
        />
        <Input
          aria-label="自定义资料统一值"
          type={selected?.kind === 'date' ? 'date' : 'text'}
          value={value}
          maxLength={200}
          disabled={phase !== null || !selected}
          onChange={(e) => {
            if (changed()) setValue(e.target.value);
          }}
          style={{ width: 280 }}
        />
        <Checkbox
          checked={onlyEmpty}
          disabled={phase !== null}
          onChange={(e) => {
            if (changed()) setOnlyEmpty(e.target.checked);
          }}
        >
          仅补空白项
        </Checkbox>
        <Button
          disabled={!selected || !scope.length || phase !== null}
          loading={phase === 'preview'}
          onClick={() => void inspect()}
        >
          预览自定义资料修改
        </Button>
      </Space>
      {!selected && (
        <Alert type="info" title="没有可用的自定义栏目，请先在人事页“基本资料栏目”中增加。" />
      )}
      {error && (
        <Alert type="error" title={error} description="输入和范围已保留，核对后可以重新预览。" />
      )}
      {preview && (
        <>
          <Typography.Paragraph>
            修改栏目：{preview.label}；实际变化 {preview.preview.filter((r) => r.changed).length}{' '}
            人。
          </Typography.Paragraph>
          <DataTable
            tableId="payroll.hr.basic-bulk"
            rowKey="employeeId"
            dataSource={preview.preview}
            columns={[
              { key: 'code', title: '人员编号', dataIndex: 'code' },
              { key: 'name', title: '姓名', dataIndex: 'name' },
              { key: 'before', title: '修改前', dataIndex: 'before' },
              { key: 'after', title: '修改后', dataIndex: 'after' },
              { key: 'changed', title: '变化', render: (_, r) => (r.changed ? '修改' : '保留') },
            ]}
          />
          <Popconfirm title="确认修改预览列出的基本资料？" onConfirm={() => void apply()}>
            <Button type="primary" disabled={phase !== null} loading={phase === 'apply'}>
              确认自定义资料置数
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
