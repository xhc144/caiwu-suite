import { useState } from 'react';
import { Alert, Button, Select, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@caiwu/core';
import { useAccounts } from '@caiwu/web-kit';
import { AccountSelect, PageContainer, useUrlFilters } from '@caiwu/ui';
import { api } from './api';

export default function VoucherPage() {
  const [filters] = useUrlFilters({ id: 0 });
  const [documentId, setDocumentId] = useState<number | null>(filters.id || null);
  const [purpose, setPurpose] = useState<'receipt' | 'revenue' | 'cost'>('receipt');
  const [taxAccountId, setTaxAccountId] = useState<number | undefined>();
  const [revenueAccountId, setRevenueAccountId] = useState<number | undefined>();
  const { byId } = useAccounts();
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
  return (
    <PageContainer title="出入库凭证预览" subtitle="入库、销售收入、出库成本分用途预览">
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="warning"
          showIcon
          title="尚不能转入总账"
          description="正式凭证功能尚未开放。当前预览按实际单据计算，不占用凭证编号。"
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
              onChange={setDocumentId}
            />
          </label>
          <Select
            aria-label="凭证用途"
            value={purpose}
            style={{ width: 160 }}
            onChange={setPurpose}
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
              onChange={(v) => setTaxAccountId(v ?? undefined)}
            />
          </label>
          <label>
            默认收入科目{' '}
            <AccountSelect
              aria-label="默认收入科目"
              value={revenueAccountId}
              onChange={(v) => setRevenueAccountId(v ?? undefined)}
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
        {preview.error && <Alert type="error" title={preview.error.message} />}
        {preview.data && (
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
          </>
        )}
      </Space>
    </PageContainer>
  );
}
