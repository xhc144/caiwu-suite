import { useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, periodEndDate } from '@caiwu/core';
import { coreApi, notify, queryClient, useUnsavedChanges, useVoucherTypes } from '@caiwu/web-kit';
import { AccountSelect, PageContainer } from '@caiwu/ui';
import type { z } from 'zod';
import type { inferRouterOutputs } from '@trpc/server';
import type { CostingRouter } from '../server/router';
import { ProductionSchema, type ProductionDraftSchema } from '../production-shared';
import { api } from './api';
import DeletionImpact from './DeletionImpact';

type Draft = z.infer<typeof ProductionDraftSchema>;
type Context = inferRouterOutputs<CostingRouter>['productionContext'];
type Preview = inferRouterOutputs<CostingRouter>['previewProduction'];

const empty = (period: number): Draft => ({
  date: periodEndDate(period),
  warehouseId: null,
  materialAccountId: null,
  laborAccountId: null,
  overheadAccountId: null,
  rows: [],
  requestKey: crypto.randomUUID(),
});

export default function ProductionPage() {
  const context = useQuery(api.productionContext.queryOptions());
  const draft = useQuery(api.productionDraft.queryOptions());
  if (context.error || draft.error)
    return <Alert type="error" title={(context.error ?? draft.error)?.message} />;
  if (!context.data || draft.isPending)
    return (
      <PageContainer title="生产成本分摊">
        <Typography.Text>正在读取完工产品与已保存草稿…</Typography.Text>
      </PageContainer>
    );
  return (
    <ProductionEditor initial={draft.data ?? empty(context.data.period)} context={context.data} />
  );
}

function ProductionEditor({ initial, context }: { initial: Draft; context: Context }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [persistedDraft, setPersistedDraft] = useState(initial);
  const [requested, setRequested] = useState<z.infer<typeof ProductionSchema> | null>(null);
  const [previewVersion, setPreviewVersion] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [view, setView] = useState<Preview | null>(null);
  const [voucherTypeId, setVoucherTypeId] = useState<number>();
  const [number, setNumber] = useState<number | null>(null);
  const types = useVoucherTypes();
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const saveDraft = useMutation(api.saveProductionDraft.mutationOptions());
  const markDraftSaved = (stored: Draft) => {
    setPersistedDraft(stored);
    setSaved(JSON.stringify(stored));
    queryClient.setQueryData(api.productionDraft.queryKey(), stored);
  };
  const preview = useQuery(
    api.previewProduction.queryOptions(
      requested ?? {
        date: draft.date,
        warehouseId: 1,
        materialAccountId: 1,
        laborAccountId: 2,
        overheadAccountId: 3,
        rows: [],
      },
      { enabled: !!requested, retry: false },
    ),
  );
  const cancellation = useQuery(
    api.previewCancelProduction.queryOptions(
      { id: cancelId ?? 1 },
      { enabled: cancelId != null, retry: false },
    ),
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: api.productionContext.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.voucherDocuments.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.context.queryKey() });
    void queryClient.invalidateQueries({ queryKey: coreApi.vouchers.list.queryKey() });
  };
  const save = useMutation(
    api.saveProduction.mutationOptions({
      onSuccess: () => {
        notify.success('完工入库和分摊凭证已保存');
        setConfirmOpen(false);
        setRequested(null);
        const next = { ...draft, rows: [], requestKey: crypto.randomUUID() };
        setDraft(next);
        setPersistedDraft(next);
        setSaved(JSON.stringify(next));
        queryClient.setQueryData(api.productionDraft.queryKey(), null);
        refresh();
      },
    }),
  );
  const cancel = useMutation(
    api.cancelProduction.mutationOptions({
      onSuccess: () => {
        notify.success('完工入库及凭证已取消');
        setCancelId(null);
        refresh();
      },
    }),
  );
  const persist = async () => {
    if (save.isPending) {
      notify.error('正在保存完工入库，请保存结束后再关闭');
      return false;
    }
    const stored = await saveDraft.mutateAsync(draft);
    markDraftSaved(stored);
    return true;
  };
  useUnsavedChanges({
    title: '生产成本分摊',
    dirty: JSON.stringify(draft) !== saved,
    version: JSON.stringify(draft),
    save: persist,
    discard: () => {
      if (save.isPending) {
        notify.error('正在保存完工入库，请保存结束后再关闭');
        throw new Error('完工入库保存尚未完成');
      }
      setDraft(persistedDraft);
      setSaved(JSON.stringify(persistedDraft));
    },
  });
  const change = (patch: Partial<Draft>) => setDraft((old) => ({ ...old, ...patch }));
  const changeRow = (i: number, patch: Partial<Draft['rows'][number]>) =>
    change({ rows: draft.rows.map((r, index) => (index === i ? { ...r, ...patch } : r)) });
  const parsed = ProductionSchema.safeParse(draft);
  const currentPreview = preview.data && !preview.error && previewVersion === JSON.stringify(draft);
  const selectedType = voucherTypeId ?? types[0]?.id;
  const manual = policy.data?.numbering === 'manual';
  const columns = [
    { title: '产品', dataIndex: 'productCode' },
    { title: '名称', dataIndex: 'productName' },
    { title: '完工数量', dataIndex: 'quantity' },
    { title: '系数', dataIndex: 'factor' },
    ...(['materialCents', 'laborCents', 'overheadCents', 'totalCents'] as const).map((key, i) => ({
      title: ['直接材料', '直接人工', '制造费用', '完工成本'][i],
      key,
      render: (_: unknown, r: Preview['rows'][number]) => formatMoney(r[key]),
    })),
  ];
  return (
    <PageContainer
      title="生产成本分摊"
      subtitle="按完工数量×系数分摊材料、人工和制造费用；保存后同时入库并生成待审核凭证。"
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="归集所选成本明细科目的期末借方余额，包含未过账正式凭证"
          description="三类费用分别分摊，接近零的系数按 1 处理。完工入库必须在当月库存成本核算前完成。金额单位：元。"
        />
        <Space wrap>
          <label>
            完工日期{' '}
            <Input
              type="date"
              aria-label="完工日期"
              disabled={save.isPending}
              value={draft.date}
              onChange={(e) => change({ date: e.target.value })}
            />
          </label>
          <label>
            入库仓库{' '}
            <Select
              aria-label="入库仓库"
              disabled={save.isPending}
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.warehouseId ?? undefined}
              style={{ width: 180 }}
              options={context.warehouses.map((w) => ({
                value: w.id,
                label: `${w.code} ${w.name}`,
              }))}
              onChange={(warehouseId) => change({ warehouseId })}
            />
          </label>
          {(['materialAccountId', 'laborAccountId', 'overheadAccountId'] as const).map((key, i) => (
            <label key={key}>
              {['直接材料科目', '直接人工科目', '制造费用科目'][i]}{' '}
              <AccountSelect
                aria-label={['直接材料科目', '直接人工科目', '制造费用科目'][i]}
                disabled={save.isPending}
                value={draft[key] ?? undefined}
                onChange={(value) => change({ [key]: value ?? null })}
              />
            </label>
          ))}
        </Space>
        <Table
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={draft.rows}
          columns={[
            {
              title: '完工产品',
              key: 'product',
              render: (_, r, i) => (
                <Select
                  aria-label={`完工产品${i + 1}`}
                  disabled={save.isPending}
                  style={{ width: 220 }}
                  showSearch={{ optionFilterProp: 'label' }}
                  value={r.productId ?? undefined}
                  options={context.products.map((p) => ({
                    value: p.id,
                    label: `${p.code} ${p.name}`,
                  }))}
                  onChange={(productId) =>
                    changeRow(i, {
                      productId,
                      factor:
                        context.products.find((p) => p.id === productId)?.allocationFactor ?? '1',
                    })
                  }
                />
              ),
            },
            {
              title: '完工数量',
              key: 'quantity',
              render: (_, r, i) => (
                <Input
                  aria-label={`完工数量${i + 1}`}
                  disabled={save.isPending}
                  value={r.quantity}
                  onChange={(e) => changeRow(i, { quantity: e.target.value })}
                />
              ),
            },
            {
              title: '分摊系数',
              key: 'factor',
              render: (_, r, i) => (
                <Input
                  aria-label={`分摊系数${i + 1}`}
                  disabled={save.isPending}
                  value={r.factor}
                  onChange={(e) => changeRow(i, { factor: e.target.value })}
                />
              ),
            },
            {
              title: '操作',
              key: 'remove',
              render: (_, __, i) => (
                <Button
                  disabled={save.isPending}
                  onClick={() => change({ rows: draft.rows.filter((_, index) => index !== i) })}
                >
                  移除此行
                </Button>
              ),
            },
          ]}
        />
        <Space wrap>
          <Button
            onClick={() =>
              change({ rows: [...draft.rows, { productId: null, quantity: '', factor: '1' }] })
            }
            disabled={draft.rows.length >= 200 || save.isPending}
          >
            增加完工产品
          </Button>
          <Button
            loading={saveDraft.isPending}
            disabled={save.isPending}
            onClick={() =>
              saveDraft.mutate(draft, {
                onSuccess: (stored) => {
                  markDraftSaved(stored);
                  notify.success('草稿已保存，可关闭后继续');
                },
              })
            }
          >
            保存草稿
          </Button>
          <Button
            type="primary"
            loading={preview.isFetching}
            disabled={!parsed.success || save.isPending}
            onClick={() => {
              if (!parsed.success) return;
              setPreviewVersion(JSON.stringify(draft));
              if (JSON.stringify(requested) === JSON.stringify(parsed.data)) void preview.refetch();
              else setRequested(parsed.data);
            }}
          >
            预览生产分摊
          </Button>
        </Space>
        {(preview.error || saveDraft.error || policy.error) && (
          <Alert type="error" title={(preview.error ?? saveDraft.error ?? policy.error)?.message} />
        )}
        {preview.data && (
          <>
            <Alert
              type={currentPreview ? 'info' : 'warning'}
              title={`完工成本合计 ${formatMoney(preview.data.totalCents)}`}
              description={currentPreview ? '请核对分摊金额后保存。' : '输入已变化，请重新预览。'}
            />
            <Table
              rowKey="productId"
              pagination={false}
              dataSource={preview.data.rows}
              columns={columns}
            />
            <Space wrap>
              <label>
                凭证类型{' '}
                <Select
                  aria-label="生产凭证类型"
                  disabled={save.isPending}
                  value={selectedType}
                  style={{ width: 150 }}
                  options={types.map((t) => ({ value: t.id, label: t.name }))}
                  onChange={setVoucherTypeId}
                />
              </label>
              {manual && (
                <label>
                  凭证编号{' '}
                  <InputNumber
                    aria-label="生产凭证编号"
                    disabled={save.isPending}
                    min={1}
                    precision={0}
                    value={number}
                    onChange={setNumber}
                  />
                </label>
              )}
              <Button
                type="primary"
                disabled={
                  !currentPreview ||
                  !selectedType ||
                  (manual && !number) ||
                  saveDraft.isPending ||
                  save.isPending
                }
                onClick={() => setConfirmOpen(true)}
              >
                保存完工入库及凭证
              </Button>
            </Space>
          </>
        )}
        <Typography.Title level={4}>已保存的完工成本</Typography.Title>
        <Table
          rowKey="id"
          dataSource={context.saved}
          columns={[
            { title: '日期', dataIndex: 'date' },
            { title: '记录号', dataIndex: 'id' },
            {
              title: '状态',
              key: 'status',
              render: (_, r) => (r.status === 'saved' ? '已入库' : '已取消'),
            },
            {
              title: '分摊明细',
              key: 'details',
              render: (_, r) => (
                <Button onClick={() => setView(JSON.parse(r.result_json) as Preview)}>
                  查看分摊
                </Button>
              ),
            },
            {
              title: '凭证',
              key: 'voucher',
              render: (_, r) =>
                r.voucher_id ? (
                  <a href={`/m/voucher-entry/edit?id=${r.voucher_id}`}>查看凭证</a>
                ) : (
                  ''
                ),
            },
            {
              title: '操作',
              key: 'cancel',
              render: (_, r) => (
                <Button danger disabled={r.status !== 'saved'} onClick={() => setCancelId(r.id)}>
                  取消完工入库
                </Button>
              ),
            },
          ]}
        />
      </Space>
      <Modal
        open={confirmOpen}
        title="确认完工入库及生产成本结转"
        okText="确认保存完工入库"
        cancelText="返回检查"
        confirmLoading={save.isPending}
        okButtonProps={{ disabled: saveDraft.isPending }}
        onCancel={() => setConfirmOpen(false)}
        onOk={() => {
          if (!requested || !preview.data || !currentPreview || !selectedType) return;
          save.mutate({
            ...requested,
            requestKey: draft.requestKey,
            fingerprint: preview.data.fingerprint,
            voucherTypeId: selectedType,
            ...(manual && number ? { number } : {}),
            confirmed: true,
          });
        }}
      >
        <Typography.Paragraph>
          将把 {formatMoney(preview.data?.totalCents ?? 0)}{' '}
          元生产成本分配给完工产品，并保存一张其他入库单和一张待审核凭证。任何一步失败都不保存。
        </Typography.Paragraph>
      </Modal>
      <Modal
        open={cancelId != null}
        title="取消完工入库及凭证"
        okText="确认取消完工入库"
        cancelText="返回检查"
        confirmLoading={cancel.isPending}
        onCancel={() => setCancelId(null)}
        okButtonProps={{
          disabled: !cancellation.data || !!cancellation.error || cancellation.isFetching,
        }}
        onOk={() => {
          if (!cancellation.data) return;
          cancel.mutate({
            id: cancellation.data.id,
            revision: cancellation.data.revision,
            confirmed: true,
            voucherDeletion: { confirmed: true, plan: cancellation.data.plan },
          });
        }}
      >
        <Typography.Paragraph>
          将删除未审核的完工凭证和对应入库单，恢复生产成本余额。已审核或已核算时须先撤销相关操作。
        </Typography.Paragraph>
        {cancellation.error && <Alert type="error" title={cancellation.error.message} />}
        <DeletionImpact plan={cancellation.data?.plan ?? null} />
      </Modal>
      <Modal
        open={!!view}
        title="已保存的生产成本分摊"
        footer={null}
        width={1000}
        onCancel={() => setView(null)}
      >
        <Table
          rowKey="productId"
          pagination={false}
          dataSource={view?.rows ?? []}
          columns={columns}
        />
      </Modal>
    </PageContainer>
  );
}
