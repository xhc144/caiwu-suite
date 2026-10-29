import { useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useSubmission, useTab } from '@caiwu/web-kit';
import { exportToExcel } from '@caiwu/ui';
import { runPrintBatch } from '@caiwu/print';
import { Decimal, centsToYuan } from '@caiwu/core';
import type { Filter } from '../shared';
import { api } from './api';
import { Grid, useCatalog } from './common';
import { buildInventoryLedgerView } from './ledger-print';

export default function BatchLedgers({ filter }: { filter: Filter }) {
  const [open, setOpen] = useState(false),
    [hideInactive, setHideInactive] = useState(false),
    [pause, setPause] = useState(true),
    [error, setError] = useState('');
  const { active } = useTab(),
    { context } = useCatalog(),
    submission = useSubmission();
  const books = useQuery({
    ...api.ledgers.queryOptions({ filter: { ...filter, productCode: undefined }, hideInactive }),
    enabled: open && !!filter.warehouseId,
  });
  const display = (v: string | null, price = false) =>
    v == null
      ? null
      : new Decimal(v)
          .toDecimalPlaces(
            (price ? context?.settings.priceDigits : context?.settings.quantityDigits) ?? 6,
            Decimal.ROUND_HALF_UP,
          )
          .toFixed();
  return (
    <>
      <Button disabled={!filter.warehouseId} onClick={() => setOpen(true)}>
        按产品范围连续台账
      </Button>
      <Drawer
        title="产品范围连续台账"
        mask={false}
        size={1150}
        open={active && open}
        onClose={() => {
          if (!submission.isSubmitting) setOpen(false);
        }}
      >
        <Space wrap>
          <Checkbox
            checked={hideInactive}
            disabled={submission.isSubmitting}
            onChange={(e) => setHideInactive(e.target.checked)}
          >
            隐藏本期无发生台账
          </Checkbox>
          <Checkbox
            checked={pause}
            disabled={submission.isSubmitting}
            onChange={(e) => setPause(e.target.checked)}
          >
            逐页打印前确认
          </Checkbox>
          <Button
            disabled={!books.data?.length || books.isFetching}
            loading={submission.isSubmitting}
            onClick={() =>
              void submission.submit(async () => {
                setError('');
                try {
                  const view = buildInventoryLedgerView(books.data!, {
                    unit: context?.book.name ?? '',
                    from: filter.from,
                    to: filter.to,
                    quantityDigits: context?.settings.quantityDigits ?? 6,
                    priceDigits: context?.settings.priceDigits ?? 6,
                  });
                  if (
                    !window.confirm(
                      `确认打印当前 ${books.data!.length} 个产品的 ${view.pages.length} 页台账？`,
                    )
                  )
                    return;
                  await runPrintBatch(view, {
                    pages: view.pages.map((_, i) => i + 1),
                    copies: 1,
                    pause: pause ? 'page' : 'none',
                    confirm: async (message) =>
                      window.confirm(`${message}，继续打印吗？取消将停止后续页。`),
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : '台账打印失败');
                }
              })
            }
          >
            连续打印台账
          </Button>
          <Button
            disabled={!books.data?.length || books.isFetching}
            onClick={() =>
              void exportToExcel({
                fileName: '产品范围库存台账',
                rows: books.data!.flatMap((book) =>
                  book.rows.map((r) => ({
                    ...r,
                    productCode: book.productCode,
                    productName: book.productName,
                  })),
                ),
                columns: [
                  { title: '产品编号', value: (r) => r.productCode },
                  { title: '产品名称', value: (r) => r.productName },
                  { title: '日期', value: (r) => r.date },
                  { title: '单号', value: (r) => r.number },
                  { title: '入库数量', value: (r) => display(r.received) },
                  { title: '出库数量', value: (r) => display(r.issued) },
                  { title: '结余数量', value: (r) => display(r.balance) },
                  { title: '本笔成本单价（元）', value: (r) => display(r.unitPrice, true) },
                  {
                    title: '本笔金额（元）',
                    value: (r) => (r.amountCents == null ? null : centsToYuan(r.amountCents)),
                  },
                  { title: '结余成本单价（元）', value: (r) => display(r.balanceUnitPrice, true) },
                  {
                    title: '结余金额（元）',
                    value: (r) => (r.balanceCents == null ? null : centsToYuan(r.balanceCents)),
                  },
                ],
              })
            }
          >
            导出全部产品台账
          </Button>
        </Space>
        {(books.error || error) && <Alert type="error" title={error || books.error?.message} />}
        {!books.isFetching && !books.data?.length && (
          <Alert type="info" title="该产品范围内无台账" />
        )}
        {books.data?.map((book) => (
          <section key={book.productId}>
            <h3>{`库存台账-${book.productCode} ${book.productName}`}</h3>
            <Grid
              id={`batch-ledger-${book.productId}`}
              title={`库存台账-${book.productCode} ${book.productName}`}
              rows={book.rows}
              columns={[
                { key: 'date', title: '日期', dataIndex: 'date' },
                { key: 'number', title: '单号', dataIndex: 'number' },
                { key: 'received', title: '入库数量', dataIndex: 'received' },
                { key: 'issued', title: '出库数量', dataIndex: 'issued' },
                { key: 'balance', title: '结余数量', dataIndex: 'balance' },
                { key: 'unitPrice', title: '本笔成本单价', dataIndex: 'unitPrice' },
                { key: 'amountCents', title: '本笔金额', dataIndex: 'amountCents', money: true },
                { key: 'balanceUnitPrice', title: '结余成本单价', dataIndex: 'balanceUnitPrice' },
                { key: 'balanceCents', title: '结余金额', dataIndex: 'balanceCents', money: true },
              ]}
            />
          </section>
        ))}
      </Drawer>
    </>
  );
}
