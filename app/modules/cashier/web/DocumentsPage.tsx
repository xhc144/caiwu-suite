import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  DIMENSION_TYPES,
  VOUCHER_STATUS_LABELS,
  periodStartDate,
  formatMoney,
  type DimensionValues,
} from '@caiwu/core';
import { useAccounts, useCurrentPeriod, usePermission, useVoucherTypes } from '@caiwu/web-kit';
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
  const list = useQuery(
    api.documents.queryOptions({
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
    }),
  );
  const accounts = useQuery(api.accounts.queryOptions({}));
  const canEdit = usePermission('cashier.document.edit');
  const canGenerate = usePermission('cashier.voucher.generate');
  const [editing, setEditing] = useState<CashDocument | 'new' | null>(null);
  const [keys, setKeys] = useState<React.Key[]>([]);
  const [generating, setGenerating] = useState<CashDocument[] | null>(null);
  const [confirm, holder] = useCashierConfirm();
  const remove = useMutation(
    api.removeDocument.mutationOptions({ onSuccess: () => void refresh() }),
  );
  const revoke = useMutation(api.revoke.mutationOptions({ onSuccess: () => void refresh() }));
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
            <Button
              loading={revoke.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `撤销生成批次 ${r.batchId}`,
                    content:
                      '将整体删除该批次所有未审核来源凭证并解锁全部原单。已审核、已过账或已勾账时会阻止。',
                    confirmText: '撤销生成',
                  })
                )
                  revoke.mutate({ batchId: r.batchId!, confirmed: true });
              }}
            >
              撤销生成
            </Button>
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
        <Form.Item name="min" label="最小金额">
          <MoneyInput />
        </Form.Item>
        <Form.Item name="max" label="最大金额">
          <MoneyInput />
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
  const cash = byId.get(accounts.data?.find((a) => a.id === cashId)?.coreAccountId ?? 0);
  const opposite = byId.get(oppositeId ?? 0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const create = useMutation(
    api.createDocument.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  const update = useMutation(
    api.updateDocument.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer
      open
      title={document === 'new' ? '新增收付单' : `修改 ${document.number}`}
      onClose={onClose}
      size={520}
    >
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
                }
              : document
          }
          onFinish={(v) => {
            const dimensions: DimensionValues = {};
            for (const dt of DIMENSION_TYPES)
              if (
                dt.id === 'cashflow' ||
                cash?.dimensions.some((d) => d.type === dt.id) ||
                opposite?.dimensions.some((d) => d.type === dt.id)
              )
                dimensions[dt.id] = v.dimensions?.[dt.id] ?? null;
            const data = { ...v, oppositeAccountId: v.oppositeAccountId ?? null, dimensions };
            if (document === 'new') create.mutate({ ...data, requestKey });
            else update.mutate({ id: document.id, revision: document.revision, data });
          }}
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
          <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
            <MoneyInput allowNegative={false} />
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
          <Button type="primary" htmlType="submit" loading={create.isPending || update.isPending}>
            保存收付单
          </Button>
        </Form>
      )}
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
  }>();
  const types = useVoucherTypes();
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
        voucher: `第 ${i + 1} 张`,
        sources: g.documentIds.map((id) => `CN-${id}`).join('、'),
      })),
    ) ?? [];
  return (
    <Drawer open title="凭证生成预览" onClose={onClose} size={900}>
      <Alert
        type="info"
        title={`已选择 ${documents.length} 笔单据。生成后为待审核，原单立即锁定；撤销须处理整个批次。`}
      />
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
          <Button htmlType="submit" loading={preview.isFetching}>
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
