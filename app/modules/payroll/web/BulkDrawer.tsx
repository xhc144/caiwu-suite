import { useEffect, useRef, useState } from 'react';
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
import { formatMoney, parseMoney } from '@caiwu/core';
import { queryClient } from '@caiwu/web-kit';
import { DataTable, MoneyInput } from '@caiwu/ui';
import type { Batch } from '../shared';
import { api } from './api';
import { useMoneyDrafts } from './money-drafts';
import QuantityInput from './QuantityInput';
import { useQuantityDrafts } from './quantity-drafts';
import { quantityText } from '../quantity';
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
      batch.category.fields.find(
        (f) => (f.kind === 'money' || f.kind === 'quantity') && !f.disabled,
      )?.key ?? '',
    ),
    [value, setValue] = useState(0),
    [onlyEmpty, setOnlyEmpty] = useState(false),
    [text, setText] = useState('');
  const [quantityValue, setQuantityValue] = useState('0');
  const quantityField = batch.category.fields.find((f) => f.key === field)?.kind === 'quantity';
  const [plan, setPlan] = useState<{
      hash: string;
      expiresAt: number;
      preview: {
        code: string;
        name: string;
        field?: string;
        kind?: string;
        unit?: string;
        before: number | string | null;
        after: number | string;
      }[];
    } | null>(null),
    [error, setError] = useState('');
  const inFlight = useRef(false),
    mounted = useRef(true);
  const [phase, setPhase] = useState<'preview' | 'apply' | null>(null);
  const moneyDrafts = useMoneyDrafts();
  const quantityDrafts = useQuantityDrafts();
  const moneyKeys = mode === 'bulk' && !quantityField ? ['value'] : [];
  const quantityKeys = mode === 'bulk' && quantityField ? ['value'] : [];
  const invalidQuantity = quantityDrafts.invalidFor(quantityKeys);
  const invalidMoney = moneyDrafts.invalidFor(moneyKeys);
  const hasInvalidMoney = Object.keys(invalidMoney).length > 0;
  const locked = phase !== null;
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (inFlight.current) event.preventDefault();
    };
    const closeKey = (event: KeyboardEvent) => {
      if (
        inFlight.current &&
        ((event.ctrlKey && event.key === 'F4') || (event.altKey && event.key === 'ArrowLeft'))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        inFlight.current &&
        event.target instanceof Element &&
        event.target.closest('a[href], [role=menuitem], [role=tab], .ant-tabs-tab-remove')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', closeKey, true);
    document.addEventListener('click', navigate, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', closeKey, true);
      document.removeEventListener('click', navigate, true);
    };
  }, []);
  const begin = (next: 'preview' | 'apply') => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPhase(next);
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (mounted.current) setPhase(null);
  };
  const message = (error: unknown) =>
    error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
      ? error.message
      : '本地服务请求失败，请检查连接后重试';
  const bulk = useMutation(api.applyBulk.mutationOptions());
  const paste = useMutation(api.applyPaste.mutationOptions());
  const bulkInput = {
    id: batch.id,
    revision: batch.revision,
    employeeIds: selected,
    field,
    value: quantityField ? quantityValue : value,
    onlyEmpty,
  };
  const parsePaste = () => {
    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split('\t'));
    const header = lines.shift() ?? [];
    if (header[0] !== '编号' || header.length < 2)
      throw new Error('首行必须是「编号」及金额或数量栏目稳定变量，以制表符分隔');
    if (new Set(header).size !== header.length) throw new Error('粘贴栏目重复');
    return {
      id: batch.id,
      revision: batch.revision,
      rows: lines
        .filter((l) => l.some((v) => v.trim()))
        .map((line, index) => {
          if (line.length > header.length) throw new Error(`第${index + 2}行单元格超过表头范围`);
          const values: Record<string, number> = {};
          const quantities: Record<string, string> = {};
          for (let i = 1; i < header.length; i++) {
            const raw = line[i]?.trim();
            if (!raw) continue;
            const target = batch.category.fields.find((f) => f.key === header[i] && !f.disabled);
            if (target?.kind === 'quantity') {
              const quantity = quantityText(raw);
              if (quantity === null)
                throw new Error(`第${index + 2}行 ${header[i]} 数量格式无效，最多六位小数`);
              quantities[header[i]!] = quantity;
            } else {
              if (target?.kind !== 'money')
                throw new Error(`第${index + 2}行 ${header[i]} 不是启用的录入栏目`);
              const amount = parseMoney(raw);
              if (amount == null) throw new Error(`第${index + 2}行 ${header[i]} 不是有效金额`);
              values[header[i]!] = amount;
            }
          }
          return {
            code: line[0]?.trim() ?? '',
            values,
            ...(Object.keys(quantities).length ? { quantities } : {}),
          };
        }),
    };
  };
  const preview = async () => {
    if (mode === 'bulk' && !moneyDrafts.validate(moneyKeys)) return;
    if (mode === 'bulk' && !quantityDrafts.validate(quantityKeys)) return;
    if (!begin('preview')) return;
    setPlan(null);
    setError('');
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
      if (mounted.current) setPlan(p);
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      finish();
    }
  };
  const apply = async () => {
    if (mode === 'bulk' && !moneyDrafts.validate(moneyKeys)) return;
    if (mode === 'bulk' && !quantityDrafts.validate(quantityKeys)) return;
    if (!plan || !begin('apply')) return;
    setError('');
    try {
      if (mode === 'bulk')
        await bulk.mutateAsync({ ...bulkInput, hash: plan.hash, confirmed: true });
      else await paste.mutateAsync({ ...parsePaste(), hash: plan.hash, confirmed: true });
      void queryClient.invalidateQueries({ queryKey: api.pathKey() });
      if (mounted.current) {
        onSaved();
        onClose();
      }
    } catch (e) {
      if (mounted.current) setError(`批量修改未完成，草稿已保留：${message(e)}`);
    } finally {
      finish();
    }
  };
  return (
    <Drawer
      open
      size="large"
      title="统一置数 / Excel 粘贴"
      closable={!locked}
      keyboard={!locked}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <Select
        aria-label="批量操作"
        disabled={locked}
        value={mode}
        onChange={(m) => {
          if (inFlight.current) return;
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
              disabled={locked}
              value={field}
              options={batch.category.fields
                .filter((f) => (f.kind === 'money' || f.kind === 'quantity') && !f.disabled)
                .map((f) => ({ value: f.key, label: f.name }))}
              onChange={(v) => {
                if (inFlight.current) return;
                setField(v);
                setPlan(null);
              }}
            />
            {quantityField ? (
              <QuantityInput
                aria-label="统一数量"
                value={quantityValue}
                draftText={quantityDrafts.text('value')}
                disabled={locked}
                status={Object.keys(invalidQuantity).length ? 'error' : undefined}
                onDraftChange={(raw) => {
                  if (!inFlight.current) {
                    quantityDrafts.observe('value', raw);
                    setPlan(null);
                  }
                }}
                onChange={(quantity) => {
                  if (!inFlight.current) {
                    setQuantityValue(quantity ?? '0');
                    setPlan(null);
                  }
                }}
              />
            ) : (
              <MoneyInput
                resetKey={moneyDrafts.resetKey}
                aria-label="统一金额"
                disabled={locked}
                value={value}
                status={hasInvalidMoney ? 'error' : undefined}
                aria-invalid={hasInvalidMoney}
                draftText={moneyDrafts.text('value')}
                onDraftStateChange={(state) => {
                  if (inFlight.current) return;
                  if (moneyDrafts.observe('value', state)) setPlan(null);
                }}
                onChange={(v) => {
                  if (inFlight.current) return;
                  setValue(v ?? 0);
                  setPlan(null);
                }}
              />
            )}
            <Checkbox
              disabled={locked}
              checked={onlyEmpty}
              onChange={(e) => {
                if (inFlight.current) return;
                setOnlyEmpty(e.target.checked);
                setValue(0);
                moneyDrafts.clear();
                setQuantityValue('0');
                quantityDrafts.clear();
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
            复制「编号」及金额/数量稳定变量列，如：编号、base、hours。金额按元录入，数量按栏目单位录入且最多六位小数；使用制表符分列，空单元格保留原值。仅修改当前批次已有人员。
          </Typography.Paragraph>
          <Input.TextArea
            aria-label="Excel 粘贴内容"
            disabled={locked}
            rows={8}
            value={text}
            onChange={(e) => {
              if (inFlight.current) return;
              setText(e.target.value);
              setPlan(null);
            }}
            placeholder={'编号\tbase\tbonus\nS001\t10000\t500'}
          />
        </>
      )}
      <p>
        <Button disabled={locked} loading={phase === 'preview'} onClick={() => void preview()}>
          预览修改范围
        </Button>
      </p>
      {error && <Alert type="error" title={error} />}
      {mode === 'bulk' && hasInvalidMoney && (
        <Alert
          type="error"
          title="金额格式无效，请修正后再预览或保存。"
          description={Object.values(invalidMoney).join('；')}
        />
      )}
      {mode === 'bulk' && Object.keys(invalidQuantity).length > 0 && (
        <Alert
          type="error"
          title="数量格式无效，请输入最多六位小数后再预览或保存。"
          description={Object.values(invalidQuantity).join('；')}
        />
      )}
      {plan && (
        <>
          <Typography.Paragraph>
            预览有效至 {new Date(plan.expiresAt).toLocaleString('zh-CN')}
            ；人员、工资或结构变化后须重新预览。
          </Typography.Paragraph>
          <DataTable
            tableId="payroll.bulk"
            rowKey={(_, i) => i!}
            dataSource={plan.preview}
            columns={[
              { key: 'code', title: '编号', dataIndex: 'code', width: 100 },
              { key: 'name', title: '姓名', dataIndex: 'name', width: 120 },
              { key: 'field', title: '栏目', dataIndex: 'field', width: 100 },
              {
                key: 'before',
                title: '修改前',
                render: (_, row) =>
                  row.before === null
                    ? '空白'
                    : row.kind === 'quantity'
                      ? `${row.before}${row.unit ?? ''}`
                      : formatMoney(row.before as number),
              },
              {
                key: 'after',
                title: '修改后',
                render: (_, row) =>
                  row.kind === 'quantity'
                    ? `${row.after}${row.unit ?? ''}`
                    : formatMoney(row.after as number),
              },
            ]}
          />
          <Popconfirm
            title="确认仅修改预览所列人员和单元格？原计算结果将清除，需要重新计算。"
            onConfirm={apply}
            disabled={locked}
            okButtonProps={{ disabled: locked }}
            cancelButtonProps={{ disabled: locked }}
          >
            <Button type="primary" disabled={locked} loading={phase === 'apply'}>
              确认批量修改
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
