import { useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageContainer, exportToExcel, useUrlFilters } from '@caiwu/ui';
import { centsToYuan } from '@caiwu/core';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Grid, WarehouseSelect, mayDiscard, useCatalog, useRefresh, useUnsaved } from './common';
import ImportButton from './ImportButton';
import OpeningEditor, { openingError, openingInput, type OpeningDraftLine } from './OpeningEditor';
import { importExportColumns } from '../excel';
import { openingValue } from '../opening';
export default function OpeningPage() {
  const [f, setF] = useUrlFilters({ warehouseId: 0 });
  const { warehouses, context } = useCatalog();
  const warehouseId =
    f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0;
  const q = useQuery({
    ...api.opening.queryOptions({ warehouseId: warehouseId || 1 }),
    enabled: !!warehouseId,
  });
  const [draft, setDraft] = useState<{
    warehouseId: number;
    revision: number;
    lines: OpeningDraftLine[];
  } | null>(null);
  const [error, setError] = useState('');
  const can = usePermission('inventory.edit');
  const refresh = useRefresh();
  const save = useMutation(api.saveOpening.mutationOptions());
  const latest = useRef(draft);
  latest.current = draft;
  const submit = async () => {
    if (!draft || save.isPending) return false;
    let rows;
    try {
      rows = draft.lines.map((line) => {
        const row = openingInput(line);
        openingValue(row);
        return row;
      });
      setError('');
    } catch (e) {
      setError(openingError(e));
      return false;
    }
    const replace = !!q.data?.rows.length;
    if (
      replace &&
      !window.confirm(
        `确认完整替换当前仓库期初为以下 ${draft.lines.length} 行？未列出的产品期初将被清除。`,
      )
    )
      return false;
    const saved = await save.mutateAsync({
      warehouseId: draft.warehouseId,
      revision: draft.revision,
      rows,
      confirmReplace: replace,
    });
    if (latest.current === draft) setDraft(null);
    else setDraft((current) => (current ? { ...current, revision: saved.revision } : current));
    await refresh();
    return true;
  };
  useUnsaved(!!draft, {
    pending: save.isPending,
    title: '库存期初',
    version: JSON.stringify(draft),
    save: submit,
    discard: () => {
      setDraft(null);
      setError('');
    },
  });
  return (
    <PageContainer
      title="库存期初"
      subtitle={`启用期间 ${context?.book.startPeriod ?? ''}；核算截止月 ${context?.control.cost_period ?? '未核算'}`}
    >
      <InventoryNavigation />
      <Space wrap>
        <span>当前仓库</span>
        <WarehouseSelect
          value={warehouseId || undefined}
          onChange={(id) => {
            if (save.isPending) return;
            if (mayDiscard(!!draft)) {
              setDraft(null);
              setError('');
              setF({ warehouseId: id });
            }
          }}
        />
        {can && (
          <Button
            disabled={!warehouseId || !q.data || save.isPending}
            onClick={() => {
              if (mayDiscard(!!draft)) {
                setError('');
                setDraft({
                  warehouseId,
                  revision: q.data?.revision ?? 0,
                  lines: (q.data?.rows ?? []).map((l) => ({
                    productCode: l.productCode,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    valueBasis: l.valueBasis,
                    amount: centsToYuan(l.amountCents),
                  })),
                });
              }
            }}
          >
            编辑期初
          </Button>
        )}
        <ImportButton
          kind="opening"
          warehouseId={warehouseId || undefined}
          revision={q.data?.revision}
          onSaved={() => setDraft(null)}
          disabled={!!draft || !q.data}
        />
      </Space>
      {q.error && <Alert type="error" title={q.error.message} />}
      {error && <Alert type="error" title={error} />}
      {draft ? (
        <>
          <Alert
            type="info"
            title="每行按所选口径保存；切换保留两种输入草稿。直接金额反算六位小数单价，仅在回算金额一致时保存。零数量反算、负数及无法保金额的尾差暂不支持。所有行一起保存。"
          />
          <OpeningEditor
            disabled={save.isPending}
            lines={draft.lines}
            onChange={(lines) => setDraft({ ...draft, lines })}
          />
          <Space>
            <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
              保存全部期初
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (mayDiscard(true)) setDraft(null);
              }}
            >
              放弃修改
            </Button>
          </Space>
        </>
      ) : (
        <Grid
          id="opening"
          title="库存期初"
          exportable={false}
          toolbar={
            <Button
              disabled={!q.data?.rows.length}
              onClick={() =>
                void exportToExcel({
                  fileName: '库存期初',
                  columns: importExportColumns('opening'),
                  rows: q.data?.rows ?? [],
                })
              }
            >
              导出 Excel
            </Button>
          }
          rows={q.data?.rows ?? []}
          columns={[
            { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
            { key: 'productName', title: '产品名称', dataIndex: 'productName' },
            { key: 'quantity', title: '数量', dataIndex: 'quantity' },
            {
              key: 'valueBasis',
              title: '保存口径',
              render: (_, r) => (r.valueBasis === 'amount' ? '直接金额' : '数量×单价'),
            },
            { key: 'unitPrice', title: '单价', dataIndex: 'unitPrice' },
            { key: 'amountCents', title: '金额', dataIndex: 'amountCents', money: true },
          ]}
        />
      )}
    </PageContainer>
  );
}
