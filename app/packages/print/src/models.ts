import { Decimal, assertCents, formatMoney, sumCents, type Voucher } from '@caiwu/core';
import { escapeHtml, type PrintJob } from './driver';
import { layoutGeometry, type PrintLayout } from './layout';

export type VoucherPrintModel = { unit: string; vouchers: (Voucher & { auxiliary: string[] })[] };
export type LedgerPrintRow = {
  id: string;
  date: string;
  voucherNo: string;
  summary: string;
  debit: number;
  credit: number;
  balance: number;
  counterpart: string;
  refNo: string;
  quantity: string | null;
};
export type LedgerPrintModel = {
  unit: string;
  title: string;
  kind: 'general' | 'detail' | 'cash' | 'bank';
  period: string;
  account: string;
  opening: number;
  debit: number;
  credit: number;
  ytdDebit: number;
  ytdCredit: number;
  rows: LedgerPrintRow[];
};
export type PrintPage = { html: string; labels: string[]; entityIds: number[] };
export type PrintView = { title: string; pages: PrintPage[]; layout: PrintLayout };

/** 按实际可用列宽保守换行；中文、拉丁字母和换行都保留，不裁掉长分录。 */
export function wrapPrintText(text: string, widthMm: number, fontSize: number): string[] {
  const max = Math.max(1, Math.floor((widthMm - 4) / (fontSize * 0.352778) - 1));
  const lines: string[] = [];
  let line = '',
    units = 0;
  for (const c of text) {
    const weight = (c.codePointAt(0) ?? 0) <= 127 ? 0.65 : 1;
    if (c === '\n') {
      lines.push(line);
      line = '';
      units = 0;
      continue;
    }
    if (units + weight > max && line) {
      lines.push(line);
      line = '';
      units = 0;
    }
    line += c;
    units += weight;
  }
  lines.push(line);
  return lines;
}
const money = (v: number) => escapeHtml(formatMoney(v));
const num = (v: string, widthMm = 22, fontSize = 10) => {
  const required = (widthMm - 3) / Math.max(1, v.length) / 0.24;
  if (v && required < 3) throw new Error('金额列过窄，请加宽纸张或使用横向打印');
  const size = Math.min(fontSize * 0.85, required);
  return `<td class="num" style="font-size:${size}pt">${v}</td>`;
};
function checkAmounts(rows: { debit: number; credit: number }[]) {
  for (const r of rows) {
    assertCents(r.debit);
    assertCents(r.credit);
  }
}
export function buildVoucherView(model: VoucherPrintModel, layout: PrintLayout): PrintView {
  const g = layoutGeometry(layout);
  if (!model.vouchers.length) throw new Error('无记录，无法预览/打印');
  const slotHeight = g.contentHeight / layout.perPage;
  const slots: { html: string; label: string; id: number }[] = [];
  for (const v of model.vouchers) {
    if (!v.lines.length) throw new Error(`${v.displayNo} 没有分录，无法打印`);
    checkAmounts(v.lines);
    if (
      sumCents(v.lines.map((l) => l.debit)) !== v.debitTotal ||
      sumCents(v.lines.map((l) => l.credit)) !== v.creditTotal
    )
      throw new Error(`${v.displayNo} 分录与合计不一致，请重新读取`);
    const title = wrapPrintText(
      `${v.voucherTypeCode}字记账凭证 ${v.displayNo}`,
      g.contentWidth,
      layout.fontSize * 1.25,
    );
    const metadata = wrapPrintText(
      `${layout.showUnit ? layout.unitName || model.unit : ''}  日期：${v.date}  附件：${v.attachments} 张`,
      g.contentWidth,
      layout.fontSize * 0.9,
    );
    const signatures = wrapPrintText(
      `制单：${v.createdBy.name}  审核：${v.auditedBy?.name ?? ''}  主管：${layout.supervisor}`,
      g.contentWidth,
      layout.fontSize * 0.9,
    );
    const overhead =
      title.length * g.lineMm * 1.25 +
      (metadata.length + signatures.length) * (g.lineMm + 1) +
      3 * g.lineMm +
      6;
    const capacity = Math.min(
      layout.rows,
      Math.floor((slotHeight / (layout.scale / 100) - overhead) / g.lineMm),
    );
    if (capacity < 1)
      throw new Error(`${v.displayNo} 的页眉和签名无法放入纸张，请减少每页张数、字体或边距`);
    const amount = (cents: number) => num(money(cents), g.contentWidth * 0.16, layout.fontSize);
    const visual: string[] = [];
    v.lines.forEach((l, i) => {
      const previous = v.lines[i - 1];
      const summary = layout.deduplicateSummary && previous?.summary === l.summary ? '' : l.summary;
      const account = `${layout.showAccountCode ? l.accountCode + ' ' : ''}${l.accountName}`;
      const auxiliary = [
        layout.showAuxiliary ? v.auxiliary[i] : '',
        l.quantity == null
          ? ''
          : `数量 ${new Decimal(l.quantity).toFixed(layout.quantityDecimals)}`,
        l.exchangeRate == null ? '' : `汇率 ${l.exchangeRate}`,
      ]
        .filter(Boolean)
        .join('；');
      const a = wrapPrintText(summary, g.contentWidth * 0.32, layout.fontSize);
      const b = wrapPrintText(
        account + (auxiliary ? '\n' + auxiliary : ''),
        g.contentWidth * 0.36,
        layout.fontSize,
      );
      for (let j = 0; j < Math.max(a.length, b.length); j++)
        visual.push(
          `<tr data-line="${l.id}" data-fragment="${j}"><td>${escapeHtml(a[j] ?? '')}</td><td>${escapeHtml(b[j] ?? '')}</td>${j === 0 ? amount(l.debit) : num('')}${j === 0 ? amount(l.credit) : num('')}</tr>`,
        );
    });
    const parts = Math.ceil(visual.length / capacity);
    for (let p = 0; p < parts; p++) {
      const label = `${v.date.slice(0, 7)} ${v.displayNo}${parts > 1 ? `（续页 ${p + 1}/${parts}）` : ''}`;
      slots.push({
        id: v.id,
        label,
        html: `<section class="voucher" style="height:${slotHeight}mm"><div class="scaled">${title.map((t) => `<h2 class="single-line">${escapeHtml(t)}</h2>`).join('')}${parts > 1 ? `<p class="single-line">第 ${p + 1}/${parts} 联（同一凭证续页）</p>` : ''}${metadata.map((t) => `<p class="single-line">${escapeHtml(t)}</p>`).join('')}<table><colgroup><col style="width:32%"><col style="width:36%"><col style="width:16%"><col style="width:16%"></colgroup><thead><tr><th>摘要</th><th>科目 / 辅助项</th><th>借方金额</th><th>贷方金额</th></tr></thead><tbody>${visual.slice(p * capacity, (p + 1) * capacity).join('')}</tbody><tfoot><tr><td colspan="2">${p === parts - 1 ? '合计' : '凭证合计（续页）'}</td>${amount(v.debitTotal)}${amount(v.creditTotal)}</tr></tfoot></table>${signatures.map((t) => `<p class="single-line">${escapeHtml(t)}</p>`).join('')}</div></section>`,
      });
    }
  }
  const pages: PrintPage[] = [];
  for (let i = 0; i < slots.length; i += layout.perPage) {
    const group = slots.slice(i, i + layout.perPage);
    pages.push({
      html: group.map((s) => s.html).join(''),
      labels: group.map((s) => s.label),
      entityIds: [...new Set(group.map((s) => s.id))],
    });
  }
  return { title: '凭证打印', pages, layout };
}
export function buildLedgerView(
  model: LedgerPrintModel,
  layout: PrintLayout,
  at = new Date().toISOString(),
): PrintView {
  const s = { ...layout, perPage: 1 as const };
  const g = layoutGeometry(s);
  if (!model.rows.length)
    throw new Error('无记录，无法预览/打印；如需空科目，请明确选择打印无发生科目');
  checkAmounts(model.rows);
  assertCents(model.opening);
  const title = wrapPrintText(model.title, g.contentWidth, s.fontSize * 1.25);
  const metadata = wrapPrintText(
    `${s.showUnit ? s.unitName || model.unit : ''}  ${model.period}  科目：${model.account}`,
    g.contentWidth,
    s.fontSize * 0.9,
  );
  const overhead =
    title.length * g.lineMm * 1.25 + metadata.length * (g.lineMm + 1) + 5 * g.lineMm + 10;
  const capacity = Math.min(
    s.rows,
    Math.floor((g.contentHeight / (s.scale / 100) - overhead) / g.lineMm),
  );
  if (capacity < 1) throw new Error('账簿页眉和汇总行无法放入纸张，请减小字体或边距');
  const rows: { html: string; debit: number; credit: number; balance: number }[] = [];
  const extra = model.kind === 'cash' ? '对方科目' : model.kind === 'bank' ? '银行票号' : '数量';
  const side = (n: number) => (n === 0 ? '平' : n > 0 ? '借' : '贷');
  const tr = (
    date: string,
    no: string,
    text: string,
    other: string,
    debit: number,
    credit: number,
    balance: number,
  ) =>
    `<tr><td class="ledger-id">${escapeHtml(date)}</td><td class="ledger-id">${escapeHtml(no)}</td><td>${escapeHtml(text)}</td><td>${escapeHtml(other)}</td>${num(money(debit), g.contentWidth * 0.12, s.fontSize)}${num(money(credit), g.contentWidth * 0.12, s.fontSize)}<td>${side(balance)}</td>${num(money(Math.abs(balance)), g.contentWidth * 0.1, s.fontSize)}</tr>`;
  for (const r of model.rows) {
    const text = wrapPrintText(r.summary, g.contentWidth * 0.25, s.fontSize);
    const other =
      model.kind === 'cash'
        ? r.counterpart
        : model.kind === 'bank'
          ? r.refNo
          : r.quantity == null
            ? ''
            : new Decimal(r.quantity).toFixed(s.quantityDecimals);
    const wrapped = wrapPrintText(other, g.contentWidth * 0.15, s.fontSize);
    const date = wrapPrintText(r.date, g.contentWidth * 0.11, s.fontSize * 0.5),
      no = wrapPrintText(r.voucherNo, g.contentWidth * 0.11, s.fontSize * 0.5);
    for (let j = 0; j < Math.max(text.length, wrapped.length, date.length, no.length); j++)
      rows.push({
        html: tr(
          date[j] ?? '',
          no[j] ?? '',
          text[j] ?? '',
          wrapped[j] ?? '',
          j === 0 ? r.debit : 0,
          j === 0 ? r.credit : 0,
          r.balance,
        ),
        debit: j === 0 ? r.debit : 0,
        credit: j === 0 ? r.credit : 0,
        balance: r.balance,
      });
  }
  let debit = 0,
    credit = 0,
    balance = model.opening;
  const pages: PrintPage[] = [];
  for (let i = 0; i < rows.length; i += capacity) {
    const chunk = rows.slice(i, i + capacity),
      start =
        i === 0
          ? tr('', '', '期初余额', '', 0, 0, model.opening)
          : tr('', '', '承前页', '', debit, credit, balance);
    debit = sumCents([debit, ...chunk.map((r) => r.debit)]);
    credit = sumCents([credit, ...chunk.map((r) => r.credit)]);
    balance = chunk.at(-1)!.balance;
    const last = i + capacity >= rows.length;
    const end = last
      ? tr('', '', '本期合计', '', model.debit, model.credit, balance) +
        tr('', '', '本年累计', '', model.ytdDebit, model.ytdCredit, balance)
      : tr('', '', '过次页', '', debit, credit, balance);
    pages.push({
      labels: [`${model.account} 第 ${s.startPage + pages.length} 页`],
      entityIds: [],
      html: `<section class="scaled">${title.map((t) => `<h2 class="single-line">${escapeHtml(t)}</h2>`).join('')}${metadata.map((t) => `<p class="single-line">${escapeHtml(t)}</p>`).join('')}<table><colgroup><col style="width:11%"><col style="width:11%"><col style="width:25%"><col style="width:15%"><col style="width:12%"><col style="width:12%"><col style="width:4%"><col style="width:10%"></colgroup><thead><tr>${['日期', '凭证字号', '摘要', extra, '借方', '贷方', '方向', '余额'].map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${start}${chunk.map((r) => r.html).join('')}${end}</tbody></table><footer>第 ${s.startPage + pages.length} 页&emsp;打印时间：${escapeHtml(at)}</footer></section>`,
    });
  }
  return { title: model.title, pages, layout: s };
}
/** 连续编号在本次科目集合内累进；关闭时每科目重新起算。 */
export function buildLedgerBookView(
  models: LedgerPrintModel[],
  layout: PrintLayout,
  at = new Date().toISOString(),
): PrintView {
  if (!models.length) throw new Error('无记录，无法预览/打印');
  const pages: PrintPage[] = [];
  for (const model of models) {
    const startPage = layout.startPage + (layout.continuousPage ? pages.length : 0);
    pages.push(...buildLedgerView(model, { ...layout, startPage }, at).pages);
  }
  return { title: '账册打印', pages, layout: { ...layout, perPage: 1 } };
}
export function viewToPrintJob(
  view: PrintView,
  selected = view.pages.map((_, i) => i + 1),
): PrintJob {
  const g = layoutGeometry(view.layout),
    s = view.layout;
  if (
    !selected.length ||
    new Set(selected).size !== selected.length ||
    selected.some((p) => !Number.isInteger(p) || p < 1 || p > view.pages.length)
  )
    throw new Error('打印页码无效或无记录');
  return {
    title: view.title,
    pageSize: {
      widthMm: s.landscape ? g.height : g.width,
      heightMm: s.landscape ? g.width : g.height,
    },
    orientation: s.landscape ? 'landscape' : 'portrait',
    marginMm: 0,
    html: selected
      .map(
        (p) =>
          `<article class="print-sheet" data-page="${p}"><div class="page-content">${view.pages[p - 1]!.html}</div></article>`,
      )
      .join(''),
    css: `*{box-sizing:border-box} body{font-family:${s.font};font-size:${s.fontSize}pt;color:${s.color ? '#173f69' : '#000'}} .print-sheet{width:${g.width}mm;height:${g.height - 0.2}mm;padding:${s.margins.top}mm ${s.margins.right}mm ${s.margins.bottom}mm ${s.margins.left}mm;break-after:page;break-inside:avoid}.print-sheet:last-child{break-after:auto}.page-content{position:relative;left:${s.offsetX}mm;top:${s.offsetY}mm;width:${g.contentWidth}mm}.scaled{zoom:${s.scale / 100};width:100%}.voucher{box-sizing:border-box;break-inside:avoid} h2{font-size:1.25em;text-align:center;margin:0 0 2mm}p{margin:.5mm 0;font-size:.9em;line-height:1.45}.single-line{white-space:pre}th,td{padding:.5mm 1mm;height:${g.lineMm}mm;line-height:1.45;white-space:pre-wrap;vertical-align:top}th{white-space:nowrap}td.num{white-space:nowrap}.ledger-id{font-size:.65em}footer{margin-top:3mm;text-align:right;font-size:.85em}`,
  };
}
