import { useRef, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  DIMENSION_TYPES,
  VOUCHER_STATUS_LABELS,
  periodStartDate,
  formatMoney,
  convertCurrency,
  type DimensionValues,
} from '@caiwu/core';
import {
  coreApi,
  useAccounts,
  useCurrentPeriod,
  usePermission,
  useVoucherTypes,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  FilterBar,
  MoneyInput,
  PageContainer,
  PeriodPicker,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import type { DocumentFilter, GenerateInput } from '../shared';
import { api, refresh, type CashDocument } from './api';
import { CashierNav, QueryState, useCashierConfirm } from './common';
import BulkTools from './BulkTools';
import RevokeDrawer from './RevokeDrawer';
import { useCashierEditor, useMoneyDrafts } from './useCashierEditor';

export default function DocumentsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({
    id: 0,
    batch: 0,
    accountId: 0,
    from: '',
    to: '',
    keyword: '',
    min: '',
    max: '',
    partnerId: 0,
    generated: 'all',
    matched: 'all',
    sort: 'date',
  });
  const documentFilter: DocumentFilter = {
    ...filters,
    id: filters.id || undefined,
    batch: filters.batch || undefined,
    accountId: filters.accountId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    min: filters.min ? Number(filters.min) : undefined,
    max: filters.max ? Number(filters.max) : undefined,
    partnerId: filters.partnerId || undefined,
    generated: filters.generated as DocumentFilter['generated'],
    matched: filters.matched as DocumentFilter['matched'],
    sort: filters.sort as DocumentFilter['sort'],
  };
  const list = useQuery(api.documents.queryOptions(documentFilter));
  const accounts = useQuery(api.accounts.queryOptions({}));
  const canEdit = usePermission('cashier.document.edit');
  const canGenerate = usePermission('cashier.voucher.generate');
  const [editing, setEditing] = useState<CashDocument | 'new' | null>(null);
  const [keys, setKeys] = useState<React.Key[]>([]);
  const [generating, setGenerating] = useState<CashDocument[] | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [confirm, holder] = useCashierConfirm();
  const [filterForm] = Form.useForm<DocumentFilter>();
  const filterMoney = useMoneyDrafts();
  const remove = useMutation(
    api.removeDocument.mutationOptions({ onSuccess: () => void refresh() }),
  );
  const columns: DataColumn<CashDocument>[] = [
    {
      key: 'number',
      title: '单号',
      dataIndex: 'number',
      width: 130,
      sorter: (a, b) => a.id - b.id,
    },
    { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
    { key: 'accountName', title: '账户', dataIndex: 'accountName', width: 160 },
    { key: 'currency', title: '币种', dataIndex: 'currency', width: 70 },
    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 180 },
    {
      key: 'receipt',
      title: '收款',
      money: true,
      render: (_, r) => (r.direction === 'receipt' ? formatMoney(r.amount) : ''),
      exportValue: (r) => (r.direction === 'receipt' ? r.amount : 0),
    },
    {
      key: 'payment',
      title: '付款',
      money: true,
      render: (_, r) => (r.direction === 'payment' ? formatMoney(r.amount) : ''),
      exportValue: (r) => (r.direction === 'payment' ? r.amount : 0),
    },
    { key: 'foreignAmount', title: '原币金额', dataIndex: 'foreignAmount', money: true },
    { key: 'exchangeRate', title: '汇率', dataIndex: 'exchangeRate', width: 100 },
    { key: 'opposite', title: '对方科目', dataIndex: 'oppositeName', width: 180 },
    { key: 'refNo', title: '票号', dataIndex: 'refNo', width: 130 },
    {
      key: 'voucher',
      title: '来源凭证',
      width: 210,
      exportValue: (r) => r.voucherNo,
      render: (_, r) =>
        r.voucherId ? (
          <Space>
            <Button
              type="link"
              onClick={() => void navigate(`/m/voucher-entry/edit?id=${r.voucherId}`)}
            >
              {r.voucherNo}
            </Button>
            <Tag>{r.voucherStatus ? VOUCHER_STATUS_LABELS[r.voucherStatus] : '关联异常'}</Tag>
            <Tag>来源锁定</Tag>
          </Space>
        ) : (
          '未生成'
        ),
    },
    {
      key: 'match',
      title: '勾账状态',
      width: 100,
      render: (_, r) => (r.matchId ? `已勾账 #${r.matchId}` : '未勾账'),
      exportValue: (r) => (r.matchId ? '已勾账' : '未勾账'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 240,
      noExport: true,
      render: (_, r) => (
        <Space>
          {canEdit && !r.voucherId && !r.matchId && (
            <>
              <Button onClick={() => setEditing(r)}>修改</Button>
              <Button
                danger
                loading={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `删除 ${r.number}`,
                      content: `将删除 ${r.date} 的「${r.summary}」，不能恢复。`,
                      confirmText: '删除',
                    })
                  )
                    remove.mutate({ id: r.id, revision: r.revision, confirmed: true });
                }}
              >
                删除
              </Button>
            </>
          )}
          {canGenerate && r.batchId && (
            <Button onClick={() => setRevoking(r.batchId!)}>撤销生成</Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title="出纳收付单"
      subtitle="单号自动唯一；凭证生成后原单锁定；不会自动审核或过账"
      extra={
        <>
          {canEdit && (
            <BulkTools
              selection={(list.data ?? [])
                .filter((r) => keys.includes(r.id))
                .map((r) => ({ id: r.id, revision: r.revision }))}
              filter={documentFilter}
              onChanged={() => setKeys([])}
            />
          )}
          {canEdit && (
            <Button type="primary" onClick={() => setEditing('new')}>
              新增收付单
            </Button>
          )}
          {canGenerate && (
            <Button
              disabled={!keys.length}
              onClick={() => setGenerating((list.data ?? []).filter((r) => keys.includes(r.id)))}
            >
              生成凭证预览
            </Button>
          )}
          <Button onClick={() => void navigate('/m/cashier/reconcile')}>从账务查看（只读）</Button>
        </>
      }
    >
      <CashierNav />
      {filters.batch > 0 && (
        <Alert type="info" title={`生成批次 ${filters.batch} 的全部来源单据`} />
      )}
      <FilterBar<DocumentFilter>
        form={filterForm}
        onReset={() => filterMoney.reset()}
        initialValues={{
          ...filters,
          accountId: filters.accountId || undefined,
          partnerId: filters.partnerId || undefined,
          generated: filters.generated as DocumentFilter['generated'],
          matched: filters.matched as DocumentFilter['matched'],
          sort: filters.sort as DocumentFilter['sort'],
          min: filters.min ? Number(filters.min) : undefined,
          max: filters.max ? Number(filters.max) : undefined,
        }}
        onSearch={(v) => {
          if (!filterMoney.preflight(filterForm, ['min', 'max'])) return;
          setKeys([]);
          setFilters({
            id: 0,
            batch: 0,
            accountId: v.accountId ?? 0,
            keyword: v.keyword ?? '',
            from: v.from ?? '',
            to: v.to ?? '',
            min: v.min == null ? '' : String(v.min),
            max: v.max == null ? '' : String(v.max),
            partnerId: v.partnerId ?? 0,
            generated: v.generated ?? 'all',
            matched: v.matched ?? 'all',
            sort: v.sort ?? 'date',
          });
        }}
      >
        <Form.Item name="accountId" label="账户">
          <Select
            allowClear
            style={{ width: 180 }}
            options={accounts.data?.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
        <Form.Item name="from" label="从">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="到">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="keyword" label="摘要">
          <Input allowClear />
        </Form.Item>
        <Form.Item name="min" label="最小金额" rules={[filterMoney.rule('min')]}>
          <MoneyInput {...filterMoney.input('min')} />
        </Form.Item>
        <Form.Item name="max" label="最大金额" rules={[filterMoney.rule('max')]}>
          <MoneyInput {...filterMoney.input('max')} />
        </Form.Item>
        <Form.Item name="partnerId" label="客供">
          <DimensionSelect type="partner" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="generated" label="生成">
          <Select
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'yes', label: '已生成' },
              { value: 'no', label: '未生成' },
            ]}
          />
        </Form.Item>
        <Form.Item name="matched" label="勾账">
          <Select
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'yes', label: '已勾账' },
              { value: 'no', label: '未勾账' },
            ]}
          />
        </Form.Item>
        <Form.Item name="sort" label="排序">
          <Select
            style={{ width: 120 }}
            options={[
              { value: 'date', label: '日期' },
              { value: 'amount', label: '金额' },
              { value: 'number', label: '录入顺序' },
            ]}
          />
        </Form.Item>
      </FilterBar>
      <QueryState loading={list.isLoading} error={list.error} retry={list.refetch}>
        <DataTable
          tableId="cashier.documents"
          rowKey="id"
          columns={columns}
          dataSource={list.data ?? []}
          exportName="出纳收付单"
          rowSelection={{
            selectedRowKeys: keys,
            onChange: setKeys,
            getCheckboxProps: (r) => ({ disabled: !!r.voucherId || !!r.matchId }),
          }}
          locale={{ emptyText: '没有符合条件的单据，请新增收付单或调整筛选' }}
        />
      </QueryState>
      {editing && <DocumentDrawer document={editing} onClose={() => setEditing(null)} />}
      {generating && (
        <GenerateDrawer
          documents={generating}
          onClose={() => {
            setGenerating(null);
            setKeys([]);
          }}
        />
      )}
      {revoking != null && <RevokeDrawer batchId={revoking} onClose={() => setRevoking(null)} />}
      {holder}
    </PageContainer>
  );
}
function DocumentDrawer({
  document,
  onClose,
}: {
  document: CashDocument | 'new';
  onClose: () => void;
}) {
  const [form] = Form.useForm<{
    accountId: number;
    period: number;
    date: string;
    summary: string;
    direction: 'receipt' | 'payment';
    amount: number;
    foreignAmount: number | null;
    exchangeRate: string | null;
    oppositeAccountId?: number;
    dimensions: DimensionValues;
    refNo: string;
    note: string;
  }>();
  const period = useCurrentPeriod();
  const accounts = useQuery(api.accounts.queryOptions({}));
  const { byId } = useAccounts();
  const cashId = Form.useWatch('accountId', form);
  const oppositeId = Form.useWatch('oppositeAccountId', form);
  const selectedPeriod = Form.useWatch('period', form);
  const currency = accounts.data?.find((a) => a.id === cashId)?.currency;
  const cash = byId.get(accounts.data?.find((a) => a.id === cashId)?.coreAccountId ?? 0);
  const opposite = byId.get(oppositeId ?? 0);
  const foreign = !!cash?.currency;
  const rate = useQuery(
    api.exchangeRate.queryOptions(
      { currency: currency ?? '', period: selectedPeriod ?? period?.period ?? 202601 },
      { enabled: foreign && !!selectedPeriod },
    ),
  );
  const [requestKey] = useState(() => crypto.randomUUID());
  const edit = useRef(
    document === 'new' ? undefined : { id: document.id, revision: document.revision },
  );
  const create = useMutation(api.createDocument.mutationOptions());
  const update = useMutation(api.updateDocument.mutationOptions());
  const editor = useCashierEditor({
    form,
    title: '出纳收付单',
    fields: foreign ? ['amount', 'foreignAmount'] : ['amount'],
    onClose,
    onSave: async (v) => {
      const dimensions: DimensionValues = {};
      for (const dt of DIMENSION_TYPES)
        if (
          dt.id === 'cashflow' ||
          cash?.dimensions.some((d) => d.type === dt.id) ||
          opposite?.dimensions.some((d) => d.type === dt.id)
        )
          dimensions[dt.id] = v.dimensions?.[dt.id] ?? null;
      const data = {
        ...v,
        foreignAmount: foreign ? v.foreignAmount : null,
        exchangeRate: foreign ? v.exchangeRate : null,
        oppositeAccountId: v.oppositeAccountId ?? null,
        dimensions,
      };
      if (edit.current) {
        await update.mutateAsync({ ...edit.current, data });
        edit.current = { ...edit.current, revision: edit.current.revision + 1 };
      } else {
        const result = await create.mutateAsync({ ...data, requestKey });
        edit.current = { id: result.id, revision: 1 };
      }
      void refresh();
    },
  });
  return (
    <Drawer
      open
      title={document === 'new' ? '新增收付单' : `修改 ${document.number}`}
      onClose={editor.close}
      size={520}
    >
      {editor.savedEarlier && (
        <Alert type="info" title="先前内容已保存，保存期间的新修改仍未保存。" />
      )}
      {period && accounts.data && (
        <Form
          name="cashier-document"
          form={form}
          layout="vertical"
          initialValues={
            document === 'new'
              ? {
                  period: period?.period,
                  date: period ? periodStartDate(period.period) : '',
                  direction: 'receipt',
                  dimensions: {},
                  refNo: '',
                  note: '',
                  foreignAmount: null,
                  exchangeRate: null,
                }
              : document
          }
          onValuesChange={(changed, values) => {
            editor.changed();
            if (changed.accountId != null) {
              const account = byId.get(
                accounts.data?.find((a) => a.id === changed.accountId)?.coreAccountId ?? 0,
              );
              if (!account?.currency) {
                editor.money.reset('foreignAmount');
                form.setFieldsValue({ foreignAmount: null, exchangeRate: null });
              }
            }
            if (changed.foreignAmount != null || changed.exchangeRate != null) {
              const rate = values.exchangeRate;
              if (
                values.foreignAmount != null &&
                editor.money.valid(['foreignAmount', 'amount']) &&
                rate &&
                /^\d+(?:\.\d+)?$/.test(rate) &&
                Number(rate) > 0
              ) {
                try {
                  form.setFieldValue('amount', convertCurrency(values.foreignAmount, rate));
                } catch {
                  /* 金额范围由表单与服务端给出提示。 */
                }
              }
            }
          }}
          onFinish={() => void editor.save()}
        >
          <Form.Item name="accountId" label="出纳账户" rules={[{ required: true }]}>
            <Select
              options={accounts.data
                ?.filter((a) => !a.disabled)
                .map((a) => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>
          <Form.Item name="period" label="选择期间" rules={[{ required: true }]}>
            <PeriodPicker />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="summary" label="摘要" rules={[{ required: true }]}>
            <Input autoFocus maxLength={200} />
          </Form.Item>
          <Form.Item name="direction" label="收付方向" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'receipt', label: '收款' },
                { value: 'payment', label: '付款' },
              ]}
            />
          </Form.Item>
          {foreign && (
            <>
              <Form.Item
                name="foreignAmount"
                label={`原币金额（${currency}）`}
                rules={[{ required: true }, editor.money.rule('foreignAmount')]}
              >
                <MoneyInput allowNegative={false} {...editor.money.input('foreignAmount')} />
              </Form.Item>
              <Form.Item
                name="exchangeRate"
                label="汇率（原币折本位币）"
                rules={[{ required: true }]}
              >
                <Input inputMode="decimal" />
              </Form.Item>
              <Button
                disabled={!rate.data}
                onClick={() => {
                  if (!editor.money.preflight(form, ['foreignAmount', 'amount'])) return;
                  editor.changed();
                  form.setFieldValue('exchangeRate', rate.data);
                  const foreignAmount = form.getFieldValue('foreignAmount');
                  if (foreignAmount != null && rate.data)
                    form.setFieldValue('amount', convertCurrency(foreignAmount, rate.data));
                }}
              >
                使用已设汇率{rate.data ? ` ${rate.data}` : '（未设置）'}
              </Button>
            </>
          )}
          <Form.Item
            name="amount"
            label={foreign ? '折合本位币金额' : '金额'}
            rules={[{ required: true }, editor.money.rule('amount')]}
          >
            <MoneyInput allowNegative={false} {...editor.money.input('amount')} />
          </Form.Item>
          <Form.Item
            name="oppositeAccountId"
            label="对方科目"
            extra="生成凭证前必须明确填写对方末级科目"
          >
            <AccountSelect />
          </Form.Item>
          {DIMENSION_TYPES.filter(
            (dt) =>
              dt.id === 'cashflow' ||
              cash?.dimensions.some((d) => d.type === dt.id) ||
              opposite?.dimensions.some((d) => d.type === dt.id),
          ).map((dt) => (
            <Form.Item key={dt.id} name={['dimensions', dt.id]} label={dt.name}>
              <DimensionSelect type={dt.id} />
            </Form.Item>
          ))}
          <Form.Item name="refNo" label="票号">
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea maxLength={500} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            aria-label="保存收付单"
            loading={editor.isSubmitting}
          >
            保存收付单
          </Button>
          <Button onClick={editor.close}>取消</Button>
        </Form>
      )}
      {editor.holder}
    </Drawer>
  );
}
function GenerateDrawer({
  documents,
  onClose,
}: {
  documents: CashDocument[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<{
    date: string;
    mode: 'individual' | 'summary';
    voucherTypeId: number;
    firstNumber?: number;
  }>();
  const types = useVoucherTypes();
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const [input, setInput] = useState<GenerateInput | null>(null);
  const [requestKey] = useState(() => crypto.randomUUID());
  const preview = useQuery(
    api.preview.queryOptions(input!, { enabled: input != null, retry: false }),
  );
  const generate = useMutation(
    api.generate.mutationOptions({
      onSuccess: () => {
        onClose();
        void refresh();
      },
    }),
  );
  const rows =
    preview.data?.groups.flatMap((g, i) =>
      g.lines.map((l, j) => ({
        ...l,
        key: `${i}-${j}`,
        voucher: g.number == null ? `第 ${i + 1} 张` : `第 ${i + 1} 张（${g.number}号）`,
        sources: g.documentIds.map((id) => `CN-${id}`).join('、'),
      })),
    ) ?? [];
  return (
    <Drawer open title="凭证生成预览" onClose={onClose} size={900}>
      <Alert
        type="info"
        title={`已选择 ${documents.length} 笔单据。生成后为待审核，原单立即锁定；撤销须处理整个批次。`}
      />
      {policy.error && (
        <Alert
          type="error"
          title={policy.error.message}
          action={<Button onClick={() => void policy.refetch()}>重试编号设置</Button>}
        />
      )}
      {types.length > 0 && (
        <Form
          name="cashier-generate"
          form={form}
          layout="inline"
          initialValues={{
            date: documents[0]?.date,
            mode: 'individual',
            voucherTypeId: types.find((t) => !t.disabled)?.id,
          }}
          onValuesChange={() => setInput(null)}
          onFinish={(v) =>
            setInput({
              ...v,
              firstNumber: policy.data?.numbering === 'manual' ? v.firstNumber : undefined,
              documents: documents.map((d) => ({ id: d.id, revision: d.revision })),
            })
          }
        >
          <Form.Item name="date" label="凭证日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="voucherTypeId" label="凭证字" rules={[{ required: true }]}>
            <Select
              style={{ width: 100 }}
              options={types
                .filter((t) => !t.disabled)
                .map((t) => ({ value: t.id, label: t.code }))}
            />
          </Form.Item>
          <Form.Item name="mode" label="方式">
            <Select
              style={{ width: 160 }}
              options={[
                { value: 'individual', label: '每单一张' },
                { value: 'summary', label: '本月汇总一张' },
              ]}
            />
          </Form.Item>
          {policy.data?.numbering === 'manual' && (
            <Form.Item
              name="firstNumber"
              label="第一张凭证号"
              rules={[{ required: true, message: '请填写手工凭证号' }]}
            >
              <InputNumber min={1} precision={0} max={Number.MAX_SAFE_INTEGER} />
            </Form.Item>
          )}
          <Button htmlType="submit" disabled={!policy.data} loading={preview.isFetching}>
            预览分录
          </Button>
        </Form>
      )}
      {input && (
        <QueryState loading={preview.isFetching} error={preview.error} retry={preview.refetch}>
          <DataTable
            tableId="cashier.preview"
            rowKey="key"
            dataSource={rows}
            columns={[
              { key: 'voucher', title: '凭证', dataIndex: 'voucher', width: 100 },
              { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
              { key: 'fcAmount', title: '原币金额', dataIndex: 'fcAmount', money: true },
              { key: 'exchangeRate', title: '汇率', dataIndex: 'exchangeRate', width: 100 },
              { key: 'sources', title: '来源单据', dataIndex: 'sources', width: 150 },
              { key: 'summary', title: '摘要', dataIndex: 'summary', width: 180 },
              { key: 'accountName', title: '科目', dataIndex: 'accountName', width: 180 },
              { key: 'debit', title: '借方', dataIndex: 'debit', money: true },
              { key: 'credit', title: '贷方', dataIndex: 'credit', money: true },
            ]}
          />
          <Button
            type="primary"
            disabled={!preview.data || preview.isFetching}
            loading={generate.isPending}
            onClick={() => input && generate.mutate({ ...input, requestKey })}
          >
            确认生成待审核凭证
          </Button>
        </QueryState>
      )}
    </Drawer>
  );
}
