import { Decimal, formatMoney } from '@caiwu/core';
import { escapeHtml, wrapPrintText, type PrintJob } from '@caiwu/print';
import {
  groupCaption,
  reportCaption,
  reportTables,
  reportTitle,
  type OutputRow,
  type Report,
} from '../shared';
import { columnsFor } from './output';
import { printCents, printText } from './print-text';

export type BalancePrintOptions = {
  rowsPerPage: number;
  startPage: number;
  offsetX: number;
  offsetY: number;
};
export const defaultBalancePrintOptions: BalancePrintOptions = {
  rowsPerPage: 20,
  startPage: 1,
  offsetX: 0,
  offsetY: 0,
};

type PrintAmountKey =
  | 'debit'
  | 'credit'
  | 'ytdDebit'
  | 'ytdCredit'
  | 'fcOpening'
  | 'fcDebit'
  | 'fcCredit'
  | 'fcClosing'
  | 'fcYtdDebit'
  | 'fcYtdCredit';
type PrintRow = {
  [K in keyof OutputRow]: OutputRow[K] | (K extends PrintAmountKey ? string : never);
};
function carries(rows: OutputRow[], label: string): PrintRow {
  const leaves = rows.flatMap((r) => (r.source?.isLeaf ? [r.source] : []));
  const sum = (key: 'opening' | 'closing', side: 'debit' | 'credit') =>
    leaves.reduce(
      (n, r) => n + BigInt(side === 'debit' ? Math.max(r[key], 0) : Math.max(-r[key], 0)),
      0n,
    );
  const money = (
    key:
      | 'debit'
      | 'credit'
      | 'ytdDebit'
      | 'ytdCredit'
      | 'fcOpening'
      | 'fcDebit'
      | 'fcCredit'
      | 'fcClosing'
      | 'fcYtdDebit'
      | 'fcYtdCredit',
  ) =>
    leaves.some((r) => r[key] == null)
      ? null
      : printCents(
          leaves.reduce((n, r) => n + BigInt(r[key] ?? 0), 0n),
          true,
        );
  const qty = (
    key: 'qtyOpening' | 'qtyDebit' | 'qtyCredit' | 'qtyClosing' | 'qtyYtdDebit' | 'qtyYtdCredit',
  ) =>
    leaves.some((r) => r[key] == null)
      ? null
      : leaves.reduce((n, r) => n.add(r[key] ?? 0), new Decimal(0)).toFixed();
  return {
    key: label,
    code: label,
    name: '已列末级科目累计，各辅助分项分别计入一次',
    openingSide: '借 / 贷',
    closingSide: '借 / 贷',
    opening: `${printCents(sum('opening', 'debit'), true)} / ${printCents(sum('opening', 'credit'), true)}`,
    closing: `${printCents(sum('closing', 'debit'), true)} / ${printCents(sum('closing', 'credit'), true)}`,
    debit: money('debit')!,
    credit: money('credit')!,
    ytdDebit: money('ytdDebit')!,
    ytdCredit: money('ytdCredit')!,
    fcOpening: money('fcOpening')!,
    fcDebit: money('fcDebit')!,
    fcCredit: money('fcCredit')!,
    fcClosing: money('fcClosing')!,
    fcYtdDebit: money('fcYtdDebit'),
    fcYtdCredit: money('fcYtdCredit'),
    qtyOpening: qty('qtyOpening')!,
    qtyDebit: qty('qtyDebit')!,
    qtyCredit: qty('qtyCredit')!,
    qtyClosing: qty('qtyClosing')!,
    qtyYtdDebit: qty('qtyYtdDebit'),
    qtyYtdCredit: qty('qtyYtdCredit'),
    closingUnitPrice: '—',
  };
}

/** 宽表按完整列组分册，横向及纵向分页均重印单位、期间、辅助项、币种和表头。 */
export function buildBalancePrintJob(
  report: Report,
  level: number,
  expanded: number[],
  selectedAccountIds?: number[],
  options = defaultBalancePrintOptions,
): PrintJob {
  if (
    !Number.isInteger(options.rowsPerPage) ||
    options.rowsPerPage < 5 ||
    options.rowsPerPage > 30 ||
    !Number.isInteger(options.startPage) ||
    options.startPage < 1 ||
    options.startPage > 999999 ||
    !Number.isFinite(options.offsetX) ||
    Math.abs(options.offsetX) > 8 ||
    !Number.isFinite(options.offsetY) ||
    Math.abs(options.offsetY) > 8
  )
    throw new Error('打印设置无效，请检查每页行数、页码及套打偏移');
  if (selectedAccountIds && !selectedAccountIds.length) throw new Error('请至少选择一个打印科目');
  const all = columnsFor(report);
  const meta = all.filter((c) =>
    ['code', 'name', 'auxiliaryCode', 'auxiliaryName'].includes(c.key),
  );
  const bands =
    report.mode === 'summary'
      ? ([
          ['期初与本期发生', ['openingSide', 'opening', 'debit', 'credit']],
          ['本年累计与期末', ['ytdDebit', 'ytdCredit', 'closingSide', 'closing']],
        ] as const)
      : report.mode === 'foreign'
        ? ([
            ['期初余额', ['openingSide', 'opening', 'fcOpening']],
            ['本期发生', ['debit', 'credit', 'fcDebit', 'fcCredit']],
            ['本年累计', ['ytdDebit', 'ytdCredit', 'fcYtdDebit', 'fcYtdCredit']],
            ['期末余额', ['closingSide', 'closing', 'fcClosing']],
          ] as const)
        : ([
            ['期初余额', ['openingSide', 'opening', 'qtyOpening']],
            ['本期发生', ['debit', 'credit', 'qtyDebit', 'qtyCredit']],
            ['本年累计', ['ytdDebit', 'ytdCredit', 'qtyYtdDebit', 'qtyYtdCredit']],
            ['期末余额与单价', ['closingSide', 'closing', 'qtyClosing', 'closingUnitPrice']],
          ] as const);
  const selected = selectedAccountIds ? new Set(selectedAccountIds) : null;
  const pages: string[] = [];
  for (const { group, rows: source } of reportTables(report, level, expanded)) {
    const rows = source.filter((r) => !selected || (r.source && selected.has(r.source.accountId)));
    if (!rows.length) continue;
    for (const [bandName, keys] of bands) {
      const columns = [...meta, ...keys.map((key) => all.find((c) => c.key === key)!)];
      const widths: number[] = columns.map((c) =>
        c.key === 'code'
          ? 20
          : c.key === 'name'
            ? 42
            : c.key === 'auxiliaryCode'
              ? 20
              : c.key === 'auxiliaryName'
                ? 35
                : 0,
      );
      const valueWidth = (277 - widths.reduce((a, b) => a + b, 0)) / keys.length;
      const actualWidths = widths.map((w) => w || valueWidth);
      const caption = `${reportCaption(report, group.currency)}；${groupCaption(group)}`;
      const captionLines = wrapPrintText(caption, 277, 8);
      const value = (row: PrintRow, key: (typeof columns)[number]) => {
        const v = row[key.key];
        return typeof v === 'number' && key.money ? formatMoney(v) : String(v ?? '—');
      };
      const render = (row: PrintRow, fragment?: number, cells?: string[][]): string => {
        if (!cells) {
          const fitted = columns.map((col, i) =>
            printText(value(row, col), actualWidths[i]!, 6, !!col.money || !!col.quantity),
          );
          const wrapped = fitted.map((cell) => cell.lines);
          return Array.from(
            { length: Math.max(...wrapped.map((cell) => cell.length)) },
            (_, part) =>
              `<tr class="carry">${wrapped.map((cell, i) => `<td style="font-size:${fitted[i]!.fontSize}pt">${escapeHtml(cell[part] ?? '')}</td>`).join('')}</tr>`,
          ).join('');
        }
        return `<tr data-row="${escapeHtml(row.key)}" data-fragment="${fragment}">${cells.map((cell, i) => `<td style="font-size:${printText(value(row, columns[i]!), actualWidths[i]!, 8, !!columns[i]!.money || !!columns[i]!.quantity).fontSize}pt">${escapeHtml(cell[fragment!] ?? '')}</td>`).join('')}</tr>`;
      };
      const visual = rows.flatMap((row, rowIndex) => {
        const cells = columns.map(
          (col, i) =>
            printText(value(row, col), actualWidths[i]!, 8, !!col.money || !!col.quantity).lines,
        );
        return Array.from({ length: Math.max(...cells.map((c) => c.length)) }, (_, fragment) => ({
          row,
          rowIndex,
          fragment,
          cells,
        }));
      });
      // 纵向预算含重复表头、最长承前/过次行和页脚；长名称按实际视觉行分页。
      const capacity = Math.min(
        options.rowsPerPage,
        Math.floor((180 - captionLines.length * 4 - 42) / 5),
      );
      if (capacity < 1) throw new Error('打印页眉过长，无法放入纸张，请缩短账套名称或查询范围说明');
      const carry = (before: number, label: string) => {
        const printed = rows.slice(0, before);
        return printed.some((r) => r.source?.isLeaf) ? render(carries(printed, label)) : '';
      };
      for (let offset = 0; offset < visual.length; offset += capacity) {
        const chunk = visual.slice(offset, offset + capacity);
        const last = offset + capacity >= visual.length;
        const completed = chunk.at(-1)!;
        // 金额印在首个视觉行；摘要跨页时该笔金额已经列出，只计入一次。
        const after = completed.rowIndex + 1;
        pages.push(
          `<article class="print-sheet"><section class="balance-sheet" data-page="${options.startPage + pages.length}"><h2>${escapeHtml(reportTitle(report))} · ${escapeHtml(bandName)}</h2>${captionLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<p>${selected ? '仅打印指定显示科目，不另列选中科目合计。' : '范围合计按末级计一次。'} 累计来源缺失显示“—”；数量不跨单位合计。</p><table><colgroup>${actualWidths.map((width) => `<col style="width:${width}mm">`).join('')}</colgroup><thead><tr>${columns.map((col) => `<th>${escapeHtml(col.title)}</th>`).join('')}</tr></thead><tbody>${offset ? carry(chunk[0]!.rowIndex + (chunk[0]!.fragment > 0 ? 1 : 0), '承前页') : ''}${chunk.map((r) => render(r.row, r.fragment, r.cells)).join('')}${last ? '' : carry(after, '过次页')}</tbody></table><footer>第 ${options.startPage + pages.length} 页</footer></section></article>`,
        );
      }
    }
  }
  if (!pages.length) throw new Error('没有可打印的显示科目，请调整科目或显示级次');
  return {
    title: reportTitle(report),
    orientation: 'landscape',
    pageSize: 'A4',
    marginMm: 0,
    html: pages.join(''),
    css: `body{font-size:8pt}.print-sheet{box-sizing:border-box;width:297mm;height:209.8mm;padding:10mm;break-after:page}.print-sheet:last-child{break-after:auto}.balance-sheet{position:relative;left:${options.offsetX}mm;top:${options.offsetY}mm;width:277mm}h2{font-size:12pt;text-align:center;margin:0 0 2mm}p{white-space:pre;margin:0;line-height:4mm}th,td{white-space:pre;line-height:4mm;padding:.4mm 1mm;vertical-align:top}th{white-space:normal}tr{break-inside:avoid}.carry{font-size:6pt}footer{text-align:right;line-height:5mm}`,
  };
}
