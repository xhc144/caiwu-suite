import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Input, Popconfirm, Space } from 'antd';
import { formatMoney } from '@caiwu/core';
import { queryClient, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable, MoneyInput } from '@caiwu/ui';
import type { Batch, RowInput, TaxInput } from '../shared';
import { api } from './api';
import { useMoneyDrafts } from './money-drafts';
import QuantityInput from './QuantityInput';
import { useQuantityDrafts } from './quantity-drafts';

type Plan = {
  hash: string;
  expiresAt: string;
  changes: {
    id: number;
    period: number;
    categoryName: string;
    employeeCount: number;
    beforeGross: number;
    afterGross: number;
    beforeTax: number;
    afterTax: number;
    beforeNet: number;
    afterNet: number;
  }[];
};
const taxFields: { key: keyof Omit<TaxInput, 'confirmed'>; name: string }[] = [
  { key: 'exempt', name: '本次免税收入' },
  { key: 'special', name: '专项扣除' },
  { key: 'additional', name: '专项附加扣除' },
  { key: 'other', name: '其他扣除' },
  { key: 'relief', name: '税额减免' },
  { key: 'openingIncome', name: '系统外期初收入' },
  { key: 'openingTax', name: '系统外期初已扣税' },
];
export default function HistoryDrawer({
  batch: incomingBatch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const [batch] = useState(() => incomingBatch);
  const [rows, setRows] = useState<RowInput[]>(() => structuredClone(batch.rows));
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const drafts = useMoneyDrafts();
  const quantityDrafts = useQuantityDrafts();
  const fields = batch.category.fields.filter((f) => f.kind === 'money' && !f.disabled);
  const quantityFields = batch.category.fields.filter((f) => f.kind === 'quantity' && !f.disabled);
  const quantityKeys = rows.flatMap((row) =>
    quantityFields.map((f) => `${row.employeeId}.quantities.${f.key}`),
  );
  const invalidQuantity = Object.keys(quantityDrafts.invalidFor(quantityKeys)).length > 0;
  const keys = rows.flatMap((row) => [
    ...fields.map((f) => `${row.employeeId}.values.${f.key}`),
    ...taxFields.map((f) => `${row.employeeId}.tax.${f.key}`),
  ]);
  const invalid = Object.keys(drafts.invalidFor(keys)).length > 0;
  const dirty =
    JSON.stringify(rows) !== JSON.stringify(batch.rows) ||
    invalid ||
    invalidQuantity ||
    reason.length > 0;
  const history = useQuery(api.correctionHistory.queryOptions({ id: batch.id }));
  const apply = useMutation(api.applyCorrection.mutationOptions());
  useUnsavedChanges({
    title: `${batch.period}前期工资更正`,
    dirty,
    version: JSON.stringify({ rows, reason, invalid, invalidQuantity }),
    save: async () => {
      setError('请先在前期更正窗口预览并确认完整影响后保存。');
      return false;
    },
    discard: () => {
      if (inFlight.current) throw new Error('前期更正正在处理，请等待完成后再离开');
      setRows(structuredClone(batch.rows));
      setReason('');
      setPlan(null);
      drafts.clear();
      quantityDrafts.clear();
    },
  });
  const patch = (employeeId: number, group: 'values' | 'tax', field: string, value: number) => {
    if (inFlight.current) return;
    setRows((current) =>
      current.map((r) =>
        r.employeeId === employeeId ? { ...r, [group]: { ...r[group], [field]: value } } : r,
      ),
    );
    setPlan(null);
  };
  const preview = async () => {
    setPlan(null);
    if (!drafts.validate(keys)) {
      setError('金额格式无效，请修正后再预览；更正尚未提交。');
      return;
    }
    if (!quantityDrafts.validate(quantityKeys)) {
      setError('数量格式无效，请修正后再预览；更正尚未提交。');
      return;
    }
    if (reason.trim().length < 2) {
      setError('请填写至少两字的更正原因。');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      setPlan(
        await queryClient.fetchQuery({
          ...api.previewCorrection.queryOptions({
            id: batch.id,
            revision: batch.revision,
            reason,
            rows,
          }),
          staleTime: 0,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '更正预览失败，请重试');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (
      !plan ||
      inFlight.current ||
      !drafts.validate(keys) ||
      !quantityDrafts.validate(quantityKeys)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await apply.mutateAsync({
        id: batch.id,
        revision: batch.revision,
        reason,
        rows,
        ...plan,
        confirmed: true,
      });
      setRows(structuredClone(batch.rows));
      setReason('');
      drafts.clear();
      quantityDrafts.clear();
      await queryClient.invalidateQueries({ queryKey: api.pathKey() });
      onClose();
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : '更正保存失败，输入已保留');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const money = (row: RowInput, group: 'values' | 'tax', field: string) => {
    const key = `${row.employeeId}.${group}.${field}`;
    return (
      <MoneyInput
        aria-label={`更正-${key}`}
        allowNegative={group !== 'tax'}
        disabled={busy}
        value={row[group][field as keyof (typeof row)[typeof group]] as number | undefined}
        draftText={drafts.text(key)}
        resetKey={drafts.resetKey}
        onDraftStateChange={(state) => {
          if (!inFlight.current && drafts.observe(key, state)) setPlan(null);
        }}
        onChange={(value) => patch(row.employeeId, group, field, value ?? 0)}
      />
    );
  };
  return (
    <Drawer
      open
      title="前期工资更正"
      size={1100}
      maskClosable={!busy}
      closable={!busy}
      onClose={() => {
        if (!busy && (!dirty || window.confirm('放弃尚未提交的前期更正？'))) onClose();
      }}
    >
      {incomingBatch.revision !== batch.revision && (
        <Alert
          type="warning"
          title="工资批次已在其他窗口更新，当前更正草稿已保留；请核对后重新打开，不能覆盖新版本。"
        />
      )}
      <Alert
        type="info"
        title="使用原工资结构和原人事快照重算同年受影响批次。已结账或已制证批次必须先按正常流程处理；更正前后快照保留。"
      />
      <p>
        2019年起扣除为年内累计；历史月税制扣除为当月数。同月跨类别扣除及后续期初变更会列入级联预览。
      </p>
      <label>
        更正原因{' '}
        <Input
          aria-label="更正原因"
          value={reason}
          disabled={busy}
          maxLength={200}
          onChange={(e) => {
            setReason(e.target.value);
            setPlan(null);
          }}
        />
      </label>
      {error && <Alert type="error" title={error} />}
      {invalid && <Alert type="error" title="金额格式无效，请修正后再预览；整批更正尚未提交。" />}
      {invalidQuantity && (
        <Alert type="error" title="数量格式无效，请修正后再预览；整批更正尚未提交。" />
      )}
      <Button
        disabled={busy}
        onClick={() => {
          void queryClient
            .fetchQuery({ ...api.batch.queryOptions({ id: batch.id }), staleTime: 0 })
            .catch((e: unknown) =>
              setError(e instanceof Error ? e.message : '核对最新工资失败，草稿已保留'),
            );
        }}
      >
        核对最新工资
      </Button>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table aria-label="前期工资更正录入">
          <thead>
            <tr>
              <th>人员</th>
              {fields.map((f) => (
                <th key={f.key}>{f.name}（元）</th>
              ))}
              {quantityFields.map((f) => (
                <th key={f.key}>
                  {f.name}（{f.unit || '数量'}）
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeId}>
                <td>
                  {batch.snapshots.find((r) => r.employeeId === row.employeeId)?.employee.name}
                </td>
                {fields.map((f) => (
                  <td key={f.key} style={{ minWidth: 150 }}>
                    {money(row, 'values', f.key)}
                  </td>
                ))}
                {quantityFields.map((f) => {
                  const key = `${row.employeeId}.quantities.${f.key}`;
                  return (
                    <td key={f.key} style={{ minWidth: 150 }}>
                      <QuantityInput
                        aria-label={`更正-${key}`}
                        disabled={busy}
                        value={row.quantities?.[f.key]}
                        draftText={quantityDrafts.text(key)}
                        onDraftChange={(raw) => {
                          if (!inFlight.current) {
                            quantityDrafts.observe(key, raw);
                            setPlan(null);
                          }
                        }}
                        onChange={(value) => {
                          if (inFlight.current) return;
                          setRows((current) =>
                            current.map((r) => {
                              if (r.employeeId !== row.employeeId) return r;
                              const quantities = { ...r.quantities };
                              if (value === undefined) delete quantities[f.key];
                              else quantities[f.key] = value;
                              return { ...r, quantities };
                            }),
                          );
                          setPlan(null);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>更正扣除和期初数</summary>
        {rows.map((row) => (
          <div key={row.employeeId}>
            <strong>
              {batch.snapshots.find((r) => r.employeeId === row.employeeId)?.employee.name}
            </strong>
            <Space wrap>
              {taxFields.map((field) => (
                <label key={field.key}>
                  {field.name}（元）{money(row, 'tax', field.key)}
                </label>
              ))}
            </Space>
          </div>
        ))}
      </details>
      <Button type="primary" loading={busy} disabled={busy} onClick={() => void preview()}>
        预览级联更正
      </Button>
      {plan && (
        <>
          <DataTable
            tableId="payroll.correction-preview"
            rowKey="id"
            dataSource={plan.changes}
            columns={[
              { key: 'period', title: '期间', dataIndex: 'period', width: 100 },
              { key: 'category', title: '工资类别', dataIndex: 'categoryName', width: 130 },
              {
                key: 'beforeGross',
                title: '更正前应发',
                dataIndex: 'beforeGross',
                money: true,
                width: 140,
              },
              {
                key: 'afterGross',
                title: '更正后应发',
                dataIndex: 'afterGross',
                money: true,
                width: 140,
              },
              {
                key: 'beforeTax',
                title: '更正前税额',
                dataIndex: 'beforeTax',
                money: true,
                width: 140,
              },
              {
                key: 'afterTax',
                title: '更正后税额',
                dataIndex: 'afterTax',
                money: true,
                width: 140,
              },
              {
                key: 'beforeNet',
                title: '更正前实发',
                dataIndex: 'beforeNet',
                money: true,
                width: 140,
              },
              {
                key: 'afterNet',
                title: '更正后实发',
                dataIndex: 'afterNet',
                money: true,
                width: 140,
              },
            ]}
          />
          <Popconfirm
            title={`确认更正并重算这${plan.changes.length}个批次？`}
            onConfirm={() => void confirm()}
          >
            <Button loading={busy} disabled={busy || invalid || invalidQuantity}>
              确认前期更正
            </Button>
          </Popconfirm>
        </>
      )}
      <h3>历史更正记录</h3>
      {history.error && <Alert type="error" title={history.error.message} />}
      {(history.data ?? []).map((audit) => (
        <details key={audit.id}>
          <summary>
            {audit.createdAt} · {audit.userName} · {audit.reason}
          </summary>
          {audit.before.map((before) => {
            const after = audit.after.find((b) => b.id === before.id)!;
            return (
              <Descriptions
                key={before.id}
                size="small"
                bordered
                items={[
                  {
                    key: 'batch',
                    label: '批次',
                    children: `${before.period} ${before.category.name} #${before.id}`,
                  },
                  {
                    key: 'rows',
                    label: '逐人更正',
                    children: before.snapshots.map((r) => {
                      const next = after.snapshots.find((n) => n.employeeId === r.employeeId)!;
                      return (
                        <p key={r.employeeId}>
                          {r.employee.name}：应发 {formatMoney(r.gross)} → {formatMoney(next.gross)}
                          ；税额 {formatMoney(r.taxAmount)} → {formatMoney(next.taxAmount)}；实发{' '}
                          {formatMoney(r.net)} → {formatMoney(next.net)}
                        </p>
                      );
                    }),
                  },
                ]}
              />
            );
          })}
        </details>
      ))}
    </Drawer>
  );
}
