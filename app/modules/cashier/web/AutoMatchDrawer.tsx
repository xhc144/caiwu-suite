import { useState } from 'react';
import { formatMoney } from '@caiwu/core';
import { Alert, Button, Drawer, Select } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { DataTable } from '@caiwu/ui';
import { matchSuggestions } from '../shared';
import { api, refresh, type Outputs } from './api';
import { useCashierConfirm } from './common';

export default function AutoMatchDrawer({
  data,
  stale,
  onClose,
}: {
  data: Outputs['reconcile'];
  stale: boolean;
  onClose: () => void;
}) {
  const suggestions = matchSuggestions(data.documents, data.entries);
  const [choices, setChoices] = useState<Record<number, number | undefined>>(() =>
    Object.fromEntries(
      suggestions.filter((s) => s.unique).map((s) => [s.document.id, s.candidates[0]!.lineId]),
    ),
  );
  const [confirm, holder] = useCashierConfirm();
  const pairs = suggestions.flatMap((s) =>
    choices[s.document.id] == null
      ? []
      : [
          {
            documentId: s.document.id,
            revision: s.document.revision,
            lineId: choices[s.document.id]!,
          },
        ],
  );
  const commit = useMutation(
    api.autoMatch.mutationOptions({
      onSuccess: () => {
        onClose();
        void refresh();
      },
    }),
  );
  return (
    <Drawer open title="自动勾账建议" size={860} onClose={onClose}>
      <Alert
        type="info"
        title={`${data.account.name} · 截止 ${data.cutoff} · 已选择 ${pairs.length} 对`}
        description="按日期列出同方向且整数分金额相等的候选。只有双方唯一的等额项目默认选中；重复金额需逐项核对日期和凭证后选择。跨多单汇总请使用手动勾账。"
      />
      {stale && <Alert type="warning" title="数据正在刷新或已发生变化，请关闭后重新预览" />}
      <DataTable
        tableId="cashier.autoMatch"
        rowKey={(r) => r.document.id}
        dataSource={suggestions}
        columns={[
          { key: 'doc', title: '出纳单', width: 150, render: (_, s) => s.document.number },
          { key: 'date', title: '日期', width: 110, render: (_, s) => s.document.date },
          {
            key: 'amount',
            title: '收正付负',
            money: true,
            render: (_, s) => formatMoney(s.document.signed),
            exportValue: (s) => s.document.signed,
          },
          {
            key: 'kind',
            title: '候选情况',
            width: 150,
            render: (_, s) =>
              !s.candidates.length ? '无等额候选' : s.unique ? '双方唯一' : '重复金额，需核对',
          },
          {
            key: 'candidate',
            title: '财务分录',
            width: 280,
            render: (_, s) => (
              <Select
                aria-label={`匹配 ${s.document.number}`}
                style={{ width: '100%' }}
                allowClear
                disabled={stale || commit.isPending || !s.candidates.length}
                value={choices[s.document.id]}
                placeholder="核对后选择"
                options={s.candidates.map((e) => ({
                  value: e.lineId,
                  label: `${e.date} ${e.displayNo} 分录${e.lineId}`,
                  disabled: Object.entries(choices).some(
                    ([id, line]) => Number(id) !== s.document.id && line === e.lineId,
                  ),
                }))}
                onChange={(lineId: number | undefined) =>
                  setChoices((old) => ({ ...old, [s.document.id]: lineId }))
                }
              />
            ),
          },
        ]}
      />
      <Button
        type="primary"
        disabled={stale || commit.isPending || !pairs.length || pairs.length > 200}
        aria-busy={commit.isPending}
        onClick={async () => {
          if (
            await confirm({
              title: '确认自动勾账',
              content: `将按所选候选建立 ${pairs.length} 个一对一勾账组，提交时复核账户、日期、凭证状态和版本。任何一对失败则全部不变。`,
              confirmText: '自动勾账',
            })
          )
            commit.mutate({
              accountId: data.account.id,
              cutoff: data.cutoff,
              snapshot: data.snapshot,
              pairs,
              confirmed: true,
            });
        }}
      >
        确认所选匹配
      </Button>
      {pairs.length > 200 && <Alert type="warning" title="一次最多确认200对，请减少选择" />}
      {holder}
    </Drawer>
  );
}
