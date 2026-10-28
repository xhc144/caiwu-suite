import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, periodEndDate, periodStartDate } from '@caiwu/core';
import { coreApi, notify, queryClient, useAccounts, useVoucherTypes } from '@caiwu/web-kit';
import { AccountSelect, PageContainer } from '@caiwu/ui';
import { BatchVoucherSchema } from '../fx-batch-shared';
import { api } from './api';
import DeletionImpact from './DeletionImpact';
import BatchNumbering from './BatchNumbering';
import type { z } from 'zod';

type BatchInput = z.input<typeof BatchVoucherSchema>;
const labels = {
  generate: '生成',
  regenerate: '重新生成',
  skip: '跳过',
  failed: '失败',
  generated: '已生成',
  regenerated: '已重新生成',
  skipped: '已跳过',
};

export default function BatchVoucherPage() {
  const context = useQuery(api.context.queryOptions());
  if (context.error) return <Alert type="error" title={context.error.message} />;
  if (!context.data)
    return <PageContainer title="批量生成来源凭证">正在读取账套期间…</PageContainer>;
  return <BatchEditor period={context.data.currentPeriod} warehouses={context.data.warehouses} />;
}

function BatchEditor({
  period,
  warehouses,
}: {
  period: number;
  warehouses: { id: number; name: string }[];
}) {
  const [values, setValues] = useState<BatchInput>({
    from: periodStartDate(period),
    to: periodEndDate(period),
    purpose: 'receipt',
    voucherTypeId: 1,
    regenerate: false,
  });
  const [voucherTypeId, setVoucherTypeId] = useState<number | undefined>();
  const types = useVoucherTypes();
  const { byId } = useAccounts();
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const [submitted, setSubmitted] = useState<BatchInput | null>(null);
  const [confirming, setConfirming] = useState(false);
  const typeId = voucherTypeId ?? types[0]?.id;
  const parsed = BatchVoucherSchema.safeParse({ ...values, voucherTypeId: typeId });
  const current = parsed.success ? parsed.data : null;
  const preview = useQuery(
    api.previewVoucherBatch.queryOptions(submitted ?? values, {
      enabled: !!submitted,
      retry: false,
    }),
  );
  const unchanged = current && submitted && JSON.stringify(current) === JSON.stringify(submitted);
  const execute = useMutation(
    api.executeVoucherBatch.mutationOptions({
      onSuccess: (data) => {
        setConfirming(false);
        setSubmitted(null);
        notify.success(
          `已保存 ${data.succeeded} 张，失败 ${data.failed} 张，跳过 ${data.skipped} 张`,
        );
        void queryClient.invalidateQueries({ queryKey: api.voucherDocuments.queryKey() });
        void queryClient.invalidateQueries({ queryKey: coreApi.vouchers.list.queryKey() });
      },
    }),
  );
  const ready =
    preview.data?.rows.filter((r) => r.action === 'generate' || r.action === 'regenerate').length ??
    0;
  return (
    <PageContainer
      title="批量生成来源凭证"
      subtitle="按来源日期逐张制证；跨月单据分别保留原月份，成功项才占用手工编号。"
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Link href="/m/costing/vouchers">返回单张凭证与原币资料</Typography.Link>
        <Space wrap>
          <label>
            单据日期从{' '}
            <Input
              aria-label="批量日期从"
              type="date"
              value={values.from}
              onChange={(e) => setValues((v) => ({ ...v, from: e.target.value }))}
            />
          </label>
          <label>
            至{' '}
            <Input
              aria-label="批量日期至"
              type="date"
              value={values.to}
              onChange={(e) => setValues((v) => ({ ...v, to: e.target.value }))}
            />
          </label>
          <label>
            仓库{' '}
            <Select
              aria-label="批量仓库"
              allowClear
              style={{ width: 150 }}
              value={values.warehouseId}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              onChange={(warehouseId) => setValues((v) => ({ ...v, warehouseId }))}
            />
          </label>
          <label>
            凭证用途{' '}
            <Select
              aria-label="批量凭证用途"
              style={{ width: 150 }}
              value={values.purpose}
              options={[
                { value: 'receipt', label: '入库' },
                { value: 'revenue', label: '销售收入' },
                { value: 'cost', label: '出库成本' },
                { value: 'count', label: '盘点盈亏' },
              ]}
              onChange={(purpose) => setValues((v) => ({ ...v, purpose }))}
            />
          </label>
          <label>
            凭证类型{' '}
            <Select
              aria-label="批量凭证类型"
              style={{ width: 120 }}
              value={typeId}
              options={types.map((t) => ({ value: t.id, label: t.name }))}
              onChange={setVoucherTypeId}
            />
          </label>
          {policy.data?.numbering === 'manual' && (
            <label>
              起始编号{' '}
              <InputNumber
                aria-label="批量起始编号"
                min={1}
                precision={0}
                value={values.startNumber}
                onChange={(number) =>
                  setValues((v) => ({ ...v, startNumber: number ?? undefined }))
                }
              />
            </label>
          )}
        </Space>
        <Space wrap>
          {(values.purpose === 'receipt' || values.purpose === 'revenue') && (
            <label>
              税额科目{' '}
              <AccountSelect
                aria-label="批量税额科目"
                value={values.taxAccountId}
                onChange={(id) => setValues((v) => ({ ...v, taxAccountId: id ?? undefined }))}
              />
            </label>
          )}
          {values.purpose === 'revenue' && (
            <label>
              默认收入科目{' '}
              <AccountSelect
                aria-label="批量收入科目"
                value={values.revenueAccountId}
                onChange={(id) => setValues((v) => ({ ...v, revenueAccountId: id ?? undefined }))}
              />
            </label>
          )}
          {values.purpose === 'count' && (
            <label>
              待处理财产损溢科目{' '}
              <AccountSelect
                aria-label="批量盘点科目"
                value={values.adjustmentAccountId}
                onChange={(id) =>
                  setValues((v) => ({ ...v, adjustmentAccountId: id ?? undefined }))
                }
              />
            </label>
          )}
          <Checkbox
            checked={values.regenerate}
            onChange={(e) => setValues((v) => ({ ...v, regenerate: e.target.checked }))}
          >
            重新生成已有未审核凭证
          </Checkbox>
          <Button
            type="primary"
            disabled={!current || execute.isPending}
            loading={preview.isFetching}
            onClick={() => {
              if (!current) return;
              if (JSON.stringify(current) === JSON.stringify(submitted)) void preview.refetch();
              else setSubmitted(current);
            }}
          >
            预览批量凭证
          </Button>
        </Space>
        <Alert
          type="info"
          showIcon
          title="已审核或过账凭证、发票来源收入和完工入库凭证会保留并列明跳过原因。"
          description="每张单据独立保存；失败项显示原因，修正后重新预览即可继续。外币科目须先在单张凭证页保存来源原币资料。"
        />
        {(preview.error || execute.error || policy.error) && (
          <Alert type="error" title={(preview.error ?? execute.error ?? policy.error)?.message} />
        )}
        {submitted && preview.data && (
          <>
            <Alert
              type={unchanged ? 'info' : 'warning'}
              title={
                unchanged
                  ? `待执行 ${ready} 张；展开单据核对分录和删除编号影响。`
                  : '筛选或科目已改变，请重新预览。'
              }
            />
            <Table
              rowKey="key"
              size="small"
              pagination={{ pageSize: 20 }}
              dataSource={preview.data.rows}
              columns={[
                { title: '来源日期', dataIndex: 'date' },
                { title: '来源单号', dataIndex: 'number' },
                { title: '处理', render: (_, r) => labels[r.action] },
                {
                  title: '借方金额',
                  render: (_, r) => (r.preview ? formatMoney(r.preview.debitCents) : ''),
                },
                {
                  title: '贷方金额',
                  render: (_, r) => (r.preview ? formatMoney(r.preview.creditCents) : ''),
                },
                { title: '说明', dataIndex: 'message' },
              ]}
              expandable={{
                rowExpandable: (row) => !!row.preview,
                expandedRowRender: (row) => (
                  <>
                    <Table
                      rowKey={(_, i) => String(i)}
                      size="small"
                      pagination={false}
                      dataSource={row.preview?.lines ?? []}
                      columns={[
                        { title: '摘要', dataIndex: 'summary' },
                        {
                          title: '科目',
                          render: (_, line) => {
                            const a = line.accountId ? byId.get(line.accountId) : null;
                            return a ? `${a.code} ${a.name}` : '';
                          },
                        },
                        { title: '借方', render: (_, line) => formatMoney(line.debit ?? 0) },
                        { title: '贷方', render: (_, line) => formatMoney(line.credit ?? 0) },
                        { title: '数量', dataIndex: 'quantity' },
                        { title: '币种', dataIndex: 'currency' },
                        {
                          title: '原币金额',
                          render: (_, line) =>
                            line.fcAmount == null ? '' : formatMoney(line.fcAmount),
                        },
                      ]}
                    />
                    {row.numbering ? (
                      <BatchNumbering step={row.numbering} />
                    ) : row.deletion ? (
                      <DeletionImpact plan={row.deletion.plan} />
                    ) : null}
                  </>
                ),
              }}
            />
            <Button
              type="primary"
              disabled={!unchanged || !ready || preview.isFetching || execute.isPending}
              onClick={() => setConfirming(true)}
            >
              确认批量处理
            </Button>
          </>
        )}
        {execute.data && (
          <>
            <Alert
              type={execute.data.failed ? 'warning' : 'success'}
              title={`成功 ${execute.data.succeeded} 张，失败 ${execute.data.failed} 张，跳过 ${execute.data.skipped} 张`}
            />
            <Table
              rowKey="key"
              dataSource={execute.data.results}
              pagination={{ pageSize: 20 }}
              columns={[
                { title: '来源日期', dataIndex: 'date' },
                { title: '来源单号', dataIndex: 'number' },
                { title: '结果', render: (_, r) => labels[r.status] },
                {
                  title: '凭证',
                  render: (_, r) =>
                    r.voucherId ? (
                      <a href={`/m/voucher-entry/edit?id=${r.voucherId}`}>{r.displayNo}</a>
                    ) : (
                      ''
                    ),
                },
                { title: '说明', dataIndex: 'message' },
              ]}
            />
          </>
        )}
      </Space>
      <Modal
        title="确认批量生成凭证"
        width={900}
        open={confirming}
        onCancel={() => setConfirming(false)}
        okText="确认执行"
        cancelText="返回核对"
        confirmLoading={execute.isPending}
        onOk={() => {
          if (submitted && preview.data && unchanged)
            execute.mutate({
              ...submitted,
              fingerprint: preview.data.fingerprint,
              confirmed: true,
            });
        }}
      >
        <Typography.Paragraph>
          将按已预览的分录处理 {ready}{' '}
          张来源单据。已生成、跳过及失败的结果会逐张列出；修改失败项后可重新预览继续。
        </Typography.Paragraph>
        {preview.data?.rows.some((row) => row.numbering) && (
          <Space
            orientation="vertical"
            style={{ width: '100%', maxHeight: '60vh', overflowY: 'auto' }}
          >
            <Alert
              type="warning"
              showIcon
              title="请核对以下逐步编号映射后确认执行"
              description="按前项全部成功的顺序展示完整影响；某项失败导致后续映射变化时，相关单据需重新预览确认。"
            />
            {preview.data.rows.map(
              (row, index) =>
                row.numbering && (
                  <div key={row.key} style={{ width: '100%' }}>
                    <Typography.Title level={5}>
                      第 {index + 1} 项：{row.number}
                    </Typography.Title>
                    <BatchNumbering step={row.numbering} />
                  </div>
                ),
            )}
          </Space>
        )}
      </Modal>
    </PageContainer>
  );
}
