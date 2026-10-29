import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { App, Alert, Button, Checkbox, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { AccountSelect, FilterBar, PageContainer, useUrlFilters, exportToExcel } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { useHotkey, usePermission, useTab } from '@caiwu/web-kit';
import { importExportColumns } from '../excel';
import { api } from './api';
import { InventoryNavigation } from './common';
import {
  Field,
  Grid,
  LineEditor,
  TextField,
  WarehouseSelect,
  mayDiscard,
  newLine,
  useInventoryNavigate,
  useCatalog,
  useRefresh,
  useUnsaved,
} from './common';
import ImportButton from './ImportButton';
import DocumentExchange from './DocumentExchange';
import ReversalButton from './ReversalButton';
import type { DocumentInput } from '../shared';
export default function DocumentPage() {
  const { active } = useTab();
  const { modal } = App.useApp();
  const location = useLocation(),
    navigate = useInventoryNavigate(),
    client = useQueryClient();
  const kind = location.pathname.endsWith('/issues') ? 'issue' : 'receipt';
  const [f, setF] = useUrlFilters({
    warehouseId: 0,
    keyword: '',
    from: '',
    to: '',
    id: 0,
    unvouchered: false,
  });
  const { warehouses, context } = useCatalog();
  const warehouseId =
    f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0;
  const query = useQuery(
    api.documents.queryOptions({
      kind,
      warehouseId: warehouseId || undefined,
      keyword: f.keyword || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
      unvouchered: f.unvouchered,
    }),
  );
  const loaded = useRef('');
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DocumentInput | null>(null),
    [dirty, setDirty] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const canEdit = usePermission('inventory.edit'),
    canAudit = usePermission('inventory.audit');
  const canAccounts = usePermission('masterdata.view');
  const refresh = useRefresh();
  const save = useMutation(api.saveDocument.mutationOptions()),
    preview = useMutation(api.previewDocument.mutationOptions()),
    remove = useMutation(api.removeDocument.mutationOptions()),
    audit = useMutation(api.audit.mutationOptions()),
    next = useMutation(api.nextNumber.mutationOptions());
  const change = (patch: Partial<DocumentInput>) => {
    setEditing((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
    preview.reset();
  };
  const openDocument = useCallback(
    async (id: number) => {
      if (submitting.current) return;
      if (!mayDiscard(dirty)) return;
      const d = await client.fetchQuery(api.document.queryOptions({ id }));
      setEditing({
        id: d.id,
        revision: d.revision,
        requestKey: crypto.randomUUID(),
        kind: d.kind,
        warehouseId: d.warehouse_id,
        number: d.number,
        date: d.date,
        category: d.category as DocumentInput['category'],
        operator: d.operator,
        summary: d.summary,
        accountId: d.account_id,
        costAccountId: d.cost_account_id,
        taxRate: d.tax_rate,
        invoiceKind: d.invoice_kind,
        sourceType:
          d.source_type === 'invoice' ? null : (d.source_type as DocumentInput['sourceType']),
        sourceId: d.source_type === 'invoice' ? null : d.source_id,
        lines: d.lines.map((l) => ({
          productCode: l.productCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          priceIncludesTax: l.priceIncludesTax,
          note: l.note,
        })),
      });
      setDirty(false);
      preview.reset();
    },
    [client, dirty, preview],
  );
  useEffect(() => {
    const contractId = new URLSearchParams(location.search).get('contractId');
    const key = f.id ? `document:${f.id}` : contractId ? `contract:${contractId}` : '';
    if (!key || loaded.current === key) return;
    loaded.current = key;
    if (f.id) void openDocument(f.id);
    else if (contractId)
      void client
        .fetchQuery(api.contractDraft.queryOptions({ id: Number(contractId) }))
        .then((d) => {
          setEditing(d);
          setDirty(true);
        });
  }, [f.id, location.search, client, openDocument]);
  const create = () => {
    if (submitting.current) return;
    if (!mayDiscard(dirty)) return;
    setEditing({
      requestKey: crypto.randomUUID(),
      kind,
      warehouseId,
      number: '',
      date: context?.current?.startDate ?? '2026-01-01',
      category: kind === 'receipt' ? '采购' : '销售',
      operator: '',
      summary: '',
      accountId: null,
      costAccountId: null,
      taxRate: '0',
      invoiceKind: 'none',
      lines: [newLine()],
    });
    setDirty(false);
    preview.reset();
  };
  const submit = async (): Promise<boolean> => {
    if (!editing || submitting.current) return false;
    const snapshot = editing;
    submitting.current = true;
    setSaving(true);
    try {
      const p = await preview.mutateAsync(editing);
      let confirmation: string | undefined;
      if (p.shortages.length) {
        const agreed = await new Promise<boolean>((resolve) =>
          modal.confirm({
            title: '库存不足，默认取消',
            content: (
              <ul>
                {p.shortages.map((r) => (
                  <li key={r.productCode}>
                    {r.productCode} {r.productName}：当前 {r.current}，申请 {r.requested}，差额{' '}
                    {r.difference}
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
        if (!agreed) return false;
        confirmation = p.confirmation;
      }
      const saved = await save.mutateAsync({ ...editing, negativeConfirmation: confirmation });
      if (editingRef.current !== snapshot) {
        setEditing((draft) =>
          draft
            ? { ...draft, id: saved.id, revision: saved.revision, requestKey: crypto.randomUUID() }
            : draft,
        );
        await refresh();
        return false;
      }
      flushSync(() => {
        setDirty(false);
        setEditing(null);
        setSaving(false);
      });
      loaded.current = '';
      setF({ id: 0 });
      await refresh();
      return true;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  useUnsaved(dirty, {
    pending: saving,
    title: kind === 'receipt' ? '入库单管理' : '出库单管理',
    version: JSON.stringify(editing),
    save: submit,
    discard: () => {
      setEditing(null);
      setDirty(false);
    },
  });
  useHotkey('Ctrl+S', () => {
    if (editing && canEdit) void submit();
  });
  const exportRows = useQuery({
    ...api.document.queryOptions({ id: editing?.id ?? 1 }),
    enabled: !!editing?.id,
  });
  const h = exportRows.data?.id === editing?.id ? exportRows.data : undefined;
  const locked =
    !!h &&
    (h.audited_by != null ||
      h.source_type === 'invoice' ||
      !!h.transfer ||
      !!h.reversal ||
      h.voucher_id != null ||
      h.calculation_status !== 'uncalculated' ||
      !!(context?.control.cost_cutoff_date && h.date <= context.control.cost_cutoff_date) ||
      !!(context?.current?.startDate && h.date < context.current.startDate));
  const close = () => {
    if (saving) return;
    if (mayDiscard(dirty)) {
      setEditing(null);
      setDirty(false);
      setF({ id: 0 });
    }
  };
  const list = query.data ?? [];
  const currentIndex = list.findIndex((d) => d.id === editing?.id);
  const move = (index: number) => {
    const id = list[index]?.id;
    if (id && !saving) void openDocument(id);
  };
  const copy = async (id: number) => {
    if (submitting.current || !mayDiscard(dirty)) return;
    setEditing(await client.fetchQuery(api.copyDocument.queryOptions({ id })));
    setDirty(true);
    preview.reset();
  };
  useHotkey('Ctrl+A', create, { enabled: canEdit && !saving, allowInInput: false });
  useHotkey(
    'Ctrl+K',
    () => {
      if (editing?.id) void copy(editing.id);
    },
    { enabled: canEdit && !!editing?.id && !saving, allowInInput: false },
  );
  useHotkey('Ctrl+Home', () => move(0), { enabled: list.length > 0, allowInInput: false });
  useHotkey('Ctrl+End', () => move(list.length - 1), {
    enabled: list.length > 0,
    allowInInput: false,
  });
  useHotkey('ArrowUp', () => move(currentIndex - 1), {
    enabled: currentIndex > 0,
    allowInInput: false,
  });
  useHotkey('ArrowDown', () => move(currentIndex + 1), {
    enabled: currentIndex >= 0 && currentIndex < list.length - 1,
    allowInInput: false,
  });
  return (
    <PageContainer
      title={kind === 'receipt' ? '入库单管理' : '出库单管理'}
      subtitle="保存即计入库存；反冲保留原单，调拨成对处理。成本核算与会计凭证可在成本业务中办理。"
      extra={
        canEdit && (
          <Button type="primary" disabled={!warehouseId || saving} onClick={create}>
            新增{kind === 'receipt' ? '入库单' : '出库单'}
          </Button>
        )
      }
    >
      <InventoryNavigation />
      {canAccounts && (
        <Button onClick={() => void navigate('/m/masterdata/accounts')}>维护会计科目</Button>
      )}
      <FilterBar initialValues={f} onSearch={(v) => setF({ ...v, id: 0 })}>
        <Form.Item label="当前仓库">
          <WarehouseSelect
            value={warehouseId || undefined}
            onChange={(warehouseId) => setF({ warehouseId })}
          />
        </Form.Item>
        <Form.Item name="keyword" label="单号/摘要">
          <Input />
        </Form.Item>
        <Form.Item name="from" label="起始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="截止日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="unvouchered" valuePropName="checked">
          <Checkbox>仅未生成凭证</Checkbox>
        </Form.Item>
      </FilterBar>
      {query.error && <Alert type="error" title={query.error.message} />}
      <DocumentExchange
        documents={query.data ?? []}
        onImported={() => {
          loaded.current = '';
        }}
      />
      <Grid
        id={kind}
        title={kind === 'receipt' ? '入库单浏览' : '出库单浏览'}
        rows={query.data ?? []}
        columns={[
          { key: 'number', title: '单号', dataIndex: 'number', width: 150 },
          { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
          { key: 'warehouse_name', title: '仓库', dataIndex: 'warehouse_name' },
          { key: 'category', title: '类别', dataIndex: 'category' },
          {
            key: 'invoice_kind',
            title: '发票种类',
            exportValue: (d) =>
              ({ none: '不指定', ordinary: '普通发票', special: '增值税专用发票' })[d.invoice_kind],
            render: (_, d) =>
              ({ none: '不指定', ordinary: '普通发票', special: '增值税专用发票' })[d.invoice_kind],
          },
          { key: 'operator', title: '操作人', dataIndex: 'operator' },
          { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
          {
            key: 'audit',
            title: '仓库审核',
            exportValue: (d) => d.auditor_name ?? '未审核',
            render: (_, d) => (d.auditor_name ? `已审核：${d.auditor_name}` : '未审核'),
          },
          {
            key: 'cost',
            title: '核算',
            exportValue: (d) => (d.calculation_status === 'calculated' ? '已核算' : '未核算'),
            render: (_, d) => (d.calculation_status === 'calculated' ? '已核算' : '未核算'),
          },
          {
            key: 'voucher',
            title: '关联凭证',
            exportValue: (d) => d.voucher_id ?? '未生成',
            render: (_, d) =>
              d.voucher_id ? (
                <a
                  href={`/m/voucher-entry/edit?id=${d.voucher_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    void navigate(`/m/voucher-entry/edit?id=${d.voucher_id}`);
                  }}
                >
                  凭证 {d.voucher_id}
                </a>
              ) : (
                '未生成'
              ),
          },
          {
            key: 'actions',
            title: '操作',
            noExport: true,
            width: 330,
            render: (_, d) => (
              <Space wrap>
                <Button onClick={() => void openDocument(d.id)}>查看/编辑</Button>
                {d.source_type === 'invoice' && (
                  <Button
                    onClick={() => void navigate(`/m/invoice/process?invoiceId=${d.source_id}`)}
                  >
                    查看来源发票
                  </Button>
                )}
                {d.transfer && (
                  <Button
                    onClick={() => void navigate(`/m/inventory/transfers?id=${d.transfer!.id}`)}
                  >
                    查看调拨
                  </Button>
                )}
                {d.reversal && (
                  <span>{d.reversal.original_document_id === d.id ? '已反冲' : '反冲单'}</span>
                )}
                {canEdit && d.source_type !== 'invoice' && !d.transfer && !d.reversal && (
                  <ReversalButton
                    id={d.id}
                    onSaved={() => {
                      loaded.current = '';
                    }}
                  />
                )}
                {canEdit && d.source_type !== 'invoice' && (
                  <Button onClick={() => void copy(d.id)}>复制新增</Button>
                )}
                {canAudit && !d.transfer && (
                  <Button
                    loading={audit.isPending}
                    onClick={async () => {
                      await audit.mutateAsync({
                        id: d.id,
                        revision: d.revision,
                        to: d.audited_by == null,
                      });
                      await refresh();
                    }}
                  >
                    {d.audited_by ? '取消审核' : '审核'}
                  </Button>
                )}
                {canEdit &&
                  d.source_type !== 'invoice' &&
                  !d.transfer &&
                  d.reversal?.original_document_id !== d.id && (
                    <Button
                      danger
                      onClick={async () => {
                        if (window.confirm(`确认删除单据 ${d.number} 及其库存影响？`)) {
                          await remove.mutateAsync({
                            id: d.id,
                            revision: d.revision,
                            confirmed: true,
                          });
                          await refresh();
                        }
                      }}
                    >
                      删除
                    </Button>
                  )}
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={
          editing?.id
            ? `单据 ${editing.number}`
            : `新增${editing?.kind === 'receipt' ? '入库单' : '出库单'}`
        }
        open={!!editing && active}
        size="large"
        mask={false}
        onClose={close}
        extra={
          <Space>
            <Button disabled={saving} onClick={close}>
              返回
            </Button>
            {canEdit && !locked && (
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                保存单据
              </Button>
            )}
          </Space>
        }
      >
        {editing && (
          <>
            <Space>
              <Button disabled={currentIndex <= 0 || saving} onClick={() => move(0)}>
                第一张
              </Button>
              <Button disabled={currentIndex <= 0 || saving} onClick={() => move(currentIndex - 1)}>
                上一张
              </Button>
              <Button
                disabled={currentIndex < 0 || currentIndex >= list.length - 1 || saving}
                onClick={() => move(currentIndex + 1)}
              >
                下一张
              </Button>
              <Button
                disabled={currentIndex < 0 || currentIndex >= list.length - 1 || saving}
                onClick={() => move(list.length - 1)}
              >
                最后一张
              </Button>
              <span>
                审核 {h?.audited_by ? '已审核' : '未审核'}；核算{' '}
                {h?.calculation_status === 'calculated' ? '已核算' : '未核算'}
              </span>
            </Space>
            {locked && (
              <Alert type="warning" title="单据已有审核、凭证、核算或关联记录，当前仅供查看。" />
            )}
            <Form layout="vertical" disabled={locked || !canEdit || saving}>
              <Field label="单据仓库">
                <WarehouseSelect
                  value={editing.warehouseId}
                  onChange={(warehouseId) => change({ warehouseId })}
                />
              </Field>
              <TextField
                label="单号"
                value={editing.number}
                onChange={(number) => change({ number })}
              />
              <Button
                loading={next.isPending}
                onClick={async () => {
                  if (!window.confirm('确认由系统重新计算单号吗？')) return;
                  change({
                    number: await next.mutateAsync({
                      kind: editing.kind,
                      warehouseId: editing.warehouseId,
                      date: editing.date,
                    }),
                  });
                }}
              >
                自动编号（确认后重算）
              </Button>
              <TextField
                label="单据日期"
                type="date"
                value={editing.date}
                onChange={(date) => change({ date })}
              />
              <Field label="单据类别">
                <Select
                  aria-label="单据类别"
                  value={editing.category}
                  onChange={(category) => change({ category })}
                  options={(editing.kind === 'receipt'
                    ? ['采购', '其他入库']
                    : ['销售', '领用', '其他出库']
                  ).map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <TextField
                label="操作人"
                value={editing.operator}
                onChange={(operator) => change({ operator })}
              />
              <TextField
                label="摘要"
                value={editing.summary}
                onChange={(summary) => change({ summary })}
              />
              <Field label={editing.kind === 'receipt' ? '付款科目' : '收款科目'}>
                <AccountSelect
                  aria-label={editing.kind === 'receipt' ? '付款科目' : '收款科目'}
                  value={editing.accountId ?? undefined}
                  onChange={(accountId) => change({ accountId: accountId ?? null })}
                  allowClear
                />
              </Field>
              {editing.kind === 'issue' && (
                <Field label="成本科目">
                  <AccountSelect
                    aria-label="成本科目"
                    value={editing.costAccountId ?? undefined}
                    onChange={(costAccountId) => change({ costAccountId: costAccountId ?? null })}
                  />
                </Field>
              )}
              {h?.source_type !== 'invoice' && (
                <Field label="发票种类">
                  <Select
                    aria-label="发票种类"
                    value={editing.invoiceKind ?? 'none'}
                    options={[
                      { value: 'none', label: '不指定' },
                      { value: 'ordinary', label: '普通发票' },
                      { value: 'special', label: '增值税专用发票' },
                    ]}
                    onChange={(invoiceKind) => {
                      const rate =
                        invoiceKind === 'special'
                          ? context?.settings.specialTaxRate
                          : invoiceKind === 'ordinary'
                            ? context?.settings.ordinaryTaxRate
                            : '0';
                      if (
                        !editing.id &&
                        editing.taxRate !== '0' &&
                        editing.taxRate !== rate &&
                        !window.confirm(
                          `改选发票种类将带入默认税率 ${rate ?? '0'}%，确认替换本单税率？`,
                        )
                      )
                        return;
                      change({ invoiceKind, ...(!editing.id ? { taxRate: rate ?? '0' } : {}) });
                    }}
                  />
                </Field>
              )}
              {h?.source_type !== 'invoice' && (
                <TextField
                  label="税率（%）"
                  value={editing.taxRate}
                  onChange={(taxRate) => change({ taxRate })}
                />
              )}
              {h?.source_type !== 'invoice' && (
                <LineEditor
                  warehouseId={editing.warehouseId}
                  taxRate={editing.taxRate}
                  lines={editing.lines}
                  onChange={(lines) => change({ lines })}
                />
              )}
            </Form>
            {!locked && (
              <Button loading={preview.isPending} onClick={() => preview.mutate(editing)}>
                检查库存及金额
              </Button>
            )}
            {!locked && (
              <ImportButton
                kind="document"
                document={editing}
                onSaved={() => {
                  setEditing(null);
                  setDirty(false);
                }}
              />
            )}
            {preview.data && (
              <Alert
                title={`不含税 ${formatMoney(preview.data.netCents)}，税额 ${formatMoney(preview.data.taxCents)}，价税合计 ${formatMoney(preview.data.grossCents)}`}
                type="info"
              />
            )}
            {h && (
              <Grid
                id="document-lines"
                title={`单据明细-${h.number}`}
                rows={h.lines}
                toolbar={
                  h.source_type !== 'invoice' && (
                    <Button
                      onClick={() =>
                        void exportToExcel({
                          fileName: `单据可回导明细-${h.number}`,
                          columns: importExportColumns('document'),
                          rows: h.lines.map((l) => ({
                            productCode: l.productCode,
                            quantity: l.quantity,
                            unitPrice: l.unitPrice,
                            priceIncludesTax: l.priceIncludesTax,
                            note: l.note,
                          })),
                        })
                      }
                    >
                      导出可回导明细
                    </Button>
                  )
                }
                columns={[
                  { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                  { key: 'productName', title: '产品名称', dataIndex: 'productName' },
                  { key: 'quantity', title: '数量', dataIndex: 'quantity' },
                  { key: 'unit_price', title: '不含税单价', dataIndex: 'unit_price' },
                  { key: 'tax_unit_price', title: '含税单价', dataIndex: 'tax_unit_price' },
                  {
                    key: 'tax_rate',
                    title: '税率（%）',
                    exportValue: (l) => l.tax_rate ?? h.tax_rate,
                    render: (_, l) => l.tax_rate ?? h.tax_rate,
                  },
                  { key: 'net_cents', title: '金额', dataIndex: 'net_cents', money: true },
                  { key: 'tax_cents', title: '税额', dataIndex: 'tax_cents', money: true },
                  { key: 'gross_cents', title: '价税合计', dataIndex: 'gross_cents', money: true },
                  {
                    key: 'status',
                    title: '成本状态',
                    exportValue: (l) =>
                      l.calculation_status === 'calculated' ? '已核算' : '未核算',
                    render: (_, l) => (l.calculation_status === 'calculated' ? '已核算' : '未核算'),
                  },
                ]}
              />
            )}
          </>
        )}
      </Drawer>
    </PageContainer>
  );
}
