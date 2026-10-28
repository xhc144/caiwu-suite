import { useState } from 'react';
import { Alert, Button, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, type VoucherStatus } from '@caiwu/core';
import { coreApi, notify, queryClient, useAccounts, useVoucherTypes } from '@caiwu/web-kit';
import { AccountSelect, PageContainer, useUrlFilters } from '@caiwu/ui';
import type { z } from 'zod';
import type { VoucherPreviewSchema } from '../shared';
import { api } from './api';
import DeletionImpact from './DeletionImpact';

type PreviewInput = z.input<typeof VoucherPreviewSchema>;
const purposeLabels = { receipt: '入库', revenue: '销售收入', cost: '出库成本', count: '盘点盈亏' };
const statusLabel = (value: VoucherStatus) =>
  ({ draft: '草稿', pending: '待审核', audited: '已审核', posted: '已过账' })[value];

type SourceFilters = { id: number; documentId: number; countId: number; purpose: string };

export default function VoucherPage() {
  const [filters] = useUrlFilters({ id: 0, documentId: 0, countId: 0, purpose: 'receipt' });
  return (
    <VoucherEditor
      key={`${filters.id}:${filters.documentId}:${filters.countId}:${filters.purpose}`}
      filters={filters}
    />
  );
}

function VoucherEditor({ filters }: { filters: SourceFilters }) {
  const [documentId, setDocumentId] = useState<number | null>(
    filters.documentId || filters.id || null,
  );
  const [countId, setCountId] = useState<number | null>(filters.countId || null);
  const [purpose, setPurpose] = useState<PreviewInput['purpose']>(
    filters.countId
      ? 'count'
      : filters.purpose in purposeLabels
        ? (filters.purpose as PreviewInput['purpose'])
        : 'receipt',
  );
  const [taxAccountId, setTaxAccountId] = useState<number | undefined>();
  const [revenueAccountId, setRevenueAccountId] = useState<number | undefined>();
  const [adjustmentAccountId, setAdjustmentAccountId] = useState<number | undefined>();
  const [voucherTypeId, setVoucherTypeId] = useState<number | undefined>();
  const [number, setNumber] = useState<number | null>(null);
  const [operation, setOperation] = useState<'generate' | 'delete' | 'regenerate' | null>(null);
  const { byId } = useAccounts();
  const types = useVoucherTypes();
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const documents = useQuery(api.voucherDocuments.queryOptions());
  const [input, setInput] = useState<PreviewInput | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<PreviewInput | null>(null);
  const sourceInput: PreviewInput = {
    ...(purpose === 'count' ? { countId: countId! } : { documentId: documentId! }),
    purpose,
    taxAccountId,
    revenueAccountId,
    adjustmentAccountId,
  };
  const selectedDocument = documents.data?.find((d) =>
    purpose === 'count'
      ? d.kind === 'count' && d.id === countId
      : d.kind !== 'count' && d.id === documentId,
  );
  const links = selectedDocument?.sources ?? [];

  const preview = useQuery(
    api.previewVoucher.queryOptions(input ?? { documentId: 1, purpose: 'receipt' }, {
      enabled: !!input,
      retry: false,
    }),
  );
  const deletion = useQuery(
    api.previewVoucherDelete.queryOptions(sourceInput, {
      enabled: false,
      retry: false,
    }),
  );
  const refresh = () => {
    setOperation(null);
    void queryClient.invalidateQueries({ queryKey: api.voucherDocuments.queryKey() });
    void queryClient.invalidateQueries({ queryKey: coreApi.vouchers.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.context.queryKey() });
    if (input) void preview.refetch();
  };
  const generate = useMutation(
    api.generateVoucher.mutationOptions({
      onSuccess: () => {
        notify.success('凭证已生成');
        refresh();
      },
    }),
  );
  const remove = useMutation(
    api.deleteVoucher.mutationOptions({
      onSuccess: () => {
        notify.success('凭证已删除，来源关联已释放');
        refresh();
      },
    }),
  );
  const regenerate = useMutation(
    api.regenerateVoucher.mutationOptions({
      onSuccess: () => {
        notify.success('凭证已重新生成');
        refresh();
      },
    }),
  );
  const selectedType = voucherTypeId ?? types[0]?.id;
  const manual = policy.data?.numbering === 'manual';
  const busy = generate.isPending || remove.isPending || regenerate.isPending;
  const submitted =
    !!input && !preview.error && JSON.stringify(input) === JSON.stringify(sourceInput);
  const currentLink = links.find((link) => link.purpose === purpose);
  const locked = currentLink?.status === 'audited' || currentLink?.status === 'posted';
  const newInput = () => sourceInput;
  const beginDelete = async (mode: 'delete' | 'regenerate') => {
    const { data } = await deletion.refetch();
    if (data) {
      setDeletionTarget(sourceInput);
      setOperation(mode);
    }
  };
  const confirm = () => {
    if (operation === 'delete') {
      if (!deletionTarget || !deletion.data) return;
      remove.mutate({
        ...deletionTarget,
        expectedRevision: deletion.data.expectedRevision,
        confirmed: true,
        voucherDeletion: { plan: deletion.data.plan, confirmed: true },
      });
      return;
    }
    if (!input || !preview.data || !submitted) return;
    const shared = {
      ...input,
      expectedRevision: preview.data.expectedRevision,
      fingerprint: preview.data.fingerprint,
      voucherTypeId: selectedType!,
      ...(manual && number != null ? { number } : {}),
      confirmed: true,
    };
    if (operation === 'generate') generate.mutate(shared);
    else if (deletion.data) {
      const voucherDeletion = { plan: deletion.data.plan, confirmed: true };
      if (operation === 'regenerate') regenerate.mutate({ ...shared, voucherDeletion });
    }
  };
  return (
    <PageContainer
      title="出入库与盘点凭证"
      subtitle="先预览核对，再转入总账；同一销售单分别关联收入凭证和成本凭证。"
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          showIcon
          title="已审核或过账的凭证会锁定来源，不能删除或重新生成"
          description="成本及盘点盈亏凭证须先完成对应月份的正式核算。"
        />
        <Space wrap>
          <label>
            凭证用途{' '}
            <Select
              aria-label="凭证用途"
              value={purpose}
              style={{ width: 160 }}
              onChange={setPurpose}
              options={Object.entries(purposeLabels).map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>
            {purpose === 'count' ? '盘点表' : '出入库单据'}{' '}
            <Select
              aria-label={purpose === 'count' ? '盘点表' : '出入库单据'}
              value={(purpose === 'count' ? countId : documentId) ?? undefined}
              style={{ width: 320 }}
              loading={documents.isFetching}
              showSearch={{ optionFilterProp: 'label' }}
              options={(documents.data ?? [])
                .filter((d) =>
                  purpose === 'count'
                    ? d.kind === 'count'
                    : purpose === 'receipt'
                      ? d.kind === 'receipt'
                      : d.kind === 'issue' && (purpose !== 'revenue' || d.revenueEligible),
                )
                .map((d) => ({
                  value: d.id,
                  label: `${d.date} ${d.kind === 'receipt' ? '入库' : d.kind === 'count' ? '' : '出库'} ${d.number}`,
                }))}
              onChange={(v) => (purpose === 'count' ? setCountId(v) : setDocumentId(v))}
            />
          </label>
          {purpose !== 'cost' && purpose !== 'count' && (
            <label>
              税额科目{' '}
              <AccountSelect
                aria-label="税额科目"
                value={taxAccountId}
                onChange={(v) => setTaxAccountId(v ?? undefined)}
              />
            </label>
          )}
          {purpose === 'revenue' && (
            <label>
              默认收入科目{' '}
              <AccountSelect
                aria-label="默认收入科目"
                value={revenueAccountId}
                onChange={(v) => setRevenueAccountId(v ?? undefined)}
              />
            </label>
          )}
          {purpose === 'count' && (
            <label>
              待处理财产损溢科目{' '}
              <AccountSelect
                aria-label="待处理财产损溢科目"
                value={adjustmentAccountId}
                onChange={(v) => setAdjustmentAccountId(v ?? undefined)}
              />
            </label>
          )}
          <Button
            type="primary"
            disabled={purpose === 'count' ? !countId : !documentId}
            loading={preview.isFetching}
            onClick={() => {
              const next = newInput();
              if (JSON.stringify(next) === JSON.stringify(input)) void preview.refetch();
              else setInput(next);
            }}
          >
            预览凭证
          </Button>
        </Space>
        {(preview.error || documents.error || deletion.error || policy.error) && (
          <Alert
            type="error"
            title={(preview.error ?? documents.error ?? deletion.error ?? policy.error)?.message}
          />
        )}
        {preview.data && (
          <>
            <Alert
              type="info"
              title={`预览借方 ${formatMoney(preview.data.debitCents)}；贷方 ${formatMoney(preview.data.creditCents)}`}
              description={!submitted ? '来源或科目已改变，请重新预览后操作。' : undefined}
            />
            <Table
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={preview.data.lines}
              columns={[
                { title: '摘要', dataIndex: 'summary' },
                {
                  title: '科目',
                  key: 'account',
                  render: (_, r) => {
                    const a = r.accountId ? byId.get(r.accountId) : undefined;
                    return a ? `${a.code} ${a.name}` : r.accountId;
                  },
                },
                { title: '借方', key: 'debit', render: (_, r) => formatMoney(r.debit ?? 0) },
                { title: '贷方', key: 'credit', render: (_, r) => formatMoney(r.credit ?? 0) },
                { title: '数量', dataIndex: 'quantity' },
              ]}
            />
            {preview.data.generationBlocker && (
              <Alert type="warning" showIcon title={preview.data.generationBlocker} />
            )}
            <Space wrap>
              <label>
                凭证类型{' '}
                <Select
                  aria-label="凭证类型"
                  value={selectedType}
                  style={{ width: 140 }}
                  options={types.map((v) => ({ value: v.id, label: v.name }))}
                  onChange={setVoucherTypeId}
                />
              </label>
              {manual ? (
                <label>
                  凭证编号{' '}
                  <InputNumber
                    aria-label="凭证编号"
                    min={1}
                    precision={0}
                    value={number}
                    onChange={setNumber}
                  />
                </label>
              ) : (
                <Typography.Text>凭证编号自动分配</Typography.Text>
              )}
              <Button
                aria-label="生成凭证"
                type="primary"
                disabled={
                  !submitted ||
                  !selectedType ||
                  (manual && !number) ||
                  !!currentLink ||
                  !!preview.data.generationBlocker
                }
                loading={generate.isPending}
                onClick={() => setOperation('generate')}
              >
                生成凭证
              </Button>
              <Button
                aria-label="重新生成"
                disabled={
                  !submitted ||
                  !currentLink ||
                  locked ||
                  !selectedType ||
                  (manual && !number) ||
                  !!preview.data.generationBlocker
                }
                loading={regenerate.isPending}
                onClick={() => void beginDelete('regenerate')}
              >
                重新生成
              </Button>
            </Space>
          </>
        )}
        {selectedDocument && (
          <>
            <Typography.Title level={4}>本单关联凭证</Typography.Title>
            <Table
              rowKey="voucherId"
              size="small"
              pagination={false}
              dataSource={links}
              locale={{ emptyText: '本单尚未生成凭证' }}
              columns={[
                { title: '用途', key: 'purpose', render: (_, r) => purposeLabels[r.purpose] },
                {
                  title: '凭证',
                  key: 'voucher',
                  render: (_, r) => (
                    <a href={`/m/voucher-entry/edit?id=${r.voucherId}`}>{r.displayNo}</a>
                  ),
                },
                { title: '状态', key: 'status', render: (_, r) => statusLabel(r.status) },
              ]}
            />
            <Button
              aria-label="删除本用途凭证"
              danger
              disabled={!currentLink || locked}
              loading={deletion.isFetching || remove.isPending}
              onClick={() => void beginDelete('delete')}
            >
              删除本用途凭证
            </Button>
            {locked && (
              <Alert
                type="warning"
                title="本用途凭证已审核或过账，请先取消审核或反过账，再操作来源凭证。"
              />
            )}
          </>
        )}
      </Space>
      <Modal
        title={
          operation === 'generate'
            ? '确认生成凭证'
            : operation === 'delete'
              ? '确认删除凭证'
              : '确认重新生成凭证'
        }
        open={!!operation}
        onCancel={() => setOperation(null)}
        okText="确认执行"
        cancelText="返回检查"
        confirmLoading={busy}
        onOk={confirm}
      >
        {operation === 'generate' ? (
          <Typography.Paragraph>
            核对后的分录将保存为待审核凭证，并关联本张{purpose === 'count' ? '盘点表' : '出入库单'}
            。
          </Typography.Paragraph>
        ) : (
          <>
            <Typography.Paragraph>
              {operation === 'regenerate'
                ? '将删除当前用途的旧凭证，并按本次预览重新生成。失败时保留原凭证。'
                : '将删除当前用途的凭证并释放该用途的来源关联。'}
            </Typography.Paragraph>
            <DeletionImpact plan={deletion.data?.plan ?? null} />
          </>
        )}
      </Modal>
    </PageContainer>
  );
}
