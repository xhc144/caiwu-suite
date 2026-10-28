import { useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { usePermission, useTab } from '@caiwu/web-kit';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Grid, WarehouseSelect, mayDiscard, useCatalog, useRefresh, useUnsaved } from './common';
export default function CountPage() {
  const { active } = useTab();
  const [f, setF] = useUrlFilters({ warehouseId: 0, period: 0 });
  const { warehouses, products, context } = useCatalog();
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
  const [countProducts, setCountProducts] = useState<string[] | null>(null);
  const [productRevision, setProductRevision] = useState(0);
  const refresh = useRefresh();
  const generate = useMutation(api.generateCount.mutationOptions()),
    save = useMutation(api.saveCount.mutationOptions()),
    reset = useMutation(api.resetCount.mutationOptions()),
    remove = useMutation(api.removeCount.mutationOptions());
  const replaceProducts = useMutation(api.replaceCountProducts.mutationOptions());
  const submitProducts = async () => {
    if (!countProducts || replaceProducts.isPending) return false;
    const removed = (q.data?.rows ?? []).filter((r) => !countProducts.includes(r.productCode));
    const added = countProducts.filter((code) => !q.data?.rows.some((r) => r.productCode === code));
    if (
      !window.confirm(
        `移除：${removed.map((r) => `${r.productCode} 实盘${r.actual} 差异${r.difference}`).join('；') || '无'}。新增：${added.join('、') || '无'}。新增行按当前历史单据计算截至本月末的账面数量和金额，既有保留行快照不变。确认调整？`,
      )
    )
      return false;
    await replaceProducts.mutateAsync({
      ...key,
      revision: productRevision,
      productCodes: countProducts,
      confirmed: true,
    });
    setCountProducts(null);
    await refresh();
    return true;
  };
  useUnsaved(countProducts !== null, {
    pending: replaceProducts.isPending,
    title: `调整盘点产品：${period}`,
    version: JSON.stringify(countProducts),
    save: submitProducts,
    discard: () => setCountProducts(null),
  });
  const latest = useRef(draft);
  latest.current = draft;
  const submit = async () => {
    if (!draft || save.isPending) return false;
    const saved = await save.mutateAsync({ ...key, revision, rows: draft });
    if (latest.current === draft) setDraft(null);
    else setRevision(saved.revision);
    await refresh();
    return true;
  };
  useUnsaved(!!draft, {
    pending: save.isPending,
    title: `月末盘点：${period}`,
    version: JSON.stringify({ ...key, revision, rows: draft }),
    save: submit,
    discard: () => setDraft(null),
  });
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
            if (
              !save.isPending &&
              !replaceProducts.isPending &&
              mayDiscard(!!draft || countProducts !== null)
            ) {
              setDraft(null);
              setCountProducts(null);
              setF({ warehouseId });
            }
          }}
        />
        <Input
          aria-label="盘点月份"
          disabled={save.isPending}
          type="month"
          value={`${String(period).slice(0, 4)}-${String(period).slice(4)}`}
          onChange={(e) => {
            if (
              !save.isPending &&
              !replaceProducts.isPending &&
              mayDiscard(!!draft || countProducts !== null)
            ) {
              setDraft(null);
              setCountProducts(null);
              setF({ period: Number(e.target.value.replace('-', '')) });
            }
          }}
        />
        {can && (
          <>
            <Button
              disabled={!warehouseId || save.isPending}
              loading={generate.isPending}
              onClick={async () => {
                if (save.isPending || !mayDiscard(!!draft)) return;
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
              disabled={!q.data?.id || save.isPending}
              onClick={() => {
                if (!save.isPending && mayDiscard(!!draft)) {
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
              disabled={!q.data?.id || save.isPending}
              onClick={() => {
                if (!mayDiscard(!!draft)) return;
                setDraft(null);
                setCountProducts((q.data?.rows ?? []).map((r) => r.productCode));
                setProductRevision(q.data?.revision ?? 0);
              }}
            >
              调整盘点产品
            </Button>
            <Button
              disabled={!q.data?.id || save.isPending}
              onClick={async () => {
                if (save.isPending || !mayDiscard(!!draft)) return;
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
              disabled={!q.data?.id || save.isPending}
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
      <Modal
        title="调整盘点产品集合"
        mask={false}
        open={active && countProducts !== null}
        confirmLoading={replaceProducts.isPending}
        onCancel={() => {
          if (!replaceProducts.isPending && mayDiscard(true)) setCountProducts(null);
        }}
        onOk={() => void submitProducts()}
        okText="核对并确认调整"
        cancelText="返回"
      >
        <p>移除产品会删除该行实盘和差异。新增行按当前资料重新取得月末账面，保留行不重新计算。</p>
        <Select
          mode="multiple"
          aria-label="盘点产品集合"
          style={{ width: '100%' }}
          value={countProducts ?? []}
          disabled={replaceProducts.isPending}
          onChange={setCountProducts}
          showSearch={{ optionFilterProp: 'label' }}
          options={products.map((p) => ({
            value: p.code,
            label: `${p.code} ${p.name}${p.disabled ? '（停用）' : ''}`,
            disabled: p.disabled && !countProducts?.includes(p.code),
          }))}
        />
      </Modal>
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
                  disabled={save.isPending}
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
                  disabled={save.isPending}
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
          <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
            保存实盘
          </Button>
          <Button
            onClick={() => {
              if (!save.isPending && mayDiscard(true)) setDraft(null);
            }}
          >
            放弃实盘修改
          </Button>
        </Space>
      )}
    </PageContainer>
  );
}
