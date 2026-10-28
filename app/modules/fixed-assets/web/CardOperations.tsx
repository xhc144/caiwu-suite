import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Drawer, Form, Input, Space } from 'antd';
import { DataTable, MoneyInput } from '@caiwu/ui';
import { formatMoney, periodEndDate } from '@caiwu/core';
import {
  notify,
  useAccounts,
  useCurrentPeriod,
  useRequiredSession,
  useSubmission,
} from '@caiwu/web-kit';
import { api } from './api';
import { Confirm, MasterSelect, refresh } from './common';
import { useAssetDraft } from './useAssetDraft';
import { VoucherDeletionPreview } from './VoucherDeletionPreview';
export default function CardOperations({
  id,
  kind,
  onClose,
}: {
  id: number;
  kind: 'adjust' | 'dispose';
  onClose: () => void;
}) {
  const { data } = useQuery(api.detail.queryOptions({ id }));
  const { byId } = useAccounts();
  const session = useRequiredSession();
  const current = useCurrentPeriod();
  const [date, setDate] = useState(current?.endDate ?? periodEndDate(session.book.startPeriod)),
    [value, setValue] = useState<number | null>(null),
    [note, setNote] = useState(''),
    [confirmMismatch, setMismatch] = useState(false),
    [reasonId, setReason] = useState<number>(),
    [generate, setGenerate] = useState(false),
    [preview, setPreview] = useState(false);
  const disposal = useQuery({
    ...api.disposalPreview.queryOptions({ id, date, reasonId: reasonId ?? 1, generate }),
    enabled: preview && !!reasonId,
  });
  const adjust = useMutation(api.adjust.mutationOptions()),
    remove = useMutation(api.removeAdjustment.mutationOptions({ onSuccess: () => void refresh() })),
    dispose = useMutation(api.dispose.mutationOptions()),
    undo = useMutation(api.undoDisposal.mutationOptions());
  const otherSubmission = useSubmission();
  const c = data?.card;
  const undoPreview = useQuery({
    ...api.undoDisposalPreview.queryOptions({ id }),
    enabled: kind === 'dispose' && !!c?.disposal_date,
  });
  const draft = useAssetDraft({
    title: kind === 'adjust' ? '原值调整' : '注销资产',
    discard: onClose,
    save: async () => {
      if (!c || !data) return false;
      if (kind === 'adjust') {
        if (value == null || !note.trim()) {
          notify.error('请填写调整后原值和调整说明');
          return false;
        }
        await adjust.mutateAsync({
          id,
          date,
          value,
          note,
          expectedOriginal: c.original,
          expectedChain: data.chainValue,
          confirmMismatch,
        });
      } else {
        if (!reasonId || !preview || !disposal.data || disposal.isFetching || disposal.error) {
          notify.error('请先预览并核对注销内容');
          return false;
        }
        await dispose.mutateAsync({
          id,
          date,
          reasonId,
          generate,
          confirm: true,
          token: disposal.data.token,
        });
      }
      await refresh();
    },
  });
  const submit = async () => {
    try {
      if (await draft.save()) onClose();
    } catch {
      // The drawer retains all input when business validation or saving fails.
    }
  };
  const change = (run: () => void) => {
    run();
    draft.changed();
  };
  return (
    <Drawer
      open
      onClose={() => draft.close(onClose)}
      title={kind === 'adjust' ? '原值调整与查询' : '注销资产'}
      size={750}
    >
      {c && (
        <Alert
          title={`${c.code} ${c.name}：原值 ${formatMoney(c.original)} 元，累计折旧 ${formatMoney(c.depreciation)} 元`}
        />
      )}
      {kind === 'adjust' ? (
        <>
          {data && data.chainValue !== c?.original && (
            <Alert
              type="error"
              title={`原值差异：卡片 ${formatMoney(c?.original)} 元；调整链 ${formatMoney(data.chainValue)} 元`}
              description={
                <Checkbox
                  checked={confirmMismatch}
                  disabled={draft.saving}
                  onChange={(e) => change(() => setMismatch(e.target.checked))}
                >
                  已核实差异，同意以调整链为调整前原值
                </Checkbox>
              }
            />
          )}
          <Form layout="vertical" disabled={draft.saving || !c}>
            <Form.Item label="调整日期" htmlFor="fixed-assets-adjust-date">
              <Input
                id="fixed-assets-adjust-date"
                type="date"
                value={date}
                onChange={(e) => change(() => setDate(e.target.value))}
              />
            </Form.Item>
            <Form.Item label="调整后原值（元）" htmlFor="fixed-assets-adjust-value">
              <MoneyInput
                id="fixed-assets-adjust-value"
                value={value}
                onChange={(v) => change(() => setValue(v))}
              />
            </Form.Item>
            <Form.Item label="调整说明" htmlFor="fixed-assets-adjust-note">
              <Input
                id="fixed-assets-adjust-note"
                value={note}
                onChange={(e) => change(() => setNote(e.target.value))}
              />
            </Form.Item>
            <Confirm
              title="确认按以上日期、前后原值和说明保存调整？"
              onConfirm={() => void submit()}
            >
              确认原值调整
            </Confirm>
          </Form>
          <DataTable
            tableId="fixed-assets-adjustments"
            rowKey="id"
            dataSource={data?.adjustments ?? []}
            columns={[
              { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
              { key: 'before', title: '调整前', dataIndex: 'before_value', money: true },
              { key: 'after', title: '调整后', dataIndex: 'after_value', money: true },
              { key: 'note', title: '说明', dataIndex: 'note', width: 160 },
              {
                key: 'op',
                title: '操作',
                noExport: true,
                render: (_, a) => (
                  <Confirm
                    title="删除这笔调整并恢复原值？已有后续记录时将拒绝。"
                    danger
                    onConfirm={() =>
                      void otherSubmission
                        .submit(() => remove.mutateAsync({ id: a.id, confirm: true }))
                        .catch(() => {})
                    }
                  >
                    删除调整
                  </Confirm>
                ),
              },
            ]}
          />
        </>
      ) : c?.disposal_date ? (
        <>
          <Alert title={`已于 ${c.disposal_date} 注销，历史保留`} />
          <Button loading={undoPreview.isFetching} onClick={() => void undoPreview.refetch()}>
            重新预览撤销影响
          </Button>
          {undoPreview.error && <Alert type="error" title={undoPreview.error.message} />}
          {undoPreview.isFetching && <p role="status">正在核对注销凭证及编号影响…</p>}
          {undoPreview.isSuccess && !undoPreview.isFetching && (
            <>
              <VoucherDeletionPreview preview={undoPreview.data.voucherDeletion} />
              <Confirm
                title="撤销注销并删除待审核清理凭证？已审核凭证不能删除。"
                onConfirm={() =>
                  void otherSubmission
                    .submit(async () => {
                      await undo.mutateAsync({
                        id,
                        confirm: true,
                        voucherDeletion: undoPreview.data.voucherDeletion ?? undefined,
                        expectedVoucherId: undoPreview.data.voucherId,
                      });
                      await refresh();
                      onClose();
                    })
                    .catch(() => {})
                }
              >
                撤销注销
              </Confirm>
            </>
          )}
        </>
      ) : (
        <Form layout="vertical" disabled={draft.saving || !c}>
          <Form.Item label="注销日期" htmlFor="fixed-assets-disposal-date">
            <Input
              id="fixed-assets-disposal-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPreview(false);
                draft.changed();
              }}
            />
          </Form.Item>
          <Form.Item label="注销原因" htmlFor="fixed-assets-disposal-reason">
            <MasterSelect
              id="fixed-assets-disposal-reason"
              kind="reason"
              value={reasonId}
              onChange={(v) => {
                setReason(v);
                setPreview(false);
                draft.changed();
              }}
            />
          </Form.Item>
          <Checkbox
            checked={generate}
            onChange={(e) => {
              setGenerate(e.target.checked);
              setPreview(false);
              draft.changed();
            }}
          >
            当月注销同时生成清理凭证
          </Checkbox>
          <Space>
            <Button disabled={!reasonId} onClick={() => setPreview(true)}>
              预览注销
            </Button>
          </Space>
          {disposal.error && preview && <Alert type="error" title={disposal.error.message} />}
          {disposal.data && preview && !disposal.isFetching && !disposal.error && (
            <>
              <Alert
                title={`已计提截止月 ${disposal.data.latestPeriod ?? '无'}；清理净值 ${formatMoney(disposal.data.net)} 元`}
              />
              <DataTable
                tableId="fixed-assets-disposal-preview"
                rowKey={(_, i) => String(i)}
                dataSource={disposal.data.lines}
                columns={[
                  { key: 'summary', title: '摘要', dataIndex: 'summary' },
                  {
                    key: 'account',
                    title: '科目',
                    width: 220,
                    render: (_, r) => {
                      const a = byId.get(r.accountId ?? 0);
                      return a ? `${a.code} ${a.fullName}` : '未设置';
                    },
                    exportValue: (r) => byId.get(r.accountId ?? 0)?.fullName,
                  },
                  { key: 'debit', title: '借方', dataIndex: 'debit', money: true },
                  { key: 'credit', title: '贷方', dataIndex: 'credit', money: true },
                ]}
              />
              <Confirm
                title="确认注销，默认台账将隐藏该资产，历史保留？"
                danger
                onConfirm={() => void submit()}
              >
                确认注销
              </Confirm>
            </>
          )}
        </Form>
      )}
    </Drawer>
  );
}
