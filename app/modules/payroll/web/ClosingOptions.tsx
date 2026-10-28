import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Popconfirm, Space } from 'antd';
import type { inferRouterOutputs } from '@trpc/server';
import { formatMoney } from '@caiwu/core';
import { queryClient } from '@caiwu/web-kit';
import { DataTable } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import type { PayrollRouter } from '../server/router';
import type { Batch } from '../shared';
import { api } from './api';

type Outputs = inferRouterOutputs<PayrollRouter>;
type Plan =
  | { kind: 'merge'; data: Outputs['previewCloseMerge'] }
  | { kind: 'keep'; data: Outputs['previewReopenKeep'] };
const valueText = (value: number | string | null, kind: string, unit = '') =>
  value === null
    ? '空白'
    : kind === 'money' && typeof value === 'number'
      ? `${formatMoney(value)}元`
      : `${value}${unit}`;

export default function ClosingOptions({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const merge = useMutation(api.applyCloseMerge.mutationOptions());
  const keep = useMutation(api.applyReopenKeep.mutationOptions());
  const preview = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setPlan(null);
    setError('');
    const input = { id: batch.id, revision: batch.revision };
    try {
      if (batch.closed)
        setPlan({
          kind: 'keep',
          data: await queryClient.fetchQuery({
            ...api.previewReopenKeep.queryOptions(input),
            staleTime: 0,
          }),
        });
      else
        setPlan({
          kind: 'merge',
          data: await queryClient.fetchQuery({
            ...api.previewCloseMerge.queryOptions(input),
            staleTime: 0,
          }),
        });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '预览失败，请重试');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!plan || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const input = {
      id: batch.id,
      revision: batch.revision,
      hash: plan.data.hash,
      expiresAt: plan.data.expiresAt,
      confirmed: true,
    };
    try {
      if (plan.kind === 'merge') await merge.mutateAsync(input);
      else await keep.mutateAsync(input);
      await queryClient.invalidateQueries({ queryKey: api.pathKey() });
      onClose();
    } catch (failure) {
      setPlan(null);
      setError(failure instanceof Error ? failure.message : '保存失败，工资保持原状，请重新预览');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const print = async () => {
    if (!plan) return;
    const rows =
      plan.kind === 'merge'
        ? plan.data.changes.map((change) => [
            change.code,
            change.name,
            change.field,
            valueText(change.before, change.kind, change.unit),
            valueText(change.after, change.kind, change.unit),
          ])
        : plan.data.retainedRows.flatMap((row) =>
            row.fields.map((field) => [
              row.code,
              row.name,
              field.name,
              valueText(field.value, field.kind, field.unit),
              '完整保留',
            ]),
          );
    const title = `${batch.period} ${batch.category.name} ${plan.kind === 'merge' ? '合并结账影响' : '保留下月反结账影响'}`;
    const table = `<table><thead><tr>${['编号', '姓名', '栏目', '操作前', '操作后'].map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const detail =
      plan.kind === 'merge'
        ? `本期冻结；下月由${plan.data.target.people}人变为${plan.data.afterPeople}人。已有金额、数量及扣除均保留，只补空白，新增人员的扣除须确认。${plan.data.changes.length ? '下月须重新计算。' : '下月计算状态不变。'}`
        : `本期解除结账；下月${plan.data.retainedPeople}人的输入和计算结果完整保留，后续修改仍须核对历史引用。`;
    const excluded =
      plan.kind === 'merge' && plan.data.excluded.length
        ? `<h3>本次不传递</h3>${plan.data.excluded.map((row) => `<p>${escapeHtml(`${row.code} ${row.name}：${row.reason}`)}</p>`).join('')}`
        : '';
    await printHtml({
      title,
      html: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${table}${excluded}`,
    });
  };
  return (
    <Drawer
      open
      title={batch.closed ? '保留下月数据反结账' : '已有下月工资合并传递'}
      size={1050}
      closable={!busy}
      maskClosable={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Alert
        type="info"
        showIcon
        title={
          batch.closed
            ? '解除本期结账并保留下月已编辑或已计算工资。审核、过账来源及最近已结月保护仍有效。'
            : '冻结本期，只给已有下月人员补空白金额/数量，并添加可传递的新人员。显式零值和下月累计扣除均保留。'
        }
      />
      {error && <Alert type="error" title={error} />}
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" loading={busy} disabled={busy} onClick={() => void preview()}>
          {batch.closed ? '预览保留下月反结账' : '预览合并传递'}
        </Button>
        <Button disabled={!plan || busy} onClick={() => void print()}>
          打印结账影响
        </Button>
      </Space>
      {plan && (
        <>
          <Descriptions
            bordered
            column={2}
            style={{ marginTop: 12 }}
            items={[
              {
                key: 'source',
                label: '本期工资',
                children: `${plan.data.source.period} · ${plan.data.source.people}人 · ${plan.kind === 'merge' ? '将冻结' : '将解除结账'}`,
              },
              {
                key: 'target',
                label: '下月工资',
                children: plan.data.target
                  ? `${plan.data.target.period} · ${plan.data.target.people}人`
                  : '无关联传递批次',
              },
              {
                key: 'expires',
                label: '预览有效期',
                children: new Date(plan.data.expiresAt).toLocaleString('zh-CN'),
              },
            ]}
          />
          {plan.kind === 'merge' ? (
            <>
              <Alert
                type="warning"
                title={
                  plan.data.changes.length
                    ? `将补入${plan.data.changes.length}项；下月保留已有值并改为待重算。`
                    : '下月无缺失值，原工资及计算状态全部保留。'
                }
              />
              <DataTable
                tableId="payroll.close-merge-preview"
                rowKey="key"
                pagination={false}
                dataSource={plan.data.changes}
                columns={[
                  { key: 'code', title: '编号', dataIndex: 'code', width: 100 },
                  { key: 'name', title: '姓名', dataIndex: 'name', width: 110 },
                  { key: 'field', title: '栏目', dataIndex: 'field', width: 120 },
                  {
                    key: 'before',
                    title: '修改前',
                    render: (_, change) => valueText(change.before, change.kind, change.unit),
                    width: 150,
                  },
                  {
                    key: 'after',
                    title: '修改后',
                    render: (_, change) => valueText(change.after, change.kind, change.unit),
                    width: 230,
                  },
                ]}
              />
              {plan.data.excluded.length > 0 && (
                <Alert
                  type="info"
                  title="本次不传递的人员"
                  description={plan.data.excluded
                    .map((row) => `${row.code} ${row.name}：${row.reason}`)
                    .join('；')}
                />
              )}
            </>
          ) : (
            <>
              <Alert
                type="warning"
                title={`完整保留下月${plan.data.retainedPeople}人的输入、扣除和计算结果；本操作不删除任何下月工资。`}
              />
              <DataTable
                tableId="payroll.reopen-keep-preview"
                rowKey="employeeId"
                pagination={false}
                dataSource={plan.data.retainedRows}
                columns={[
                  { key: 'code', title: '编号', dataIndex: 'code', width: 100 },
                  { key: 'name', title: '姓名', dataIndex: 'name', width: 110 },
                  {
                    key: 'retained',
                    title: '完整保留的下月输入',
                    render: (_, row) =>
                      row.fields
                        .map(
                          (field) =>
                            `${field.name}：${valueText(field.value, field.kind, field.unit)}`,
                        )
                        .join('；'),
                    width: 550,
                  },
                ]}
              />
            </>
          )}
          <Popconfirm
            title={
              plan.kind === 'merge'
                ? '确认本期结账并按上述范围合并下月？'
                : '确认解除本期结账并完整保留下月工资？'
            }
            onConfirm={() => void confirm()}
          >
            <Button type="primary" loading={busy} disabled={busy} style={{ marginTop: 12 }}>
              {plan.kind === 'merge' ? '确认合并结账' : '确认保留下月反结账'}
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
