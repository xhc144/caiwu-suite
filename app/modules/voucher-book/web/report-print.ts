import { formatMoney, VOUCHER_STATUS_LABELS } from '@caiwu/core';
import { escapeHtml } from '@caiwu/print';
import { reportTotals, type BookFilter } from '../shared';

export function reportCaption(filter: BookFilter, typeName?: string) {
  const text = [
    `科目 ${filter.accountCode ?? '全部'}`,
    `期间 ${filter.periodFrom ?? '全部'} 至 ${filter.periodTo ?? '全部'}`,
    `日期 ${filter.dateFrom ?? '不限'} 至 ${filter.dateTo ?? '不限'}`,
    `凭证类型 ${typeName ?? filter.voucherTypeId ?? '全部'}`,
    `号段 ${filter.numberFrom ?? '不限'} 至 ${filter.numberTo ?? '不限'}`,
    `状态 ${filter.statuses?.map((s) => VOUCHER_STATUS_LABELS[s]).join('、') || '全部'}`,
  ];
  if (filter.amountFrom != null || filter.amountTo != null)
    text.push(
      `金额 ${filter.amountFrom == null ? '不限' : formatMoney(filter.amountFrom)} 至 ${filter.amountTo == null ? '不限' : formatMoney(filter.amountTo)} 元`,
    );
  if (filter.summaryContains) text.push(`摘要含有“${filter.summaryContains}”`);
  if (filter.createdBy != null) text.push(`制单人编号 ${filter.createdBy}`);
  if (filter.id != null) text.push(`凭证记录编号 ${filter.id}`);
  if (filter.sourceModule) text.push(`来源模块 ${filter.sourceModule}`);
  if (filter.sourceType) text.push(`来源类型 ${filter.sourceType}`);
  if (filter.sourceId) text.push(`来源单据 ${filter.sourceId}`);
  const fields = {
    date: '日期',
    number: '编号',
    amount: '金额（分）',
    summary: '摘要',
    creator: '制单人',
  };
  const operators = {
    eq: '等于',
    ne: '不等于',
    gte: '不小于',
    lte: '不大于',
    contains: '含有',
    notContains: '不含有',
  };
  for (const c of filter.conditions ?? [])
    text.push(`${fields[c.field]}${operators[c.operator]}“${c.value}”`);
  text.push('不含期初、草稿和作废');
  return text.join('；');
}

type TRow = {
  date: string;
  displayNo: string;
  accountCode: string;
  accountName: string;
  summary: string;
  debit: number;
  credit: number;
};
type SummaryRow = {
  code: string;
  name: string;
  currency: string;
  debit: number;
  credit: number;
  fcDebit: number;
  fcCredit: number;
};

export function tAccountHtml(rows: readonly TRow[], caption: string) {
  if (!rows.length) throw new Error('该条件范围内没有单据输入，请调整范围后打印');
  const total = reportTotals(rows);
  const side = (key: 'debit' | 'credit', label: string) =>
    `<section style="width:49%"><h2>${label} 合计 ${formatMoney(total[key])}</h2><table><colgroup><col style="width:25%"><col style="width:20%"><col style="width:25%"><col style="width:30%"></colgroup><thead><tr><th>日期 / 字号</th><th>科目</th><th>摘要</th><th>金额</th></tr></thead><tbody>${rows
      .filter((r) => r[key] !== 0)
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.date)}<br>${escapeHtml(r.displayNo)}</td><td>${escapeHtml(r.accountCode)} ${escapeHtml(r.accountName)}</td><td>${escapeHtml(r.summary)}</td><td class="num">${formatMoney(r[key])}</td></tr>`,
      )
      .join('')}</tbody></table></section>`;
  return `<h1>丁字帐户</h1><p>${escapeHtml(caption)}</p><div style="display:flex;justify-content:space-between">${side('debit', '借方')}${side('credit', '贷方')}</div>`;
}

export function summaryHtml(rows: readonly SummaryRow[], caption: string, foreign: boolean) {
  if (!rows.length) throw new Error('该条件范围内没有凭证发生额，请调整范围后打印');
  return `<h1>凭证科目汇总</h1><p>${escapeHtml(caption)}</p><table><thead><tr><th>科目编码</th><th>名称</th><th>币种</th><th>借方</th><th>贷方</th>${foreign ? '<th>原币借方</th><th>原币贷方</th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.currency)}</td><td class="num">${formatMoney(r.debit)}</td><td class="num">${formatMoney(r.credit)}</td>${foreign ? `<td class="num">${formatMoney(r.fcDebit)}</td><td class="num">${formatMoney(r.fcCredit)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
