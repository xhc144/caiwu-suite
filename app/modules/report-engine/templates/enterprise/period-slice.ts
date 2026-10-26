import { z } from 'zod';
import type { Account } from '@caiwu/core';
import {
  balanceFormula,
  ReportTemplateSchema,
  type BalanceOptions,
  type ReportTemplate,
} from '../../shared';
import { PROFIT } from './lines';
import {
  balanceSheetSlots,
  cashflowSlots,
  profitSlots,
  buildBalanceSheetSlice,
  buildCashflowSlice,
  enterpriseProfit,
  RoleBindingSchema,
  type BalanceBindings,
  type CashBindings,
  type Slots,
} from './index';

type Scope = 'month' | 'yearToDate';
function range(scope: Scope, previous = false): BalanceOptions {
  return previous
    ? {
        from: scope === 'month' ? 'previousYearSameMonth' : 'previousYearStart',
        to: 'previousYearSameMonth',
      }
    : { from: scope === 'month' ? 'current' : 'yearStart', to: 'current' };
}
function putFormula(t: ReportTemplate, address: string, source: string) {
  const at = t.cells.findIndex((c) => c.address === address);
  const c = { address, kind: 'formula' as const, source, unit: 'cents' as const, currency: 'CNY' };
  if (at < 0) t.cells.push(c);
  else t.cells[at] = c;
  t.styles = t.styles.filter((s) => s.address !== address);
  t.styles.push({ address, align: 'right', wrap: true, bold: false, format: 'decimal2' });
}
function putText(t: ReportTemplate, address: string, source: string) {
  const at = t.cells.findIndex((c) => c.address === address);
  const c = { address, kind: 'text' as const, source, unit: 'number' as const, currency: 'CNY' };
  if (at < 0) t.cells.push(c);
  else t.cells[at] = c;
}
function note(t: ReportTemplate, message: string) {
  const row = ++t.rows;
  putText(t, `A${row}`, message);
  t.merges.push({ row, col: 1, rows: 1, cols: t.cols });
  t.styles.push({ address: `A${row}`, align: 'left', wrap: true, bold: false, format: 'general' });
  t.rowHeights.push({ row, height: 48 });
}
function accountFormula(
  account: string,
  metric: 'closing' | 'debit' | 'credit',
  options: BalanceOptions,
) {
  return balanceFormula({
    account,
    metric,
    options,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'none',
    item: '',
  });
}
function copyComparative(t: ReportTemplate, previous: ReportTemplate, positions: Slots) {
  const references = new Map(Object.values(positions).map((s) => [s.current, s.comparative]));
  for (const s of Object.values(positions)) {
    const c = previous.cells.find((c) => c.address === s.current)!;
    if (c.kind === 'formula') {
      // 本目录生成的纯单元格合计要转到比较列；BALANCE中的引号参数逐字保留。
      const source = c.source.includes('"')
        ? c.source
        : c.source.replace(/\b[A-Z]{1,2}[1-9]\d{0,2}\b/g, (a) => references.get(a) ?? a);
      putFormula(t, s.comparative, source);
    } else if (c.source.startsWith('已声明不适用')) putText(t, s.comparative, c.source);
  }
}
function crossPeriodNotice(t: ReportTemplate, detail: string) {
  putText(
    t,
    'A2',
    `未完成的实际取数切片：${detail}。未覆盖项目保留待配置，不可作为完整法定报表。本切片禁止使用旧页面底部自动明细链接核对金额：旧链接未保留实际期间、结转过滤与辅助分组，禁止用它核对比较数或本切片净额；请按公式口径独立查明细，等待web owner接入准确穿透。`,
  );
}

/** 两列分别要求完整角色声明，不把本期不适用自动推断为上年不适用。 */
export function buildBalanceSheetComparatives(
  current: BalanceBindings,
  previous: BalanceBindings,
  accounts: readonly Account[],
) {
  const t = buildBalanceSheetSlice(current, accounts);
  const prior = buildBalanceSheetSlice(previous, accounts, {
    from: 'previousYearEnd',
    to: 'previousYearEnd',
  });
  copyComparative(t, prior, balanceSheetSlots);
  const formRows = Math.max(
    ...Object.values(balanceSheetSlots).map((s) => Number(s.current.slice(1))),
  );
  for (const c of prior.cells)
    if (c.kind === 'text' && c.address.startsWith('A') && Number(c.address.slice(1)) > formRows)
      note(t, `上年年末组成角色声明：${c.source}`);
  t.checks.push(...prior.checks.slice(1).map((c) => ({ ...c, name: `上年年末：${c.name}` })));
  t.checks.push({
    name: '上年年末资产＝负债及权益（缺项会报错）',
    left: balanceSheetSlots.assetsTotal!.comparative,
    right: balanceSheetSlots.liabilitiesEquityTotal!.comparative,
    tolerance: '0',
  });
  crossPeriodNotice(t, '本期末与上年12月末分别取真实余额；余额包含已过账结转');
  return ReportTemplateSchema.parse(t);
}

export function buildCashflowComparatives(
  current: CashBindings,
  previous: CashBindings,
  accounts: readonly Account[],
  scope: Scope = 'month',
) {
  const t = buildCashflowSlice(current, accounts, range(scope));
  const prior = buildCashflowSlice(previous, accounts, range(scope, true));
  copyComparative(t, prior, cashflowSlots);
  crossPeriodNotice(
    t,
    scope === 'month'
      ? '本月与上年同月现金项目；包含真实现金发生，不排结转'
      : '年初至生成月与上年同期累计现金项目；包含真实现金发生，不排结转',
  );
  putText(t, 'B4', scope === 'month' ? '本月金额' : '本年累计金额');
  putText(t, 'C4', scope === 'month' ? '上年同月金额' : '上年同期累计金额');
  return ReportTemplateSchema.parse(t);
}

export const PROFIT_INPUT_KEYS = [
  'revenue',
  'cost',
  'taxes',
  'selling',
  'administration',
  'research',
  'finance',
  'otherIncome',
  'investmentIncome',
  'hedgeIncome',
  'fairValueIncome',
  'creditImpairment',
  'assetImpairment',
  'disposalIncome',
  'nonoperatingIncome',
  'nonoperatingExpense',
  'incomeTax',
  'interestExpense',
  'interestIncome',
  'associateIncome',
  'derecognitionIncome',
] as const;
const ProfitBindingsSchema = z.partialRecord(z.enum(PROFIT_INPUT_KEYS), RoleBindingSchema);
export type ProfitBindings = z.input<typeof ProfitBindingsSchema>;
const creditNet = new Set([
  'revenue',
  'otherIncome',
  'investmentIncome',
  'hedgeIncome',
  'fairValueIncome',
  'creditImpairment',
  'assetImpairment',
  'disposalIncome',
  'nonoperatingIncome',
  'interestIncome',
  'associateIncome',
  'derecognitionIncome',
]);
const informationParents: Record<string, string> = {
  interestExpense: 'finance',
  interestIncome: 'finance',
  associateIncome: 'investmentIncome',
  derecognitionIncome: 'investmentIncome',
};

function validateProfitMappings(
  bindings: z.infer<typeof ProfitBindingsSchema>,
  accounts: readonly Account[],
  pnlCategoryIds: readonly string[],
) {
  const main: string[] = [];
  for (const [key, b] of Object.entries(bindings)) {
    if (b.state === 'notApplicable') continue;
    for (const code of b.accounts) {
      const root = accounts.find((a) => a.code === code);
      if (!root) throw new Error(`利润项目映射的科目 ${code} 不存在`);
      if (
        accounts
          .filter((a) => a.isLeaf && a.code.startsWith(code))
          .some((a) => !pnlCategoryIds.includes(a.categoryId))
      )
        throw new Error(`科目 ${code} 含非损益账户，不能冒充利润发生额`);
    }
    for (const [i, a] of b.accounts.entries())
      if (b.accounts.slice(i + 1).some((c) => a.startsWith(c) || c.startsWith(a)))
        throw new Error('同一利润项目内含重复或父子重叠账户');
    const parentKey = informationParents[key];
    if (parentKey) {
      const parent = bindings[parentKey as keyof typeof bindings];
      if (
        !parent ||
        parent.state === 'notApplicable' ||
        b.accounts.some((a) => !parent.accounts.some((p) => a.startsWith(p)))
      )
        throw new Error('利润表其中项必须属于已明确映射的父项目，不能另计为独立利润');
    } else main.push(...b.accounts);
  }
  for (const [i, a] of main.entries())
    if (main.slice(i + 1).some((b) => a.startsWith(b) || b.startsWith(a)))
      throw new Error('利润基本项目账户重叠；研发与管理费用等必须明确拆分，不能重复计入');
}

function fillProfit(
  t: ReportTemplate,
  bindings: z.infer<typeof ProfitBindingsSchema>,
  scope: Scope,
  previous: boolean,
) {
  const column = previous ? 'comparative' : 'current';
  const options: BalanceOptions = { ...range(scope, previous), closing: 'excludePnl' };
  const resolved = new Set<string>();
  for (const [key, b] of Object.entries(bindings)) {
    const address = profitSlots[key]![column];
    const label = PROFIT.find((l) => l.key === key)!.label;
    resolved.add(key);
    if (b.state === 'notApplicable') {
      putText(t, address, `已声明不适用：${b.reason}`);
      note(t, `${previous ? '上年同期' : '本期'} ${label}：已声明不适用；${b.reason}`);
      continue;
    }
    const values: string[] = [];
    for (const account of b.accounts) {
      // 每个账户独立明细格，避免多账户加第8参数后突破2000字符及公式节点限制。
      const row = ++t.rows;
      putText(
        t,
        `A${row}`,
        `${previous ? '上年同期' : '本期'} ${label}：科目${account}净发生（仅排损益结转）`,
      );
      const helper = `${previous ? 'C' : 'B'}${row}`;
      const debit = accountFormula(account, 'debit', options);
      const credit = accountFormula(account, 'credit', options);
      putFormula(t, helper, creditNet.has(key) ? `${credit}-${debit}` : `${debit}-${credit}`);
      values.push(helper);
    }
    const source = `SUM(${values.join(',')})`;
    putFormula(t, address, source);
    if (b.state === 'zero') {
      note(t, `${label}零发生声明：${b.reason}；仍取真实发生，非零会审核失败`);
      t.checks.push({
        name: `${previous ? '上年同期' : '本期'}${label}零发生声明`,
        left: address,
        right: `${address}*0`,
        tolerance: '0',
      });
    }
  }
  // 其中项不参与总计；每个直接组成项目都已明确映射/声明后才计算该合计。
  const pending = PROFIT.filter((l) => l.total);
  for (let pass = 0; pass < pending.length; pass++) {
    let changed = false;
    for (const l of pending) {
      if (resolved.has(l.key) || !l.total!.every((c) => resolved.has(c.key))) continue;
      const pieces = l.total!.filter(
        (c) => t.cells.find((v) => v.address === profitSlots[c.key]![column])?.kind === 'formula',
      );
      if (pieces.length === 0)
        putText(t, profitSlots[l.key]![column], '已声明不适用：所有组成项目均不适用');
      else
        putFormula(
          t,
          profitSlots[l.key]![column],
          pieces
            .map(
              (c, i) => `${c.sign === -1 ? '-' : i === 0 ? '' : '+'}${profitSlots[c.key]![column]}`,
            )
            .join(''),
        );
      resolved.add(l.key);
      changed = true;
    }
    if (!changed) break;
  }
}

/** 当前数与比较数独立声明；不自动推断持续经营、OCI及EPS。 */
export function buildProfitSlice(
  current: ProfitBindings,
  accounts: readonly Account[],
  pnlCategoryIds: readonly string[],
  settings: { scope?: Scope; previous?: ProfitBindings } = {},
) {
  const currentBindings = ProfitBindingsSchema.parse(current);
  const previousBindings = settings.previous
    ? ProfitBindingsSchema.parse(settings.previous)
    : undefined;
  validateProfitMappings(currentBindings, accounts, pnlCategoryIds);
  if (previousBindings) validateProfitMappings(previousBindings, accounts, pnlCategoryIds);
  const t = enterpriseProfit();
  const scope = settings.scope ?? 'month';
  fillProfit(t, currentBindings, scope, false);
  if (previousBindings) fillProfit(t, previousBindings, scope, true);
  crossPeriodNotice(
    t,
    `${scope === 'month' ? '本月' : '本年累计'}损益按真实净发生计算，仅排closing_kind为pnl；普通及自定义转账保留`,
  );
  putText(t, 'B4', scope === 'month' ? '本月金额' : '本年累计金额');
  if (previousBindings) putText(t, 'C4', scope === 'month' ? '上年同月金额' : '上年同期累计金额');
  return ReportTemplateSchema.parse(t);
}

const tradeRoots = z
  .array(z.string().regex(/^\d{1,20}$/))
  .min(1)
  .max(6);
const TradeSchema = z
  .object({ receivables: tradeRoots, advances: tradeRoots, allowance: RoleBindingSchema })
  .strict();
export type ReceivableBindings = z.input<typeof TradeSchema>;
/** 应收/预收按末级和往来对象分别取正借/正贷；坏账准备必须另作角色声明。 */
export function addReceivableReclassification(
  t: ReportTemplate,
  raw: ReceivableBindings,
  accounts: readonly Account[],
  previous = false,
) {
  const binding = TradeSchema.parse(raw);
  const codes = [
    ...binding.receivables,
    ...binding.advances,
    ...(binding.allowance.state === 'notApplicable' ? [] : binding.allowance.accounts),
  ];
  for (const [i, a] of codes.entries()) {
    if (!accounts.some((c) => c.code === a)) throw new Error(`应收/预收组成账户 ${a} 不存在`);
    if (codes.slice(i + 1).some((b) => a.startsWith(b) || b.startsWith(a)))
      throw new Error('应收/预收/坏账准备账户重复或父子重叠');
  }
  const amounts = { debit: [] as string[], credit: [] as string[], allowance: [] as string[] };
  const options: BalanceOptions = previous
    ? { from: 'previousYearEnd', to: 'previousYearEnd', groupBy: ['partner'] }
    : { groupBy: ['partner'] };
  for (const account of [...binding.receivables, ...binding.advances]) {
    const row = ++t.rows;
    putText(
      t,
      `A${row}`,
      `${previous ? '上年年末' : '本期末'}应收/预收：${account}按末级及往来分方向，不相互抵销`,
    );
    putFormula(t, `B${row}`, accountFormula(account, 'closing', { ...options, side: 'debit' }));
    putFormula(t, `E${row}`, accountFormula(account, 'closing', { ...options, side: 'credit' }));
    amounts.debit.push(`B${row}`);
    amounts.credit.push(`E${row}`);
  }
  if (binding.allowance.state === 'notApplicable')
    note(t, `应收坏账准备已声明不适用：${binding.allowance.reason}`);
  else
    for (const account of binding.allowance.accounts) {
      const row = ++t.rows;
      putText(t, `A${row}`, `应收坏账准备：${account}；借正贷负，加到应收借方额上求净额`);
      putFormula(
        t,
        `B${row}`,
        accountFormula(
          account,
          'closing',
          previous ? { from: 'previousYearEnd', to: 'previousYearEnd' } : {},
        ),
      );
      amounts.allowance.push(`B${row}`);
    }
  const column = previous ? 'comparative' : 'current';
  putFormula(
    t,
    balanceSheetSlots.accountsReceivable![column],
    `SUM(${[...amounts.debit, ...amounts.allowance].join(',')})`,
  );
  putFormula(t, balanceSheetSlots.advances![column], `SUM(${amounts.credit.join(',')})`);
  if (binding.allowance.state === 'zero')
    t.checks.push({
      name: `${previous ? '上年末' : '期末'}应收坏账零余额声明`,
      left: `SUM(${amounts.allowance.join(',')})`,
      right: `SUM(${amounts.allowance.join(',')})*0`,
      tolerance: '0',
    });
  crossPeriodNotice(
    t,
    '应收/预收逐末级及往来对象分借贷方向并单独扣除已映射坏账准备；合同净额、期限重分类仍待实现',
  );
  return ReportTemplateSchema.parse(t);
}
