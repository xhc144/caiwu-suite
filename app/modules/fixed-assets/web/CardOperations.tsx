import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Drawer, Form, Input, Space } from 'antd';
import { DataTable, MoneyInput } from '@caiwu/ui';
import { formatMoney, periodEndDate } from '@caiwu/core';
import { useAccounts, useCurrentPeriod, useRequiredSession } from '@caiwu/web-kit';
import { api } from './api';
import { Confirm, MasterSelect, refresh } from './common';
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
  const saved = () => {
    void refresh();
    onClose();
  };
  const adjust = useMutation(api.adjust.mutationOptions({ onSuccess: saved })),
    remove = useMutation(api.removeAdjustment.mutationOptions({ onSuccess: () => void refresh() })),
    dispose = useMutation(api.dispose.mutationOptions({ onSuccess: saved })),
    undo = useMutation(api.undoDisposal.mutationOptions({ onSuccess: saved }));
  const c = data?.card;
  return (
    <Drawer
      open
      onClose={onClose}
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
                <Checkbox checked={confirmMismatch} onChange={(e) => setMismatch(e.target.checked)}>
                  已核实差异，同意以调整链为调整前原值
                </Checkbox>
              }
            />
          )}
          <Form layout="vertical">
            <Form.Item label="调整日期">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Form.Item>
            <Form.Item label="调整后原值（元）">
              <MoneyInput value={value} onChange={setValue} />
            </Form.Item>
            <Form.Item label="调整说明">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Form.Item>
            <Confirm
              title="确认按以上日期、前后原值和说明保存调整？"
              onConfirm={() =>
                c &&
                data &&
                value != null &&
                adjust.mutate({
                  id,
                  date,
                  value,
                  note,
                  expectedOriginal: c.original,
                  expectedChain: data.chainValue,
                  confirmMismatch,
                })
              }
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
                    onConfirm={() => remove.mutate({ id: a.id, confirm: true })}
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
          <Confirm
            title="撤销注销并通过 core 删除待审核清理凭证？已审核凭证将拒绝。"
            onConfirm={() => undo.mutate({ id, confirm: true })}
          >
            撤销注销
          </Confirm>
        </>
      ) : (
        <Form layout="vertical">
          <Form.Item label="注销日期">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPreview(false);
              }}
            />
          </Form.Item>
          <Form.Item label="注销原因">
            <MasterSelect
              kind="reason"
              value={reasonId}
              onChange={(v) => {
                setReason(v);
                setPreview(false);
              }}
            />
          </Form.Item>
          <Checkbox
            checked={generate}
            onChange={(e) => {
              setGenerate(e.target.checked);
              setPreview(false);
            }}
          >
            当月注销同时生成清理凭证
          </Checkbox>
          <Space>
            <Button disabled={!reasonId} onClick={() => setPreview(true)}>
              预览注销
            </Button>
          </Space>
          {disposal.data && preview && (
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
                onConfirm={() =>
                  reasonId &&
                  dispose.mutate({
                    id,
                    date,
                    reasonId,
                    generate,
                    confirm: true,
                    token: disposal.data!.token,
                  })
                }
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
