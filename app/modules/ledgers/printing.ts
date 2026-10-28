import { z } from 'zod';
import { BusinessError, Decimal, sumCents } from '@caiwu/core';
import {
  defaultLayout,
  escapeHtml,
  layoutGeometry,
  parsePageRange,
  viewToPrintJob,
  wrapPrintText,
  type PrintLayout,
  type PrintView,
} from '@caiwu/print';
import { reportCellText } from './presentation';
import type { LedgerDataColumn, LedgerReport, LedgerRow } from './shared';

const zMillimetres = z.number().finite().min(0).max(60);
export const PrintOptionsSchema = z.object({
  rowsPerPage: z.number().int().min(1).max(60).default(24),
  paper: z.enum(['A4', 'A5', 'B5', 'custom']).default('A4'),
  widthMm: z.number().finite().min(80).max(600).default(210),
  heightMm: z.number().finite().min(80).max(600).default(297),
  rowHeightMm: z.number().finite().min(3).max(20).optional(),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  margins: z
    .object({
      top: zMillimetres.default(10),
      right: zMillimetres.default(10),
      bottom: zMillimetres.default(10),
      left: zMillimetres.default(10),
    })
    .default({ top: 10, right: 10, bottom: 10, left: 10 }),
  offsetX: z.number().finite().min(-60).max(60).default(0),
  offsetY: z.number().finite().min(-60).max(60).default(0),
  overlay: z.boolean().default(false),
  pageRange: z.string().trim().max(1000).default(''),
  startPage: z.number().int().min(1).max(999999).default(1),
  continuousPage: z.boolean().default(true),
  accountCodes: z.array(z.string().trim().min(1).max(40)).max(2000).default([]),
  content: z.enum(['all', 'entries', 'balance']).default('all'),
  columnsPerPage: z.number().int().min(1).max(10).default(6),
  fontSize: z.number().min(6).max(14).default(9),
});
export type PrintOptions = z.infer<typeof PrintOptionsSchema>;
export type PrintOptionsInput = z.input<typeof PrintOptionsSchema>;
export type LedgerPrintPage = {
  number: number;
  section: string;
  account: string;
  label: string;
  /** 按本次完整队列的顺序选择页码；与印刷起始页码分开。 */
  index: number;
};

type Fragment = { row: LedgerRow; index: number; last: boolean; cells: string[][] };
type Band = { columns: LedgerDataColumn[]; widths: number[] };
type Carry = {
  debit: number | null;
  credit: number | null;
  values: Record<string, string | number | null>;
  row: LedgerRow | null;
};

function failure(message: string, hint = '请调整打印条件后重新预览。'): never {
  throw new BusinessError({ code: 'LEDGERS_PRINT_OPTIONS', message, hint });
}
export function printLayout(options: PrintOptions): PrintLayout {
  return {
    ...defaultLayout,
    paper: options.paper,
    widthMm: options.widthMm,
    heightMm: options.heightMm,
    landscape: options.orientation === 'landscape',
    margins: options.margins,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    rows: options.rowsPerPage,
    fontSize: options.fontSize,
    startPage: options.startPage,
    continuousPage: options.continuousPage,
  };
}

const minimumWidth = (column: LedgerDataColumn) =>
  column.id === 'summary'
    ? 38
    : column.id === 'account' || column.id === 'dimensions'
      ? 32
      : column.money
        ? 25
        : 22;

/** 重复日期、凭证号和摘要，其余列分到正页、附页；不压缩掉任何栏目。 */
function columnBands(columns: LedgerDataColumn[], width: number, count: number): Band[] {
  const anchors = columns.filter((c) => ['date', 'voucherNo', 'summary'].includes(c.id));
  const payload = columns.filter((c) => !anchors.includes(c));
  const groups: LedgerDataColumn[][] = [];
  let current: LedgerDataColumn[] = [];
  const anchorWidth = anchors.reduce((n, c) => n + minimumWidth(c), 0);
  for (const column of payload) {
    if (
      current.length &&
      (current.length >= count ||
        anchorWidth + current.reduce((n, c) => n + minimumWidth(c), 0) + minimumWidth(column) >
          width)
    ) {
      groups.push(current);
      current = [];
    }
    current.push(column);
  }
  if (current.length || !groups.length) groups.push(current);
  return groups.map((group) => {
    const selected = new Set([...anchors, ...group]);
    const band = columns.filter((column) => selected.has(column));
    const requested = band.map(minimumWidth);
    const total = requested.reduce((n, v) => n + v, 0);
    return { columns: band, widths: requested.map((v) => (v * width) / total) };
  });
}

function groupSections(report: LedgerReport, options: PrintOptions) {
  if (report.query.kind === 'vat' && options.accountCodes.length)
    failure(
      '增值税合计账页不能再按输出科目拆分',
      '请先在账簿查询条件中选择需要的科目，再输出当前合计账页。',
    );
  const sections = new Map<string, LedgerRow[]>();
  for (const row of report.rows) {
    // 既有三栏/日记账同科目的分录辅助项不同，不能因此把汇总行拆到另一账页。
    const key = row.sectionKey ?? row.account;
    const rows = sections.get(key) ?? [];
    rows.push(row);
    sections.set(key, rows);
  }
  if (options.accountCodes.length) {
    const available = new Set(
      [...sections.values()].map((rows) => rows[0]!.account.split(' ')[0]!),
    );
    if (options.accountCodes.some((code) => !available.has(code)))
      failure('所选打印科目不在当前账簿范围内', '请重新查询账簿，再选择需要连续打印的科目。');
  }
  return [...sections.entries()].filter(([, rows]) => {
    const accountCode = rows[0]!.account.split(' ')[0]!;
    if (options.accountCodes.length && !options.accountCodes.includes(accountCode)) return false;
    if (options.content === 'entries')
      return rows.some((row) =>
        report.query.kind === 'general'
          ? row.kind === 'month' &&
            (row.debit !== 0 || row.credit !== 0) &&
            row.debit != null &&
            row.credit != null
          : row.kind === 'entry',
      );
    if (options.content === 'balance')
      return rows.some((row) => {
        if (row.kind !== 'opening' && row.kind !== 'ytd') return false;
        const amounts = row.kind === 'opening' ? [row.signedBalance] : [row.debit, row.credit];
        const otherAmounts = Object.entries(row.values ?? {})
          .filter(([key]) => /^(?:multi_|vat_)|^(?:fc|qty)(?:Debit|Credit|Balance)$/.test(key))
          .map(([, value]) => value);
        return [...amounts, ...otherAmounts].some(
          (value) =>
            (typeof value === 'number' || typeof value === 'string') &&
            value !== '' &&
            !new Decimal(value).isZero(),
        );
      });
    return true;
  });
}

/** 只选择完整的独立账页，不能截下同一汇总账页中的部分分录。 */
export function selectReportAccounts(
  report: LedgerReport,
  accountCodes: string[] = [],
): LedgerReport {
  if (!accountCodes.length) return report;
  if (report.query.kind === 'vat')
    failure(
      '增值税合计账页不能再按打印科目拆分',
      '请先在账簿查询条件中选择需要的科目，再导出当前合计账页。',
    );
  const rows = groupSections(report, PrintOptionsSchema.parse({ accountCodes })).flatMap(
    ([, rows]) => rows,
  );
  return {
    ...report,
    rows,
    entryCount: rows.filter((row) => row.kind === 'entry').length,
    scope: `${report.scope}；本次选定科目：${accountCodes.join('、')}`,
  };
}

const numericColumn = (column: LedgerDataColumn) =>
  column.money ||
  /^qty(?:Debit|Credit|Balance)$|^(?:unitPrice|balanceUnitPrice|exchangeRate)$/.test(column.id);
const financialColumn = (column: LedgerDataColumn) =>
  numericColumn(column) ||
  /^(?:qty|fc)(?:Debit|Credit|Balance|Side)$|^(?:side|unitPrice|balanceUnitPrice|exchangeRate)$/.test(
    column.id,
  );

function fragmentsFor(rows: LedgerRow[], bands: Band[], fontSize: number): Fragment[] {
  const fragments: Fragment[] = [];
  for (const row of rows) {
    const wrapped = bands.map((band) =>
      band.columns.map((column, index) => {
        const text = reportCellText(row, column.id, column.money);
        // 金额在一行内按列宽缩小字号；文本按共享的字素预算分行。
        return financialColumn(column)
          ? [text]
          : wrapPrintText(text, band.widths[index]!, fontSize);
      }),
    );
    const count = Math.max(1, ...wrapped.flatMap((cells) => cells.map((cell) => cell.length)));
    for (let index = 0; index < count; index++) {
      fragments.push({
        row,
        index,
        last: index === count - 1,
        cells: wrapped.map((cells, bandIndex) =>
          cells.map((cell, columnIndex) =>
            financialColumn(bands[bandIndex]!.columns[columnIndex]!)
              ? index === count - 1
                ? cell[0]!
                : ''
              : (cell[index] ?? ''),
          ),
        ),
      });
    }
  }
  return fragments;
}

function advance(carry: Carry, fragment: Fragment, report: LedgerReport): Carry {
  // 整条分录文字打印完毕才列金额和承接余额，避免长摘要的后半段尚未打印就提前入累计。
  if (!fragment.last) return carry;
  const row = fragment.row;
  const movement = report.query.kind === 'general' ? row.kind === 'month' : row.kind === 'entry';
  const values = { ...carry.values, ...row.values };
  for (const [key, value] of Object.entries(row.values ?? {})) {
    if (/^(?:multi_|vat_)/.test(key) || /^fc(?:Debit|Credit)$/.test(key)) {
      values[key] =
        movement && typeof value === 'number'
          ? sumCents([typeof carry.values[key] === 'number' ? carry.values[key] : 0, value])
          : (carry.values[key] ?? 0);
    } else if (/^qty(?:Debit|Credit)$/.test(key)) {
      values[key] =
        movement && typeof value === 'string'
          ? new Decimal(typeof carry.values[key] === 'string' ? carry.values[key] : '0')
              .plus(value)
              .toFixed()
          : (carry.values[key] ?? '0');
    }
  }
  return {
    debit: movement
      ? carry.debit == null || row.debit == null
        ? null
        : sumCents([carry.debit, row.debit])
      : carry.debit,
    credit: movement
      ? carry.credit == null || row.credit == null
        ? null
        : sumCents([carry.credit, row.credit])
      : carry.credit,
    values,
    row,
  };
}
function carryRow(carry: Carry, label: string): LedgerRow {
  const row = carry.row!;
  return {
    ...row,
    id: `carry-${row.id}`,
    kind: 'day',
    date: '',
    account: '',
    dimensions: '',
    currency: '',
    summary: label,
    voucherNo: '',
    voucherId: null,
    href: null,
    refNo: '',
    status: '',
    debit: carry.debit,
    credit: carry.credit,
    values: {
      ...carry.values,
      dimensionYtdMissing: '',
      exchangeRate: null,
      unitPrice: null,
      quantityUnit: '',
    },
  };
}
function cellHtml(text: string, column: LedgerDataColumn, width: number, fontSize: number) {
  const size =
    numericColumn(column) && text ? Math.min(fontSize, (width - 3) / text.length / 0.24) : fontSize;
  if (size < 3) failure('金额列过窄，无法完整打印', '请减少每张附页的栏目数或改用横向纸张。');
  return `<td${column.money ? ' class="num"' : ''} style="font-size:${size}pt">${escapeHtml(text)}</td>`;
}
function renderCarry(carry: Carry, label: string, band: Band, fontSize: number) {
  const row = carryRow(carry, label);
  const hasSummary = band.columns.some((c) => c.id === 'summary');
  const firstText = band.columns.findIndex((c) => !financialColumn(c));
  const cells = band.columns.map((column, index) => {
    let text = reportCellText(row, column.id, column.money);
    const labelCell = !hasSummary && index === firstText;
    if (labelCell) text = label;
    const size = labelCell
      ? Math.min(fontSize, (band.widths[index]! - 2.8) / Array.from(label).length / 0.352778)
      : fontSize;
    return cellHtml(text, column, band.widths[index]!, size);
  });
  return `<tr class="ledger-carry" data-carry="${label.startsWith('承前') ? 'from' : 'to'}">${cells.join('')}</tr>`;
}

export function buildLedgerPrintView(
  report: LedgerReport,
  columns: LedgerDataColumn[],
  raw: PrintOptionsInput = {},
) {
  const options = PrintOptionsSchema.parse(raw);
  const layout = printLayout(options);
  let geometry: ReturnType<typeof layoutGeometry>;
  try {
    geometry = layoutGeometry(layout);
  } catch (error) {
    failure(error instanceof Error ? error.message : '打印页面设置无效');
  }
  if (options.rowHeightMm != null) {
    if (options.rowHeightMm < geometry.lineMm)
      failure('账页行高不足以容纳当前字号', '请增大行高或减小字号，再重新预览。');
    geometry = { ...geometry, lineMm: options.rowHeightMm };
  }
  if (!columns.length) failure('没有可打印的栏目');
  // 全金额/数量格式补摘要列，以免承前过次页标识覆盖金融数值。
  if (columns.every(financialColumn))
    columns = [{ id: 'summary', label: '摘要', money: false }, ...columns];
  const bands = columnBands(columns, geometry.contentWidth, options.columnsPerPage);
  const sections = groupSections(report, options);
  if (!sections.length) failure('打印选择没有账簿记录', '请调整科目选择或打印内容条件后重新预览。');
  const view: PrintView = { title: report.title, pages: [], layout };
  const pages: LedgerPrintPage[] = [];
  for (const [section, rows] of sections) {
    const first = rows[0]!;
    const metadata = [
      `单位：${report.orgName || '本账套'}；期间：${report.query.periodFrom}—${report.query.periodTo}；金额单位：元（本位币/原币按列区分）`,
      `${first.account}${first.dimensions ? `；${first.dimensions}` : ''}${report.query.currency ? `；币种：${report.query.currency}` : ''}${first.values?.quantityUnit ? `；数量单位：${first.values.quantityUnit}` : ''}`,
      report.scope,
    ].flatMap((line) => wrapPrintText(line, geometry.contentWidth, layout.fontSize * 0.85));
    const headings = bands.map((band) =>
      band.columns.map((column, index) =>
        wrapPrintText(column.label, band.widths[index]!, layout.fontSize * 0.8),
      ),
    );
    const headingLines = Math.max(
      1,
      ...headings.flatMap((band) => band.map((lines) => lines.length)),
    );
    const headingHeight = (metadata.length * 0.85 + 2 + headingLines) * geometry.lineMm;
    const capacity = Math.min(
      options.rowsPerPage,
      Math.floor((geometry.contentHeight - headingHeight - 12) / geometry.lineMm) - 2,
    );
    if (capacity < 1)
      failure('页面表头或边距占满可打印区域', '请减小边距或字号，或选择更大的纸张。');
    const fragments = fragmentsFor(rows, bands, layout.fontSize);
    let carry: Carry = { debit: 0, credit: 0, values: {}, row: null };
    let sectionPage = 0;
    for (let offset = 0; offset < fragments.length; offset += capacity) {
      const chunk = fragments.slice(offset, offset + capacity);
      const before = carry;
      for (const fragment of chunk) carry = advance(carry, fragment, report);
      const hasNext = offset + capacity < fragments.length;
      for (const [bandIndex, band] of bands.entries()) {
        const number =
          options.startPage + (options.continuousPage ? view.pages.length : sectionPage++);
        const bandLabel = bands.length === 1 ? '' : bandIndex === 0 ? '正页' : `附页 ${bandIndex}`;
        const label = `${first.account} 第 ${number} 页${bandLabel ? `（${bandLabel}）` : ''}`;
        const body = chunk
          .map(
            (fragment) =>
              `<tr data-ledger-row="${escapeHtml(fragment.row.id)}" data-fragment="${fragment.index}"${fragment.row.kind !== 'entry' ? ' class="ledger-total"' : ''}>${band.columns.map((column, index) => cellHtml(fragment.cells[bandIndex]![index]!, column, band.widths[index]!, layout.fontSize)).join('')}</tr>`,
          )
          .join('');
        const html = `<section class="scaled"><h2 class="single-line">${escapeHtml(report.title)}${bandLabel ? `（${bandLabel}）` : ''}</h2>${metadata.map((line) => `<p class="single-line">${escapeHtml(line)}</p>`).join('')}<table><colgroup>${band.widths.map((width) => `<col style="width:${width}mm">`).join('')}</colgroup><thead><tr>${band.columns.map((_, index) => `<th>${headings[bandIndex]![index]!.map(escapeHtml).join('<br>')}</th>`).join('')}</tr></thead><tbody>${offset > 0 && before.row ? renderCarry(before, '承前页（本期累计）', band, layout.fontSize) : ''}${body}${hasNext && carry.row ? renderCarry(carry, '过次页（本期累计）', band, layout.fontSize) : ''}</tbody></table><footer>第 ${number} 页${bandLabel ? ` · ${bandLabel}` : ''}${options.overlay ? ' · 套打' : ''}</footer></section>`;
        view.pages.push({
          html,
          labels: [label],
          entityIds: [],
          account: first.account,
          pageNumber: number,
        });
        pages.push({ index: pages.length + 1, number, section, account: first.account, label });
      }
    }
  }
  let selected: number[];
  try {
    selected = options.pageRange
      ? parsePageRange(options.pageRange, view.pages.length)
      : view.pages.map((_, index) => index + 1);
  } catch (error) {
    failure(error instanceof Error ? error.message : '打印范围无效');
  }
  const job = viewToPrintJob(view, selected);
  job.css += ` .ledger-total{font-weight:bold}.ledger-carry{font-weight:bold} th,td{height:${geometry.lineMm}mm;overflow:hidden;white-space:pre}th{font-size:${layout.fontSize * 0.8}pt} ${options.overlay ? 'th,td{border-color:transparent!important}.ledger-total,.ledger-carry{background:transparent}.single-line,thead{visibility:hidden}' : ''}`;
  return {
    ...job,
    pages: selected.map((index) => pages[index - 1]!),
    totalPages: pages.length,
    options,
  };
}
