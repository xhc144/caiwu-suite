import { useRef, useState } from 'react';
import { Alert, App, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountSelect, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { useHotkey, usePermission, useTab, useUnsavedChanges } from '@caiwu/web-kit';
import type { TransferInput } from '../transfer';
import { api } from './api';
import {
  Field,
  Grid,
  InventoryNavigation,
  LineEditor,
  TextField,
  mayDiscard,
  newLine,
  useCatalog,
  useInventoryNavigate,
  useRefresh,
} from './common';

export default function TransferPage() {
  const { active } = useTab();
  const { modal } = App.useApp();
  const { warehouses, context } = useCatalog();
  const client = useQueryClient(),
    navigate = useInventoryNavigate(),
    refresh = useRefresh();
  const canEdit = usePermission('inventory.edit'),
    canAudit = usePermission('inventory.audit');
  const [filters, setFilters] = useUrlFilters({ keyword: '', from: '', to: '' });
  const query = useQuery(
    api.transfers.queryOptions({
      keyword: filters.keyword || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
  );
  const [draft, setDraft] = useState<TransferInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const preview = useMutation(api.previewTransfer.mutationOptions());
  const save = useMutation(api.saveTransfer.mutationOptions());
  const remove = useMutation(api.removeTransfer.mutationOptions());
  const audit = useMutation(api.auditTransfer.mutationOptions());
  const change = (patch: Partial<TransferInput>) => {
    setDraft((old) => (old ? { ...old, ...patch } : old));
    setDirty(true);
    setVersion((n) => n + 1);
    preview.reset();
  };
  const submit = async (): Promise<boolean> => {
    if (!draft || submitting.current || !canEdit) return false;
    submitting.current = true;
    setBusy(true);
    try {
      const checked = await preview.mutateAsync(draft);
      let negativeConfirmation: string | undefined;
      if (checked.shortages.length) {
        const accepted = await new Promise<boolean>((resolve) =>
          modal.confirm({
            title: '调出库存不足，默认取消',
            content: (
              <ul>
                {checked.shortages.map((s) => (
                  <li key={s.productCode}>
                    {s.productCode} {s.productName}：当前 {s.current}，调出 {s.requested}，差额{' '}
                    {s.difference}
                  </li>
                ))}
              </ul>
            ),
            autoFocusButton: 'cancel',
            okText: '确认允许负库存',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk: () => {
              resolve(true);
            },
            onCancel: () => {
              resolve(false);
            },
          }),
        );
        if (!accepted) return false;
        negativeConfirmation = checked.confirmation;
      }
      await save.mutateAsync({ ...draft, negativeConfirmation });
      setDirty(false);
      setDraft(null);
      await refresh();
      return true;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  useUnsavedChanges({
    title: draft?.number ? `调拨单 ${draft.number}` : '仓库调拨',
    dirty: dirty || busy,
    version,
    save: submit,
    discard: () => {
      if (submitting.current) throw new Error('调拨正在保存，请等待结果后再关闭');
      setDraft(null);
      setDirty(false);
    },
  });
  useHotkey('Ctrl+S', () => {
    if (draft) void submit();
  });
  const close = () => {
    if (!busy && mayDiscard(dirty)) {
      setDraft(null);
      setDirty(false);
    }
  };
  const create = () => {
    if (submitting.current) return;
    if (!mayDiscard(dirty)) return;
    const active = warehouses.filter((w) => !w.disabled);
    setDraft({
      requestKey: crypto.randomUUID(),
      number: '',
      date: context?.current?.startDate ?? '',
      sourceWarehouseId: active[0]?.id ?? 0,
      targetWarehouseId: active[1]?.id ?? 0,
      clearingAccountId: 0,
      summary: '',
      operator: '',
      lines: [newLine()],
    });
    setDirty(false);
    preview.reset();
    setVersion((n) => n + 1);
  };
  const warehouseOptions = warehouses
    .filter((w) => !w.disabled)
    .map((w) => ({ value: w.id, label: `${w.code} ${w.name}` }));
  return (
    <PageContainer
      title="仓库调拨"
      subtitle="一次保存同时生成调出与调入单；数量与单据金额在两端相同。"
      extra={
        canEdit && (
          <Button type="primary" disabled={warehouseOptions.length < 2 || busy} onClick={create}>
            新增调拨单
          </Button>
        )
      }
    >
      <InventoryNavigation />
      {warehouseOptions.length < 2 && (
        <Alert type="info" title="请先在产品与仓库中建立两个启用仓库，再办理调拨。" />
      )}
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item name="keyword" label="调拨单号/摘要">
          <Input />
        </Form.Item>
        <Form.Item name="from" label="起始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="截止日期">
          <Input type="date" />
        </Form.Item>
      </FilterBar>
      {query.error && <Alert type="error" title={query.error.message} />}
      <Grid
        id="transfers"
        title="仓库调拨单"
        rows={query.data ?? []}
        columns={[
          { key: 'number', title: '调拨单号', dataIndex: 'number', width: 160 },
          { key: 'date', title: '日期', dataIndex: 'date' },
          { key: 'source', title: '调出仓库', dataIndex: 'sourceWarehouseName' },
          { key: 'target', title: '调入仓库', dataIndex: 'targetWarehouseName' },
          { key: 'issue', title: '调出单号', dataIndex: 'issueNumber' },
          { key: 'receipt', title: '调入单号', dataIndex: 'receiptNumber' },
          {
            key: 'status',
            title: '审核状态',
            exportValue: (r) => (r.issueAuditedBy && r.receiptAuditedBy ? '已审核' : '未审核'),
            render: (_, r) => (r.issueAuditedBy && r.receiptAuditedBy ? '已审核' : '未审核'),
          },
          {
            key: 'actions',
            title: '操作',
            noExport: true,
            width: 420,
            render: (_, r) => (
              <Space wrap>
                <Button
                  onClick={() => void navigate(`/m/inventory/issues?id=${r.issue_document_id}`)}
                >
                  查看调出单
                </Button>
                <Button
                  onClick={() => void navigate(`/m/inventory/receipts?id=${r.receipt_document_id}`)}
                >
                  查看调入单
                </Button>
                {canEdit && (
                  <Button
                    onClick={async () => {
                      if (!mayDiscard(dirty)) return;
                      const current = await client.fetchQuery(
                        api.transfer.queryOptions({ id: r.id }),
                      );
                      setDraft({
                        requestKey: crypto.randomUUID(),
                        number: '',
                        date: context?.current?.startDate ?? current.issue.date,
                        sourceWarehouseId: current.issue.warehouse_id,
                        targetWarehouseId: current.receipt.warehouse_id,
                        clearingAccountId: current.receipt.account_id ?? 0,
                        summary: '',
                        operator: '',
                        lines: current.issue.lines.map((l) => ({
                          productCode: l.productCode,
                          quantity: l.quantity,
                          unitPrice: l.unitPrice,
                          priceIncludesTax: false,
                          note: l.note,
                        })),
                      });
                      setDirty(true);
                      preview.reset();
                      setVersion((n) => n + 1);
                    }}
                  >
                    复制新增
                  </Button>
                )}
                {canAudit && (
                  <Button
                    loading={audit.isPending}
                    onClick={async () => {
                      await audit.mutateAsync({
                        id: r.id,
                        revision: r.revision,
                        issueRevision: r.issueRevision,
                        receiptRevision: r.receiptRevision,
                        to: !(r.issueAuditedBy && r.receiptAuditedBy),
                      });
                      await refresh();
                    }}
                  >
                    {r.issueAuditedBy && r.receiptAuditedBy ? '取消审核调拨' : '审核调拨'}
                  </Button>
                )}
                {canEdit && (
                  <Button
                    danger
                    loading={remove.isPending}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `确认删除调拨单 ${r.number}，并同时撤回调出与调入库存影响？`,
                        )
                      )
                        return;
                      await remove.mutateAsync({
                        id: r.id,
                        revision: r.revision,
                        issueRevision: r.issueRevision,
                        receiptRevision: r.receiptRevision,
                        confirmed: true,
                      });
                      await refresh();
                    }}
                  >
                    删除调拨
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title="新增调拨单"
        open={active && !!draft}
        mask={false}
        size="large"
        onClose={close}
        extra={
          <Space>
            <Button disabled={busy} onClick={close}>
              返回
            </Button>
            <Button type="primary" loading={busy} disabled={!canEdit} onClick={() => void submit()}>
              保存调拨单
            </Button>
          </Space>
        }
      >
        {draft && (
          <>
            <Alert
              type="info"
              title="按填写的调拨单价记录两端单据金额，不计税；正式出库成本在月末核算。保存后成对管理，需更改时删除后重录。"
            />
            <Form layout="vertical" disabled={busy || !canEdit}>
              <TextField
                label="调拨单号"
                value={draft.number}
                onChange={(number) => change({ number })}
              />
              <Field label="调出仓库">
                <Select
                  aria-label="调出仓库"
                  value={draft.sourceWarehouseId || undefined}
                  options={warehouseOptions}
                  onChange={(sourceWarehouseId: number) => change({ sourceWarehouseId })}
                />
              </Field>
              <Field label="调入仓库">
                <Select
                  aria-label="调入仓库"
                  value={draft.targetWarehouseId || undefined}
                  options={warehouseOptions}
                  onChange={(targetWarehouseId: number) => change({ targetWarehouseId })}
                />
              </Field>
              <TextField
                label="调拨日期"
                type="date"
                value={draft.date}
                onChange={(date) => change({ date })}
              />
              <Field label="调拨对方科目">
                <AccountSelect
                  aria-label="调拨对方科目"
                  value={draft.clearingAccountId || undefined}
                  onChange={(clearingAccountId) =>
                    change({ clearingAccountId: clearingAccountId ?? 0 })
                  }
                />
              </Field>
              <TextField
                label="操作人"
                value={draft.operator}
                onChange={(operator) => change({ operator })}
              />
              <TextField
                label="摘要"
                value={draft.summary}
                onChange={(summary) => change({ summary })}
              />
              <LineEditor
                warehouseId={draft.sourceWarehouseId || undefined}
                opening
                lines={draft.lines}
                onChange={(lines) => change({ lines })}
              />
            </Form>
            <Button
              loading={preview.isPending}
              disabled={busy}
              onClick={() => preview.mutate(draft)}
            >
              检查调拨及库存
            </Button>
            {preview.data && (
              <Alert
                type="info"
                title={`调出单 ${preview.data.issueNumber}；调入单 ${preview.data.receiptNumber}；单据金额 ${formatMoney(preview.data.netCents)} 元`}
              />
            )}
          </>
        )}
      </Drawer>
    </PageContainer>
  );
}
