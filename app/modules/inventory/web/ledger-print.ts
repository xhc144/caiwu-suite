import { Decimal, formatMoney } from '@caiwu/core';
import { defaultLayout, escapeHtml, wrapPrintText, type PrintView } from '@caiwu/print';
export type LedgerPrintRow = {
  date: string;
  number: string;
  received: string;
  issued: string;
  balance: string;
  amountCents: number | null;
  balanceCents: number | null;
  unitPrice: string | null;
  balanceUnitPrice: string | null;
};
export type LedgerBook = {
  productCode: string;
  productName: string;
  warehouseName: string;
  unit: string;
  rows: LedgerPrintRow[];
};
export function buildInventoryLedgerView(
  books: LedgerBook[],
  options: {
    unit: string;
    from?: string;
    to?: string;
    quantityDigits: number;
    priceDigits: number;
  },
): PrintView {
  const pages: PrintView['pages'] = [];
  const decimal = (v: string | null, digits: number) =>
    v == null ? '' : new Decimal(v).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed();
  const cells = (r: LedgerPrintRow) => [
    r.date,
    r.number,
    decimal(r.received, options.quantityDigits),
    decimal(r.issued, options.quantityDigits),
    decimal(r.balance, options.quantityDigits),
    decimal(r.unitPrice, options.priceDigits),
    formatMoney(r.amountCents),
    decimal(r.balanceUnitPrice, options.priceDigits),
    formatMoney(r.balanceCents),
  ];
  const visualRows = (values: string[]) => {
    const lines = values.map((v, i) => (i < 2 ? wrapPrintText(v, i === 0 ? 36 : 28, 9) : [v]));
    return Array.from({ length: Math.max(1, ...lines.map((v) => v.length)) }, (_, i) =>
      lines.map((v) => v[i] ?? ''),
    );
  };
  const renderRow = (values: string[]) =>
    `<tr>${values
      .map((v, i) =>
        i < 2
          ? `<td>${escapeHtml(v)}</td>`
          : `<td class="num" style="font-size:${Math.min(9, 100 / Math.max(v.length, 1))}pt">${escapeHtml(v)}</td>`,
      )
      .join('')}</tr>`;
  for (const [bookIndex, book] of books.entries()) {
    let chunk: { values: string[]; row: LedgerPrintRow }[] = [],
      previous: LedgerPrintRow | null = null,
      pageNumber = 0;
    const emit = (more: boolean) => {
      if (!chunk.length) return;
      pageNumber++;
      const last = chunk.at(-1)!.row;
      const carry = (label: string, r: LedgerPrintRow) =>
        visualRows([
          '',
          label,
          '',
          '',
          decimal(r.balance, options.quantityDigits),
          '',
          '',
          decimal(r.balanceUnitPrice, options.priceDigits),
          formatMoney(r.balanceCents),
        ])
          .map(renderRow)
          .join('');
      const html = `<h2>${escapeHtml(options.unit)} 库存台账</h2><p>仓库：${escapeHtml(book.warehouseName)}；产品：${escapeHtml(book.productCode)} ${escapeHtml(book.productName)}；单位：${escapeHtml(book.unit)}；期间：${escapeHtml(options.from ?? '')} 至 ${escapeHtml(options.to ?? '')}；第 ${pageNumber} 页；金额单位：元</p><table><thead><tr>${['日期', '单号', '入库数量', '出库数量', '结余数量', '本笔成本单价', '本笔金额', '结余成本单价', '结余金额'].map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody>${previous ? carry('承前页', previous) : ''}${chunk
        .map((r) => renderRow(r.values))
        .join('')}${more ? carry('过次页', last) : ''}</tbody></table>`;
      pages.push({
        html,
        labels: [`${book.productCode} ${book.productName} 第 ${pageNumber} 页`],
        entityIds: [bookIndex + 1],
        account: book.productCode,
        pageNumber,
      });
      previous = last;
      chunk = [];
    };
    for (const row of book.rows) {
      for (const values of visualRows(cells(row))) {
        if (chunk.length >= 20) emit(true);
        chunk.push({ values, row });
      }
    }
    emit(false);
  }
  if (!pages.length) throw new Error('该产品范围内没有可打印台账');
  return {
    title: '库存台账连续打印',
    pages,
    layout: {
      ...defaultLayout,
      landscape: true,
      fontSize: 9,
      quantityDecimals: options.quantityDigits,
      unitName: options.unit,
    },
  };
}
