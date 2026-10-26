import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Typography,
} from 'antd';
import { parseMoney } from '@caiwu/core';
import { queryClient, notify } from '@caiwu/web-kit';
import { DataTable, MoneyInput } from '@caiwu/ui';
import type { Batch } from '../shared';
import { api } from './api';
export default function BulkDrawer({
  batch,
  selected,
  onClose,
  onSaved,
}: {
  batch: Batch;
  selected: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<'bulk' | 'paste'>('bulk'),
    [field, setField] = useState(
      batch.category.fields.find((f) => f.kind === 'money' && !f.disabled)?.key ?? '',
    ),
    [value, setValue] = useState(0),
    [onlyEmpty, setOnlyEmpty] = useState(false),
    [text, setText] = useState('');
  const [plan, setPlan] = useState<{
      hash: string;
      preview: {
        code: string;
        name: string;
        field?: string;
        before: number | null;
        after: number;
      }[];
    } | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const bulk = useMutation(
    api.applyBulk.mutationOptions({
      onSuccess: () => {
        onSaved();
        onClose();
      },
    }),
  );
  const paste = useMutation(
    api.applyPaste.mutationOptions({
      onSuccess: () => {
        onSaved();
        onClose();
      },
    }),
  );
  const bulkInput = {
    id: batch.id,
    revision: batch.revision,
    employeeIds: selected,
    field,
    value,
    onlyEmpty,
  };
  const parsePaste = () => {
    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split('\t'));
    const header = lines.shift() ?? [];
    if (header[0] !== '编号' || header.length < 2)
      throw new Error('首行必须是「编号」及金额栏目稳定变量，以制表符分隔');
    if (new Set(header).size !== header.length) throw new Error('粘贴栏目重复');
    return {
      id: batch.id,
      revision: batch.revision,
      rows: lines
        .filter((l) => l.some((v) => v.trim()))
        .map((line, index) => {
          if (line.length > header.length) throw new Error(`第${index + 2}行单元格超过表头范围`);
          const values: Record<string, number> = {};
          for (let i = 1; i < header.length; i++) {
            const raw = line[i]?.trim();
            if (!raw) continue;
            const amount = parseMoney(raw);
            if (amount == null) throw new Error(`第${index + 2}行 ${header[i]} 不是有效金额`);
            values[header[i]!] = amount;
          }
          return { code: line[0]?.trim() ?? '', values };
        }),
    };
  };
  const preview = async () => {
    setPlan(null);
    setError('');
    setWorking(true);
    try {
      const p =
        mode === 'bulk'
          ? await queryClient.fetchQuery({
              ...api.previewBulk.queryOptions(bulkInput),
              staleTime: 0,
            })
          : await queryClient.fetchQuery({
              ...api.previewPaste.queryOptions(parsePaste()),
              staleTime: 0,
            });
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败，检查范围和数据');
    } finally {
      setWorking(false);
    }
  };
  const apply = () => {
    if (!plan) return;
    if (mode === 'bulk') bulk.mutate({ ...bulkInput, hash: plan.hash, confirmed: true });
    else
      try {
        paste.mutate({ ...parsePaste(), hash: plan.hash, confirmed: true });
      } catch (e) {
        notify.warning(e instanceof Error ? e.message : '粘贴数据无效');
      }
  };
  return (
    <Drawer open size="large" title="统一置数 / Excel 粘贴" onClose={onClose}>
      <Select
        aria-label="批量操作"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setPlan(null);
        }}
        options={[
          { value: 'bulk', label: '统一置数 / 空值设零' },
          { value: 'paste', label: 'Excel 粘贴' },
        ]}
      />
      {mode === 'bulk' ? (
        <>
          <p>只作用于工资表已勾选的 {selected.length} 人；取消不修改数据。</p>
          <Space wrap>
            <Select
              aria-label="置数栏目"
              value={field}
              options={batch.category.fields
                .filter((f) => f.kind === 'money' && !f.disabled)
                .map((f) => ({ value: f.key, label: f.name }))}
              onChange={(v) => {
                setField(v);
                setPlan(null);
              }}
            />
            <MoneyInput
              aria-label="统一金额"
              value={value}
              onChange={(v) => {
                setValue(v ?? 0);
                setPlan(null);
              }}
            />
            <Checkbox
              checked={onlyEmpty}
              onChange={(e) => {
                setOnlyEmpty(e.target.checked);
                setValue(0);
                setPlan(null);
              }}
            >
              只填空值（已有零保留）
            </Checkbox>
          </Space>
        </>
      ) : (
        <>
          <Typography.Paragraph>
            从 Excel
            复制「编号」及金额稳定变量列，如：编号、base、bonus。使用制表符分列；空单元格保留原值。仅修改当前批次已有人员。
          </Typography.Paragraph>
          <Input.TextArea
            aria-label="Excel 粘贴内容"
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPlan(null);
            }}
            placeholder={'编号\tbase\tbonus\nS001\t10000\t500'}
          />
        </>
      )}
      <p>
        <Button loading={working} onClick={() => void preview()}>
          预览修改范围
        </Button>
      </p>
      {error && <Alert type="error" title={error} />}
      {plan && (
        <>
          <DataTable
            tableId="payroll.bulk"
            rowKey={(_, i) => i!}
            dataSource={plan.preview}
            columns={[
              { key: 'code', title: '编号', dataIndex: 'code', width: 100 },
              { key: 'name', title: '姓名', dataIndex: 'name', width: 120 },
              { key: 'field', title: '栏目', dataIndex: 'field', width: 100 },
              { key: 'before', title: '修改前', dataIndex: 'before', money: true },
              { key: 'after', title: '修改后', dataIndex: 'after', money: true },
            ]}
          />
          <Popconfirm
            title="确认仅修改预览所列人员和单元格？原计算结果将清除，需要重新计算。"
            onConfirm={apply}
          >
            <Button type="primary" loading={bulk.isPending || paste.isPending}>
              确认批量修改
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
