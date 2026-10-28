import { memo, useCallback, useMemo, useState } from 'react';
import { formatMoney } from '@caiwu/core';
import { Alert, Button, Drawer, Pagination, Select, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { DataTable } from '@caiwu/ui';
import { matchSuggestions } from '../shared';
import { api, refresh, type Outputs } from './api';
import { useCashierConfirm } from './common';

type Entry = Outputs['reconcile']['entries'][number];
const PAGE_SIZE = 50;
const MAX_PAIRS = 200;
const CandidateSelect = memo(function CandidateSelect({
  number,
  documentId,
  candidates,
  selected,
  used,
  disabled,
  onChoose,
}: {
  number: string;
  documentId: number;
  candidates: Entry[];
  selected: Entry | undefined;
  used: ReadonlyMap<number, number>;
  disabled: boolean;
  onChoose: (documentId: number, lineId: number | undefined) => void;
}) {
  const [page, setPage] = useState(1);
  const options = useMemo(
    () =>
      candidates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((e) => ({
        value: e.lineId,
        label: `${e.date} ${e.displayNo} 分录${e.lineId}`,
        disabled: used.has(e.lineId) && used.get(e.lineId) !== documentId,
      })),
    [candidates, page, used, documentId],
  );
  return (
    <div role="group" aria-label={`候选 ${number}`}>
      <Select
        aria-label={`匹配 ${number}`}
        style={{ width: '100%' }}
        allowClear
        disabled={disabled || !candidates.length}
        labelInValue
        value={
          selected
            ? {
                value: selected.lineId,
                label: `${selected.date} ${selected.displayNo} 分录${selected.lineId}`,
              }
            : undefined
        }
        placeholder="核对后选择"
        options={options}
        onChange={(choice) => onChoose(documentId, choice?.value)}
      />
      {candidates.length > PAGE_SIZE && (
        <>
          <div>
            候选共 {candidates.length} 条，当前第 {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, candidates.length)} 条，均可翻页核对
          </div>
          <Pagination
            simple
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={candidates.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
});

export default function AutoMatchDrawer({
  data,
  stale,
  onClose,
}: {
  data: Outputs['reconcile'];
  stale: boolean;
  onClose: () => void;
}) {
  const suggestions = useMemo(
    () => matchSuggestions(data.documents, data.entries),
    [data.documents, data.entries],
  );
  const byId = useMemo(() => new Map(suggestions.map((s) => [s.document.id, s])), [suggestions]);
  const entriesById = useMemo(
    () => new Map(data.entries.map((e) => [e.lineId, e])),
    [data.entries],
  );
  const uniqueCount = useMemo(
    () => suggestions.reduce((n, s) => n + Number(s.unique), 0),
    [suggestions],
  );
  const [choices, setChoices] = useState<ReadonlyMap<number, number>>(() => {
    const initial = new Map<number, number>();
    for (const s of suggestions) {
      if (s.unique) initial.set(s.document.id, s.candidates[0]!.lineId);
      if (initial.size === MAX_PAIRS) break;
    }
    return initial;
  });
  const [page, setPage] = useState(1);
  const visible = useMemo(
    () => suggestions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [suggestions, page],
  );
  const used = useMemo(
    () => new Map([...choices].map(([documentId, lineId]) => [lineId, documentId])),
    [choices],
  );
  const choose = useCallback((documentId: number, lineId: number | undefined) => {
    setChoices((old) => {
      if (
        lineId != null &&
        ((!old.has(documentId) && old.size >= MAX_PAIRS) ||
          [...old].some(([id, line]) => id !== documentId && line === lineId))
      )
        return old;
      const next = new Map(old);
      if (lineId == null) next.delete(documentId);
      else next.set(documentId, lineId);
      return next;
    });
  }, []);
  const [confirm, holder] = useCashierConfirm();
  const pairs = useMemo(
    () =>
      [...choices].map(([documentId, lineId]) => ({
        documentId,
        revision: byId.get(documentId)!.document.revision,
        lineId,
      })),
    [choices, byId],
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
        description="按日期列出同方向且本位币金额、原币金额分别相等的候选。只有双方唯一的等额项目默认选中；重复金额需逐项核对日期和凭证后选择。跨多单汇总请使用手动勾账。"
      />
      <div>
        共 {suggestions.length} 张待勾单据，唯一候选 {uniqueCount} 对；每页 {PAGE_SIZE}{' '}
        张，全部建议均可翻页核对
      </div>
      {uniqueCount > MAX_PAIRS && (
        <Alert
          type="info"
          title={`唯一候选共 ${uniqueCount} 对，已预选日期顺序前 ${MAX_PAIRS} 对，其余保留待分批核对`}
        />
      )}
      {stale && <Alert type="warning" title="数据正在刷新或已发生变化，请关闭后重新预览" />}
      <Space>
        <Button disabled={!choices.size || commit.isPending} onClick={() => setChoices(new Map())}>
          清空匹配选择
        </Button>
        <span>一次最多确认 {MAX_PAIRS} 对；达到上限后可清除已有选择，或提交后继续下一批</span>
      </Space>
      <DataTable
        tableId="cashier.autoMatch"
        rowKey={(r) => r.document.id}
        dataSource={visible}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: suggestions.length,
          showSizeChanger: false,
          onChange: setPage,
        }}
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
          ...(data.foreignAdjustment
            ? [
                {
                  key: 'foreignAmount',
                  title: `原币（${data.account.currency}）`,
                  money: true,
                  render: (_: unknown, s: (typeof suggestions)[number]) =>
                    formatMoney(s.document.foreignSigned),
                  exportValue: (s: (typeof suggestions)[number]) => s.document.foreignSigned,
                },
              ]
            : []),
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
              <CandidateSelect
                number={s.document.number}
                documentId={s.document.id}
                candidates={s.candidates}
                selected={entriesById.get(choices.get(s.document.id) ?? 0)}
                used={used}
                disabled={
                  stale ||
                  commit.isPending ||
                  (choices.size >= MAX_PAIRS && !choices.has(s.document.id))
                }
                onChoose={choose}
              />
            ),
          },
        ]}
      />
      <Button
        type="primary"
        disabled={stale || commit.isPending || !pairs.length}
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
      {holder}
    </Drawer>
  );
}
