import Decimal from 'decimal.js';
import { BusinessError } from '@caiwu/core';
import { escapeHtml, type PrintJob } from '@caiwu/print';
import { PayrollPrintLayoutSchema, type PayrollPrintLayout } from './shared-print';

export type PrintReport = {
  columns: { key: string; name: string; kind?: string; unit?: string }[];
  rows: {
    label: string;
    period: string;
    values: Record<string, number>;
    quantities?: Record<string, string>;
    basicValues?: Record<string, string>;
    categoryNames?: string[];
  }[];
  totals: Record<string, number>;
  quantityTotals?: Record<string, string>;
  sourceDetails?: { categoryName: string }[];
};
function invalid(message: string, hint = '调整打印格式后重新预览；工资数据不会改变'): never {
  throw new BusinessError({ code: 'PAYROLL_PRINT_LAYOUT', message, hint });
}
export function printGeometry(layout: PayrollPrintLayout) {
  const width = layout.landscape ? 297 : 210;
  const height = layout.landscape ? 210 : 297;
  const contentWidth = width - layout.margins.left - layout.margins.right;
  const contentHeight = height - layout.margins.top - layout.margins.bottom;
  if (contentWidth < 100 || contentHeight < 100) invalid('页边距过大，可打印区域不足');
  const lineHeight = layout.fontSize * 0.352778 * 1.5 + 2;
  const neededHeight =
    layout.mode === 'slips'
      ? (layout.columns.length * lineHeight + 24) * layout.slipsPerPage + 12
      : (layout.rowsPerPage + 2) * lineHeight + 36;
  if (neededHeight > contentHeight)
    invalid('每页记录数过多，内容会超出纸张', '减少每页行数或工资条数，或减小字号与上下边距');
  if (layout.mode !== 'slips' && layout.columns.reduce((n, c) => n + c.widthMm, 76) > contentWidth)
    invalid('栏目总宽度超出纸张', '减少栏目宽度或栏目数，或选择横向纸张');
  return { width, height, contentWidth, contentHeight };
}
function numberText(
  value: number | string,
  kind: string,
  column: PayrollPrintLayout['columns'][number],
) {
  const decimal = new Decimal(value).div(kind === 'quantity' ? 1 : 100);
  const text = decimal.toFixed(column.decimals, Decimal.ROUND_HALF_UP);
  if (text.replace(/^-/, '').split('.')[0]!.length > column.integerDigits)
    invalid('金额或数量超出设置的整数宽度', '增加该栏目的整数宽度后重新预览，不会截断工资数字');
  return text;
}
export function renderSalaryPrint(report: PrintReport, raw: PayrollPrintLayout) {
  const layout = PayrollPrintLayoutSchema.parse(raw);
  if (!report.rows.length) invalid('没有选中可输出的工资数据', '重新选择已计算期间及人员');
  const geometry = printGeometry(layout);
  const columns = layout.columns.map((c) => {
    const source = report.columns.find((column) => column.key === c.key);
    if (!source) invalid(`打印栏目 ${c.key} 已不存在`, '重新选择当前工资类别的栏目并保存打印格式');
    return { ...source, ...c };
  });
  const formatted = (row: PrintReport['rows'][number], c: (typeof columns)[number]) =>
    c.kind === 'basic'
      ? (row.basicValues?.[c.key] ?? '')
      : numberText(
          c.kind === 'quantity' ? (row.quantities?.[c.key] ?? '0') : (row.values[c.key] ?? 0),
          c.kind ?? 'money',
          c,
        );
  const total = (c: (typeof columns)[number]) =>
    c.kind === 'basic'
      ? ''
      : numberText(
          c.kind === 'quantity'
            ? (report.quantityTotals?.[c.key] ?? '0')
            : (report.totals[c.key] ?? 0),
          c.kind ?? 'money',
          c,
        );
  const perPage = layout.mode === 'slips' ? layout.slipsPerPage : layout.rowsPerPage;
  const pages = Math.ceil(report.rows.length / perPage);
  const categoryNames = [
    ...new Set(report.sourceDetails?.map((source) => source.categoryName) ?? []),
  ];
  const header = `<header><h2>${escapeHtml(layout.title)}</h2><p>${escapeHtml(layout.unitName)}&#12288;金额单位：元；数量按栏目单位</p>${categoryNames.length ? `<p>工资类别：${escapeHtml(categoryNames.join('、'))}</p>` : ''}</header>`;
  const footer = (page: number) =>
    `<footer><p>${escapeHtml(layout.footer)}</p><p>第 ${page} / ${pages} 页</p></footer>`;
  const columnName = (c: (typeof columns)[number]) => `${c.name}${c.unit ? `（${c.unit}）` : ''}`;
  const html = Array.from({ length: pages }, (_, page) => {
    const rows = report.rows.slice(page * perPage, (page + 1) * perPage);
    const body =
      layout.mode === 'slips'
        ? rows
            .map(
              (row) =>
                `<article class="payroll-slip"><h3>${escapeHtml(row.label)}</h3><p>工资期间：${escapeHtml(row.period)}${row.categoryNames?.length ? `&#12288;${escapeHtml(row.categoryNames.join('、'))}` : ''}</p>${columns.map((c) => `<table><colgroup><col style="width:${geometry.contentWidth - c.widthMm}mm"><col style="width:${c.widthMm}mm"></colgroup><tbody><tr><th>${escapeHtml(columnName(c))}</th><td class="${c.kind === 'basic' ? '' : 'num'}">${escapeHtml(formatted(row, c))}</td></tr></tbody></table>`).join('')}<p>签收：________________</p></article>`,
            )
            .join('')
        : `<table><colgroup><col style="width:52mm"><col style="width:24mm">${columns.map((c) => `<col style="width:${c.widthMm}mm">`).join('')}</colgroup><thead><tr><th>人员 / 部门</th><th>期间</th>${columns.map((c) => `<th>${escapeHtml(columnName(c))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.period)}</td>${columns.map((c) => `<td class="${c.kind === 'basic' ? '' : 'num'}">${escapeHtml(formatted(row, c))}</td>`).join('')}</tr>`).join('')}${page === pages - 1 ? `<tr><th>全部合计</th><td></td>${columns.map((c) => `<td class="num">${escapeHtml(total(c))}</td>`).join('')}</tr>` : ''}</tbody></table>`;
    return `<section class="payroll-sheet"><div class="payroll-page">${header}${body}${footer(page + 1)}</div></section>`;
  }).join('');
  const job: PrintJob = {
    title: layout.title,
    html,
    pageSize: 'A4',
    orientation: layout.landscape ? 'landscape' : 'portrait',
    marginMm: 0,
    css: `@page{margin:${layout.margins.top}mm ${layout.margins.right}mm ${layout.margins.bottom}mm ${layout.margins.left}mm}body{font-size:${layout.fontSize}pt}.payroll-sheet{width:${geometry.contentWidth}mm;height:${geometry.contentHeight - 1}mm;box-sizing:border-box;break-after:page}.payroll-sheet:last-child{break-after:auto}.payroll-page{width:100%;box-sizing:border-box}h2,h3,p{margin:0 0 2mm}header{text-align:center;margin-bottom:3mm}th,td{padding:1mm;line-height:1.5}thead{display:table-header-group}.payroll-slip{break-inside:avoid;margin-bottom:5mm;border-bottom:1px dashed #777;padding-bottom:3mm}.payroll-slip table{width:100%}footer{margin-top:4mm;white-space:pre-wrap;overflow-wrap:anywhere}footer p:last-child{text-align:right}tr{break-inside:avoid}`,
  };
  return { job, pages };
}
