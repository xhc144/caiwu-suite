import { expect, it, vi } from 'vitest';
import { runPrintBatch, renderPrintDocument, viewToPrintJob } from '@caiwu/print';
import { buildInventoryLedgerView, type LedgerBook } from '../web/ledger-print';
const books = (): LedgerBook[] => [
  {
    productCode: 'P1',
    productName: '<产品一>',
    warehouseName: '合成仓',
    unit: '件',
    rows: Array.from({ length: 40 }, (_, i) => ({
      date: '2026-01-10',
      number: `R-${i}`,
      received: '1.234567',
      issued: '0',
      balance: String(i + 1),
      amountCents: i === 39 ? null : 123,
      balanceCents: i === 39 ? null : 123 * (i + 1),
      unitPrice: i === 39 ? null : '1.234567',
      balanceUnitPrice: i === 39 ? null : '1.23',
    })),
  },
  {
    productCode: 'P2',
    productName: '产品二',
    warehouseName: '合成仓',
    unit: '件',
    rows: [
      {
        date: '2026-01-01',
        number: '期初',
        received: '0',
        issued: '0',
        balance: '0',
        amountCents: 0,
        balanceCents: 0,
        unitPrice: null,
        balanceUnitPrice: null,
      },
    ],
  },
];
const options = {
  unit: '合成单位',
  from: '2026-01-01',
  to: '2026-01-31',
  quantityDigits: 2,
  priceDigits: 3,
};
it('w_ck_tz1/w_ck_tz1_bak：多产品分产品分页，承前过次结余不重算、不遗漏明细，未知成本留空', () => {
  const source = books(),
    view = buildInventoryLedgerView(source, options);
  expect(view.pages.length).toBeGreaterThan(2);
  expect(view.pages.at(-1)?.account).toBe('P2');
  const html = view.pages.map((p) => p.html).join('');
  for (let i = 0; i < 40; i++)
    expect(html.match(new RegExp(`<td>R-${i}</td>`, 'g'))).toHaveLength(1);
  expect(view.pages[0]?.html).toContain('过次页');
  expect(view.pages[1]?.html).toContain('承前页');
  expect(html).toContain('&lt;产品一&gt;');
  expect(html).not.toContain('<产品一>');
  expect(html).toContain('1.235');
  expect(html).toContain('1.23');
  expect(html).toContain('金额单位：元');
  expect(source[0]?.rows[0]?.received).toBe('1.234567');
  expect(() => renderPrintDocument(viewToPrintJob(view))).not.toThrow();
});
it('w_ck_tz1：逐页确认取消停止剩余打印；连续模式只发送一个完整作业', async () => {
  const view = buildInventoryLedgerView(books(), options),
    send = vi.fn(async () => {});
  const confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await runPrintBatch(view, {
    pages: view.pages.map((_, i) => i + 1),
    copies: 1,
    pause: 'page',
    confirm,
    send,
  });
  expect(result).toEqual({ sent: [1], cancelled: true });
  expect(send).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledTimes(2);
  send.mockClear();
  const continuous = await runPrintBatch(view, {
    pages: view.pages.map((_, i) => i + 1),
    copies: 1,
    pause: 'none',
    confirm,
    send,
  });
  expect(continuous.cancelled).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]).toBeDefined();
});
