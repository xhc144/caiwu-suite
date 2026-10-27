import { useState } from 'react';
import { Alert, Button, Modal, Select, Space, Table, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, VOUCHER_STATUS_LABELS } from '@caiwu/core';
import { queryClient, useAccounts, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import { AccountSelect, PageContainer, useUrlFilters } from '@caiwu/ui';
import type { CancelCostVoucherInput, GenerateVoucherInput } from '../shared';
import { api } from './api';

export default function VoucherPage() {
  const [filters] = useUrlFilters({ id: 0, purpose: 'receipt' });
  const [documentId, setDocumentId] = useState<number | null>(filters.id || null);
  const [purpose, setPurpose] = useState<'receipt' | 'revenue' | 'cost'>(
    filters.purpose === 'cost' || filters.purpose === 'revenue' ? filters.purpose : 'receipt',
  );
  const [taxAccountId, setTaxAccountId] = useState<number | undefined>();
  const [revenueAccountId, setRevenueAccountId] = useState<number | undefined>();
  const { byId } = useAccounts();
  const canVoucher = usePermission('costing.voucher');
  const voucherTypes = useVoucherTypes();
  const [voucherTypeId, setVoucherTypeId] = useState<number>();
  const [generation, setGeneration] = useState<GenerateVoucherInput | null>(null);
  const [cancellation, setCancellation] = useState<CancelCostVoucherInput | null>(null);
  const [outcome, setOutcome] = useState('');
  const documents = useQuery(api.voucherDocuments.queryOptions());
  const [input, setInput] = useState<{
    documentId: number;
    purpose: 'receipt' | 'revenue' | 'cost';
    taxAccountId?: number;
    revenueAccountId?: number;
  } | null>(null);
  const preview = useQuery(
    api.previewVoucher.queryOptions(input ?? { documentId: 1, purpose: 'receipt' }, {
      enabled: !!input,
      retry: false,
    }),
  );
  const source = useQuery(
    api.costVoucherState.queryOptions(
      { documentId: documentId ?? 1 },
      {
        enabled: !!documentId && purpose === 'cost',
      },
    ),
  );
  const generate = useMutation(
    api.generateVoucher.mutationOptions({
      onSuccess: (v) => {
        setOutcome(`已生成成本凭证 ${v.displayNo}，金额 ${formatMoney(v.debitTotal)}，待审核`);
        setGeneration(null);
        setInput(null);
        void queryClient.invalidateQueries();
      },
    }),
  );
  const cancel = useMutation(
    api.cancelCostVoucher.mutationOptions({
      onSuccess: () => {
        setOutcome('未审核成本凭证已撤销，成本用途关联已释放；重新预览后可再次生成');
        setCancellation(null);
        setInput(null);
        void queryClient.invalidateQueries();
      },
    }),
  );
  const reset = () => {
    setInput(null);
    setOutcome('');
  };
  const linked = purpose === 'cost' && documentId ? source.data : undefined;
  return (
    <PageContainer
      title="出入库凭证预览"
      subtitle="正式出库成本可确认生成凭证；入库、销售收入分用途预览"
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          showIcon
          title="出库成本凭证需先完成正式成本核算"
          description="核对分录和凭证类型后明确确认，生成待审核凭证并锁定成本用途。入库和销售收入尚仅提供预览。"
        />
        <Space wrap>
          <label>
            出入库单据{' '}
            <Select
              aria-label="出入库单据"
              value={documentId ?? undefined}
              style={{ width: 280 }}
              showSearch={{ optionFilterProp: 'label' }}
              options={(documents.data ?? []).map((d) => ({
                value: d.id,
                label: `${d.date} ${d.kind === 'receipt' ? '入库' : '出库'} ${d.number}`,
              }))}
              onChange={(v) => {
                setDocumentId(v);
                reset();
              }}
            />
          </label>
          <Select
            aria-label="凭证用途"
            value={purpose}
            style={{ width: 160 }}
            onChange={(v) => {
              setPurpose(v);
              reset();
            }}
            options={[
              { label: '入库', value: 'receipt' },
              { label: '销售收入', value: 'revenue' },
              { label: '出库成本', value: 'cost' },
            ]}
          />
          <label>
            税额科目{' '}
            <AccountSelect
              aria-label="税额科目"
              value={taxAccountId}
              onChange={(v) => {
                setTaxAccountId(v ?? undefined);
                reset();
              }}
            />
          </label>
          <label>
            默认收入科目{' '}
            <AccountSelect
              aria-label="默认收入科目"
              value={revenueAccountId}
              onChange={(v) => {
                setRevenueAccountId(v ?? undefined);
                reset();
              }}
            />
          </label>
          <Button
            type="primary"
            disabled={!documentId}
            loading={preview.isFetching}
            onClick={() => {
              const next = { documentId: documentId!, purpose, taxAccountId, revenueAccountId };
              if (JSON.stringify(next) === JSON.stringify(input)) void preview.refetch();
              else setInput(next);
            }}
          >
            预览凭证
          </Button>
        </Space>
        {purpose === 'cost' && (
          <Space>
            <label>
              凭证类型{' '}
              <Select
                aria-label="凭证类型"
                style={{ width: 160 }}
                value={voucherTypeId}
                options={voucherTypes.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))}
                onChange={setVoucherTypeId}
              />
            </label>
          </Space>
        )}
        {outcome && <Alert type="success" title={outcome} />}
        {purpose === 'cost' && source.error && <Alert type="error" title={source.error.message} />}
        {linked?.linked && (
          <Alert
            type="info"
            title={
              linked.voucher
                ? `已有成本凭证 ${linked.voucher.displayNo} · ${VOUCHER_STATUS_LABELS[linked.voucher.status]}`
                : '成本用途有关联但凭证缺失，请核对来源记录'
            }
            description={
              linked.voucher && (
                <Space>
                  <Typography.Link href={`/m/voucher-entry/edit?id=${linked.voucher.id}`}>
                    查看成本凭证
                  </Typography.Link>
                  <Button
                    danger
                    disabled={
                      !canVoucher ||
                      linked.ownerModule !== 'costing' ||
                      linked.voucher.status !== 'pending' ||
                      linked.voucher.voided
                    }
                    onClick={() => {
                      cancel.reset();
                      setCancellation({
                        bookId: linked.bookId,
                        documentId: linked.documentId,
                        documentRevision: linked.documentRevision,
                        voucherId: linked.voucher!.id,
                        voucherRevision: linked.voucher!.revision,
                        confirmed: true,
                      });
                    }}
                  >
                    撤销成本凭证
                  </Button>
                </Space>
              )
            }
          />
        )}
        {input && preview.error && <Alert type="error" title={preview.error.message} />}
        {input && preview.data && !preview.error && (
          <>
            <Alert
              type="info"
              title={`预览借方 ${formatMoney(preview.data.debitCents)}；贷方 ${formatMoney(preview.data.creditCents)}`}
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
            {input.purpose === 'cost' && preview.data.canGenerate && (
              <Button
                type="primary"
                disabled={!canVoucher || !voucherTypeId || preview.isFetching}
                onClick={() => {
                  generate.reset();
                  setGeneration({
                    ...input,
                    voucherTypeId: voucherTypeId!,
                    fingerprint: preview.data!.fingerprint,
                    confirmed: true,
                  });
                }}
              >
                生成成本凭证
              </Button>
            )}
          </>
        )}
        <Modal
          title="确认生成实际成本凭证"
          open={!!generation}
          okText="确认生成待审核凭证"
          cancelText="返回核对"
          confirmLoading={generate.isPending}
          onCancel={() => setGeneration(null)}
          onOk={() => generation && generate.mutate(generation)}
        >
          <p>
            将为出库单 #{generation?.documentId}{' '}
            按已核对分录生成正式凭证，自动编号并锁定成本用途；已审核或过账后不能在此撤销。
          </p>
          <p>
            凭证类型：{voucherTypes.find((t) => t.id === generation?.voucherTypeId)?.name}
            。凭证日期沿用出库单日期。
          </p>
          {generate.error && <Alert type="error" title={generate.error.message} />}
        </Modal>
        <Modal
          title="确认撤销成本凭证"
          open={!!cancellation}
          okText="确认删除并释放关联"
          cancelText="保留凭证"
          confirmLoading={cancel.isPending}
          onCancel={() => setCancellation(null)}
          onOk={() => cancellation && cancel.mutate(cancellation)}
        >
          <p>将删除未审核成本凭证并释放本单成本用途关联，保留正式成本核算和其他用途凭证。</p>
          {cancel.error && <Alert type="error" title={cancel.error.message} />}
        </Modal>
      </Space>
    </PageContainer>
  );
}
