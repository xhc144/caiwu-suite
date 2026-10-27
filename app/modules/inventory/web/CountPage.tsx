import { useState } from 'react';
import { Alert, Button, Input, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Grid, WarehouseSelect, mayDiscard, useCatalog, useRefresh, useUnsaved } from './common';
export default function CountPage() {
  const [f, setF] = useUrlFilters({ warehouseId: 0, period: 0 });
  const { warehouses, context } = useCatalog();
  const warehouseId =
      f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0,
    period = f.period || context?.current?.period || 202601;
  const key = { warehouseId, period };
  const q = useQuery({
    ...api.count.queryOptions({ ...key, warehouseId: warehouseId || 1 }),
    enabled: !!warehouseId,
  });
  const can = usePermission('inventory.edit');
  const [draft, setDraft] = useState<
    { productCode: string; actual: string; note: string }[] | null
  >(null);
  const [revision, setRevision] = useState(0);
  const refresh = useRefresh();
  const generate = useMutation(api.generateCount.mutationOptions()),
    save = useMutation(api.saveCount.mutationOptions()),
    reset = useMutation(api.resetCount.mutationOptions()),
    remove = useMutation(api.removeCount.mutationOptions());
  useUnsaved(!!draft);
  return (
    <PageContainer
      title="月末盘点"
      subtitle={`支持月份 ${context?.book.startPeriod ?? ''} 至 ${context?.current?.period ?? ''}；数量与金额快照只在生成时取得，实盘金额按快照折算，实盘不会直接改变库存。`}
    >
      <InventoryNavigation />
      <Space wrap>
        <span>当前仓库</span>
        <WarehouseSelect
          value={warehouseId || undefined}
          onChange={(warehouseId) => {
            if (mayDiscard(!!draft)) {
              setDraft(null);
              setF({ warehouseId });
            }
          }}
        />
        <Input
          aria-label="盘点月份"
          type="month"
          value={`${String(period).slice(0, 4)}-${String(period).slice(4)}`}
          onChange={(e) => {
            if (mayDiscard(!!draft)) {
              setDraft(null);
              setF({ period: Number(e.target.value.replace('-', '')) });
            }
          }}
        />
        {can && (
          <>
            <Button
              disabled={!warehouseId}
              loading={generate.isPending}
              onClick={async () => {
                if (!mayDiscard(!!draft)) return;
                const existing = !!q.data?.id;
                if (
                  existing &&
                  !window.confirm(
                    `已有实盘数据：${q.data!.rows.map((r) => `${r.productCode} 实盘${r.actual} 差异${r.difference}`).join('；')}。重生成将覆盖这些数据，确认吗？`,
                  )
                )
                  return;
                await generate.mutateAsync({
                  ...key,
                  revision: q.data?.revision ?? 0,
                  confirmed: existing,
                });
                setDraft(null);
                await refresh();
              }}
            >
              生成账面快照
            </Button>
            <Button
              disabled={!q.data?.id}
              onClick={() => {
                if (mayDiscard(!!draft)) {
                  setDraft(
                    (q.data?.rows ?? []).map((r) => ({
                      productCode: r.productCode,
                      actual: r.actual,
                      note: r.note,
                    })),
                  );
                  setRevision(q.data?.revision ?? 0);
                }
              }}
            >
              录入实盘
            </Button>
            <Button
              disabled={!q.data?.id}
              onClick={async () => {
                if (!mayDiscard(!!draft)) return;
                const differences = (q.data?.rows ?? []).filter((r) => r.difference !== '0');
                if (
                  !window.confirm(
                    `以下差异将清零：${differences.map((r) => `${r.productCode} ${r.difference}`).join('；') || '无差异'}。只把实盘调整为账面，不改库存。确认吗？`,
                  )
                )
                  return;
                await reset.mutateAsync({ ...key, revision: q.data!.revision, confirmed: true });
                setDraft(null);
                await refresh();
              }}
            >
              实际调整为账面（预览确认）
            </Button>
            <Button
              danger
              disabled={!q.data?.id}
              onClick={async () => {
                if (
                  !mayDiscard(!!draft) ||
                  !window.confirm(`确认删除 ${period} 月当前仓库盘点表？`)
                )
                  return;
                await remove.mutateAsync({ ...key, revision: q.data!.revision, confirmed: true });
                setDraft(null);
                await refresh();
              }}
            >
              删除盘点表
            </Button>
          </>
        )}
      </Space>
      {q.error && <Alert type="error" title={q.error.message} />}
      {draft && <Alert type="info" title="差异与金额列显示已保存的数据，保存实盘后更新。" />}
      <Grid
        id="counts"
        title={`月末盘点-${period}`}
        rows={q.data?.rows ?? []}
        columns={[
          { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
          { key: 'productName', title: '产品名称', dataIndex: 'productName' },
          { key: 'book', title: '账面数量', dataIndex: 'book' },
          {
            key: 'actual',
            title: '实际数量',
            dataIndex: 'actual',
            render: (_, r, index) =>
              draft ? (
                <Input
                  aria-label={`实盘${r.productCode}`}
                  value={draft[index]?.actual}
                  onChange={(e) =>
                    setDraft(
                      draft.map((l, i) => (i === index ? { ...l, actual: e.target.value } : l)),
                    )
                  }
                />
              ) : (
                r.actual
              ),
          },
          { key: 'difference', title: '差异数量', dataIndex: 'difference' },
          { key: 'bookCents', title: '账面金额快照', dataIndex: 'bookCents', money: true },
          { key: 'actualCents', title: '实盘折算金额', dataIndex: 'actualCents', money: true },
          { key: 'differenceCents', title: '差异金额', dataIndex: 'differenceCents', money: true },
          { key: 'amountStatus', title: '金额口径', dataIndex: 'amountStatus' },
          {
            key: 'note',
            title: '说明',
            dataIndex: 'note',
            render: (_, r, index) =>
              draft ? (
                <Input
                  aria-label={`盘点说明${r.productCode}`}
                  value={draft[index]?.note}
                  onChange={(e) =>
                    setDraft(
                      draft.map((l, i) => (i === index ? { ...l, note: e.target.value } : l)),
                    )
                  }
                />
              ) : (
                r.note
              ),
          },
        ]}
      />
      {draft && (
        <Space>
          <Button
            type="primary"
            loading={save.isPending}
            onClick={async () => {
              await save.mutateAsync({ ...key, revision, rows: draft });
              setDraft(null);
              await refresh();
            }}
          >
            保存实盘
          </Button>
          <Button
            onClick={() => {
              if (mayDiscard(true)) setDraft(null);
            }}
          >
            放弃实盘修改
          </Button>
        </Space>
      )}
    </PageContainer>
  );
}
