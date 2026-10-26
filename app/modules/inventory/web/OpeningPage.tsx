import { useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { InventoryNavigation } from './common';
import {
  Grid,
  LineEditor,
  WarehouseSelect,
  mayDiscard,
  useCatalog,
  useRefresh,
  useUnsaved,
  type EditLine,
} from './common';
import ImportButton from './ImportButton';
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
    lines: EditLine[];
  } | null>(null);
  const can = usePermission('inventory.edit');
  const refresh = useRefresh();
  const save = useMutation(api.saveOpening.mutationOptions());
  useUnsaved(!!draft);
  const submit = async () => {
    if (!draft) return;
    const replace = !!q.data?.rows.length;
    if (
      replace &&
      !window.confirm(
        `确认完整替换当前仓库期初为以下 ${draft.lines.length} 行？未列出的产品期初将被清除。`,
      )
    )
      return;
    await save.mutateAsync({
      warehouseId: draft.warehouseId,
      revision: draft.revision,
      rows: draft.lines.map((l) => ({
        productCode: l.productCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      confirmReplace: replace,
    });
    setDraft(null);
    await refresh();
  };
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
            if (mayDiscard(!!draft)) {
              setDraft(null);
              setF({ warehouseId: id });
            }
          }}
        />
        {can && (
          <Button
            disabled={!warehouseId}
            onClick={() => {
              if (mayDiscard(!!draft))
                setDraft({
                  warehouseId,
                  revision: q.data?.revision ?? 0,
                  lines: (q.data?.rows ?? []).map((l) => ({
                    ...l,
                    priceIncludesTax: false,
                    note: '',
                  })),
                });
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
        />
      </Space>
      {q.error && <Alert type="error" title={q.error.message} />}
      {draft ? (
        <>
          <Alert
            type="info"
            title="所有行一起保存；空或非法数字不会被当作零。关闭或刷新可取消退出。"
          />
          <LineEditor
            opening
            lines={draft.lines}
            onChange={(lines) => setDraft({ ...draft, lines })}
          />
          <Space>
            <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
              保存全部期初
            </Button>
            <Button
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
          rows={q.data?.rows ?? []}
          columns={[
            { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
            { key: 'productName', title: '产品名称', dataIndex: 'productName' },
            { key: 'quantity', title: '数量', dataIndex: 'quantity' },
            { key: 'unitPrice', title: '单价', dataIndex: 'unitPrice' },
            { key: 'amountCents', title: '金额', dataIndex: 'amountCents', money: true },
          ]}
        />
      )}
    </PageContainer>
  );
}
