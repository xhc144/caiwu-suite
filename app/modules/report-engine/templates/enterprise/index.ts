import { z } from 'zod';
import type { Account } from '@caiwu/core';
import {
  balanceFormula,
  emptyTemplate,
  ReportTemplateSchema,
  type ReportTemplate,
} from '../../shared';
import { ASSETS, CASHFLOW, LIABILITIES_EQUITY, PROFIT, type Line } from './lines';

const STATUS =
  '未完成：仅已配置项目可取数；待配置项目不是零。比较期间、重分类、结转前利润、完整现金流分配尚待接入，不可用作完整法定报表。';
export type Slots = Record<string, { current: string; comparative: string }>;
export const balanceSheetSlots = slots(ASSETS, 'B', 'C', LIABILITIES_EQUITY);
export const profitSlots = slots(PROFIT, 'B', 'C');
export const cashflowSlots = slots(CASHFLOW, 'B', 'C');

function slots(left: Line[], current: string, comparative: string, right: Line[] = []): Slots {
  const out: Slots = {};
  for (const [i, l] of left.entries())
    if (!l.section)
      out[l.key] = { current: `${current}${i + 5}`, comparative: `${comparative}${i + 5}` };
  for (const [i, l] of right.entries())
    if (!l.section) out[l.key] = { current: `E${i + 5}`, comparative: `F${i + 5}` };
  return out;
}

function text(t: ReportTemplate, address: string, source: string) {
  t.cells.push({ address, kind: 'text', source, unit: 'number', currency: 'CNY' });
}
function formula(t: ReportTemplate, address: string, source: string) {
  const at = t.cells.findIndex((c) => c.address === address);
  const cell = {
    address,
    kind: 'formula' as const,
    source,
    unit: 'cents' as const,
    currency: 'CNY',
  };
  if (at < 0) t.cells.push(cell);
  else t.cells[at] = cell;
  t.styles.push({ address, align: 'right', bold: false, wrap: true, format: 'decimal2' });
}
function base(code: string, name: string, rows: number, cols: number) {
  const t = emptyTemplate({ code, name: `${name}（未完成，局部取数）`, rows, cols });
  t.readOnly = true;
  text(t, 'A1', `${name}　会企 ${code === '201' ? '01' : code === '202' ? '02' : '03'} 表`);
  text(t, 'A2', STATUS);
  text(t, 'A3', '编制单位：待填写　期间：以生成页及导出口径页为准　单位：元（底层整数分）');
  for (const row of [1, 2, 3]) {
    t.merges.push({ row, col: 1, rows: 1, cols });
    t.styles.push({
      address: `A${row}`,
      align: row === 1 ? 'center' : 'left',
      bold: row < 3,
      wrap: true,
      format: 'general',
    });
  }
  t.rowHeights = [
    { row: 1, height: 32 },
    { row: 2, height: 80 },
    { row: 3, height: 40 },
  ];
  t.colWidths = Array.from({ length: cols }, (_, i) => ({
    col: i + 1,
    width: i % 3 === 0 ? 360 : 170,
  }));
  return t;
}
function addLines(
  t: ReportTemplate,
  lines: Line[],
  label: string,
  current: string,
  comparative: string,
) {
  for (const [i, l] of lines.entries()) {
    const row = i + 5;
    text(t, `${label}${row}`, l.label);
    t.styles.push({
      address: `${label}${row}`,
      align: 'left',
      bold: !!l.section || !!l.total,
      wrap: true,
      format: 'general',
    });
    if (!l.section) {
      text(t, `${current}${row}`, '待配置：本期取数口径');
      text(t, `${comparative}${row}`, '待共享接口：比较期间');
    }
  }
}

export function enterpriseBalanceSheet(): ReportTemplate {
  const t = base(
    '201',
    '企业资产负债表',
    Math.max(ASSETS.length, LIABILITIES_EQUITY.length) + 4,
    6,
  );
  [
    '资产',
    '期末余额',
    '上年年末余额',
    '负债和所有者权益（或股东权益）',
    '期末余额',
    '上年年末余额',
  ].forEach((v, i) => text(t, `${String.fromCharCode(65 + i)}4`, v));
  addLines(t, ASSETS, 'A', 'B', 'C');
  addLines(t, LIABILITIES_EQUITY, 'D', 'E', 'F');
  t.checks = [
    {
      name: '资产总计＝负债和所有者权益总计（待配置项会报错）',
      left: balanceSheetSlots.assetsTotal!.current,
      right: balanceSheetSlots.liabilitiesEquityTotal!.current,
      tolerance: '0',
    },
  ];
  return ReportTemplateSchema.parse(t);
}
export function enterpriseProfit(): ReportTemplate {
  const t = base('202', '企业利润表', PROFIT.length + 4, 3);
  ['项目', '本期金额', '上期金额'].forEach((v, i) => text(t, `${String.fromCharCode(65 + i)}4`, v));
  addLines(t, PROFIT, 'A', 'B', 'C');
  t.checks = [
    {
      name: '净利润＝持续经营＋终止经营净利润（待配置项会报错）',
      left: profitSlots.netProfit!.current,
      right: `${profitSlots.continuingProfit!.current}+${profitSlots.discontinuedProfit!.current}`,
      tolerance: '0',
    },
  ];
  return ReportTemplateSchema.parse(t);
}
export function enterpriseCashflow(): ReportTemplate {
  const t = base('203', '企业现金流量表', CASHFLOW.length + 4, 3);
  ['项目', '本期金额', '上期金额'].forEach((v, i) => text(t, `${String.fromCharCode(65 + i)}4`, v));
  addLines(t, CASHFLOW, 'A', 'B', 'C');
  t.checks = [
    {
      name: '期末现金＝期初现金＋净增加额（待配置项会报错）',
      left: cashflowSlots.cashClosing!.current,
      right: `${cashflowSlots.cashOpening!.current}+${cashflowSlots.cashIncrease!.current}`,
      tolerance: '0',
    },
  ];
  return ReportTemplateSchema.parse(t);
}

/** 只开放无需明细重分类的项目。账户由调用方明确映射；不假定任何一套科目表完整。 */
export const SIMPLE_BALANCE_KEYS = [
  'cash',
  'fixedAssets',
  'construction',
  'rightOfUseAssets',
  'intangibleAssets',
  'goodwill',
  'longTermPrepaid',
  'deferredTaxAssets',
  'shortTermLoans',
  'notesPayable',
  'employeePayable',
  'taxesPayable',
  'deferredTaxLiabilities',
  'capital',
  'capitalReserve',
  'treasuryStock',
  'otherComprehensive',
  'specialReserve',
  'surplusReserve',
] as const;
const roots = z
  .array(z.string().regex(/^\d{1,20}$/))
  .min(1)
  .max(6);
const BalanceBindingsSchema = z.partialRecord(z.enum(SIMPLE_BALANCE_KEYS), roots);
export type BalanceBindings = z.input<typeof BalanceBindingsSchema>;

function noOverlap(codes: string[], label: string) {
  for (const [i, a] of codes.entries())
    if (codes.slice(i + 1).some((b) => a.startsWith(b) || b.startsWith(a)))
      throw new Error(`${label}含重复或重叠的上级/下级科目，无法保证不重复取数`);
}
function balance(account: string, metric: 'closing' | 'debit' | 'credit', item = '') {
  return balanceFormula({
    account,
    metric,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: item ? 'cashflow' : 'none',
    item,
  });
}
/** 此处只启用实际已配置项目，所有比较数及未覆盖项目继续显示文本。 */
export function buildBalanceSheetSlice(raw: BalanceBindings): ReportTemplate {
  const bindings = BalanceBindingsSchema.parse(raw);
  noOverlap(Object.values(bindings).flat(), '资产负债表映射');
  const t = enterpriseBalanceSheet();
  const creditKeys = new Set([
    'shortTermLoans',
    'notesPayable',
    'employeePayable',
    'taxesPayable',
    'deferredTaxLiabilities',
    'capital',
    'capitalReserve',
    'otherComprehensive',
    'specialReserve',
    'surplusReserve',
  ]);
  for (const [key, codes] of Object.entries(bindings)) {
    const sum = codes.map((a) => balance(a, 'closing')).join('+');
    formula(t, balanceSheetSlots[key]!.current, creditKeys.has(key) ? `-(${sum})` : sum);
  }
  return ReportTemplateSchema.parse(t);
}

export const CASH_RECEIPT_KEYS = [
  'salesReceipts',
  'taxRefunds',
  'otherOperatingReceipts',
  'investmentRecovery',
  'investmentReturns',
  'assetDisposals',
  'businessDisposals',
  'otherInvestingReceipts',
  'capitalReceipts',
  'loanReceipts',
  'otherFinancingReceipts',
] as const;
export const CASH_PAYMENT_KEYS = [
  'purchases',
  'employees',
  'taxPayments',
  'otherOperatingPayments',
  'assetPurchases',
  'investmentPayments',
  'businessPurchases',
  'otherInvestingPayments',
  'debtPayments',
  'dividendInterestPayments',
  'otherFinancingPayments',
] as const;
const CashBindingsSchema = z
  .object({
    cashAccounts: roots,
    items: z.partialRecord(
      z.enum([...CASH_RECEIPT_KEYS, ...CASH_PAYMENT_KEYS]),
      z.string().min(1).max(40),
    ),
  })
  .strict();
export type CashBindings = z.input<typeof CashBindingsSchema>;
/**
 * 仅当前月、已由账套分配的现金流量项目；收到退回款与付款退款按净发生额处理。
 * 不推断现金等价物，不推断科目与项目关系，不提供不完整的全表净额。
 */
export function buildCashflowSlice(
  raw: CashBindings,
  accounts: readonly Account[],
): ReportTemplate {
  const bindings = CashBindingsSchema.parse(raw);
  noOverlap(bindings.cashAccounts, '现金账户映射');
  for (const code of bindings.cashAccounts) {
    if (!accounts.some((a) => a.code === code)) throw new Error(`现金账户 ${code} 不存在`);
    const leaves = accounts.filter((a) => a.isLeaf && a.code.startsWith(code));
    if (leaves.length === 0 || leaves.some((a) => !a.isCash && !a.isBank))
      throw new Error(`科目 ${code} 含非现金/银行末级账户；现金等价物映射尚未实现`);
  }
  if (new Set(Object.values(bindings.items)).size !== Object.keys(bindings.items).length)
    throw new Error('同一个现金流量项目不能同时映射多个报表项目');
  const t = enterpriseCashflow();
  const paymentKeys = new Set<string>(CASH_PAYMENT_KEYS);
  for (const [key, item] of Object.entries(bindings.items)) {
    const terms = bindings.cashAccounts.map(
      (a) =>
        `(${balance(a, paymentKeys.has(key) ? 'credit' : 'debit', item)}-${balance(a, paymentKeys.has(key) ? 'debit' : 'credit', item)})`,
    );
    formula(t, cashflowSlots[key]!.current, terms.join('+'));
  }
  // 不以缺项为零；只有每个组成项目都是已配置公式才开放相应小计。
  for (const l of CASHFLOW) {
    if (!l.total) continue;
    if (
      l.total.every((x) =>
        t.cells.some((c) => c.address === cashflowSlots[x.key]!.current && c.kind === 'formula'),
      )
    ) {
      const expr = l.total
        .map(
          (x, i) => `${x.sign === -1 ? '-' : i === 0 ? '' : '+'}${cashflowSlots[x.key]!.current}`,
        )
        .join('');
      formula(t, cashflowSlots[l.key]!.current, expr);
    }
  }
  return ReportTemplateSchema.parse(t);
}
