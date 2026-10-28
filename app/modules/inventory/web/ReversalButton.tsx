import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Decimal, formatMoney } from '@caiwu/core';
import { useSubmission, useUnsavedChanges, useTab } from '@caiwu/web-kit';
import { AccountSelect } from '@caiwu/ui';
import type { InventoryRouter } from '../server/router';
import type { ReversalInput } from '../reversal';
import { api } from './api';
import { Grid, useCatalog, useRefresh } from './common';

type Document = inferRouterOutputs<InventoryRouter>['document'];
export default function ReversalButton({ id, onSaved }: { id: number; onSaved: () => void }) {
  const { active } = useTab();
  const { modal } = App.useApp();
  const client = useQueryClient(),
    refresh = useRefresh();
  const { context } = useCatalog();
  const [source, setSource] = useState<Document | null>(null);
  const [draft, setDraft] = useState<ReversalInput | null>(null);
  const preview = useMutation(api.previewReversal.mutationOptions());
  const save = useMutation(api.reverseDocument.mutationOptions());
  const submission = useSubmission();
  const busy = submission.isSubmitting;
  const close = () => {
    setSource(null);
    setDraft(null);
    preview.reset();
  };
  const submit = async (): Promise<boolean> => {
    if (!draft) return true;
    const result = await submission.submit(async () => {
      const p = await preview.mutateAsync(draft);
      const confirmed = await new Promise<boolean>((resolve) =>
        modal.confirm({
          title: '确认整张反冲',
          content: (
            <>
              <p>
                {p.sourceNumber} 将生成{p.kind === 'issue' ? '出' : '入'}库单 {draft.number}
                ，不含税金额 {formatMoney(p.netCents)} 元。
              </p>
              {p.shortages.map((s) => (
                <p key={s.productCode}>
                  {s.productCode}：当前 {s.current}，申请 {s.requested}，不足 {s.difference}。
                </p>
              ))}
              <p>原单保留；会计凭证需在凭证所属业务中处理。</p>
            </>
          ),
          okText: p.shortages.length ? '确认反冲并允许负库存' : '确认反冲',
          cancelText: '取消',
          autoFocusButton: 'cancel',
          okButtonProps: { danger: true },
          onOk: () => {
            resolve(true);
          },
          onCancel: () => {
            resolve(false);
          },
        }),
      );
      if (!confirmed) return false;
      await save.mutateAsync({
        ...draft,
        confirmed: true,
        negativeConfirmation: p.shortages.length ? p.confirmation : undefined,
      });
      close();
      await refresh();
      onSaved();
      return true;
    });
    return result ?? false;
  };
  useUnsavedChanges({
    dirty: !!draft || busy,
    title: '单据反冲',
    version: JSON.stringify(draft),
    save: submit,
    discard: () => {
      if (busy) throw new Error('反冲正在保存，请等待结果后再关闭');
      close();
    },
  });
  const change = (patch: Partial<ReversalInput>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    preview.reset();
  };
  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          const d = await client.fetchQuery(api.document.queryOptions({ id }));
          setSource(d);
          setDraft({
            id,
            revision: d.revision,
            requestKey: crypto.randomUUID(),
            number: '',
            date:
              context?.current?.startDate && context.current.startDate > d.date
                ? context.current.startDate
                : d.date,
            accountId: (d.kind === 'receipt' ? d.account_id : d.cost_account_id) ?? 0,
            ...(d.kind === 'issue'
              ? {
                  unitPrices: d.lines.map((l) =>
                    l.unit_cost == null
                      ? ''
                      : new Decimal(l.unit_cost).toDecimalPlaces(6).toFixed(),
                  ),
                }
              : {}),
          });
        }}
      >
        反冲
      </Button>
      <Modal
        title="单据反冲"
        open={!!draft && active}
        onCancel={() => {
          if (!busy) close();
        }}
        width={1000}
        mask={false}
        footer={
          <Space>
            <Button disabled={busy} onClick={close}>
              取消
            </Button>
            <Button type="primary" danger loading={busy} onClick={() => void submit()}>
              预览并确认反冲
            </Button>
          </Space>
        }
      >
        {draft && source && (
          <>
            <Alert
              type="info"
              title={`以相反方向新增${source.kind === 'receipt' ? '其他出库' : '其他入库'}，逐行恢复或冲减原数量。${source.kind === 'issue' ? '退回入库单价需逐行确认，已核算成本仅作为填写参考。' : '沿用原单价、税率及含税口径；正式出库成本按本期核算。'}原会计凭证保留。`}
            />
            <Form layout="vertical" disabled={busy}>
              <Form.Item label="原单号">{source.number}</Form.Item>
              <Form.Item label="反冲单号">
                <Input
                  aria-label="反冲单号"
                  value={draft.number}
                  onChange={(e) => change({ number: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="反冲日期">
                <Input
                  aria-label="反冲日期"
                  type="date"
                  value={draft.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="反冲对方科目">
                <AccountSelect
                  aria-label="反冲对方科目"
                  value={draft.accountId || undefined}
                  onChange={(accountId) => change({ accountId: accountId ?? 0 })}
                />
              </Form.Item>
              <Grid
                id="reversal-lines"
                title="反冲数量及计价"
                rows={source.lines}
                columns={[
                  { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                  { key: 'productName', title: '产品名称', dataIndex: 'productName' },
                  { key: 'quantity', title: '反冲数量', dataIndex: 'quantity' },
                  {
                    key: 'price',
                    title: source.kind === 'issue' ? '退回入库单价（元）' : '原单价（元）',
                    render: (_, row, i) =>
                      source.kind === 'receipt' ? (
                        row.unitPrice
                      ) : (
                        <Input
                          aria-label={`反冲第${i + 1}行单价`}
                          value={draft.unitPrices?.[i] ?? ''}
                          onChange={(e) =>
                            change({
                              unitPrices: draft.unitPrices?.map((p, j) =>
                                j === i ? e.target.value : p,
                              ),
                            })
                          }
                        />
                      ),
                  },
                ]}
                exportable={false}
              />
            </Form>
          </>
        )}
      </Modal>
    </>
  );
}
