import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Checkbox, Form, Input, Popconfirm, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BusinessError, periodOfDate, today } from '@caiwu/core';
import {
  queryClient,
  showError,
  useAccounts,
  usePermission,
  useSession,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  FilterBar,
  MoneyText,
  PageContainer,
  PeriodPicker,
} from '@caiwu/ui';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import { IssueOptionsSchema, type Invoice, type IssueDraft } from '../shared';
import { useInvoiceFilters } from './useInvoiceFilters';
import { api } from './api';
import { invoiceColumns, Nav, QueryError } from './common';

type Outputs = inferRouterOutputs<InvoiceRouter>;
type Preview = Outputs['previewIssue'];
type References = Outputs['issueReferences'];

function ProductRow({
  index,
  invoice,
  refs,
}: {
  index: number;
  invoice: Outputs['issueDetails']['invoice'];
  refs: References;
}) {
  const form = Form.useFormInstance<IssueDraft>();
  const create = Form.useWatch(['products', index, 'create'], form);
  const productCode = Form.useWatch(['products', index, 'productCode'], form);
  const selectedProduct = refs.products.find(
    (p: References['products'][number]) => p.code === productCode,
  );
  const line = invoice.lines[index]!;
  const candidates = refs.products.filter(
    (p: References['products'][number]) =>
      !p.disabled &&
      p.name.trim() === line.name.trim() &&
      p.specification.trim() === line.specification.trim() &&
      p.unit.trim() === line.unit.trim(),
  );
  return (
    <Card
      size="small"
      title={`第 ${index + 1} 行：${line.name} ${line.specification}（${line.unit}）`}
      style={{ marginBottom: 12 }}
    >
      <p>
        数量 {line.quantity}，单价 {line.unitPrice}；不含税金额 <MoneyText value={line.amount} />
        ，税额 <MoneyText value={line.tax} />
        ，价税合计 <MoneyText value={line.total} />
      </p>
      <Form.Item name={[index, 'lineNo']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={[index, 'create']} valuePropName="checked">
        <Checkbox aria-label={`第${index + 1}行新增产品`}>
          原票商品没有对应档案，本次新增产品
        </Checkbox>
      </Form.Item>
      <Form.Item
        name={[index, 'productCode']}
        label={`第${index + 1}行产品编码`}
        rules={[{ required: true, message: '请选择已有产品或填写新产品编码' }]}
      >
        {create ? (
          <Input maxLength={100} />
        ) : (
          <Select
            showSearch={{ optionFilterProp: 'label' }}
            options={candidates.map((p: References['products'][number]) => ({
              value: p.code,
              label: `${p.code} ${p.name} ${p.specification}（${p.unit}）`,
            }))}
          />
        )}
      </Form.Item>
      {!create && (
        <p>
          {candidates.length === 1
            ? '已按名称、规格和单位精确匹配，请核对产品编码。'
            : candidates.length > 1
              ? '存在多个名称、规格和单位相同的产品，请明确选择。'
              : '没有完全匹配的产品，请核对档案名称、规格和单位；确无对应档案时勾选新增产品。'}
        </p>
      )}
      {!create &&
        selectedProduct &&
        (selectedProduct.inventoryAccountId == null || selectedProduct.salesAccountId == null) && (
          <Alert
            type="warning"
            title="此产品尚未配置存货或收入科目"
            description={
              <>
                请到<Link to="/m/inventory/master">产品档案</Link>
                补齐有效科目，再刷新仓库和产品目录后预览。
              </>
            }
          />
        )}
      {create && (
        <Space wrap align="start">
          <Form.Item
            name={[index, 'inventoryAccountId']}
            label={`第${index + 1}行新产品存货科目`}
            rules={[{ required: true, message: '请选择存货科目' }]}
          >
            <AccountSelect leafOnly style={{ width: 270 }} />
          </Form.Item>
          <Form.Item
            name={[index, 'salesAccountId']}
            label={`第${index + 1}行新产品收入科目`}
            rules={[{ required: true, message: '请选择收入科目' }]}
          >
            <AccountSelect leafOnly style={{ width: 270 }} />
          </Form.Item>
        </Space>
      )}
      {line.taxMark === 'unspecified' && (
        <Form.Item
          name={[index, 'taxRate']}
          label={`第${index + 1}行税率（13%填0.13）`}
          rules={[{ required: true, message: '请按原票明确填写税率' }]}
        >
          <Input maxLength={60} style={{ width: 220 }} />
        </Form.Item>
      )}
    </Card>
  );
}
export default function IssuePage() {
  const session = useSession();
  const enabled = session?.book.product === 'chengben';
  const can = usePermission('invoice.issue');
  const canVoucher = usePermission('invoice.voucher');
  const canStock = usePermission('inventory.edit');
  const canProducts = usePermission('invoice.product');
  const { byId: accounts } = useAccounts();
  const [filters, setFilters] = useInvoiceFilters({ period: periodOfDate(today()), invoiceId: 0 });
  const list = useQuery(api.list.queryOptions({ direction: 'output', period: filters.period }));
  const [selected, setSelected] = useState<{ id: number; revision: number } | null>(null);
  const refs = useQuery({
    ...api.issueReferences.queryOptions({ invoiceId: selected?.id }),
    enabled: enabled && can,
  });
  const sources = useQuery({ ...api.issueSources.queryOptions(), enabled: enabled && can });
  const draft = useQuery({ ...api.issueDraft.queryOptions(), enabled: enabled && can });
  const details = useQuery({
    ...api.issueDetails.queryOptions({
      invoiceId: selected?.id ?? 1,
      invoiceRevision: selected?.revision ?? 1,
    }),
    enabled: enabled && can && selected != null,
  });
  const [form] = Form.useForm<IssueDraft>();
  const currentProducts = Form.useWatch('products', { form, preserve: true });
  const [plan, setPlan] = useState<Preview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [newProductsConfirmed, setNewProductsConfirmed] = useState(false);
  const [negativeStockConfirmed, setNegativeStockConfirmed] = useState(false);
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const generation = useRef(0);
  const discardPreview = useCallback(() => {
    generation.current++;
    setPlan(null);
    setNewProductsConfirmed(false);
    setNegativeStockConfirmed(false);
    setReplacementConfirmed(false);
  }, []);
  const saveDraft = useMutation(
    api.saveIssueDraft.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: api.issueDraft.queryKey() }),
    }),
  );
  const preview = useMutation(api.previewIssue.mutationOptions());
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: api.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.issueSources.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.issueReferences.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.issueDraft.queryKey() }),
    ]);
  const save = useMutation(
    api.saveIssue.mutationOptions({
      onSuccess: () => {
        discardPreview();
        setDirty(false);
        setSelected(null);
        setFilters({ invoiceId: 0 });
        form.resetFields();
        void refresh();
      },
    }),
  );
  const busy = save.isPending || saveDraft.isPending;
  const initializing = !details.data || !refs.data || !currentProducts?.length;
  const chooseInvoice = useCallback(
    (invoice: Invoice, changed = true) => {
      setSelected({ id: invoice.id, revision: invoice.revision });
      form.resetFields();
      form.setFieldsValue({
        invoiceId: invoice.id,
        invoiceRevision: invoice.revision,
        requestKey: crypto.randomUUID(),
        date: invoice.date,
        number: `FP-${invoice.number}`,
        regenerate: invoice.state === 'issued',
        products: [],
      });
      setDirty(changed);
      setVersion((v) => v + 1);
      discardPreview();
    },
    [discardPreview, form],
  );
  useEffect(() => {
    if (!selected && filters.invoiceId) {
      const invoice = list.data?.find((d) => d.id === filters.invoiceId);
      if (invoice) chooseInvoice(invoice, false);
    }
  }, [chooseInvoice, filters.invoiceId, list.data, selected]);
  useEffect(() => {
    if (!details.data || !refs.data || !selected || form.getFieldValue('products')?.length) return;
    const data = details.data;
    const previous = data.previousInput;
    form.setFieldsValue({
      date: previous?.date ?? form.getFieldValue('date'),
      number: previous?.number ?? form.getFieldValue('number'),
      warehouseId:
        previous?.warehouseId ??
        (refs.data.warehouses.length === 1 ? refs.data.warehouses[0]?.id : undefined),
      settlementAccountId: previous?.settlementAccountId ?? data.defaults.settlementAccountId,
      costAccountId: previous?.costAccountId,
      products: data.invoice.lines.map((line, index) => {
        const matches = refs.data.products.filter(
          (p: References['products'][number]) =>
            !p.disabled &&
            p.name.trim() === line.name.trim() &&
            p.specification.trim() === line.specification.trim() &&
            p.unit.trim() === line.unit.trim(),
        );
        return {
          lineNo: index + 1,
          productCode:
            previous?.lines[index]?.productCode ?? (matches.length === 1 ? matches[0]!.code : ''),
          create: false,
          salesAccountId: data.defaults.salesAccountId,
          taxRate: line.taxRate ?? undefined,
        };
      }),
    });
  }, [details.data, form, refs.data, selected]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!plan) return;
    const timer = setTimeout(discardPreview, Math.max(0, plan.plan.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [discardPreview, plan]);
  const persistDraft = async () => {
    await saveDraft.mutateAsync(form.getFieldsValue());
    setDirty(false);
  };
  useUnsavedChanges({
    title: '发票出库输入',
    dirty,
    version,
    save: async () => {
      if (busy) return false;
      await persistDraft();
      return true;
    },
    discard: () => {
      discardPreview();
      setSelected(null);
      form.resetFields();
      setDirty(false);
    },
  });
  const restoreDraft = () => {
    if (!draft.data || busy) return;
    form.resetFields();
    form.setFieldsValue(draft.data);
    setSelected(
      draft.data.invoiceId && draft.data.invoiceRevision
        ? { id: draft.data.invoiceId, revision: draft.data.invoiceRevision }
        : null,
    );
    setDirty(false);
    discardPreview();
  };
  async function buildPreview(values: IssueDraft) {
    const current = ++generation.current;
    setPlan(null);
    setNewProductsConfirmed(false);
    setNegativeStockConfirmed(false);
    setReplacementConfirmed(false);
    try {
      const options = IssueOptionsSchema.parse({
        ...values,
        invoiceId: selected?.id,
        invoiceRevision: selected?.revision,
      });
      const result = await preview.mutateAsync(options);
      if (current === generation.current) setPlan(result);
    } catch (error) {
      if (current === generation.current) showError(error);
    }
  }
  if (!enabled)
    return (
      <PageContainer title="发票转出库">
        <Nav />
        <Alert
          type="info"
          title="当前账套未启用库存业务"
          description="请在成本会计账套使用发票转出库。"
        />
      </PageContainer>
    );
  return (
    <PageContainer title="发票转出库" subtitle="逐票核对产品与票面金额，预览后确认保存销售出库单">
      <Nav />
      <Alert
        type="info"
        title="先审核销项发票，再转销售出库单"
        description="本方式直接生成销售出库单，后续收入和成本凭证在库存、成本业务办理。已制证发票须先处理原凭证。红字退货尚未接通，会明确阻止。"
      />
      {!canStock && <Alert type="warning" title="还需要“维护仓库业务”权限才能转出库" />}
      {!canVoucher && <Alert type="warning" title="还需要“发票制证”权限才能读取库存目录及转出库" />}
      <FilterBar
        initialValues={{ period: filters.period }}
        onSearch={(values) => {
          if (busy) return;
          if (dirty) {
            showError(
              new BusinessError({
                code: 'INVOICE_ISSUE_UNSAVED',
                message: '出库输入尚未保存，不能切换查询范围',
                hint: '先保存出库输入，或确认放弃后查询',
              }),
            );
            return;
          }
          setFilters({ ...values, invoiceId: 0 });
          setSelected(null);
          form.resetFields();
          discardPreview();
        }}
      >
        <Form.Item name="period" label="销项发票月份">
          <PeriodPicker />
        </Form.Item>
      </FilterBar>
      <QueryError error={list.error} retry={list.refetch} />
      <DataTable
        tableId="invoice-issue-selection"
        rowKey="id"
        columns={invoiceColumns}
        dataSource={list.data ?? []}
        loading={list.isPending}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selected ? [selected.id] : [],
          onChange: (keys) => {
            const invoice = list.data?.find((d) => d.id === keys[0]);
            if (dirty && invoice?.id !== selected?.id) return;
            if (invoice) chooseInvoice(invoice);
          },
          getCheckboxProps: (invoice) => ({
            disabled:
              busy ||
              (dirty && selected?.id !== invoice.id) ||
              invoice.invoiceStatus !== 'normal' ||
              (invoice.state !== 'audited' && invoice.state !== 'issued'),
          }),
        }}
      />
      {dirty && <p>更换发票前，请先保存或放弃本次出库输入。</p>}
      <Button
        disabled={busy || refs.isFetching}
        onClick={() => {
          discardPreview();
          void refs.refetch();
        }}
      >
        刷新仓库和产品目录
      </Button>
      <QueryError error={refs.error} retry={refs.refetch} />
      <QueryError error={details.error} retry={details.refetch} />
      <QueryError error={draft.error} retry={draft.refetch} />
      {draft.data && (
        <Alert
          type="info"
          title="有已保存的出库输入"
          action={
            <Popconfirm
              title="恢复已保存输入并放弃当前未保存的修改？"
              disabled={!dirty || busy}
              onConfirm={restoreDraft}
            >
              <Button
                disabled={busy}
                onClick={() => {
                  if (!dirty) restoreDraft();
                }}
              >
                恢复出库输入
              </Button>
            </Popconfirm>
          }
        />
      )}
      {can && selected && (
        <Form
          form={form}
          layout="vertical"
          disabled={busy || initializing}
          initialValues={{ date: today(), regenerate: false, products: [] }}
          onValuesChange={() => {
            setDirty(true);
            setVersion((v) => v + 1);
            form.setFieldValue('requestKey', crypto.randomUUID());
            discardPreview();
          }}
          onFinish={(values) => void buildPreview(values)}
        >
          <Form.Item name="invoiceId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="invoiceRevision" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="requestKey" hidden>
            <Input />
          </Form.Item>
          <Space wrap align="start">
            <Form.Item
              name="warehouseId"
              label="出库仓库"
              rules={[{ required: true, message: '请选择出库仓库' }]}
            >
              <Select
                style={{ width: 240 }}
                loading={refs.isPending}
                options={refs.data?.warehouses.map((w: References['warehouses'][number]) => ({
                  value: w.id,
                  label: `${w.code} ${w.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="date"
              label="出库日期"
              rules={[{ required: true, message: '请填写出库日期' }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              name="number"
              label="出库单号"
              rules={[{ required: true, message: '请填写出库单号' }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="settlementAccountId"
              label="结算科目"
              rules={[{ required: true, message: '请选择结算科目' }]}
            >
              <AccountSelect leafOnly style={{ width: 260 }} />
            </Form.Item>
            <Form.Item
              name="costAccountId"
              label="销售成本科目"
              rules={[{ required: true, message: '请选择销售成本科目' }]}
            >
              <AccountSelect leafOnly style={{ width: 260 }} />
            </Form.Item>
          </Space>
          <Form.Item name="regenerate" valuePropName="checked">
            <Checkbox>重新生成此发票的原出库单</Checkbox>
          </Form.Item>
          {details.data && refs.data && (
            <Form.List name="products">
              {(fields) => (
                <>
                  {fields.map((field) => (
                    <ProductRow
                      key={field.key}
                      index={field.name}
                      invoice={details.data!.invoice}
                      refs={refs.data}
                    />
                  ))}
                </>
              )}
            </Form.List>
          )}
          <Space wrap>
            <Button
              htmlType="submit"
              type="primary"
              loading={preview.isPending}
              disabled={busy || initializing || preview.isPending || !canStock || !canVoucher}
            >
              预览出库单
            </Button>
            <Button
              disabled={busy || !dirty}
              loading={saveDraft.isPending}
              onClick={() => {
                void persistDraft().catch(() => undefined);
              }}
            >
              保存出库输入
            </Button>
            <Popconfirm
              title="放弃未保存的出库输入？"
              onConfirm={() => {
                setSelected(null);
                form.resetFields();
                setDirty(false);
                discardPreview();
              }}
            >
              <Button disabled={busy || !dirty}>放弃出库输入</Button>
            </Popconfirm>
          </Space>
        </Form>
      )}
      {plan && (
        <Card title="出库单预览（尚未保存）" style={{ marginTop: 18 }}>
          <p>
            来源发票 {plan.invoice.number}，出库单号 {plan.input.number}，日期 {plan.input.date}
            ；金额 <MoneyText value={plan.invoice.amount} />
            ，税额 <MoneyText value={plan.invoice.tax} />
            ，合计 <MoneyText value={plan.invoice.total} />
          </p>
          <DataTable
            tableId="invoice-issue-preview"
            rowKey={(_, index) => String(index)}
            dataSource={plan.input.lines}
            columns={[
              { key: 'productCode', title: '产品编码', dataIndex: 'productCode', width: 140 },
              { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 120 },
              { key: 'unitPrice', title: '票面单价', dataIndex: 'unitPrice', width: 130 },
              { key: 'taxRate', title: '税率（%）', dataIndex: 'taxRate', width: 100 },
              {
                key: 'netCents',
                title: '不含税金额',
                dataIndex: 'netCents',
                money: true,
                width: 140,
              },
              { key: 'taxCents', title: '税额', dataIndex: 'taxCents', money: true, width: 130 },
              {
                key: 'totalCents',
                title: '价税合计',
                dataIndex: 'totalCents',
                money: true,
                width: 140,
              },
            ]}
          />
          {plan.input.newProducts.length > 0 && (
            <Card size="small" title="拟新增产品">
              <ul>
                {plan.input.newProducts.map((product) => (
                  <li key={product.code}>
                    {product.code} {product.name} {product.specification}（{product.unit}
                    ），存货科目 {accounts.get(product.inventoryAccountId)?.code}{' '}
                    {accounts.get(product.inventoryAccountId)?.name}，收入科目{' '}
                    {accounts.get(product.salesAccountId)?.code}{' '}
                    {accounts.get(product.salesAccountId)?.name}
                  </li>
                ))}
              </ul>
              <Checkbox
                checked={newProductsConfirmed}
                disabled={busy || !canProducts}
                onChange={(event) => setNewProductsConfirmed(event.target.checked)}
              >
                已核对并同意新增以上产品
              </Checkbox>
              {!canProducts && <p>请联系管理员授予“转出库时确认新增产品”权限。</p>}
            </Card>
          )}
          {plan.plan.shortages.length > 0 && (
            <Card size="small" title="库存不足">
              <ul>
                {plan.plan.shortages.map((shortage) => (
                  <li key={`${shortage.warehouseId}:${shortage.productCode}`}>
                    产品 {shortage.productCode}，可用 {shortage.availableQuantity}，本次出库{' '}
                    {shortage.requiredQuantity}，短缺 {shortage.shortageQuantity}
                  </li>
                ))}
              </ul>
              <Checkbox
                checked={negativeStockConfirmed}
                disabled={busy}
                onChange={(event) => setNegativeStockConfirmed(event.target.checked)}
              >
                已核对以上短缺，确认本次允许负库存出库
              </Checkbox>
            </Card>
          )}
          {plan.issue && (
            <Card size="small" title="替换原出库单">
              <p>
                原出库单 {plan.issue.number}，日期 {plan.issue.date}
                。审核、制证或成本核算锁定的原单不能替换；任一步失败保留原单。
              </p>
              <Checkbox
                checked={replacementConfirmed}
                disabled={busy}
                onChange={(event) => setReplacementConfirmed(event.target.checked)}
              >
                已核对并确认替换原出库单
              </Checkbox>
            </Card>
          )}
          <Popconfirm
            title="确认保存此销售出库单？"
            onConfirm={() =>
              save.mutate({
                options: plan.options,
                plan: plan.plan,
                fingerprint: plan.fingerprint,
                newProductsConfirmed,
                negativeStockConfirmed,
                replacementConfirmed,
              })
            }
          >
            <Button
              type="primary"
              loading={save.isPending}
              disabled={
                busy ||
                (plan.input.newProducts.length > 0 && (!newProductsConfirmed || !canProducts)) ||
                (plan.plan.shortages.length > 0 && !negativeStockConfirmed) ||
                (!!plan.issue && !replacementConfirmed)
              }
            >
              确认转出库
            </Button>
          </Popconfirm>
          <Button disabled={busy} onClick={discardPreview}>
            取消出库预览
          </Button>
        </Card>
      )}
      <h4>发票出库来源</h4>
      <QueryError error={sources.error} retry={sources.refetch} />
      {(sources.data ?? []).map((source) => (
        <Card key={source.id} size="small">
          <Space wrap>
            出库单 {source.number}，日期 {source.date}
            <Link to={`/m/inventory/issues?id=${source.inventory_document_id}`}>查看出库单</Link>
            <Link to={`/m/invoice/output?id=${source.invoice_id}`}>查看来源发票</Link>
          </Space>
        </Card>
      ))}
    </PageContainer>
  );
}
