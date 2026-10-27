import {
  balanceFormula,
  ReportTemplateSchema,
  type BalanceFunction,
  type BalanceOptions,
  type ReportTemplate,
} from '../../shared';
import { balanceAddress, columnLabels, statementAddress, type FilingMode } from './catalogue';
import { balanceSheetTemplate, cashflowTemplate, incomeTemplate } from './templates';
import { applyInventoryBalances, type InventoryConfiguration } from './inventory-balance';

/** 使用共享owner的统一编码器，不另实现取数或序列化契约。 */
function balance(
  account: string,
  metric: BalanceFunction['metric'],
  options: BalanceOptions,
  item = '',
) {
  return balanceFormula({
    account,
    metric,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: item ? 'cashflow' : 'none',
    item,
    options,
  });
}

function replace(t: ReportTemplate, address: string, source: string) {
  const cell = t.cells.find((c) => c.address === address);
  if (!cell) throw new Error(`模板缺少${address}`);
  Object.assign(cell, { kind: 'formula', source, unit: 'cents', currency: 'CNY' });
  const style = t.styles.find((s) => s.address === address);
  if (style) Object.assign(style, { align: 'right', format: 'decimal2', wrap: false });
}

function text(t: ReportTemplate, address: string, source: string) {
  const cell = t.cells.find((c) => c.address === address);
  if (!cell) throw new Error(`模板缺少${address}`);
  cell.source = source;
}

const incomeAccounts: Readonly<
  Record<number, { codes: readonly string[]; side: 'debit' | 'credit' }>
> = {
  1: { codes: ['5001', '5051'], side: 'credit' },
  2: { codes: ['5401', '5402'], side: 'debit' },
  3: { codes: ['5403'], side: 'debit' },
  11: { codes: ['5601'], side: 'debit' },
  14: { codes: ['5602'], side: 'debit' },
  18: { codes: ['5603'], side: 'debit' },
  20: { codes: ['5111'], side: 'credit' },
  22: { codes: ['5301'], side: 'credit' },
  24: { codes: ['5711'], side: 'debit' },
  31: { codes: ['5801'], side: 'debit' },
};

/** 费用/税费“其中项”只有明确指定的真实科目才接入；不猜二级编码。 */
export type IncomeDetails = Partial<
  Record<
    4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 13 | 15 | 16 | 17 | 19 | 23 | 25 | 26 | 27 | 28 | 29,
    readonly string[]
  >
>;

function detailRoot(line: number) {
  if (line >= 4 && line <= 10) return '5403';
  if (line === 12 || line === 13) return '5601';
  if (line >= 15 && line <= 17) return '5602';
  if (line === 19) return '5603';
  if (line === 23) return '5301';
  if (line >= 25 && line <= 29) return '5711';
  throw new Error('不是利润表明细行次');
}

export function extendedIncomeTemplate(mode: FilingMode = 'monthly', details: IncomeDetails = {}) {
  const t = incomeTemplate(mode);
  t.name = `小企业利润表（${mode === 'monthly' ? '月报' : '年报12月'}取数切片，未完成）`;
  text(t, 'A1', t.name);
  text(
    t,
    'A39',
    '主项排除closing_kind=pnl，保留其它结转及红字/反向冲减；其中项须配置真实明细科目。年报仅选12月。',
  );
  for (const cell of t.cells)
    if (/^[CD](?:[6-9]|[12]\d|3[0-7])$/.test(cell.address) && cell.kind === 'text')
      cell.source = '未实现：需真实明细科目映射';
  const usedDetails = new Set<string>();
  for (const [line, codes] of Object.entries(details)) {
    const root = detailRoot(Number(line));
    if (!codes.length)
      throw new Error(`第${line}行须映射${root}下不重复的真实明细科目，不能传父科目、空数组或常量`);
    for (const code of codes) {
      if (
        !/^\d{5,20}$/.test(code) ||
        !code.startsWith(root) ||
        [...usedDetails].some((used) => used.startsWith(code) || code.startsWith(used))
      )
        throw new Error(`第${line}行明细科目不正确，或与其它明细重复/上下级重叠`);
      usedDetails.add(code);
    }
  }
  for (const key of ['ytd', 'comparison'] as const) {
    const range: BalanceOptions =
      key === 'ytd'
        ? { from: 'yearStart', to: 'current' }
        : mode === 'annual'
          ? { from: 'previousYearStart', to: 'previousYearEnd' }
          : { from: 'current', to: 'current' };
    const net = (codes: readonly string[], side: 'debit' | 'credit') =>
      codes
        .map(
          (account) =>
            `(${balance(account, side, { ...range, closing: 'excludePnl' })}-${balance(account, side === 'debit' ? 'credit' : 'debit', { ...range, closing: 'excludePnl' })})`,
        )
        .join('+');
    for (const [line, entry] of Object.entries(incomeAccounts))
      replace(t, statementAddress(Number(line), key), net(entry.codes, entry.side));
    for (const [line, codes] of Object.entries(details)) {
      if (!codes.length || codes.some((c) => !/^\d{1,20}$/.test(c)))
        throw new Error('利润表明细映射必须包含真实科目编码，不能传空数组或常量');
      replace(
        t,
        statementAddress(Number(line), key),
        net(codes, Number(line) === 23 ? 'credit' : 'debit'),
      );
    }
    const a = (line: number) => statementAddress(line, key);
    for (const [line, source] of [
      [21, `${a(1)}-${a(2)}-${a(3)}-${a(11)}-${a(14)}-${a(18)}+${a(20)}`],
      [30, `${a(21)}+${a(22)}-${a(24)}`],
      [32, `${a(30)}-${a(31)}`],
    ] as const) {
      replace(t, a(line), source);
      t.checks.push({
        name: `${columnLabels(mode)[key === 'ytd' ? 0 : 1]}第${line}行合计`,
        left: a(line),
        right: source,
        tolerance: '0',
      });
    }
    for (const [total, included] of [
      [3, [4, 5, 6, 7, 8, 9, 10]],
      [11, [12, 13]],
      [14, [15, 16, 17]],
      [18, [19]],
      [22, [23]],
      [24, [25, 26, 27, 28, 29]],
    ] as const)
      if (included.every((line) => details[line]?.length))
        t.checks.push({
          name: `${columnLabels(mode)[key === 'ytd' ? 0 : 1]}第${total}行包含其中项`,
          left: `${a(total)}>=(${included.map(a).join('+')})`,
          right: '1',
          tolerance: '0',
        });
  }
  return ReportTemplateSchema.parse(t);
}

/** 补两个方向重分类项目和存货；预付/预收期限仍留缺，side返回所选方向正数。 */
export function extendedBalanceSheetTemplate(inventory?: InventoryConfiguration) {
  const t = balanceSheetTemplate();
  for (const column of ['closing', 'yearOpening'] as const) {
    const metric = column === 'closing' ? 'closing' : 'opening';
    const range: BalanceOptions =
      column === 'closing'
        ? { from: 'current', to: 'current' }
        : { from: 'yearStart', to: 'yearStart' };
    const split = (code: string, side: 'debit' | 'credit') =>
      balance(code, metric, { ...range, side, groupBy: ['partner'] });
    replace(t, balanceAddress(4, column), `${split('1122', 'debit')}+${split('2203', 'debit')}`);
    replace(t, balanceAddress(33, column), `${split('2202', 'credit')}+${split('1123', 'credit')}`);
  }
  applyInventoryBalances(t, inventory);
  return ReportTemplateSchema.parse(t);
}

/** 保留已有月报；年报改用owner的上年范围读取E/F辅助区，再填D列22行。 */
export function extendedAnnualCashflowTemplate() {
  const t = cashflowTemplate('annual');
  t.name = '小企业现金流量表（年报12月取数试算，未完成）';
  text(t, 'A1', t.name);
  text(t, 'E30', '上年借方');
  text(t, 'F30', '上年贷方');
  text(
    t,
    'A51',
    '年报仅选12月；上年列固定上年初至上年末。逐分录分类阻止、单位日期及附注仍未完成。',
  );
  const accounts = ['1001', '1002', '1012'];
  const previous: BalanceOptions = { from: 'previousYearStart', to: 'previousYearEnd' };
  const sum = (metric: BalanceFunction['metric'], item = '', options = previous) =>
    accounts.map((a) => balance(a, metric, options, item)).join('+');
  for (let row = 31; row <= 47; row++) {
    const label = t.cells.find((c) => c.address === `A${row}`)!.source;
    const item = label.split(' ')[0]!;
    replace(t, `E${row}`, sum('debit', item));
    replace(t, `F${row}`, sum('credit', item));
    if (row === 47) continue;
    const line = Number(t.cells.find((c) => c.address === `B${row}`)!.source);
    const incoming = [1, 2, 8, 9, 10, 14, 15].includes(line);
    replace(
      t,
      statementAddress(line, 'comparison'),
      incoming ? `E${row}-F${row}` : `F${row}-E${row}`,
    );
  }
  const a = (line: number) => statementAddress(line, 'comparison');
  for (const [line, source] of [
    [7, `${a(1)}+${a(2)}-${a(3)}-${a(4)}-${a(5)}-${a(6)}`],
    [13, `${a(8)}+${a(9)}+${a(10)}-${a(11)}-${a(12)}`],
    [19, `${a(14)}+${a(15)}-${a(16)}-${a(17)}-${a(18)}`],
    [20, `${a(7)}+${a(13)}+${a(19)}`],
    [21, sum('opening', '', { from: 'previousYearStart', to: 'previousYearStart' })],
    [22, `${a(20)}+${a(21)}`],
  ] as const)
    replace(t, a(line), source);
  t.checks = t.checks.map((check) => {
    if (check.name === '本月借方分类完整')
      return { ...check, name: '上年借方分类金额核对', left: sum('debit') };
    if (check.name === '本月贷方分类完整')
      return { ...check, name: '上年贷方分类金额核对', left: sum('credit') };
    return check.name === '本月现金内部转存净额为零'
      ? { ...check, name: '上年现金内部转存净额为零' }
      : check;
  });
  t.checks.push({
    name: '上年期末现金与总账一致',
    left: a(22),
    right: sum('closing'),
    tolerance: '0',
  });
  return ReportTemplateSchema.parse(t);
}
